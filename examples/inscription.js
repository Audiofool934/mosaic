// The name set in stone: white marble capitals with the AI inside them inlaid in gold, each
// ringed by dark stone. The letters are drawn as shapes in letters.js, so the word is cut the
// same everywhere. The name is a picture of its letters only, set in front of scenes that
// leave a hole the same shape, so it stays put while they flow into one another behind it.
import { poly } from "../engine/paint.js";
import { word, wordWidth } from "./letters.js";
import { config as house } from "./nocturne.js";

const box = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

// How much of a panel's width the name may take, its tallest capitals in millimetres, and
// where its middle sits as a share of the first screen's height.
const WIDTH = 0.84;
const TALLEST = 300;
const MIDDLE = 0.47;

// Where the name is set on a panel `w` wide whose first screen is `screen` high: one line
// across, as large as fits, with the AI in gold, so the word reads whole on any screen, a
// phone's included. The ring of dark stone round each letter keeps it clear of any scene
// behind it.
export function nameAt(w, screen) {
  const middle = screen * MIDDLE;
  const cap = Math.min(TALLEST, (w * WIDTH) / wordWidth("MOSAIC"));
  return { cap, ring: cap * 0.09, middle, lines: [{ text: "MOSAIC", x: w / 2, y: middle + cap / 2, gilt: [3, 4] }] };
}

const lettersOf = (set) => set.lines.flatMap((line) => word(line.text, { x: line.x, y: line.y, cap: set.cap }).map((l, i) => ({ ...l, gilt: line.gilt.includes(i) })));

// Clears the name and its ring of dark stone from a scene, so the name's own picture shows.
export function nameHole(D, set) {
  for (const { path } of lettersOf(set)) {
    D.line(path, set.ring, "none", "#bdb3a2");
    D.fill(path, "none", "#bdb3a2");
  }
}

// The name alone, as a picture `w` by `h` millimetres whose first screen is `screen` high:
// its letters set as `nameAt` places them, each ringed first by dark stone, and nothing else.
// Their stones are sized to the letters, so every stroke is about six stones across at any
// size, and they are laid straight onto the bare plaster, with no sinopia drawn first.
export function nameAlone({ w, h, screen = h }) {
  const set = nameAt(w, screen);
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
