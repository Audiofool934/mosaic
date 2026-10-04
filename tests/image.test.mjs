import test from "node:test";
import assert from "node:assert/strict";
import { analyzeImage, imageToPicture } from "../engine/image.js";
import { tessellate } from "../engine/tessellate.js";

function fixture(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}

const small = { maxDimension: 64, width: 160, stoneSize: 10 };
const halves = fixture(64, 48, (x) => x < 32 ? [25, 58, 90, 255] : [224, 175, 99, 255]);

test("image analysis is deterministic and does not mutate input pixels", async () => {
  const before = new Uint8ClampedArray(halves.data);
  const options = { ...small, seed: 938, paletteSize: 8 };
  const first = analyzeImage(halves, options);
  const second = await imageToPicture(halves, options);
  assert.deepEqual(first.label, second.label);
  assert.deepEqual(first.color, second.color);
  assert.deepEqual(first.regions, second.regions);
  assert.deepEqual(first.metadata, second.metadata);
  assert.deepEqual(halves.data, before);
  assert.equal(first.seed, 938);
});

test("a two-colour silhouette remains a clean boundary and tessellates into real stones", () => {
  const pic = analyzeImage(halves, { ...small, paletteSize: 2 });
  assert.equal(pic.regions.length, 3);
  const left = pic.label[0], right = pic.label[pic.GW - 1];
  assert.notEqual(left, right);
  for (let y = 0; y < pic.GH; y++) {
    for (let x = 0; x < pic.GW; x++) assert.equal(pic.label[y * pic.GW + x], x < pic.GW / 2 ? left : right);
  }
  const result = tessellate(pic);
  assert.ok(result.tiles.length > 50, "the adapter must feed the contour tessellator, not a flat pixel filter");
  assert.ok(result.lines.length > 0);
  assert.ok(result.tiles.every((tile) => tile.quad.length === 4 && tile.quad.flat().every(Number.isFinite)));
  const used = new Set(result.tiles.map((tile) => tile.L));
  assert.deepEqual(used, new Set([left, right]));
});

test("panel aspect preserves landscape, portrait, and non-integer raster ratios", () => {
  for (const [width, height] of [[31, 19], [19, 31], [47, 11]]) {
    const pic = analyzeImage(fixture(width, height, () => [80, 120, 160, 255]), small);
    assert.equal(pic.W, small.width);
    assert.equal(pic.H, small.width * height / width);
    assert.equal(pic.cfg.panel.h, pic.H);
    assert.equal(Math.max(pic.GW, pic.GH), small.maxDimension);
    assert.equal(pic.label.length, pic.GW * pic.GH);
    assert.equal(pic.color.length, pic.GW * pic.GH * 4);
    assert.ok(Math.abs(pic.GH / pic.res - pic.H) <= 1 / pic.res);
  }
});

test("transparent RGB cannot contaminate colours or generate stones", () => {
  const source = fixture(64, 64, (x, y) => x >= 16 && x < 48 && y >= 16 && y < 48 ? [30, 90, 140, 255] : [255, 0, 255, 0]);
  const pic = analyzeImage(source, { ...small, paletteSize: 8 });
  assert.equal(pic.label[0], 0);
  assert.deepEqual([...pic.color.slice(0, 4)], [0, 0, 0, 0]);
  assert.equal(pic.metadata.visiblePixels, 32 * 32);
  assert.deepEqual(pic.metadata.palette, ["#1e5a8c"]);
  const result = tessellate(pic);
  assert.ok(result.tiles.length > 0);
  assert.ok(result.tiles.every((tile) => tile.L !== 0 && tile.x >= 40 && tile.x <= 120 && tile.y >= 40 && tile.y <= 120));
});

test("partial alpha composites against the selected background", () => {
  const pic = analyzeImage(fixture(4, 4, () => [200, 100, 20, 128]), { ...small, background: "#000000" });
  assert.deepEqual([...pic.color.slice(0, 4)], [100, 50, 10, 255]);
  assert.equal(pic.cfg.light.grout, "#000000");
});

test("texture does not create an unbounded region table and gold requires explicit selection", () => {
  const noisy = fixture(96, 96, (x, y) => [(x * 47 + y * 71) % 256, (x * 83 + y * 17) % 256, (x * 13 + y * 37) % 256, 255]);
  const pic = analyzeImage(noisy, { ...small, paletteSize: 48 });
  assert.ok(pic.regions.length <= 49);
  assert.ok([...pic.label].every((label) => label < pic.regions.length));
  assert.ok(pic.regions.slice(1).every((region) => region.mode === "contour" && region.tray.every((entry) => entry.mat === 0)));
  for (const [material, expected] of [["stone", 3], ["gold", 1]]) {
    const other = analyzeImage(halves, { ...small, material });
    assert.ok(other.regions.slice(1).every((region) => region.tray.every((entry) => entry.mat === expected)));
  }
});

test("validation rejects unusable input and controls before doing expensive work", async () => {
  for (const options of [{ stoneSize: 0 }, { stoneSize: NaN }, { paletteSize: 255 }, { paletteSize: 3.5 }, { detail: 1.1 }, { maxDimension: 4096 }, { width: -10 }, { seed: -1 }, { material: "yellow" }, { background: "transparent" }]) {
    assert.throws(() => analyzeImage(halves, options), RangeError);
  }
  assert.throws(() => analyzeImage({ width: 0, height: 2, data: [] }), /positive integer/);
  assert.throws(() => analyzeImage({ width: 2, height: 2, data: [0] }), /RGBA/);
  assert.throws(() => analyzeImage(fixture(4, 4, () => [255, 255, 255, 0]), small), /fully transparent/);
  assert.throws(() => analyzeImage({ width: 1, height: 1, data: [0, 0, NaN, 255] }, small), /finite/);
  await assert.rejects(imageToPicture(42), /File\/Blob/);
  await assert.rejects(imageToPicture(new Blob(["video"], { type: "video/mp4" })), /still image/);
});
