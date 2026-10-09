#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateProject } from '../engine/project.js';
import { ROOT, startServer } from './server.mjs';

export const HELP = `mosAIc - physical mosaic artwork for people and agents

  mosaic init <directory>
  mosaic import <image> <directory> [--material glass] [--stone-size 12]
  mosaic preview [project.json] [--port 0]
  mosaic inspect [project.json]
  mosaic still [project.json] [--time 2] [--width 1920] [--samples 4] [--out output/still.png]
  mosaic render [project.json] [--from 0] [--to <all frames>] [--width 1920] [--samples 4] [--out output/video.mp4]

The default project is examples/nocturne.json.
import makes a project of a PNG, JPEG, WebP, or GIF; --material is glass, stone, or gold.
Video frame ranges are inclusive at --from and exclusive at --to; render draws every frame unless --to is given.
Exports are always fresh and refuse to overwrite existing files.
Preview, init, import, and inspect need only Node 20+.
Capture also needs npm ci, Chromium, and ffmpeg for video.
Set MOSAIC_BROWSER to an installed Chromium executable, or run npx playwright-core install chromium.
`;

const OPTIONS = { init: [], import: ['material', 'stone-size'], preview: ['port'], inspect: [], still: ['time', 'width', 'samples', 'out'], render: ['from', 'to', 'width', 'samples', 'out'] };

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
    } else if (command === 'import' && result.image === undefined) {
      result.image = value;
    } else {
      if (result.project !== undefined) throw new Error(command === 'import' ? 'Provide one image and one destination directory.' : 'Provide only one project path.');
      result.project = value;
    }
  }
  if (command === 'init' && !result.project) throw new Error('init needs a destination directory.');
  if (command === 'import' && !result.project) throw new Error('import needs an image and a destination directory.');
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
    // A scene module by path, or a picture function in one, called with plain arguments.
    const module = typeof scene.picture === 'string' ? scene.picture : scene.picture?.module;
    if (typeof module !== 'string') throw new Error(`${scene.id}: a saved project must reference a scene module by path, or { module, export, args }.`);
    if (/^[a-z][a-z\d+.-]*:/i.test(module) || module.startsWith('/')) throw new Error(`${scene.id}: use a relative local scene module path.`);
    const target = path.resolve(path.dirname(file), module);
    const relative = path.relative(path.dirname(file), target);
    if (relative.startsWith('..' + path.sep) || relative === '..') throw new Error(`${scene.id}: scene modules must be inside the project directory.`);
    try { await readFile(target); }
    catch { throw new Error(`${scene.id}: scene module not found: ${module}`); }
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

// Quotes a path for a shell only where it needs it, so a printed command can be pasted.
export function shellPath(file) {
  return /^[\w@%+=:,./-]+$/.test(file) ? file : `"${file.replace(/(["\\$`])/g, '\\$1')}"`;
}

// The page that shows a project, written into each new project directory.
const VIEWER = `<!doctype html>
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
`;

// A new project directory carries its own copy of the engine and its notices.
async function scaffold(directory) {
  const destination = path.resolve(directory);
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length) throw new Error('The destination must be empty; no existing files were changed.');
  await cp(path.join(ROOT, 'engine'), path.join(destination, 'engine'), { recursive: true });
  await cp(path.join(ROOT, 'LICENSE'), path.join(destination, 'LICENSE'));
  await cp(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), path.join(destination, 'THIRD_PARTY_NOTICES.md'));
  await writeFile(path.join(destination, 'index.html'), VIEWER);
  return destination;
}

export async function initProject(directory) {
  const destination = await scaffold(directory);
  const scene = (await readFile(path.join(ROOT, 'examples/nocturne.js'), 'utf8')).replaceAll('../engine/paint.js', './engine/paint.js');
  await writeFile(path.join(destination, 'scene.js'), scene);
  const project = JSON.parse(await readFile(path.join(ROOT, 'examples/nocturne.json'), 'utf8'));
  project.scenes[0].picture = './scene.js';
  await writeFile(path.join(destination, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  return destination;
}

// The pixel size of a PNG, GIF, JPEG, or WebP file, read from its header, or null.
export function imageSize(data) {
  const ascii = (start, end) => data.toString('latin1', start, end);
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && ascii(12, 16) === 'IHDR') return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), type: 'png' };
  if (data.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6))) return { width: data.readUInt16LE(6), height: data.readUInt16LE(8), type: 'gif' };
  if (data.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const chunk = ascii(12, 16);
    if (chunk === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff, type: 'webp' };
    if (chunk === 'VP8L') { const bits = data.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, type: 'webp' }; }
    if (chunk === 'VP8X') return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1, type: 'webp' };
    return null;
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let at = 2, turned = false;
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) { at++; continue; }
      const marker = data[at + 1];
      if (marker === 0xff) { at++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      // A start-of-frame marker carries the size; DHT, JPG, and DAC share its range but do not.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const width = data.readUInt16BE(at + 7), height = data.readUInt16BE(at + 5);
        return turned ? { width: height, height: width, type: 'jpeg' } : { width, height, type: 'jpeg' };
      }
      // Browsers turn a photo upright from its EXIF orientation, so a quarter turn swaps its sides.
      if (marker === 0xe1 && ascii(at + 4, at + 10) === 'Exif\0\0') turned = exifTurned(data, at + 10);
      if (marker === 0xd9 || marker === 0xda) return null;
      at += 2 + data.readUInt16BE(at + 2);
    }
  }
  return null;
}

// Whether a JPEG's EXIF orientation (5 to 8) turns it a quarter, from its TIFF header.
function exifTurned(data, tiff) {
  if (tiff + 8 > data.length) return false;
  const little = data.toString('latin1', tiff, tiff + 2) === 'II';
  const u16 = at => (little ? data.readUInt16LE(at) : data.readUInt16BE(at));
  const u32 = at => (little ? data.readUInt32LE(at) : data.readUInt32BE(at));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > data.length) return false;
  for (let i = 0, n = u16(ifd); i < n && ifd + 14 + i * 12 <= data.length; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) === 0x0112) return u16(entry + 8) >= 5 && u16(entry + 8) <= 8;
  }
  return false;
}

const IMPORT_MATERIALS = ['glass', 'stone', 'gold'];
const IMPORT_TYPES = { png: '.png', gif: '.gif', jpeg: '.jpg', webp: '.webp' };

// An image of one's own as a project: the image, a picture function that analyses it in the
// browser, and a manifest whose band follows the image's shape.
export async function importProject(image, directory, { material = 'glass', stoneSize = 12 } = {}) {
  if (!IMPORT_MATERIALS.includes(material)) throw new Error('--material must be glass, stone, or gold.');
  const size = numeric(stoneSize, 12, '--stone-size', 3, 100);
  let data;
  try { data = await readFile(image); }
  catch (error) { throw new Error(`Cannot read image ${path.basename(image)}: ${error.message}`); }
  const info = imageSize(data);
  if (!info || !(info.width > 0 && info.height > 0)) throw new Error(`Cannot read the size of ${path.basename(image)}. Use a PNG, JPEG, WebP, or GIF image.`);
  const destination = await scaffold(directory);
  const name = 'image' + IMPORT_TYPES[info.type];
  await writeFile(path.join(destination, name), data);
  const module = (await readFile(path.join(ROOT, 'examples/photo/photo.js'), 'utf8')).replaceAll('../../engine/image.js', './engine/image.js');
  await writeFile(path.join(destination, 'photo.js'), module);
  const project = JSON.parse(await readFile(path.join(ROOT, 'examples/photo/project.json'), 'utf8'));
  project.title = path.basename(image, path.extname(image)) || 'Your mosaic';
  // The engine lays an image 1600 millimetres wide, so the band shares its shape.
  project.band = [1600, Math.max(2, Math.round(1600 * info.height / info.width))];
  project.scenes[0].picture.args = { src: `./${name}`, material, stoneSize: size };
  await writeFile(path.join(destination, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  return { destination, ...info };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'help') { console.log(HELP); return; }
  if (args.command === 'init') {
    const directory = await initProject(args.project);
    console.log(`Created ${directory}\nPreview: node ${shellPath(fileURLToPath(import.meta.url))} preview ${shellPath(path.join(directory, 'project.json'))}`);
    return;
  }
  if (args.command === 'import') {
    const { destination, width, height } = await importProject(args.image, args.project, { material: args.material, stoneSize: args['stone-size'] });
    const manifest = shellPath(path.join(destination, 'project.json'));
    console.log(`Created ${destination} from a ${width}×${height} image\nPreview: node ${shellPath(fileURLToPath(import.meta.url))} preview ${manifest}\nStill: node ${shellPath(fileURLToPath(import.meta.url))} still ${manifest} --out ${shellPath(path.join(destination, 'output/still.png'))}`);
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
