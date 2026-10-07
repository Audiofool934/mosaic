// The stage: where there is room for it, the page's screens become pages side by side along
// one long wall, which the wheel, a trackpad, the keys, and touch turn sideways. The first
// screen is page 0. A short push lifts every stone of the page in front off the wall; a
// fuller one turns the page, the view travelling right along the wall while the stones fly
// on into the next page's places and settle; and the turn follows the hand both ways, so it
// can be held, rewound, or let go, when it settles back or finishes, whichever way the hand
// was going. Under the first screen lies a copy of its first scene, whose stones fly out from
// under it as it slides away.
import { createMosaic } from "../engine/runtime.js";
import { clamp, smoothstep } from "../engine/util.js";
import { stageFilm, wallScale } from "./wall.js";

// A page's words go as its stones fly off, over these shares of the turn after their rise,
// and come as the next page's stones land, over these before their settle.
const GO = [-0.04, 0.06], COME = [-0.1, 0.06];
// The hand. A whole turn takes a wheel this share of the screen's height, and a finger this
// share of the screen's width or height; one notch of a wheel counts for at least NOTCH of a
// turn; a wheel still for QUIET milliseconds has been let go, and one still for FRESH before
// it moves again is a new push, not the end of a flick; and a finger let go faster than
// FLICK turns a second finishes the turn it was making.
const WHEEL = 0.75, TOUCH = 0.8, NOTCH = 0.13, QUIET = 170, FRESH = 90, FLICK = 0.8;
// The stones move like a weight on a spring toward where the stage is going, carrying their
// speed from one notch of a wheel to the next. Following the hand they settle within about
// FOLLOW seconds; finishing a turn once let go, or one asked for by a key or a link, within
// about EASE seconds and no faster than FINISH or ASKED film seconds a second.
const FOLLOW = 0.16, EASE = 0.32, FINISH = 1.8, ASKED = 2.4, QUICK = 14;

// onChange(k, el) hears which page is in front whenever it changes, 0 being the first screen,
// and its element;
// onReady(mosaic) when the stage's wall is ready; and onCover(slide, lift) how far the first
// screen has slid away to the left, and how far its stones have lifted, each from 0 to 1.
// budget() says how many pixels the stage's canvas may draw. A stage set up anew for a new
// layout starts on the page `at` it was on.
export function createStage({ reduceMotion, budget, at = null, onChange = () => {}, onReady = () => {}, onCover = () => {} }) {
  const root = document.documentElement;
  const hero = document.getElementById("top");
  root.classList.add("stage");
  // The pages after the first: each room, or each of a room's pages where it is set as pages.
  const screens = [...document.querySelectorAll("main > .room, body > footer.room")].flatMap((room) => {
    const pages = [...room.querySelectorAll(":scope > .page")];
    return pages.length && getComputedStyle(pages[0]).display !== "contents" ? pages : [room];
  });
  for (const el of screens) el.classList.add("screen");
  const n = screens.length;
  const host = document.createElement("div");
  host.className = "stage-wall";
  host.setAttribute("aria-hidden", "true");
  document.body.prepend(host);

  let film = null, active = -1, raf = 0, generation = 0, disposed = false;
  // Where the stage stands, 0 on the first screen and k on page k, and where it is going.
  let place = 0, goal = 0;
  // The hand: whether it is on the stage, the turn it is making, from page lo to lo + 1, the
  // way it last pushed, and whether it finished that turn while still on the stage.
  let held = false, lo = 0, heading = 0, locked = false;
  let lastWheel = -Infinity, quiet = 0, touch = null;
  // The film's clock as the stones move, its speed, the pace it moves at, and the last frame.
  let clock = 0, speed = 0, pace = { tau: EASE, top: FINISH }, last = 0;

  // Where the view stands at a place: on a page while its stones lift or settle, and
  // travelling between pages while they fly.
  function viewAt(at) {
    if (!film) return at;
    const k = Math.min(Math.floor(at), n - 1), f = at - k;
    return k + smoothstep(film.rise, 1 - film.settle, f);
  }

  // How much of a page's words show at a place: in full while it is in front, going as its
  // stones fly off to the next page, and coming as they land from the page before.
  function shown(j, at) {
    if (!film) return j === Math.round(at) ? 1 : 0;
    const f = at - (j - 1), g = at - j, rest = 1 - film.settle;
    if (f > 0 && f < 1) return smoothstep(rest + COME[0], rest + COME[1], f);
    if (g > 0 && g < 1) return 1 - smoothstep(film.rise + GO[0], film.rise + GO[1], g);
    return j === Math.round(at) ? 1 : 0;
  }

  // Shows the stage as it stands at a place: each page's words travel with their page, and
  // show as its stones are on it; the first screen slides away to the left, its stones
  // lifting first.
  function paint(at) {
    place = at;
    const view = viewAt(at), wide = root.clientWidth;
    screens.forEach((el, i) => {
      const d = i + 1 - view, u = shown(i + 1, at);
      el.style.opacity = u > 0.002 ? u.toFixed(3) : "0";
      el.style.transform = u > 0.002 && Math.abs(d) > 1e-4 ? `translate3d(${(d * wide).toFixed(1)}px, 0, 0)` : "";
    });
    onCover(clamp(view, 0, 1), at < 1 && film ? clamp(at / film.rise, 0, 1) : 0);
    const k = Math.round(view);
    if (k !== active) {
      active = k;
      screens.forEach((el, i) => el.toggleAttribute("data-active", i + 1 === k));
      onChange(k, k > 0 ? screens[k - 1] : hero);
    }
  }

  // Moves the stones toward where the stage is going, at a pace, and the words with them.
  function drive(next) {
    pace = next;
    if (!film) return paint(goal);
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(follow);
    }
  }
  // Each frame, a critically damped spring pulls the clock toward the goal, its speed held
  // under the pace's top, without overshooting it.
  function follow(now) {
    raf = 0;
    if (!film || disposed) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    const to = goal * film.step, w = 2 / pace.tau, from = clock;
    for (let left = dt; left > 1e-6; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      speed = clamp(speed + (w * w * (to - clock) - 2 * w * speed) * h, -pace.top, pace.top);
      clock += speed * h;
    }
    // Within a hundredth of a second of the film it is there: the rest would not show.
    if ((clock - to) * (from - to) < 0 || (Math.abs(to - clock) < 0.01 && Math.abs(speed) < 0.1)) {
      clock = to;
      speed = 0;
    }
    film.mosaic.setTime(clock);
    paint(clock / film.step);
    if (clock !== to || speed !== 0) raf = requestAnimationFrame(follow);
  }
  // The stones catch up with the hand quickly, wherever it goes.
  const chase = () => drive({ tau: FOLLOW, top: QUICK });

  // A push of the hand, in turns, forward or back. A turn is from page lo to lo + 1: the hand
  // may move anywhere within it, and finishing it under the hand locks it, so the rest of a
  // flick turns no further, until a fresh push, or the hand lets go.
  function push(du, fresh) {
    if (!du) return;
    const dir = Math.sign(du);
    if (locked) {
      if (dir === heading && !fresh) return;
      locked = held = false;
    }
    if (!held) {
      const from = Number.isInteger(goal) ? (dir > 0 ? goal : goal - 1) : Math.floor(goal);
      if (from < 0 || from > n - 1) return;
      held = true;
      lo = from;
    }
    heading = dir;
    goal = clamp(goal + du, lo, lo + 1);
    if (goal === (dir > 0 ? lo + 1 : lo)) locked = true;
    chase();
  }
  // The hand lets go: the turn finishes whichever way it was going, if it got past the lift
  // at that end, or else settles back.
  function letGo() {
    if (!held) return;
    held = locked = false;
    const f = goal - Math.floor(goal);
    if (f > 1e-6 && film) goal = Math.floor(goal) + (heading > 0 ? (f > film.rise ? 1 : 0) : (f < 1 - film.settle ? 0 : 1));
    drive({ tau: EASE, top: FINISH });
  }
  // Turns to page k, as asked by a key or a link, through any pages between.
  function turnTo(k, { instant = false } = {}) {
    held = locked = false;
    goal = clamp(Math.round(k), 0, n);
    if (instant || reduceMotion.matches || !film) {
      clock = goal * (film?.step ?? 0);
      speed = 0;
      film?.mosaic.seek(clock);
      return paint(goal);
    }
    drive({ tau: EASE, top: Math.max(ASKED, Math.abs(goal * film.step - clock) / 1.6) });
  }

  // Whether an element under the hand scrolls sideways itself, the way it is pushed, like a
  // long line of code: then it is left to scroll.
  function scrollsItself(el, dx) {
    for (let e = el; e && e !== document.body && e.nodeType === 1; e = e.parentElement) {
      if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)) {
        if (dx > 0 ? e.scrollLeft + e.clientWidth < e.scrollWidth - 1 : e.scrollLeft > 0) return true;
      }
    }
    return false;
  }

  function wheel(event) {
    if (event.ctrlKey) return;
    const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (sideways && scrollsItself(event.target, event.deltaX)) return;
    event.preventDefault();
    const px = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? innerHeight : 1;
    const turn = innerHeight * WHEEL, d = (sideways ? event.deltaX : event.deltaY) * px;
    const fresh = event.timeStamp - lastWheel > FRESH;
    lastWheel = event.timeStamp;
    if (!d) return;
    // A notch of a wheel is one push, of at least NOTCH of a turn.
    push(Math.sign(d) * Math.max(Math.abs(d) / turn, fresh ? NOTCH : 0), fresh);
    clearTimeout(quiet);
    quiet = setTimeout(letGo, QUIET);
  }

  function key(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const t = event.target;
    if (t.closest?.("input, textarea, select, [contenteditable]")) return;
    let k = null;
    if (event.key === "Home") k = 0;
    else if (event.key === "End") k = n;
    else {
      const step = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }[event.key]
        ?? (event.key === " " && !t.closest?.("button, a, summary, video") ? (event.shiftKey ? -1 : 1) : 0);
      if (!step || (event.key.startsWith("Arrow") && scrollsItself(t, step))) return;
      k = Math.round(goal) + step;
    }
    event.preventDefault();
    turnTo(k);
  }

  // A finger: it pushes along whichever way it first moves, forward to the left or up.
  function touchStart(event) {
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null, last: 0, at: event.timeStamp, speed: 0 };
  }
  function touchMove(event) {
    if (!touch || event.pointerId !== touch.id) return;
    const dx = event.clientX - touch.x, dy = event.clientY - touch.y;
    if (!touch.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      touch.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (touch.axis === "x" && scrollsItself(event.target, -dx)) {
        touch = null;
        return;
      }
    }
    const along = touch.axis === "x" ? -dx / (root.clientWidth * TOUCH) : -dy / (innerHeight * TOUCH);
    const du = along - touch.last, dt = Math.max(1, event.timeStamp - touch.at);
    touch.speed = 0.7 * touch.speed + 0.3 * ((du * 1000) / dt);
    touch.last = along;
    touch.at = event.timeStamp;
    push(du, false);
    // A finger can always come back the way it went.
    locked = false;
  }
  function touchEnd(event) {
    if (!touch || event.pointerId !== touch.id) return;
    const speed = touch.speed;
    touch = null;
    // A flick finishes the turn it was making.
    if (held && Math.abs(speed) > FLICK) {
      heading = Math.sign(speed);
      goal = heading > 0 ? Math.max(goal, lo + 0.99) : Math.min(goal, lo + 0.01);
    }
    letGo();
  }

  // The page an element is on, 0 for the first screen, or -1.
  const pageOf = (el) => {
    const s = el?.closest?.(".screen");
    return s ? screens.indexOf(s) + 1 : el?.closest?.(".hero") ? 0 : -1;
  };
  // The page a part of the page named by id is on: the first screen for the top, and for a
  // room set as pages, its first page.
  function target(id) {
    if (!id || id === "top") return 0;
    const el = document.getElementById(id);
    if (!el) return -1;
    if (el.classList.contains("screen")) return screens.indexOf(el) + 1;
    const on = pageOf(el);
    if (on > 0) return on;
    const first = el.querySelector(".screen");
    return first ? screens.indexOf(first) + 1 : -1;
  }
  // A link to a part of the page turns to its page, and so do the browser's back and
  // forward, and a keyboard's focus moving onto another page.
  function click(event) {
    const a = event.target.closest?.('a[href^="#"]');
    if (!a || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const k = target(decodeURIComponent(a.hash.slice(1)));
    if (k < 0) return;
    event.preventDefault();
    history.pushState(null, "", a.hash);
    turnTo(k);
  }
  const travel = () => {
    const k = target(decodeURIComponent(location.hash.slice(1)));
    if (k >= 0) turnTo(k);
  };
  function focus(event) {
    const k = pageOf(event.target);
    if (k >= 0 && k !== Math.round(viewAt(place))) turnTo(k, { instant: true });
  }
  addEventListener("wheel", wheel, { passive: false });
  addEventListener("keydown", key);
  addEventListener("pointerdown", touchStart, { passive: true });
  addEventListener("pointermove", touchMove, { passive: true });
  addEventListener("pointerup", touchEnd, { passive: true });
  addEventListener("pointercancel", touchEnd, { passive: true });
  document.addEventListener("click", click);
  document.addEventListener("focusin", focus);
  addEventListener("popstate", travel);

  // Cuts the pages' walls, each around its own blocks as they stand when it is in front, and
  // shows them once all are ready, where the stage stands.
  async function build() {
    const token = ++generation;
    for (const el of screens) el.style.transform = "";
    const width = root.clientWidth, h = Math.round(hero.getBoundingClientRect().height || innerHeight), m = wallScale(width);
    const layouts = screens.map((el) => ({
      width, height: h, scale: m,
      blocks: [...el.querySelectorAll("[data-wall]")].filter((b) => !b.hidden && b.getClientRects().length).map((b) => {
        const r = b.getBoundingClientRect();
        return { kind: b.dataset.wall, material: b.dataset.material, x: r.left, y: r.top, w: r.width, h: r.height };
      })
    }));
    paint(place);
    const k = Math.min(Math.min(devicePixelRatio || 1, 2), Math.sqrt(budget() / (width * h)));
    const px = [Math.round(width * k), Math.round(h * k)];
    const canvas = document.createElement("canvas");
    const module = new URL("./wall.js", import.meta.url).href;
    const { project, step, rise, settle } = stageFilm({ width, height: h, hero: h, scale: m }, layouts, { module, band: px });
    let mosaic;
    try {
      // The bed under the pages is a deep shade of their water, so a turn shows the dark
      // where the stones have lifted, not bare plaster.
      mosaic = await createMosaic(canvas, { project, width: px[0], height: px[1], samples: 1, interactive: true, worker: true, coat: "#0d2029" });
      await mosaic.ready;
    } catch (error) {
      console.error("The stage could not be laid:", error);
      return;
    }
    if (token !== generation || disposed) {
      mosaic.dispose();
      return;
    }
    film?.mosaic.dispose();
    host.replaceChildren(canvas);
    film = { mosaic, canvas, step, rise, settle };
    clock = place * step;
    speed = 0;
    mosaic.seek(clock);
    paint(place);
    host.dataset.state = "live";
    onReady(mosaic);
  }

  if (at !== null) goal = clamp(at, 0, n);
  else if (location.hash) {
    const k = target(decodeURIComponent(location.hash.slice(1)));
    if (k > 0) goal = k;
  }
  paint(goal);

  return {
    build,
    turnTo,
    // Shows the stage at a place, its stones and words alike, as if the hand held it there.
    show(at) {
      if (!film) return;
      goal = clamp(at, 0, n);
      clock = goal * film.step;
      speed = 0;
      film.mosaic.seek(clock);
      paint(goal);
    },
    get mosaic() { return film?.mosaic ?? null; },
    get canvas() { return film?.canvas ?? null; },
    get active() { return active; },
    get place() { return place; },
    get view() { return viewAt(place); },
    screen: (k) => (k > 0 ? screens[k - 1] : hero),
    // Takes the stage down and leaves the page as it was.
    dispose() {
      disposed = true;
      generation++;
      cancelAnimationFrame(raf);
      clearTimeout(quiet);
      removeEventListener("wheel", wheel);
      removeEventListener("keydown", key);
      removeEventListener("pointerdown", touchStart);
      removeEventListener("pointermove", touchMove);
      removeEventListener("pointerup", touchEnd);
      removeEventListener("pointercancel", touchEnd);
      removeEventListener("popstate", travel);
      document.removeEventListener("click", click);
      document.removeEventListener("focusin", focus);
      film?.mosaic.dispose();
      film = null;
      host.remove();
      for (const el of screens) {
        el.classList.remove("screen");
        el.removeAttribute("data-active");
        el.style.opacity = "";
        el.style.transform = "";
      }
      onCover(0, 0);
      root.classList.remove("stage");
    }
  };
}
