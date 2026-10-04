#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateProject } from '../engine/project.js';
import { ROOT, startServer } from './server.mjs';

export const HELP = `mosAIc - physical mosaic artwork for people and agents

  mosaic init <directory>
  mosaic preview [project.json] [--port 0]
  mosaic inspect [project.json]
  mosaic still [project.json] [--time 2] [--width 1920] [--samples 4] [--out output/still.png]
  mosaic render [project.json] [--from 0] [--to 120] [--width 1920] [--samples 4] [--out output/video.mp4]

The default project is examples/nocturne.json.
Video frame ranges are inclusive at --from and exclusive at --to.
Exports are always fresh and refuse to overwrite existing files.
Preview, init, and inspect need only Node 20+.
Capture also needs npm ci, Chromium, and ffmpeg for video.
Set MOSAIC_BROWSER to an installed Chromium executable, or run npx playwright-core install chromium.
`;

const OPTIONS = { init: [], preview: ['port'], inspect: [], still: ['time', 'width', 'samples', 'out'], render: ['from', 'to', 'width', 'samples', 'out'] };

export function parseArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') return { command: 'help' };
  const command = argv[0];
  if (!Object.hasOwn(OPTIONS, command)) throw new Error(`Unknown command: ${command}. Run mosaic --help.`);
  const result = { command };
  for (let i = 1; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--help' || value === '-h') return { command: 'help' };
    if (value.startsWith('--')) {
      const key = value.slice(2);
      if (!OPTIONS[command].includes(key)) throw new Error(`Unknown option for ${command}: ${value}`);
      if (result[key] !== undefined) throw new Error(`Option ${value} was provided twice.`);
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Option ${value} needs a value.`);
      result[key] = argv[++i];
    } else {
      if (result.project !== undefined) throw new Error('Provide only one project path.');
      result.project = value;
    }
  }
  if (command === 'init' && !result.project) throw new Error('init needs a destination directory.');
  return result;
}

function numeric(value, fallback, name, min, max, integer = false) {
  const n = value === undefined ? fallback : Number(value);
  if (typeof value === 'string' && !value.trim()) throw new Error(`${name} needs a number.`);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
  return n;
}

export async function inspectProject(projectFile) {
  const file = path.resolve(projectFile || path.join(ROOT, 'examples/nocturne.json'));
  let source;
  try { source = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`Cannot read project ${path.basename(file)}: ${error.message}`); }
  const project = validateProject(source);
  for (const scene of project.scenes) {
    if (typeof scene.picture !== 'string') throw new Error(`${scene.id}: a saved project must reference a scene module by path.`);
    if (/^[a-z][a-z\d+.-]*:/i.test(scene.picture) || scene.picture.startsWith('/')) throw new Error(`${scene.id}: use a relative local scene module path.`);
    const target = path.resolve(path.dirname(file), scene.picture);
    const relative = path.relative(path.dirname(file), target);
    if (relative.startsWith('..' + path.sep) || relative === '..') throw new Error(`${scene.id}: scene modules must be inside the project directory.`);
    try { await readFile(target); }
    catch { throw new Error(`${scene.id}: scene module not found: ${scene.picture}`); }
  }
  return { file, project, metadata: {
    title: project.title || 'Untitled mosaic', version: project.version, seed: project.seed,
    fps: project.fps, frames: project.frames, duration: project.frames * project.fps[1] / project.fps[0],
    band: project.band, scenes: project.scenes.map(s => ({ id: s.id, picture: s.picture, start: s.start, end: s.end }))
  } };
}

export function captureOptions(args, project) {
  const width = numeric(args.width, 1920, 'width', 16, 8192, true);
  const samples = numeric(args.samples, 4, 'samples', 1, 16, true);
  const lastTime = (project.frames - 1) * project.fps[1] / project.fps[0];
  if (args.command === 'still') {
    const time = numeric(args.time, Math.min(2, lastTime), 'time', 0, lastTime);
    return { kind: 'still', width, samples, time, out: path.resolve(args.out || 'output/still.png') };
  }
  if (width % 2) throw new Error('Video width must be even for H.264.');
  const from = numeric(args.from, 0, 'from', 0, project.frames - 1, true);
  const to = numeric(args.to, project.frames, 'to', from + 1, project.frames, true);
  return { kind: 'render', width, samples, from, to, out: path.resolve(args.out || 'output/video.mp4') };
}

export async function initProject(directory) {
  const destination = path.resolve(directory);
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length) throw new Error('The destination must be empty; no existing files were changed.');
  await cp(path.join(ROOT, 'engine'), path.join(destination, 'engine'), { recursive: true });
  await cp(path.join(ROOT, 'LICENSE'), path.join(destination, 'LICENSE'));
  await cp(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), path.join(destination, 'THIRD_PARTY_NOTICES.md'));
  const scene = (await readFile(path.join(ROOT, 'examples/nocturne.js'), 'utf8')).replaceAll('../engine/paint.js', './engine/paint.js');
  await writeFile(path.join(destination, 'scene.js'), scene);
  const project = JSON.parse(await readFile(path.join(ROOT, 'examples/nocturne.json'), 'utf8'));
  project.scenes[0].picture = './scene.js';
  await writeFile(path.join(destination, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  await writeFile(path.join(destination, 'index.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mosaic artwork</title>
<style>html,body{margin:0;background:#161916;color:#ede7d8;font:16px system-ui}main{max-width:1440px;margin:3vh auto}canvas{display:block;width:100%;height:auto;touch-action:none}p{padding:0 1rem}</style>
<main><canvas aria-label="Interactive mosaic artwork"></canvas><p id="status" role="status">Laying the stones...</p></main>
<script type="module">
import { createMosaic } from './engine/runtime.js';
const canvas=document.querySelector('canvas'),status=document.querySelector('#status');
try {
  const mosaic=await createMosaic(canvas,{project:new URL('./project.json',location.href),width:1600,samples:1});
  status.textContent=mosaic.info.title+' - move over the picture to lift its stones.';
  canvas.addEventListener('pointermove',event=>{const r=canvas.getBoundingClientRect();mosaic.setPointer({x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height,active:true,strength:1});});
  canvas.addEventListener('pointerleave',()=>mosaic.setPointer({active:false}));
  window.addEventListener('pagehide',()=>mosaic.dispose(),{once:true});
} catch(error) {status.textContent=error.message;}
</script></html>
`);
  return destination;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'help') { console.log(HELP); return; }
  if (args.command === 'init') {
    const directory = await initProject(args.project);
    console.log(`Created ${directory}\nPreview: node ${fileURLToPath(import.meta.url)} preview ${path.join(directory, 'project.json')}`);
    return;
  }
  const { file, project, metadata } = await inspectProject(args.project);
  if (args.command === 'inspect') { console.log(JSON.stringify(metadata, null, 2)); return; }
  if (args.command === 'preview') {
    const port = numeric(args.port, 0, 'port', 0, 65535, true);
    const server = await startServer({ projectFile: args.project ? file : undefined, port });
    const url = `${server.url}/site/${args.project ? '?project=' + encodeURIComponent(server.projectURL) : ''}`;
    console.log(`Mosaic studio: ${url}\nPress Ctrl-C to stop this local preview.`);
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      process.off('SIGINT', stop); process.off('SIGTERM', stop);
      await server.close();
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return;
  }
  const options = captureOptions(args, project);
  const { capture } = await import('./capture.mjs');
  const abort = new AbortController();
  const stop = () => abort.abort(new Error('Capture interrupted.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await capture({ ...options, projectFile: file, project, signal: abort.signal, onProgress: line => console.log(line) });
    console.log(`Wrote ${result.out}\nReceipt: ${result.receipt}`);
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}

const invokedFile = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  main().catch(error => { console.error(`Mosaic: ${error.message}`); process.exitCode = 1; });
}
