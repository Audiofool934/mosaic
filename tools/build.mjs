#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EXCLUDED_NAMES = new Set(['node_modules', 'output', 'dist']);
const PROJECT_TREES = ['engine', 'tools', 'site', 'examples', 'tests'];
const PUBLIC_FILES = ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/architecture.md', 'docs/provenance.md', 'docs/verification.md'];
const WEB_TREES = ['engine', 'site', 'examples'];
const WEB_FILES = ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/architecture.md', 'docs/provenance.md', 'docs/verification.md'];
const REDIRECT = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=./site/">
<title>mosAIc</title>
<script>location.replace(new URL('./site/' + location.search + location.hash, location.href));</script>
<a href="./site/">Open the mosaic studio</a>
</html>
`;

const sha256 = data => createHash('sha256').update(data).digest('hex');
const slash = name => name.split(path.sep).join('/');

async function exists(name) {
  try { await lstat(name); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function collectTree(directory, prefix = '', { skill = false } = {}) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name.startsWith('.') || EXCLUDED_NAMES.has(entry.name)) continue;
    const relative = slash(path.join(prefix, entry.name));
    if (skill && (relative === 'assets/runtime' || relative === 'manifest.json')) continue;
    if (entry.isSymbolicLink()) throw new Error(`Distribution source must not contain symlinks: ${relative}`);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTree(absolute, relative, { skill }));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Unsupported distribution source: ${relative}`);
  }
  return files;
}

async function skillRootFor(root) {
  const checkout = path.join(root, 'skills/mosaic');
  if (await exists(path.join(checkout, 'SKILL.md'))) return checkout;
  // A packaged runtime lives at <skill>/assets/runtime and can rebuild itself.
  const enclosing = path.resolve(root, '../..');
  if (await exists(path.join(enclosing, 'SKILL.md'))) return enclosing;
  throw new Error('Skill source missing: build from a complete checkout or installed skill bundle.');
}

async function readSources(root, skillRoot) {
  const sources = new Map();
  const projectPaths = [...PUBLIC_FILES];
  for (const tree of PROJECT_TREES) {
    for (const relative of await collectTree(path.join(root, tree))) projectPaths.push(`${tree}/${relative}`);
  }
  for (const relative of projectPaths.sort()) {
    const absolute = path.join(root, relative);
    if (!(await lstat(absolute)).isFile()) throw new Error(`Expected a regular source file: ${relative}`);
    sources.set(relative, await readFile(absolute));
  }
  for (const relative of await collectTree(skillRoot, '', { skill: true })) {
    sources.set(`skills/mosaic/${relative}`, await readFile(path.join(skillRoot, relative)));
  }
  for (const required of ['engine/runtime.js', 'tools/cli.mjs', 'site/index.html', 'examples/nocturne.json', 'skills/mosaic/SKILL.md', 'skills/mosaic/scripts/mosaic.mjs']) {
    if (!sources.has(required)) throw new Error(`Required distribution source missing: ${required}`);
  }
  return sources;
}

async function writeBundle(directory, kind, version, records) {
  const files = [];
  for (const record of records.sort((a, b) => a.path.localeCompare(b.path, 'en'))) {
    const destination = path.join(directory, record.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, record.data);
    files.push({ path: record.path, source: record.source, sha256: sha256(record.data), bytes: record.data.length });
  }
  const manifest = { schemaVersion: 1, kind, version, hashAlgorithm: 'sha256', files };
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function buildDistribution({ root = ROOT, outDir = path.join(root, 'dist') } = {}) {
  root = path.resolve(root);
  outDir = path.resolve(outDir);
  if (root === outDir) throw new Error('Build output must be separate from the source root.');
  const skillRoot = await skillRootFor(root);
  // Read once so web and skill copies use exactly the same source bytes.
  const sources = await readSources(root, skillRoot);
  const { version } = JSON.parse(sources.get('package.json').toString());
  const web = [{ path: 'index.html', source: null, data: Buffer.from(REDIRECT) }];
  const skill = [];
  for (const [source, data] of sources) {
    if (source.startsWith('skills/mosaic/')) {
      skill.push({ path: source.slice('skills/mosaic/'.length), source, data });
      continue;
    }
    skill.push({ path: `assets/runtime/${source}`, source, data });
    if (WEB_FILES.includes(source) || WEB_TREES.some(tree => source.startsWith(`${tree}/`))) web.push({ path: source, source, data });
  }
  await mkdir(outDir, { recursive: true });
  const staging = await mkdtemp(path.join(outDir, '.mosaic-build-'));
  try {
    const siteManifest = await writeBundle(path.join(staging, 'site'), 'web', version, web);
    const skillManifest = await writeBundle(path.join(staging, 'mosaic'), 'skill', version, skill);
    for (const name of ['site', 'mosaic']) {
      await rm(path.join(outDir, name), { recursive: true, force: true });
      await rename(path.join(staging, name), path.join(outDir, name));
    }
    return {
      version,
      site: path.join(outDir, 'site'),
      skill: path.join(outDir, 'mosaic'),
      files: { site: siteManifest.files.length, skill: skillManifest.files.length },
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const isEntry = process.argv[1] && await realpath(process.argv[1]).then(name => import.meta.url === pathToFileURL(name).href, () => false);
if (isEntry) {
  try { console.log(JSON.stringify(await buildDistribution(), null, 2)); }
  catch (error) { console.error(`Build failed: ${error.message}`); process.exitCode = 1; }
}
