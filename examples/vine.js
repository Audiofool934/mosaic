// An original drawing for mosAIc: a vine scroll, the running ornament of Roman and Byzantine
// mosaic, set upright on a tall panel of deep blue glass. A gold stem winds down the panel, and
// at each swing a tendril curls off into the space the stem leaves and spirals in to a rosette.
// The project page shows it on a phone as the method's picture, in four bands down it: a flat
// drawing, courses, cut stones, and the wall's own stones. Each band holds one swing of the
// stem and its rosette, so the bands are alike, and the stem runs on unbroken through all four.
import { circle, poly, ribbon, smoothLine, stroke } from "../engine/paint.js";
import { config as house } from "./nocturne.js";

// Where each band ends down the panel, in millimetres; the fourth runs on to its foot, 960.
export const BANDS = [240, 480, 720];
const W = 450, H = 960;

export const config = {
  panel: { w: W, h: H },
  res: 2,
  background: "ground",
  camera: { keys: [[0, W / 2, H / 2, W], [8, W / 2, H / 2, W]], tilt: 0, yaw: 0, aperture: 0.014, drift: 0 },
  light: house.light,
  sinopia: false
};

// The stem: how far it swings either side of the middle, and how far down it runs for each
// swing there and back, so it swings out once in each band, furthest at the band's middle.
const SWING = 70, WAVE = 480;
const stemAt = (y) => W / 2 + SWING * Math.sin((2 * Math.PI * y) / WAVE);

// Each swing's rosette: in the middle of its band, in the hollow the stem leaves on its far
// side, and its radius. A tendril's spiral is a little wider than it is tall, SQUAT, so it
// fills the hollow and keeps clear of the stem where it crosses the middle.
const ROSE = 50, SQUAT = 0.8;
const ROSES = BANDS.concat(H).map((end) => {
  const y = end - BANDS[0] / 2, side = Math.sign(stemAt(y) - W / 2);
  return { x: W / 2 - side * 77, y, side };
});

export function regions() {
  return [
    { name: "ground", size: 12, mode: "contour", mat: "glass", tray: ["#0e2331", "#122a3a", "#163243", "#1a3a4c"] },
    { name: "stem", size: 6, mode: "contour", mat: "gold", tray: ["#b18a50", "#c99d5c", "#d8b571", "#efcf91"] },
    { name: "leaf", size: 7, mode: "contour", mat: "glass", tray: ["#356452", "#41735d", "#4f8064", "#628f6f"] },
    { name: "vein", size: 3.5, mode: "contour", mat: "gold", tray: ["#c99d5c", "#d8b571"] },
    { name: "petal", size: 5.5, mode: "contour", mat: "marble", tray: ["#ddd2b8", "#e9dfc6", "#f2e9d3"] },
    { name: "clay", size: 5, mode: "contour", mat: "terracotta", tray: ["#9a4e35", "#ad5f40", "#c27a43"] },
    ...ROSES.map((r, i) => ({ name: `heart-${i}`, size: 4.5, mode: "radial", center: [r.x, r.y], mat: "gold", tray: ["#c99d5c", "#d8b571", "#efcf91"] }))
  ];
}

// A pointed blade from its base along `angle`, `long` and at most `wide` across: a leaf, with
// a rib of gold, or a petal.
function blade(x, y, angle, long, wide) {
  const c = Math.cos(angle), s = Math.sin(angle), at = (u, v) => [x + u * c - v * s, y + u * s + v * c];
  const side = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    side.push([t * long, (wide / 2) * Math.sin(Math.PI * t) ** 0.85 * (1 - 0.25 * t)]);
  }
  return { path: poly([...side.map(([u, v]) => at(u, v)), ...side.slice(1, -1).reverse().map(([u, v]) => at(u, -v))]), at };
}
function leaf(D, x, y, angle, long, wide) {
  const { path, at } = blade(x, y, angle, long, wide);
  D.fill(path, "leaf", "#4f8064");
  D.fill(stroke([at(2, 0), at(long * 0.5, 0), at(long * 0.86, 0)], 2.6, 1), "vein", "#d8b571");
}

export function draw(g, mode, D) {
  D.fill(poly([[-20, -20], [W + 20, -20], [W + 20, H + 20], [-20, H + 20]]), "ground", D.linear(0, 0, 0, H, [[0, "#163243"], [1, "#122a3a"]]));

  // Leaves come off the stem first, so the stem lies over their bases: two reaching out past
  // each swing toward the panel's edge, and a pair where the stem crosses the middle.
  for (const r of ROSES) {
    const out = r.side > 0 ? 0 : Math.PI, x = stemAt(r.y);
    leaf(D, x, r.y - 8, out - r.side * 0.6, 92, 36);
    leaf(D, x, r.y + 10, out + r.side * 0.55, 70, 28);
  }
  for (const y of [0, ...BANDS, H]) {
    const dir = Math.sign(Math.cos((2 * Math.PI * y) / WAVE));
    leaf(D, W / 2, y, dir > 0 ? -2.2 : 2.2 - Math.PI, 54, 22);
    leaf(D, W / 2, y, dir > 0 ? 0.95 : Math.PI - 0.95, 54, 22);
  }

  // The tendrils: each springs from the stem past its swing, heading on the way the stem goes,
  // sweeps under its rosette, up its far side and over it, and curls in to it, thinning.
  for (const r of ROSES) {
    const from = r.y + 64, start = [stemAt(from), from];
    const dx = start[0] - r.x, dy = (start[1] - r.y) / SQUAT;
    const r0 = Math.hypot(dx, dy), r1 = ROSE + 8, a0 = Math.atan2(dy, dx);
    const pts = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40, a = a0 + r.side * t * 2 * Math.PI * 1.02, rad = r1 + (r0 - r1) * (1 - t) ** 1.7;
      pts.push([r.x + rad * Math.cos(a), r.y + SQUAT * rad * Math.sin(a)]);
    }
    D.fill(stroke(pts, 11, 4, 4), "stem", "#c99d5c");
  }

  // The stem, top to bottom, a little thicker where it swings out.
  const line = smoothLine(Array.from({ length: 103 }, (_, k) => [stemAt(k * 10 - 30), k * 10 - 30]), 4);
  D.fill(ribbon(line, line.map(([, y]) => 13 + 3 * Math.abs(Math.sin((2 * Math.PI * y) / WAVE)))), "stem", "#c99d5c");

  // The rosettes: eight pointed petals of marble, eight of clay between them, and a heart of gold.
  ROSES.forEach((r, i) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI;
      D.fill(blade(r.x + ROSE * 0.16 * Math.cos(a), r.y + ROSE * 0.16 * Math.sin(a), a, ROSE * 0.84, ROSE * 0.6).path, "petal", "#e9dfc6");
    }
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * 2 * Math.PI;
      D.fill(blade(r.x + ROSE * 0.16 * Math.cos(a), r.y + ROSE * 0.16 * Math.sin(a), a, ROSE * 0.6, ROSE * 0.42).path, "clay", "#ad5f40");
    }
    D.fill(circle(r.x, r.y, ROSE * 0.3), `heart-${i}`, "#d8b571");
  });
}
