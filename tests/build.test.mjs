import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildDistribution } from '../tools/build.mjs';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKILL_PREFIX = 'skills/mosaic/';

async function filesIn(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await filesIn(path.join(directory, entry.name), `${relative}/`));
    else result.push(relative);
  }
  return result.sort();
}

function canonicalSource(source) {
  if (source.startsWith(SKILL_PREFIX) && !existsSync(path.join(ROOT, 'skills/mosaic/SKILL.md'))) {
    return path.resolve(ROOT, '../..', source.slice(SKILL_PREFIX.length));
  }
  return path.join(ROOT, source);
}

async function compareBundle(directory, kind) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.kind, kind);
  assert.equal(manifest.hashAlgorithm, 'sha256');
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual((await filesIn(directory)).filter(name => name !== 'manifest.json'), manifest.files.map(file => file.path).sort());
  for (const file of manifest.files) {
    assert.equal(path.isAbsolute(file.path), false);
    assert.equal(file.path.split('/').some(part => part.startsWith('.') || part === 'node_modules' || part === 'output' || part === 'dist'), false);
    const data = await readFile(path.join(directory, file.path));
    assert.equal(data.length, file.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256);
    assert.equal(data.includes(Buffer.from(ROOT)), false, `${file.path} must not contain the source checkout path`);
    if (file.source !== null) {
      assert.equal(path.isAbsolute(file.source), false);
      assert.equal(file.source.split('/').includes('..'), false);
      assert.deepEqual(data, await readFile(canonicalSource(file.source)), `${file.path} differs from its canonical source`);
    }
  }
  return manifest;
}

test('web and skill distributions retain canonical bytes, notices, and source manifests', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mosaic-build-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const built = await buildDistribution({ outDir: path.join(temporary, 'dist') });
  await compareBundle(built.site, 'web');
  const skillManifest = await compareBundle(built.skill, 'skill');
  const runtime = path.join(built.skill, 'assets/runtime');
  for (const directory of [built.site, runtime]) {
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md']) {
      assert.deepEqual(await readFile(path.join(directory, name)), await readFile(path.join(ROOT, name)));
    }
  }
  for (const name of ['package.json', 'package-lock.json', 'tools/build.mjs']) {
    assert.deepEqual(await readFile(path.join(runtime, name)), await readFile(path.join(ROOT, name)));
  }
  // The website opens on the project page, which holds the studio itself, and still carries the
  // standalone studio; the skill never carries the page.
  const home = await readFile(path.join(built.site, 'index.html'));
  assert.deepEqual(home, await readFile(path.join(ROOT, 'index.html')));
  assert.match(home.toString(), /id="atelier-canvas"/);
  assert.equal((await filesIn(built.site)).includes('site/index.html'), true);
  assert.equal((await filesIn(built.site)).some(name => name.startsWith('home/media/')), true);
  const skillFiles = await filesIn(built.skill);
  assert.equal(skillFiles.includes('assets/runtime/index.html'), false);
  assert.equal(skillFiles.some(name => name.startsWith('assets/runtime/home/')), false);

  await t.test('the installed skill wrapper runs outside the checkout without npm dependencies', async () => {
    const { stdout } = await exec(process.execPath, [path.join(built.skill, 'scripts/mosaic.mjs'), 'inspect'], {
      cwd: temporary, timeout: 10_000,
    });
    const info = JSON.parse(stdout);
    assert.equal(info.title, 'Moon over still water');
    assert.deepEqual(info.band, [1920, 1080]);
    assert.equal(existsSync(path.join(runtime, 'node_modules')), false);
  });

  await t.test('the installed runtime can rebuild the same complete skill without recursive copies', async () => {
    const { stdout } = await exec(process.execPath, [path.join(runtime, 'tools/build.mjs')], { cwd: temporary, timeout: 20_000 });
    const rebuilt = JSON.parse(stdout);
    const next = await compareBundle(rebuilt.skill, 'skill');
    assert.deepEqual(next, skillManifest);
    // Without the project page, the rebuilt website still opens the studio.
    const redirect = await readFile(path.join(rebuilt.site, 'index.html'), 'utf8');
    assert.match(redirect, /url=\.\/site\//);
    assert.match(redirect, /location\.search/);
    assert.match(redirect, /location\.hash/);
    assert.equal((await filesIn(rebuilt.skill)).some(name => name.includes('/runtime/assets/runtime/')), false);
  });

  await t.test('a symlink source fails before replacing an existing distribution', async () => {
    const outside = path.join(temporary, 'private-source.txt');
    await writeFile(outside, 'This file is outside the published source trees.');
    await symlink(outside, path.join(runtime, 'engine/unexpected.js'));
    const before = await readFile(path.join(runtime, 'dist/mosaic/manifest.json'));
    await assert.rejects(buildDistribution({ root: runtime }), /must not contain symlinks/);
    assert.deepEqual(await readFile(path.join(runtime, 'dist/mosaic/manifest.json')), before);
    await rm(path.join(runtime, 'engine/unexpected.js'));
  });
});
