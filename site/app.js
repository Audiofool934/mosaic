import { createMosaic } from "../engine/runtime.js";

const $ = (id) => document.getElementById(id);
const canvas = $("mosaic");
const shell = $("canvas-shell");
const artwork = $("artwork");
const loading = $("loading");
const fileInput = $("image-input");
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const selectedProject = new URLSearchParams(location.search).get("project");
const projectURL = selectedProject ? new URL(selectedProject, location.href) : new URL("../examples/nocturne.json", import.meta.url);
const controls = ["import-button", "reset-button", "light", "zoom", "flow", "save-button", "material", "detail", "film-toggle", "film-time"].map($);
const objectURLs = new Set();
let controller = null;
let currentFile = null;
let pendingFile = null;
let artworkDescription = "Interactive mosaic of a white heron in blue water under a gold moon.";
let aspect = 16 / 9;
let busy = false;
let disposed = false;
let generation = 0;
let flowEnabled = !motionPreference.matches;
let resizeTimer;
let feedbackTimer;
let playbackFrame = 0;
let keyboardPoint = { x: 0.5, y: 0.5 };

function feedback(message, error = false) {
  clearTimeout(feedbackTimer);
  $("feedback").textContent = message;
  $("feedback").classList.toggle("error", error);
  if (message && !error) feedbackTimer = setTimeout(() => { $("feedback").textContent = ""; }, 8000);
}

function setBusy(value) {
  busy = value;
  artwork.setAttribute("aria-busy", String(value));
  controls.forEach((control) => {
    control.disabled = value || (["material", "detail"].includes(control.id) && (!currentFile || !controller)) || (["save-button", "film-toggle", "film-time"].includes(control.id) && !controller);
  });
  fileInput.disabled = value;
}

function renderDimensions() {
  const displayWidth = shell.getBoundingClientRect().width || 1280;
  const scale = Math.min(devicePixelRatio || 1, 2);
  const width = Math.min(1600, Math.max(480, Math.round(displayWidth * scale)), Math.round(1600 * aspect));
  return { width, height: Math.max(1, Math.round(width / aspect)) };
}

function setAspect(value) {
  aspect = value;
  shell.style.setProperty("--art-aspect", String(value));
  shell.style.width = value < 1.15 ? `min(100%, ${Math.round(72 * value)}vh)` : "100%";
}

function updateMotion() {
  $("flow").setAttribute("aria-checked", String(flowEnabled));
  $("motion-note").textContent = flowEnabled ? "Respond to your touch" : motionPreference.matches ? "Reduced motion respected" : "A moment of stillness";
  $("gesture-note").hidden = !flowEnabled;
  canvas.setAttribute("aria-label", `${artworkDescription} ${flowEnabled ? "Move the pointer or use arrow keys to lift the stones. Escape settles them." : "Pointer motion is off. Use the controls below to change the view."}`);
  if (!flowEnabled) controller?.setPointer({ x: 0.5, y: 0.5, active: false });
}

function clockLabel(seconds) {
  const whole = Math.floor(Math.max(0, seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function stopPlaybackDisplay() {
  cancelAnimationFrame(playbackFrame);
  playbackFrame = 0;
}

function updatePlayback() {
  playbackFrame = 0;
  if (!controller || $("film-controls").hidden || busy) return;
  const state = controller.getState();
  $("film-time").value = String(state.time);
  $("film-clock").textContent = `${clockLabel(state.time)} / ${clockLabel(controller.info.duration)}`;
  $("film-label").textContent = state.playing ? "Pause film" : "Play film";
  $("film-toggle").setAttribute("aria-label", state.playing ? "Pause film" : "Play film");
  $("film-icon").textContent = state.playing ? "Ⅱ" : "▶";
  if (state.playing) playbackFrame = requestAnimationFrame(updatePlayback);
}

function updateView() {
  const light = Number($("light").value);
  const zoom = Number($("zoom").value);
  $("light-value").textContent = Math.abs(light) < 0.01 ? "Natural" : light < 0 ? "Softer" : "Brighter";
  $("zoom-value").textContent = `${zoom.toFixed(1)}×`;
  controller?.setView({ light, zoom });
}

async function imageAspect(file) {
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error("This image has no visible pixels.");
    return bitmap.width / bitmap.height;
  } finally {
    bitmap.close();
  }
}

async function loadArtwork(file = null, { resetView = true } = {}) {
  const token = ++generation;
  pendingFile = file;
  stopPlaybackDisplay();
  setBusy(true);
  $("film-controls").hidden = true;
  feedback("");
  $("retry").hidden = true;
  loading.hidden = false;
  $("loading-label").textContent = file ? "Finding the contours in your image" : "Laying the first stones";
  controller?.dispose();
  controller = null;
  try {
    if (file && !file.type.startsWith("image/")) throw new Error("Choose a PNG, JPEG, WebP, AVIF, or GIF image.");
    setAspect(file ? await imageAspect(file) : 16 / 9);
    if (disposed || token !== generation) return;
    const source = file ? {
      image: file,
      imageOptions: { stoneSize: Number($("detail").value), paletteSize: 14, material: $("material").value }
    } : { project: projectURL.href };
    const created = await createMosaic(canvas, {
      ...source,
      ...renderDimensions(),
      samples: 1,
      interactive: true,
      onProgress(message) {
        if (token !== generation) return;
        const text = typeof message === "string" ? message : message?.message;
        if (text?.includes("stones")) $("loading-label").textContent = "Bringing the light to the stonework";
        else if (text && text.length < 90 && !text.includes("{")) $("loading-label").textContent = text;
      }
    });
    if (disposed || token !== generation) { created.dispose(); return; }
    controller = created;
    currentFile = file;
    if (!file && Number.isFinite(created.info?.aspect) && Math.abs(aspect - created.info.aspect) > 0.001) {
      setAspect(created.info.aspect);
      const size = renderDimensions();
      controller.resize(size.width, size.height);
    }
    const filmPreview = Boolean(selectedProject && !file);
    controller.seek(filmPreview ? 0 : 2);
    if (resetView) { $("light").value = "0"; $("zoom").value = "1"; }
    updateView();
    const title = file ? file.name.replace(/\.[^.]+$/, "") : controller.info?.title || "Moon over still water";
    $("art-title").textContent = title;
    $("work-number").textContent = file ? "↳" : "01";
    const material = $("material").selectedOptions[0].textContent;
    $("material-note").textContent = file ? material : selectedProject ? "Original composition" : "Glass, marble & gold";
    const count = controller.info?.stoneCount;
    $("stone-count").textContent = Number.isFinite(count) ? `${count.toLocaleString()} individual stones` : "An original composition";
    $("settings-note").textContent = file ? "Change the material or scale to lay the image again." : "Import an image to choose its materials and scale.";
    artworkDescription = file || selectedProject ? `Mosaic of ${title}.` : "Interactive mosaic of a white heron in blue water under a gold moon.";
    updateMotion();
    $("film-controls").hidden = !filmPreview;
    $("film-time").max = String(Math.max(0, controller.info.duration - 1 / controller.info.fps));
    $("film-time").step = String(1 / controller.info.fps);
    loading.hidden = true;
    setBusy(false);
    updatePlayback();
  } catch (error) {
    if (disposed || token !== generation) return;
    $("loading-label").textContent = "The mosaic could not be made.";
    $("retry").hidden = false;
    setBusy(false);
    $("save-button").disabled = true;
    feedback(error.message || "Try a different image, or open the studio in a browser with WebGL2.", true);
    console.error("Mosaic artwork failed:", error);
  }
}

$("import-button").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) loadArtwork(file);
});
$("reset-button").addEventListener("click", () => {
  $("material").value = "glass";
  $("detail").value = "12";
  loadArtwork(null);
});
$("retry").addEventListener("click", () => loadArtwork(pendingFile));
$("light").addEventListener("input", updateView);
$("zoom").addEventListener("input", updateView);
$("flow").addEventListener("click", () => { flowEnabled = !flowEnabled; updateMotion(); });
for (const id of ["material", "detail"]) $(id).addEventListener("change", () => {
  if (currentFile) loadArtwork(currentFile, { resetView: false });
});
$("film-toggle").addEventListener("click", () => {
  if (!controller || busy) return;
  stopPlaybackDisplay();
  const state = controller.getState();
  if (state.playing) controller.pause();
  else {
    if (state.time >= controller.info.duration - 1 / controller.info.fps) controller.seek(0);
    controller.play();
  }
  updatePlayback();
});
$("film-time").addEventListener("input", () => {
  if (!controller || busy) return;
  stopPlaybackDisplay();
  controller.seek(Number($("film-time").value));
  updatePlayback();
});

function pointer(event) {
  if (!flowEnabled || busy || !controller) return;
  const rect = canvas.getBoundingClientRect();
  controller.setPointer({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height, active: true });
}
canvas.addEventListener("pointermove", pointer);
canvas.addEventListener("pointerdown", pointer);
function settle() { controller?.setPointer({ x: 0.5, y: 0.5, active: false }); }
canvas.addEventListener("pointerleave", settle);
canvas.addEventListener("pointercancel", settle);
canvas.addEventListener("pointerup", (event) => { if (event.pointerType !== "mouse") settle(); });
canvas.addEventListener("blur", settle);
canvas.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { settle(); return; }
  const movement = { ArrowLeft: [-0.06, 0], ArrowRight: [0.06, 0], ArrowUp: [0, -0.06], ArrowDown: [0, 0.06] }[event.key];
  if (!movement || !flowEnabled || busy || !controller) return;
  event.preventDefault();
  keyboardPoint = { x: Math.min(1, Math.max(0, keyboardPoint.x + movement[0])), y: Math.min(1, Math.max(0, keyboardPoint.y + movement[1])) };
  controller.setPointer({ ...keyboardPoint, active: true });
});

$("save-button").addEventListener("click", async () => {
  if (!controller || busy) return;
  const button = $("save-button");
  button.disabled = true;
  controller.pause();
  stopPlaybackDisplay();
  updatePlayback();
  settle();
  try {
    const blob = await controller.exportPNG();
    const url = URL.createObjectURL(blob);
    objectURLs.add(url);
    const link = document.createElement("a");
    const name = currentFile ? currentFile.name.replace(/\.[^.]+$/, "") : controller.info.title || "mosaic";
    link.download = `${name.replace(/[^\p{L}\p{N}_-]+/gu, "-")}-mosaic.png`;
    link.href = url;
    link.click();
    setTimeout(() => { URL.revokeObjectURL(url); objectURLs.delete(url); }, 1000);
    feedback("Your PNG is ready. The download includes this light and crop.");
  } catch (error) {
    feedback(`Could not save the image: ${error.message}`, true);
  } finally {
    button.disabled = busy || !controller;
  }
});

const observer = new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (controller && !busy && !disposed) {
      const size = renderDimensions();
      if (size.width !== canvas.width || size.height !== canvas.height) controller.resize(size.width, size.height);
    }
  }, 180);
});
observer.observe(shell);
motionPreference.addEventListener("change", (event) => {
  flowEnabled = !event.matches;
  updateMotion();
});
window.addEventListener("pagehide", () => {
  disposed = true;
  generation++;
  clearTimeout(resizeTimer);
  clearTimeout(feedbackTimer);
  stopPlaybackDisplay();
  observer.disconnect();
  controller?.dispose();
  for (const url of objectURLs) URL.revokeObjectURL(url);
  objectURLs.clear();
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  disposed = false;
  observer.observe(shell);
  loadArtwork(pendingFile, { resetView: false });
});

// A small observable surface for embedding and browser verification.
window.mosaicStudio = {
  get controller() { return controller; },
  get busy() { return busy; },
  get flowEnabled() { return flowEnabled; },
  importFile(file) { return loadArtwork(file); },
  reset() { return loadArtwork(null); }
};
updateMotion();
loadArtwork();
