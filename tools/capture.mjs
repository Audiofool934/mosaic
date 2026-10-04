import { spawn, spawnSync } from 'node:child_process';
import { access, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT, startServer } from './server.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
const checkAbort = signal => { if (signal?.aborted) throw signal.reason || new Error('Capture interrupted.'); };

async function mustBeNew(file) {
  try { await access(file); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Output already exists: ${path.basename(file)}. Choose a new output name; exports never resume or overwrite old work.`);
}

const SNAPSHOT_EXCLUDE = new Set(['output', 'out', 'exports', 'dist', 'node_modules', 'coverage']);
const SNAPSHOT_PRIVATE = new Set(['package.json', 'package-lock.json', 'credentials.json', 'secrets.json']);
const SNAPSHOT_TYPES = /\.(?:js|mjs|json|css|html|svg|png|jpe?g|webp|avif|gif|woff2|mp3|wav|ogg)$/i;

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// A conservative source snapshot also identifies imported drawing helpers, images,
// and other local inputs without trying to parse JavaScript import expressions.
// Hidden files, dependency/build/export directories and package/private metadata
// are excluded. It is bounded to 4096 files and 256 MiB of public source/assets.
export async function fingerprintProject(projectFile, { outputFile } = {}) {
  const root = await realpath(path.dirname(projectFile));
  const files = {};
  const directories = new Set();
  let count = 0, bytes = 0;
  const omitted = new Set(outputFile ? [path.resolve(outputFile), path.resolve(outputFile + '.json')] : []);
  async function walk(directory, relative = '') {
    const realDirectory = await realpath(directory);
    if (directories.has(realDirectory)) return;
    directories.add(realDirectory);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || SNAPSHOT_EXCLUDE.has(entry.name.toLowerCase()) || SNAPSHOT_PRIVATE.has(entry.name.toLowerCase())) continue;
      const file = path.join(directory, entry.name);
      if (omitted.has(path.resolve(file))) continue;
      const actual = await realpath(file);
      if (actual !== root && !actual.startsWith(root + path.sep)) throw new Error('A project input symlink leaves its directory; copy the source or asset into the project.');
      const info = entry.isSymbolicLink() ? await stat(actual) : entry;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (info.isDirectory()) await walk(file, name);
      else if (info.isFile() && SNAPSHOT_TYPES.test(entry.name)) {
        const size = (await stat(file)).size;
        bytes += size; count++;
        if (count > 4096 || bytes > 256 * 1024 * 1024) throw new Error('Project snapshot exceeds 4096 files or 256 MiB. Put the artwork and its inputs in a smaller project directory.');
        files[name] = await fileHash(file);
      }
    }
  }
  await walk(root);
  return {
    project: await fileHash(projectFile), files,
    sourceTree: digest(JSON.stringify(files)),
    scope: { extensions: 'js,mjs,json,css,html,svg,png,jpg,jpeg,webp,avif,gif,woff2,mp3,wav,ogg', excludedDirectories: [...SNAPSHOT_EXCLUDE], hiddenFiles: false, packageAndPrivateMetadata: false, maxFiles: 4096, maxBytes: 256 * 1024 * 1024 }
  };
}

async function fingerprints(projectFile, out) {
  const inputs = await fingerprintProject(projectFile, { outputFile: out });
  const engine = createHash('sha256');
  for (const filename of (await readdir(path.join(ROOT, 'engine'))).filter(f => f.endsWith('.js')).sort()) {
    engine.update(filename + '\0');
    engine.update(await readFile(path.join(ROOT, 'engine', filename)));
  }
  inputs.engine = engine.digest('hex');
  return inputs;
}

function encoder(out, width, height, fps, total) {
  const process = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-framerate', `${fps[0]}/${fps[1]}`, '-i', 'pipe:0', '-an', '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-frames:v', String(total), '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '', failure = null;
  process.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16000); });
  process.stdin.on('error', error => { failure ||= error; });
  const closed = new Promise((resolve, reject) => {
    process.once('error', error => { failure = error; reject(error); });
    process.once('close', (code, signal) => {
      if (code === 0) resolve();
      else { failure = new Error(`ffmpeg ${signal ? 'was stopped by ' + signal : 'exited ' + code}: ${stderr.trim()}`); reject(failure); }
    });
  });
  // The producer may still be drawing a GPU frame when ffmpeg fails.
  closed.catch(() => {});
  return {
    process, closed,
    async write(bytes) {
      if (failure) throw failure;
      await new Promise((resolve, reject) => process.stdin.write(bytes, error => error ? reject(error) : resolve()));
      if (failure) throw failure;
    },
    async stop() {
      if (process.exitCode !== null || process.signalCode !== null) return;
      process.stdin.destroy();
      process.kill('SIGTERM');
      const timer = setTimeout(() => process.kill('SIGKILL'), 3000);
      timer.unref();
      try { await closed; } catch { /* Stopping a task-owned encoder is expected on failure. */ }
      finally { clearTimeout(timer); }
    }
  };
}

/** Fresh deterministic capture. A receipt is committed only with a complete output. */
export async function capture({ kind, projectFile, project, width, samples, from = 0, to = project.frames, time = 0, out, signal, onProgress = () => {} }) {
  checkAbort(signal);
  const extension = kind === 'still' ? '.png' : '.mp4';
  if (path.extname(out).toLowerCase() !== extension) throw new Error(`${kind} output must end in ${extension}.`);
  await mustBeNew(out);
  await mustBeNew(out + '.json');
  if (kind === 'render') {
    const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    if (probe.error || probe.status !== 0) throw new Error('Video capture requires ffmpeg on PATH. Install ffmpeg, then run this command again.');
  }
  const expectedHeight = width * project.band[1] / project.band[0];
  const height = kind === 'render' ? Math.max(2, Math.round(expectedHeight / 2) * 2) : Math.max(2, Math.round(expectedHeight));
  if (height > 8192) throw new Error('The image would exceed 8192 pixels high; choose a smaller width.');
  const inputs = await fingerprints(projectFile, out);
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  await mkdir(path.dirname(out), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(out), '.mosaic-export-'));
  const temporaryOut = path.join(temporary, 'render' + extension);
  const token = `/__capture/${randomUUID()}`;
  const maxBytes = width * height * 4 + 1024 * 1024;
  let browser, server, page, ffmpeg, pending = null, committed = false, pageFailure = null;
  const started = Date.now();
  const failPending = error => {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    p.reject(error);
  };
  const abort = () => {
    failPending(signal?.reason || new Error('Capture interrupted.'));
    if (browser) browser.close().catch(() => {});
    if (ffmpeg) ffmpeg.stop().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    server = await startServer({ projectFile, intercept: async (req, res) => {
      if (req.url !== token || req.method !== 'POST') return false;
      if (!pending) { res.writeHead(409).end('No frame is pending.'); return true; }
      const receiving = pending;
      const chunks = [];
      let bytes = 0;
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > maxBytes) throw new Error('Frame transfer exceeded its expected size.');
          chunks.push(chunk);
        }
        if (pending !== receiving) throw new Error('This frame transfer expired.');
        if (kind === 'render' && bytes !== width * height * 4) throw new Error(`Incomplete frame: ${bytes} bytes received.`);
        const buffer = Buffer.concat(chunks);
        if (kind === 'still' && !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Capture did not return a PNG.');
        pending = null;
        clearTimeout(receiving.timer);
        res.writeHead(200).end('ok');
        receiving.resolve(buffer);
      } catch (error) {
        failPending(error);
        if (!res.headersSent) res.writeHead(400).end(error.message);
      }
      return true;
    } });
    checkAbort(signal);
    const { launch } = await import('./browser.mjs');
    browser = await launch();
    checkAbort(signal);
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', error => { pageFailure = error; failPending(error); });
    const search = new URLSearchParams({ project: server.projectURL, width: String(width), height: String(height), samples: String(samples) });
    if (kind === 'render') { search.set('from', String(from)); search.set('to', String(to)); }
    else { const frame = Math.floor(time * project.fps[0] / project.fps[1]); search.set('from', String(frame)); search.set('to', String(frame + 1)); }
    onProgress(`Preparing ${width}×${height} mosaic...`);
    await page.goto(`${server.url}/site/render.html?${search}`, { timeout: 120000 });
    await page.waitForFunction(() => window.ready !== undefined || window.captureError, null, { timeout: 30000 });
    const info = await page.evaluate(() => window.ready);
    if (pageFailure) throw pageFailure;
    checkAbort(signal);
    onProgress(`${info.stoneCount} stones, setup ${(info.setupMs / 1000).toFixed(1)} s.`);
    async function frameBytes(t, png) {
      checkAbort(signal);
      if (pageFailure) throw pageFailure;
      const received = new Promise((resolve, reject) => {
        const timer = setTimeout(() => failPending(new Error('Frame transfer timed out.')), 120000);
        pending = { resolve, reject, timer };
      });
      try {
        const [bytes] = await Promise.all([received, page.evaluate(async ({ t, token, png }) => window.captureFrame(t, token, png), { t, token, png })]);
        return bytes;
      } catch (error) { failPending(error); throw error; }
    }
    if (kind === 'still') {
      await writeFile(temporaryOut, await frameBytes(time, true));
    } else {
      ffmpeg = encoder(temporaryOut, width, height, project.fps, to - from);
      for (let n = from; n < to; n++) {
        const bytes = await frameBytes(n * project.fps[1] / project.fps[0], false);
        await ffmpeg.write(bytes);
        if ((n - from + 1) % 12 === 0 || n === to - 1) onProgress(`Frame ${n - from + 1}/${to - from} (${n})`);
      }
      ffmpeg.process.stdin.end();
      await ffmpeg.closed;
    }
    checkAbort(signal);
    const receipt = {
      version: 1, engine: { name: pkg.name, version: pkg.version }, kind,
      createdAt: new Date().toISOString(), title: project.title || 'Untitled mosaic',
      width, height, fps: project.fps, seed: project.seed,
      ...(kind === 'render' ? { from, to, frames: to - from, duration: (to - from) * project.fps[1] / project.fps[0] } : { time }),
      settings: { samples, shadowSize: 4096, interaction: 'none', angle: process.env.ANGLE || (process.platform === 'darwin' ? 'metal' : 'swiftshader'), ...(kind === 'render' ? { codec: 'libx264', crf: 16, pixelFormat: 'yuv420p', audio: false } : {}) },
      inputHashes: inputs, outputHash: await fileHash(temporaryOut),
      stones: info.stones, setupMs: info.setupMs, elapsedMs: Date.now() - started
    };
    const temporaryReceipt = path.join(temporary, 'receipt.json');
    await writeFile(temporaryReceipt, JSON.stringify(receipt, null, 2) + '\n');
    // Hard-linking within the output filesystem is atomic and fails on EEXIST.
    // A concurrent export cannot replace an output checked earlier.
    await link(temporaryOut, out);
    committed = true;
    await link(temporaryReceipt, out + '.json');
    return { out, receipt: out + '.json', info: receipt };
  } finally {
    signal?.removeEventListener('abort', abort);
    failPending(new Error('Capture closed.'));
    const cleanup = await Promise.allSettled([ffmpeg?.stop(), browser?.close(), server?.close()]);
    await rm(temporary, { recursive: true, force: true });
    const failed = cleanup.find(result => result.status === 'rejected');
    if (failed) throw new Error(`Capture resource cleanup failed: ${failed.reason.message}`);
    // A valid completed image remains useful if only receipt installation failed.
    if (committed) onProgress('Capture complete.');
  }
}
