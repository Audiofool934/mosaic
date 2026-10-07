// The page's rooms: the browser settles the page on one room at a time, and this makes sure
// a deliberate turn of the wheel always reaches the next. Where the browser snaps a short
// scroll back to the room it began in, as some do for a wheel's notch or a slow stroke on a
// trackpad, the page goes on to the next room in the wheel's direction. Scrolling itself is
// left to the browser, so keys, the scroll bar, and find in page work as on any page.

// How far a wheel must turn, in pixels, to mean a turn of the page, and how long the page
// must be still for a turn to be over.
const NUDGE = 50, QUIET = 160;

export function watchRooms(selector, { reduceMotion }) {
  // Where the page last came to rest, and the wheel's turn since then.
  let rest = scrollY, turn = 0, still = 0;
  // The rooms the page settles on, top to bottom, in page pixels.
  const stops = () => [...document.querySelectorAll(selector)]
    .filter((el) => getComputedStyle(el).scrollSnapAlign.includes("start") && getComputedStyle(el).display !== "contents")
    .map((el) => Math.round(el.getBoundingClientRect().top + scrollY));
  const mandatory = () => getComputedStyle(document.documentElement).scrollSnapType.includes("mandatory");

  // Once the page is still: if the wheel turned far enough but the page is back where it
  // rested, it goes on to the next room that way.
  function settled() {
    const delta = turn;
    turn = 0;
    // On the wide wall the page scrolls sideways, as a wheel scrolls it.
    if (document.documentElement.classList.contains("wide")) return;
    if (Math.abs(delta) >= NUDGE && Math.abs(scrollY - rest) <= 2 && mandatory()) {
      const all = stops(), here = all.findIndex((y) => Math.abs(y - scrollY) <= 2);
      const next = here < 0 ? undefined : all[here + Math.sign(delta)];
      if (next !== undefined) {
        scrollTo({ top: next, behavior: reduceMotion.matches ? "instant" : "smooth" });
        return;
      }
    }
    rest = scrollY;
  }
  function quietly() {
    clearTimeout(still);
    still = setTimeout(settled, QUIET);
  }

  addEventListener("scroll", quietly, { passive: true });
  addEventListener("wheel", (event) => {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    turn += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    quietly();
  }, { passive: true });
}
