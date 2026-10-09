import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HELP, captureOptions, initProject, inspectProject, parseArgs, shellPath } from '../tools/cli.mjs';
import { fingerprintProject } from '../tools/capture.mjs';

const cli = fileURLToPath(new URL('../tools/cli.mjs', import.meta.url));
const project = { version: 1, seed: 42, frames: 240, fps: [30000, 1001], band: [1920, 1080], scenes: [{ id: 'one', picture: './scene.js', start: 0, end: 8, in: { type: 'settled' } }] };

test('CLI parses explicit commands and rejects ambiguous or misspelled input', () => {
  assert.deepEqual(parseArgs(['render', 'my art/project.json', '--from', '12', '--to', '24']), { command: 'render', project: 'my art/project.json', from: '12', to: '24' });
  assert.equal(parseArgs([]).command, 'help');
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
