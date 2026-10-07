// The studio set in the wall: an image laid in stone in a frame on the page, by the same engine
// as the studio, from one of the page's own paintings or an image of one's own, dropped on the
// frame or chosen, in glass, stone, or gold. The image never leaves the browser: it is read
// here, cropped to the frame, and cut in a worker. The frame is first laid when it comes near
// the screen, and its stones lift under the pointer like the wall's.
import { createMosaic } from "../engine/runtime.js";

const MODULE = new URL("./image.js", import.meta.url).href;
// The image's longest side when it is analysed, in pixels, and its stones, in millimetres of a
// panel 1600 wide: about seventy across the frame.
const READ = 640, STONE = 22;

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

// coat: the colour of the bare bed, which shows under a stone the pointer lifts, as on the wall.
export function createAtelier(figure, { reduceMotion, coat, onLaid = () => {} }) {
  const frame = figure.querySelector(".frame"), canvas = frame.querySelector("canvas"), note = figure.querySelector("#atelier-note");
  const materials = [...figure.querySelectorAll("[data-material]")], picks = [...figure.querySelectorAll(".pick")], file = figure.querySelector("#atelier-file");
  let source = picks.find((p) => p.getAttribute("aria-pressed") === "true")?.dataset.image;
  let material = "glass", mosaic = null, token = 0, started = false;

  const say = (text) => {
    note.textContent = text;
    note.hidden = !text;
  };

  async function lay() {
    const mine = ++token;
    say(typeof source === "string" ? "Cutting the painting into stone." : "Cutting your image into stone, in this browser.");
    try {
      const r = frame.getBoundingClientRect(), aspect = r.width / r.height;
      const dpr = Math.min(devicePixelRatio || 1, 2), px = [Math.max(2, Math.round(r.width * dpr)), Math.max(2, Math.round(r.height * dpr))];
      const image = await pixels(source, aspect);
      if (mine !== token) return;
      const project = {
        version: 1, title: "Your mosaic", seed: 7, fps: [60, 1], frames: 120, band: px,
        scenes: [{ id: "image", picture: { module: MODULE, export: "imagePicture", args: { image, options: { stoneSize: STONE, paletteSize: 14, material, maxDimension: READ } } }, start: 0, end: 2, in: { type: "settled" } }]
      };
      const next = await createMosaic(canvas, { project, width: px[0], height: px[1], samples: 1, interactive: true, worker: true, coat });
      if (mine !== token) return next.dispose();
      mosaic?.dispose();
      mosaic = next;
      mosaic.seek(1);
      say("");
      onLaid(mosaic);
    } catch (error) {
      if (mine !== token) return;
      console.error("The image could not be laid:", error);
      say(error?.message?.length < 90 ? error.message : "This image could not be cut. Try a PNG, JPEG, or WebP.");
    }
  }

  // The pointer lifts the stones under it, as on the wall.
  function lift(event) {
    if (!mosaic || reduceMotion.matches) return;
    const r = canvas.getBoundingClientRect();
    mosaic.setPointer({ x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height, active: true });
  }
  const settle = () => mosaic?.setPointer({ active: false });
  frame.addEventListener("pointermove", lift, { passive: true });
  frame.addEventListener("pointerdown", lift, { passive: true });
  frame.addEventListener("pointerleave", settle);
  frame.addEventListener("pointercancel", settle);

  for (const button of materials) {
    button.addEventListener("click", () => {
      if (button.dataset.material === material) return;
      material = button.dataset.material;
      for (const other of materials) other.setAttribute("aria-checked", String(other === button));
      lay();
    });
  }
  for (const pick of picks) {
    pick.addEventListener("click", () => {
      source = pick.dataset.image;
      for (const other of picks) other.setAttribute("aria-pressed", String(other === pick));
      lay();
    });
  }
  const own = (chosen) => {
    if (!chosen) return;
    if (!chosen.type.startsWith("image/")) return say("Choose a PNG, JPEG, WebP, AVIF, or GIF image.");
    source = chosen;
    for (const other of picks) other.setAttribute("aria-pressed", "false");
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

  // Laid when it first comes within a screen of view.
  new IntersectionObserver((entries, observer) => {
    if (started || !entries.some((entry) => entry.isIntersecting)) return;
    started = true;
    observer.disconnect();
    lay();
  }, { rootMargin: "100%" }).observe(figure);

  addEventListener("pagehide", () => {
    token++;
    mosaic?.dispose();
    mosaic = null;
  });

  return { get mosaic() { return mosaic; } };
}
