// The project page as one wall. Where there is room for it, the page's screens stand side by
// side along one wide wall: the name set in stone on the first screen, every frame, opening,
// and sample the page marks out set where it stands, and behind them one of four scenes run
// on along the whole wall, which every so often flows into the next. Elsewhere the page is a
// column: the name in still water under the moon, and the page picture running its water on
// down the page around the page's blocks, so the courses follow the page the way they follow
// a drawing. On both, the last band of the method's picture is laid by the wall itself.
import { nameAlone, nameAt } from "../examples/inscription.js";
import { SCENE_NAMES, scene, stageOn } from "../examples/landscapes.js";
import { config as house, draw as drawNocturne, regions as nocturneRegions } from "../examples/nocturne.js";
import { SAMPLES } from "../examples/materials.js";
import { BANDS as CURRENT_BANDS, config as currents, draw as drawCurrents, regions as currentRegions } from "../examples/currents.js";
import { circle, poly } from "../engine/paint.js";
import { clamp, rng } from "../engine/util.js";

// The scene the name stands in on the first screen: still water under the moon.
const SCENE = SCENE_NAMES[0];
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
// screen, so the two meet like two bodies of water instead of along a straight cut. It lies at
// most 100 mm below the first screen, and home/style.css keeps a phone's first room clear of it.
const TAIL = 130;
function shoreline(seam, x0, x1) {
  const pts = [];
  for (let x = x0; x <= x1; x += 20) pts.push([x, seam + 62 + 26 * Math.sin(x / 260 + 0.8) + 12 * Math.sin(x / 97 + 2.1)]);
  return pts;
}

// The film: the name is laid first, by GATE, where the page waits until every picture has
// joined the wall. The scene and the page are laid around it from WORLD, late enough that no
// lime is spread nor stone falls before the gate, and by LAID, where the wall rests: from
// then on its stones move only under the hand.
const GATE = 2.4, WORLD = GATE + 0.6, LAID = 6.4;

// The column's film for a layout: its project, whose pictures this module, at `module`, draws
// by name, so workers can cut them; the time by which every picture must have joined it; and
// the time it rests at. Where `flow` is set, as on a phone where motion is welcome, the scenes
// behind the name then flow into one another on the first screen, in the wide wall's chain,
// and the film also gives the times the scenes rest at, the pictures the page waits for
// before it lays the wall past the gate, and those it waits for before the scenes flow.
export function wallFilm(layout, { module, laid = true, band, flow = false }) {
  const arrive = laid ? { type: "laid", bed: 0 } : { type: "settled" };
  const picture = (name, first) => ({ module, export: "scenePicture", args: { ...layout, scene: name, first } });
  if (!flow) {
    const end = LAID + 0.1;
    const project = {
      version: 1, title: "mosAIc", seed: 42, fps: [60, 1], frames: Math.ceil(end * 60) + 1, band, look: [[0, 1], [end, 1]],
      scenes: [
        { id: "name", picture: { module, export: "namePicture", args: layout }, start: 0, end, at: [0, 0], in: arrive },
        { id: "page", picture: { module, export: "wallPicture", args: layout }, start: 0, end, at: [0, 0], in: arrive },
        { id: SCENE, picture: picture(SCENE, true), start: 0, end, at: [0, 0], in: arrive },
        ...liveScenes(layout, { module, arrive, end })
      ]
    };
    return { project, gate: GATE, rest: LAID };
  }
  const { W, middle } = firstScreen(layout);
  const { names, ids, from, rest, end } = chain();
  const project = {
    version: 1, title: "mosAIc", seed: 42, fps: [60, 1], frames: Math.ceil(end * 60) + 1, band, look: [[0, 1], [end, 1]],
    scenes: [
      { id: "name", picture: { module, export: "namePicture", args: layout }, start: 0, end, at: [0, 0], in: arrive },
      { id: "page", picture: { module, export: "wallPicture", args: layout }, start: 0, end, at: [0, 0], in: arrive },
      { id: "laying", picture: picture(names[0], true), start: 0, end: SWAP, at: [0, 0], in: arrive },
      ...liveScenes(layout, { module, arrive, end }),
      ...names.map((name, i) => ({
        id: ids[i],
        picture: picture(name, false),
        start: i ? from(i) : SWAP,
        end: i < names.length - 1 ? rest(i + 1) : end,
        at: [0, 0],
        in: i ? { type: "flow", launch: [from(i), from(i) + 0.8], land: [from(i) + 1, from(i) + FLOW], focus: [[W / 2, middle]], reach: 0.75 * W } : { type: "settled" }
      }))
    ]
  };
  const first = ["name", "page", "laying", ...project.scenes.filter((x) => x.id === "method").map((x) => x.id)];
  return { project, gate: GATE, laid: LAID, rest: rest(0), rests: names.map((_, i) => rest(i)), first, cycle: ids };
}

// The method's live band, where the page has one: the rest of its picture in the wall's own
// stones, set in front of the scenes, laid from `origin` on the wall when it is laid. The band
// names its picture: the heron by the moon, across a wide screen, or the currents, down a phone.
function liveScenes(layout, { module, arrive, end, origin }) {
  const b = layout.blocks.find((block) => block.kind === "live");
  if (!b) return [];
  const m = layout.scale ?? wallScale(layout.width), at = [b.x * m, b.y * m];
  const arrival = origin && arrive.type === "laid" ? { ...arrive, build: { origin: [origin[0] - at[0], origin[1] - at[1]] } } : arrive;
  const picture = b.picture === "currents" ? "currentsPicture" : "methodPicture";
  return [{ id: "method", picture: { module, export: picture, args: { w: b.w * m, h: b.h * m } }, start: 0, end, at, in: arrival, front: true }];
}

// The last band of the method's picture: the nocturne from x0 millimetres across its panel to
// its right edge, where the other bands leave off, scaled to cover w by h millimetres of wall:
// a band taller than that stretch, as on a phone, keeps its left edge, so the moon goes on
// from the band beside it, and loses the right. On a desktop the band has the stretch's own
// shape, so none of it is lost. It is cut from the same raster as the
// nocturne itself, so its stones are the nocturne's own, scaled with it.
export function methodPicture({ w, h, x0 = 1110 }) {
  const s = Math.max(w / (1600 - x0), h / 900);
  const left = x0, top = (900 - h / s) / 2;
  return {
    config: {
      panel: { w, h }, res: (house.res ?? 1) / s, background: "sky",
      camera: { keys: [[0, w / 2, h / 2, w]], tilt: 0, yaw: 0, aperture: 0.004, drift: 0 },
      light: house.light, sinopia: false,
      // The band moves on its own under the pointer, inside its frame, as a sample does.
      insets: [[0, 0, w, h]],
      build: { origin: [w / 2, h / 2], start: WORLD, end: LAID - 0.3, rise: 0.08 }
    },
    regions: () => nocturneRegions().map((r) => ({ ...r, size: r.size * s, ...(r.center && { center: [(r.center[0] - left) * s, (r.center[1] - top) * s] }) })),
    draw(g, mode, D) {
      g.save();
      g.transform(s, 0, 0, s, -left * s, -top * s);
      drawNocturne(g, mode, D);
      g.restore();
    }
  };
}

// The last band of the currents, the method's picture on a phone: the currents from y0
// millimetres down their panel to its foot, where the other bands leave off, scaled to cover w
// by h millimetres of wall and cropped from its middle across.
export function currentsPicture({ w, h, y0 = CURRENT_BANDS[2] }) {
  const { w: W, h: H } = currents.panel;
  const s = Math.max(w / W, h / (H - y0));
  const left = (W - w / s) / 2, top = y0;
  return {
    config: {
      panel: { w, h }, res: (currents.res ?? 1) / s, background: currents.background,
      camera: { keys: [[0, w / 2, h / 2, w]], tilt: 0, yaw: 0, aperture: 0.004, drift: 0 },
      light: currents.light, sinopia: false,
      // The band moves on its own under the pointer, inside its frame, as a sample does.
      insets: [[0, 0, w, h]],
      build: { origin: [w / 2, h / 2], start: WORLD, end: LAID - 0.3, rise: 0.08 }
    },
    regions: () => currentRegions().map((r) => ({ ...r, size: r.size * s })),
    draw(g, mode, D) {
      g.save();
      g.transform(s, 0, 0, s, -left * s, -top * s);
      drawCurrents(g, mode, D);
      g.restore();
    }
  };
}

// The name alone, its letters set on the first screen, laid quickly from its middle.
export function namePicture(layout) {
  const { W, screen, band, middle } = firstScreen(layout);
  const p = nameAlone({ w: W, h: screen, screen: band });
  return { ...p, config: { ...p.config, rows: true, build: { origin: [W / 2, middle], start: 0.2, end: GATE } } };
}

// The scene behind the name, on the first screen and on down to the shoreline, laid outward
// from behind the name once the name is laid, if it is the `first`; any other flows in.
export function scenePicture({ scene: name, first = true, ...layout }) {
  const { W, screen, middle, k } = firstScreen(layout);
  const p = scene({ name, w: W, h: screen + TAIL, screen, k, build: first ? { origin: [W / 2, middle], start: WORLD, end: LAID - 0.4 } : undefined });
  return {
    config: { ...p.config, rows: true },
    regions: p.regions,
    draw(g, mode, D) {
      p.draw(g, mode, D);
      D.fill(poly([...shoreline(screen, -20, W + 20), [W + 20, screen + TAIL + 10], [-20, screen + TAIL + 10]]), "none", "#bdb3a2");
    }
  };
}

// The wide wall: the page's screens side by side, each `layout.width` by `layout.hero` CSS
// pixels, `layout.screens` of them. The name is laid first on the first screen, by GATE, and
// the page's blocks and the first scene, night, around it by LAID, from a picture of its own,
// so that it never waits on the others; they are laid outward from behind the name, or from
// the middle of screen `at` where the page opens further along. At SWAP an identical night
// takes its place at rest, the first of a chain cut in one worker, and from there each scene
// flows into the next in turn, the last into a copy of the first, from which the film loops
// back. A flow starts LEAD after the rest before it and takes FLOW seconds, and each scene
// settles for SETTLE before it rests, where the page holds it as long as it likes. Every
// flow pairs its stones within each screen and runs its wave out from each screen's middle,
// the name's on the first, so every screen sees the whole flow as the first screen used to.
const LEAD = 0.1, FLOW = 2.4, SETTLE = 0.3, SWAP = LAID + 0.1;

// The chain of scenes, on the wide wall and on a column's first screen alike: the scenes in
// turn and the first again, their ids, when the i-th starts to flow in, when it rests, and
// when the film ends.
function chain() {
  const names = [...SCENE_NAMES, SCENE_NAMES[0]];
  const ids = names.map((name, i) => (i < names.length - 1 ? name : `${name}-again`));
  const from = (i) => SWAP + LEAD + (i - 1) * (FLOW + SETTLE + LEAD);
  const rest = (i) => (i ? from(i) + FLOW + SETTLE : SWAP + 0.05);
  return { names, ids, from, rest, end: rest(names.length - 1) };
}

export function wideFilm(layout, { module, laid = true, band, at = 0 }) {
  const { W, screen, middle } = firstScreen(layout);
  const n = layout.screens, total = W * n;
  const arrive = laid ? { type: "laid", bed: 0 } : { type: "settled" };
  const origin = at > 0 ? [W * (at + 0.5), screen / 2] : [W / 2, middle];
  const around = laid ? { ...arrive, build: { origin } } : arrive;
  const { names, ids, from, rest, end } = chain();
  const focus = [[W / 2, middle], ...Array.from({ length: n - 1 }, (_, i) => [W * (i + 1.5), screen / 2])];
  const picture = (name, first) => ({ module, export: "panoramaPicture", args: { ...layout, scene: name, ...(first && { first }) } });
  const project = {
    version: 1, title: "mosAIc", seed: 42, fps: [60, 1], frames: Math.ceil(end * 60) + 1, band, look: [[0, 1], [end, 1]],
    scenes: [
      { id: "name", picture: { module, export: "namePicture", args: layout }, start: 0, end, at: [0, 0], in: arrive },
      { id: "blocks", picture: { module, export: "blocksPicture", args: { ...layout, width: layout.width * n, columns: layout.width } }, start: 0, end, at: [0, 0], in: around, front: true },
      { id: "laying", picture: picture(names[0], true), start: 0, end: SWAP, at: [0, 0], in: around },
      ...liveScenes(layout, { module, arrive, end, origin }),
      ...names.map((name, i) => ({
        id: ids[i],
        picture: picture(name),
        start: i ? from(i) : SWAP,
        end: i < names.length - 1 ? rest(i + 1) : end,
        at: [0, 0],
        in: i ? { type: "flow", launch: [from(i), from(i) + 0.8], land: [from(i) + 1, from(i) + FLOW], focus, reach: 0.75 * W, columns: W } : { type: "settled" }
      }))
    ]
  };
  // The pictures the page waits for before it lays the wall past the gate, and before it lets
  // the scenes flow; the times it rests at; and the loop.
  const first = ["name", "blocks", "laying", ...project.scenes.filter((x) => x.id === "method").map((x) => x.id)];
  return { project, gate: GATE, laid: LAID, rests: names.map((_, i) => rest(i)), loop: [rest(0), end], first, cycle: ids };
}

// Stones each scene has on a desktop's first screen at a desktop page's size, with a little
// over for the panorama's own, and the most a scene's picture may hold.
const SCENE_STONES = { night: 9200, dunes: 9300, currents: 10900, peaks: 11000 };
const SCENE_BUDGET = 56000;

// One of the scenes as a panorama along the whole wide wall, behind the name. The first is
// laid outward from behind the name once the name is laid; the others flow in. On a wall
// long enough to need more stones than a picture can hold, the stones are larger. They are
// cut from a raster of half a pixel a millimetre, fine enough for stones a dozen
// millimetres across and light enough for six such pictures along the wall, within 8192
// pixels a side.
export function panoramaPicture({ scene: name, first = false, ...layout }) {
  const { W, screen, middle, k } = firstScreen(layout);
  const total = W * layout.screens;
  const stones = ((SCENE_STONES[name] ?? 11000) * total * screen) / (1600 * 900);
  const size = Math.max(k, Math.sqrt(stones / SCENE_BUDGET));
  const res = Math.min(0.5, 8192 / total, 8192 / screen);
  const p = scene({ name, w: W, h: screen, screen, total, k: size, res, build: first ? { origin: [W / 2, middle], start: WORLD, end: LAID - 0.4 } : undefined });
  // Its flows pair stones within each screen, so a frame draws only the screens within one of
  // its view.
  return { ...p, config: { ...p.config, columns: W } };
}

// The page's own blocks alone, to be set on the wide wall in front of its scenes, its stones
// listed by screens `columns` CSS pixels wide.
export function blocksPicture({ columns, ...layout }) {
  const p = wallPicture({ ...layout, blocksOnly: true });
  return { ...p, config: { ...p.config, columns: columns * layout.scale } };
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
// blocks, each { kind, x, y, w, h } in page pixels, with a material for samples. An emblem is
// a picture or film the page shows, which the wall frames in gold; a frame is the gold alone,
// round openings the page fills; live is an opening the wall fills with a picture of its own;
// and a sample is a square of one material set in the wall, in a thin gold rim.
export function wallPicture(layout) {
  const m = layout.scale ?? wallScale(layout.width);
  // Stones of the page's own features keep their size on screen at any scale.
  const k = m / DESKTOP;
  const W = layout.width * m;
  const H = layout.height * m;
  // The wide wall's blocks are set alone, in front of its scenes; the column's picture
  // starts its water under the first screen.
  const seam = layout.blocksOnly ? 0 : layout.hero * m;
  const blocks = layout.blocks.map((b) => ({ ...b, x: b.x * m, y: b.y * m, w: b.w * m, h: b.h * m }));
  const frame = 10 * k, rim = 6 * k;
  // What each block lays on the wall, out to its gold.
  for (const b of blocks) {
    const p = b.kind === "sample" ? rim : b.kind === "emblem" || b.kind === "frame" ? frame : 0;
    b.outline = { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p, r: p ? 4 * k : 0 };
  }

  // The open wall decides how coarse the deep water can be and still fit the budget.
  const covered = blocks.reduce((a, b) => a + (b.kind === "opening" || b.kind === "live" ? 0 : b.outline.w * b.outline.h), 0);
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

  const samples = blocks.filter((b) => b.kind === "sample");
  const sample = (name) => SAMPLES.find((s) => s.name === name) || SAMPLES[0];

  const regions = () => [
    { name: "deep", size: deep, mode: "contour", mat: "glass", tray: ["#0e2633", "#12303f", "#173a4a", "#1d4456", "#235066"] },
    { name: "drift", size: Math.min(deep, 13 * k), mode: "contour", mat: "glass", tray: ["#1d3f4d", "#28515e", "#356471", "#467683"] },
    { name: "spray", size: 7 * k, mode: "contour", mat: "glass", tray: ["#3f6c7a", "#5d8792", "#88a9a8"] },
    // The gold round every picture, sample, and opening holds still under the pointer, from
    // whichever side it comes.
    { name: "frame", size: 7 * k, mode: "contour", mat: "gold", still: true, tray: ["#b18a50", "#c99d5c", "#d8b571", "#efcf91"] },
    // Each sample is the same motif: a disc whose courses run round its middle, in a field
    // whose courses follow the square and wrap round the disc, both in the sample's material.
    ...samples.flatMap((b, i) => {
      const s = sample(b.material);
      const center = [b.x + b.w / 2, b.y + b.h / 2];
      return [
        { name: `field-${i}`, size: 8 * k, mode: "contour", mat: s.mat, tray: s.field },
        { name: `disc-${i}`, size: 6.5 * k, mode: "radial", center, mat: s.mat, tray: s.disc }
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

  // Every block the page marks out, as it lies on the wall, in the page's order, so a frame
  // is laid before the openings in it.
  function drawBlocks(D) {
    for (const b of blocks) {
      const o = b.outline;
      if (b.kind === "sample") {
        const i = samples.indexOf(b), s = sample(b.material);
        const disc = typeof s.disc[1] === "string" ? s.disc[1] : s.disc[1].hex;
        D.fill(rounded(o.x, o.y, o.w, o.h, o.r), "frame", "#b18a50");
        D.fill(box(b.x, b.y, b.w, b.h), `field-${i}`, s.field[2]);
        D.fill(circle(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) * 0.3), `disc-${i}`, disc);
      } else if (b.kind === "emblem" || b.kind === "frame") {
        D.fill(rounded(o.x, o.y, o.w, o.h, o.r), "frame", "#b18a50");
      }
      // An emblem's picture, an opening, and a live band are bare patches the page, or the
      // wall's own picture, covers.
      if (b.kind === "emblem" || b.kind === "opening" || b.kind === "live") D.fill(box(b.x, b.y, b.w, b.h), "none", "#bdb3a2");
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
      // Each material sample moves on its own under the pointer, inside its rim, and the
      // wall round it stays still.
      insets: samples.map((b) => [b.x, b.y, b.w, b.h]),
      // Laid from below the first screen while the first scene is laid, then on down the
      // page, all before the scenes begin to flow.
      build: {
        origin: [W / 2, seam + 120],
        start: WORLD,
        end: LAID - 0.3,
        rise: 0.08,
        speeds: { frame: 2.4, "field-*": 1.8, "disc-*": 1.8 }
      }
    },
    regions,
    draw
  };
}
