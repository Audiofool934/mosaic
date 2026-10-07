import test from "node:test";
import assert from "node:assert/strict";
import { analyzeImage } from "../engine/image.js";
import { loadFilm } from "../engine/timeline.js";

function fixture(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}

test("a flow paired within columns flies every stone within its own column, out from the focus of each", async () => {
  // A wall of two screens, each 160 millimetres wide: a checkerboard flows into a ramp.
  const options = { maxDimension: 96, width: 320, stoneSize: 10, paletteSize: 6, seed: 3 };
  const checks = analyzeImage(fixture(96, 36, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [25, 58, 90, 255] : [224, 175, 99, 255]), options);
  const ramp = analyzeImage(fixture(96, 36, (x) => [x * 2.5, 120, 255 - x * 2.5, 255]), options);
  const foci = [[80, 60], [240, 60]];
  const film = await loadFilm({ version: 1, fps: [60, 1], frames: 240, band: [320, 120], scenes: [
    { id: "checks", picture: checks, start: 0, end: 3, at: [0, 0], in: { type: "settled" } },
    { id: "ramp", picture: ramp, start: 1, end: 4, at: [0, 0], in: { type: "flow", launch: [1, 1.5], land: [1.6, 3], focus: foci, reach: 120, columns: 160 } }
  ] });
  const B = film.layers.find((L) => L.scene.id === "ramp"), d = B.data;
  const near = [], far = [];
  for (let i = 0; i < B.count; i++) {
    const o = i * 40;
    if (d[o + 30] >= 1e5) continue;
    assert.equal(Math.floor(d[o + 28] / 0.16), Math.floor(d[o] / 0.16), `a stone landing at ${(d[o] * 1000).toFixed(0)} mm flew in from ${(d[o + 28] * 1000).toFixed(0)} mm, another column`);
    const away = Math.min(...foci.map(([x, y]) => Math.hypot(d[o] * 1000 - x, (-d[o + 1] * 1000 - y) * 1.3)));
    if (away < 30) near.push(d[o + 2]);
    else if (away > 70) far.push(d[o + 2]);
  }
  assert.ok(near.length + far.length > B.count * 0.4, "too few stones flew in to tell");
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  assert.ok(mean(near) < mean(far) - 0.3, `stones by a focus landed at ${mean(near).toFixed(2)} s on average, those far from both at ${mean(far).toFixed(2)} s`);
});
