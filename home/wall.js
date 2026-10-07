// The project page as one wall. The name is set in stone on the first screen, over scenes
// that flow into one another behind it, and the page picture runs its water on down the
// page around every tablet, emblem, band, and medallion the page marks out, so the courses
// follow the page the way they follow a drawing. On the stage, the pages stand side by side
// in one sea instead, and their own blocks fly from one page to the next as the page turns.
import { nameAlone, nameAt } from "../examples/inscription.js";
import { SCENE_NAMES, scene, stageOn } from "../examples/landscapes.js";
import { config as house } from "../examples/nocturne.js";
import { SAMPLES } from "../examples/materials.js";
import { circle, poly } from "../engine/paint.js";
import { clamp, rng } from "../engine/util.js";

// The widest wall, in millimetres.
const WIDEST = 1600;
// Millimetres of wall for each CSS pixel on a desktop page.
const DESKTOP = 1.11;
// The most stones the page picture may hold; the name and the scenes bring their own.
const BUDGET = 30000;

const box = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

function rounded(x, y, w, h, r) {
  const p = new Path2D();
  p.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  return p;
}

// Millimetres of wall for each CSS pixel: a desktop page shows the whole width of the
// widest wall, and a phone a closer view.
export function wallScale(width) {
  return clamp(width * DESKTOP, 880, WIDEST) / width;
}

// The first screen in millimetres of wall: its width, its height down to the hero's foot, how
// high the scenes' stage stands on it, where the name's middle is, and how much larger stones
// are than on a desktop page.
function firstScreen(layout) {
  const m = layout.scale ?? wallScale(layout.width), W = layout.width * m, screen = layout.hero * m;
  const band = stageOn(W, screen).h;
  return { W, screen, band, middle: nameAt(W, band).middle, k: m / DESKTOP };
}

// Where the scenes end and the page's picture begins: a long, low wave below the first
// screen, so the two meet like two bodies of water instead of along a straight cut.
const TAIL = 130;
function shoreline(seam, x0, x1) {
  const pts = [];
  for (let x = x0; x <= x1; x += 20) pts.push([x, seam + 62 + 26 * Math.sin(x / 260 + 0.8) + 12 * Math.sin(x / 97 + 2.1)]);
  return pts;
}

// The film: the name is laid first, by GATE, where the page waits until every picture has
// joined the wall. The first scene and the page are laid around it from WORLD, late enough
// that no lime is spread nor stone falls before the gate, and by LAID; then each scene flows
// into the next in turn, the last into a copy of the first, from which the film loops back to
// LAID. A flow starts LEAD after the rest before it, since it starts each stone a few
// hundredths early or late, and takes FLOW seconds; each scene settles for SETTLE before it
// rests, where the page holds it as long as it likes.
const GATE = 2.4, WORLD = GATE + 0.6, LAID = 6.4, LEAD = 0.1, FLOW = 2.4, SETTLE = 0.3;

// The wall's film for a layout: its project, whose pictures this module, at `module`, draws
// by name, so workers can cut them; the loop it plays in; the time by which every picture
// must have joined it; and the times it rests at. With `page` false it is the first screen
// alone, for the stage.
export function wallFilm(layout, { module, laid = true, band, page = true }) {
  const { W, middle } = firstScreen(layout);
  const arrive = laid ? { type: "laid", bed: 0 } : { type: "settled" };
  const names = [...SCENE_NAMES, SCENE_NAMES[0]];
  const from = (i) => LAID + LEAD + (i - 1) * (FLOW + SETTLE + LEAD);
  const rest = (i) => (i ? from(i) + FLOW + SETTLE : LAID);
  const end = rest(names.length - 1);
  const scenes = names.map((name, i) => ({
    id: i < names.length - 1 ? name : `${name}-again`,
    picture: { module, export: "scenePicture", args: { ...layout, scene: name, first: i === 0, tail: page } },
    start: i ? from(i) : 0,
    end: i < names.length - 1 ? rest(i + 1) : end,
    at: [0, 0],
    in: i ? { type: "flow", launch: [from(i), from(i) + 0.8], land: [from(i) + 1, from(i) + FLOW], focus: [W / 2, middle] } : arrive
  }));
  const project = {
    version: 1, title: "mosAIc", seed: 42, fps: [60, 1], frames: Math.ceil(end * 60) + 1, band, look: [[0, 1], [end, 1]],
    scenes: [
      { id: "name", picture: { module, export: "namePicture", args: layout }, start: 0, end, at: [0, 0], in: arrive, front: true },
      ...(page ? [{ id: "page", picture: { module, export: "wallPicture", args: layout }, start: 0, end, at: [0, 0], in: arrive }] : []),
      ...scenes
    ]
  };
  return { project, loop: [LAID, end], gate: GATE, rests: names.slice(0, -1).map((_, i) => rest(i)) };
}

// The name alone, its letters set on the first screen, laid quickly from its middle.
export function namePicture(layout) {
  const { W, screen, band, middle } = firstScreen(layout);
  const p = nameAlone({ w: W, h: screen, screen: band });
  return { ...p, config: { ...p.config, rows: true, build: { origin: [W / 2, middle], start: 0.2, end: GATE } } };
}

// A scene behind the name, on the first screen and on down to the shoreline, or with no
// `tail`, the first screen only. The first is laid outward from behind the name once the
// name is laid; the others flow in.
export function scenePicture({ scene: name, first, tail = true, ...layout }) {
  const { W, screen, middle, k } = firstScreen(layout);
  const p = scene({ name, w: W, h: tail ? screen + TAIL : screen, screen, k, build: first ? { origin: [W / 2, middle], start: WORLD, end: LAID - 0.4 } : undefined });
  return {
    config: { ...p.config, rows: true },
    regions: p.regions,
    draw(g, mode, D) {
      p.draw(g, mode, D);
      if (tail) D.fill(poly([...shoreline(screen, -20, W + 20), [W + 20, screen + TAIL + 10], [-20, screen + TAIL + 10]]), "none", "#bdb3a2");
    }
  };
}

// The stage: the page's pages side by side along one long wall, on one clock. Page 0 is the
// first screen; each page after it is one of the page's screens. One sea runs along all the
// pages after the first and stays on the wall while the view travels along it, and only each
// page's own blocks, its frames, bands, and medallions, and on the first screen the name,
// lift, fly on into the next page's, and settle. Page k rests at k steps, and each turn to
// the next is in three parts: over the first `rise` of a step every stone of the page's own
// blocks lifts off the wall together, `lift` millimetres, a touch askew; then the view
// travels one page to the right along the wall while the stones fly on, close to the wall and
// almost all at once, into the next page's places, landing hovering as the view arrives; and
// over the last `settle` of the step they come down onto the wall together. A turn backward
// is the same played in reverse, so either way it starts and ends with a lift.
const TURN = { step: 3, rise: 0.3, settle: 0.3, lift: 60, arc: 0.3 };
export function stageFilm(cover, screens, { module, band }) {
  const m = cover.scale, W = cover.width * m, H = cover.height * m;
  const { step, rise, settle, lift, arc } = TURN;
  const n = screens.length, end = n * step + 0.2;
  // The time a share f of the way through the turn to page j.
  const at = (j, f) => (j - 1 + f) * step;
  const scenes = [
    { id: "sea", picture: { module, export: "seaPicture", args: { pages: n, width: cover.width, height: cover.height, scale: m } }, start: 0, end, at: [W, 0], in: { type: "settled" } },
    { id: "name", picture: { module, export: "namePicture", args: cover }, start: 0, end: step, at: [0, 0], front: true, in: { type: "settled" } },
    ...screens.map((layout, i) => {
      const j = i + 1;
      return {
        id: `page-${j}`,
        picture: { module, export: "blocksPicture", args: { ...layout, seed: 4242 + 97 * i } },
        start: at(j, 0),
        end: j < n ? (j + 1) * step : end,
        at: [j * W, 0],
        front: true,
        in: {
          type: "flow", arc, focus: [W / 2, H / 2],
          rise: [at(j, 0.01), at(j, rise - 0.01), lift],
          launch: [at(j, rise), at(j, rise + 0.04)],
          land: [at(j, 1 - settle - 0.08), at(j, 1 - settle)],
          settle: [at(j, 1 - settle + 0.01), at(j, 0.99)]
        }
      };
    })
  ];
  const project = { version: 1, title: "mosAIc", seed: 42, fps: [60, 1], frames: Math.ceil(end * 60) + 1, band, look: [[0, 1], [end, 1]], scenes };
  return { project, step, rise, settle };
}

// A page's own blocks alone, to be set on the stage over the sea.
export function blocksPicture(layout) {
  return wallPicture({ ...layout, blocksOnly: true });
}

// The sea the stage's pages stand in: one wall of deep water and currents along `pages`
// screens side by side, which the view travels along, its stones still as the pages turn.
export function seaPicture({ pages, width, height, scale, seed = 4242 }) {
  const k = scale / DESKTOP, Wp = width * scale, W = Wp * pages, H = height * scale;
  const res = Math.min(0.75, 8192 / H, 8192 / W, Math.sqrt(8e6 / (W * H)));
  const R = rng(seed);
  // Each screen's own currents, so no two are alike.
  const currents = [];
  for (let p = 0; p < pages; p++) {
    for (let y = (120 + 200 * R()) * k; y < H - 80 * k; y += (300 + 380 * R()) * k) currents.push({ p, c: current(y, Wp, R, k) });
  }
  return {
    config: {
      panel: { w: W, h: H }, res, background: "deep",
      camera: { keys: [[0, Wp / 2, H / 2, Wp]], tilt: 0, yaw: 0, aperture: 0.004, drift: 0 },
      light: house.light, sinopia: false
    },
    regions: () => [
      { name: "deep", size: 15 * k, mode: "contour", mat: "glass", tray: ["#0e2633", "#12303f", "#173a4a", "#1d4456", "#235066"] },
      { name: "drift", size: 13 * k, mode: "contour", mat: "glass", tray: ["#1d3f4d", "#28515e", "#356471", "#467683"] },
      { name: "spray", size: 7 * k, mode: "contour", mat: "glass", tray: ["#3f6c7a", "#5d8792", "#88a9a8"] }
    ],
    draw(g, mode, D) {
      D.fill(box(-10, -10, W + 20, H + 20), "deep", D.linear(0, 0, 0, H, [[0, "#173b4b"], [1, "#12303f"]]));
      for (const { p, c } of currents) {
        g.save();
        g.translate(p * Wp, 0);
        D.fill(c.path, "drift", "#356471");
        if (c.crest) D.line(poly(c.crest.filter((_, i) => i % 2 === 0), false), 4.5 * k, "spray", "#5d8792");
        g.restore();
      }
    }
  };
}

// How far a current tapers where it ends partway across, in millimetres of a desktop wall.
const TAPER = 220;
// A current: a wavy band between two wavy edges. Some cross the whole wall; others rise
// from one side and taper out partway across. Its edges are kept as [x, top, bottom] at
// every corner of its outline.
function current(y, W, R, k) {
  const amp = (12 + 26 * R()) * k, len = (560 + 760 * R()) * k, phase = 6.28 * R(), thick = (16 + 22 * R()) * k;
  const across = R() < 0.5;
  const fromLeft = R() < 0.5;
  const reach = W * (0.45 + 0.4 * R());
  const x0 = across || fromLeft ? -40 : W - reach, x1 = across || !fromLeft ? W + 40 : reach;
  const top = [], bottom = [], edges = [];
  for (let x = x0; x <= x1; x += 16 * k) {
    const u = (x / len) * 6.2832 + phase;
    const c = y + amp * Math.sin(u) + amp * 0.35 * Math.sin(u * 2.3 + 1.7);
    const taper = Math.min(1, x0 < 0 ? 1 : (x - x0) / (TAPER * k), x1 > W ? 1 : (x1 - x) / (TAPER * k));
    const t = Math.max(1.5, thick * (0.55 + 0.45 * Math.sin(u * 0.7 + 0.4)) * taper);
    top.push([x, c - t / 2]);
    bottom.unshift([x, c + t / 2]);
    edges.push([x, c - t / 2, c + t / 2]);
  }
  return { path: poly(top.concat(bottom)), edges, crest: R() < 0.6 ? top.slice(2, -2) : null };
}

// The span of y an outline covers at x, if it reaches that far: a circle, or a rounded rect
// with the corners rounded() gives it.
function spanAt(o, x) {
  if (o.cx !== undefined) {
    const h = o.r * o.r - (x - o.cx) ** 2;
    return h > 0 ? [o.cy - Math.sqrt(h), o.cy + Math.sqrt(h)] : null;
  }
  if (x <= o.x || x >= o.x + o.w) return null;
  const r = Math.min(o.r, o.w / 2, o.h / 2);
  const d = Math.max(0, o.x + r - x, x - (o.x + o.w - r));
  const inset = r - Math.sqrt(r * r - d * d);
  return [o.y + inset, o.y + o.h - inset];
}

// layout: page width and height and the hero's foot (CSS px), the scale, and the marked
// blocks, each { kind, x, y, w, h } in page pixels, with a material for medallions.
export function wallPicture(layout) {
  const m = layout.scale ?? wallScale(layout.width);
  // Stones of the page's own features keep their size on screen at any scale.
  const k = m / DESKTOP;
  const W = layout.width * m;
  const H = layout.height * m;
  // A page of the stage is its blocks alone, set over the stage's sea; the page's picture
  // starts its water under the first screen.
  const seam = layout.blocksOnly ? 0 : layout.hero * m;
  const blocks = layout.blocks.map((b) => ({ ...b, x: b.x * m, y: b.y * m, w: b.w * m, h: b.h * m }));
  const frame = 10 * k, margin = 14 * k;
  // What each block lays on the wall: a band and its margin, a tablet or an emblem and its
  // gold frame, or a medallion out to its gold ring.
  for (const b of blocks) {
    const p = b.kind === "band" ? margin : frame;
    b.outline = b.kind === "medallion"
      ? { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.min(b.w, b.h) / 2 + frame * 0.8 }
      : { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p, r: b.kind === "band" ? margin : 4 * k };
  }

  // The open wall decides how coarse the deep water can be and still fit the budget.
  const covered = blocks.reduce((a, b) => a + (b.kind === "band" ? 0 : (b.w + 2 * frame) * (b.h + 2 * frame)), 0);
  const open = Math.max(1, W * Math.max(0, H - seam) - covered);
  const deep = clamp(Math.sqrt(open / ((BUDGET - 14000) * 0.8)), 14 * k, 24 * k);
  // The working raster stays within 8 megapixels and 8192 pixels a side.
  const res = Math.min(0.75, 8192 / H, 8192 / W, Math.sqrt(8e6 / (W * H)));

  const R = rng(layout.seed ?? 4242);
  const currents = [];
  if (!layout.blocksOnly) for (let y = seam + 300 * k; y < H - 160 * k; y += (460 + 520 * R()) * k) currents.push(current(y, W, R, k));

  // Whether the blocks leave the wall at x open anywhere from y0 to y1, by more than a
  // millimetre.
  function openAt(x, y0, y1) {
    const spans = blocks.map((b) => spanAt(b.outline, x)).filter(Boolean).sort((a, b) => a[0] - b[0]);
    for (const [a, b] of spans) {
      if (y0 >= y1 - 1) return false;
      if (a > y0 + 1) return true;
      y0 = Math.max(y0, b);
    }
    return y0 < y1 - 1;
  }

  // A current runs under the blocks and surfaces wherever the wall is open. Where it comes up
  // for less than the length it tapers over, and for less than it stays under on either
  // side, it would show as a stray fragment, so the water is laid over it again. These are
  // those stretches, each from one place the blocks cover the current to the next, or null
  // if it has none.
  function sunk(c) {
    // Its crest's stroke reaches above its top edge.
    const lift = c.crest ? 4.5 * k : 0;
    // Where it shows: runs from the first to the last place it shows, with the places the
    // blocks cover it just before and after, or null at its own ends.
    const runs = [];
    let run = null, shut = null;
    c.edges.forEach(([x0, top0, bottom0], i) => {
      const [x1, top1, bottom1] = c.edges[i + 1] || c.edges[i];
      // A millimetre or so at a time, along the straight edges between its corners.
      for (let f = 0; f < 1; f += 1 / 16) {
        const x = x0 + (x1 - x0) * f;
        if (x < 0 || x > W || openAt(x, top0 + (top1 - top0) * f - lift, bottom0 + (bottom1 - bottom0) * f)) {
          if (!run) runs.push((run = { first: x, last: x, before: shut, after: null }));
          run.last = x;
        } else {
          if (run) run.after = x;
          run = null;
          shut = x;
        }
      }
    });
    const top = Math.min(...c.edges.map((e) => e[1])) - lift - 2, bottom = Math.max(...c.edges.map((e) => e[2])) + 2;
    const stretches = new Path2D();
    let any = false;
    runs.forEach((r, i) => {
      if (r.before === null || r.after === null) return;
      const shows = r.last - r.first;
      const under = Math.min(i > 0 ? r.first - runs[i - 1].last : Infinity, i + 1 < runs.length ? runs[i + 1].first - r.last : Infinity);
      if (shows < TAPER * k && under > shows) {
        stretches.rect(r.before, top, r.after - r.before, bottom - top);
        any = true;
      }
    });
    return any ? stretches : null;
  }
  for (const c of currents) c.sunk = sunk(c);

  const medallions = blocks.filter((b) => b.kind === "medallion");
  const sample = (name) => SAMPLES.find((s) => s.name === name) || SAMPLES[0];

  const regions = () => [
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
    // A page's own blocks alone, set over the sea, have no water of their own.
    if (layout.blocksOnly) {
      D.fill(box(-10, -10, W + 20, H + 20), "none", "#bdb3a2");
      return drawBlocks(D);
    }
    // The water deepens on down the page from the shoreline.
    const water = D.linear(0, seam, 0, seam + 900 * k, [[0, "#173b4b"], [1, "#12303f"]]);
    D.fill(box(-10, seam, W + 20, H - seam + 10), "deep", water);
    for (const c of currents) {
      D.fill(c.path, "drift", "#356471");
      if (c.crest) D.line(poly(c.crest.filter((_, i) => i % 2 === 0), false), 4.5 * k, "spray", "#5d8792");
      if (c.sunk) D.fill(c.sunk, "deep", water);
    }
    drawBlocks(D);
    // The scenes fill everything above the shoreline with their own stones.
    D.fill(poly([[-20, -10], [W + 20, -10], ...shoreline(seam, -20, W + 20).reverse()]), "none", "#bdb3a2");
  }

  // Every block the page marks out, as it lies on the wall.
  function drawBlocks(D) {
    for (const b of blocks) {
      const o = b.outline;
      if (b.kind === "band") {
        D.fill(rounded(o.x, o.y, o.w, o.h, o.r), "band", "#163646");
      } else if (b.kind === "medallion") {
        const i = medallions.indexOf(b);
        const r = Math.min(b.w, b.h) / 2;
        D.fill(circle(o.cx, o.cy, o.r), "frame", "#b18a50");
        D.fill(circle(o.cx, o.cy, r), `face-${i}`, sample(b.material).field[2]);
        const heart = sample(b.material).disc[1];
        D.fill(circle(o.cx, o.cy, r * 0.46), `heart-${i}`, typeof heart === "string" ? heart : heart.hex);
      } else {
        // A tablet or an emblem: a gold frame round a bare patch the page covers.
        D.fill(rounded(o.x, o.y, o.w, o.h, o.r), "frame", "#b18a50");
        D.fill(box(b.x, b.y, b.w, b.h), "none", "#bdb3a2");
      }
    }
  }

  return {
    config: {
      panel: { w: W, h: H },
      res,
      background: layout.blocksOnly ? "frame" : "deep",
      // The page only ever shows a stretch of the wall, so its stones are drawn by rows.
      rows: true,
      camera: { keys: [[0, W / 2, layout.blocksOnly ? H / 2 : Math.min(H, seam) / 2, W]], tilt: 0, yaw: 0, aperture: 0.004, drift: 0 },
      light: house.light,
      // Laid straight onto the bare plaster, like the name and the scenes.
      sinopia: false,
      // Laid from below the first screen while the first scene is laid, then on down the
      // page, all before the scenes begin to flow.
      build: {
        origin: [W / 2, seam + 120],
        start: WORLD,
        end: LAID - 0.3,
        rise: 0.08,
        speeds: { frame: 2.4, band: 1.6, "face-*": 1.8, "heart-*": 1.8 }
      }
    },
    regions,
    draw
  };
}
