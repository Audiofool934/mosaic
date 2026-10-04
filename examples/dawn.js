// An original coastal dawn: warm limestone sky, sea glass, and a little gold.
import { circle, ellipse, poly, stroke } from "../engine/paint.js";

const path = (d) => new Path2D(d);

export const config = {
  panel: { w: 1600, h: 900 },
  res: 1,
  background: "sky",
  camera: {
    keys: [[4, 800, 450, 1600], [5.6, 800, 450, 1600], [10, 1000, 440, 980]],
    tilt: 0, yaw: 0, aperture: 0.014, drift: 0
  },
  light: {
    key: { az: 126, el: 31, color: [1, 0.89, 0.72], power: 1.05 },
    fill: { az: -40, el: 38, color: [0.71, 0.82, 0.90], power: 0.35 },
    sky: [0.16, 0.18, 0.19], ground: [0.06, 0.047, 0.03],
    exposure: 0.5, grout: "#727b70", wet: [0.16, 1.0]
  },
  sinopia: { groups: [["sky", "cloud", "halo"], ["sea", "current", "foam"], ["headland", "dune"]] }
};

export function regions() {
  return [
    { name: "sky", size: 14, mode: "sky", mat: "limestone", tray: ["#b6baa7", "#d2cfb5", "#e4d9bb", "#efdfbf"] },
    { name: "cloud", size: 12, mode: "sky", mat: "marble", tray: ["#c8beb0", "#e3d1b8", "#f0e4ce"] },
    { name: "halo", size: 10, mode: "radial", center: [990, 340], mat: "limestone", tray: ["#c9b88d", "#dfc796", "#ead4a6"] },
    { name: "sun", size: 8, mode: "radial", center: [990, 340], mat: "gold", tray: ["#a67439", "#c7944e", "#e0b36d", "#f0cf91"] },
    { name: "sea", size: 13, mode: "contour", mat: "glass", tray: ["#2c5962", "#47767a", "#6b9994", "#94b6a8"] },
    { name: "current", size: 12, mode: "contour", mat: "glass", tray: ["#3e6d72", "#608e8b", "#85a69a", "#acbbaa"] },
    { name: "foam", size: 8, mode: "contour", mat: "marble", tray: ["#9eaea1", "#c1c8b4", "#e1dfc4"] },
    { name: "headland", size: 13, mode: "contour", mat: "terracotta", tray: ["#725d4d", "#977a5d", "#b39b77", "#cab28c"] },
    { name: "dune", size: 13, mode: "contour", mat: "limestone", tray: ["#6c7865", "#909981", "#adb195", "#c8c5a5"] },
    { name: "shore", size: 11, mode: "contour", mat: "limestone", tray: ["#a89979", "#c4b798", "#dfd0ac", "#eee0bd"] },
    { name: "gold", size: 7, mode: "flow", angle: 0, mat: "gold", tray: ["#ac8d54", "#ccb078", "#e5c58c"] },
    { name: "ink", size: 5, mode: "contour", mat: "basalt", tray: ["#284449", "#405755"] }
  ];
}

export function draw(g, mode, D) {
  D.fill(poly([[0, 0], [1600, 0], [1600, 900], [0, 900]]), "sky", D.linear(0, 0, 0, 530, [[0, "#b6baa7"], [0.6, "#e4d9bb"], [1, "#efdfbf"]]));
  D.fill(path("M0 196 C242 149 405 212 665 180 C451 228 245 214 0 241Z"), "cloud", "#f0e4ce");
  D.fill(path("M1157 132 C1334 111 1475 153 1600 136 V163 C1456 176 1312 135 1157 150Z"), "cloud", "#e3d1b8");
  D.fill(circle(990, 340, 105), "halo", "#ead4a6");
  D.fill(circle(990, 340, 88), "sun", D.linear(950, 250, 1030, 430, [[0, "#f0cf91"], [0.55, "#e0b36d"], [1, "#c7944e"]]));

  D.fill(path("M0 490 C281 481 623 492 910 483 C1159 475 1370 493 1600 482 V900 H0Z"), "sea", D.linear(0, 480, 0, 900, [[0, "#94b6a8"], [0.45, "#6b9994"], [1, "#2c5962"]]));
  D.fill(path("M0 523 C96 471 148 370 255 362 C340 365 403 450 511 461 C606 470 655 485 710 516 C444 561 169 558 0 578Z"), "headland", "#b39b77");
  D.fill(path("M0 551 C170 530 190 434 293 432 C358 432 418 487 493 499 C574 511 616 503 664 526 C432 581 208 594 0 612Z"), "dune", "#909981");
  D.fill(path("M0 575 C148 564 184 523 254 509 C351 489 405 534 485 535 C350 553 271 566 216 591 C150 620 74 622 0 628Z"), "shore", "#dfd0ac");

  // A few wide tidal curves create a different rhythm from the night water.
  D.fill(path("M471 592 C698 536 894 563 1119 551 C1331 538 1465 529 1600 558 V581 C1418 555 1295 570 1123 580 C863 597 706 565 471 613Z"), "current", "#acbbaa");
  D.fill(path("M229 720 C495 632 690 682 918 641 C1193 593 1358 637 1600 622 V661 C1357 668 1191 634 944 679 C668 729 488 665 229 747Z"), "current", "#85a69a");
  D.fill(path("M0 844 C306 738 486 827 718 779 C998 722 1264 715 1600 775 V816 C1240 757 1013 771 735 821 C467 869 296 783 0 883Z"), "current", "#3e6d72");
  D.line(path("M509 604 C741 562 895 591 1119 570 C1321 551 1467 550 1584 573"), 6, "foam", "#e1dfc4");
  D.line(path("M449 696 C627 681 739 703 906 670"), 5, "foam", "#c1c8b4");
  D.line(path("M971 772 C1189 738 1395 762 1570 798"), 6, "foam", "#9eaea1");

  for (const [x, y, width] of [[991, 506, 83], [1004, 524, 131], [965, 557, 76], [1014, 597, 163], [971, 639, 95], [1040, 699, 120], [979, 749, 51]]) {
    D.fill(ellipse(x, y, width / 2, 4), "gold", y < 620 ? "#e5c58c" : "#ccb078");
  }

  // Two distant birds are drawn as continuous wing gestures.
  D.fill(stroke([[565, 279], [582, 274], [597, 282], [609, 267], [625, 262]], 4.5, 2.5), "ink", "#405755");
  D.fill(stroke([[648, 240], [661, 238], [672, 245], [682, 234], [695, 232]], 3.5, 2), "ink", "#405755");
}
