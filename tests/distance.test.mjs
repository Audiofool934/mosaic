import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { edt } from "../engine/util.js";

// Independent oracle: enumerate source pixels in the documented tie order.
function bruteForce(source, width, height) {
  const sites = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (source[y * width + x]) sites.push([x, y]);
    }
  }
  const dist = new Float32Array(width * height);
  const near = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minimum = 1e20;
      let nearest = 0;
      for (const [sx, sy] of sites) {
        const squared = (x - sx) ** 2 + (y - sy) ** 2;
        if (squared < minimum) {
          minimum = squared;
          nearest = sy * width + sx;
        }
      }
      dist[y * width + x] = Math.sqrt(minimum);
      near[y * width + x] = nearest;
    }
  }
  return { dist, near };
}

function check(source, width, height) {
  const before = source.slice();
  const actual = edt(source, width, height);
  assert.deepEqual(actual, bruteForce(source, width, height));
  assert.deepEqual(source, before, "the source mask is not modified");
  return actual;
}

// This independent generator keeps fixture data stable if engine RNGs change.
function mask(width, height, seed, density) {
  let state = seed >>> 0;
  return Uint8Array.from({ length: width * height }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296 < density ? 1 : 0;
  });
}

test("EDT handles empty, full, singleton, and one-dimensional masks", () => {
  for (const [width, height] of [[0, 0], [1, 1], [1, 9], [9, 1], [9, 7]]) {
    const source = new Uint8Array(width * height);
    check(source, width, height);
    source.fill(1);
    check(source, width, height);
    if (source.length) {
      source.fill(0);
      source[source.length - 1] = 2;
      check(source, width, height);
    }
  }
});

test("EDT ties prefer lowest x before lowest y", () => {
  // At (1,1), index 6 wins over the lower array index 2 because x is smaller.
  const diagonal = Uint8Array.from([0, 0, 1, 0, 0, 0, 1, 0, 0]);
  assert.equal(check(diagonal, 3, 3).near[4], 6);
  const corners = Uint8Array.from([1, 0, 1, 0, 0, 0, 1, 0, 1]);
  assert.equal(check(corners, 3, 3).near[4], 0);
  const vertical = Uint8Array.from([1, 0, 1]);
  assert.equal(check(vertical, 1, 3).near[1], 0);
});

test("EDT agrees with brute force for every 4 by 3 binary mask", () => {
  for (let bits = 0; bits < 1 << 12; bits++) {
    const source = Uint8Array.from({ length: 12 }, (_, i) => (bits >>> i) & 1);
    check(source, 4, 3);
  }
});

test("EDT agrees with brute force on sparse and dense rectangular fixtures", () => {
  for (const [width, height] of [[7, 19], [37, 11], [61, 47]]) {
    for (const density of [0.01, 0.2, 0.8]) {
      for (const seed of [0, 19, 74]) check(mask(width, height, seed, density), width, height);
    }
  }
});

function fingerprint({ dist, near }) {
  // Explicit little-endian encoding makes the legacy fingerprints portable.
  const bytes = new ArrayBuffer((dist.length + near.length) * 4);
  const view = new DataView(bytes);
  dist.forEach((value, i) => view.setFloat32(i * 4, value, true));
  near.forEach((value, i) => view.setInt32((dist.length + i) * 4, value, true));
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

test("EDT retains the extracted engine's distances and source choices", () => {
  // Captured from sketches be7fb47 before replacing its unattributed EDT helper.
  // Only output fingerprints are retained, not the legacy implementation.
  const fixtures = [
    [61, 47, 19, 0.13, "9a7ba841a45d182fef41ba42e7f33613df8665c414d3c7fb8ac3ab6e03f8d447"],
    [401, 223, 74, 0.001, "6b2bf6af82fb313f87c378d0da82673ff71c260ee42a061f54cf3d8af5a47f2c"],
    [32, 48, 256, 0.71, "4b5edf845fd216708fbcd63f1e1a6aef80423c36405e5d3eef8b97bcb9e03c31"],
  ];
  for (const [width, height, seed, density, expected] of fixtures) {
    const result = edt(mask(width, height, seed, density), width, height);
    assert.equal(fingerprint(result), expected);
  }
});
