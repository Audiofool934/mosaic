#!/usr/bin/env node
// Renders every picture on the project page from the examples, through the same engine:
// the hero's first and last frames, the four-stage method plate, the material samples,
// and the short film. Run it after a visual change to the engine or the examples.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch } from './browser.mjs';
import { capture } from './capture.mjs';
import { inspectProject } from './cli.mjs';
import { ROOT, startServer } from './server.mjs';

const OUT = path.join(ROOT, 'home/media');
const MATERIALS = ['glass', 'gold', 'silver', 'marble', 'basalt', 'limestone', 'terracotta', 'light'];
const PLATE = { width: 2400, height: 1350 };
// Where one stage ends and the next begins, in panel millimetres: the heron stays whole
// in the flow band, and the moon is split between its cut stones and its lit ones.
// home/style.css sizes the captions under the plate to the same bands.
const EDGES = [430, 800, 1110];

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error(`ffmpeg failed: ${result.error?.message || result.stderr.toString().trim()}`);
}

const webp = (input, output, { width, at } = {}) => ffmpeg([...(at ? ['-ss', String(at)] : []), '-i', input, ...(width ? ['-vf', `scale=${width}:-2:flags=lanczos`] : []), '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', '-compression_level', '6', output]);

async function still(work, manifest, time, width, name) {
  const { file, project } = await inspectProject(path.join(ROOT, manifest));
  const out = path.join(work, `${name}.png`);
  await capture({ kind: 'still', projectFile: file, project, width, samples: 4, time, out });
  console.log(`Rendered ${name}`);
  return out;
}

// The drawing, its courses, and its cut stones, framed exactly as the still above them.
async function plates(work) {
  const server = await startServer();
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/LICENSE`);
    const images = await page.evaluate(async ({ width, height }) => {
      const { loadPicture } = await import('/engine/picture.js');
      const { tessellate } = await import('/engine/tessellate.js');
      const { hexRgb } = await import('/engine/util.js');
      const mod = await import('/examples/nocturne.js');
      const { w: W, h: H } = mod.config.panel;
      const [, keyX, keyY, keyW] = mod.config.camera.keys[0];
      // timeline.js keeps the view inside the panel: the same caps give the same frame.
      const aspect = width / height;
      const view = Math.min(keyW, W / 1.04, (H * aspect) / 1.04);
      const cx = Math.min(Math.max(keyX, (view / 2) * 1.04), W - (view / 2) * 1.04);
      const cy = Math.min(Math.max(keyY, (view / aspect / 2) * 1.04), H - (view / aspect / 2) * 1.04);
      const x0 = cx - view / 2, y0 = cy - view / aspect / 2, s = width / view;
      const plate = (paint) => {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const g = c.getContext('2d');
        g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
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

      // The flat drawing, painted at four pixels per millimetre for a crisp plate.
      const fine = await loadPicture({ ...mod, config: { ...mod.config, res: 4 } });
      const drawing = plate((g) => { g.imageSmoothingQuality = 'high'; g.drawImage(raster(fine), 0, 0, W, H); });

      // The cut the renderer uses: the scene's own resolution and the project seed.
      const pic = await loadPicture('/examples/nocturne.js', location.href);
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
        g.lineWidth = 1.05 / s;
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
      return { images: { drawing, flow, cut }, frame: { x0, scale: s } };
    }, PLATE);
    const files = { frame: images.frame };
    for (const [name, url] of Object.entries(images.images)) {
      files[name] = path.join(work, `${name}.png`);
      await writeFile(files[name], Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
    console.log('Drew the drawing, flow, and cut plates');
    return files;
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), 'mosaic-media-'));
  try {
    await mkdir(OUT, { recursive: true });

    const start = await still(work, 'examples/laid.json', 0, 1920, 'hero-start');
    const end = await still(work, 'examples/laid.json', 8.98, 1920, 'hero-end');
    for (const [name, file] of [['hero-start', start], ['hero-end', end]]) {
      webp(file, path.join(OUT, `${name}.webp`));
      webp(file, path.join(OUT, `${name}-960.webp`), { width: 960 });
    }

    // Each band of the method plate is one stage of the same frame.
    const light = await still(work, 'examples/nocturne.json', 2, PLATE.width, 'light');
    const { drawing, flow, cut, frame } = await plates(work);
    const edges = [0, ...EDGES.map((mm) => Math.round((mm - frame.x0) * frame.scale)), PLATE.width];
    const crops = [drawing, flow, cut, light].map((_, i) => `[${i}]crop=${edges[i + 1] - edges[i]}:${PLATE.height}:${edges[i]}:0[b${i}]`).join(';');
    console.log(`Method bands: ${edges.slice(1).map((e, i) => e - edges[i]).join(', ')} px`);
    const method = path.join(work, 'method.png');
    ffmpeg(['-i', drawing, '-i', flow, '-i', cut, '-i', light, '-filter_complex', `${crops};[b0][b1][b2][b3]hstack=inputs=4`, '-frames:v', '1', method]);
    webp(method, path.join(OUT, 'method.webp'));
    webp(method, path.join(OUT, 'method-1200.webp'), { width: 1200 });

    for (const [i, name] of MATERIALS.entries()) {
      webp(await still(work, 'examples/materials.json', i, 720, `material-${name}`), path.join(OUT, `material-${name}.webp`));
    }

    const { file, project } = await inspectProject(path.join(ROOT, 'examples/film.json'));
    const master = path.join(work, 'film.mp4');
    await capture({ kind: 'render', projectFile: file, project, width: 1280, samples: 4, from: 0, to: project.frames, out: master, onProgress: () => {} });
    ffmpeg(['-i', master, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'moon-to-morning.mp4')]);
    // The poster is the dawn half laid, with the night's stones still in flight.
    webp(master, path.join(OUT, 'moon-to-morning.webp'), { at: 5.2 });
    console.log(`Rendered the film and wrote the page media to ${path.relative(ROOT, OUT)}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(`Media failed: ${error.message}`); process.exitCode = 1; });
