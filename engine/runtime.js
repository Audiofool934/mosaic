import { loadFilm, makeTimeline, FOVY } from './timeline.js';
import { createRenderer } from './renderer.js';
import { imageToPicture } from './image.js';
import { clamp, hexRgb, toLinear, invert, lookAt, mat4Mul, perspective, xform } from './util.js';

const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const size = (n, fallback) => Math.round(clamp(finite(n, fallback), 2, 8192));
const normalized = p => ({ x: clamp(finite(p?.x, .5), 0, 1), y: clamp(finite(p?.y, .5), 0, 1), strength: clamp(finite(p?.strength, p?.active ? 1 : 0), 0, 1), active: Boolean(p?.active) });

// Input traces contain normalized positions and seconds, independent of frame rate.
export function pointerAtTime(points, t) {
  if (!points?.length || t < points[0].t) return normalized(null);
  let a = points[0], b = a;
  for (const p of points) { if (p.t > t) { b = p; break; } a = b = p; }
  const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
  const A = normalized(a), B = normalized(b);
  return { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u, strength: A.strength + (B.strength - A.strength) * u, active: true };
}

export async function createMosaic(canvas, options = {}) {
  if (!canvas?.getContext) throw new Error('createMosaic requires a canvas.');
  const started = performance.now();
  const progress = options.onProgress || (() => {});
  progress('Preparing the stonework');
  let project = options.project;
  if (options.image) {
    const pic = await imageToPicture(options.image, options.imageOptions);
    project = { version: 1, title: options.title || 'Your mosaic', fps: [60, 1], frames: 480,
      seed: pic.seed ?? 7, band: [1600, Math.max(2, Math.round(1600 * pic.H / pic.W))],
      scenes: [{ id: 'image', picture: pic, start: 0, end: 8, in: { type: 'settled' } }] };
  }
  if (!project) throw new Error('Choose a project or an image.');
  // Allow a loading indicator to paint before CPU tessellation begins.
  await new Promise(resolve => setTimeout(resolve, 0));
  const film = await loadFilm(project, { baseURL: options.baseURL, log: progress, from: options.from, to: options.to });
  if (!film.layers.length || !film.layers.some(l => l.count)) throw new Error('The picture contains no visible stones.');
  const duration = film.table.frames / film.fps;
  let width = size(options.width, 1280), height = size(options.height, width / film.aspect);
  let samples = Math.round(clamp(finite(options.samples, 1), 1, 16));
  let view = { zoom: 1, light: 0 };
  let time = 0, playing = false, disposed = false, lost = false;
  let raf = 0, lastNow = 0, pointer = normalized(null), target = normalized(null);
  let framePointer = normalized(null), record = null, recordStart = 0;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('This artwork needs WebGL2. Try a browser with hardware acceleration enabled.');
  let renderer, timeline;
  const info = { title: film.table.title || 'Untitled mosaic', width, height, aspect: film.aspect, duration, fps: film.fps,
    stoneCount: film.layers.reduce((n, l) => n + l.count, 0),
    stones: film.layers.map(l => ({ shot: l.scene.id, count: l.count, timing: l.timing })), setupMs: 0 };

  function pointerWorld(t) {
    if (framePointer.strength <= 0) return [0, 0, 1, 0];
    const c = timeline.cameraAt(t);
    const m = invert(mat4Mul(perspective(FOVY, width / height, Math.max(.004, c.dist * .04), Math.min(8, c.dist * 4 + .5)), lookAt(c.eye, c.target, c.up)));
    const nx = framePointer.x * 2 - 1, ny = 1 - framePointer.y * 2;
    const a = xform(m, [nx, ny, -1]), b = xform(m, [nx, ny, 1]);
    const z0 = a[2] / a[3], z1 = b[2] / b[3];
    const k = -z0 / (z1 - z0);
    return [a[0] / a[3] + (b[0] / b[3] - a[0] / a[3]) * k,
      a[1] / a[3] + (b[1] / b[3] - a[1] / a[3]) * k, c.w / 1000 * .16, framePointer.strength];
  }
  function setup() {
    renderer?.dispose();
    canvas.width = width; canvas.height = height;
    const base = makeTimeline(film, width, height);
    timeline = { ...base,
      cameraAt(t) {
        const c = base.cameraAt(t), z = view.zoom;
        return { ...c, eye: c.eye.map((v, i) => c.target[i] + (v - c.target[i]) / z), dist: c.dist / z, focus: c.focus / z, w: c.w / z };
      },
      lookAt(t) { const l = base.lookAt(t); return { ...l, exposure: l.exposure * Math.pow(2, view.light) }; }
    };
    renderer = createRenderer(gl, { W: width, H: height, FOVY, timeline, pointerAt: pointerWorld,
      shadowSize: options.shadowSize || 2048, shutter: .5 / film.fps, aperture: .03,
      coat: hexRgb('#bdb3a2').map(toLinear), sinopia: hexRgb('#7a2a18').map(toLinear) });
    for (const l of film.layers) renderer.addLayer(l);
    info.width = width; info.height = height;
  }
  function ensure() { if (disposed) throw new Error('This mosaic has been disposed.'); if (lost) throw new Error('The graphics context was lost.'); }
  function render(t, p) {
    ensure(); time = clamp(finite(t, 0), 0, Math.max(0, duration - 1 / film.fps));
    framePointer = normalized(p);
    renderer.render(time, samples);
    return time;
  }
  function schedule() { if (!raf && !disposed && !lost) raf = requestAnimationFrame(tick); }
  function tick(now) {
    raf = 0;
    if (disposed || lost) return;
    const dt = lastNow ? Math.min(.1, (now - lastNow) / 1000) : 1 / 60;
    lastNow = now;
    const k = 1 - Math.exp(-dt * 12);
    pointer.x += (target.x - pointer.x) * k; pointer.y += (target.y - pointer.y) * k;
    pointer.strength += ((target.active ? target.strength : 0) - pointer.strength) * k;
    if (!target.active && pointer.strength < .001) pointer.strength = 0;
    pointer.active = pointer.strength > 0;
    if (playing) { time += dt; if (time >= duration - 1 / film.fps) playing = false; }
    render(time, pointer);
    if (record) record.push({ t: (now - recordStart) / 1000, ...pointer });
    if (playing || target.active || pointer.strength > 0) schedule(); else lastNow = 0;
  }
  const contextLost = event => { event.preventDefault(); lost = true; playing = false; renderer?.dispose(); cancelAnimationFrame(raf); raf = 0; progress('Graphics context interrupted. Restoring the artwork…'); };
  const contextRestored = () => { if (disposed) return; lost = false; try { setup(); render(time, null); progress('Artwork restored'); } catch (e) { progress(e.message); } };
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  try { setup(); render(0, null); } catch (error) { renderer?.dispose(); canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored); throw error; }
  // Keep the compact instance/bed arrays for resize; release tessellation scratch space.
  for (const l of film.layers) { l.tiles = null; l.owners = null; l.pic.label = null; l.pic.color = null; }
  info.setupMs = Math.round(performance.now() - started);
  const controller = {
    info,
    seek(t, state = {}) { ensure(); controller.pause(); pointer = target = normalized(null); return render(t, state.trace ? pointerAtTime(state.trace, t) : state.pointer); },
    play() { ensure(); playing = true; lastNow = 0; schedule(); },
    pause() { playing = false; cancelAnimationFrame(raf); raf = 0; lastNow = 0; },
    setPointer(p) { ensure(); if (options.interactive === false) return; target = normalized(p); schedule(); },
    setView(next = {}) { ensure(); view = { zoom: clamp(finite(next.zoom, view.zoom), 1, 3), light: clamp(finite(next.light, view.light), -2, 2) }; render(time, pointer); },
    getState() { return { time, view: { ...view }, pointer: { ...pointer }, playing }; },
    startRecording() { ensure(); record = []; recordStart = performance.now(); schedule(); },
    stopRecording() { const result = record || []; record = null; return { version: 1, points: result }; },
    resize(w, h = w / film.aspect) { ensure(); width = size(w, width); height = size(h, height); setup(); render(time, pointer); },
    async exportPNG(state = {}) {
      ensure();
      const previous = framePointer, previousTime = time, wasPlaying = playing;
      controller.pause();
      render(state.time ?? time, state.trace ? pointerAtTime(state.trace, state.time ?? time) : state.pointer);
      try { return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png')); }
      finally { if (!disposed && !lost) { render(previousTime, previous); if (wasPlaying) controller.play(); } }
    },
    dispose() { if (disposed) return; controller.pause(); disposed = true; record = null; renderer?.dispose(); canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored); }
  };
  progress('Ready');
  return controller;
}
