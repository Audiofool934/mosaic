// Scenes for the world behind the name: still water under the moon, dunes at dusk, an
// abstract of sweeping currents, and peaks at first light. Mosaic suits land, water, sky, and
// pattern best, so there are no people or animals. Each scene keeps its moon, sun, or peaks
// above or below the band where the name is set, and can leave a hole the shape of the
// name, so the name's own picture shows through and stays put while the scenes flow into
// one another.
import { circle, ellipse, poly, ring, stroke } from "../engine/paint.js";
import { clamp, rng } from "../engine/util.js";
import { config as house } from "./nocturne.js";
import { nameHole, nameAt } from "./inscription.js";

const box = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

// A wavy line across the panel at height y, every 20 mm.
function wave(W, y, amp, len, phase, x0 = -40, x1 = W + 40) {
  const pts = [];
  for (let x = x0; x <= x1; x += 20) {
    const u = (x / len) * 6.2832 + phase;
    pts.push([x, y + amp * Math.sin(u) + amp * 0.35 * Math.sin(u * 2.3 + 1.7)]);
  }
  return pts;
}

// The band between two lines, both given left to right.
const between = (top, bottom) => poly([...top, ...[...bottom].reverse()]);

// Small glowing stones scattered over the sky, wherever `free` leaves room.
function stars(D, W, H, seed, count, free) {
  const R = rng(seed);
  for (let i = 0, n = 0; i < count * 6 && n < count; i++) {
    const x = W * (0.02 + 0.96 * R()), y = H * (0.03 + 0.6 * R() ** 1.6), r = 2.6 + 1.8 * R();
    if (!free(x, y)) continue;
    D.fill(circle(x, y, r), "star", R() < 0.5 ? "#efe6c8" : "#d9d2b8");
    n++;
  }
}

const star = { name: "star", size: 4, mode: "contour", mat: "emit", emit: 1.1, tray: ["#cfc8ad", "#e8dfc2", "#f4ecd2"] };

// Each scene is drawn on a stage W by H, down to its foot, where the panel ends below the
// first screen, and is cut around its focus, a share of the stage's width or else its middle,
// on a narrow panel.
const SCENES = {
  // The moon over still water, with no heron: a headland, currents and foam, and the moon's
  // broken reflection.
  night: {
    focus: 0.75,
    regions(W, H) {
      const moon = [0.8 * W, 0.16 * H];
      return [
        { name: "sky", size: 13, mode: "sky", mat: "glass", tray: ["#142835", "#213f50", "#375766", "#567681", "#6c8890"] },
        star,
        { name: "halo", size: 10, mode: "radial", center: moon, mat: "glass", tray: ["#466269", "#687b79", "#7f8d82"] },
        { name: "moon", size: 9, mode: "radial", center: moon, mat: "gold", tray: ["#8d6839", "#b18a50", "#d8b571", "#efcf91"] },
        { name: "far", size: 12, mode: "contour", mat: "basalt", tray: ["#152f38", "#203b42", "#35525a"] },
        { name: "water", size: 13, mode: "contour", mat: "glass", tray: ["#173b4b", "#235066", "#35667c", "#528396"] },
        { name: "current", size: 11, mode: "contour", mat: "glass", tray: ["#264955", "#3b6570", "#578c94", "#7ba5aa"] },
        { name: "foam", size: 8, mode: "contour", mat: "glass", tray: ["#487888", "#6c929c", "#a0b8b4"] },
        { name: "reflection", size: 7, mode: "flow", angle: 0, mat: "gold", tray: ["#8d783f", "#b69c5b", "#d9ba79"] },
        { name: "reed", size: 6, mode: "contour", mat: "limestone", tray: ["#51645d", "#788374", "#a1a084"] }
      ];
    },
    draw(D, W, H, foot) {
      const horizon = 0.665 * H, [mx, my] = [0.8 * W, 0.16 * H], r = 0.065 * W;
      D.fill(box(-10, -10, W + 20, horizon + 20), "sky", D.linear(0, 0, 0, horizon, [[0, "#142835"], [0.62, "#2c4a5a"], [1, "#6c8890"]]));
      stars(D, W, H, 11, 28, (x, y) => Math.hypot(x - mx, y - my) > r * 1.8 && (y < 0.27 * H || x < 0.07 * W || x > 0.93 * W));
      D.fill(circle(mx, my, r * 1.18), "halo", "#687b79");
      D.fill(circle(mx, my, r), "moon", D.linear(mx - r, my - r, mx + r, my + r, [[0, "#efcf91"], [0.5, "#d8b571"], [1, "#b18a50"]]));
      D.fill(ring(mx, my, r * 0.84, r * 0.9), "moon", "#efcf91");
      D.fill(poly([[-20, horizon + 12], [-20, horizon - 30], [0.05 * W, horizon - 50], [0.12 * W, horizon - 44], [0.19 * W, horizon - 20], [0.27 * W, horizon - 6], [0.36 * W, horizon + 6]]), "far", "#203b42");
      D.fill(box(-10, horizon, W + 20, foot - horizon + 10), "water", D.linear(0, horizon, 0, H, [[0, "#35667c"], [0.45, "#235066"], [1, "#173b4b"]]));
      for (const [v, t, color] of [[0.07, 14, "#578c94"], [0.17, 22, "#3b6570"], [0.27, 26, "#264955"]]) {
        const y = horizon + v * H;
        D.fill(between(wave(W, y, 7, 0.4 * W, v * 9), wave(W, y + t, 8, 0.4 * W, v * 9 + 0.4)), "current", color);
      }
      for (const [v, x0, x1, color] of [[0.035, 0.02, 0.4, "#a0b8b4"], [0.12, 0.55, 0.98, "#6c929c"], [0.22, 0.1, 0.45, "#487888"]]) {
        D.line(poly(wave(W, horizon + v * H, 5, 0.33 * W, v * 7, x0 * W, x1 * W), false), 5, "foam", color);
      }
      const R = rng(23);
      for (let y = horizon + 0.025 * H, w = 0.1 * W; y < H - 0.03 * H; y += (0.03 + 0.02 * R()) * H, w *= 0.86) {
        D.fill(ellipse(mx + (R() - 0.5) * 0.03 * W, y, w * (0.6 + 0.4 * R()) / 2, 4.5), "reflection", y < horizon + 0.1 * H ? "#d9ba79" : "#b69c5b");
      }
      for (const [x, h, lean] of [[0.03, 0.17, -0.02], [0.05, 0.22, -0.012], [0.075, 0.14, 0.01], [0.92, 0.16, 0.015], [0.945, 0.21, 0.022], [0.965, 0.13, 0.03]]) {
        const bx = x * W, top = H - h * H, dx = lean * W;
        D.fill(stroke([[bx, foot + 6], [bx + dx * 0.4, H - h * H * 0.6], [bx + dx, top]], 6, 2), "reed", "#788374");
        D.fill(ellipse(bx + dx * 0.78, top + h * H * 0.2, 5.5, h * H * 0.12, dx / (h * H)), "reed", "#a1a084");
      }
    }
  },

  // Dunes at dusk: the sun half set under the name, long thin clouds lit from below, and
  // dunes whose long faces turn to the sun while their steep ones fall into shadow.
  dunes: {
    focus: 0.62,
    regions(W, H) {
      const sun = [0.6 * W, 0.76 * H];
      return [
        { name: "sky", size: 13, mode: "sky", mat: "glass", tray: ["#1d2442", "#2e2f55", "#4a3f63", "#7a5468", "#c07a58", "#e2a265"] },
        { name: "haze", size: 10, mode: "contour", mat: "limestone", tray: ["#9c6f6c", "#bf8a78", "#dcae8b"] },
        { name: "glow", size: 10, mode: "radial", center: sun, mat: "limestone", tray: ["#d99a63", "#e7b276", "#f0c88d"] },
        { name: "sun", size: 8, mode: "radial", center: sun, mat: "emit", emit: 0.9, tray: ["#e2a75e", "#f2c77e", "#f9dfa3"] },
        { name: "far", size: 12, mode: "contour", mat: "terracotta", tray: ["#5e3a3a", "#734743", "#8a5648"] },
        { name: "dune", size: 12, mode: "contour", mat: "terracotta", tray: ["#a45d43", "#b8714f", "#c9865c", "#d89d6c", "#e3ac7a"] },
        { name: "shade", size: 12, mode: "contour", mat: "terracotta", tray: ["#4e2f3a", "#5f3840", "#71434a"] },
        { name: "crest", size: 7, mode: "contour", mat: "limestone", tray: ["#e3b88c", "#efcda2", "#f6dfba"] }
      ];
    },
    draw(D, W, H, foot) {
      const horizon = 0.76 * H, [sx, sy] = [0.6 * W, horizon], r = 0.055 * W;
      D.fill(box(-10, -10, W + 20, horizon + 40), "sky", D.linear(0, 0, 0, horizon, [[0, "#1d2442"], [0.4, "#3c3460"], [0.75, "#8a5468"], [1, "#d08a5a"]]));
      for (const [u, v, a, b, color] of [[0.22, 0.11, 0.17, 15, "#9c6f6c"], [0.34, 0.15, 0.1, 11, "#9c6f6c"], [0.76, 0.2, 0.18, 17, "#bf8a78"], [0.62, 0.24, 0.1, 11, "#9c6f6c"]]) {
        D.fill(ellipse(u * W, v * H, a * W, b), "haze", color);
      }
      D.fill(circle(sx, sy, r * 1.5), "glow", "#e7b276");
      D.fill(circle(sx, sy, r), "sun", D.linear(sx, sy - r, sx, sy + r, [[0, "#f9dfa3"], [0.5, "#f2c77e"], [1, "#e2a75e"]]));
      D.fill(poly([...wave(W, horizon, 5, 0.3 * W, 0.4), [W + 40, foot + 20], [-40, foot + 20]]), "far", "#734743");
      // Each dune rises from the right in a long face lit by the sun to a sharp summit, then
      // falls steeply to the left, where its shadow sweeps down from the summit.
      for (const { summit: [a, b], left: [l, yl], right: [r2, yr], lit } of [
        { summit: [0.3, 0.7], left: [0.04, 0.8], right: [0.78, 0.84], lit: "#b8714f" },
        { summit: [0.66, 0.79], left: [0.46, 0.9], right: [1.12, 0.85], lit: "#c9865c" },
        { summit: [0.2, 0.88], left: [-0.08, 1.0], right: [0.7, 1.04], lit: "#d89d6c" }
      ]) {
        const n = 36, top = [], fall = [], edge = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n, x = a + (r2 - a) * t, s = t * t * (3 - 2 * t) * 0.7 + t * 0.3;
          top.push([x * W, (b + (yr - b) * s) * H]);
          const d = i / n;
          fall.push([(a + (l - a) * d) * W, (b + (yl - b) * (1 - (1 - d) ** 2.4)) * H]);
          edge.push([(a + (l - a) * 0.55 * d ** 1.8) * W, (b + (1.05 - b) * d) * H]);
        }
        D.fill(poly([...[...fall].reverse(), ...top, [r2 * W, foot + 20], [l * W, foot + 20]]), "dune", lit);
        D.fill(poly([...fall, [l * W, foot + 20], [edge.at(-1)[0], foot + 20], ...[...edge].reverse()]), "shade", "#5f3840");
        D.fill(stroke(top.slice(0, 22).map(([x, y]) => [x, y + 3]), 9, 2, 2), "crest", "#efcda2");
      }
    }
  },

  // An abstract: broad currents of glass, marble, and clay sweeping across, with one thread
  // of gold.
  currents: {
    regions() {
      return [
        { name: "teal", size: 13, mode: "contour", mat: "glass", tray: ["#0f2e3e", "#123447", "#173d52", "#1d4659"] },
        { name: "cream", size: 11, mode: "contour", mat: "marble", tray: ["#ddd2b8", "#e9dfc6", "#f2e9d3"] },
        { name: "ochre", size: 12, mode: "contour", mat: "terracotta", tray: ["#b06b3a", "#c27a43", "#d18c52"] },
        { name: "slate", size: 12, mode: "contour", mat: "basalt", tray: ["#1a252d", "#212f38", "#2a3a44"] },
        { name: "gilt", size: 7, mode: "contour", mat: "gold", tray: ["#c79f58", "#dbb46c", "#eac884"] },
        { name: "rust", size: 12, mode: "contour", mat: "terracotta", tray: ["#863f2c", "#9a4e35", "#ad5f40"] },
        { name: "sea", size: 12, mode: "contour", mat: "glass", tray: ["#2f6c74", "#3f7f86", "#55939a"] }
      ];
    },
    draw(D, W, H, foot) {
      const order = [["teal", 0.2], ["cream", 0.09], ["ochre", 0.11], ["slate", 0.14], ["gilt", 0.025], ["rust", 0.12], ["sea", 0.12], ["cream", 0.08], ["teal", 0.24]];
      const line = (y, k) => wave(W, y, 0.045 * H, 0.95 * W, 0.6 + k * 0.42).map(([x, v]) => [x, v + 0.16 * (x - W / 2) * (H / W)]);
      let y = -0.12 * H, top = line(y, 0);
      order.forEach(([name, share], k) => {
        y += share * H * 1.25;
        // The last current runs on down to the foot.
        const bottom = k < order.length - 1 ? line(y, k + 1) : [[W + 40, Math.max(y, foot) + 0.3 * H], [-40, Math.max(y, foot) + 0.3 * H]].reverse();
        D.fill(between(top, bottom), name, null);
        top = bottom;
      });
    }
  },

  // Peaks at first light, rising behind the name: snow lit on one face and in shadow on the
  // other, a line of pines, and a still lake.
  peaks: {
    focus: 0.52,
    regions() {
      return [
        { name: "sky", size: 13, mode: "sky", mat: "glass", tray: ["#2f5a88", "#3f6d9a", "#5b86ad", "#86a6c0", "#c3c8c4", "#ecd6ae"] },
        { name: "range", size: 12, mode: "contour", mat: "limestone", tray: ["#6f84a3", "#7f93ae", "#90a2ba"] },
        { name: "rock", size: 11, mode: "contour", mat: "basalt", tray: ["#5d6478", "#6c7287", "#7b8196"] },
        { name: "shadow", size: 11, mode: "contour", mat: "basalt", tray: ["#2c3448", "#353e54", "#404a61"] },
        { name: "snow", size: 9, mode: "contour", mat: "marble", tray: ["#f1e2d4", "#f7ebe0", "#fcf5ec"] },
        { name: "snowshade", size: 9, mode: "contour", mat: "marble", tray: ["#9eaccb", "#b2bed6", "#c6cfe1"] },
        { name: "pines", size: 9, mode: "contour", mat: "basalt", tray: ["#16302b", "#1d3a33", "#25463e"] },
        { name: "lake", size: 13, mode: "contour", mat: "glass", tray: ["#24496b", "#2e5878", "#4f7a99", "#7fa3c0"] },
        { name: "glint", size: 8, mode: "flow", angle: 0, mat: "marble", tray: ["#c7d3df", "#e3e9ee", "#f6efe2"] }
      ];
    },
    draw(D, W, H, foot) {
      const base = 0.76 * H, shore = 0.8 * H, R = rng(47);
      D.fill(box(-10, -10, W + 20, base + 20), "sky", D.linear(0, 0, 0, base, [[0, "#2f5a88"], [0.5, "#5b86ad"], [0.85, "#c3c8c4"], [1, "#ecd6ae"]]));
      const far = [[-20, base]];
      for (let x = -20; x <= W + 40; x += 0.045 * W) far.push([x, (0.45 + 0.1 * R()) * H]);
      D.fill(poly([...far, [W + 40, base + 10], [-20, base + 10]]), "range", "#7f93ae");
      // Each mountain: a lit face left of the ridge running down from its summit and a shaded
      // one right of it, and snow down to a ragged line about four tenths of the way.
      for (const [px, py, half] of [[0.52, 0.12, 0.3], [0.2, 0.22, 0.24], [0.84, 0.2, 0.24]]) {
        const x = px * W, y = py * H, w = half * W, dy = base + 6 - y, P = (u, v) => [x + u * w, y + v * dy];
        D.fill(poly([P(-1, 1), P(-0.55, 0.5), P(-0.2, 0.15), P(0, 0), P(0.08, 0.35), P(0.1, 1)]), "rock", "#6c7287");
        D.fill(poly([P(0, 0), P(0.3, 0.3), P(0.65, 0.6), P(1, 1), P(0.1, 1), P(0.08, 0.35)]), "shadow", "#353e54");
        D.fill(poly([P(0, 0), P(0.3, 0.3), P(0.44, 0.42), P(0.3, 0.36), P(0.18, 0.46), P(0.05, 0.34), P(-0.1, 0.44), P(-0.25, 0.33), P(-0.43, 0.38), P(-0.2, 0.15)]), "snow", "#f7ebe0");
        D.fill(poly([P(0, 0), P(0.3, 0.3), P(0.44, 0.42), P(0.3, 0.36), P(0.18, 0.46), P(0.07, 0.36)]), "snowshade", "#b2bed6");
      }
      const tops = [];
      for (let x = -20, i = 0; x <= W + 40; x += 9, i++) tops.push([x, base - (i % 2 ? 4 : 14 + 10 * R())]);
      D.fill(poly([...tops, [W + 40, shore + 2], [-20, shore + 2]]), "pines", "#1d3a33");
      D.fill(box(-10, shore, W + 20, foot - shore + 10), "lake", D.linear(0, shore, 0, H, [[0, "#7fa3c0"], [0.45, "#4f7a99"], [1, "#24496b"]]));
      for (const [px, w] of [[0.2, 0.08], [0.52, 0.11], [0.84, 0.08]]) {
        for (let k = 0, y = shore + 0.02 * H; k < 4; k++, y += 0.035 * H) D.fill(ellipse(px * W + (R() - 0.5) * 20, y, (w * W * (1 - k * 0.2)) / 2, 4), "glint", k ? "#e3e9ee" : "#f6efe2");
      }
    }
  }
};

export const SCENE_NAMES = Object.keys(SCENES);

// The stage every scene is drawn on, in millimetres: the shape of a desktop's first screen.
export const STAGE = { w: 1600, h: 900 };

// How the stage fills a first screen `w` wide and `screen` high, the way a cover image fills a
// frame: scaled evenly until it covers the screen, so a narrower screen cuts its sides and a
// wider one its foot. `h` is how high the scaled stage is; the name is set in its band.
export function stageOn(w, screen) {
  const scale = Math.max(w / STAGE.w, screen / STAGE.h);
  return { scale, h: STAGE.h * scale };
}

// A scene as a picture `w` by `h` millimetres whose first screen is `screen` high, in the
// house light, its camera looking straight at the whole panel. The stage covers the first
// screen, cut around the scene's focus at the sides, and below it the scene runs on to the
// panel's foot. Its stones are `k` times their size on a desktop page, and it leaves a hole
// where the name is set unless `hole` is false. `build` says how it is laid, if it is,
// straight onto the bare plaster, with no sinopia drawn first.
export function scene({ name, w, h, screen = h, stack, k = 1, hole = true, build }) {
  const s = SCENES[name];
  if (!s) throw new Error(`No scene ${name}.`);
  const { scale, h: band } = stageOn(w, screen), sx = scale, sy = scale;
  const tx = clamp(w / 2 - (s.focus ?? 0.5) * STAGE.w * sx, w - STAGE.w * sx, 0);
  const regions = () => s.regions(STAGE.w, STAGE.h).map((r) => ({ ...r, size: r.size * k, ...(r.center && { center: [tx + r.center[0] * sx, r.center[1] * sy] }) }));
  const set = nameAt(w, band, stack);
  return {
    config: { panel: { w, h }, res: 1, background: s.regions(STAGE.w, STAGE.h)[0].name, camera: { keys: [[0, w / 2, h / 2, w]], tilt: 0, yaw: 0, aperture: 0.004, drift: 0 }, light: house.light, sinopia: false, ...(build && { build }) },
    regions,
    draw(g, mode, D) {
      g.save();
      g.transform(sx, 0, 0, sy, tx, 0);
      s.draw(D, STAGE.w, STAGE.h, h / sy);
      g.restore();
      if (hole) nameHole(D, set);
    }
  };
}
