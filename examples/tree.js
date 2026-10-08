// An original drawing for mosAIc: a tree on an island under the moon, tall enough to be read
// top to bottom. The project page shows it on a phone as the method's picture, in four bands
// across it: the moon and the crown's top as a flat drawing, the crown as courses, the fork as
// cut stones, and the island and the water in the wall's own stones.
import { blob, circle, ellipse, poly, ring, stroke } from "../engine/paint.js";

const path = (d) => new Path2D(d);
const box = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

// Where each band ends down the panel, in millimetres; the fourth runs on to its foot, 900.
export const BANDS = [230, 450, 650];

export const config = {
  panel: { w: 450, h: 900 },
  res: 2,
  background: "sky",
  camera: {
    keys: [[0, 225, 450, 450], [8, 225, 450, 450]],
    tilt: 0, yaw: 0, aperture: 0.014, drift: 0
  },
  light: {
    key: { az: 128, el: 28, color: [1, 0.90, 0.73], power: 1.1 },
    fill: { az: -40, el: 40, color: [0.62, 0.78, 1], power: 0.33 },
    sky: [0.11, 0.16, 0.23], ground: [0.045, 0.038, 0.023],
    exposure: 0.45, grout: "#35444b", wet: [0.18, 1.0]
  },
  sinopia: { groups: [["sky", "halo"], ["crown", "leaves", "lit"], ["water", "current", "foam"]] }
};

const MOON = [322, 112];

// A scalloped outline round an ellipse, as leaves bunch along the edge of a crown.
function scallop(cx, cy, rx, ry, lobes, depth, turn = 0) {
  const pts = [];
  for (let i = 0; i < lobes * 4; i++) {
    const a = (i / (lobes * 4)) * Math.PI * 2 + turn;
    const k = 1 + depth * Math.cos(a * lobes * 2 - turn * 3) * 0.5 + depth * 0.25 * Math.sin(a * 3 + turn);
    pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
  }
  return blob(pts);
}

export function regions() {
  return [
    { name: "sky", size: 15, mode: "sky", mat: "glass", tray: ["#142835", "#213f50", "#375766", "#567681"] },
    { name: "star", size: 4, mode: "contour", mat: "emit", emit: 0.9, tray: ["#cfd2c4", "#e8e4d2"] },
    { name: "halo", size: 11, mode: "radial", center: MOON, mat: "glass", tray: ["#466269", "#687b79", "#7f8d82"] },
    { name: "moon", size: 9, mode: "radial", center: MOON, mat: "gold", tray: ["#8d6839", "#b18a50", "#d8b571", "#efcf91"] },
    { name: "crown", size: 12, mode: "contour", mat: "glass", tray: ["#14302b", "#1b3d35", "#234a3f"] },
    { name: "leaves", size: 11, mode: "contour", mat: "glass", tray: ["#2b5547", "#356452", "#41735d"] },
    { name: "lit", size: 10, mode: "contour", mat: "glass", tray: ["#4f8064", "#628f6f", "#79a07c"] },
    { name: "fruit", size: 5, mode: "contour", mat: "gold", tray: ["#b18a50", "#d8b571", "#efcf91"] },
    { name: "trunk", size: 9, mode: "contour", mat: "terracotta", tray: ["#3c2a22", "#4c3529", "#5e4232", "#6f5039"] },
    { name: "hill", size: 12, mode: "contour", mat: "basalt", tray: ["#20343b", "#34484c", "#435659"] },
    { name: "root", size: 6, mode: "contour", mat: "gold", tray: ["#715e3f", "#9f8550", "#c5a76a"] },
    { name: "water", size: 14, mode: "contour", mat: "glass", tray: ["#173b4b", "#235066", "#35667c", "#528396"] },
    { name: "current", size: 12, mode: "contour", mat: "glass", tray: ["#264955", "#3b6570", "#578c94"] },
    { name: "foam", size: 8, mode: "contour", mat: "glass", tray: ["#487888", "#6c929c", "#a0b8b4"] },
    { name: "reflection", size: 7, mode: "flow", angle: 0, mat: "gold", tray: ["#8d783f", "#b69c5b", "#d9ba79"] },
    { name: "reed", size: 6, mode: "contour", mat: "limestone", tray: ["#51645d", "#788374", "#a1a084"] }
  ];
}

export function draw(g, mode, D) {
  D.fill(box(0, 0, 450, 900), "sky", D.linear(0, 0, 0, 700, [[0, "#142835"], [0.55, "#213f50"], [0.85, "#375766"], [1, "#567681"]]));
  for (const [x, y, r] of [[42, 38, 2.4], [118, 70, 1.8], [196, 28, 2.2], [254, 92, 1.6], [70, 140, 1.8], [402, 36, 2.2], [424, 196, 1.8], [30, 232, 1.6], [168, 128, 1.6]]) {
    D.fill(circle(x, y, r), "star", "#e8e4d2");
  }
  D.fill(circle(...MOON, 59), "halo", "#687b79");
  D.fill(circle(...MOON, 50), "moon", D.linear(286, 64, 356, 162, [[0, "#efcf91"], [0.5, "#d8b571"], [1, "#b18a50"]]));
  D.fill(ring(...MOON, 40, 44), "moon", "#efcf91");

  // The water, its currents running under the island, and the moon's broken road across it.
  D.fill(path("M0 700 C120 708 330 694 450 702 L450 900 H0Z"), "water", D.linear(0, 700, 0, 900, [[0, "#35667c"], [0.5, "#235066"], [1, "#173b4b"]]));
  D.fill(path("M0 760 C110 742 190 778 300 760 C360 750 410 744 450 750 L450 768 C400 764 360 770 300 780 C190 798 110 762 0 782Z"), "current", "#3b6570");
  D.fill(path("M0 836 C90 814 210 852 320 830 C380 818 420 820 450 826 L450 846 C410 842 370 846 320 854 C210 874 90 836 0 858Z"), "current", "#264955");
  D.line(path("M18 728 C90 718 150 734 220 726"), 4, "foam", "#a0b8b4");
  D.line(path("M240 806 C310 792 380 798 440 806"), 4, "foam", "#6c929c");
  for (const [y, w] of [[722, 58], [738, 34], [754, 70], [772, 40], [790, 52], [810, 28], [832, 44], [856, 22], [878, 30]]) {
    D.fill(ellipse(MOON[0] + ((y * 7) % 13) - 6, y, w / 2, 3.2), "reflection", y < 780 ? "#d9ba79" : "#b69c5b");
  }

  // The island the tree stands on, with its roots running down into the water.
  D.fill(path("M30 716 C70 676 140 650 225 646 C312 650 382 678 422 716 C330 732 120 732 30 716Z"), "hill", D.linear(0, 646, 0, 730, [[0, "#435659"], [1, "#20343b"]]));
  for (const pts of [[[206, 664], [164, 684], [104, 704], [70, 716]], [[216, 668], [200, 694], [188, 722]], [[238, 666], [280, 688], [344, 708], [384, 716]], [[246, 662], [296, 670], [360, 686]], [[210, 660], [166, 668], [112, 684]]]) {
    D.fill(stroke(pts, 9, 3, 12), "root", "#9f8550");
  }
  for (const [x, h, lean] of [[52, 60, -10], [68, 78, -4], [84, 50, 6], [380, 66, 8], [398, 48, 14]]) {
    D.fill(stroke([[x, 718], [x + lean * 0.4, 718 - h * 0.6], [x + lean, 718 - h]], 4.5, 1.6), "reed", "#788374");
    D.fill(ellipse(x + lean * 0.8, 718 - h * 0.82, 3.4, h * 0.12, lean / h), "reed", "#a1a084");
  }

  // The trunk rises from the island, flaring at its foot, to the fork under the crown.
  D.fill(stroke([[225, 684], [221, 640], [222, 590], [229, 548], [226, 500]], 74, 30, 14), "trunk", D.linear(190, 0, 260, 0, [[0, "#3c2a22"], [0.6, "#6f5039"], [1, "#4c3529"]]));

  // The crown: a dark scalloped mass, the limbs running up into it from the fork, then each
  // cluster of leaves, lit along the edge that faces the moon, so a crescent of light runs
  // round its upper right and the limbs vanish into the leaves.
  D.fill(scallop(225, 322, 196, 172, 7, 0.12, 0.3), "crown", "#1b3d35");
  D.fill(stroke([[222, 516], [190, 484], [146, 452], [112, 428]], 24, 9, 10), "trunk", "#4c3529");
  D.fill(stroke([[230, 512], [264, 482], [306, 456], [340, 434]], 24, 9, 10), "trunk", "#4c3529");
  D.fill(stroke([[226, 508], [228, 462], [225, 410]], 20, 9, 8), "trunk", "#5e4232");
  const clusters = [[226, 206, 70, 58], [150, 254, 66, 56], [304, 246, 70, 58], [96, 342, 54, 58], [356, 332, 56, 60], [224, 308, 74, 62], [146, 404, 58, 44], [306, 402, 60, 44]];
  clusters.forEach(([x, y, rx, ry], i) => {
    D.fill(scallop(x + 6, y - 6, rx, ry, 5, 0.16, i), "lit", "#628f6f");
    D.fill(scallop(x - 3, y + 4, rx * 0.93, ry * 0.92, 5, 0.16, i + 0.5), "leaves", "#356452");
  });
  // Golden fruit hangs among the leaves.
  for (const [x, y] of [[262, 178], [318, 220], [196, 228], [366, 292], [132, 292], [270, 292], [196, 352], [332, 372], [100, 386], [180, 432], [292, 434]]) {
    D.fill(circle(x, y, 8.5), "fruit", "#d8b571");
  }
}
