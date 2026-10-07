// A slab: the page's words are set on slabs of black glass with a thin gold rim, like the bar,
// each a picture of its own whose millimetres are CSS pixels. Its headings and labels are set
// in stone type over the glass, in marble or in gold; a well is a recess of darker glass in a
// gold rim, under a button or a block of code; and a rule is a line of gold. The words
// themselves stay on the page, over the stones. This module draws the pictures, so workers
// can cut them; home/slabs.js sets them on the page.
import { poly } from "../engine/paint.js";
import { config as house } from "../examples/nocturne.js";
import { ROWS, typeCells, typeShape, typeWidth } from "../examples/type.js";

// Cells between two lines of stone type.
export const ROW_GAP = 3;

// The block lines of stone type take, set in cells `cell` pixels across.
export function typeBlock(lines, cell) {
  const w = Math.max(...lines.map((line) => typeWidth(line, cell)));
  return { w, h: (lines.length * ROWS + (lines.length - 1) * ROW_GAP) * cell };
}

const rounded = (x, y, w, h, r) => {
  const p = new Path2D();
  p.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  return p;
};
const box = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

const GLASS = ["#07090c", "#0b0f13", "#10151b"];
const WELL = ["#040608", "#07090c", "#0a0d11"];
const GOLD = ["#b18a50", "#c99d5c", "#d8b571"];
const MARBLE = ["#d9d6c4", "#e6e1cc", "#efe9d6"];
const GILT = ["#d2a95f", "#e3bd76", "#f0d08e"];

// slab: its size and corner radius, the width of its rim and of its glass stones, and what is
// set on it, each placed from its top left corner: type { lines, x, y, cell, gold, centre,
// well }, wells { x, y, w, h, r }, and rules { x, y, w, h }. Type set in a well lies on the
// well's darker glass.
export function slabPicture({ w, h, radius, rim, glass, types = [], wells = [], rules = [] }) {
  const finest = Math.min(rim, glass, ...types.map((t) => t.cell));
  // Ten raster pixels to the finest cell, within the limits of a picture's raster.
  const res = Math.min(4, Math.max(2, 10 / finest), 8190 / w, 8190 / h, Math.sqrt(30e6 / (w * h)));
  const regions = [
    { name: "plate", size: glass, mode: "contour", mat: "glass", tray: GLASS },
    { name: "rim", size: rim, mode: "contour", mat: "gold", tray: GOLD },
    { name: "well", size: glass * 0.8, mode: "contour", mat: "glass", tray: WELL },
    ...types.flatMap((t, i) => [
      // The glass round the letters is laid on the letters' own grid, a stone to each cell,
      // so no stone of the plate's courses strays among them.
      { name: `ground-${i}`, size: t.cell, mode: "grid", origin: [t.x, t.y], mat: "glass", tray: t.well ? WELL : GLASS },
      { name: `type-${i}`, size: t.cell, mode: "grid", origin: [t.x, t.y], mat: t.gold ? "gold" : "marble", tray: t.gold ? GILT : MARBLE }
    ])
  ];
  return {
    // A slab rests, so its mortar dries the moment a stone is set, and its camera is a pinhole,
    // as the bar's is.
    config: {
      panel: { w, h }, res, background: "plate",
      camera: { keys: [[0, w / 2, h / 2, w]], tilt: 0, yaw: 0, aperture: 1e-6, drift: 0 },
      light: { ...house.light, wet: [0.02, 0.05] }, sinopia: false
    },
    regions: () => regions,
    draw(g, mode, D) {
      D.fill(box(-10, -10, w + 20, h + 20), "none", "#bdb3a2");
      D.fill(rounded(0, 0, w, h, radius), "rim", "#c99d5c");
      D.fill(rounded(rim, rim, w - 2 * rim, h - 2 * rim, radius - rim), "plate", "#0b0f13");
      const edge = rim * 0.8;
      for (const s of wells) {
        D.fill(rounded(s.x, s.y, s.w, s.h, s.r), "rim", "#c99d5c");
        D.fill(rounded(s.x + edge, s.y + edge, s.w - 2 * edge, s.h - 2 * edge, s.r - edge), "well", "#07090c");
      }
      for (const r of rules) D.fill(box(r.x, r.y, r.w, r.h), "rim", "#c99d5c");
      types.forEach((t, i) => {
        const widest = Math.max(...t.lines.map((line) => typeWidth(line, 1)));
        const { h: high } = typeBlock(t.lines, t.cell);
        D.fill(box(t.x - t.cell, t.y - t.cell, (widest + 2) * t.cell, high + 2 * t.cell), `ground-${i}`, t.well ? "#07090c" : "#0b0f13");
        t.lines.forEach((line, k) => {
          // A centred line still starts on a whole cell, so every line keeps to one grid.
          const dx = t.centre ? Math.floor((widest - typeWidth(line, 1)) / 2) * t.cell : 0;
          const cells = typeCells(line, t.x + dx, t.y + k * (ROWS + ROW_GAP) * t.cell, t.cell);
          D.fill(typeShape(cells, t.cell), `type-${i}`, t.gold ? "#e3bd76" : "#e6e1cc");
        });
      });
    }
  };
}
