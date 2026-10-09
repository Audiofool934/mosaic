// The slabs on the page. Each slab marked data-slab is cut and lit once, at the screen's full
// resolution, into a canvas behind its words, the ones in view first. The pointer holds a lamp
// over the slab it is on, as over the bar, and so does a keyboard's focus: that slab is drawn
// again from the stones its still was cut into, on a canvas of its own, live over the still
// while the lamp is held, so the lamp is all that changes. A finger lights none: it would hide
// the lamp, and the lamp takes a graphics context of its own, which a phone can ill spare.
import { contextLost, createMosaic, cutProject } from "../engine/runtime.js";
import { typeBlock } from "./slab.js";

const MODULE = new URL("./slab.js", import.meta.url).href;
// The lamp, as over the bar: how high it is held, in pixels, its cone, in degrees, its power
// and its colour.
const LAMP = { height: 90, cone: 80, power: 0.02, color: "#fff2df" };
// How long a slab stays live once the lamp is taken from it, in milliseconds.
const KEEP = 8000;
// Where a pointer can hover, each slab in view or within NEAR of a screen of it keeps the
// stones it was cut into, so the lamp lights it at once, even moving straight from one slab to
// the next; a slab further off lets them go, since they take some megabytes, and is cut again
// once it comes near and the page has been still for REST milliseconds.
const NEAR = 0.5, REST = 400;
const hover = matchMedia("(hover: hover)");

const cellOf = (el) => parseFloat(getComputedStyle(el).getPropertyValue("--cell")) || 4;
const lengthOf = (el, name, fallback) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || fallback;

// How wide a line of stone type may be: the width of its slab, less the padding of the slab
// and of everything between them, such as the button it names.
function roomFor(el) {
  const slab = el.closest("[data-slab]");
  if (!slab) return Infinity;
  let room = slab.clientWidth;
  for (let e = el.parentElement; e && e !== slab.parentElement; e = e.parentElement) {
    const style = getComputedStyle(e);
    room -= parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  }
  return room;
}

// Sets every line of stone type its size from the cell its style gives it, so the page is laid
// out around the stones. Lines are parted by | in data-type; data-type-narrow sets the words
// again on more lines, for where they would not fit on their slab, and the lines set are kept
// in data-type-set.
export function sizeType(root = document) {
  for (const el of root.querySelectorAll("[data-type]")) {
    const cell = cellOf(el);
    let lines = el.dataset.type.split("|");
    if (el.dataset.typeNarrow && typeBlock(lines, cell).w > roomFor(el)) lines = el.dataset.typeNarrow.split("|");
    el.dataset.typeSet = lines.join("|");
    const { w, h } = typeBlock(lines, cell);
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  }
}

// A slab as the page lays it out: its size, its rim and glass, and the stone type, wells, and
// rules set on it, in pixels from its top left corner.
function measure(slab) {
  const r = slab.getBoundingClientRect();
  const at = (el) => {
    const q = el.getBoundingClientRect();
    return { x: q.left - r.left, y: q.top - r.top, w: q.width, h: q.height };
  };
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    radius: parseFloat(getComputedStyle(slab).borderTopLeftRadius) || 0,
    rim: lengthOf(slab, "--rim", 2.6), glass: lengthOf(slab, "--glass", 6),
    types: [...slab.querySelectorAll("[data-type]")].map((el) => {
      const { x, y } = at(el);
      return { lines: (el.dataset.typeSet || el.dataset.type).split("|"), x, y, cell: cellOf(el), gold: el.dataset.tone === "gold", centre: el.dataset.align === "centre", well: Boolean(el.closest("[data-well]")) };
    }),
    wells: [...slab.querySelectorAll("[data-well]")].map((el) => ({ ...at(el), r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 })),
    rules: [...slab.querySelectorAll("[data-rule]")].map(at)
  };
}

// A slab's film: its picture, at rest, and how it is drawn, the same for the still and the
// live one, so the two match to the pixel.
function slabFilm(lay, px) {
  return {
    version: 1, title: "A slab", seed: 11, fps: [60, 1], frames: 2, band: px,
    scenes: [{ id: "slab", picture: { module: MODULE, export: "slabPicture", args: lay }, start: 0, end: 1 / 30, in: { type: "settled" } }]
  };
}
// The camera stands this far from every slab, in metres: a narrow lens looks almost straight
// down at the whole slab, as at the bar, so the lamp's reflection lands under the pointer, and
// the slab stays well within the reach of the camera's view.
const DISTANCE = 4;
// A slab already cut, with its `cut`, is drawn from it, not cut again.
async function lay(canvas, state) {
  const { lay: slab, px, dpr, cut } = state;
  const fov = (2 * Math.atan(slab.h / 2000 / DISTANCE) * 180) / Math.PI;
  const mosaic = await createMosaic(canvas, {
    project: slabFilm(slab, px), cut, width: px[0], height: px[1], samples: dpr < 1.5 ? 2 : 1,
    interactive: true, worker: true, lamp: LAMP, fov, fringes: false
  });
  // Setting the view draws the slab at rest, so it needs no other frame.
  mosaic.setView({ frame: { x: slab.w / 2, y: slab.h / 2, w: slab.w } });
  return mosaic;
}

// How many slabs are laid at once, each on a canvas of its own.
const AT_ONCE = 2;

export function createSlabs(root = document) {
  // The stills are drawn on these, a slab at a time on each.
  const easels = Array.from({ length: AT_ONCE }, () => document.createElement("canvas"));
  const liveCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.className = "slab-live";
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
  };
  const live = { canvas: liveCanvas(), slab: null, key: null, mosaic: null, building: null, timer: 0 };
  const states = new Map();
  let queue = Promise.resolve(), generation = 0;

  // How far a slab is from the screen, so the ones in view are laid first.
  const distance = (slab) => {
    const r = slab.getBoundingClientRect();
    return Math.max(0, r.left - innerWidth, -r.right) + Math.max(0, r.top - innerHeight, -r.bottom);
  };
  const near = (slab) => hover.matches && distance(slab) <= NEAR * Math.max(innerWidth, innerHeight);

  // The slabs near the screen keep their cuts, and the others let theirs go; then the nearest
  // slab without one is cut again, one at a time, unless it could not be cut as it is laid.
  let cutting = null, resting = 0;
  function keepCuts() {
    let next = null;
    for (const [slab, state] of states) {
      if (!near(slab)) state.cut = null;
      else if (state.key && !state.cut && state.uncut !== state.key && (!next || distance(slab) < distance(next[0]))) next = [slab, state];
    }
    if (!next || cutting) return;
    const [, state] = next, key = state.key;
    cutting = cutProject(slabFilm(state.lay, state.px)).then((cut) => {
      if (state.key === key) state.cut = cut;
    }, (error) => {
      state.uncut = key;
      console.error("A slab could not be cut:", error);
    }).finally(() => {
      cutting = null;
      keepCuts();
    });
  }
  addEventListener("scroll", () => {
    clearTimeout(resting);
    resting = setTimeout(keepCuts, REST);
  }, { passive: true });

  // An easel, or the live canvas, whose context the browser has taken back draws no more, so
  // a fresh canvas takes its place.
  async function still(job, i) {
    if (contextLost(easels[i])) easels[i] = document.createElement("canvas");
    const easel = easels[i];
    const mosaic = await lay(easel, job);
    try {
      let state = states.get(job.slab);
      if (!state) {
        const canvas = document.createElement("canvas");
        canvas.className = "slab-stones";
        canvas.setAttribute("aria-hidden", "true");
        job.slab.prepend(canvas);
        state = { canvas };
        states.set(job.slab, state);
      }
      Object.assign(state.canvas, { width: job.px[0], height: job.px[1] });
      state.canvas.getContext("2d").drawImage(easel, 0, 0);
      Object.assign(state, { key: job.key, lay: job.lay, px: job.px, dpr: job.dpr, cut: near(job.slab) ? mosaic.cut : null });
      job.slab.dataset.state = "laid";
    } finally {
      mosaic.dispose();
    }
  }

  // Lays every slab whose layout has changed, the ones in view first.
  function update() {
    const token = ++generation, dpr = Math.min(devicePixelRatio || 1, 2);
    const jobs = [...root.querySelectorAll("[data-slab]")].filter((slab) => slab.getClientRects().length).map((slab) => {
      const slabLay = measure(slab);
      const px = [Math.max(2, Math.round(slabLay.w * dpr)), Math.max(2, Math.round(slabLay.h * dpr))];
      return { slab, lay: slabLay, px, dpr, key: JSON.stringify([slabLay, px]), far: distance(slab) };
    }).filter((job) => states.get(job.slab)?.key !== job.key).sort((a, b) => a.far - b.far);
    queue = queue.then(() => Promise.all(easels.map(async (_, i) => {
      while (jobs.length && token === generation) {
        const job = jobs.shift();
        try {
          await still(job, i);
        } catch (error) {
          console.error("A slab could not be laid:", error);
        }
      }
      // An easel at rest keeps no picture.
      easels[i].width = easels[i].height = 1;
    })).then(keepCuts));
    return queue;
  }

  // The live slab under the lamp: cut again on its own canvas, then laid over the still one.
  function lightUp(slab, state) {
    if (live.slab === slab && live.key === state.key) return Promise.resolve();
    if (live.building?.slab === slab && live.building.key === state.key) return live.building.promise;
    live.mosaic?.dispose();
    Object.assign(live, { mosaic: null, slab: null, key: null });
    live.canvas.remove();
    if (contextLost(live.canvas)) live.canvas = liveCanvas();
    Object.assign(live.canvas, { width: state.px[0], height: state.px[1] });
    const promise = lay(live.canvas, state).then((mosaic) => {
      if (live.building?.promise !== promise) return mosaic.dispose();
      Object.assign(live, { mosaic, slab, key: state.key, building: null });
      state.canvas.after(live.canvas);
    }, (error) => {
      if (live.building?.promise === promise) live.building = null;
      console.error("A slab could not be lit:", error);
    });
    live.building = { slab, key: state.key, promise };
    return promise;
  }

  async function hold(slab, x, y) {
    const state = states.get(slab);
    if (!state?.key) return;
    clearTimeout(live.timer);
    await lightUp(slab, state);
    if (live.slab !== slab) return;
    const r = slab.getBoundingClientRect();
    live.mosaic.setLamp({ x: (x - r.left) / r.width, y: (y - r.top) / r.height });
  }
  function letGo() {
    live.mosaic?.setLamp({ active: false });
    clearTimeout(live.timer);
    live.timer = setTimeout(() => {
      live.mosaic?.dispose();
      Object.assign(live, { mosaic: null, slab: null, key: null });
      live.canvas.remove();
    }, KEEP);
  }

  const slabAt = (event) => event.target.closest?.("[data-slab]");
  addEventListener("pointermove", (event) => {
    const slab = slabAt(event);
    if (slab && event.pointerType !== "touch" && (event.pointerType === "mouse" || event.buttons)) hold(slab, event.clientX, event.clientY);
    else if (live.slab && slab !== live.slab) letGo();
  }, { passive: true });
  addEventListener("pointerdown", (event) => {
    const slab = slabAt(event);
    if (slab && event.pointerType !== "touch") hold(slab, event.clientX, event.clientY);
  }, { passive: true });
  addEventListener("pointerup", (event) => { if (event.pointerType !== "mouse") letGo(); });
  addEventListener("pointercancel", letGo);
  document.documentElement.addEventListener("pointerleave", letGo);
  addEventListener("blur", letGo);
  root.addEventListener("focusin", (event) => {
    const slab = event.target.closest?.("[data-slab]");
    if (!slab || !event.target.matches(":focus-visible")) return;
    const r = event.target.getBoundingClientRect();
    hold(slab, r.left + r.width / 2, r.top + r.height / 2);
  });
  root.addEventListener("focusout", letGo);
  addEventListener("pagehide", () => {
    generation++;
    live.mosaic?.dispose();
    Object.assign(live, { mosaic: null, slab: null, key: null, building: null });
  });

  return {
    update,
    // Whether the pointer is over a slab, where the wall's stones are left still.
    covers: (target) => Boolean(target?.closest?.("[data-slab]"))
  };
}
