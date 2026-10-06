// The name set in stone: white marble capitals with the AI inside them inlaid in gold, each
// ringed by dark stone, and under it a line in stone type. The letters are drawn as shapes in
// letters.js, so the word is cut the same everywhere. The name and its line are pictures of
// their letters only, set in front of scenes that leave a hole the same shape, so they stay
// put while the scenes flow into one another behind them.
import { poly } from "../engine/paint.js";
import { word, wordWidth } from "./letters.js";
import { config as house } from "./nocturne.js";
import { ROWS, typeCells, typeShape, typeWidth } from "./type.js";

const box = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

// How much of a panel's width the name may take, its tallest capitals in millimetres, where
// its middle sits as a share of the first screen's height, and how high the band is that
// the scenes keep clear for it, as a share of the same.
const WIDTH = 0.84;
const TALLEST = 300;
const MIDDLE = 0.47;
const BAND = 0.62;

// The line set under the name, on one line or, under MOS over AIC, on two.
const TAGLINE = "FROM A PROMPT TO STONE";
const TAGLINES = ["FROM A PROMPT", "TO STONE"];

// Where the name is set on a panel `w` wide whose first screen is `screen` high: one line
// across, or on a tall panel MOS over AIC, as large as fits, with the AI in gold either way,
// around the same middle. The ring of dark stone round each letter keeps it clear of any
// scene behind it. Its line follows a little below, in stone type ringed the same way.
export function nameAt(w, screen, stack = w < screen) {
  const middle = screen * MIDDLE;
  if (!stack) {
    const cap = Math.min(TALLEST, (w * WIDTH) / wordWidth("MOSAIC"));
    const y = middle + cap / 2;
    return { cap, ring: cap * 0.09, middle, lines: [{ text: "MOSAIC", x: w / 2, y, gilt: [3, 4] }], tag: tagline([TAGLINE], w, y + cap * 0.17, Math.min(cap * 0.02, (w * WIDTH) / typeWidth(TAGLINE, 1))) };
  }
  const gap = 0.28;
  const cap = Math.min(TALLEST, (w * WIDTH) / Math.max(wordWidth("MOS"), wordWidth("AIC")), (screen * BAND) / (2 + gap));
  const top = middle - cap * (1 + gap / 2), y = top + cap * (2 + gap);
  const across = Math.max(...TAGLINES.map((t) => typeWidth(t, 1)));
  return { cap, ring: cap * 0.09, middle, lines: [{ text: "MOS", x: w / 2, y: top + cap, gilt: [] }, { text: "AIC", x: w / 2, y, gilt: [0, 1] }], tag: tagline(TAGLINES, w, y + cap * 0.17, Math.min(cap * 0.03, (w * WIDTH) / across)) };
}

// Lines of stone type in cells `cell` wide, centred on a panel `w` wide, the first with its
// top at `top`, in a box a cell wider all round, on a grid of cells from the box's corner.
function tagline(lines, w, top, cell) {
  const across = Math.max(...lines.map((text) => typeWidth(text, 1)));
  const frame = { x: w / 2 - (across / 2 + 1) * cell, y: top - cell, w: (across + 2) * cell, h: (lines.length * (ROWS + 3) - 1) * cell };
  const cells = lines.flatMap((text, i) => typeCells(text, frame.x + (1 + Math.floor((across - typeWidth(text, 1)) / 2)) * cell, frame.y + (1 + i * (ROWS + 3)) * cell, cell));
  return { cell, ring: cell * 0.4, cells, frame };
}

const lettersOf = (set) => set.lines.flatMap((line) => word(line.text, { x: line.x, y: line.y, cap: set.cap }).map((l, i) => ({ ...l, gilt: line.gilt.includes(i) })));

// Clears the name, its line, and their rings of dark stone from a scene, so the name's own
// picture shows.
export function nameHole(D, set) {
  for (const { path } of lettersOf(set)) {
    D.line(path, set.ring, "none", "#bdb3a2");
    D.fill(path, "none", "#bdb3a2");
  }
  D.fill(typeShape(set.tag.cells, set.tag.cell, 1 + (2 * set.tag.ring) / set.tag.cell), "none", "#bdb3a2");
}

// The name alone, as a picture `w` by `h` millimetres whose first screen is `screen` high:
// its letters set as `nameAt` places them, each ringed first by dark stone, and nothing else.
// Their stones are sized to the letters, so every stroke is about six stones across at any
// size, and they are laid straight onto the bare plaster, with no sinopia drawn first.
export function nameAlone({ w, h, screen = h, stack }) {
  const set = nameAt(w, screen, stack);
  const s = set.cap * 0.03;
  return {
    config: { panel: { w, h }, res: 1, background: "outline", camera: { keys: [[0, w / 2, h / 2, w]], tilt: 0, yaw: 0, aperture: 0.004, drift: 0 }, light: house.light, sinopia: false },
    regions: () => [
      { name: "outline", size: s * 0.8, mode: "contour", mat: "basalt", tray: ["#0a171c", "#0f2228", "#132a31"] },
      { name: "marble", size: s, mode: "contour", mat: "marble", tray: ["#cfd2c2", "#e0dec4", "#ece6d0", "#f4eedb"] },
      { name: "gold", size: s * 0.9, mode: "contour", mat: "gold", tray: ["#c79f58", "#dbb46c", "#eac884", "#f7dfa0"] }
    ],
    draw(g, mode, D) {
      D.fill(box(-10, -10, w + 20, h + 20), "none", "#bdb3a2");
      const letters = lettersOf(set);
      for (const { path } of letters) D.line(path, set.ring, "outline", "#0f2228");
      for (const { path, gilt } of letters) D.fill(path, gilt ? "gold" : "marble", gilt ? "#dbb46c" : "#ece6d0");
    }
  };
}

// The line under the name alone, as a picture of its box, to be set at the box's corner on
// a panel `w` wide whose first screen is `screen` high: each cell of its letters one marble
// stone, ringed with dark stone, cut finely, since its stones are small.
export function taglineAlone({ w, h, screen = h, stack }) {
  const { cell, ring, cells, frame } = nameAt(w, screen, stack).tag;
  const own = cells.map(([x, y]) => [x - frame.x, y - frame.y]);
  return {
    config: { panel: { w: frame.w, h: frame.h }, res: 4, background: "tag-ring", camera: { keys: [[0, frame.w / 2, frame.h / 2, frame.w]], tilt: 0, yaw: 0, aperture: 0.004, drift: 0 }, light: house.light, sinopia: false },
    regions: () => [
      { name: "tag-ring", size: cell * 0.8, mode: "contour", mat: "basalt", tray: ["#0a171c", "#0f2228", "#132a31"] },
      { name: "tag", size: cell, mode: "grid", mat: "marble", tray: ["#d9d6c4", "#e6e1cc", "#efe9d6"] }
    ],
    draw(g, mode, D) {
      D.fill(box(-10, -10, frame.w + 20, frame.h + 20), "none", "#bdb3a2");
      D.fill(typeShape(own, cell, 1 + (2 * ring) / cell), "tag-ring", "#0f2228");
      D.fill(typeShape(own, cell), "tag", "#e6e1cc");
    }
  };
}
