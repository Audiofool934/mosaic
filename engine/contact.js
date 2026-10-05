// Contacts: the moments the stones are touched, for sound. A fingertip sliding over the wall
// is heard all the while it slides, and now and then it catches a stone: at once when it
// starts, then more often the faster it moves, but never in a clatter. While stones are laid,
// one is heard landing in its bed now and then. Live input only; exports never produce
// contacts.
import { MATERIALS } from './picture.js';
import { TEXELS } from './renderer.js';

const NAMES = Object.fromEntries(Object.entries(MATERIALS).map(([name, id]) => [id, name]));
const STRIDE = TEXELS * 4;
// Grid cells for finding the stone under the pointer, and the size of the largest stone, in
// metres.
const CELL = 0.06;
const LARGEST = 0.03;
// A fingertip catches a stone each time it has slid about this share of the view's width, at
// most about once in GAP seconds, and as soon as it has slid START after resting for REST
// seconds, so a hand that only trembles is not heard. A slide of PACE view widths a second is
// heard at full strength.
const SPACING = 0.035;
const GAP = 0.13;
const START = 0.004;
const REST = 0.25;
const PACE = 1;
// While stones are laid, one is heard landing about once in this many seconds.
const LAID = 0.2;

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

// The seated stone whose edge is nearest to x, y, within reach, and how far its edge is.
function under(L, x, y, reach, time) {
  const H = stonesOf(L), d = L.data, pad = reach + LARGEST / 2;
  const i0 = Math.max(0, Math.floor((x - pad - H.x0) / CELL)), i1 = Math.min(H.nx - 1, Math.floor((x + pad - H.x0) / CELL));
  const j0 = Math.max(0, Math.floor((y - pad - H.y0) / CELL)), j1 = Math.min(H.ny - 1, Math.floor((y + pad - H.y0) / CELL));
  let stone = -1, gap = reach;
  for (let j = j0; j <= j1; j++) {
    for (let c = j * H.nx + i0; c <= j * H.nx + i1; c++) {
      for (let p = H.start[c]; p < H.start[c + 1]; p++) {
        const i = H.items[p], o = i * STRIDE;
        if (time < d[o + 2] || time >= d[o + 24]) continue;
        const edge = Math.hypot(d[o] - x, d[o + 1] - y) - H.size[i] / 2000;
        if (edge < gap) { gap = edge; stone = i; }
      }
    }
  }
  return [stone, gap];
}

export function createContacts() {
  // How far the pointer has slid since it last caught a stone and how far it slides before
  // the next, in view widths; when it may next catch one, when it last moved, and when the
  // next laid stone may be heard, on the input's clock. The spacing and the waits vary a
  // little, so the stones never tick like a clock.
  let slid = 0, next = SPACING, ready = -Infinity, moved = -Infinity, landing = -Infinity, turn = 0;
  const where = (d, i, view) => ({ x: (d[i * STRIDE] - (view.x - view.w / 2)) / view.w, y: (view.y + view.h / 2 - d[i * STRIDE + 1]) / view.h });
  const event = (L, i, view, kind, strength) => ({ kind, material: NAMES[Math.round(L.data[i * STRIDE + 15])] || 'glass', size: stonesOf(L).size[i], strength, ...where(L.data, i, view) });

  // layers: those drawn at time; touch: where the pointer is on the wall ({ at, reach of a
  // fingertip }) with how far it moved since the last frame, in view widths, and its speed,
  // in view widths per second, or null; from: the film time of the last frame heard; view:
  // the wall in view, in metres; clock: the input's clock.
  return function hear({ layers, touch, time, from, view, clock }) {
    const events = [];
    if (touch && touch.moved > 1e-4) {
      if (clock - moved > REST) slid = next - START;
      moved = clock;
      slid += touch.moved;
      let found = null, gap = touch.reach;
      for (const L of layers) {
        const [i, edge] = under(L, touch.at[0], touch.at[1], gap, time);
        if (i >= 0) { found = [L, i]; gap = edge; }
      }
      if (found) {
        const pace = Math.min(1, touch.speed / PACE);
        events.push(event(...found, view, 'slide', Math.sqrt(pace)));
        if (slid >= next && clock >= ready) {
          turn++;
          events.push(event(...found, view, 'touch', (0.45 + 0.55 * pace) * (0.8 + 0.2 * fract(turn * 0.618))));
          slid = 0;
          next = SPACING * (0.7 + 0.6 * fract(turn * 0.754));
          ready = clock + GAP * (0.75 + 0.5 * fract(turn * 0.437));
        }
      }
    }
    // One of the stones laid since the last frame, in view.
    if (time > from && clock >= landing) {
      for (const L of layers) {
        const H = stonesOf(L), d = L.data;
        let lo = 0, hi = H.seat.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (H.seat[mid] <= from) lo = mid + 1; else hi = mid; }
        let stone = -1;
        for (let p = lo; p < H.seat.length && H.seat[p] <= time && stone < 0; p++) {
          const i = H.bySeat[p], o = i * STRIDE;
          if (Math.abs(d[o] - view.x) < view.w / 2 && Math.abs(d[o + 1] - view.y) < view.h / 2) stone = i;
        }
        if (stone < 0) continue;
        events.push(event(L, stone, view, 'lay', 0.5 + 0.3 * fract(stone * 0.618)));
        landing = clock + LAID * (0.6 + 0.8 * fract(stone * 0.381));
        break;
      }
    }
    return events;
  };
}
