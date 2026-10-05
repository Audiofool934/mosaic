// Contacts: the moments the stones are touched and meet each other or their mortar, for
// sound. The pointer touches the stones it passes over at once, like a fingertip sliding over
// them; its curl knocks stones as it lifts them and lets them settle back into their beds, by
// the same spring they are drawn with; and a laid stone lands at its seat time. Live input
// only; exports never produce contacts.
import { MATERIALS } from './picture.js';
import { SPRING, TEXELS, TRAIL, TRAIL_STEP } from './renderer.js';

const NAMES = Object.fromEntries(Object.entries(MATERIALS).map(([name, id]) => [id, name]));
const STRIDE = TEXELS * 4;
// Grid cells for finding the stones under the curl, in metres.
const CELL = 0.06;
// A stone falling below this share of the full curl, from above the next, has met its bed,
// and one rising past LIFT knocks against its neighbours as it tilts.
const DOWN = 0.03;
const UP = 0.12;
const LIFT = 0.55;
// At most this many laid stones, stones under the pointer, and stones knocked by the curl as
// it lifts them are heard in a frame; a stone touched is not touched again for TOUCHED seconds.
const LAID = 2;
const TOUCHES = 6;
const KNOCKED = 2;
const TOUCHED = 0.2;
// The size of the largest stone, in metres, for finding the stones near the pointer's path.
const LARGEST = 0.03;

const fract = (v) => v - Math.floor(v);

// Each layer's stones by grid cell and by seat time, built the first time it is heard.
function stonesOf(L) {
  if (L.heard) return L.heard;
  const d = L.data, n = L.count;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = d[i * STRIDE], y = d[i * STRIDE + 1];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const nx = Math.max(1, Math.ceil((x1 - x0) / CELL) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / CELL) + 1);
  const cellOf = (i) => Math.min(ny - 1, Math.floor((d[i * STRIDE + 1] - y0) / CELL)) * nx + Math.min(nx - 1, Math.floor((d[i * STRIDE] - x0) / CELL));
  const start = new Uint32Array(nx * ny + 1);
  for (let i = 0; i < n; i++) start[cellOf(i) + 1]++;
  for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
  const fill = start.slice(0, -1), items = new Uint32Array(n);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    items[fill[cellOf(i)]++] = i;
    // The four corners lie about a side's width over the square root of two from the centre.
    let r = 0;
    for (let k = 0; k < 4; k++) r += Math.hypot(d[i * STRIDE + 4 + k * 2], d[i * STRIDE + 5 + k * 2]);
    size[i] = (r / 4) * Math.SQRT2 * 1000;
  }
  const bySeat = new Uint32Array(n).map((_, i) => i).sort((a, b) => d[a * STRIDE + 2] - d[b * STRIDE + 2] || a - b);
  L.heard = { x0, y0, nx, ny, start, items, size, bySeat, seat: Float32Array.from(bySeat, (i) => d[i * STRIDE + 2]) };
  return L.heard;
}

// A stone's spring, as the response at each trail sample's age, normalised; it depends only
// on the stone's seed, as on screen.
function springOf(seed) {
  const w0 = SPRING.omega * (1 + SPRING.spread * (2 * fract(seed * 71.3) - 1));
  const decay = SPRING.zeta * w0, wd = Math.sqrt(1 - SPRING.zeta ** 2) * w0;
  const g = new Float32Array(TRAIL);
  let norm = 0;
  for (let k = 0; k < TRAIL; k++) {
    const tau = (k + 0.5) * TRAIL_STEP;
    g[k] = Math.exp(-decay * tau) * Math.sin(wd * tau);
    norm += g[k];
  }
  return g.map((v) => v / norm);
}

// How far the pointer's recent path lifts the stone at x, y, as a share of the full curl:
// the same spring and bump the stones are drawn with.
function lifted(x, y, g, pointer) {
  const { head, trail } = pointer, radius = head[3], reach = radius * radius;
  let lift = 0;
  for (let k = 0; k < TRAIL; k++) {
    const s = trail[k * 4 + 2];
    if (!(s > 0)) continue;
    const dx = x - trail[k * 4], dy = y - trail[k * 4 + 1], d2 = dx * dx + dy * dy;
    if (d2 >= reach) continue;
    const q = 1 - Math.sqrt(d2) / radius;
    lift += q * q * (3 - 2 * q) * s * g[k];
  }
  return lift;
}

export function createContacts() {
  // Lift of every stone the curl has touched, by layer and stone, at the last frame heard,
  // with the highest it has been lifted since it left its bed, and the springs of the stones
  // the curl has reached.
  const lifts = new Map();
  const springs = new Map();
  // When each stone under the pointer was last touched, on the input's clock.
  const touches = new Map();
  const where = (d, i, view) => ({ x: (d[i * STRIDE] - (view.x - view.w / 2)) / view.w, y: (view.y + view.h / 2 - d[i * STRIDE + 1]) / view.h });
  const event = (L, H, i, view, kind, strength, delay = 0) => ({ kind, material: NAMES[Math.round(L.data[i * STRIDE + 15])] || 'glass', size: H.size[i], strength, delay, ...where(L.data, i, view) });

  // layers: those drawn at time; pointer: the trail as drawn ({ head, trail } on the wall) or
  // null; touch: the pointer's own path since the last frame ({ a, b } on the wall, the reach
  // of a fingertip, speed in view widths per second, and the seconds it took) or null; from:
  // the film time of the last frame heard; view: the wall in view, in metres.
  return function hear({ layers, pointer, touch, time, from, view, clock }) {
    const events = [], knocked = [];
    const seen = new Set();
    layers.forEach((L, l) => {
      const H = stonesOf(L), d = L.data;
      // The stones under the pointer's own path, heard in the order it crossed them and spread
      // over the time it took, before the curl has moved any of them.
      if (touch) {
        const { a, b, reach, speed, dt } = touch;
        const vx = b[0] - a[0], vy = b[1] - a[1], v2 = vx * vx + vy * vy, pad = reach + LARGEST;
        const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - pad - H.x0) / CELL)), i1 = Math.min(H.nx - 1, Math.floor((Math.max(a[0], b[0]) + pad - H.x0) / CELL));
        const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - pad - H.y0) / CELL)), j1 = Math.min(H.ny - 1, Math.floor((Math.max(a[1], b[1]) + pad - H.y0) / CELL));
        const touched = [];
        for (let j = j0; j <= j1; j++) {
          for (let c = j * H.nx + i0; c <= j * H.nx + i1; c++) {
            for (let p = H.start[c]; p < H.start[c + 1]; p++) {
              const i = H.items[p], o = i * STRIDE;
              if (time < d[o + 2] || time >= d[o + 24]) continue;
              const t = v2 > 1e-12 ? Math.min(1, Math.max(0, ((d[o] - a[0]) * vx + (d[o + 1] - a[1]) * vy) / v2)) : 1;
              const gap = Math.hypot(d[o] - a[0] - t * vx, d[o + 1] - a[1] - t * vy), near = reach + H.size[i] / 2000;
              const key = l * 1e7 + i;
              if (gap < near && !(clock - (touches.get(key) ?? -1) < TOUCHED)) touched.push([t, i, 1 - gap / near, key]);
            }
          }
        }
        touched.sort((x, y) => x[0] - y[0]);
        const step = Math.max(1, touched.length / TOUCHES), pace = Math.min(1, Math.max(0.12, speed / 1.5));
        for (let q = 0; q < touched.length; q += step) {
          const [t, i, close, key] = touched[Math.floor(q)];
          touches.set(key, clock);
          events.push(event(L, H, i, view, 'touch', pace * (0.55 + 0.45 * close) * (0.8 + 0.4 * fract(i * 0.754)), t * dt));
        }
      }
      if (pointer) {
        const [cx, cy, reach] = pointer.head;
        const i0 = Math.max(0, Math.floor((cx - reach - H.x0) / CELL)), i1 = Math.min(H.nx - 1, Math.floor((cx + reach - H.x0) / CELL));
        const j0 = Math.max(0, Math.floor((cy - reach - H.y0) / CELL)), j1 = Math.min(H.ny - 1, Math.floor((cy + reach - H.y0) / CELL));
        for (let j = j0; j <= j1; j++) {
          for (let c = j * H.nx + i0; c <= j * H.nx + i1; c++) {
            for (let p = H.start[c]; p < H.start[c + 1]; p++) {
              const i = H.items[p], o = i * STRIDE;
              // Only a seated stone answers the pointer, as on screen.
              if (time < d[o + 2] || time >= d[o + 24]) continue;
              const key = l * 1e7 + i;
              let g = springs.get(key);
              if (!g) springs.set(key, (g = springOf(d[o + 3])));
              const lift = lifted(d[o], d[o + 1], g, pointer);
              const [before, peak] = lifts.get(key) ?? [0, 0];
              // A stone knocks its neighbours as the curl tilts it up, and strikes its bed as
              // hard as it was lifted high.
              if (before <= LIFT && lift > LIFT) knocked.push([lift, () => event(L, H, i, view, 'lift', 0.25 + 0.4 * Math.min(1, lift))]);
              if (before > UP && lift <= DOWN) events.push(event(L, H, i, view, 'settle', Math.min(1, 0.2 + 0.8 * peak)));
              if (lift > DOWN || before > DOWN) lifts.set(key, [lift, lift <= DOWN ? 0 : Math.max(peak, lift)]);
              else lifts.delete(key);
              seen.add(key);
            }
          }
        }
      }
      // Laid stones that reached their seats since the last frame, the ones in view.
      if (time > from) {
        let lo = 0, hi = H.seat.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (H.seat[mid] <= from) lo = mid + 1; else hi = mid; }
        const picked = [];
        for (let p = lo; p < H.seat.length && H.seat[p] <= time; p++) {
          const i = H.bySeat[p], o = i * STRIDE;
          if (Math.abs(d[o] - view.x) < view.w / 2 && Math.abs(d[o + 1] - view.y) < view.h / 2) picked.push(i);
        }
        const step = Math.max(1, picked.length / LAID);
        for (let q = 0; q < picked.length; q += step) {
          const i = picked[Math.floor(q)];
          events.push(event(L, H, i, view, 'lay', 0.45 + 0.35 * fract(i * 0.618)));
        }
      }
    });
    // The stones the curl lifts highest knock their neighbours; the rest only lean.
    knocked.sort((a, b) => b[0] - a[0]);
    for (const [, made] of knocked.slice(0, KNOCKED)) events.push(made());
    for (const [key, at] of touches) if (clock - at > TOUCHED) touches.delete(key);
    // Stones the curl has left behind fall back with nothing to hold them up.
    for (const [key, [before, peak]] of lifts) {
      if (seen.has(key)) continue;
      lifts.delete(key);
      if (before <= UP) continue;
      const L = layers[Math.floor(key / 1e7)];
      if (L) events.push(event(L, stonesOf(L), key % 1e7, view, 'settle', Math.min(1, 0.2 + 0.8 * peak)));
    }
    return events;
  };
}
