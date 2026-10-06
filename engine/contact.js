// Contacts: the stones the pointer sets off as it slides over the wall, for sound. Like a
// handful of small stones poured onto a table, a sliding fingertip sets off a few stones near
// its path for every little distance it covers, the first as soon as it moves, each with the
// material of the stone it lands on. Live input only; exports never produce contacts.
import { MATERIALS } from './picture.js';
import { TEXELS } from './renderer.js';
import { rng } from './util.js';

const NAMES = Object.fromEntries(Object.entries(MATERIALS).map(([name, id]) => [id, name]));
const STRIDE = TEXELS * 4;
// Grid cells for finding the stones near the pointer, and the size of the largest stone, in
// metres.
const CELL = 0.06;
const LARGEST = 0.03;
// A fingertip sets off DENSITY stones for each view width it slides, at most RATE a second, and
// one as soon as it has slid START after resting for REST seconds, so a hand that only trembles
// is not heard. The stones lie within SPREAD fingertip reaches of its path, and a slide of PACE
// view widths a second sets them off at full strength.
const DENSITY = 70;
const RATE = 60;
const START = 0.0025;
const REST = 0.25;
const SPREAD = 3;
const PACE = 1;

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
  // How many stones the slide owes and how many it may set off now, which grows by RATE a
  // second; when the pointer last moved, on the input's clock; and where each stone lies.
  let owed = 0, allowed = 0, moved = -Infinity;
  const R = rng(1093);

  // layers: those drawn at time; touch: the pointer's path on the wall since the last frame
  // ({ from, at, reach of a fingertip }), how far it moved, in view widths, how long that took,
  // in seconds, and its speed, in view widths per second, or null; view: the wall in view, in
  // metres; clock: the input's clock.
  return function hear({ layers, touch, time, view, clock }) {
    if (!touch || !(touch.moved > 1e-4)) return [];
    const resting = clock - moved > REST;
    if (resting) { owed = 1 - START * DENSITY; allowed = 1; }
    moved = clock;
    owed = Math.min(owed + touch.moved * DENSITY, 2);
    allowed = Math.min(allowed + RATE * touch.dt, 3);
    const events = [], strength = 0.4 + 0.6 * Math.min(1, touch.speed / PACE), spread = touch.reach * SPREAD;
    for (; owed >= 1 && allowed >= 1; owed--, allowed--) {
      // Somewhere along this frame's path, or where it began for the first stone after a rest,
      // heard as the pointer passed it.
      const u = resting && !events.length ? 0 : R(), a = R() * 2 * Math.PI, r = spread * Math.sqrt(R());
      const x = touch.from[0] + (touch.at[0] - touch.from[0]) * u + r * Math.cos(a);
      const y = touch.from[1] + (touch.at[1] - touch.from[1]) * u + r * Math.sin(a);
      let found = null, gap = touch.reach;
      for (const L of layers) {
        const [i, edge] = under(L, x, y, gap, time);
        if (i >= 0) { found = [L, i]; gap = edge; }
      }
      if (!found) continue;
      const [L, i] = found, d = L.data, o = i * STRIDE;
      events.push({
        kind: 'touch', material: NAMES[Math.round(d[o + 15])] || 'glass', size: stonesOf(L).size[i], strength, delay: u * touch.dt,
        x: (d[o] - (view.x - view.w / 2)) / view.w, y: (view.y + view.h / 2 - d[o + 1]) / view.h
      });
    }
    return events.sort((p, q) => p.delay - q.delay);
  };
}
