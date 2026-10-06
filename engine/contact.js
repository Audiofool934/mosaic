// Contacts: the moments the pointer touches the stones, for sound. A fingertip sliding over the
// wall touches it as soon as it starts and again each time it has slid a little further, a few
// times a second at most, wherever there are stones under it. Live input only; exports never
// produce contacts.
import { MATERIALS } from './picture.js';
import { TEXELS } from './renderer.js';

const NAMES = Object.fromEntries(Object.entries(MATERIALS).map(([name, id]) => [id, name]));
const STRIDE = TEXELS * 4;
// Grid cells for finding the stone under the pointer, and the size of the largest stone, in
// metres.
const CELL = 0.06;
const LARGEST = 0.03;
// A fingertip touches the stones each time it has slid about STEP of the view's width, at most
// about once in GAP seconds, and as soon as it has slid START after resting for REST seconds,
// so a hand that only trembles is not heard. A slide of PACE view widths a second touches them
// at full strength.
const STEP = 0.06;
const GAP = 0.2;
const START = 0.0025;
const REST = 0.25;
const PACE = 1;

const fract = (v) => v - Math.floor(v);

// Each layer's stones by grid cell, with their sizes, built the first time it is heard.
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
  L.heard = { x0, y0, nx, ny, start, items, size };
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
  // How far the pointer has slid since it last touched the stones and how far it slides before
  // the next touch, in view widths; when it may next touch them and when it last moved, on the
  // input's clock. The steps and the waits vary a little, so the touches never tick like a
  // clock.
  let slid = 0, next = STEP, ready = -Infinity, moved = -Infinity, turn = 0;

  // layers: those drawn at time; touch: where the pointer is on the wall ({ at, reach of a
  // fingertip }) with how far it moved since the last frame, in view widths, and its speed,
  // in view widths per second, or null; view: the wall in view, in metres; clock: the input's
  // clock.
  return function hear({ layers, touch, time, view, clock }) {
    if (!touch || !(touch.moved > 1e-4)) return [];
    if (clock - moved > REST) slid = next - START;
    moved = clock;
    slid += touch.moved;
    if (slid < next || clock < ready) return [];
    let found = null, gap = touch.reach;
    for (const L of layers) {
      const [i, edge] = under(L, touch.at[0], touch.at[1], gap, time);
      if (i >= 0) { found = [L, i]; gap = edge; }
    }
    if (!found) return [];
    const [L, i] = found, d = L.data, o = i * STRIDE;
    turn++;
    slid = 0;
    next = STEP * (0.7 + 0.6 * fract(turn * 0.754));
    ready = clock + GAP * (0.8 + 0.4 * fract(turn * 0.437));
    return [{
      kind: 'touch', material: NAMES[Math.round(d[o + 15])] || 'glass', size: stonesOf(L).size[i],
      strength: (0.45 + 0.55 * Math.min(1, touch.speed / PACE)) * (0.85 + 0.15 * fract(turn * 0.618)),
      x: (d[o] - (view.x - view.w / 2)) / view.w, y: (view.y + view.h / 2 - d[o + 1]) / view.h
    }];
  };
}
