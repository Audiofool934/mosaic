// The studio set in the wall: the whole studio in a frame on the page, by the same engine as the
// standalone one. It lays the studio's own artwork, its film, one of the page's paintings, or an
// image of one's own, dropped on the frame or chosen, in glass, stone, or gold, its stones fine,
// balanced, or bold; and it changes the light, looks closer, lets the stones move under the
// pointer or holds them, plays and scrubs the film, and saves what is in the frame as a PNG.
// An image never leaves the browser: it is read here, cropped to the frame, and cut in a worker.
// The frame is first laid when it comes near the screen.
import { createMosaic } from "../engine/runtime.js";

const MODULE = new URL("./image.js", import.meta.url).href;
// The image's longest side when it is analysed, in pixels.
const READ = 640;

// An image's pixels, cropped from its middle to the frame's shape.
async function pixels(source, aspect) {
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
  const bitmap = await createImageBitmap(blob);
  try {
    const sw = Math.min(bitmap.width, bitmap.height * aspect), sh = sw / aspect;
    const canvas = document.createElement("canvas");
    canvas.width = READ;
    canvas.height = Math.round(READ / aspect);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    const { width, height, data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}

const clock = (seconds) => {
  const whole = Math.floor(Math.max(0, seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

// coat: the colour of the bare bed, which shows under a stone the pointer lifts, as on the wall.
export function createAtelier(figure, { reduceMotion, coat, onLaid = () => {} }) {
  const $ = (selector) => figure.querySelector(selector);
  const frame = $(".frame"), canvas = frame.querySelector("canvas"), note = $("#atelier-note"), title = $("#atelier-title");
  const picks = [...figure.querySelectorAll(".pick")], file = $("#atelier-file");
  const materials = [...figure.querySelectorAll("[data-material]")], sizes = [...figure.querySelectorAll("[data-size]")];
  const light = $("#atelier-light"), zoom = $("#atelier-zoom"), move = $("#atelier-move"), save = $("#atelier-save");
  const film = $("#atelier-film"), play = $("#atelier-play"), time = $("#atelier-time"), shown = $("#atelier-clock");
  // What is laid: a project, by its address, or an image, by its address or as a file.
  const chosen = picks.find((p) => p.getAttribute("aria-pressed") === "true");
  let source = chosen.dataset.project ? { project: chosen.dataset.project, film: "film" in chosen.dataset } : { image: chosen.dataset.image };
  let material = "glass", size = 22, moving = !reduceMotion.matches, mosaic = null, token = 0, started = false, frameId = 0;

  const say = (text) => {
    note.textContent = text;
    note.hidden = !text;
  };
  const press = (list, on, attribute = "aria-checked") => { for (const b of list) b.setAttribute(attribute, String(b === on)); };
  // The material and the stone size shape an image as it is cut; a project brings its own.
  const settle = () => mosaic?.setPointer({ active: false });
  function controls() {
    for (const b of [...materials, ...sizes]) b.disabled = Boolean(source.project);
    save.disabled = !mosaic;
    move.setAttribute("aria-pressed", String(moving));
    film.hidden = !(source.film && mosaic);
  }
  function view() {
    mosaic?.setView({ light: Number(light.value), zoom: Number(zoom.value) });
  }
  function transport() {
    frameId = 0;
    if (!mosaic || !source.film) return;
    const state = mosaic.getState();
    time.value = String(state.time);
    shown.textContent = `${clock(state.time)} / ${clock(mosaic.info.duration)}`;
    play.innerHTML = state.playing ? "&#8545;" : "&#9654;";
    play.setAttribute("aria-label", state.playing ? "Pause the film" : "Play the film");
    if (state.playing) frameId = requestAnimationFrame(transport);
  }

  async function lay() {
    const mine = ++token;
    cancelAnimationFrame(frameId);
    say(source.project ? (source.film ? "Cutting the film into stone." : "Laying the studio's mosaic.") : typeof source.image === "string" ? "Cutting the painting into stone." : "Cutting your image into stone, in this browser.");
    try {
      const r = frame.getBoundingClientRect(), aspect = r.width / r.height;
      const dpr = Math.min(devicePixelRatio || 1, 2), px = [Math.max(2, Math.round(r.width * dpr)), Math.max(2, Math.round(r.height * dpr))];
      let project = source.project && new URL(source.project, document.baseURI).href;
      if (!project) {
        const image = await pixels(source.image, aspect);
        if (mine !== token) return;
        project = {
          version: 1, title: typeof source.image === "string" ? "A painting in stone" : source.image.name.replace(/\.[^.]+$/, ""), seed: 7, fps: [60, 1], frames: 120, band: px,
          scenes: [{ id: "image", picture: { module: MODULE, export: "imagePicture", args: { image, options: { stoneSize: size, paletteSize: 14, material, maxDimension: READ } } }, start: 0, end: 2, in: { type: "settled" } }]
        };
      }
      const next = await createMosaic(canvas, { project, width: px[0], height: px[1], samples: 1, interactive: true, worker: true, coat });
      if (mine !== token) return next.dispose();
      mosaic?.dispose();
      mosaic = next;
      mosaic.seek(source.film ? 0 : source.project ? 2 : 1);
      view();
      if (source.film) {
        time.max = String(Math.max(0, mosaic.info.duration - 1 / mosaic.info.fps));
        time.step = String(1 / mosaic.info.fps);
      }
      title.textContent = `${mosaic.info.title} · ${mosaic.info.stoneCount.toLocaleString("en")} stones`;
      say("");
      controls();
      transport();
      onLaid(mosaic);
    } catch (error) {
      if (mine !== token) return;
      console.error("The image could not be laid:", error);
      say(error?.message?.length < 90 ? error.message : "This image could not be cut. Try a PNG, JPEG, or WebP.");
    }
  }

  // The pointer lifts the stones under it, as on the wall, while the stones are let move.
  function lift(event) {
    if (!mosaic || !moving || reduceMotion.matches) return;
    const r = canvas.getBoundingClientRect();
    mosaic.setPointer({ x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height, active: true });
  }
  frame.addEventListener("pointermove", lift, { passive: true });
  frame.addEventListener("pointerdown", lift, { passive: true });
  frame.addEventListener("pointerleave", settle);
  frame.addEventListener("pointercancel", settle);
  // The arrow keys move a point over the frame as the pointer would, and Escape lets it go.
  let key = { x: 0.5, y: 0.5 };
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return settle();
    const step = { ArrowLeft: [-0.06, 0], ArrowRight: [0.06, 0], ArrowUp: [0, -0.06], ArrowDown: [0, 0.06] }[event.key];
    if (!step || !mosaic || !moving || reduceMotion.matches) return;
    event.preventDefault();
    key = { x: Math.min(1, Math.max(0, key.x + step[0])), y: Math.min(1, Math.max(0, key.y + step[1])) };
    mosaic.setPointer({ ...key, active: true });
  });
  canvas.addEventListener("blur", settle);

  function choose(pick) {
    source = pick.dataset.project ? { project: pick.dataset.project, film: "film" in pick.dataset } : { image: pick.dataset.image };
    press(picks, pick, "aria-pressed");
    lay();
  }
  for (const pick of picks) pick.addEventListener("click", () => choose(pick));
  for (const button of materials) {
    button.addEventListener("click", () => {
      if (button.dataset.material === material) return;
      material = button.dataset.material;
      press(materials, button);
      lay();
    });
  }
  for (const button of sizes) {
    button.addEventListener("click", () => {
      if (Number(button.dataset.size) === size) return;
      size = Number(button.dataset.size);
      press(sizes, button);
      lay();
    });
  }
  const own = (picked) => {
    if (!picked) return;
    if (!picked.type.startsWith("image/")) return say("Choose a PNG, JPEG, WebP, AVIF, or GIF image.");
    source = { image: picked };
    press(picks, null, "aria-pressed");
    lay();
  };
  file.addEventListener("change", () => own(file.files[0]));
  frame.addEventListener("dragover", (event) => {
    event.preventDefault();
    frame.classList.add("over");
  });
  frame.addEventListener("dragleave", () => frame.classList.remove("over"));
  frame.addEventListener("drop", (event) => {
    event.preventDefault();
    frame.classList.remove("over");
    own(event.dataTransfer.files[0]);
  });

  light.addEventListener("input", view);
  zoom.addEventListener("input", view);
  move.addEventListener("click", () => {
    moving = !moving;
    if (!moving) settle();
    controls();
  });
  play.addEventListener("click", () => {
    if (!mosaic) return;
    const state = mosaic.getState();
    if (state.playing) mosaic.pause();
    else {
      if (state.time >= mosaic.info.duration - 1 / mosaic.info.fps) mosaic.seek(0);
      mosaic.play();
    }
    cancelAnimationFrame(frameId);
    transport();
  });
  time.addEventListener("input", () => {
    if (!mosaic) return;
    mosaic.seek(Number(time.value));
    transport();
  });
  save.addEventListener("click", async () => {
    if (!mosaic) return;
    save.disabled = true;
    mosaic.pause();
    settle();
    transport();
    try {
      const url = URL.createObjectURL(await mosaic.exportPNG());
      const link = document.createElement("a");
      link.download = `${mosaic.info.title.replace(/[^\p{L}\p{N}_-]+/gu, "-")}-mosaic.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      say(`The picture could not be saved: ${error.message}`);
    } finally {
      save.disabled = !mosaic;
    }
  });
  reduceMotion.addEventListener("change", (event) => {
    moving = !event.matches;
    if (!moving) settle();
    controls();
  });

  // Laid when it first comes within a screen of view.
  new IntersectionObserver((entries, observer) => {
    if (started || !entries.some((entry) => entry.isIntersecting)) return;
    started = true;
    observer.disconnect();
    lay();
  }, { rootMargin: "100%" }).observe(figure);

  addEventListener("pagehide", () => {
    token++;
    cancelAnimationFrame(frameId);
    mosaic?.dispose();
    mosaic = null;
  });

  controls();
  return {
    get mosaic() { return mosaic; },
    // Lays the studio's film, as a link elsewhere on the page asks.
    film() {
      const pick = picks.find((p) => "film" in p.dataset);
      if (!started) {
        started = true;
        source = { project: pick.dataset.project, film: true };
        press(picks, pick, "aria-pressed");
        lay();
      } else choose(pick);
    }
  };
}
