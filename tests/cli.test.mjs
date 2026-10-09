import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HELP, captureOptions, imageSize, importProject, initProject, inspectProject, parseArgs, shellPath } from '../tools/cli.mjs';
import { fingerprintProject } from '../tools/capture.mjs';

const cli = fileURLToPath(new URL('../tools/cli.mjs', import.meta.url));
const project = { version: 1, seed: 42, frames: 240, fps: [30000, 1001], band: [1920, 1080], scenes: [{ id: 'one', picture: './scene.js', start: 0, end: 8, in: { type: 'settled' } }] };

test('CLI parses explicit commands and rejects ambiguous or misspelled input', () => {
  assert.deepEqual(parseArgs(['render', 'my art/project.json', '--from', '12', '--to', '24']), { command: 'render', project: 'my art/project.json', from: '12', to: '24' });
  assert.equal(parseArgs([]).command, 'help');
  assert.deepEqual(parseArgs(['import', 'my photo.jpg', 'my art', '--material', 'gold', '--stone-size', '8']), { command: 'import', image: 'my photo.jpg', project: 'my art', material: 'gold', 'stone-size': '8' });
  for (const args of [['import'], ['import', 'photo.jpg'], ['import', 'a.jpg', 'b', 'c'], ['import', 'a.jpg', 'b', '--time', '2']]) assert.throws(() => parseArgs(args));
  for (const args of [['init'], ['unknown'], ['still', '--sample', '2'], ['still', '--width'], ['inspect', 'one', 'two'], ['still', '--width', '200', '--width', '400']]) assert.throws(() => parseArgs(args));
});

test('numeric controls enforce finite bounds and exact integer frame ranges', () => {
  const range = captureOptions({ command: 'render', from: '17', to: '42', width: '1280', samples: '4' }, project);
  assert.equal(range.from, 17); assert.equal(range.to, 42); assert.equal(range.width, 1280);
  for (const option of [{ samples: '0' }, { width: 'NaN' }, { width: '99999' }, { width: '1919' }, { from: '-1' }, { from: '2.5' }, { to: '241' }, { from: '40', to: '20' }]) assert.throws(() => captureOptions({ command: 'render', ...option }, project));
  assert.throws(() => captureOptions({ command: 'still', time: '8.1' }, project));
  assert.throws(() => captureOptions({ command: 'still', time: '-0.1' }, project));
  const oneFrame = { ...project, frames: 1 };
  assert.equal(captureOptions({ command: 'still' }, oneFrame).time, 0);
});

test('init produces a portable project and protects existing files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mosaic-init-test-'));
  try {
    await initProject(directory);
    const { metadata } = await inspectProject(path.join(directory, 'project.json'));
    assert.equal(metadata.scenes[0].picture, './scene.js');
    const scene = await readFile(path.join(directory, 'scene.js'), 'utf8');
    assert.match(scene, /\.\/engine\/paint\.js/);
    assert.doesNotMatch(scene, /\.\.\/engine\/paint\.js/);
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.match(html, /createMosaic/); assert.match(html, /project\.json/);
    assert.match(await readFile(path.join(directory, 'engine/runtime.js'), 'utf8'), /export async function createMosaic/);
    assert.match(await readFile(path.join(directory, 'LICENSE'), 'utf8'), /MIT License/);
    assert.match(await readFile(path.join(directory, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /Copyright|license/i);
    await assert.rejects(initProject(directory), /must be empty/);
    assert.equal(await readFile(path.join(directory, 'scene.js'), 'utf8'), scene);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('inspect validates local manifests without executing a scene module', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mosaic-inspect-test-'));
  try {
    await writeFile(path.join(directory, 'scene.js'), 'throw new Error("A scene module must never execute in inspect");');
    await writeFile(path.join(directory, 'project.json'), JSON.stringify(project));
    const { metadata } = await inspectProject(path.join(directory, 'project.json'));
    assert.deepEqual(metadata.fps, [30000, 1001]);
    assert.equal(metadata.duration, 240 * 1001 / 30000);
    const result = spawnSync(process.execPath, [cli, 'inspect', path.join(directory, 'project.json')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).seed, 42);
    await writeFile(path.join(directory, 'project.json'), JSON.stringify({ ...project, scenes: [{ ...project.scenes[0], picture: '../escape.js' }] }));
    await assert.rejects(inspectProject(path.join(directory, 'project.json')), /inside the project/);
    // A picture can also be a function in a local module, called with plain arguments.
    const named = (module) => ({ ...project, scenes: [{ ...project.scenes[0], picture: { module, export: 'scene', args: { name: 'night' } } }] });
    await writeFile(path.join(directory, 'project.json'), JSON.stringify(named('./scene.js')));
    assert.deepEqual((await inspectProject(path.join(directory, 'project.json'))).metadata.scenes[0].picture.args, { name: 'night' });
    await writeFile(path.join(directory, 'project.json'), JSON.stringify(named('../escape.js')));
    await assert.rejects(inspectProject(path.join(directory, 'project.json')), /inside the project/);
    await writeFile(path.join(directory, 'project.json'), JSON.stringify({ ...project, scenes: [{ ...project.scenes[0], picture: { export: 'scene' } }] }));
    await assert.rejects(inspectProject(path.join(directory, 'project.json')), /by path/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('preview owns its loopback listener and closes cleanly on SIGTERM', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, [cli, 'preview', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview did not start: ' + errors)), 5000);
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/site\//);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { if (!output) { clearTimeout(timer); reject(new Error('Preview exited ' + code + ': ' + errors)); } });
    });
    assert.equal((await fetch(url)).status, 200);
    child.kill('SIGTERM');
    const result = await closed;
    assert.equal(result.code, 0, errors);
    await assert.rejects(fetch(url));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
});

test('capture identity includes local imported helpers and assets, while excluding exports and hidden files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mosaic-hash-test-'));
  try {
    const manifest = path.join(directory, 'project.json');
    await writeFile(manifest, JSON.stringify(project));
    await writeFile(path.join(directory, 'scene.js'), "import './drawing.js';");
    await writeFile(path.join(directory, 'drawing.js'), 'export const tone = 1;');
    await mkdir(path.join(directory, 'assets'));
    await writeFile(path.join(directory, 'assets/palette.json'), '["#123456"]');
    await mkdir(path.join(directory, 'output'));
    await writeFile(path.join(directory, 'output/old.png'), 'not an input');
    await writeFile(path.join(directory, '.secret.json'), 'private');
    const before = await fingerprintProject(manifest);
    assert.ok(before.files['drawing.js']);
    assert.ok(before.files['assets/palette.json']);
    assert.ok(!before.files['output/old.png']);
    assert.ok(!before.files['.secret.json']);
    await writeFile(path.join(directory, 'drawing.js'), 'export const tone = 2;');
    const after = await fingerprintProject(manifest);
    assert.equal(before.project, after.project);
    assert.notEqual(before.sourceTree, after.sourceTree);
    await writeFile(path.join(directory, 'output/old.png'), 'changed output');
    await writeFile(path.join(directory, '.secret.json'), 'changed private');
    assert.equal((await fingerprintProject(manifest)).sourceTree, after.sourceTree);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI entry runs through a filesystem symlink', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mosaic-entry-test-'));
  try {
    const entry = path.join(directory, 'mosaic.mjs');
    await symlink(cli, entry);
    const result = spawnSync(process.execPath, [entry, 'inspect'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).title, 'Moon over still water');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('help shows that render draws every frame unless --to is given', () => {
  assert.match(HELP, /--to <all frames>/);
  assert.doesNotMatch(HELP, /--to 120/);
  const all = captureOptions({ command: 'render' }, project);
  assert.equal(all.from, 0); assert.equal(all.to, project.frames);
});

test('printed paths are quoted for a shell only where they need it', async () => {
  assert.equal(shellPath('/home/me/art/project.json'), '/home/me/art/project.json');
  assert.equal(shellPath('/home/me/my art/project.json'), '"/home/me/my art/project.json"');
  assert.equal(shellPath('/tmp/a"b$c/x'), '"/tmp/a\\"b\\$c/x"');
  const parent = await mkdtemp(path.join(os.tmpdir(), 'mosaic hint test '));
  try {
    const directory = path.join(parent, 'my art');
    const result = spawnSync(process.execPath, [cli, 'init', directory], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`preview "${path.join(directory, 'project.json')}"`), result.stdout);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

// Minimal headers: only the bytes the size reader looks at.
function jpeg({ width, height, orientation }) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (orientation) {
    const tiff = Buffer.alloc(26);
    tiff.write('II', 0, 'latin1'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18);
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const head = Buffer.from([0xff, 0xe1, 0, 0]); head.writeUInt16BE(body.length + 2, 2);
    parts.push(head, body);
  }
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7);
  parts.push(sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

test('image sizes are read from PNG, GIF, WebP, and JPEG headers, upright', async () => {
  const png = Buffer.alloc(24); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4); png.write('IHDR', 12, 'latin1'); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
  assert.deepEqual(imageSize(png), { width: 640, height: 480, type: 'png' });
  const gif = Buffer.alloc(10); gif.write('GIF89a', 0, 'latin1'); gif.writeUInt16LE(320, 6); gif.writeUInt16LE(200, 8);
  assert.deepEqual(imageSize(gif), { width: 320, height: 200, type: 'gif' });
  const webp = (chunk) => { const b = Buffer.alloc(30); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write(chunk, 12, 'latin1'); return b; };
  const lossless = webp('VP8L'); lossless.writeUInt32LE((800 - 1) | ((600 - 1) << 14), 21);
  assert.deepEqual(imageSize(lossless), { width: 800, height: 600, type: 'webp' });
  const extended = webp('VP8X'); extended.writeUIntLE(1999, 24, 3); extended.writeUIntLE(999, 27, 3);
  assert.deepEqual(imageSize(extended), { width: 2000, height: 1000, type: 'webp' });
  assert.deepEqual(imageSize(await readFile(new URL('../examples/photo/heron.webp', import.meta.url))), { width: 1280, height: 720, type: 'webp' });
  assert.deepEqual(imageSize(jpeg({ width: 4032, height: 3024 })), { width: 4032, height: 3024, type: 'jpeg' });
  assert.deepEqual(imageSize(jpeg({ width: 4032, height: 3024, orientation: 6 })), { width: 3024, height: 4032, type: 'jpeg' });
  assert.deepEqual(imageSize(jpeg({ width: 4032, height: 3024, orientation: 3 })), { width: 4032, height: 3024, type: 'jpeg' });
  assert.equal(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});

test('import makes a portable project whose band follows the image', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'mosaic-import-test-'));
  try {
    const portrait = path.join(parent, 'tall photo.jpg');
    await writeFile(portrait, jpeg({ width: 4032, height: 3024, orientation: 6 }));
    const directory = path.join(parent, 'tall art');
    const made = await importProject(portrait, directory, { material: 'gold', stoneSize: '9' });
    assert.equal(made.width, 3024); assert.equal(made.height, 4032);
    const { project: manifest, metadata } = await inspectProject(path.join(directory, 'project.json'));
    assert.deepEqual(manifest.band, [1600, 2133]);
    assert.equal(metadata.title, 'tall photo');
    assert.deepEqual(metadata.scenes[0].picture, { module: './photo.js', export: 'photo', args: { src: './image.jpg', material: 'gold', stoneSize: 9 } });
    const module = await readFile(path.join(directory, 'photo.js'), 'utf8');
    assert.match(module, /from "\.\/engine\/image\.js"/);
    assert.deepEqual(await readFile(path.join(directory, 'image.jpg')), await readFile(portrait));
    assert.match(await readFile(path.join(directory, 'engine/image.js'), 'utf8'), /export async function imageToPicture/);
    assert.match(await readFile(path.join(directory, 'index.html'), 'utf8'), /project\.json/);
    await assert.rejects(importProject(portrait, directory), /must be empty/);
    await assert.rejects(importProject(portrait, path.join(parent, 'other'), { material: 'chrome' }), /glass, stone, or gold/);
    await assert.rejects(importProject(portrait, path.join(parent, 'other'), { stoneSize: '1' }), /stone-size/);
    const svg = path.join(parent, 'mark.svg');
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await assert.rejects(importProject(svg, path.join(parent, 'other')), /PNG, JPEG, WebP, or GIF/);
    const result = spawnSync(process.execPath, [cli, 'import', portrait, path.join(parent, 'from cli')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3024×4032 image/);
    assert.ok(result.stdout.includes(`preview "${path.join(parent, 'from cli', 'project.json')}"`), result.stdout);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('the shipped photo and page-wall examples are valid projects', async () => {
  const photo = await inspectProject(fileURLToPath(new URL('../examples/photo/project.json', import.meta.url)));
  assert.deepEqual(photo.project.band, [1600, 900]);
  const wall = await inspectProject(fileURLToPath(new URL('../examples/page-wall/project.json', import.meta.url)));
  assert.equal(wall.metadata.scenes[0].picture.export, 'pageWall');
});
