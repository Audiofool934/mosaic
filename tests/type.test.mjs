import test from "node:test";
import assert from "node:assert/strict";
import { tessellate } from "../engine/tessellate.js";
import { ROWS, typeCells, typeWidth } from "../examples/type.js";

test("stone type sets every glyph on its grid of five by seven cells", () => {
  const all = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,-':?!&/";
  assert.equal(typeWidth(all, 2), (all.length * 6 - 1) * 2);
  const cells = typeCells(all, 10, 20, 2);
  for (const [x, y] of cells) {
    assert.equal((x - 10) % 2, 0);
    assert.ok(y >= 20 && y < 20 + ROWS * 2);
    // No cell falls in the column of space after its glyph.
    assert.notEqual(((x - 10) / 2) % 6, 5);
  }
  // An I is a stem of five with a cap and a foot of three each.
  assert.equal(typeCells("I", 0, 0, 1).length, 11);
  assert.throws(() => typeCells("é", 0, 0, 1), /no glyph/);
});

test("a grid region is set one stone to a cell, square to the panel", () => {
  // A panel 30 by 15 millimetres, two analysis pixels to the millimetre, with a block four
  // cells by two, each 5 mm, from (4, 3).
  const res = 2, GW = 60, GH = 30;
  const label = new Uint8Array(GW * GH), color = new Uint8ClampedArray(GW * GH * 4).fill(200);
  for (let y = 3 * res; y < 13 * res; y++) for (let x = 4 * res; x < 24 * res; x++) label[y * GW + x] = 1;
  const regions = [
    { id: 0, name: "none", tray: [] },
    { id: 1, name: "type", size: 5, mode: "grid", origin: [4, 3], tray: [{ hex: "#e6e1cc" }] }
  ];
  const { tiles, lines } = tessellate({ GW, GH, res, label, color, regions, seed: 7 });
  assert.equal(lines.length, 0, "a grid lays no courses");
  assert.equal(tiles.length, 8);
  // Which cell each stone sits on; the + 0 turns a rounded -0 into 0.
  const centres = tiles.map((t) => [Math.round((t.x - 6.5) / 5) + 0, Math.round((t.y - 5.5) / 5) + 0]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  assert.deepEqual(centres, [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]]);
  for (const t of tiles) {
    assert.ok(Math.abs(t.x - (6.5 + 5 * Math.round((t.x - 6.5) / 5))) < 0.2);
    assert.ok(Math.abs(t.ang) < 0.05);
    // Each stone fills most of its cell, less the mortar round it.
    assert.ok(t.area > 0.8 * 25 && t.area <= 25.5, `a stone took ${t.area} square millimetres`);
  }
});
