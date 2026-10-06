// The stage: under the first screen, the page's screens stand in place one over another, and
// the page's scroll turns them. An invisible track gives the browser a screen's height to
// scroll and settle on for each, and the scroll drives a film of the screens' walls, so as
// the page turns, the stones of one screen lift and fly into the next. A screen's words fade
// out as its stones leave and in as the next one's land, and the first screen covers the
// stage as it lifts away, like a curtain.
import { createMosaic } from "../engine/runtime.js";
import { clamp, smoothstep } from "../engine/util.js";
import { stageFilm, wallScale } from "./wall.js";

// How much of a turn a screen's words take to fade, as a share of it, and how far they move
// as they do, in pixels.
const FADE = 0.35, RISE = 14;

// onChange(k) hears which screen is in front whenever it changes, 0 being the first screen,
// and onReady(mosaic) when the stage's wall is ready. budget() says how many pixels its
// canvas may draw.
export function createStage({ reduceMotion, budget, onChange = () => {}, onReady = () => {} }) {
  const root = document.documentElement;
  const hero = document.getElementById("top");
  root.classList.add("stage");
  // The screens: each room, or each of a room's pages where it is set as pages.
  const screens = [...document.querySelectorAll("main > .room, body > footer.room")].flatMap((room) => {
    const pages = [...room.querySelectorAll(":scope > .page")];
    return pages.length && getComputedStyle(pages[0]).display !== "contents" ? pages : [room];
  });
  for (const el of screens) el.classList.add("screen");
  const track = document.createElement("div");
  track.className = "stage-track";
  track.setAttribute("aria-hidden", "true");
  for (let i = 0; i < screens.length; i++) track.append(Object.assign(document.createElement("div"), { className: "stop" }));
  hero.after(track);
  const host = document.createElement("div");
  host.className = "stage-wall";
  host.setAttribute("aria-hidden", "true");
  document.body.prepend(host);

  let film = null, active = -1, raf = 0, generation = 0, disposed = false;
  const height = () => hero.getBoundingClientRect().height || innerHeight;
  // Where the page is on the track: 0 on the first screen, k on screen k.
  const place = () => clamp(scrollY / height(), 0, screens.length);

  // Shows the screens as they stand at a place on the track: the one there in full, and on
  // either side of it, the words fading as the stones leave or land.
  function paint(at) {
    screens.forEach((el, i) => {
      const d = at - (i + 1);
      const u = d < 0 ? smoothstep(-FADE, 0, d) : 1 - smoothstep(0, FADE, d);
      el.style.opacity = u > 0.002 ? u.toFixed(3) : "0";
      el.style.transform = u > 0.002 && u < 0.998 ? `translate3d(0, ${((d < 0 ? 1 - u : u - 1) * RISE).toFixed(2)}px, 0)` : "";
    });
    const k = Math.round(at);
    if (k !== active) {
      active = k;
      screens.forEach((el, i) => el.toggleAttribute("data-active", i + 1 === k));
      onChange(k);
    }
  }

  // The stones follow the scroll a moment behind, as quickly as they must to keep up, and
  // the words follow the stones.
  function turn() {
    if (disposed) return;
    const goal = place();
    if (!film) return paint(goal);
    const to = goal * film.step, now = film.mosaic.getState().time;
    if (Math.abs(to - now) < 1e-4) return paint(goal);
    film.mosaic.play({ to, rate: Math.max(film.step * 2.5, Math.abs(to - now) / 0.3) });
    if (!raf) raf = requestAnimationFrame(follow);
  }
  function follow() {
    raf = 0;
    if (!film || disposed) return;
    const { time, playing } = film.mosaic.getState();
    paint(time / film.step);
    if (playing) raf = requestAnimationFrame(follow);
  }
  addEventListener("scroll", turn, { passive: true });

  // The screen an element is on, 0 for the first, or -1.
  const screenOf = (el) => {
    const s = el?.closest?.(".screen");
    return s ? screens.indexOf(s) + 1 : el?.closest?.(".hero") ? 0 : -1;
  };
  const go = (k, behavior = reduceMotion.matches ? "instant" : "smooth") => scrollTo({ top: k * height(), behavior });
  // The screen a part of the page named by id is on: the first screen for the top, and for
  // a room set as pages, its first page.
  function target(id) {
    if (!id || id === "top") return 0;
    const el = document.getElementById(id);
    if (!el) return -1;
    if (el.classList.contains("screen")) return screens.indexOf(el) + 1;
    const on = screenOf(el);
    if (on > 0) return on;
    const first = el.querySelector(".screen");
    return first ? screens.indexOf(first) + 1 : -1;
  }
  // A link to a part of the page turns to its screen, and so do the browser's back and
  // forward, and a keyboard's focus moving onto another screen.
  function click(event) {
    const a = event.target.closest?.('a[href^="#"]');
    if (!a || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const k = target(decodeURIComponent(a.hash.slice(1)));
    if (k < 0) return;
    event.preventDefault();
    history.pushState(null, "", a.hash);
    go(k);
  }
  const travel = () => {
    const k = target(decodeURIComponent(location.hash.slice(1)));
    if (k >= 0) go(k);
  };
  function focus(event) {
    const k = screenOf(event.target);
    if (k > 0 && k !== Math.round(place())) go(k, "instant");
  }
  document.addEventListener("click", click);
  document.addEventListener("focusin", focus);
  addEventListener("popstate", travel);

  // Cuts the screens' walls, each around its own blocks as they stand when it is in front,
  // and shows them once all are ready, at the page's place on the track.
  async function build() {
    const token = ++generation;
    for (const el of screens) el.style.transform = "";
    const width = root.clientWidth, h = Math.round(height()), m = wallScale(width);
    const layouts = screens.map((el) => ({
      width, height: h, scale: m,
      blocks: [...el.querySelectorAll("[data-wall]")].filter((b) => !b.hidden && b.getClientRects().length).map((b) => {
        const r = b.getBoundingClientRect();
        return { kind: b.dataset.wall, material: b.dataset.material, x: r.left, y: r.top, w: r.width, h: r.height };
      })
    }));
    paint(film ? film.mosaic.getState().time / film.step : place());
    const k = Math.min(Math.min(devicePixelRatio || 1, 2), Math.sqrt(budget() / (width * h)));
    const px = [Math.round(width * k), Math.round(h * k)];
    const canvas = document.createElement("canvas");
    const module = new URL("./wall.js", import.meta.url).href;
    const { project, step } = stageFilm(layouts, { module, band: px });
    let mosaic;
    try {
      // The bed under the screens is a deep shade of their water, so a turn shows the dark
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
    mosaic.setView({ frame: { x: (width * m) / 2, y: (h * m) / 2, w: width * m } });
    film?.mosaic.dispose();
    host.replaceChildren(canvas);
    film = { mosaic, canvas, step };
    mosaic.seek(place() * step);
    paint(place());
    host.dataset.state = "live";
    onReady(mosaic);
  }

  if (location.hash) {
    const k = target(decodeURIComponent(location.hash.slice(1)));
    if (k > 0) go(k, "instant");
  }
  paint(place());

  return {
    build,
    get mosaic() { return film?.mosaic ?? null; },
    get canvas() { return film?.canvas ?? null; },
    get active() { return active; },
    screen: (k) => (k > 0 ? screens[k - 1] : hero),
    // Takes the stage down and leaves the page as it was.
    dispose() {
      disposed = true;
      generation++;
      cancelAnimationFrame(raf);
      removeEventListener("scroll", turn);
      removeEventListener("popstate", travel);
      document.removeEventListener("click", click);
      document.removeEventListener("focusin", focus);
      film?.mosaic.dispose();
      film = null;
      track.remove();
      host.remove();
      for (const el of screens) {
        el.classList.remove("screen");
        el.removeAttribute("data-active");
        el.style.opacity = "";
        el.style.transform = "";
      }
      root.classList.remove("stage");
    }
  };
}
