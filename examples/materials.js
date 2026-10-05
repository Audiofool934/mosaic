// A sample board: one square for each material, with a small medallion so the
// courses have an edge to follow. The camera visits one square per second.
import { circle, poly } from "../engine/paint.js";

const SIDE = 220;
const box = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

export const SAMPLES = [
  { name: "glass", mat: "glass", field: ["#163f52", "#1f5268", "#2b6a80", "#3f8597"], disc: ["#4f97a3", "#6eb0b4", "#92c5c0"] },
  { name: "gold", mat: "gold", field: ["#a77c3d", "#bd9150", "#cfa663", "#e0bb78"], disc: ["#b88838", "#c99a48", "#d8ab5a"] },
  { name: "silver", mat: "silver", field: ["#a3a9aa", "#b5babb", "#c6cbcb", "#d5d9d8"], disc: ["#dfe2e0", "#e8eae7", "#f1f2ef"] },
  { name: "marble", mat: "marble", field: ["#cbc5b6", "#d8d2c3", "#e3ded0", "#ece8dc"], disc: ["#b7b9ad", "#c6c8bc", "#d4d5ca"] },
  { name: "basalt", mat: "basalt", field: ["#192225", "#212c30", "#2a373a", "#344240"], disc: ["#3c4a48", "#475652", "#53625c"] },
  { name: "limestone", mat: "limestone", field: ["#b4a68b", "#c4b698", "#d2c4a5", "#ddd0b2"], disc: ["#a5967a", "#b3a486", "#c1b292"] },
  { name: "terracotta", mat: "terracotta", field: ["#7d4330", "#93533a", "#a66245", "#b57352"], disc: ["#c4855f", "#cf966f", "#d9a77f"] },
  { name: "light", mat: "glass", field: ["#1b2a33", "#22343e", "#2b3f49", "#344b55"], disc: [{ hex: "#b4601c", mat: "emit", emit: 1.2 }, { hex: "#c47228", mat: "emit", emit: 1.2 }, { hex: "#d38636", mat: "emit", emit: 1.2 }] }
];

export const config = {
  panel: { w: SIDE * SAMPLES.length, h: SIDE },
  res: 2,
  background: "glass",
  camera: {
    keys: SAMPLES.map((_, i) => [i, SIDE * i + SIDE / 2, SIDE / 2, 200]),
    tilt: 0, yaw: 0, aperture: 0.01, drift: 0
  },
  light: {
    key: { az: 128, el: 30, color: [1, 0.9, 0.74], power: 1.1 },
    fill: { az: -40, el: 40, color: [0.66, 0.79, 1], power: 0.34 },
    sky: [0.12, 0.15, 0.19], ground: [0.05, 0.042, 0.028],
    exposure: 0.5, grout: "#4a5352", wet: [0.18, 1.0],
    // A lamp travels with the camera and rakes each sample from the upper left.
    points: [{ x: SAMPLES.map((_, i) => [i, SIDE * i + 40]), y: 30, z: 150, color: "#ffe2b8", power: 0.05 }]
  }
};

export function regions() {
  return SAMPLES.flatMap((s, i) => [
    { name: s.name, size: 11, mode: "contour", mat: s.mat, tray: s.field },
    { name: `${s.name}-disc`, size: 7.5, mode: "radial", center: [SIDE * i + SIDE / 2, SIDE / 2], mat: s.mat, tray: s.disc }
  ]);
}

export function draw(g, mode, D) {
  SAMPLES.forEach((s, i) => {
    const x = SIDE * i;
    D.fill(box(x, 0, SIDE, SIDE), s.name, s.field[2]);
    const hex = typeof s.disc[1] === "string" ? s.disc[1] : s.disc[1].hex;
    D.fill(circle(x + SIDE / 2, SIDE / 2, 58), `${s.name}-disc`, hex);
  });
}
