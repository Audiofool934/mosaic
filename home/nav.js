// The bar on the page: its stones in a canvas of their own, a link over each name, and the
// gold that follows the section in view.
import { createMosaic } from "../engine/runtime.js";
import { ITEMS, barFilm, barLayout } from "./bar.js";

// A section is the one in view once its top has passed this share of the screen's height.
const READ = 0.4;

// nav holds the bar's canvas and one link to each section in ITEMS, by the section's id.
export function createBar(nav, { reduceMotion, onReady = () => {} }) {
  const links = ITEMS.map((it) => nav.querySelector(`a[href="#${it.id}"]`));
  const sections = ITEMS.map((it) => document.getElementById(it.id));
  let live = null, current = -1, width = 0, generation = 0, timer = 0, spying = 0;

  // The section in view: the last one whose top has passed the reading line.
  function inView() {
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
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const px = [Math.max(2, Math.round(bar.W * dpr)), Math.max(2, Math.round(bar.H * dpr))];
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    const module = new URL("./bar.js", import.meta.url).href;
    const { project, rests } = barFilm(bar, { module, laid: first && !reduceMotion.matches, band: px });
    let mosaic;
    try {
      mosaic = await createMosaic(canvas, { project, width: px[0], height: px[1], samples: dpr < 1.5 ? 2 : 1, interactive: true, worker: true });
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
    document.documentElement.style.setProperty("--bar-h", `${bar.H}px`);
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

  addEventListener("scroll", () => {
    if (!spying) spying = requestAnimationFrame(() => { spying = 0; show(inView()); });
  }, { passive: true });

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
  return { get mosaic() { return live?.mosaic ?? null; } };
}
