#!/usr/bin/env node
// Renders the pictures the project page shows beside its live wall, from the examples and
// through the same engine: the name in stone over the night, wide and tall, which stands in
// for the wall without WebGL2 and makes the share image; the method's first three bands, the
// heron by the moon as a flat drawing, as courses, and as cut stones, and the same of the tree
// under the moon for a phone, in bands across it; the flat paintings the
// studio in the wall offers to lay; and the short film. Run it after a visual change to the
// engine or the examples, with the names of the parts to render, or none for all of them:
// stills, method, tree, paintings, film.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';
import { capture } from './capture.mjs';
import { inspectProject } from './cli.mjs';
import { ROOT, startServer } from './server.mjs';

const OUT = path.join(ROOT, 'home/media');
// The method's bands: where each ends across the nocturne's panel, in millimetres, so the
// heron stays whole in the band of courses and the moon is split between the cut stones and
// the wall's own; the fourth runs on to the panel's edge, 1600. home/wall.js lays the fourth
// from the last edge, and index.html sizes the bands to the same shares.
const EDGES = [430, 800, 1110];
// Pixels to the millimetre in the bands.
const BAND_SCALE = 2;
// The tree's bands run down its panel, ending where examples/tree.js says, and are drawn finer,
// since its panel is smaller and a phone shows it close.
const TREE_SCALE = 3;

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error(`ffmpeg failed: ${result.error?.message || result.stderr.toString().trim()}`);
}

const webp = (input, output, { width, at, crop } = {}) => {
  const filters = [crop, width && `scale=${width}:-2:flags=lanczos`].filter(Boolean);
  ffmpeg([...(at ? ['-ss', String(at)] : []), '-i', input, ...(filters.length ? ['-vf', filters.join(',')] : []), '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', output]);
};

async function still(work, manifest, time, width, name) {
  const { file, project } = await inspectProject(path.join(ROOT, manifest));
  const out = path.join(work, `${name}.png`);
  await capture({ kind: 'still', projectFile: file, project, width, samples: 4, time, out });
  console.log(`Rendered ${name}`);
  return out;
}

// Runs fn in a page served from the project, and writes each data URL it returns to a PNG.
async function inPage(work, fn, arg) {
  const server = await startServer();
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/LICENSE`);
    const images = await page.evaluate(fn, arg);
    const files = {};
    for (const [name, url] of Object.entries(images)) {
      files[name] = path.join(work, `${name}.png`);
      await writeFile(files[name], Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
    return files;
  } finally {
    await browser.close();
    await server.close();
  }
}

// A picture, its whole panel, as a flat drawing, as the courses its stones are laid along, and
// as the stones cut from them on dark mortar: the cut the wall uses, at the scene's own
// resolution and the page's seed.
const drawPlates = async ({ scale, module }) => {
  const { loadPicture } = await import('/engine/picture.js');
  const { tessellate } = await import('/engine/tessellate.js');
  const { hexRgb } = await import('/engine/util.js');
  const mod = await import(module);
  const { w: W, h: H } = mod.config.panel;
  const plate = (paint) => {
    const c = document.createElement('canvas');
    c.width = W * scale;
    c.height = H * scale;
    const g = c.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    paint(g);
    return c.toDataURL('image/png');
  };
  const raster = (pic) => {
    const c = document.createElement('canvas');
    c.width = pic.GW;
    c.height = pic.GH;
    c.getContext('2d').putImageData(new ImageData(pic.color, pic.GW, pic.GH), 0, 0);
    return c;
  };
  const mix = (a, b, u) => a.map((v, i) => Math.round(v + (b[i] - v) * u));
  const css = (rgb) => `rgb(${rgb.join(' ')})`;

  // The flat drawing, painted at four pixels to the millimetre for a crisp plate.
  const fine = await loadPicture({ ...mod, config: { ...mod.config, res: 4 } });
  const drawing = plate((g) => { g.imageSmoothingQuality = 'high'; g.drawImage(raster(fine), 0, 0, W, H); });

  const pic = await loadPicture(module, location.href);
  pic.seed = 42;
  const { lines, tiles } = tessellate(pic);
  const tone = pic.regions.map((r) => {
    const rgb = r.tray.map((e) => hexRgb(e.hex));
    return rgb.length ? rgb[0].map((_, i) => rgb.reduce((n, c) => n + c[i], 0) / rgb.length) : [0, 0, 0];
  });
  const paper = [238, 236, 229];
  const flow = plate((g) => {
    g.globalAlpha = 0.26;
    g.drawImage(raster(fine), 0, 0, W, H);
    g.globalAlpha = 1;
    g.fillStyle = css(paper);
    g.globalCompositeOperation = 'destination-over';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.lineWidth = 1.05 / scale;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const line of lines) {
      if (line.pts.length < 2) continue;
      g.strokeStyle = css(mix(tone[line.L], [16, 38, 44], 0.38));
      g.beginPath();
      line.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  });
  const cut = plate((g) => {
    g.fillStyle = mod.config.light.grout;
    g.fillRect(0, 0, W, H);
    for (const t of tiles) {
      // Corners are kept in the stone's own frame, as timeline.js reads them.
      const c = Math.cos(t.ang), n = Math.sin(t.ang);
      g.fillStyle = t.stone.hex;
      g.beginPath();
      t.quad.forEach(([u, v], i) => {
        const x = t.x + u * c - v * n, y = t.y + u * n + v * c;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.closePath();
      g.fill();
    }
  });
  return { drawing, flow, cut };
};

// Three of the examples' scenes as flat paintings, for the studio in the wall to lay: the heron
// by the moon, the coast at dawn, and the peaks at first light.
const drawPaintings = async ({ width }) => {
  const { loadPicture } = await import('/engine/picture.js');
  const { scene } = await import('/examples/landscapes.js');
  const flat = async (source) => {
    const pic = await loadPicture(source, location.href);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round((width * pic.H) / pic.W);
    const raster = document.createElement('canvas');
    raster.width = pic.GW;
    raster.height = pic.GH;
    raster.getContext('2d').putImageData(new ImageData(pic.color, pic.GW, pic.GH), 0, 0);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(raster, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  };
  const nocturne = await import('/examples/nocturne.js');
  const dawn = await import('/examples/dawn.js');
  return {
    heron: await flat({ ...nocturne, config: { ...nocturne.config, res: 2 } }),
    dawn: await flat({ ...dawn, config: { ...dawn.config, res: 2 } }),
    peaks: await flat({ ...scene({ name: 'peaks', w: 1600, h: 900, hole: false }), config: { ...scene({ name: 'peaks', w: 1600, h: 900, hole: false }).config, res: 2 } })
  };
};

const PARTS = {
  async stills(work) {
    const end = await still(work, 'examples/inscription.json', 2, 1920, 'hero-end');
    webp(end, path.join(OUT, 'hero-end.webp'));
    webp(await still(work, 'examples/inscription-tall.json', 2, 1080, 'hero-tall'), path.join(OUT, 'hero-tall.webp'));
    // Link previews want a 1200 by 630 JPEG.
    ffmpeg(['-i', end, '-vf', 'scale=1200:-2:flags=lanczos,crop=1200:630', '-frames:v', '1', '-q:v', '3', path.join(OUT, 'social.jpg')]);
  },
  async method(work) {
    const plates = await inPage(work, drawPlates, { scale: BAND_SCALE, module: '/examples/nocturne.js' });
    const edges = [0, ...EDGES].map((mm) => mm * BAND_SCALE);
    ['draw', 'flow', 'cut'].forEach((name, i) => {
      const source = plates[{ draw: 'drawing', flow: 'flow', cut: 'cut' }[name]];
      webp(source, path.join(OUT, `method-${name}.webp`), { crop: `crop=${edges[i + 1] - edges[i]}:ih:${edges[i]}:0` });
    });
    console.log(`Drew the method's bands: ${edges.slice(1).map((e, i) => e - edges[i]).join(', ')} px wide`);
  },
  async tree(work) {
    const { BANDS } = await import(pathToFileURL(path.join(ROOT, 'examples/tree.js')).href);
    const tree = await inPage(work, drawPlates, { scale: TREE_SCALE, module: '/examples/tree.js' });
    const rows = [0, ...BANDS].map((mm) => mm * TREE_SCALE);
    ['draw', 'flow', 'cut'].forEach((name, i) => {
      const source = tree[{ draw: 'drawing', flow: 'flow', cut: 'cut' }[name]];
      webp(source, path.join(OUT, `tree-${name}.webp`), { crop: `crop=iw:${rows[i + 1] - rows[i]}:0:${rows[i]}` });
    });
    console.log(`Drew the tree's bands: ${rows.slice(1).map((e, i) => e - rows[i]).join(', ')} px high`);
  },
  async paintings(work) {
    const files = await inPage(work, drawPaintings, { width: 1280 });
    for (const [name, file] of Object.entries(files)) webp(file, path.join(OUT, `sample-${name}.webp`));
    console.log('Drew the paintings the studio in the wall offers');
  },
  async film(work) {
    const { file, project } = await inspectProject(path.join(ROOT, 'examples/film.json'));
    const master = path.join(work, 'film.mp4');
    await capture({ kind: 'render', projectFile: file, project, width: 1280, samples: 4, from: 0, to: project.frames, out: master, onProgress: () => {} });
    ffmpeg(['-i', master, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'moon-to-morning.mp4')]);
    // The poster is the dawn half laid, with the night's stones still in flight.
    webp(master, path.join(OUT, 'moon-to-morning.webp'), { at: 5.2 });
    console.log('Rendered the film');
  }
};

async function main() {
  const asked = process.argv.slice(2);
  const unknown = asked.filter((name) => !PARTS[name]);
  if (unknown.length) throw new Error(`No part named ${unknown.join(', ')}; choose from ${Object.keys(PARTS).join(', ')}.`);
  const work = await mkdtemp(path.join(os.tmpdir(), 'mosaic-media-'));
  try {
    await mkdir(OUT, { recursive: true });
    for (const name of asked.length ? asked : Object.keys(PARTS)) await PARTS[name](work);
    console.log(`Wrote the page media to ${path.relative(ROOT, OUT)}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(`Media failed: ${error.message}`); process.exitCode = 1; });
