// The project page as one wall of two pictures. The nocturne is set at the top, as it was
// drawn, and the page picture runs its water on down the page around every tablet, emblem,
// band, and medallion the page marks out, so the courses follow the page the way they
// follow a drawing.
import * as nocturne from "../examples/nocturne-laid.js";
import { SAMPLES } from "../examples/materials.js";
import { circle, ellipse, poly } from "../engine/paint.js";
import { clamp, rng } from "../engine/util.js";

// The nocturne's panel, and the x its crop keeps central: between the heron and the moon.
const PANEL = { w: 1600, h: 900, focus: 840 };
// Millimetres of wall for each CSS pixel on a desktop page.
const DESKTOP = 1.11;
// The most stones the page picture may hold; the nocturne brings its own.
const BUDGET = 30000;

const box = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

function rounded(x, y, w, h, r) {
  const p = new Path2D();
  p.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  return p;
}

// Millimetres of wall for each CSS pixel: the nocturne spans a desktop page, and a phone
// shows a closer crop of it.
export function wallScale(width) {
  return clamp(width * DESKTOP, 880, PANEL.w) / width;
}

// Where the nocturne sits on the wall: cropped about its focus, at the foot of the hero.
export function heroAt({ width, hero, scale }) {
  const W = width * scale;
  return [W / 2 - clamp(PANEL.focus, W / 2, PANEL.w - W / 2), Math.max(0, hero * scale - PANEL.h)];
}

// The nocturne, drawn by rows so the page only draws the stones near its view.
export function heroPicture() {
  return { ...nocturne, config: { ...nocturne.config, rows: true } };
}

// A current: a wavy band between two wavy edges. Some cross the whole wall; others rise
// from one side and taper out partway across.
function current(y, W, R, k) {
  const amp = (12 + 26 * R()) * k, len = (560 + 760 * R()) * k, phase = 6.28 * R(), thick = (16 + 22 * R()) * k;
  const across = R() < 0.5;
  const fromLeft = R() < 0.5;
  const reach = W * (0.45 + 0.4 * R());
  const x0 = across || fromLeft ? -40 : W - reach, x1 = across || !fromLeft ? W + 40 : reach;
  const top = [], bottom = [];
  for (let x = x0; x <= x1; x += 16 * k) {
    const u = (x / len) * 6.2832 + phase;
    const c = y + amp * Math.sin(u) + amp * 0.35 * Math.sin(u * 2.3 + 1.7);
    const taper = Math.min(1, x0 < 0 ? 1 : (x - x0) / (220 * k), x1 > W ? 1 : (x1 - x) / (220 * k));
    const t = Math.max(1.5, thick * (0.55 + 0.45 * Math.sin(u * 0.7 + 0.4)) * taper);
    top.push([x, c - t / 2]);
    bottom.unshift([x, c + t / 2]);
  }
  return { path: poly(top.concat(bottom)), crest: R() < 0.6 ? top.slice(2, -2) : null };
}

// layout: page width and height and the hero's foot (CSS px), the scale, and the marked
// blocks, each { kind, x, y, w, h } in page pixels, with a material for medallions.
export function wallPicture(layout) {
  const m = layout.scale ?? wallScale(layout.width);
  // Stones of the page's own features keep their size on screen at any scale.
  const k = m / DESKTOP;
  const W = layout.width * m;
  const H = layout.height * m;
  const [ox, oy] = heroAt({ ...layout, scale: m });
  const seam = oy + PANEL.h;
  const blocks = layout.blocks.map((b) => ({ ...b, x: b.x * m, y: b.y * m, w: b.w * m, h: b.h * m }));
  const frame = 10 * k, margin = 14 * k;

  // The open wall decides how coarse the deep water can be and still fit the budget.
  const covered = blocks.reduce((a, b) => a + (b.kind === "band" ? 0 : (b.w + 2 * frame) * (b.h + 2 * frame)), 0);
  const open = Math.max(1, W * Math.max(0, H - seam) - covered);
  const deep = clamp(Math.sqrt(open / ((BUDGET - 14000) * 0.8)), 14 * k, 24 * k);
  // The working raster stays within 8 megapixels and 8192 pixels a side.
  const res = Math.min(0.75, 8192 / H, 8192 / W, Math.sqrt(8e6 / (W * H)));

  const R = rng(4242);
  const currents = [];
  for (let y = seam + 300 * k; y < H - 160 * k; y += (460 + 520 * R()) * k) currents.push(current(y, W, R, k));

  const medallions = blocks.filter((b) => b.kind === "medallion");
  const sample = (name) => SAMPLES.find((s) => s.name === name) || SAMPLES[0];
  const sky = nocturne.regions().find((r) => r.name === "sky");
  const shore = nocturne.regions().find((r) => r.name === "shore");

  const regions = () => [
    { ...sky, size: 13 * k },
    { ...shore, size: 12 * k },
    { name: "deep", size: deep, mode: "contour", mat: "glass", tray: ["#0e2633", "#12303f", "#173a4a", "#1d4456", "#235066"] },
    { name: "drift", size: Math.min(deep, 13 * k), mode: "contour", mat: "glass", tray: ["#1d3f4d", "#28515e", "#356471", "#467683"] },
    { name: "spray", size: 7 * k, mode: "contour", mat: "glass", tray: ["#3f6c7a", "#5d8792", "#88a9a8"] },
    { name: "frame", size: 7 * k, mode: "contour", mat: "gold", tray: ["#b18a50", "#c99d5c", "#d8b571", "#efcf91"] },
    // Under words set on the wall the water runs level, like ruled lines, in its own colours.
    { name: "band", size: 12 * k, mode: "flow", angle: 0, mat: "glass", tray: ["#0d2430", "#112c3a", "#163646", "#1b3f51"] },
    ...medallions.flatMap((b, i) => {
      const s = sample(b.material);
      const center = [b.x + b.w / 2, b.y + b.h / 2];
      return [
        { name: `face-${i}`, size: 8.5 * k, mode: "radial", center, mat: s.mat, tray: s.field },
        { name: `heart-${i}`, size: 7 * k, mode: "radial", center, mat: s.mat, tray: s.disc }
      ];
    })
  ];

  function draw(g, mode, D) {
    // Night sky above the nocturne, for the masthead; the nocturne itself is its own picture.
    D.fill(box(-10, -10, W + 20, seam + 10), "sky", "#142835");
    // The water deepens from the nocturne's own colour at the seam.
    D.fill(box(-10, seam, W + 20, H - seam + 10), "deep", D.linear(0, seam, 0, seam + 700 * k, [[0, "#235066"], [0.5, "#1a3e4f"], [1, "#12303f"]]));
    // The nocturne's island runs on below its panel instead of stopping at the seam.
    D.fill(ellipse(ox + 558, seam - 6, 290, 46), "shore", "#34484c");
    for (const c of currents) {
      D.fill(c.path, "drift", "#356471");
      if (c.crest) D.line(poly(c.crest.filter((_, i) => i % 2 === 0), false), 4.5 * k, "spray", "#5d8792");
    }
    for (const b of blocks) {
      if (b.kind === "band") {
        D.fill(rounded(b.x - margin, b.y - margin, b.w + 2 * margin, b.h + 2 * margin, margin), "band", "#163646");
      } else if (b.kind === "medallion") {
        const i = medallions.indexOf(b);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.min(b.w, b.h) / 2;
        D.fill(circle(cx, cy, r + frame * 0.8), "frame", "#b18a50");
        D.fill(circle(cx, cy, r), `face-${i}`, sample(b.material).field[2]);
        const heart = sample(b.material).disc[1];
        D.fill(circle(cx, cy, r * 0.46), `heart-${i}`, typeof heart === "string" ? heart : heart.hex);
      } else {
        // A tablet or an emblem: a gold frame round a bare patch the page covers.
        D.fill(rounded(b.x - frame, b.y - frame, b.w + 2 * frame, b.h + 2 * frame, 4 * k), "frame", "#b18a50");
        D.fill(box(b.x, b.y, b.w, b.h), "none", "#bdb3a2");
      }
    }
    // The nocturne's panel is left bare here: its own stones fill it.
    D.fill(box(ox, oy, PANEL.w, PANEL.h), "none", "#bdb3a2");
  }

  return {
    config: {
      ...nocturne.config,
      panel: { w: W, h: H },
      res,
      background: "deep",
      // The page only ever shows a stretch of the wall, so its stones are drawn by rows.
      rows: true,
      camera: { keys: [[0, W / 2, Math.min(H, PANEL.h) / 2, W]], tilt: 0, yaw: 0, aperture: 0.004, drift: 0 },
      sinopia: { groups: [["sky"], ["deep", "drift", "spray", "band"]] },
      // Laid from the sky over the moon while the nocturne is laid, then on down the page.
      build: {
        origin: [ox + 1110, Math.max(1, oy * 0.5)],
        start: 0.6,
        end: 9.5,
        rise: 0.08,
        speeds: { sky: 2.6, frame: 2.4, band: 1.6, "face-*": 1.8, "heart-*": 1.8 }
      }
    },
    regions,
    draw
  };
}
