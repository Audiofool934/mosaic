// The bar at the top of the page: a slab of dark stone with a thin gold rim, set apart from
// the edges, with the page's sections named in stone type. The section in view is inlaid in
// gold, and the gold flows from one name to the next as the page moves. Its millimetres are
// CSS pixels: it has a canvas of its own, drawn at the screen's full resolution, so stones a
// few pixels across keep their shape.
import { poly } from "../engine/paint.js";
import { config as house } from "../examples/nocturne.js";
import { ROWS, typeCells, typeShape, typeWidth } from "../examples/type.js";

// The sections, by the id of the element each one starts at.
export const ITEMS = [
  { text: "HOME", name: "Home", id: "top" },
  { text: "METHOD", name: "Method", id: "method" },
  { text: "MATERIALS", name: "Materials", id: "materials" },
  { text: "WORK", name: "Work", id: "work" },
  { text: "USE IT", name: "Use it", id: "use" }
];

// The largest cell, in pixels, the smallest that still keeps every letter's shape, and the
// space between names, between rows, and round them, in cells. On a narrow screen the names
// close up, and where that would make the cells too small they go on two rows.
const CELL = 3.2, LEGIBLE = 2.4, GAP = 12, NARROW_GAP = 7, ROW_GAP = 3, PAD_X = 9, PAD_Y = 3.6;

// The bar for a screen `room` pixels wide: its cell, its size, and where each name sits.
export function barLayout(room) {
  const across = (row, gap) => row.reduce((n, it) => n + typeWidth(it.text, 1), 0) + gap * (row.length - 1);
  const fit = (rows, gap) => {
    const widest = Math.max(...rows.map((row) => across(row, gap)));
    return { rows, gap, widest, cell: Math.min(CELL, room / (widest + 2 * PAD_X)) };
  };
  let set = fit([ITEMS], GAP);
  if (set.cell < CELL) set = fit([ITEMS], NARROW_GAP);
  if (set.cell < LEGIBLE) set = fit([ITEMS.slice(0, 3), ITEMS.slice(3)], NARROW_GAP);
  const { cell, gap, widest, rows } = set;
  // Every name starts on a whole cell, so all of them lie on one grid of stones, each row
  // centred on the widest.
  const items = rows.flatMap((row, r) => {
    let x = PAD_X + Math.floor((widest - across(row, gap)) / 2);
    return row.map((it) => {
      const at = { ...it, x: x * cell, y: (PAD_Y + r * (ROWS + ROW_GAP)) * cell, w: typeWidth(it.text, cell) };
      x += typeWidth(it.text, 1) + gap;
      return at;
    });
  });
  const W = Math.round((widest + 2 * PAD_X) * cell), H = Math.round((rows.length * ROWS + (rows.length - 1) * ROW_GAP + 2 * PAD_Y) * cell);
  return { cell, W, H, radius: Math.round(Math.min(H, (ROWS + 2 * PAD_Y) * cell) * 0.3), top: PAD_Y * cell, row: (ROWS + ROW_GAP) * cell, items };
}

const rounded = (x, y, w, h, r) => {
  const p = new Path2D();
  p.roundRect(x, y, w, h, r);
  return p;
};

function picture(bar, regions, draw) {
  const { W, H } = bar;
  return {
    // The bar rests between steps, so its mortar dries the moment a stone is set: wet lime
    // would otherwise shine on round each name for good. Its camera is a pinhole, since it is
    // only a few centimetres from the stones and any lens would blur the gold in flight.
    config: { panel: { w: W, h: H }, res: 4, background: regions[0].name, camera: { keys: [[0, W / 2, H / 2, W]], tilt: 0, yaw: 0, aperture: 1e-6, drift: 0 }, light: { ...house.light, wet: [0.02, 0.05] }, sinopia: false },
    regions: () => regions,
    draw(g, mode, D) {
      D.fill(poly([[-10, -10], [W + 10, -10], [W + 10, H + 10], [-10, H + 10]]), "none", "#bdb3a2");
      draw(D);
    }
  };
}

// The slab, its rim, and every name in marble.
export function platePicture(bar) {
  const { W, H, cell, radius, top, items } = bar, rim = Math.max(1.4, cell * 0.7);
  return picture(bar, [
    { name: "plate", size: cell * 1.7, mode: "contour", mat: "basalt", tray: ["#0b181d", "#10222a", "#152b33"] },
    { name: "rim", size: rim, mode: "contour", mat: "gold", tray: ["#b18a50", "#c99d5c", "#d8b571"] },
    { name: "type", size: cell, mode: "grid", origin: [0, top], mat: "marble", tray: ["#d9d6c4", "#e6e1cc", "#efe9d6"] }
  ], (D) => {
    D.fill(rounded(0, 0, W, H, radius), "rim", "#c99d5c");
    D.fill(rounded(rim, rim, W - 2 * rim, H - 2 * rim, radius - rim), "plate", "#10222a");
    for (const it of items) D.fill(typeShape(typeCells(it.text, it.x, it.y, cell), cell), "type", "#e6e1cc");
  });
}

// One name in gold, over its marble.
export function goldPicture({ index, ...bar }) {
  const it = bar.items[index];
  // On the same grid as the marble, so each gold stone covers a marble one exactly.
  return picture(bar, [{ name: "gilt", size: bar.cell, mode: "grid", origin: [0, bar.top], mat: "gold", tray: ["#d2a95f", "#e3bd76", "#f0d08e"] }], (D) => {
    D.fill(typeShape(typeCells(it.text, it.x, it.y, bar.cell), bar.cell), "gilt", "#e3bd76");
  });
}

// Each step of the gold from one name to the next: STEP seconds, flying from LEAD after the
// last rest, since a flow starts each stone a few hundredths early or late, until FLY.
const STEP = 0.9, LEAD = 0.08, FLY = 0.75, START = 1;

// The bar's film: the slab, laid from its middle when `laid`, and the gold, first on the
// first name and then flowing to each next one in turn, so playing the film to rest(i) puts
// the gold on name i. `module` is this module's URL, so workers can cut the pictures.
export function barFilm(bar, { module, laid, band }) {
  const n = bar.items.length, rest = (i) => START + i * STEP, end = rest(n - 1) + 0.1;
  const arrive = laid ? { type: "laid", bed: 0, build: { origin: [bar.W / 2, bar.H / 2], start: 0.05, end: START - 0.2 } } : { type: "settled" };
  const gold = bar.items.map((it, i) => ({
    id: `gold-${i}`,
    picture: { module, export: "goldPicture", args: { ...bar, index: i } },
    start: i ? rest(i - 1) : 0,
    end: i < n - 1 ? rest(i + 1) : end,
    at: [0, 0],
    front: true,
    in: i ? { type: "flow", launch: [rest(i - 1) + LEAD, rest(i - 1) + LEAD + 0.2], land: [rest(i - 1) + LEAD + 0.25, rest(i - 1) + FLY], focus: [it.x + it.w / 2, it.y + (ROWS * bar.cell) / 2] } : arrive
  }));
  const project = {
    version: 1, title: "The bar", seed: 7, fps: [60, 1], frames: Math.ceil(end * 60) + 1, band,
    scenes: [{ id: "plate", picture: { module, export: "platePicture", args: bar }, start: 0, end, at: [0, 0], in: arrive }, ...gold]
  };
  return { project, rests: bar.items.map((_, i) => rest(i)) };
}
