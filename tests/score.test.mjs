import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALS } from '../engine/picture.js';
import { RATE, scoreLandings } from '../engine/score.js';
import { renderScore, wavOf } from '../engine/sound.js';
import { captureOptions, parseArgs } from '../tools/cli.mjs';

// A wall 1.6 m wide of 9 mm stones, gold on its left half and marble on its right, laid one
// after another from the top left over `seconds`, each falling for a quarter of a second.
function wall(count, seconds, { fall = 0.25, leave = Infinity } = {}) {
  const cols = 160, data = new Float32Array(count * 40), h = 0.0045;
  for (let i = 0; i < count; i++) {
    const o = i * 40;
    data[o] = (i % cols) * 0.01; data[o + 1] = -Math.floor(i / cols) * 0.01; data[o + 2] = (seconds * i) / count;
    [[-h, -h], [h, -h], [h, h], [-h, h]].forEach(([x, y], k) => { data[o + 4 + k * 2] = x; data[o + 5 + k * 2] = y; });
    data[o + 15] = i % cols < cols / 2 ? MATERIALS.gold : MATERIALS.marble; data[o + 23] = fall; data[o + 24] = leave;
  }
  return { data, count };
}
const viewAt = () => ({ x: 0.8, y: -0.2, w: 1.6, h: 0.4 });

test('a film is heard as a pour: a few real stones of every moment, louder the more land with them', () => {
  const layers = [wall(6400, 2)], heard = scoreLandings(layers, { viewAt, seed: 42 });
  // 3,200 stones a second land, and at most sixty of them are heard, one in each moment.
  assert.ok(heard.length > 100 && heard.length <= 2 * RATE, `${heard.length} stones heard in two seconds`);
  assert.equal(new Set(heard.map(e => Math.floor(e.time * RATE))).size, heard.length);
  assert.ok(heard.every((e, i) => !i || e.time >= heard[i - 1].time));
  assert.ok(heard.every(e => e.kind === 'land' && Math.abs(e.size - 9) < 0.01 && e.strength === 1 && e.x >= 0 && e.x <= 1 && e.y >= 0 && e.y <= 1));
  // Each is a stone of the film: gold where it is gold, heard from the side it lands on.
  assert.ok(heard.every(e => e.material === (e.x < 0.5 ? 'gold' : 'marble')));
  assert.ok(heard.some(e => e.material === 'gold') && heard.some(e => e.material === 'marble'));
  // The same film is heard the same; another seed hears other stones of it.
  assert.deepEqual(scoreLandings(layers, { viewAt, seed: 42 }), heard);
  assert.notDeepEqual(scoreLandings(layers, { viewAt, seed: 7 }), heard);
  // A part of the film is heard as it is in the whole, to excluded.
  const part = scoreLandings(layers, { viewAt, seed: 42, from: 0.5, to: 1 });
  assert.deepEqual(part, heard.filter(e => e.time >= 0.5 && e.time < 1));
  // A thin trickle is softer than a pour, and never silent.
  const trickle = scoreLandings([wall(40, 2)], { viewAt, seed: 42 });
  assert.equal(trickle.length, 40);
  assert.ok(trickle.every(e => e.strength > 0.3 && e.strength < 0.6));
});

test('stones set in place, stones that never arrive, and stones out of view are not heard', () => {
  assert.deepEqual(scoreLandings([wall(6400, 2, { fall: 0.0005 })], { viewAt }), []);
  assert.deepEqual(scoreLandings([wall(6400, 2, { leave: -1 })], { viewAt }), []);
  assert.deepEqual(scoreLandings([wall(6400, 2)], { viewAt: () => ({ x: 9, y: 9, w: 1.6, h: 0.4 }) }), []);
  // Stones seated before the range begins are already on the wall.
  assert.deepEqual(scoreLandings([wall(6400, 2)], { viewAt, from: 2.5, to: 5 }), []);
  // A view of the left half hears only its gold.
  const left = scoreLandings([wall(6400, 2)], { viewAt: () => ({ x: 0.4, y: -0.2, w: 0.8, h: 0.4 }) });
  assert.ok(left.length > 50 && left.every(e => e.material === 'gold'));
});

test('a score is mixed to the same samples every time, in stereo, softly and without clipping', () => {
  const heard = scoreLandings([wall(6400, 2)], { viewAt, seed: 42, from: 0.5 });
  const [left, right] = renderScore(heard, { from: 0, duration: 2.5 });
  assert.equal(left.length, 120000);
  assert.deepEqual(renderScore(heard, { from: 0, duration: 2.5 }), [left, right]);
  let peak = 0, before = 0;
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    if (i < 0.49 * 48000) before = Math.max(before, Math.abs(left[i]), Math.abs(right[i]));
  }
  assert.ok(peak > 0.05 && peak < 0.9, `the mix peaked at ${peak}`);
  // Nothing is heard before the first stone lands, and the film does not end on a click.
  assert.equal(before, 0);
  assert.equal(Math.abs(left.at(-1)), 0);
  // A stone at the left of the frame is heard more on the left.
  const energy = (samples) => samples.reduce((sum, v) => sum + v * v, 0);
  const one = renderScore([{ kind: 'land', time: 0, material: 'glass', size: 10, strength: 1, x: 0, y: 0.5 }], { duration: 0.5 });
  assert.ok(energy(one[0]) > 2 * energy(one[1]));
  // A part of the film starts on its own clock.
  const late = renderScore(heard, { from: 0.5, duration: 0.25 });
  assert.ok(energy(late[0]) > 0);
});

test('a mix is written as a 16-bit stereo WAV file', () => {
  const wav = wavOf([Float32Array.of(0, 1, 2), Float32Array.of(0, -1, -2)], 48000), view = new DataView(wav.buffer);
  assert.equal(wav.length, 44 + 12);
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString() + Buffer.from(wav.subarray(8, 16)).toString() + Buffer.from(wav.subarray(36, 40)).toString(), 'RIFFWAVEfmt data');
  assert.deepEqual([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true), view.getUint32(40, true)], [2, 48000, 16, 12]);
  // Samples beyond full scale are held at it.
  assert.deepEqual([2, 3, 4, 5].map(i => view.getInt16(44 + i * 2, true)), [32767, -32767, 32767, -32767]);
});

test('a film is silent unless --sound is given, which takes no value', () => {
  const project = { version: 1, seed: 42, frames: 240, fps: [60, 1], band: [1920, 1080], scenes: [] };
  assert.deepEqual(parseArgs(['render', 'film.json', '--sound', '--to', '24']), { command: 'render', project: 'film.json', sound: true, to: '24' });
  assert.equal(captureOptions(parseArgs(['render', '--sound']), project).sound, true);
  assert.equal(captureOptions(parseArgs(['render']), project).sound, false);
  for (const args of [['render', '--sound', '--sound'], ['still', '--sound']]) assert.throws(() => parseArgs(args));
});
