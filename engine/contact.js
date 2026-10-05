// Contacts: the moments stones meet the mortar, for sound. A seated stone settles when the
// pointer's curl lets it fall back into its bed, by the same spring it is drawn with, and a
// laid stone lands at its seat time. Live input only; exports never produce contacts.
import { MATERIALS } from './picture.js';
import { SPRING, TEXELS, TRAIL, TRAIL_STEP } from './renderer.js';

const NAMES = Object.fromEntries(Object.entries(MATERIALS).map(([name, id]) => [id, name]));
const STRIDE = TEXELS * 4;
// Grid cells for finding the stones under the curl, in metres.
const CELL = 0.06;
// A stone falling below this share of the full curl, from above the next, has met its bed.
const DOWN = 0.03;
const UP = 0.12;
// At most this many laid stones are heard in one frame.
const LAID = 2;

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
  const where = (d, i, view) => ({ x: (d[i * STRIDE] - (view.x - view.w / 2)) / view.w, y: (view.y + view.h / 2 - d[i * STRIDE + 1]) / view.h });
  const event = (L, H, i, view, kind, strength) => ({ kind, material: NAMES[Math.round(L.data[i * STRIDE + 15])] || 'glass', size: H.size[i], strength, ...where(L.data, i, view) });

  // layers: those drawn at time; pointer: the trail as drawn ({ head, trail } on the wall) or
  // null; from: the film time of the last frame heard; view: the wall in view, in metres.
  return function hear({ layers, pointer, time, from, dt, view }) {
    const events = [];
    const seen = new Set();
    layers.forEach((L, l) => {
      const H = stonesOf(L), d = L.data;
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
              // A stone strikes its bed as hard as it was lifted high.
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
