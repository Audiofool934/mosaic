import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeImage } from '../engine/image.js';
import { validateProject } from '../engine/project.js';
import { wavOf } from '../engine/sound.js';
import { loadFilm, makeTimeline } from '../engine/timeline.js';
import { inspectProject, musicProject, parseArgs } from '../tools/cli.mjs';
import { findOnsets, readTrack, readWav } from '../tools/music.mjs';

// Four seconds with a plucked note at each of `times`, the third a quiet one, over a faint hiss.
function plucks(rate, times = [0.5, 1, 1.25, 2, 3.1]) {
  const s = new Float32Array(rate * 4);
  times.forEach((t, k) => {
    for (let i = 0; i < rate * 0.3; i++) s[Math.round(t * rate) + i] += (k === 2 ? 0.2 : 0.8) * Math.sin((2 * Math.PI * 220 * (k + 1) * i) / rate) * Math.exp(-i / (rate * 0.04));
  });
  let seed = 1;
  for (let i = 0; i < s.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; s[i] += (seed / 4294967296 - 0.5) * 0.002; }
  return s;
}

test('the onsets of a track are found where its notes begin, at any sample rate', () => {
  for (const rate of [22050, 44100, 48000]) {
    const onsets = findOnsets(plucks(rate), rate);
    assert.equal(onsets.length, 5, `${onsets.length} onsets at ${rate} Hz: ${JSON.stringify(onsets)}`);
    [0.5, 1, 1.25, 2, 3.1].forEach((t, k) => assert.ok(Math.abs(onsets[k][0] - t) < 0.016, `the note at ${t} s was heard at ${onsets[k][0]} s at ${rate} Hz`));
    assert.ok(onsets.every(([, strength]) => strength > 0 && strength <= 1) && onsets.some(([, strength]) => strength === 1));
  }
  // Silence, a steady tone, and a track too short to compare have no onsets.
  assert.deepEqual(findOnsets(new Float32Array(48000), 48000), []);
  assert.deepEqual(findOnsets(new Float32Array(100), 48000), []);
  const tone = Float32Array.from({ length: 96000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000));
  assert.deepEqual(findOnsets(tone, 48000), []);
});

test('a WAV file is read without ffmpeg, and anything else is not mistaken for one', async () => {
  const s = plucks(44100), back = readWav(wavOf([s, s], 44100));
  assert.equal(back.rate, 44100);
  assert.equal(back.channels.length, 2);
  assert.ok(back.channels[0].every((v, i) => Math.abs(v - s[i]) < 1e-4));
  assert.equal(readWav(Buffer.from('not a wave file at all')), null);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mosaic-music-'));
  try {
    await writeFile(path.join(directory, 'plucks.wav'), wavOf([s, s], 44100));
    const heard = await readTrack(path.join(directory, 'plucks.wav'));
    assert.equal(heard.rate, 44100);
    assert.equal(heard.duration, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a project names its track and onsets as plain data', () => {
  const project = { version: 1, fps: [60, 1], frames: 240, band: [320, 120], scenes: [{ id: 'one', picture: './scene.js', start: 0, end: 4, in: { type: 'laid' } }] };
  const music = { src: './track.wav', at: 0.5, onsets: [[0.5, 1], [1, 0.4]], steady: 0.2, ring: 0.05, contrast: 1.5, gain: 0.6, stones: 1.2 };
  assert.deepEqual(validateProject({ ...project, music }).music, music);
  for (const bad of [{}, { src: '' }, { src: './t.wav', at: -1 }, { src: './t.wav', onsets: [[1, 1], [0.5, 1]] }, { src: './t.wav', onsets: [[1, 2]] }, { src: './t.wav', onsets: [[1]] }, { src: './t.wav', steady: 2 }, { src: './t.wav', ring: 0 }, { src: './t.wav', gain: 9 }, { src: './t.wav', contrast: -1 }, { src: './t.wav', kick: 0.5 }, 'track.wav']) {
    assert.throws(() => validateProject({ ...project, music: bad }), /music/);
  }
  assert.throws(() => validateProject({ ...project, scenes: [{ ...project.scenes[0], in: { type: 'laid', music: 'no' } }] }), /music/);
});

test('with music, laid stones land on the onsets and just after, more of them on the stronger', async () => {
  const picture = analyzeImage({ width: 96, height: 36, data: Uint8ClampedArray.from({ length: 96 * 36 * 4 }, (_, i) => [(i >> 2) % 96 * 2.5, 120, 200, 255][i % 4]) }, { maxDimension: 96, width: 320, stoneSize: 6, paletteSize: 6, seed: 3 });
  const scene = { id: 'laid', picture, start: 0, end: 4, in: { type: 'laid', build: { origin: [160, 60], start: 0, end: 4 } } };
  const base = { version: 1, fps: [60, 1], frames: 240, band: [320, 120] };
  const landings = async (music, into = scene.in) => {
    const film = await loadFilm({ ...base, ...(music && { music }), scenes: [{ ...scene, in: into }] });
    return Array.from({ length: film.layers[0].count }, (_, i) => film.layers[0].data[i * 40 + 2]);
  };
  const onsets = [[1, 1], [2, 0.25], [3, 1]];
  const T = await landings({ src: './track.wav', onsets, steady: 0, contrast: 1 });
  assert.ok(T.length > 300, `${T.length} stones`);
  // Every stone lands on an onset or soon after it, nearly all within a third of a second, and
  // none before the first.
  assert.ok(T.every(t => onsets.some(([at]) => t >= at && t < at + 0.7)));
  assert.ok(T.filter(t => onsets.some(([at]) => t >= at && t < at + 0.35)).length > 0.98 * T.length);
  const share = at => T.filter(t => t >= at && t < at + 0.35).length / T.length;
  assert.ok(Math.abs(share(1) - 4 / 9) < 0.03 && Math.abs(share(2) - 1 / 9) < 0.03 && Math.abs(share(3) - 4 / 9) < 0.03, `${share(1)}, ${share(2)}, ${share(3)}`);
  // Half of each onset's stones have landed within a twentieth of a second of it.
  assert.ok(T.filter(t => t >= 1 && t < 1.05).length > 0.45 * T.filter(t => t >= 1 && t < 1.35).length);
  // Left to itself, the strong onsets take more of the stones from the weak one: its share
  // follows the square of its strength, and nearly all the stones land on onsets.
  const accented = await landings({ src: './track.wav', onsets });
  const weak = accented.filter(t => t >= 2 && t < 2.35).length / accented.length;
  assert.ok(weak > 0.01 && weak < 0.06, `${weak} of the stones landed on the weak onset`);
  assert.ok(accented.filter(t => onsets.some(([at]) => t >= at && t < at + 0.35)).length > 0.93 * accented.length);
  // A steady share is laid evenly, so stones land between the onsets too; the order they are laid in stays the same.
  const steady = await landings({ src: './track.wav', onsets, steady: 0.5 });
  assert.ok(steady.some(t => t < 0.9) && steady.some(t => t > 1.5 && t < 1.95));
  const plain = await landings(null), rank = list => list.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  assert.deepEqual(rank(T), rank(plain));
  // A track that starts later in the film moves its onsets with it, and a scene can decline the music.
  const late = await landings({ src: './track.wav', at: 0.5, onsets, steady: 0, contrast: 1 });
  assert.ok(late.every(t => t >= 1.5) && late.some(t => t < 1.55));
  assert.deepEqual(await landings({ src: './track.wav', onsets, steady: 0 }, { ...scene.in, music: false }), plain);
});

test('with a kick, the camera leans in on each onset, more on the stronger, and eases back out', async () => {
  const picture = analyzeImage({ width: 96, height: 36, data: Uint8ClampedArray.from({ length: 96 * 36 * 4 }, (_, i) => [(i >> 2) % 96 * 2.5, 120, 200, 255][i % 4]) }, { maxDimension: 96, width: 320, stoneSize: 6, paletteSize: 6, seed: 3 });
  const widths = async (music) => {
    const film = await loadFilm({ version: 1, fps: [60, 1], frames: 240, band: [320, 120], ...(music && { music }), scenes: [{ id: 'one', picture, start: 0, end: 4, in: { type: 'settled' } }] });
    const timeline = makeTimeline(film, 320, 120);
    return (t) => timeline.cameraAt(t).w;
  };
  const onsets = [[1, 1], [2.5, 0.5]], plain = await widths(null), w = await widths({ src: './track.wav', onsets, kick: 0.04 });
  // Away from the onsets the view is the scene's own, and without a kick it always is.
  const still = await widths({ src: './track.wav', onsets });
  for (const t of [0, 0.5, 0.94, 1, 1.2, 2.5, 3.9]) assert.equal(still(t), plain(t));
  assert.equal(w(0.5), plain(0.5));
  assert.equal(w(0.94), plain(0.94));
  // On the strongest onset it has leaned in by the whole kick, and it is already on its way a moment before.
  assert.ok(Math.abs(w(1) / plain(1) - 0.96) < 1e-9);
  assert.ok(w(0.98) < plain(0.98) && w(0.98) > w(1));
  // It eases back out: most of the way after half a second, and all but there before the next onset.
  assert.ok(w(1.5) > w(1.25) && w(1.25) > w(1) && w(1.5) / plain(1.5) > 0.994 && w(2.4) / plain(2.4) > 0.9998);
  // An onset half as strong moves it a quarter as far.
  assert.ok(Math.abs((1 - w(2.5) / plain(2.5)) - 0.01) < 2e-4);
  // A track that starts later kicks later.
  const late = await widths({ src: './track.wav', at: 1, onsets, kick: 0.04 });
  assert.equal(late(1), plain(1));
  assert.ok(Math.abs(late(2) / plain(2) - 0.96) < 1e-9);
});

test('music makes a portable film of a track, with its onsets in the manifest', async () => {
  assert.deepEqual(parseArgs(['music', 'my track.wav', 'my film']), { command: 'music', track: 'my track.wav', project: 'my film' });
  for (const args of [['music'], ['music', 'a.wav'], ['music', 'a.wav', 'b', 'c'], ['music', 'a.wav', 'b', '--sound']]) assert.throws(() => parseArgs(args));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'mosaic-music-'));
  try {
    const s = plucks(44100), track = path.join(parent, 'Five plucks.wav');
    await writeFile(track, wavOf([s, s], 44100));
    const made = await musicProject(track, path.join(parent, 'film'));
    assert.equal(made.onsets, 5);
    const { project, metadata } = await inspectProject(path.join(made.destination, 'project.json'));
    assert.equal(project.title, 'Five plucks');
    assert.equal(project.frames, 240);
    assert.deepEqual(metadata.music, { src: './track.wav', at: 0, onsets: 5 });
    assert.equal(project.music.kick, 0.035);
    assert.deepEqual(project.scenes[0].picture, { module: './laid.js', export: 'laid', args: { duration: 4 } });
    assert.deepEqual(await readFile(path.join(made.destination, 'track.wav')), await readFile(track));
    // The manifest keeps one onset to a line, and the scene draws from the project's own engine.
    assert.match(await readFile(path.join(made.destination, 'project.json'), 'utf8'), /\n {6}\[\d\.\d+, \d(\.\d+)?\],?\n/);
    assert.match(await readFile(path.join(made.destination, 'laid.js'), 'utf8'), /from "\.\/scene\.js"/);
    assert.match(await readFile(path.join(made.destination, 'scene.js'), 'utf8'), /\.\/engine\/paint\.js/);
    // An existing directory is left alone, a missing track is named, and a track that leaves the project is refused.
    await assert.rejects(musicProject(track, path.join(parent, 'film')), /must be empty/);
    await assert.rejects(musicProject(path.join(parent, 'none.wav'), path.join(parent, 'other')), /Cannot read track none\.wav/);
    await assert.rejects(musicProject(path.join(parent, 'notes.txt'), path.join(parent, 'other')), /Cannot read notes\.txt/);
    const manifest = path.join(made.destination, 'project.json'), source = JSON.parse(await readFile(manifest, 'utf8'));
    await writeFile(manifest, JSON.stringify({ ...source, music: { ...source.music, src: '../Five plucks.wav' } }));
    await assert.rejects(inspectProject(manifest), /inside the project directory/);
    await writeFile(manifest, JSON.stringify({ ...source, music: { ...source.music, src: './gone.wav' } }));
    await assert.rejects(inspectProject(manifest), /track not found/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
