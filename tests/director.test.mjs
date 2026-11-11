import test from 'node:test';
import assert from 'node:assert/strict';
import { direct, subjectsOf, tour } from '../engine/director.js';
import { analyzeImage } from '../engine/image.js';
import { loadFilm, makeTimeline, packFilm, unpackFilm } from '../engine/timeline.js';

// A panel 1600 by 900 mm on which a patch 300 mm square at the top left is laid over the first
// four seconds, and then one at the bottom right over the next four.
function patches() {
  const stones = [];
  for (let i = 0; i < 900; i++) {
    stones.push({ x: 150 + (i % 30) * 10, y: 100 + Math.floor(i / 30) * 10, T: 0.2 + (3.8 * i) / 900 });
    stones.push({ x: 1200 + (i % 30) * 10, y: 550 + Math.floor(i / 30) * 10, T: 4 + (4 * i) / 900 });
  }
  return stones;
}
const at = (keys, t) => keys.findLast(k => k[0] <= t);

test('a directed camera frames where the stones land, moves on with them, and ends on the whole picture', () => {
  const keys = direct(patches(), { panel: { w: 1600, h: 900 }, aspect: 16 / 9, end: 11, onsets: [[2, 0.4], [4.02, 1], [6, 0.5]] });
  assert.ok(keys.every((k, i) => !i || k[0] > keys[i - 1][0]), JSON.stringify(keys));
  assert.equal(keys[0][0], 0);
  // It opens close on the first patch, which it holds whole, clear of the frame's edges.
  const [, x0, y0, w0] = at(keys, 1);
  assert.ok(Math.abs(x0 - 300) < 60 && Math.abs(y0 - 250) < 60 && w0 < 700, JSON.stringify(at(keys, 1)));
  // It changes shot on the strong onset, not on the weak ones, and is then on the second patch.
  assert.ok(keys.some(k => k[0] === 4.02) && !keys.some(k => k[0] === 2 || k[0] === 6));
  const [, x1, y1, w1] = at(keys, 5);
  assert.ok(Math.abs(x1 - 1350) < 60 && Math.abs(y1 - 700) < 60 && w1 < 700, JSON.stringify(at(keys, 5)));
  // Its move to the new shot is made in under a second.
  const before = keys[keys.findIndex(k => k[0] === 4.02) - 1];
  assert.ok(4.02 - before[0] <= 0.71 && Math.abs(before[1] - 300) < 60);
  // Once the last stone is laid it pulls back, and the film ends on the whole panel.
  assert.deepEqual(keys.at(-1), [11, 800, 450, 1538.5]);
  assert.ok(keys.at(-2)[0] > 8 && keys.at(-2)[0] < 10 && keys.at(-2)[3] === 1538.5);
  // No frame leaves the panel or is closer than the closest a director goes.
  for (const [, x, y, w] of keys) assert.ok(w >= 399 && x - w / 2 >= -1 && x + w / 2 <= 1601 && y - w / 3.56 >= -1 && y + w / 3.56 <= 901);
  // The same stones give the same camera; with no music a long laying is still cut into shots.
  assert.deepEqual(direct(patches(), { panel: { w: 1600, h: 900 }, aspect: 16 / 9, end: 11, onsets: [[2, 0.4], [4.02, 1], [6, 0.5]] }), keys);
  assert.ok(direct(patches(), { panel: { w: 1600, h: 900 }, aspect: 16 / 9, end: 11 }).length >= 6);
  assert.deepEqual(direct([], { panel: { w: 1600, h: 900 }, aspect: 16 / 9, end: 4 }), [[0, 800, 450, 1538.5], [4, 800, 450, 1538.5]]);
});

test('a laid scene with a directed camera follows its own stones, in a film handed over too', async () => {
  const picture = analyzeImage({ width: 96, height: 36, data: Uint8ClampedArray.from({ length: 96 * 36 * 4 }, (_, i) => [(i >> 2) % 96 * 2.5, 120, 200, 255][i % 4]) }, { maxDimension: 96, width: 320, stoneSize: 4, paletteSize: 6, seed: 3 });
  const film = async (camera, type = 'laid') => loadFilm({ version: 1, fps: [60, 1], frames: 600, band: [320, 120], scenes: [
    { id: 'one', picture: { ...picture, cfg: { ...picture.cfg, camera: { ...picture.cfg.camera, ...camera } } }, start: 0, end: 10, in: { type, build: { origin: [20, 60], start: 0, end: 8 } } }
  ] });
  const directed = await film({ direct: true, keys: undefined }), plain = await film({});
  const cam = makeTimeline(directed, 320, 120), still = makeTimeline(plain, 320, 120);
  // Laid from its left edge, the picture is followed from left to right, and shown whole at the end.
  const keys = directed.layers[0].pic.cfg.camera.keys;
  assert.ok(keys.length >= 6 && keys[1][1] < keys.at(-4)[1] - 30, JSON.stringify(keys));
  assert.deepEqual(keys.at(-1).slice(0, 3), [10, 160, 60]);
  assert.equal(plain.layers[0].pic.cfg.camera.direct, undefined);
  assert.ok(Math.abs(cam.cameraAt(9.9).w - still.cameraAt(9.9).w) < 1e-6);
  // The keys travel with the picture's config, so a film cut in a worker has the same camera.
  const back = makeTimeline(unpackFilm(structuredClone(packFilm(directed).film)), 320, 120);
  for (const t of [0, 1, 4, 7, 9.9]) assert.deepEqual(back.cameraAt(t), cam.cameraAt(t));
});

// A panel 1600 by 900 mm of dark blue ground, in two regions, with a gold disc at the top
// right, a white figure, tall and thin-necked, at the lower left, and gold flecks scattered
// over the lower ground.
function scene() {
  const stones = [], ground = [0.02, 0.06, 0.2];
  for (let y = 5; y < 900; y += 10) {
    for (let x = 5; x < 1600; x += 10) {
      const disc = Math.hypot(x - 1200, y - 220) < 90, body = Math.hypot((x - 400) / 110, (y - 650) / 70) < 1, neck = Math.abs(x - 470) < 16 && y > 440 && y < 620, head = Math.hypot(x - 480, y - 430) < 30;
      const fleck = y > 500 && (x * 7 + y * 13) % 211 === 0;
      stones.push(disc ? { x, y, area: 100, lin: [0.8, 0.55, 0.1], glow: 1, region: 'disc' }
        : body || neck || head ? { x, y, area: 100, lin: [0.85, 0.85, 0.8], glow: 0, region: 'figure' }
          : fleck ? { x, y, area: 100, lin: [0.8, 0.55, 0.1], glow: 1, region: 'flecks' }
            : { x, y, area: 100, lin: ground, glow: 0, region: y < 450 ? 'sky' : 'water' });
    }
  }
  return stones;
}
const panel = { w: 1600, h: 900 }, aspect = 16 / 9;

test('the subjects of a picture are its bodies, each framed whole, and not its ground or its scattered marks', () => {
  const subjects = subjectsOf(scene(), { panel, aspect });
  assert.equal(subjects.length, 2, JSON.stringify(subjects));
  // The gold disc is the more striking, and is framed close around itself.
  const [disc, figure] = subjects;
  assert.ok(Math.abs(disc[0] - 1200) < 25 && Math.abs(disc[1] - 220) < 25 && disc[2] <= 450, JSON.stringify(disc));
  // The figure is framed with its head, neck, and body: from 400 to 720 mm down the panel.
  const top = figure[1] - figure[2] / aspect / 2, bottom = figure[1] + figure[2] / aspect / 2;
  assert.ok(Math.abs(figure[0] - 420) < 60 && top < 400 && bottom > 720 && figure[2] < 900, JSON.stringify(figure));
  // A plain panel has no subject, and the same picture always has the same ones.
  assert.deepEqual(subjectsOf(scene().map(s => ({ ...s, lin: [0.02, 0.06, 0.2], glow: 0, region: 'ground' })), { panel, aspect }), []);
  assert.deepEqual(subjectsOf(scene(), { panel, aspect }), subjects);
});

test('a tour shows each subject close, the most striking last, and ends on the whole picture', () => {
  const subjects = [[1200, 220, 400], [420, 560, 640]], whole = [800, 450, 1538.5];
  const keys = tour(subjects, { panel, aspect, until: 12 });
  assert.ok(keys.every((k, i) => !i || k[0] > keys[i - 1][0]), JSON.stringify(keys));
  // It opens on the lesser subject a little wide and pushes in, then travels to the greater.
  assert.deepEqual(keys[0], [0, 420, 560, 716.8]);
  assert.deepEqual(keys[1].slice(1), [420, 560, 640]);
  assert.deepEqual(keys[2].slice(1), [1200, 220, 448]);
  assert.ok(Math.abs(keys[2][0] - keys[1][0] - 1.1) < 1e-9 && keys[1][0] >= 2.6 && keys[1][0] <= 6);
  assert.deepEqual(keys[3].slice(1), [1200, 220, 400]);
  // Then it pulls back over 1.6 seconds and rests on the whole for more than a second.
  assert.ok(Math.abs(keys.at(-2)[0] - keys[3][0] - 1.6) < 1e-9);
  assert.deepEqual(keys.at(-2).slice(1), whole);
  assert.deepEqual(keys.at(-1), [12, ...whole]);
  assert.ok(12 - keys.at(-2)[0] >= 1.2 - 1e-9);
  // After a flow or a laying it starts from the whole picture, and holds it until then.
  const after = tour(subjects, { panel, aspect, from: 5, until: 14, open: 'whole' });
  assert.deepEqual(after.slice(0, 2), [[0, ...whole], [5, ...whole]]);
  assert.ok(after[2][0] > 6 && after[2][1] === 420);
  // With time for one shot it shows the most striking subject, and with time for none, or
  // nothing to show, it only draws back to the whole picture.
  assert.deepEqual(tour(subjects, { panel, aspect, until: 6 }).map(k => k[1]), [1200, 1200, 800, 800]);
  const short = tour(subjects, { panel, aspect, until: 4 });
  assert.equal(short.length, 2);
  assert.ok(short[0][3] < whole[2] && short[0][1] > 800);
  assert.deepEqual(short[1], [4, ...whole]);
  assert.deepEqual(tour([], { panel, aspect, from: 3, until: 9, open: 'whole' }), [[0, ...whole], [3, ...whole], [9, ...whole]]);
  // A shot ends on a strong onset of the music near its time.
  const sung = tour(subjects, { panel, aspect, until: 12, onsets: [[1, 1], [4.9, 0.6], [5.1, 0.9]] });
  assert.equal(sung[1][0], 5.1);
});

test('directed scenes that are settled or flow in tour their pictures and are whole when a flock leaves', async () => {
  const image = (pixel) => analyzeImage({ width: 96, height: 54, data: Uint8ClampedArray.from({ length: 96 * 54 * 4 }, (_, i) => pixel((i >> 2) % 96, Math.floor((i >> 2) / 96))[i % 4]) }, { maxDimension: 96, width: 480, stoneSize: 12, paletteSize: 6, seed: 3, direct: true });
  // A dark picture with one bright square, then a pale one with one dark square.
  const night = image((x, y) => (x > 60 && x < 78 && y > 8 && y < 26 ? [240, 190, 60, 255] : [20, 40, 90, 255]));
  const day = image((x, y) => (x > 14 && x < 34 && y > 26 && y < 46 ? [40, 30, 20, 255] : [220, 215, 200, 255]));
  assert.equal(night.cfg.camera.direct, true);
  const film = await loadFilm({ version: 1, fps: [60, 1], frames: 1200, band: [480, 270], scenes: [
    { id: 'night', picture: night, start: 0, end: 10, in: { type: 'settled' } },
    { id: 'day', picture: day, start: 8, end: 20, in: { type: 'flow', launch: [8, 8.6], land: [8.8, 9.5] } }
  ] });
  const [a, b] = film.layers.map(L => L.pic.cfg.camera.keys), whole = (k) => k[1] === 240 && k[2] === 135 && k[3] > 450;
  // The settled picture opens close on its square and is whole again before the flock leaves at 8.
  assert.ok(a[0][0] === 0 && a[0][3] < 300 && Math.abs(a[0][1] - 347) < 30 && Math.abs(a[0][2] - 87) < 30, JSON.stringify(a));
  assert.ok(whole(a.at(-1)) && a.at(-1)[0] === 8 && whole(a.at(-2)) && a.at(-2)[0] <= 6.8 + 1e-9);
  // The one that flows in is shown whole until its flock has landed, then close on its square, then whole.
  assert.ok(whole(b[0]) && b[0][0] === 0 && whole(b[1]) && b[1][0] === 9.5, JSON.stringify(b));
  assert.ok(b[2][0] > 9.5 && b[2][3] < 300 && Math.abs(b[2][1] - 122) < 30 && Math.abs(b[2][2] - 182) < 30);
  assert.ok(whole(b.at(-1)) && b.at(-1)[0] === 20);
  // The flock is paired as for a picture seen whole: every stone of the day lands.
  const day2 = film.layers[1];
  let landed = 0;
  for (let i = 0; i < day2.count; i++) if (day2.data[i * 40 + 30] < 1e5) landed++;
  assert.ok(landed > day2.count * 0.9, `${landed} of ${day2.count} stones flew in`);
});
