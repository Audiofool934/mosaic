import { createMosaic } from "../engine/runtime.js";

const $ = (id) => document.getElementById(id);
const panel = $("panel");
const canvas = $("panel-canvas");
const poster = $("panel-poster");
const note = $("panel-note");
const hint = $("panel-hint");
const replay = $("panel-replay");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
const project = new URL("../examples/laid.json", import.meta.url).href;

let mosaic = null;
let end = 0;
let inView = true;
let resume = false;
let watching = 0;
let resizeTimer = 0;

function renderSize() {
  const width = canvas.getBoundingClientRect().width || panel.clientWidth || 1280;
  const px = Math.round(Math.min(1920, Math.max(640, width * Math.min(devicePixelRatio || 1, 2))));
  return { width: px, height: Math.round((px * 9) / 16) };
}

function finished() {
  return mosaic.getState().time >= end - 1e-3;
}

// One button follows the build: pause it, resume it, or lay the panel again.
function updateControls() {
  if (!mosaic) return;
  const { playing } = mosaic.getState();
  const done = finished();
  replay.hidden = false;
  replay.textContent = playing ? "Pause" : done ? "Lay it again" : "Resume";
  hint.hidden = !(done && finePointer.matches && !reduceMotion.matches);
}

function watch() {
  cancelAnimationFrame(watching);
  const step = () => {
    updateControls();
    watching = mosaic?.getState().playing ? requestAnimationFrame(step) : 0;
  };
  step();
}

function play() {
  if (inView) mosaic.play();
  else resume = true;
  watch();
}

async function start() {
  try {
    mosaic = await createMosaic(canvas, { project, ...renderSize(), samples: 1, interactive: true });
  } catch (error) {
    console.error("The mosaic could not start:", error);
    poster.closest("picture")?.querySelector("source")?.remove();
    poster.srcset = "home/media/hero-end-960.webp 960w, home/media/hero-end.webp 1920w";
    poster.src = "home/media/hero-end.webp";
    poster.alt = "A mosaic of a white heron in blue water under a gold moon.";
    note.textContent = "This browser could not start WebGL2, so this is a still from the same engine.";
    return;
  }
  const { stoneCount, setupMs, duration, fps } = mosaic.info;
  end = duration - 1 / fps;
  note.textContent = `${stoneCount.toLocaleString("en-US")} stones of glass, marble, limestone, basalt, and gold, cut in your browser in ${(setupMs / 1000).toFixed(1)} seconds.`;
  if (reduceMotion.matches) mosaic.seek(end);
  else {
    mosaic.seek(0);
    play();
  }
  panel.dataset.state = "live";
  updateControls();
}

replay.addEventListener("click", () => {
  if (!mosaic) return;
  const { playing } = mosaic.getState();
  if (playing) {
    mosaic.pause();
    resume = false;
  } else {
    if (finished()) mosaic.seek(0);
    play();
  }
  updateControls();
});

new IntersectionObserver(([entry]) => {
  inView = entry.isIntersecting;
  if (!mosaic) return;
  if (!inView && mosaic.getState().playing) {
    mosaic.pause();
    resume = true;
  } else if (inView && resume) {
    resume = false;
    play();
  }
}, { threshold: 0.1 }).observe(panel);

function lift(event) {
  if (!mosaic || reduceMotion.matches) return;
  const r = canvas.getBoundingClientRect();
  mosaic.setPointer({ x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height, active: true });
}
function settle() {
  mosaic?.setPointer({ active: false });
}
canvas.addEventListener("pointermove", lift);
canvas.addEventListener("pointerdown", lift);
canvas.addEventListener("pointerleave", settle);
canvas.addEventListener("pointercancel", settle);
canvas.addEventListener("pointerup", (event) => { if (event.pointerType !== "mouse") settle(); });

new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!mosaic) return;
    const size = renderSize();
    if (size.width !== canvas.width) mosaic.resize(size.width, size.height);
  }, 200);
}).observe(panel);

window.addEventListener("pagehide", () => {
  cancelAnimationFrame(watching);
  mosaic?.dispose();
  mosaic = null;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && !mosaic) start();
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

start();
