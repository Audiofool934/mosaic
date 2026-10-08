// The bar on the page: its stones in a canvas of their own, a link over each name, the gold
// that follows the section in view, and the lamp the pointer holds over it.
import { createMosaic } from "../engine/runtime.js";
import { ITEMS, barFilm, barLayout } from "./bar.js";

// A section is the one in view once its top has passed this share of the screen's height.
const READ = 0.4;
// The lamp: how high it is held over the bar, in pixels, how wide its cone is, in degrees,
// and how strong it shines.
const LAMP = { height: 70, cone: 80, power: 0.02, color: "#fff2df" };

// nav holds the bar's canvas and one link to each section in ITEMS, by the section's id.
export function createBar(nav, { reduceMotion, onReady = () => {} }) {
  const links = ITEMS.map((it) => nav.querySelector(`a[href="#${it.id}"]`));
  const sections = ITEMS.map((it) => document.getElementById(it.id));
  let live = null, current = -1, width = 0, generation = 0, timer = 0, spying = 0;
  // What says which section is in view, unless the page itself does.
  let follow = null;

  // The section in view: the last one whose top has passed the reading line.
  function inView() {
    if (follow) return follow();
    const line = innerHeight * READ;
    let i = 0;
    sections.forEach((el, k) => { if (el && el.getBoundingClientRect().top <= line) i = k; });
    return i;
  }

  // Puts the gold on name i: flowing there, as fast as it must to arrive in about a step,
  // or at once.
  function show(i, { at = false } = {}) {
    const from = current;
    current = i;
    links.forEach((a, k) => (k === i ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
    if (!live || (i === from && !at)) return;
    const t = live.rests[i];
    if (at || reduceMotion.matches) live.mosaic.seek(t);
    else live.mosaic.play({ to: t, rate: Math.max(1, Math.abs(i - from)) });
  }

  async function build() {
    const token = ++generation, first = !live;
    width = document.documentElement.clientWidth;
    const room = width - 2 * Math.max(12, Math.min(28, width * 0.02));
    const bar = barLayout(room);
    // The page lays itself out round the bar's height, and the wall is cut round that layout, so
    // the height is given at once, before the bar's stones are cut; the bar takes its own size
    // when they are ready.
    document.documentElement.style.setProperty("--bar-h", `${bar.H}px`);
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const px = [Math.max(2, Math.round(bar.W * dpr)), Math.max(2, Math.round(bar.H * dpr))];
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    const module = new URL("./bar.js", import.meta.url).href;
    const { project, rests } = barFilm(bar, { module, laid: first && !reduceMotion.matches, band: px });
    let mosaic;
    try {
      // A narrow lens looks straight down at the whole bar, so the silver mirrors the same sky
      // from end to end and the lamp's reflection lands under the pointer.
      mosaic = await createMosaic(canvas, { project, width: px[0], height: px[1], samples: dpr < 1.5 ? 2 : 1, interactive: true, worker: true, lamp: LAMP, fov: 1, fringes: false });
      await mosaic.ready;
    } catch (error) {
      if (token === generation && !live) {
        console.error("The bar could not be laid:", error);
        nav.dataset.state = "still";
      }
      return;
    }
    if (token !== generation) {
      mosaic.dispose();
      return;
    }
    mosaic.setView({ frame: { x: bar.W / 2, y: bar.H / 2, w: bar.W } });
    // Each link covers its name, half the space on either side, and its row.
    bar.items.forEach((it, k) => {
      const row = bar.items.filter((other) => other.y === it.y), j = row.indexOf(it);
      const half = row.length > 1 ? (row[1].x - row[0].x - row[0].w) / 2 : 0;
      const left = j ? it.x - half : 0, right = j < row.length - 1 ? it.x + it.w + half : bar.W;
      const top = it.y === bar.items[0].y ? 0 : it.y - bar.top / 2, bottom = it.y === bar.items.at(-1).y ? bar.H : it.y + bar.row - bar.top / 2;
      Object.assign(links[k].style, { left: `${left}px`, width: `${right - left}px`, top: `${top}px`, height: `${bottom - top}px` });
    });
    nav.style.setProperty("--bar-w", `${bar.W}px`);
    nav.style.setProperty("--bar-h", `${bar.H}px`);
    nav.style.setProperty("--bar-radius", `${bar.radius}px`);
    live?.mosaic.dispose();
    live?.canvas.remove();
    nav.prepend(canvas);
    live = { mosaic, canvas, rests };
    nav.dataset.state = "live";
    const i = inView();
    if (first && !reduceMotion.matches) {
      // The slab is laid, and the gold then flows on to the section in view.
      current = i;
      links.forEach((a, k) => (k === i ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
      mosaic.play({ to: rests[i], rate: Math.max(1, i) });
    } else show(i, { at: true });
    onReady(mosaic);
  }

  function spy() {
    if (!spying) spying = requestAnimationFrame(() => { spying = 0; show(inView()); });
  }
  addEventListener("scroll", spy, { passive: true });

  // The lamp is held where the pointer is over the bar, where a finger touches it, or over
  // the name in focus from the keyboard, and taken away when they leave.
  function hold(x, y) {
    if (!live) return;
    const r = live.canvas.getBoundingClientRect();
    live.mosaic.setLamp({ x: (x - r.left) / r.width, y: (y - r.top) / r.height });
  }
  const letGo = () => live?.mosaic.setLamp({ active: false });
  nav.addEventListener("pointermove", (event) => { if (event.pointerType === "mouse" || event.buttons) hold(event.clientX, event.clientY); });
  nav.addEventListener("pointerdown", (event) => hold(event.clientX, event.clientY));
  nav.addEventListener("pointerup", (event) => { if (event.pointerType !== "mouse") letGo(); });
  nav.addEventListener("pointerleave", letGo);
  nav.addEventListener("pointercancel", letGo);
  nav.addEventListener("focusin", (event) => {
    if (!event.target.matches(":focus-visible")) return;
    const r = event.target.getBoundingClientRect();
    hold(r.left + r.width / 2, r.top + r.height / 2);
  });
  nav.addEventListener("focusout", letGo);

  // A new width lays the names out again, so the bar is cut again for it.
  addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (document.documentElement.clientWidth !== width) build(); }, 250);
  });
  addEventListener("pagehide", () => {
    generation++;
    live?.mosaic.dispose();
    live?.canvas.remove();
    live = null;
  });
  addEventListener("pageshow", (event) => { if (event.persisted && !live) build(); });

  build();
  return {
    get mosaic() { return live?.mosaic ?? null; },
    // Lets the page say which section is in view, for a page that does not scroll its
    // sections past the bar.
    follow(fn) { follow = fn; spy(); },
    update: spy
  };
}
