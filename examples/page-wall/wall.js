// A wall laid around a page's own blocks. The page measures its blocks and passes them as
// plain arguments, in CSS pixels, which this picture takes as millimetres. Each block becomes
// a plate of dark glass in a gold rim, and the courses of the field flow around them.
// The module has no imports, so it can be copied next to any page that ships the engine.

const DEFAULT_FIELD = ["#1d3b52", "#285a74", "#3b7590", "#4d8aa3"];
const MAX_SIDE = 8192;
const MAX_AREA = 33554432;
const STONE_BUDGET = 40000;

function rect(x, y, w, h) {
  const path = new Path2D();
  path.rect(x, y, w, h);
  return path;
}

// The working raster stays within the engine's limits, and the stones grow on a long page so
// one layer stays well under its 65,535 stones.
export function wallScale(w, h, size = 14) {
  const res = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
  const stone = Math.max(size, Math.sqrt((w * h) / STONE_BUDGET));
  return { res, stone };
}

/**
 * holes: [[x, y, w, h], ...] in the wall's millimetres, one for each block of the page.
 * field: hex colours for the stones around them; rim and plate colour each block's frame.
 */
export function pageWall({ w, h, holes = [], size = 14, field = DEFAULT_FIELD, rim = "#d8b571", plate = "#14171c", margin = 10 } = {}) {
  if (!(w > 0 && h > 0)) throw new Error("pageWall needs a positive width and height.");
  const { res, stone } = wallScale(w, h, size);
  const blocks = holes.filter((b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > 0 && b[3] > 0);
  return {
    config: {
      panel: { w, h },
      res,
      background: "field",
      camera: { keys: [[0, w / 2, h / 2, w], [8, w / 2, h / 2, w]], tilt: 0, yaw: 0, drift: 0 },
      light: { exposure: 0.45, grout: "#2a2f36" }
    },
    regions: () => [
      { name: "field", size: stone, mode: "contour", mat: "glass", tray: field },
      { name: "rim", size: Math.max(4, stone * 0.45), mode: "contour", mat: "gold", still: true, tray: ["#b18a50", rim] },
      { name: "plate", size: Math.max(6, stone * 0.7), mode: "contour", mat: "basalt", still: true, tray: [plate, "#1b1f26"] }
    ],
    draw(g, mode, D) {
      D.fill(rect(0, 0, w, h), "field", D.linear(0, 0, w, h, [[0, field[0]], [1, field[field.length - 1]]]));
      for (const [x, y, bw, bh] of blocks) {
        D.fill(rect(x - margin, y - margin, bw + 2 * margin, bh + 2 * margin), "rim", rim);
        D.fill(rect(x - margin * 0.4, y - margin * 0.4, bw + margin * 0.8, bh + margin * 0.8), "plate", plate);
      }
    }
  };
}
