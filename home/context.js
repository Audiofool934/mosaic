// The page's WebGL canvases, when the browser takes their contexts back. A phone short of
// memory may take back every context on the page and never restore them, and a canvas that
// has lost its context draws no more. So a part of the page whose context is lost and not
// restored within RESTORE milliseconds is laid again on a fresh canvas, but no more than MOST
// times a minute across the page, so a device that takes each new context back at once is not
// asked again and again.
const RESTORE = 1500, MOST = 6;
const renewed = [];

// Calls renew once the canvas has lost its context and RESTORE has passed without it coming
// back. Returns a function that stops watching.
export function whenLost(canvas, renew) {
  let timer = 0;
  const lost = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const now = performance.now();
      while (renewed.length && now - renewed[0] > 60000) renewed.shift();
      if (renewed.length >= MOST) return;
      renewed.push(now);
      renew();
    }, RESTORE);
  };
  const restored = () => clearTimeout(timer);
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  return () => {
    clearTimeout(timer);
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeEventListener("webglcontextrestored", restored);
  };
}
