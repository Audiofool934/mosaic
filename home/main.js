import { createMosaic } from "../engine/runtime.js";
import { createStoneSound } from "../engine/sound.js";
import { createGallery } from "./gallery.js";
import { ITEMS } from "./bar.js";
import { createBar } from "./nav.js";
import { watchRooms } from "./rooms.js";
import { createStage } from "./stage.js";
import { wallFilm, wallScale } from "./wall.js";

const $ = (id) => document.getElementById(id);
const wall = $("wall");
const note = $("wall-note");
const replay = $("wall-replay");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
// The canvas reaches this share of the viewport above and below it, so a fast scroll never
// outruns the stones between two frames.
const OVERSCAN = 0.15;
// How long the page holds each scene behind the name, in seconds, and the first scene, once
// it has been laid.
const HOLD = 6;
const FIRST = 2.5;
// The page turns its screens on a stage where motion is welcome and the screen is tall
// enough to hold a room; elsewhere it scrolls as a page.
const STAGE_HEIGHT = 540;
const staged = () => !reduceMotion.matches && innerHeight >= STAGE_HEIGHT && wall.dataset.state !== "still";
let stage = null;

// The wall on screen: its controller, its canvas, the millimetres of wall in each CSS
// pixel, and the stretch of page its canvas covers.
let live = null;
let budget = 2.6e6;
let tallest = 0;
let generation = 0;
let resizeTimer = 0;
let building = Promise.resolve();
let lastLog = [];

// Every block marked data-wall, in page pixels: the stones are cut around these.
function measure() {
  const top = window.scrollY;
  const blocks = [...document.querySelectorAll("[data-wall]")].filter((el) => !el.hidden).map((el) => {
    const r = el.getBoundingClientRect();
    return { kind: el.dataset.wall, material: el.dataset.material, x: r.left, y: r.top + top, w: r.width, h: r.height };
  });
  const width = document.documentElement.clientWidth;
  return { width, height: document.documentElement.scrollHeight, hero: $("hero").getBoundingClientRect().bottom + top, blocks, scale: wallScale(width) };
}

// The canvas spans the page width and the tallest viewport seen, with a margin above and
// below; a dense display draws at most `budget` pixels and is upscaled past that. On the
// stage it covers the first screen only, and goes with it.
function canvasView() {
  tallest = Math.max(tallest, window.innerHeight);
  const width = document.documentElement.clientWidth;
  const margin = stage ? 0 : Math.round(tallest * OVERSCAN);
  const height = stage ? Math.round($("top").getBoundingClientRect().height) : tallest + 2 * margin;
  const k = Math.min(Math.min(devicePixelRatio || 1, 2), Math.sqrt(budget / (width * height)));
  return { width, height, margin, px: [Math.round(width * k), Math.round(height * k)] };
}

// Read once for each frame drawn: the canvas follows the scroll, and the camera looks at
// the same stretch of wall, so both move in the same task. On the stage the first screen's
// canvas scrolls with it, and looks at it alone.
function framing(canvas, scale, view) {
  if (stage) return { x: (view.width * scale) / 2, y: (view.height * scale) / 2, w: view.width * scale };
  return () => {
    const y = window.scrollY - view.margin;
    canvas.style.transform = `translate3d(0, ${y}px, 0)`;
    return { x: (view.width * scale) / 2, y: (y + view.height / 2) * scale, w: view.width * scale };
  };
}

function updateControls() {
  if (!live) return;
  replay.hidden = reduceMotion.matches;
  replay.dataset.state = cycling ? "playing" : "paused";
  const label = cycling ? "Pause the scenes" : "Play the scenes";
  replay.setAttribute("aria-label", label);
  replay.title = label;
}

// The scenes behind the name: the wall plays until its next rest, where the page holds the
// scene for a while, then plays on into the next. It holds while the first screen is out of
// view, and stops when paused. While it is first laid, it waits at the gate until every
// picture has joined it, so none appears half laid.
let cycling = false;
let holding = 0;
let held = false;
let heroInView = true;
// Whether the stage holds the first screen lifted or slid away, when its scenes hold still.
let covered = false;
let watching = 0;
let checked = 0;
let frameTimes = [];

function hold(seconds) {
  clearTimeout(holding);
  held = true;
  holding = setTimeout(() => {
    held = false;
    advance();
  }, seconds * 1000);
}

function advance() {
  if (!live || !cycling || held || !heroInView || covered) return;
  const { time, playing } = live.mosaic.getState();
  if (playing || (!live.joined && time >= live.gate)) return;
  live.mosaic.play();
  watch();
}

// Each frame while the wall plays: has it passed a rest, counting a jump back to the loop's
// start as passing the rest there? And while it is laid, if frames come too slowly, the
// canvas draws fewer pixels from then on.
function watch() {
  cancelAnimationFrame(watching);
  let last = 0;
  const step = (now) => {
    watching = 0;
    if (!live) return;
    const { time, playing } = live.mosaic.getState();
    if (!playing) return;
    if (!live.joined && time >= live.gate) {
      live.mosaic.pause();
      checked = time;
      return;
    }
    const looped = time < checked;
    if (looped || live.rests.some((r) => checked < r && time >= r)) {
      // The first rest, once the wall is first laid, is shorter.
      const first = !looped && checked < live.rests[0] && time >= live.rests[0];
      live.mosaic.pause();
      checked = time;
      hold(first ? FIRST : HOLD);
      return;
    }
    checked = time;
    if (last && frameTimes.length < 90) frameTimes.push(now - last);
    last = now;
    if (frameTimes.length === 90 && budget > 0.9e6) {
      if ([...frameTimes].sort((a, b) => a - b)[45] > 28) lighten();
      frameTimes.push(0);
    }
    watching = requestAnimationFrame(step);
  };
  watching = requestAnimationFrame(step);
}

function lighten() {
  budget /= 2;
  const view = canvasView();
  live.view = view;
  live.canvas.style.height = `${view.height}px`;
  live.mosaic.resize(view.px[0], view.px[1]);
  live.mosaic.setView({ frame: framing(live.canvas, live.scale, view) });
}

async function build() {
  const token = ++generation;
  await document.fonts?.ready;
  // The stage is set up anew for each layout, since a new width can set rooms as pages, and
  // keeps the page it was on.
  const at = stage ? Math.round(stage.view) : null;
  stage?.dispose();
  stage = staged() ? createStage({ reduceMotion, budget: () => budget, at, onChange: turned, onReady: staging, onCover: cover }) : null;
  bar.follow(stage ? () => sections[Math.max(0, stage.active)] ?? 0 : null);
  sections = stage ? sectionsOf(stage) : [];
  const layout = measure();
  const view = canvasView();
  // The first wall is laid live; a wall cut again for a new layout appears already laid,
  // on a canvas of its own, and replaces the old one once all of it is ready.
  const first = !live;
  const canvas = first ? wall.querySelector("canvas") : document.createElement("canvas");
  if (!first) {
    canvas.hidden = true;
    wall.append(canvas);
  }
  canvas.style.height = `${view.height}px`;
  const log = [];
  // The name, the scenes behind it, and the page around them, all on one wall. Each picture
  // is named rather than passed, so workers cut them while the page stays live, and the name
  // is laid as soon as it is ready.
  const module = new URL("./wall.js", import.meta.url).href;
  const { project, loop, gate, rests } = wallFilm(layout, { module, laid: first && !reduceMotion.matches, band: view.px, page: !stage });
  let mosaic;
  try {
    // On the stage the first screen's stones can be lifted together, as a page's are when
    // it turns.
    mosaic = await createMosaic(canvas, { project, loop, width: view.px[0], height: view.px[1], samples: 1, interactive: true, worker: true, hover: stage ? { height: 60 } : undefined, onProgress: (line) => log.push(line) });
    if (!first) await mosaic.ready;
  } catch (error) {
    if (!first) canvas.remove();
    if (token !== generation || live) return;
    console.error("The wall could not be laid:", error);
    // Without a wall the page scrolls as a page, over a still of the first screen.
    stage?.dispose();
    stage = null;
    bar.follow(null);
    wall.dataset.state = "still";
    note.textContent = "This browser could not start WebGL2, so the wall is a still from the same engine.";
    return;
  }
  if (token !== generation) {
    mosaic.dispose();
    if (!first) canvas.remove();
    return;
  }
  const previous = live;
  // A wall cut again has every picture before it is shown; the first joins them as they come.
  live = { mosaic, canvas, scale: layout.scale, view, width: layout.width, height: layout.height, rests, gate, joined: !first };
  lastLog = log;
  mosaic.setView({ frame: framing(canvas, layout.scale, view) });
  listen();
  // The stage's screens are cut once the first screen is laid, so they never hold it up.
  mosaic.ready.then(() => { if (live?.mosaic === mosaic) stage?.build(); });
  if (previous) {
    // The wall cut again shows the same moment of the same film, and plays on from there.
    const { time } = previous.mosaic.getState();
    previous.mosaic.dispose();
    previous.canvas.remove();
    canvas.hidden = false;
    mosaic.seek(reduceMotion.matches ? rests[0] : time);
    checked = time;
    advance();
    updateControls();
    return;
  }
  started = performance.now() - mosaic.info.setupMs;
  note.textContent = "Laying the stones cut in your browser.";
  mosaic.ready.then(() => {
    if (live?.mosaic !== mosaic) return;
    live.joined = true;
    advance();
    if (!stage) count([mosaic]);
  });
  if (reduceMotion.matches) mosaic.seek(rests[0]);
  else {
    cycling = true;
    checked = 0;
    mosaic.seek(0);
    advance();
  }
  wall.dataset.state = "live";
  updateControls();
}

// The stones are heard only once asked for, and only while sound is on: the wall's, and the
// bar's.
const sound = createStoneSound();
const soundButton = $("sound");
let unhear = null;
function listen() {
  unhear?.();
  const on = soundButton.getAttribute("aria-pressed") === "true";
  const offs = on ? [live?.mosaic, stage?.mosaic, bar.mosaic].filter(Boolean).map((m) => m.onContact((events) => sound.play(events))) : [];
  unhear = () => offs.forEach((off) => off());
}
const bar = createBar($("bar"), { reduceMotion, onReady: listen });
watchRooms(".hero, .room, .page", { reduceMotion });

// How many stones the page was cut into, and how long it took from the first.
let started = 0;
function count(mosaics) {
  const stones = mosaics.reduce((n, m) => n + m.info.stoneCount, 0);
  note.textContent = `${stones.toLocaleString("en-US")} stones, cut around this page in your browser in ${((performance.now() - started) / 1000).toFixed(1)} seconds.`;
}
// The stage's wall is ready: it is heard with the rest, and counted with the first screen's.
function staging(mosaic) {
  listen();
  if (live) count([live.mosaic, mosaic]);
}

// On the stage, which of the bar's sections each screen is in: the one whose room it is,
// or else the one before it.
let sections = [];
function sectionsOf(s) {
  const ids = ITEMS.map((it) => it.id), out = [0];
  for (let k = 1; s.screen(k); k++) {
    const i = ids.indexOf(s.screen(k).closest(".room")?.id);
    out.push(i >= 0 ? i : out[k - 1]);
  }
  return out;
}
// A screen turned to the front: the bar follows it, and the gallery plays only while it is
// in front.
// The first screen as the stage holds it: slid away to the left, from 0 to 1, and its stones
// lifted, from 0 to 1. While it is lifted or slid away its scenes hold still.
function cover(slide, lift) {
  wall.style.transform = slide > 0 ? `translate3d(${(-slide * document.documentElement.clientWidth).toFixed(1)}px, 0, 0)` : "";
  const now = slide > 0 || lift > 0;
  if (now !== covered) {
    covered = now;
    if (covered) live?.mosaic.pause();
    else advance();
  }
  // After any pause, so the redraw it asks for is not called off.
  live?.mosaic.setHover(lift);
}
function turned(k, el) {
  bar.update();
  gallery.setOnScreen(Boolean(el?.closest("#gallery")));
}
soundButton.addEventListener("click", async () => {
  const on = soundButton.getAttribute("aria-pressed") !== "true";
  soundButton.setAttribute("aria-pressed", String(on));
  soundButton.querySelector(".sound-label").textContent = on ? "Sound on" : "Sound";
  if (on) await sound.start();
  else await sound.stop();
  listen();
});

// Pausing stops the scenes where they are; playing again goes straight on to the next.
replay.addEventListener("click", () => {
  if (!live) return;
  cycling = !cycling;
  clearTimeout(holding);
  held = false;
  if (cycling) advance();
  else live.mosaic.pause();
  updateControls();
});

new IntersectionObserver(([entry]) => {
  heroInView = entry.isIntersecting;
  advance();
}, { threshold: 0.25 }).observe($("hero"));

addEventListener("scroll", () => { if (!stage) live?.mosaic.requestFrame(); }, { passive: true });

// The pointer lifts the stones wherever it is on the page: on the stage, those of the first
// screen while the pointer is over it, and those of the screen in front below it.
let lifting = null;
function lift(event) {
  if (!live || reduceMotion.matches) return;
  const onStage = Boolean(stage?.mosaic) && stage.view >= 0.5;
  const mosaic = onStage ? stage.mosaic : live.mosaic, canvas = onStage ? stage.canvas : live.canvas;
  if (lifting && lifting !== mosaic) lifting.setPointer({ active: false });
  lifting = mosaic;
  const r = canvas.getBoundingClientRect();
  mosaic.setPointer({ x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height, active: true });
}
function settle() {
  lifting?.setPointer({ active: false });
  lifting = null;
}
addEventListener("pointermove", lift, { passive: true });
addEventListener("pointerdown", lift, { passive: true });
document.documentElement.addEventListener("pointerleave", settle);
addEventListener("pointercancel", settle);
addEventListener("pointerup", (event) => { if (event.pointerType !== "mouse") settle(); });
addEventListener("blur", settle);

// A new width reflows the page, so the wall is cut again around the new layout. A taller
// viewport, as when a phone's toolbar hides or a window is made taller, only needs a taller
// canvas; it resizes nothing on the page, so it is heard from the window itself.
function relayout() {
  if (!live) return;
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.scrollHeight;
  if (width !== live.width || Math.abs(height - live.height) > 2 || Boolean(stage) !== staged()) building = building.then(build);
  else if (window.innerHeight > tallest) {
    const view = canvasView();
    live.view = view;
    live.canvas.style.height = `${view.height}px`;
    live.mosaic.resize(view.px[0], view.px[1]);
    live.mosaic.setView({ frame: framing(live.canvas, live.scale, view) });
  }
}
function relayoutSoon() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayout, 250);
}
new ResizeObserver(relayoutSoon).observe(document.body);
addEventListener("resize", relayoutSoon);

window.addEventListener("pagehide", () => {
  cancelAnimationFrame(watching);
  clearTimeout(holding);
  held = false;
  live?.mosaic.dispose();
  live = null;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && !live) building = building.then(build);
});

// The gallery plays its film while it is on screen; on the stage, while its screen is in
// front.
const gallery = createGallery($("gallery"), { reduceMotion });
new IntersectionObserver(([entry]) => { if (!stage) gallery.setOnScreen(entry.isIntersecting); }, { threshold: 0.35 }).observe(document.querySelector(".feature"));

for (const button of document.querySelectorAll(".copy")) {
  button.addEventListener("click", async () => {
    const text = button.parentElement.querySelector("code").textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      getSelection().selectAllChildren(button.parentElement.querySelector("code"));
      button.textContent = "Selected";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 2000);
  });
}

// A small observable surface for browser verification.
window.mosaicWall = { get mosaic() { return live?.mosaic; }, get bar() { return bar.mosaic; }, get stage() { return stage?.mosaic; }, showStage: (at) => stage?.show(at), get stageState() { return stage && { place: stage.place, view: stage.view, active: stage.active }; }, get log() { return lastLog; }, get building() { return building; } };
building = build().then(relayout);
