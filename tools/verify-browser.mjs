#!/usr/bin/env node
// Optional real-browser regression checks for frame identity and GPU lifecycle.
// Pixel identity is compared within one browser/GPU run, not across GPU vendors.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './browser.mjs';
import { startServer } from './server.mjs';

const args = process.argv.slice(2);
let output;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node tools/verify-browser.mjs [--out output/browser-check.json]\nRuns the local example in a task-owned Chromium instance; closes the browser and server on completion.');
    process.exit(0);
  }
  if (args[i] !== '--out' || output || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Use --out <json> or run without arguments.');
  output = path.resolve(args[++i]);
}

const started = Date.now();
let server, browser, report, interrupted = false;
const errors = [];
const stop = () => {
  interrupted = true;
  if (browser) browser.close().catch(() => {});
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const timeout = setTimeout(stop, 180000);
timeout.unref();

try {
  server = await startServer();
  if (interrupted) throw new Error('Browser verification interrupted.');
  browser = await launch();
  if (interrupted) throw new Error('Browser verification interrupted.');
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', error => errors.push(error.message));
  // Count only callbacks requested by this page, so disposal is verified without
  // relying on an animation being visually different within a short interval.
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set();
    let executed = 0;
    window.requestAnimationFrame = callback => {
      const id = request(time => { pending.delete(id); executed++; callback(time); });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
    window.__animationProbe = () => ({ pending: pending.size, executed });
  });
  const params = new URLSearchParams({ project: '/examples/nocturne.json', width: '640', height: '360', samples: '1' });
  await page.goto(`${server.url}/site/render.html?${params}`, { timeout: 120000 });
  await page.waitForFunction(() => window.ready !== undefined, null, { timeout: 30000 });
  const info = await page.evaluate(() => window.ready);
  const browserVersion = browser.version();
  const results = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const mosaic = window.mosaic;
    const gl = canvas.getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = {
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE)
    };
    const checks = [];
    const hashes = {};
    const require = (condition, message) => { if (!condition) throw new Error(message); };
    const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    async function frameHash(label) {
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError();
      require(error === gl.NO_ERROR, `${label}: WebGL error ${error}.`);
      require(pixels.some((value, index) => index % 4 !== 3 && value > 8), `${label}: frame is empty or black.`);
      return sha256(pixels);
    }
    async function seekHash(time, state, label) {
      mosaic.seek(time, state);
      return frameHash(label);
    }

    require(canvas.width === 640 && canvas.height === 360, 'The smoke capture did not use 640×360 pixels.');
    hashes.baseline = await seekHash(2, undefined, 'baseline');
    hashes.atFive = await seekHash(5, undefined, 'seek 5');
    hashes.atHalf = await seekHash(0.5, undefined, 'seek 0.5');
    require(await seekHash(2, undefined, 'repeat 2') === hashes.baseline, 'Out-of-order seek changed the frame at 2 seconds.');
    require(await seekHash(5, undefined, 'repeat 5') === hashes.atFive, 'Out-of-order seek changed the frame at 5 seconds.');
    require(await seekHash(0.5, undefined, 'repeat 0.5') === hashes.atHalf, 'Out-of-order seek changed the frame at 0.5 seconds.');
    checks.push('out-of-order seeks preserve exact pixels');

    const pointer = { x: 0.58, y: 0.57, active: true, strength: 1 };
    hashes.pointer = await seekHash(2, { pointer }, 'explicit pointer');
    require(hashes.pointer !== hashes.baseline, 'The explicit pointer did not move any visible stones.');
    await seekHash(5, undefined, 'pointer interlude');
    require(await seekHash(2, { pointer }, 'repeated pointer') === hashes.pointer, 'The same explicit pointer input changed its pixels on repeat.');
    require(await seekHash(2, undefined, 'cleared pointer') === hashes.baseline, 'Clearing pointer input did not restore the baseline.');
    checks.push('explicit pointer changes pixels and repeats exactly', 'clearing input restores baseline');

    // A recorded pass across the water: its trail repeats exactly, and once the release
    // has passed through the trail every stone is back on its seat.
    const trace = [];
    for (let i = 0; i <= 30; i++) trace.push({ t: 2 + i / 60, x: 0.4 + 0.3 * i / 30, y: 0.55, strength: 1, active: true });
    trace.push({ t: 2.52, x: 0.7, y: 0.55, strength: 0, active: false });
    hashes.pass = await seekHash(2.6, { trace }, 'recorded pass');
    require(hashes.pass !== await seekHash(2.6, undefined, 'without the pass'), 'The recorded pass did not move any visible stones.');
    require(await seekHash(2.6, { trace }, 'repeated pass') === hashes.pass, 'The recorded pass changed its pixels on repeat.');
    require(await seekHash(3.5, { trace }, 'after the pass') === await seekHash(3.5, undefined, 'still water'), 'The stones did not settle after the recorded pass.');
    checks.push('a recorded pass repeats exactly and settles afterwards');

    mosaic.resize(480, 270);
    require(canvas.width === 480 && canvas.height === 270 && mosaic.info.width === 480, 'Resize did not update the render surface.');
    hashes.resized = await seekHash(2, undefined, 'resized surface');
    mosaic.resize(640, 360);
    require(await seekHash(2, undefined, 'restored dimensions') === hashes.baseline, 'Resizing back changed the baseline pixels.');
    checks.push('resize and restore preserve baseline');

    const previousTime = mosaic.getState().time;
    const png = await mosaic.exportPNG({ time: 5 });
    const pngBytes = await png.arrayBuffer();
    const signature = [...new Uint8Array(pngBytes, 0, 8)].join(',');
    require(signature === '137,80,78,71,13,10,26,10', 'exportPNG did not return PNG bytes.');
    const header = new DataView(pngBytes);
    require(header.getUint32(16) === 640 && header.getUint32(20) === 360, 'The exported PNG dimensions are wrong.');
    require(mosaic.getState().time === previousTime, 'exportPNG({time:5}) did not restore the previous playback time.');
    require(await frameHash('after PNG export') === hashes.baseline, 'PNG export did not restore the previous frame pixels.');
    hashes.pngAtFive = await sha256(pngBytes);
    checks.push('PNG export restores prior time and pixels');

    const extension = gl.getExtension('WEBGL_lose_context');
    require(extension, 'WEBGL_lose_context is unavailable; context restoration was not verified.');
    const event = name => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { canvas.removeEventListener(name, handler); reject(new Error(`${name} timed out.`)); }, 10000);
      const handler = value => { clearTimeout(timer); resolve(value); };
      canvas.addEventListener(name, handler, { once: true });
    });
    const lost = event('webglcontextlost');
    extension.loseContext();
    const loss = await lost;
    require(loss.defaultPrevented, 'The application did not permit context restoration.');
    const restored = event('webglcontextrestored');
    // Restoration must be requested after the loss event has finished dispatching.
    await new Promise(resolve => setTimeout(resolve, 50));
    extension.restoreContext();
    await restored;
    hashes.restored = await seekHash(2, undefined, 'fresh seek after context restoration');
    require(hashes.restored === hashes.baseline, 'Context restoration changed the baseline pixels.');
    checks.push('context loss and restoration allow an error-free identical fresh frame');

    // Live input draws while the stones move and stops once they rest under a still pointer.
    const { createMosaic } = await import('/engine/runtime.js');
    const live = await createMosaic(document.createElement('canvas'), { project: '/examples/nocturne.json', width: 320, height: 180, samples: 1 });
    const heard = [];
    live.onContact(events => heard.push(...events));
    live.seek(2);
    for (const x of [0.3, 0.4, 0.5, 0.6]) {
      live.setPointer({ x, y: 0.5, active: true });
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    require(window.__animationProbe().pending > 0, 'Pointer input did not schedule an animation callback.');
    await new Promise(resolve => setTimeout(resolve, 100));
    const slid = heard.length;
    await new Promise(resolve => setTimeout(resolve, 800));
    require(window.__animationProbe().pending === 0, 'The animation loop kept running under a resting pointer.');
    live.setPointer({ active: false });
    await new Promise(resolve => setTimeout(resolve, 900));
    require(window.__animationProbe().pending === 0, 'The animation loop kept running after the pointer left.');
    require(heard.length && heard.every(e => e.kind === 'touch' && typeof e.material === 'string' && e.size > 0 && e.strength > 0), 'The stones under a sliding pointer were not heard.');
    require(heard.length >= 2 && heard.length <= 12, `A slide of a tenth of a second set off ${heard.length} stones.`);
    require(heard.length === slid, 'Stones were heard under a resting pointer.');
    live.dispose();
    checks.push('live input stops drawing once the stones rest', 'a sliding pointer sets off stones as it goes, and a resting one none');

    // A wall of two pictures side by side, each cut in its own worker: the wall is drawn
    // once the first is ready, the second joins it, and a frame can look at either.
    const pairCanvas = document.createElement('canvas');
    const pair = await createMosaic(pairCanvas, {
      project: { version: 1, seed: 42, fps: [60, 1], frames: 120, band: [320, 180], scenes: [
        { id: 'left', picture: '/examples/nocturne.js', start: 0, end: 2, at: [0, 0], in: { type: 'settled' } },
        { id: 'right', picture: '/examples/nocturne.js', start: 0, end: 2, at: [1600, 0], in: { type: 'settled' } }
      ] },
      width: 320, height: 180, samples: 1, worker: true
    });
    await pair.ready;
    require(pair.info.stoneCount === 2 * mosaic.info.stoneCount, 'The second picture did not join the wall.');
    const pairGl = pairCanvas.getContext('webgl2');
    const lit = () => {
      const pixels = new Uint8Array(320 * 180 * 4);
      pairGl.readPixels(0, 0, 320, 180, pairGl.RGBA, pairGl.UNSIGNED_BYTE, pixels);
      return pixels.some((value, index) => index % 4 !== 3 && value > 8);
    };
    for (const x of [800, 2400]) {
      pair.setView({ frame: { x, y: 450, w: 1600 } });
      pair.seek(1);
      require(lit(), `The wall of pictures drew nothing at ${x} mm.`);
    }
    pair.dispose();
    checks.push('a wall of pictures is cut in workers and joins as each is ready');

    mosaic.play();
    require(mosaic.getState().playing, 'Playback did not start for the disposal check.');
    require(window.__animationProbe().pending > 0, 'Playback did not schedule an animation callback.');
    mosaic.dispose();
    const afterDispose = window.__animationProbe();
    require(!mosaic.getState().playing && afterDispose.pending === 0, 'Disposal did not cancel playback and pending animation.');
    await new Promise(resolve => setTimeout(resolve, 80));
    const idle = window.__animationProbe();
    require(idle.pending === 0 && idle.executed === afterDispose.executed, 'An animation callback ran after disposal.');
    let rejected = false;
    try { mosaic.seek(2); } catch (error) { rejected = /disposed/i.test(error.message); }
    require(rejected, 'A disposed controller still accepted a render.');
    mosaic.dispose();
    checks.push('dispose cancels activity and rejects later renders');
    return { gpu, userAgent: navigator.userAgent, checks, hashes, pngBytes: png.size, animationAfterDispose: idle };
  });
  if (errors.length) throw new Error('Browser page errors: ' + errors.join('; '));
  if (interrupted) throw new Error('Browser verification interrupted or timed out.');
  report = { ok: true, browser: browserVersion, platform: process.platform, angle: process.env.ANGLE || (process.platform === 'darwin' ? 'metal' : 'swiftshader'), dimensions: [640, 360], samples: 1, stoneCount: info.stoneCount, setupMs: info.setupMs, ...results };
} catch (error) {
  process.exitCode = 1;
  report = { ok: false, error: error.message, browserErrors: errors };
} finally {
  clearTimeout(timeout);
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
  const results = await Promise.allSettled([browser?.close(), server?.close()]);
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) {
    process.exitCode = 1;
    report = { ...report, ok: false, cleanupErrors: failed.map(result => result.reason.message) };
  }
}
report.elapsedMs = Date.now() - started;
if (output) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
