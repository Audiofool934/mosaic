// An original drawing for mosAIc. Every contour is also a direction for stonework.
import { circle, ellipse, poly, ring, stroke } from "../engine/paint.js";

const path = (d) => new Path2D(d);
const box = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

export const config = {
  panel: { w: 1600, h: 900 },
  res: 1,
  background: "sky",
  camera: {
    keys: [[0, 800, 450, 1600], [8, 800, 450, 1600]],
    tilt: 0, yaw: 0, aperture: 0.014, drift: 0
  },
  light: {
    key: { az: 128, el: 28, color: [1, 0.90, 0.73], power: 1.1 },
    fill: { az: -40, el: 40, color: [0.62, 0.78, 1], power: 0.33 },
    sky: [0.11, 0.16, 0.23], ground: [0.045, 0.038, 0.023],
    exposure: 0.45, grout: "#35444b", wet: [0.18, 1.0]
  },
  sinopia: { groups: [["sky", "halo"], ["water", "current", "foam"], ["bird", "wing", "shade"]] }
};

export function regions() {
  return [
    { name: "sky", size: 13, mode: "sky", mat: "glass", tray: ["#142835", "#213f50", "#375766", "#567681", "#6c8890"] },
    { name: "halo", size: 10, mode: "radial", center: [1110, 235], mat: "glass", tray: ["#466269", "#687b79", "#7f8d82"] },
    { name: "moon", size: 9, mode: "radial", center: [1110, 235], mat: "gold", tray: ["#8d6839", "#b18a50", "#d8b571", "#efcf91"] },
    { name: "far", size: 12, mode: "contour", mat: "basalt", tray: ["#152f38", "#203b42", "#35525a"] },
    { name: "water", size: 13, mode: "contour", mat: "glass", tray: ["#173b4b", "#235066", "#35667c", "#528396"] },
    { name: "current", size: 11, mode: "contour", mat: "glass", tray: ["#264955", "#3b6570", "#578c94", "#7ba5aa"] },
    { name: "foam", size: 8, mode: "contour", mat: "glass", tray: ["#487888", "#6c929c", "#a0b8b4"] },
    { name: "reflection", size: 7, mode: "flow", angle: 0, mat: "gold", tray: ["#8d783f", "#b69c5b", "#d9ba79"] },
    { name: "bird", size: 7.5, mode: "contour", mat: "marble", tray: ["#aeb9ae", "#cad0ba", "#e0dec4", "#f0e9d1"] },
    { name: "wing", size: 7, mode: "contour", mat: "limestone", tray: ["#919f98", "#b2bcb0", "#d5d8c1", "#e6e2c9"] },
    { name: "shade", size: 6, mode: "contour", mat: "glass", tray: ["#6e8d93", "#93aaa6", "#b4c0b3"] },
    { name: "bronze", size: 5, mode: "contour", mat: "gold", tray: ["#715e3f", "#9f8550", "#c5a76a", "#e0c48b"] },
    { name: "ink", size: 3.5, mode: "contour", mat: "basalt", tray: ["#10262c", "#1d343b"] },
    { name: "shore", size: 12, mode: "contour", mat: "basalt", tray: ["#20343b", "#34484c", "#506263"] },
    { name: "reed", size: 6, mode: "contour", mat: "limestone", tray: ["#51645d", "#788374", "#a1a084"] }
  ];
}

export function draw(g, mode, D) {
  D.fill(box(0, 0, 1600, 900), "sky", D.linear(0, 0, 0, 510, [[0, "#142835"], [0.65, "#375766"], [1, "#6c8890"]]));
  D.fill(circle(1110, 235, 127), "halo", "#687b79");
  D.fill(circle(1110, 235, 111), "moon", D.linear(1040, 125, 1180, 338, [[0, "#efcf91"], [0.5, "#d8b571"], [1, "#b18a50"]]));
  D.fill(ring(1110, 235, 93, 99), "moon", "#efcf91");

  // A low headland leaves most of the sky unbroken.
  D.fill(path("M0 384 C105 351 178 298 239 320 C316 344 372 414 513 420 C335 451 118 459 0 475Z"), "far", "#203b42");
  D.fill(path("M0 445 C303 454 458 415 753 436 C1012 455 1244 415 1600 437 L1600 900 H0Z"), "water", D.linear(0, 430, 0, 900, [[0, "#35667c"], [0.45, "#235066"], [1, "#173b4b"]]));

  // Each current is a long closed region, so its courses follow the water.
  D.fill(path("M0 526 C290 501 367 547 603 530 C856 511 1049 459 1600 488 L1600 514 C1210 489 948 560 678 571 C356 585 235 527 0 559Z"), "current", "#578c94");
  D.fill(path("M0 633 C222 550 497 693 752 627 C977 569 1248 545 1600 588 L1600 634 C1262 585 992 618 792 677 C495 766 240 593 0 675Z"), "current", "#3b6570");
  D.fill(path("M0 774 C240 667 398 793 648 752 C980 697 1085 648 1308 705 C1428 736 1515 721 1600 695 L1600 734 C1511 768 1391 766 1297 745 C1072 693 1033 759 680 802 C408 837 238 737 0 817Z"), "current", "#264955");
  D.line(path("M5 534 C227 513 374 553 584 539"), 6, "foam", "#a0b8b4");
  D.line(path("M875 545 C1115 491 1398 495 1600 517"), 7, "foam", "#6c929c");
  D.line(path("M830 665 C1090 595 1340 603 1559 633"), 5, "foam", "#487888");
  D.line(path("M56 783 C231 716 402 794 520 790"), 6, "foam", "#6c929c");
  D.line(path("M809 814 C1045 776 1178 760 1371 800"), 6, "foam", "#487888");

  // Gold is kept to the moon and a few broken reflections.
  for (const [x, y, w] of [[1108, 465, 106], [1081, 478, 55], [1144, 498, 138], [1073, 538, 82], [1167, 568, 158], [1105, 612, 68], [1147, 658, 112], [1085, 705, 44]]) {
    D.fill(ellipse(x, y, w / 2, 4.5), "reflection", y < 540 ? "#d9ba79" : "#b69c5b");
  }

  // The bird's dark gold legs continue down into a small tidal island.
  D.fill(stroke([[574, 596], [563, 687], [556, 778]], 12, 8), "bronze", "#9f8550");
  D.fill(stroke([[609, 593], [646, 682], [604, 763]], 11, 7), "bronze", "#c5a76a");
  D.fill(stroke([[556, 776], [527, 783]], 8, 3), "bronze", "#9f8550");
  D.fill(stroke([[604, 762], [632, 771]], 7, 3), "bronze", "#9f8550");

  // One continuous silhouette gives the neck its quiet S-shaped gesture.
  D.fill(path("M441 619 C449 572 499 532 548 513 C591 496 625 459 624 423 C623 391 601 366 604 333 C607 298 633 277 660 279 C691 280 710 301 697 327 C687 345 664 354 658 375 C646 412 685 442 690 484 C698 537 666 583 624 608 C576 639 510 653 441 619Z"), "bird", D.linear(435, 325, 703, 634, [[0, "#f0e9d1"], [0.45, "#e0dec4"], [1, "#aeb9ae"]]));
  D.fill(path("M451 601 C480 549 536 516 599 503 C622 498 642 506 661 516 C631 560 583 594 527 613 L452 632Z"), "wing", D.linear(481, 507, 554, 633, [[0, "#e6e2c9"], [0.5, "#d5d8c1"], [1, "#919f98"]]));
  D.fill(path("M646 343 C631 381 650 413 663 440 C684 482 676 518 663 538 C686 507 688 475 669 442 C650 408 642 379 658 351Z"), "shade", "#93aaa6");
  D.line(path("M471 599 Q553 587 623 534"), 6, "bird", "#e0dec4");
  D.line(path("M476 614 Q562 605 602 568"), 5, "bird", "#f0e9d1");
  D.fill(path("M686 308 L770 324 L691 326Z"), "bronze", "#c5a76a");
  D.fill(path("M645 286 Q606 277 587 297 Q616 288 646 301Z"), "ink", "#10262c");
  D.fill(circle(675, 306, 6.5), "ink", "#10262c");
  D.fill(circle(676, 304.5, 2.3), "bronze", "#e0c48b");

  D.fill(path("M299 875 C369 830 435 803 500 809 C562 783 647 786 703 808 C771 808 816 842 850 900 H266Z"), "shore", "#34484c");
  D.fill(path("M381 861 C476 824 595 817 703 833 C612 832 533 842 473 867Z"), "shore", "#506263");
  for (const [x, y, h, lean] of [[330, 847, 119, -28], [345, 841, 172, -18], [366, 833, 103, 10], [742, 843, 142, 38], [769, 853, 111, 32], [789, 864, 160, 53]]) {
    D.fill(stroke([[x, y], [x + lean * 0.4, y - h * 0.6], [x + lean, y - h]], 6, 2), "reed", "#788374");
    D.fill(ellipse(x + lean * 0.78, y - h * 0.80, 5.5, h * 0.12, lean / h), "reed", "#a1a084");
  }
}
