// The score: the stones of a film heard as they land on the wall. A film seats thousands of
// stones a second, far more than can be told apart, so it is heard as a pour is: a few stones
// of every moment, each one a real stone of the film, with its own material, size, moment and
// place in the frame, and louder the more stones land with it. The score follows from the
// film's stones, a time range and a seed alone, so a film sounds the same every time it is
// rendered, and the stones heard in a part of it are those heard there in the whole.
import { MATERIALS } from './picture.js';
import { hash3 } from './util.js';

const NAMES = Object.fromEntries(Object.entries(MATERIALS).map(([name, id]) => [id, name]));
// The floats of one stone, as timeline.js packs them.
const STRIDE = 40;
// At most RATE stones a second are heard, as under the pointer. A pour of FULL stones a second
// or more is heard at full strength, and a single stone at SOFT of it.
export const RATE = 60;
const FULL = 1800;
const SOFT = 0.35;
// A stone that takes less than this long to fall, in seconds, is set in place, not dropped.
const SET = 0.01;

// layers: a film's layers, each with its packed stones in `data` and their `count`; viewAt(t):
// the wall in view at t, as its centre x and y, width w and height h, in metres; from and to:
// the seconds heard, to excluded; seed: the film's. Returns the landings in order, each with
// its time in seconds, the material and size in millimetres of its stone, a strength from 0
// to 1, and x and y across the frame from 0 to 1.
export function scoreLandings(layers, { from = 0, to = Infinity, viewAt, seed = 0 } = {}) {
  // Each moment of the film, a RATE-th of a second long: how many stones land in it, in view,
  // and the one of them that is heard, drawn by lot, each stone holding the same lot whatever
  // range is asked for.
  const moments = new Map(), views = new Map();
  const seen = (m) => {
    if (!views.has(m)) views.set(m, viewAt((m + 0.5) / RATE));
    return views.get(m);
  };
  layers.forEach((L, layer) => {
    const d = L.data;
    for (let i = 0; i < L.count; i++) {
      const o = i * STRIDE, T = d[o + 2];
      // Heard: a stone that lands within the range, falls onto the wall, and stays on it.
      if (!(T >= from && T < to) || d[o + 23] < SET || d[o + 24] <= T) continue;
      const m = Math.floor(T * RATE), v = seen(m);
      if (Math.abs(d[o] - v.x) > v.w / 2 || Math.abs(d[o + 1] - v.y) > v.h / 2) continue;
      const lot = hash3(i, layer, seed), at = moments.get(m);
      if (!at) moments.set(m, { n: 1, layer, stone: i, lot });
      else if (++at.n && lot < at.lot) { at.layer = layer; at.stone = i; at.lot = lot; }
    }
  });
  const events = [];
  for (const m of [...moments.keys()].sort((a, b) => a - b)) {
    const { n, layer, stone } = moments.get(m), d = layers[layer].data, o = stone * STRIDE, v = seen(m);
    // The four corners lie about a side's width over the square root of two from the centre.
    let r = 0;
    for (let k = 0; k < 4; k++) r += Math.hypot(d[o + 4 + k * 2], d[o + 5 + k * 2]);
    events.push({
      kind: 'land', time: d[o + 2], material: NAMES[Math.round(d[o + 15])] || 'glass', size: (r / 4) * Math.SQRT2 * 1000,
      strength: SOFT + (1 - SOFT) * Math.min(1, Math.sqrt((n * RATE) / FULL)), stones: n,
      x: (d[o] - (v.x - v.w / 2)) / v.w, y: (v.y + v.h / 2 - d[o + 1]) / v.h
    });
  }
  return events.sort((a, b) => a.time - b.time);
}
