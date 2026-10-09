// An original drawing for mosAIc: currents of glass, marble, clay, and a thread of gold
// running down a tall panel, as in the page's abstract of currents turned upright. The project
// page shows it on a phone as the method's picture, in four bands down it: a flat drawing,
// courses, cut stones, and the wall's own stones. The currents run on unbroken from the top
// band to the bottom one, so each band holds every current, and each current can be followed
// down through all four stages.
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

// The currents across the panel, left to right, and how wide each is where it starts, in
// millimetres; the last runs on past the right edge.
const ACROSS = [["teal", 80], ["cream", 42], ["ochre", 58], ["gilt", 16], ["rust", 50], ["sea", 62], ["cream", 36], ["ochre", 46], ["teal", 120]];

// The edge between two currents, the j-th from the left, from above the panel to below it,
// every 10 mm: the whole flow sways one way and back as it runs down, and each edge swings a
// little on its own, a little further along its swing than the one before it.
function edge(x, j) {
  const pts = [];
  for (let y = -20; y <= H + 20; y += 10) {
    const u = (y / 560) * 6.2832 + 0.6 + j * 0.3;
    pts.push([x + 24 * Math.sin((y / H) * 6.2832 * 0.55 + 0.4) + 11 * Math.sin(u) + 4 * Math.sin(u * 2.3 + 1.7), y]);
  }
  return pts;
}

export function draw(g, mode, D) {
  let x = -20, left = edge(x, 0);
  ACROSS.forEach(([name, wide], j) => {
    const right = j < ACROSS.length - 1 ? edge((x += wide), j + 1) : [[W + 60, -20], [W + 60, H + 20]];
    D.fill(poly([...left, ...[...right].reverse()]), name, null);
    left = right;
  });
}
