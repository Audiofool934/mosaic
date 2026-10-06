import { createMosaic } from "../engine/runtime.js";
import { createStoneSound } from "../engine/sound.js";
import { heroAt, wallScale } from "./wall.js";

const $ = (id) => document.getElementById(id);
const wall = $("wall");
const note = $("wall-note");
const replay = $("wall-replay");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
// The canvas reaches this share of the viewport above and below it, so a fast scroll never
// outruns the stones between two frames.
const OVERSCAN = 0.15;
const END = 10;

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
// below; a dense display draws at most `budget` pixels and is upscaled past that.
function canvasView() {
  tallest = Math.max(tallest, window.innerHeight);
  const width = document.documentElement.clientWidth;
  const margin = Math.round(tallest * OVERSCAN);
  const height = tallest + 2 * margin;
  const k = Math.min(Math.min(devicePixelRatio || 1, 2), Math.sqrt(budget / (width * height)));
  return { width, height, margin, px: [Math.round(width * k), Math.round(height * k)] };
}

// Read once for each frame drawn: the canvas follows the scroll, and the camera looks at
// the same stretch of wall, so both move in the same task.
function framing(canvas, scale, view) {
  return () => {
    const y = window.scrollY - view.margin;
    canvas.style.transform = `translate3d(0, ${y}px, 0)`;
    return { x: (view.width * scale) / 2, y: (y + view.height / 2) * scale, w: view.width * scale };
  };
}

function finished() {
  return live.mosaic.getState().time >= END - 1 / 60 - 1e-3;
}

function updateControls() {
  if (!live) return;
  const { playing } = live.mosaic.getState();
  replay.hidden = reduceMotion.matches;
  replay.textContent = playing ? "Pause" : finished() ? "Lay it again" : "Resume";
}

// While the wall is laid, every frame is drawn; if they come too slowly, the canvas draws
// fewer pixels from then on.
let watching = 0;
function watch() {
  cancelAnimationFrame(watching);
  const times = [];
  let last = 0;
  const step = (now) => {
    updateControls();
    if (last && times.length < 90) times.push(now - last);
    last = now;
    if (times.length === 90 && budget > 0.9e6) {
      const sorted = times.sort((a, b) => a - b);
      if (sorted[45] > 28) lighten();
      times.push(0);
    }
    watching = live?.mosaic.getState().playing ? requestAnimationFrame(step) : 0;
  };
  step(0);
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
  // Two pictures on one wall: the nocturne as it was drawn, and the page around it. Each is
  // named rather than passed, so workers cut them while the page stays live, and the
  // nocturne is laid as soon as it is ready.
  const module = new URL("./wall.js", import.meta.url).href;
  const arrive = reduceMotion.matches || !first ? { type: "settled" } : { type: "laid", bed: 0 };
  const project = {
    version: 1, title: "mosAIc", seed: 42, fps: [60, 1], frames: END * 60, band: view.px, look: [[0, 1], [END, 1]],
    scenes: [
      { id: "nocturne", picture: { module, export: "heroPicture" }, start: 0, end: END, at: heroAt(layout), in: arrive },
      { id: "page", picture: { module, export: "wallPicture", args: layout }, start: 0, end: END, at: [0, 0], in: arrive }
    ]
  };
  let mosaic;
  try {
    mosaic = await createMosaic(canvas, { project, width: view.px[0], height: view.px[1], samples: 1, interactive: true, worker: true, onProgress: (line) => log.push(line) });
    if (!first) await mosaic.ready;
  } catch (error) {
    if (!first) canvas.remove();
    if (token !== generation || live) return;
    console.error("The wall could not be laid:", error);
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
  live = { mosaic, canvas, scale: layout.scale, view, width: layout.width, height: layout.height };
  lastLog = log;
  mosaic.setView({ frame: framing(canvas, layout.scale, view) });
  listen();
  if (previous) {
    previous.mosaic.dispose();
    previous.canvas.remove();
    canvas.hidden = false;
    mosaic.seek(END);
    updateControls();
    return;
  }
  const started = performance.now() - mosaic.info.setupMs;
  note.textContent = "Laying the stones cut in your browser.";
  mosaic.ready.then(() => {
    if (live?.mosaic !== mosaic) return;
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    note.textContent = `${mosaic.info.stoneCount.toLocaleString("en-US")} stones of glass, marble, limestone, basalt, and gold, cut around this page in your browser in ${seconds} seconds.`;
  });
  if (reduceMotion.matches) mosaic.seek(END);
  else {
    mosaic.seek(0);
    mosaic.play();
    watch();
  }
  wall.dataset.state = "live";
  updateControls();
}

// The stones are heard only once asked for, and only while sound is on.
const sound = createStoneSound();
const soundButton = $("sound");
let unhear = null;
function listen() {
  unhear?.();
  unhear = live && soundButton.getAttribute("aria-pressed") === "true" ? live.mosaic.onContact((events) => sound.play(events)) : null;
}
soundButton.addEventListener("click", async () => {
  const on = soundButton.getAttribute("aria-pressed") !== "true";
  soundButton.setAttribute("aria-pressed", String(on));
  soundButton.querySelector(".sound-label").textContent = on ? "Sound on" : "Sound";
  if (on) await sound.start();
  else await sound.stop();
  listen();
});

replay.addEventListener("click", () => {
  if (!live) return;
  const { mosaic } = live;
  if (mosaic.getState().playing) mosaic.pause();
  else {
    if (finished()) mosaic.seek(0);
    mosaic.play();
  }
  watch();
});

addEventListener("scroll", () => live?.mosaic.requestFrame(), { passive: true });

// The pointer lifts the stones wherever it is on the page.
function lift(event) {
  if (!live || reduceMotion.matches) return;
  const r = live.canvas.getBoundingClientRect();
  live.mosaic.setPointer({ x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height, active: true });
}
function settle() {
  live?.mosaic.setPointer({ active: false });
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
  if (width !== live.width || Math.abs(height - live.height) > 2) building = building.then(build);
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
  live?.mosaic.dispose();
  live = null;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && !live) building = building.then(build);
});

// The film plays while it is on screen, unless motion is reduced.
const film = $("film");
const filmToggle = $("film-toggle");
let filmPaused = false;
function syncFilm() {
  filmToggle.textContent = film.paused ? "Play the film" : "Pause the film";
}
// Scrolling away interrupts a pending play(); only a blocked autoplay needs the native controls.
function playFilm() {
  film.play().catch((error) => { if (error.name === "NotAllowedError") film.controls = true; });
}
if (reduceMotion.matches) film.controls = true;
else {
  filmToggle.hidden = false;
  filmToggle.addEventListener("click", () => {
    filmPaused = !film.paused;
    if (filmPaused) film.pause();
    else playFilm();
  });
  film.addEventListener("play", syncFilm);
  film.addEventListener("pause", syncFilm);
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !filmPaused) playFilm();
    else if (!entry.isIntersecting) film.pause();
  }, { threshold: 0.35 }).observe(film);
  syncFilm();
}

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
window.mosaicWall = { get mosaic() { return live?.mosaic; }, get log() { return lastLog; }, get building() { return building; } };
building = build().then(relayout);
