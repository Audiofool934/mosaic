import { contextLost, createMosaic, releaseContext } from "../engine/runtime.js";
import { createStoneSound } from "../engine/sound.js";
import { clamp } from "../engine/util.js";
import { createAtelier } from "./atelier.js";
import { createGallery } from "./gallery.js";
import { ITEMS } from "./bar.js";
import { whenLost } from "./context.js";
import { createBar } from "./nav.js";
import { watchRooms } from "./rooms.js";
import { createSlabs, sizeType } from "./slabs.js";
import { wallFilm, wallScale, wideFilm } from "./wall.js";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const wall = $("wall");
const note = $("wall-note");
const pauseButton = $("wall-pause");
const hero = $("hero");
const heroLabel = { still: hero.getAttribute("aria-label"), wide: hero.dataset.wideLabel };
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
// The canvas reaches this share of the viewport past it, above and below on a column of
// rooms and on either side on the wide wall, so a fast scroll never outruns the stones
// between two frames.
const OVERSCAN = 0.15;
// Where motion is welcome and the screen is wide and tall enough to hold a room, the page's
// screens stand side by side along one wide wall that scrolls sideways; elsewhere, as on a
// phone, where a finger scrolls down and a swipe from the edge goes back, the page is a column
// of rooms.
const WIDE_HEIGHT = 540;
const phone = matchMedia("(max-width: 720px)");
const wants = () => !reduceMotion.matches && !phone.matches && innerHeight >= WIDE_HEIGHT && wall.dataset.state !== "still";
let wide = false;
// On the wide wall, the screen in view, kept as the page scrolls while its screens are the
// width they were set at, so a new window size reopens the page on it.
let current = 0, screenWidth = 0;

// The wall on screen: its controller, its canvas, the millimetres of wall in each CSS
// pixel, and the stretch of page its canvas covers.
let live = null;
// Enough for the wide wall at a Retina display's full sharpness; halved while frames come slowly.
let budget = 9e6;
let tallest = 0;
let generation = 0;
let resizeTimer = 0;
let building = Promise.resolve();
let lastLog = [];

// The wide wall's screens in order: the first screen, then each room, or each of a room's
// pages where it is set as pages.
function screens() {
  return [$("top"), ...[...document.querySelectorAll("main > .room, body > footer.room")].flatMap((room) => {
    const pages = [...room.querySelectorAll(":scope > .page")];
    return pages.length && getComputedStyle(pages[0]).display !== "contents" ? pages : [room];
  })];
}

// The part of a block that the scrollers around it show, such as a plate half out of the
// gallery's reel: a frame for the rest would land on the wall past the reel, or on the next
// screen of the wide wall.
function shown(el) {
  let { left, top, right, bottom } = el.getBoundingClientRect();
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowX === "visible") continue;
    const c = p.getBoundingClientRect();
    left = Math.max(left, c.left);
    top = Math.max(top, c.top);
    right = Math.min(right, c.right);
    bottom = Math.min(bottom, c.bottom);
  }
  return right - left >= 1 && bottom - top >= 1 ? { left, top, width: right - left, height: bottom - top } : null;
}

// Every block marked data-wall, in page pixels: the stones are cut around these.
function measure() {
  const left = scrollX, top = scrollY;
  const blocks = [...document.querySelectorAll("[data-wall]")].filter((el) => !el.hidden && el.getClientRects().length).flatMap((el) => {
    const r = shown(el);
    return r ? [{ kind: el.dataset.wall, material: el.dataset.material, picture: el.dataset.picture, x: r.left + left, y: r.top + top, w: r.width, h: r.height }] : [];
  });
  const width = root.clientWidth;
  if (wide) {
    const height = Math.round($("top").getBoundingClientRect().height);
    return { width, height, hero: height, screens: screens().length, blocks, scale: wallScale(width) };
  }
  return { width, height: root.scrollHeight, hero: hero.getBoundingClientRect().bottom + top, blocks, scale: wallScale(width) };
}

// The canvas spans the page width and the tallest viewport seen, with a margin above and
// below, or on the wide wall the screen and a margin either side; a dense display draws at
// most `budget` pixels and is upscaled past that.
function canvasView() {
  const width = root.clientWidth;
  let w = width, h, margin;
  if (wide) {
    margin = Math.round(width * OVERSCAN);
    w = width + 2 * margin;
    h = Math.round($("top").getBoundingClientRect().height);
  } else {
    tallest = Math.max(tallest, innerHeight);
    margin = Math.round(tallest * OVERSCAN);
    h = tallest + 2 * margin;
  }
  const k = Math.min(Math.min(devicePixelRatio || 1, 2), Math.sqrt(budget / (w * h)));
  return { width: w, height: h, margin, px: [Math.round(w * k), Math.round(h * k)] };
}

// Read once for each frame drawn: the canvas follows the scroll, and the camera looks at
// the same stretch of wall, so both move in the same task.
function framing(canvas, scale, view) {
  canvas.style.width = wide ? `${view.width}px` : "";
  canvas.style.height = `${view.height}px`;
  if (wide) return () => {
    const x = scrollX - view.margin;
    canvas.style.transform = `translate3d(${x}px, 0, 0)`;
    return { x: (x + view.width / 2) * scale, y: (view.height / 2) * scale, w: view.width * scale };
  };
  return () => {
    const y = scrollY - view.margin;
    canvas.style.transform = `translate3d(0, ${y}px, 0)`;
    return { x: (view.width * scale) / 2, y: (y + view.height / 2) * scale, w: view.width * scale };
  };
}

// The wall's film. It is laid first: the name, waiting at the gate until the pictures laid
// next have joined, so none appears half laid, then the scene and the page around it. Where
// motion is reduced, a column of rooms then rests. Otherwise the scenes behind the name flow
// on: the wall waits at the end of the laying for every scene, then holds each scene for HOLD
// seconds, the first for FIRST, before it flows into the next, on and on, on every screen of
// the wide wall, or on a column's first screen while it is in view. A flow waits while the
// page has been scrolled in the last STILL seconds, so the wall never moves two ways at once,
// and none starts while the scenes are paused.
const HOLD = 6, FIRST = 2.5, STILL = 1.2;
const COAT = "#1e2b33";
let holding = 0, held = false, watching = 0, scrolled = -Infinity, paused = false;
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
  if (!live || held || (paused && live.cycle) || contextLost(live.canvas)) return;
  const m = live.mosaic;
  let { time, playing } = m.getState();
  if (playing) return;
  const joined = (ids) => ids.every((id) => m.info.stones.some((s) => s.shot === id));
  let to;
  if (!live.cycle) to = live.joined ? live.rest : live.gate;
  else {
    const { gate, laid, rests, first, ids } = live.cycle;
    if (time < gate - 1e-3) to = gate;
    else if (time < laid - 1e-3) {
      if (!joined(first)) return hold(0.25);
      to = laid;
    } else if (time < rests[0] - 1e-3) {
      if (!joined(ids)) return hold(0.25);
      to = rests[0];
    } else if (reduceMotion.matches) return;
    else {
      const i = rests.findIndex((r) => Math.abs(r - time) < 1e-3);
      // A flow paused part way goes on to its scene.
      if (i < 0) to = rests.find((r) => r > time);
      else {
        if (performance.now() - scrolled < STILL * 1000) return hold(STILL);
        // A column's scenes flow only while its first screen is in view.
        if (!live.wide && hero.getBoundingClientRect().bottom < innerHeight / 2) return hold(STILL);
        // From the last scene, a copy of the first, on from the first again.
        if (i === rests.length - 1) {
          time = rests[0];
          m.setTime(time);
        }
        to = rests[i === rests.length - 1 ? 1 : i + 1];
      }
    }
  }
  if (to === undefined || time >= to - 1e-3) return;
  m.play({ to });
  watch();
}

// Each frame while the wall plays: once it stops, it holds the scene it came to rest on, or
// goes on; and while it is laid, if frames come too slowly, the canvas draws fewer pixels
// from then on.
function watch() {
  cancelAnimationFrame(watching);
  let last = 0;
  const step = (now) => {
    watching = 0;
    if (!live) return;
    if (!live.mosaic.getState().playing) return arrived();
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
function arrived() {
  const rests = live.cycle?.rests ?? [], time = live.mosaic.getState().time;
  const i = rests.findIndex((r) => Math.abs(r - time) < 1e-3);
  if (i >= 0) hold(i === 0 && !live.cycled ? FIRST : HOLD);
  else advance();
  if (i > 0) live.cycled = true;
}

// The scenes' pause, shown while the wide wall flows from scene to scene: pausing stops
// them where they are, and playing again goes straight on to the next.
function updateControls() {
  pauseButton.hidden = !live?.cycle || reduceMotion.matches;
  pauseButton.dataset.state = paused ? "paused" : "playing";
  const label = paused ? "Play the scenes" : "Pause the scenes";
  pauseButton.setAttribute("aria-label", label);
  pauseButton.title = label;
}
pauseButton.addEventListener("click", () => {
  if (!live?.cycle) return;
  paused = !paused;
  clearTimeout(holding);
  held = false;
  if (paused) {
    cancelAnimationFrame(watching);
    live.mosaic.pause();
  } else advance();
  updateControls();
});

function lighten() {
  budget /= 2;
  const view = canvasView();
  live.view = view;
  live.mosaic.resize(view.px[0], view.px[1]);
  live.mosaic.setView({ frame: framing(live.canvas, live.scale, view) });
}

async function build() {
  const token = ++generation;
  await document.fonts?.ready;
  // The page is set wide or as a column anew for each layout, and the wide wall keeps the
  // screen it was on.
  const screen = wide ? current : null;
  wide = wants();
  root.classList.toggle("wide", wide);
  screenWidth = root.clientWidth;
  hero.setAttribute("aria-label", wide ? heroLabel.wide : heroLabel.still);
  bar.follow(wide ? () => sectionOf(Math.round(scrollX / root.clientWidth)) : null);
  sections = wide ? sectionsOf() : [];
  // Stone type takes the room its stones do, so the page is laid out around it first.
  sizeType();
  if (wide) arrive(screen);
  const layout = measure();
  slabs.update();
  const view = canvasView();
  // The first wall is laid live; a wall cut again for a new layout appears already laid,
  // on a canvas of its own, and replaces the old one once all of it is ready.
  const first = !live;
  const canvas = first ? wall.querySelector("canvas") : document.createElement("canvas");
  if (!first) {
    canvas.hidden = true;
    wall.append(canvas);
  }
  const log = [];
  // The name, the scenes behind it, and the page around them, all on one wall. Each picture
  // is named rather than passed, so workers cut them while the page stays live, and the name
  // is laid as soon as it is ready.
  const module = new URL("./wall.js", import.meta.url).href;
  const laid = first && !reduceMotion.matches;
  // A column's first screen flows from scene to scene too, unless motion is reduced.
  const film = wide ? wideFilm(layout, { module, laid, band: view.px, at: current }) : wallFilm(layout, { module, laid, band: view.px, flow: !reduceMotion.matches });
  let mosaic;
  try {
    // The wall's bare bed is a deep slate, so a scene flowing into the next never flashes pale
    // between the two, and a stone lifted off its bed shows the same plain colour under it.
    mosaic = await createMosaic(canvas, { project: film.project, width: view.px[0], height: view.px[1], samples: 1, interactive: true, worker: true, coat: COAT, onProgress: (line) => log.push(line) });
    if (!first) await mosaic.ready;
  } catch (error) {
    if (!first) {
      releaseContext(canvas);
      canvas.remove();
    }
    if (token !== generation || live) return;
    console.error("The wall could not be laid:", error);
    // Without a wall the page scrolls as a column, over a still of the first screen.
    wall.dataset.state = "still";
    wide = false;
    root.classList.remove("wide");
    hero.setAttribute("aria-label", heroLabel.still);
    bar.follow(null);
    note.textContent = "This browser could not start WebGL2, so the wall is a still from the same engine.";
    return;
  }
  if (token !== generation) {
    mosaic.dispose();
    if (!first) {
      releaseContext(canvas);
      canvas.remove();
    }
    return;
  }
  const previous = live;
  // A wall cut again has every picture before it is shown; the first joins them as they come.
  live = {
    mosaic, canvas, scale: layout.scale, view, width: layout.width, height: layout.height, wide, joined: !first,
    gate: film.gate, rest: film.rest, cycle: film.rests ? { gate: film.gate, laid: film.laid, rests: film.rests, first: film.first, ids: film.cycle } : null, cycled: false,
    // A wall whose context is taken back and not restored is cut again on a fresh canvas.
    unwatch: whenLost(canvas, () => { if (live?.canvas === canvas) building = building.then(build); })
  };
  lastLog = log;
  mosaic.setView({ frame: framing(canvas, layout.scale, view) });
  listen();
  updateControls();
  clearTimeout(holding);
  held = false;
  if (previous) {
    // The wall cut again shows the same scene at rest, or as far as the last one got.
    const { time } = previous.mosaic.getState();
    previous.unwatch();
    previous.mosaic.dispose();
    releaseContext(previous.canvas);
    previous.canvas.remove();
    canvas.hidden = false;
    const rests = live.cycle?.rests;
    mosaic.seek(rests ? (previous.wide ? rests.reduce((at, r) => (r <= time + 1e-3 ? r : at), rests[0]) : rests[0]) : film.rest);
    advance();
    return;
  }
  started = performance.now() - mosaic.info.setupMs;
  note.textContent = "Laying the stones cut in your browser.";
  mosaic.ready.then(() => {
    if (live?.mosaic !== mosaic) return;
    live.joined = true;
    advance();
    count([mosaic]);
  });
  mosaic.seek(reduceMotion.matches ? film.rest ?? film.laid : 0);
  advance();
  wall.dataset.state = "live";
}

// The stones are heard only once asked for, and only while sound is on: the wall's, and the
// bar's.
const sound = createStoneSound();
const soundButton = $("sound");
let unhear = null;
function listen() {
  unhear?.();
  const on = soundButton.getAttribute("aria-pressed") === "true";
  const offs = on ? [live?.mosaic, bar.mosaic, atelier.mosaic].filter(Boolean).map((m) => m.onContact((events) => sound.play(events))) : [];
  unhear = () => offs.forEach((off) => off());
}
const bar = createBar($("bar"), { reduceMotion, onReady: listen });
const slabs = createSlabs(document);
const atelier = createAtelier(document.querySelector(".atelier"), { reduceMotion, coat: COAT, onLaid: listen });
// The gallery's film opens in the studio, to play and scrub there; the link itself goes to it.
document.addEventListener("click", (event) => {
  if (!event.target.closest?.("a[data-studio-film]")) return;
  document.querySelector("dialog[open]")?.close();
  atelier.film();
});
watchRooms(".hero, .room, .page", { reduceMotion });

// How many stones the page was cut into, and how long it took from the first.
let started = 0;
function count(mosaics) {
  const stones = mosaics.reduce((n, m) => n + m.info.stoneCount, 0);
  note.textContent = `${stones.toLocaleString("en-US")} stones, cut around this page in your browser in ${((performance.now() - started) / 1000).toFixed(1)} seconds.`;
}

// On the wide wall, which of the bar's sections each screen is in: the one whose room it is,
// or else the one before it.
let sections = [];
function sectionsOf() {
  const ids = ITEMS.map((it) => it.id), out = [];
  for (const el of screens()) {
    const i = ids.indexOf(el === $("top") ? "top" : el.closest(".room")?.id);
    out.push(i >= 0 ? i : out.at(-1) ?? 0);
  }
  return out;
}
const sectionOf = (k) => sections[clamp(k, 0, sections.length - 1)] ?? 0;

// The screen an element is on, or the first page of a room named by id.
function screenOf(id) {
  if (!id || id === "top") return 0;
  const el = document.getElementById(id);
  if (!el) return -1;
  const all = screens();
  const k = all.findIndex((s) => s === el || s.contains(el));
  if (k >= 0) return k;
  return all.findIndex((s) => el.contains(s));
}
// Goes to screen k of the wide wall, gliding there, or at once.
function goTo(k, instant = false) {
  const last = screens().length - 1;
  glideTo(clamp(k, 0, last) * root.clientWidth, instant || reduceMotion.matches);
}
// Opens on the screen the address names, or the one the page was on before it was set again.
function arrive(screen) {
  current = Math.max(0, screen ?? (location.hash ? screenOf(decodeURIComponent(location.hash.slice(1))) : 0));
  scrollTo({ left: current * root.clientWidth, top: 0, behavior: "instant" });
}

// The wheel scrolls the wide wall sideways, as a wheel scrolls a page down: each turn of it,
// or stroke of a trackpad up and down, moves the page along by as much, gliding there over
// about GLIDE seconds. A trackpad's stroke sideways scrolls it as it scrolls anything. The
// glide keeps its own place, since the browser rounds where the page is scrolled to, and
// starts again from where the page is if something else has scrolled it.
const GLIDE = 0.08;
let target = null, gliding = 0, glidedAt = 0, glideX = 0;
function glideTo(x, instant) {
  target = clamp(x, 0, root.scrollWidth - root.clientWidth);
  if (instant) {
    cancelAnimationFrame(gliding);
    gliding = 0;
    scrollTo({ left: target, behavior: "instant" });
    target = null;
  } else if (!gliding) {
    glidedAt = 0;
    glideX = scrollX;
    gliding = requestAnimationFrame(glide);
  }
}
function glide(now) {
  gliding = 0;
  if (target === null) return;
  const dt = glidedAt ? Math.min(0.05, (now - glidedAt) / 1000) : 1 / 60;
  glidedAt = now;
  if (Math.abs(scrollX - glideX) > 1) glideX = scrollX;
  glideX += (target - glideX) * (1 - Math.exp(-dt / GLIDE));
  if (Math.abs(target - glideX) < 0.5) {
    scrollTo({ left: target, behavior: "instant" });
    target = null;
    return;
  }
  scrollTo({ left: glideX, behavior: "instant" });
  gliding = requestAnimationFrame(glide);
}
// Whether an element under the wheel scrolls up and down itself, the way it is turned.
function scrollsItself(el, dy) {
  for (let e = el; e && e !== document.body && e.nodeType === 1; e = e.parentElement) {
    if (e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)) {
      if (dy > 0 ? e.scrollTop + e.clientHeight < e.scrollHeight - 1 : e.scrollTop > 0) return true;
    }
  }
  return false;
}
const opened = () => Boolean(document.querySelector("dialog[open]"));
addEventListener("wheel", (event) => {
  if (!wide || event.ctrlKey || opened()) return;
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
    target = null;
    return;
  }
  if (scrollsItself(event.target, event.deltaY)) return;
  event.preventDefault();
  const px = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? root.clientWidth : 1;
  glideTo((target ?? scrollX) + event.deltaY * px, false);
}, { passive: false });

// The keys that scroll a page down move the wide wall along: Page Down and the space bar by a
// screen, Home and End to either end, and the arrows up and down as the arrows left and right
// do.
addEventListener("keydown", (event) => {
  if (!wide || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || opened()) return;
  const t = event.target;
  if (t.closest?.("input, textarea, select, [contenteditable]")) return;
  const here = Math.round(scrollX / root.clientWidth);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    glideTo((target ?? scrollX) + (event.key === "ArrowDown" ? 80 : -80), false);
    return;
  }
  const k = { PageDown: here + 1, PageUp: here - 1, Home: 0, End: Infinity }[event.key]
    ?? (event.key === " " && !t.closest?.("button, a, summary, video") ? here + (event.shiftKey ? -1 : 1) : undefined);
  if (k === undefined) return;
  event.preventDefault();
  goTo(k === Infinity ? screens().length - 1 : k);
});

// A link to a part of the page goes to its screen, and so do the browser's back and forward.
document.addEventListener("click", (event) => {
  if (!wide) return;
  const a = event.target.closest?.('a[href^="#"]');
  if (!a || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const k = screenOf(decodeURIComponent(a.hash.slice(1)));
  if (k < 0) return;
  event.preventDefault();
  history.pushState(null, "", a.hash);
  goTo(k);
});
addEventListener("popstate", () => {
  if (!wide) return;
  const k = screenOf(decodeURIComponent(location.hash.slice(1)));
  if (k >= 0) goTo(k);
});

soundButton.addEventListener("click", async () => {
  const on = soundButton.getAttribute("aria-pressed") !== "true";
  soundButton.setAttribute("aria-pressed", String(on));
  soundButton.querySelector(".sound-label").textContent = on ? "Sound on" : "Sound";
  if (on) await sound.start();
  else await sound.stop();
  listen();
});

addEventListener("scroll", () => {
  scrolled = performance.now();
  if (wide && root.clientWidth === screenWidth) current = Math.round(scrollX / screenWidth);
  live?.mosaic.requestFrame();
}, { passive: true });

// The pointer lifts the stones wherever it is on the page, except over a slab, which holds a
// lamp instead, over the studio's frame, which lifts its own, and behind a work opened whole.
let lifting = false;
function lift(event) {
  if (!live || reduceMotion.matches) return;
  if (event.target.closest?.("[data-slab], .atelier .frame, dialog[open]")) return settle();
  lifting = true;
  const r = live.canvas.getBoundingClientRect();
  live.mosaic.setPointer({ x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height, active: true });
}
function settle() {
  if (lifting) live?.mosaic.setPointer({ active: false });
  lifting = false;
}
addEventListener("pointermove", lift, { passive: true });
addEventListener("pointerdown", lift, { passive: true });
root.addEventListener("pointerleave", settle);
addEventListener("pointercancel", settle);
addEventListener("pointerup", (event) => { if (event.pointerType !== "mouse") settle(); });
addEventListener("blur", settle);

// A new width reflows the page, so the wall is cut again around the new layout, and so does a
// new height on the wide wall, whose screens are a screen high. On a column of rooms a
// taller viewport, as when a phone's toolbar hides or a window is made taller, only needs a
// taller canvas; it resizes nothing on the page, so it is heard from the window itself.
function relayout() {
  // A wall that has lost its context is cut again on its own, for the layout then.
  if (!live || contextLost(live.canvas)) return;
  const width = root.clientWidth;
  const height = wide ? Math.round($("top").getBoundingClientRect().height) : root.scrollHeight;
  if (width !== live.width || Math.abs(height - live.height) > 2 || wide !== wants()) building = building.then(build);
  else if (!wide && innerHeight > tallest) {
    const view = canvasView();
    live.view = view;
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
// Motion reduced or welcomed again sets the page as a column, or wide.
reduceMotion.addEventListener("change", () => {
  updateControls();
  relayoutSoon();
});

window.addEventListener("pagehide", () => {
  cancelAnimationFrame(watching);
  clearTimeout(holding);
  held = false;
  live?.unwatch();
  live?.mosaic.dispose();
  live = null;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && !live) building = building.then(build);
});

createGallery($("gallery"), { reduceMotion });

// The ways to run it, as tabs over one block of code, which the arrows move between.
const ways = [...document.querySelectorAll('.ways [role="tab"]')];
function choose(tab) {
  for (const other of ways) {
    const on = other === tab;
    other.setAttribute("aria-selected", String(on));
    other.tabIndex = on ? 0 : -1;
    $(other.getAttribute("aria-controls")).hidden = !on;
  }
}
for (const tab of ways) {
  tab.addEventListener("click", () => choose(tab));
  tab.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = ways[(ways.indexOf(tab) + step + ways.length) % ways.length];
    choose(next);
    next.focus();
  });
}

for (const button of document.querySelectorAll(".copy")) {
  button.addEventListener("click", async () => {
    const code = button.parentElement.querySelector("pre:not([hidden]) code");
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = "Copied";
    } catch {
      getSelection().selectAllChildren(code);
      button.textContent = "Selected";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 2000);
  });
}

// A small observable surface for browser verification.
window.mosaicWall = {
  get mosaic() { return live?.mosaic; },
  get bar() { return bar.mosaic; },
  get wide() { return wide; },
  get screens() { return screens().length; },
  goTo: (k, instant) => goTo(k, instant),
  get log() { return lastLog; },
  get building() { return building; }
};
building = build().then(relayout);
