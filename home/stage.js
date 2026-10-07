// The stage: where there is room for it, the page's screens become pages side by side along
// one long wall in one sea, which the wheel, a trackpad, the keys, and touch turn sideways.
// The first screen is page 0. A turn is bound to the hand: a little of a push lifts the
// stones of the page's own blocks off the wall a little, more lifts them further, and more
// again turns the page, the view travelling right along the sea while those stones fly on
// into the next page's places and settle. It follows the hand both ways and stays where a
// wheel leaves it, so it can be held, rewound, or carried on; a finger let go settles it on
// the nearer page, or finishes a flick. From the first screen, its name flies: the stage's
// canvas lies over it, see-through but for a copy of the name, which takes the name's place
// as a turn begins, leaving the letters' bed bare in the first screen's scene as that slides
// away to the left. A page further than the next is reached by a jump instead, in which the
// wind blows the page's own stones away and lays the other page's in their place.
import { createMosaic } from "../engine/runtime.js";
import { clamp, smoothstep } from "../engine/util.js";
import { stageFilm, wallScale } from "./wall.js";

// A page's words go as its stones fly off, over these shares of the turn after their rise,
// and come as the next page's stones land, over these before their settle.
const GO = [-0.04, 0.06], COME = [-0.1, 0.06];
// The hand. A whole turn takes a wheel this share of the screen's height, and a finger this
// share of the screen's width or height; a wheel still for QUIET milliseconds has been let
// go, and one still for FRESH before it moves again is a new push, not the end of a flick;
// a wheel let go within NEAR of a page settles onto it; and a finger let go faster than
// FLICK turns a second finishes the turn it was making.
const WHEEL = 0.75, TOUCH = 0.8, QUIET = 170, FRESH = 90, NEAR = 0.03, FLICK = 0.8;
// The stones move like a weight on a spring toward where the stage is going, carrying their
// speed from one notch of a wheel to the next. Following the hand they settle within about
// FOLLOW seconds; settling a turn a finger let go, or making one asked for by a key or a
// link, within about EASE seconds and no faster than FINISH or ASKED film seconds a second.
const FOLLOW = 0.1, EASE = 0.32, FINISH = 1.8, ASKED = 2.4, QUICK = 14;
// A jump, from one page to another two or more away, leaves the pages between alone. The wind
// blows the stones of the page's own blocks, or on the first screen its name, off downwind
// over OFF seconds; the view goes over to the other page unseen, since the sea is the same
// under every page, sliding the first screen out or in over SLIDE seconds on the way where
// one end is the first screen; and the wind brings the other page's stones in and sets them
// down over ON seconds. A jump forward blows to the left, the way a turn forward carries the
// stones, and one back to the right; the words go and come with it, drifting DRIFT pixels.
const OFF = 0.6, SLIDE = 0.5, ON = 0.8, DRIFT = 48;

// onChange(k, el) hears which page is in front whenever it changes, 0 being the first screen,
// and its element;
// onReady(mosaic) when the stage's wall is ready; and onCover(slide, on) how far the first
// screen has slid away to the left, from 0 to 1, and whether a turn from it has begun.
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
  // The jump under way, if any, and a page asked for while it, or the turn before it, is.
  let jump = null, pending = null;
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
  // show as its stones are on it, and the first screen slides away to the left.
  function paint(at) {
    place = at;
    const view = viewAt(at), wide = root.clientWidth;
    screens.forEach((el, i) => {
      const d = i + 1 - view, u = shown(i + 1, at);
      el.style.opacity = u > 0.002 ? u.toFixed(3) : "0";
      el.style.transform = u > 0.002 && Math.abs(d) > 1e-4 ? `translate3d(${(d * wide).toFixed(1)}px, 0, 0)` : "";
    });
    // At rest on the first screen the stage keeps out of sight, so the first screen answers
    // the pointer itself; from the first push it takes the first screen's name's place.
    host.style.visibility = at > 0 ? "visible" : "hidden";
    onCover(clamp(view, 0, 1), at > 0);
    toFront(Math.round(view));
  }
  // The page in front answers the pointer, and the page hears which it is.
  function toFront(k) {
    if (k === active) return;
    active = k;
    screens.forEach((el, i) => el.toggleAttribute("data-active", i + 1 === k));
    onChange(k, k > 0 ? screens[k - 1] : hero);
  }

  // Moves the stones toward where the stage is going, at a pace, and the words with them,
  // unless a jump is moving them.
  function drive(next) {
    if (jump) return;
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
    if (!film || disposed || jump) return;
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
    else if (pending !== null) ask();
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
  // A wheel lets go: the stage stays where the wheel left it, as a page stays where it is
  // scrolled to, unless that is a hair from a page, which it settles onto.
  function letGo() {
    if (!held) return;
    held = locked = false;
    const k = Math.round(goal);
    if (goal !== k && Math.abs(goal - k) < NEAR) {
      goal = k;
      drive({ tau: EASE, top: FINISH });
    }
  }
  // Goes to page k, as asked by a key or a link: by a turn to the next page, and by a jump to
  // one further, which starts from a page at rest, so from the middle of a turn the stage
  // settles on the nearer page first.
  function turnTo(k, { instant = false } = {}) {
    const to = clamp(Math.round(k), 0, n);
    if (jump && !instant) {
      pending = to;
      return;
    }
    held = locked = false;
    pending = null;
    if (instant || reduceMotion.matches || !film) {
      calm();
      goal = to;
      clock = goal * (film?.step ?? 0);
      speed = 0;
      film?.mosaic.seek(clock);
      return paint(goal);
    }
    const here = Math.round(viewAt(clock / film.step));
    if (Math.abs(to - here) < 2) {
      goal = to;
      return drive({ tau: EASE, top: ASKED });
    }
    pending = to;
    if (clock === here * film.step && !raf) return ask();
    goal = here;
    drive({ tau: EASE, top: ASKED });
  }
  // Goes on to the page asked for while the stage was busy.
  function ask() {
    const to = pending, here = Math.round(goal);
    pending = null;
    if (to === null || to === here) return;
    if (Math.abs(to - here) < 2) {
      goal = to;
      drive({ tau: EASE, top: ASKED });
    } else leap(here, to);
  }

  // A jump from page a to page b: when each part of it begins and ends, in seconds from its
  // start. The stones of a are blown off; the first screen slides out while its name blows
  // away, or in before its name comes back; at the cut the view goes over to b, unseen; and
  // the stones of b are brought in.
  function plan(a, b) {
    const wind = b > a ? -1 : 1;
    const off = [0, OFF];
    // The last stones blown off have gone out of the view four fifths of the way through.
    const gone = OFF * 0.8;
    const slide = a === 0 ? [OFF * 0.35, OFF * 0.35 + SLIDE] : b === 0 ? [gone, gone + SLIDE] : null;
    const cut = a === 0 ? slide[1] : gone;
    const on = b === 0 ? [gone + SLIDE * 0.5, gone + SLIDE * 0.5 + ON] : [cut, cut + ON];
    return { a, b, wind, off, slide, cut, on, view: null, raf: 0 };
  }
  function leap(a, b) {
    cancelAnimationFrame(raf);
    raf = 0;
    speed = 0;
    held = locked = false;
    goal = b;
    jump = plan(a, b);
    jump.start = performance.now();
    jump.raf = requestAnimationFrame(blow);
    host.style.visibility = "visible";
    toFront(b);
  }
  const sceneOf = (k) => (k ? `page-${k}` : "name");
  // Each frame of a jump.
  function blow(now) {
    const J = jump;
    if (!J || disposed || !film) return;
    J.raf = requestAnimationFrame(blow);
    const t = (now - J.start) / 1000;
    jumpAt(J, t);
    if (t >= J.on[1]) land();
  }
  // Shows a jump as it stands t seconds in.
  function jumpAt(J, t) {
    const part = ([from, to]) => clamp((t - from) / (to - from), 0, 1);
    const u = part(J.off), v = part(J.on), s = J.slide ? smoothstep(0, 1, part(J.slide)) : 0;
    const cut = t >= J.cut, mosaic = film.mosaic;
    // Over the sea while the first screen slides, and otherwise where the clock stands.
    J.view = J.a === 0 && !cut ? s : J.b === 0 && cut ? 1 - s : null;
    mosaic.setGust(sceneOf(J.a), cut ? null : { at: u, wind: J.wind });
    mosaic.setGust(sceneOf(J.b), cut ? { at: v, wind: J.wind, away: false } : null);
    clock = (cut ? J.b : J.a) * film.step;
    screens.forEach((el, i) => {
      const k = i + 1;
      let shown = 0, drift = 0;
      if (k === J.a && !cut) [shown, drift] = [1 - smoothstep(0, 0.4, u), J.wind * DRIFT * u];
      if (k === J.b && cut) [shown, drift] = [smoothstep(0.45, 1, v), -J.wind * DRIFT * (1 - v)];
      el.style.opacity = shown > 0.002 ? shown.toFixed(3) : "0";
      el.style.transform = shown > 0.002 && Math.abs(drift) > 0.05 ? `translate3d(${drift.toFixed(1)}px, 0, 0)` : "";
    });
    host.style.visibility = "visible";
    onCover(J.a === 0 ? s : J.b === 0 && cut ? 1 - s : 1, true);
    // The wall is drawn now, in the same frame as the words and the first screen move.
    mosaic.setTime(clock);
  }
  // The jump is over: the stage stands on its page, and goes on to any asked for meanwhile.
  function land() {
    const J = jump;
    cancelAnimationFrame(J.raf);
    jump = null;
    film.mosaic.setGust(sceneOf(J.b), null);
    clock = J.b * film.step;
    film.mosaic.setTime(clock);
    paint(J.b);
    if (pending !== null) ask();
  }
  // Calls off any jump under way, leaving the stage where it is asked to stand.
  function calm() {
    if (!jump) return;
    cancelAnimationFrame(jump.raf);
    film?.mosaic.setGust(sceneOf(jump.a), null);
    film?.mosaic.setGust(sceneOf(jump.b), null);
    jump = null;
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
    // A jump carries on whatever the wheel does meanwhile.
    if (jump) return;
    const px = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? innerHeight : 1;
    const turn = innerHeight * WHEEL, d = (sideways ? event.deltaX : event.deltaY) * px;
    const fresh = event.timeStamp - lastWheel > FRESH;
    lastWheel = event.timeStamp;
    if (!d) return;
    push(d / turn, fresh);
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
    if (event.pointerType === "mouse" || !event.isPrimary || jump) return;
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
  // A finger let go settles the stage on the nearer page, or finishes the turn it flicked.
  function touchEnd(event) {
    if (!touch || event.pointerId !== touch.id) return;
    const speed = touch.speed;
    touch = null;
    if (!held) return;
    held = locked = false;
    goal = Math.abs(speed) > FLICK ? lo + (speed > 0 ? 1 : 0) : Math.round(goal);
    drive({ tau: EASE, top: FINISH });
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
    if (k >= 0 && !jump && k !== Math.round(viewAt(place))) turnTo(k, { instant: true });
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
      // See-through, so the first screen shows wherever the stage has no stones.
      mosaic = await createMosaic(canvas, { project, width: px[0], height: px[1], samples: 1, interactive: true, worker: true, transparent: true });
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
    // The camera looks at a whole screen of the wall where the stage stands at each moment of
    // the film, as the words and the first screen do, so all of them move as one.
    const W = width * m, H = h * m;
    mosaic.setView({ frame: (t) => ({ x: ((jump?.view ?? viewAt(t / step)) + 0.5) * W, y: H / 2, w: W }) });
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
      calm();
      goal = clamp(at, 0, n);
      clock = goal * film.step;
      speed = 0;
      film.mosaic.seek(clock);
      paint(goal);
    },
    // Shows a jump from page a to page b as it stands t seconds in, held there.
    showJump(a, b, t) {
      if (!film) return;
      calm();
      jump = plan(a, b);
      jumpAt(jump, t);
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
      if (jump) cancelAnimationFrame(jump.raf);
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
      onCover(0, false);
      root.classList.remove("stage");
    }
  };
}
