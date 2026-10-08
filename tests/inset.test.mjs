import test from "node:test";
import assert from "node:assert/strict";
import { loadPicture } from "../engine/picture.js";
import { INSETS, INSET_REACH, TRAIL, insetRadius, insetsNear, markTrail, wallInsets } from "../engine/renderer.js";
import { methodPicture, treePicture, wallPicture } from "../home/wall.js";
import { BANDS, config as tree } from "../examples/tree.js";

const close = (actual, expected, message) => {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${message}: ${actual} is not ${expected}`));
};

test("a picture's insets are placed on the wall with the picture, in metres, y up the wall", () => {
  // A picture placed 100 mm in and 50 mm down the wall, with one inset 10 mm in and 20 mm down
  // the picture, 30 by 40 mm.
  const layers = [{ world: [0.1, -0.05], pic: { cfg: { insets: [[10, 20, 30, 40]] } } }, { world: [0, 0], pic: { cfg: {} } }];
  const [inset, ...rest] = wallInsets(layers);
  close(inset, [0.11, -0.11, 0.14, -0.07], "the inset's corners");
  assert.equal(rest.length, 0, "a picture without insets adds none");
});

test("only the insets within the pointer's reach are kept, nearest first", () => {
  const out = new Float32Array(INSETS * 4);
  const far = [2, 2, 2.1, 2.1], near = [0.05, -0.05, 0.15, 0.05], nearer = [-0.1, -0.1, -0.02, 0.1];
  // The head: x, y, cull radius, and the wall's curl radius.
  const n = insetsNear([0, 0, 0.5, 0.25], [far, near, nearer], out);
  assert.equal(n, 2);
  close(Array.from(out.subarray(0, 8)), [...nearer, ...near].map(Math.fround), "the insets kept");
  assert.equal(insetsNear([0, 0, 0, 0.25], [near], out), 0, "a pointer with no input reaches none");
});

test("each point of the trail belongs to the nearest inset within its curl's reach, or to none", () => {
  // Two samples 200 mm square with 20 mm of wall between them, as on the page.
  const a = [0, 0, 0.2, 0.2], b = [0.22, 0, 0.42, 0.2];
  const insets = Float32Array.from([...a, ...b]);
  const reach = insetRadius(...a, 0.25);
  assert.ok(Math.abs(reach - INSET_REACH * 0.2) < 1e-9, "an inset's curl is sized to its shorter side");
  assert.equal(insetRadius(...a, 0.01), 0.01, "and never reaches further than the wall's");
  const points = [[0.1, 0.1], [0.215, 0.1], [0.205, 0.1], [0.1, 0.2 + reach * 0.9], [0.1, 0.2 + reach * 1.1], [0.6, 0.6]];
  const trail = new Float32Array(TRAIL * 4);
  points.forEach(([x, y], k) => trail.set([x, y, 0.5, 0], k * 4));
  const out = markTrail([0.3, 0.3, 1, 0.25], trail, insets, 2, new Float32Array(TRAIL * 4));
  assert.deepEqual(points.map((_, k) => out[k * 4 + 3]), [1, 2, 1, 1, 0, 0], "over a, between them nearer b, nearer a, just above a, clear of both, far off");
  for (let k = 0; k < points.length; k++) close(Array.from(out.subarray(k * 4, k * 4 + 3)), Array.from(trail.subarray(k * 4, k * 4 + 3)), "the point itself");
});

test("a picture rejects insets that are not [x, y, w, h] in millimetres", async () => {
  const picture = (insets) => ({ config: { panel: { w: 100, h: 100 }, insets }, regions: () => [], draw() {} });
  for (const insets of [[[0, 0, 10]], [[0, 0, -10, 10]], [[0, 0, 10, Number.NaN]], {}]) {
    await assert.rejects(loadPicture(picture(insets)), /insets must be a list/);
  }
});

test("the page sets each material sample into its wall as an inset, and nothing else", () => {
  const blocks = [{ kind: "sample", material: "gold", x: 731, y: 150, w: 190, h: 190 }, { kind: "sample", material: "silver", x: 941, y: 150, w: 190, h: 190 }, { kind: "emblem", x: 100, y: 500, w: 300, h: 200 }];
  const { config } = wallPicture({ width: 1440, height: 900, hero: 900, scale: 1.11, blocksOnly: true, blocks });
  assert.equal(config.insets.length, 2);
  close(config.insets[0], [731, 150, 190, 190].map((v) => v * 1.11), "the gold sample, in the wall's millimetres");
});

test("the page's gold frames hold still under the pointer, and the method's live band is an inset", () => {
  const { regions } = wallPicture({ width: 1440, height: 900, hero: 900, scale: 1.11, blocksOnly: true, blocks: [] });
  assert.equal(regions().find((r) => r.name === "frame").still, true);
  assert.deepEqual(methodPicture({ w: 400, h: 600 }).config.insets, [[0, 0, 400, 600]]);
});

test("the tree's bands run down its panel in order, and its live band is its foot, an inset of its own", () => {
  assert.ok(BANDS.every((y, i) => y > (BANDS[i - 1] ?? 0) && y < tree.panel.h), `bands ${BANDS} within ${tree.panel.h} mm`);
  // A band as tall as the foot's own shape is scaled, not cropped, and moves on its own.
  const w = 300, h = (300 * (tree.panel.h - BANDS[2])) / tree.panel.w;
  const band = treePicture({ w, h });
  assert.deepEqual(band.config.insets, [[0, 0, w, h]]);
  assert.ok(Math.abs(band.config.res - tree.res / (w / tree.panel.w)) < 1e-9, "the band keeps the tree's raster density");
});
