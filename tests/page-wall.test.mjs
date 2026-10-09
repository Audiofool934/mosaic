import test from 'node:test';
import assert from 'node:assert/strict';
import { pageWall, wallScale } from '../examples/page-wall/wall.js';

test('a page wall stays within the working raster and the stone budget of one layer', () => {
  assert.deepEqual(wallScale(1280, 900), { res: 1, stone: 14 });
  const long = wallScale(1440, 12000);
  assert.ok(long.res < 1);
  assert.ok(12000 * long.res <= 8192 && 1440 * 12000 * long.res ** 2 <= 33554432);
  assert.ok((1440 * 12000) / long.stone ** 2 <= 40000 + 1);
});

test('a page wall frames each measured block and ignores malformed ones', () => {
  const picture = pageWall({ w: 1280, h: 2000, holes: [[100, 100, 400, 200], [0, 0, 0, 10], 'not a box'] });
  assert.deepEqual(picture.config.panel, { w: 1280, h: 2000 });
  assert.equal(picture.config.background, 'field');
  const regions = picture.regions();
  assert.deepEqual(regions.map(r => r.name), ['field', 'rim', 'plate']);
  assert.ok(regions.filter(r => r.name !== 'field').every(r => r.still));
  // The drawing paints the field once, then a rim and a plate for the one valid block.
  const fills = [];
  const D = { fill: (path, region) => fills.push(region), linear: () => '#000000' };
  globalThis.Path2D ??= class { rect() {} };
  picture.draw(null, 'colour', D);
  assert.deepEqual(fills, ['field', 'rim', 'plate']);
  assert.throws(() => pageWall({ w: 0, h: 10 }), /positive width/);
});
