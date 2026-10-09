// An original drawing for mosAIc: currents of glass, marble, clay, and a thread of gold
// sweeping across a tall panel, as in the page's abstract of currents, set the same way in every
// stretch of it. The project page shows it on a phone as the method's picture, in four bands
// down it: a flat drawing, courses, cut stones, and the wall's own stones. Every band holds the
// same run of currents, so from one band to the next only the stage changes.
import { poly } from "../engine/paint.js";
import { config as house } from "./nocturne.js";

// Where each band ends down the panel, in millimetres; the fourth runs on to its foot, 800.
export const BANDS = [200, 400, 600];
const W = 450, H = 800;

export const config = {
  panel: { w: W, h: H },
  res: 2,
  background: "teal",
  camera: { keys: [[0, W / 2, H / 2, W], [8, W / 2, H / 2, W]], tilt: 0, yaw: 0, aperture: 0.014, drift: 0 },
  light: house.light,
  sinopia: false
};

export function regions() {
  return [
    { name: "teal", size: 13, mode: "contour", mat: "glass", tray: ["#0f2e3e", "#123447", "#173d52", "#1d4659"] },
    { name: "cream", size: 11, mode: "contour", mat: "marble", tray: ["#ddd2b8", "#e9dfc6", "#f2e9d3"] },
    { name: "ochre", size: 12, mode: "contour", mat: "terracotta", tray: ["#b06b3a", "#c27a43", "#d18c52"] },
    { name: "gilt", size: 6, mode: "contour", mat: "gold", tray: ["#c79f58", "#dbb46c", "#eac884"] },
    { name: "rust", size: 12, mode: "contour", mat: "terracotta", tray: ["#863f2c", "#9a4e35", "#ad5f40"] },
    { name: "sea", size: 12, mode: "contour", mat: "glass", tray: ["#2f6c74", "#3f7f86", "#55939a"] }
  ];
}

// One run of currents, a band high, and how thick each is, in millimetres. Each band's edge
// cuts across the middle of its teal, the broadest current, never along the edge between two.
const RUN = [["teal", 50], ["cream", 30], ["ochre", 40], ["gilt", 9], ["rust", 33], ["sea", 38]];

// The edge between two currents, the j-th of band n: a long, slow wave across the panel, every
// 10 mm, each a little further along its swing than the one above it.
function edge(y, n, j) {
  const pts = [];
  for (let x = -20; x <= W + 20; x += 10) {
    const u = (x / 430) * 6.2832 + 0.6 + j * 0.42 + n * 0.9;
    pts.push([x, y + 13 * Math.sin(u) + 4.5 * Math.sin(u * 2.3 + 1.7)]);
  }
  return pts;
}

export function draw(g, mode, D) {
  D.fill(poly([[-20, -20], [W + 20, -20], [W + 20, H + 20], [-20, H + 20]]), "teal", null);
  for (let n = 0; n * BANDS[0] < H; n++) {
    let y = n * BANDS[0] + RUN[0][1] / 2, top = edge(y, n, 0);
    RUN.slice(1).forEach(([name, thick], j) => {
      const bottom = edge((y += thick), n, j + 1);
      D.fill(poly([...top, ...[...bottom].reverse()]), name, null);
      top = bottom;
    });
  }
}
