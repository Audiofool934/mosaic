import { loadFilm, makeTimeline, unpackFilm, FOVY } from './timeline.js';
import { createRenderer, TRAIL, TRAIL_STEP } from './renderer.js';
import { imageToPicture } from './image.js';
import { createContacts } from './contact.js';
import { clamp, hexRgb, toLinear, invert, lookAt, mat4Mul, perspective, xform } from './util.js';

const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const size = (n, fallback) => Math.round(clamp(finite(n, fallback), 2, 8192));
const normalized = p => ({ x: clamp(finite(p?.x, .5), 0, 1), y: clamp(finite(p?.y, .5), 0, 1), strength: clamp(finite(p?.strength, p?.active ? 1 : 0), 0, 1), active: Boolean(p?.active) });
const IDLE = normalized(null);
// Input samples further apart than this are separate gestures: the earlier one holds.
const GAP = .05;

// Input traces contain normalized positions and seconds, independent of frame rate.
// Positions and strength are interpolated between neighbouring samples.
export function pointerAtTime(points, t) {
  if (!points?.length || !(t >= points[0].t)) return normalized(null);
  let lo = 0, hi = points.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (points[mid].t <= t) lo = mid; else hi = mid - 1; }
  const a = points[lo], b = points[lo + 1] || a;
  const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
  const A = normalized(a), B = normalized(b);
  return { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u, strength: A.strength + (B.strength - A.strength) * u, active: true };
}

// Appends one input sample so that interpolation reproduces what the hand did: a pointer
// that rested holds its place until it moves again, and a pointer that arrives starts from
// rest at its own position instead of sliding in from wherever the last one left.
export function addInput(points, sample) {
  const last = points.at(-1);
  const next = normalized(sample);
  if (!next.strength && last) { next.x = last.x; next.y = last.y; }
  const t = Math.max(finite(sample.t, 0), last?.t ?? -Infinity);
  if (last) {
    const before = Math.max(last.t, t - 1e-3);
    if (!last.strength && next.strength) points.push({ t: before, x: next.x, y: next.y, strength: 0, active: false });
    else if (t - last.t > GAP) points.push({ ...last, t: before });
  }
  points.push({ t, x: next.x, y: next.y, strength: next.strength, active: next.strength > 0 });
  return points;
}

// Builds a film in a worker, so the page stays responsive while its stones are cut. The
// project must be plain data: a manifest URL, or scenes whose pictures are module paths or
// { module, export, args } references.
function buildInWorker(project, options, progress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const settle = (fn, value) => { worker.terminate(); fn(value); };
    worker.onmessage = ({ data }) => {
      if (data.log) progress(data.log);
      else if (data.film) settle(resolve, unpackFilm(data.film));
      else settle(reject, new Error(data.error));
    };
    worker.onerror = event => { event.preventDefault(); settle(reject, new Error(event.message || 'The worker could not start.')); };
    try { worker.postMessage({ project, baseURL: options.baseURL ?? globalThis.location?.href, from: options.from, to: options.to, scenes: options.scenes }); }
    catch (error) { settle(reject, error); }
  });
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
  const build = async (scenes) => {
    if (options.worker && !options.image && typeof Worker === 'function') {
      try { return await buildInWorker(project, { ...options, scenes }, progress); }
      catch (error) { progress(`Building on the page instead: ${error.message}`); }
    }
    return loadFilm(project, { baseURL: options.baseURL, log: progress, from: options.from, to: options.to, scenes });
  };
  // A wall of pictures placed with at is built one worker for each picture. It is drawn from
  // the moment the first is ready, and the others join it as they finish.
  const scenes = project.scenes;
  // A wall of pictures is cut a picture at a time, each in its own worker, except that a
  // picture flowing in from the one before it is cut with it.
  const groups = [];
  if (options.worker && Array.isArray(scenes) && scenes.every(s => s.at)) {
    for (const s of scenes) {
      if (s.in?.type === 'flow' && groups.length) groups.at(-1).push(s.id);
      else groups.push([s.id]);
    }
  }
  const parts = groups.length > 1 ? groups.map(ids => build(ids)) : [build()];
  let film = await Promise.any(parts).catch(errors => { throw errors.errors[0]; });
  if (!film.layers.length || !film.layers.some(l => l.count)) throw new Error('The picture contains no visible stones.');
  const duration = film.table.frames / film.fps;
  // A film played with a loop runs from wherever it is to the loop's end, and from there
  // again from the loop's start, until paused.
  const loop = options.loop ?? null;
  if (loop && !(Array.isArray(loop) && loop.length === 2 && loop.every(Number.isFinite) && loop[0] >= 0 && loop[0] < loop[1] && loop[1] <= duration - 1 / film.fps)) {
    throw new Error('A loop must be [from, to] within the film.');
  }
  let width = size(options.width, 1280), height = size(options.height, width / film.aspect);
  let samples = Math.round(clamp(finite(options.samples, 1), 1, 16));
  let view = { zoom: 1, light: 0, frame: null }, frameNow = null;
  let time = 0, playing = false, disposed = false, lost = false;
  // Played toward a time, the film runs there at `rate`, backward if it lies behind, and
  // stops on it.
  let goal = null, rate = 1;
  let raf = 0, lastNow = 0, input = [], record = null, recordStart = 0;
  // What the stones answer in the frame being drawn: the pointer at a time on the input's
  // own clock, and that clock's reading at the frame's film time.
  let frameInput = () => IDLE, frameClock = 0;
  const clock = () => performance.now() / 1000;
  const live = c => pointerAtTime(input, c);
  const replay = state => state?.trace ? c => pointerAtTime(state.trace, c) : state?.pointer ? () => normalized(state.pointer) : () => IDLE;
  const settleTime = TRAIL * TRAIL_STEP + .05;
  // On a page that follows its own scroll, where the view looked in each live frame, and when
  // the wall last moved under the pointer, so its trail can be traced back over the wall.
  let looked = [], slidAt = -Infinity;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('This artwork needs WebGL2. Try a browser with hardware acceleration enabled.');
  let renderer, base;
  const info = { title: film.table.title || 'Untitled mosaic', width, height, aspect: film.aspect, duration, fps: film.fps, stoneCount: 0, stones: [], setupMs: 0 };
  const count = () => {
    info.stoneCount = film.layers.reduce((n, l) => n + l.count, 0);
    info.stones = film.layers.map(l => ({ shot: l.scene.id, count: l.count, timing: l.timing }));
  };
  count();
  // The scene's own clock, seen through the view: a frame or zoom moves the camera, and the
  // light setting scales the exposure. Its methods read the current scenes, so pictures that
  // join a wall later are drawn by the same renderer.
  const timeline = {
    cameraAt(t) {
      const c = framed(base.cameraAt(t), t), z = view.zoom;
      return { ...c, eye: c.eye.map((v, i) => c.target[i] + (v - c.target[i]) / z), dist: c.dist / z, focus: c.focus / z, w: c.w / z };
    },
    lookAt(t) { const l = base.lookAt(t); return { ...l, exposure: l.exposure * Math.pow(2, view.light) }; },
    rigAt: t => base.rigAt(t),
    layersAt: t => base.layersAt(t),
    ownerAt: t => base.ownerAt(t)
  };

  // The pointer's recent path on the wall, newest first, seen through this subframe's camera.
  const head = new Float32Array(4), trail = new Float32Array(TRAIL * 4);
  // Where a point on the canvas falls on the wall, through the camera unprojected by m.
  function onWall(m, p) {
    const nx = p.x * 2 - 1, ny = 1 - p.y * 2;
    const a = xform(m, [nx, ny, -1]), b = xform(m, [nx, ny, 1]);
    const z0 = a[2] / a[3], z1 = b[2] / b[3], u = -z0 / (z1 - z0);
    return [a[0] / a[3] + (b[0] / b[3] - a[0] / a[3]) * u, a[1] / a[3] + (b[1] / b[3] - a[1] / a[3]) * u];
  }
  const unproject = c => invert(mat4Mul(perspective(FOVY, width / height, Math.max(.004, c.dist * .04), Math.min(8, c.dist * 4 + .5)), lookAt(c.eye, c.target, c.up)));
  // A point under the pointer now, moved to where the pointer was over the wall at clock s,
  // through the view as it looked then. Such views look straight at the wall, so they differ
  // only in where they look and how much of it they take in. The view moved steadily into
  // each frame over the time since the last, or the last tenth of a second of a longer pause,
  // and before that stood still.
  function lookedBack(s, c, x, y) {
    let i = looked.length - 1;
    while (i > 0 && looked[i].at > s) i--;
    const a = looked[i], b = looked[i + 1] || a, from = Math.max(a.at, b.at - .1);
    const u = b === a || s <= from ? 0 : (s - from) / (b.at - from);
    // Written so that a view that has not moved leaves the point exactly where it is.
    const k = (a.w + (b.w - a.w) * u) / c.w - 1, dx = a.x + (b.x - a.x) * u - c.target[0], dy = a.y + (b.y - a.y) * u - c.target[1];
    return [x + dx + (x - c.target[0]) * k, y + dy + (y - c.target[1]) * k];
  }
  function pointerTrail(t) {
    const at = frameClock + (t - time);
    // Live on a page that follows its own scroll, each point of the trail is where the pointer
    // was over the wall at that moment, so a wall moving under a still pointer ripples as a
    // moving pointer does.
    const traced = frameInput === live && typeof view.frame === 'function' && looked.length > 1;
    let c = null, m = null, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < TRAIL; k++) {
      const s = at - (k + .5) * TRAIL_STEP, p = frameInput(s);
      trail[k * 4 + 2] = p.strength;
      if (!(p.strength > 0)) continue;
      if (!m) {
        c = timeline.cameraAt(t);
        m = unproject(c);
      }
      let [x, y] = onWall(m, p);
      if (traced) [x, y] = lookedBack(s, c, x, y);
      trail[k * 4] = x; trail[k * 4 + 1] = y;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (!m) return null;
    const radius = c.w / 1000 * .16;
    head.set([(x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + radius, radius]);
    return { head, trail };
  }
  function setup() {
    looked = [];
    renderer?.dispose();
    canvas.width = width; canvas.height = height;
    base = makeTimeline(film, width, height);
    renderer = createRenderer(gl, { W: width, H: height, FOVY, timeline, pointerAt: pointerTrail,
      shadowSize: options.shadowSize || 2048, shutter: .5 / film.fps, aperture: .03,
      coat: hexRgb('#bdb3a2').map(toLinear), sinopia: hexRgb('#7a2a18').map(toLinear) });
    for (const l of film.layers) renderer.addLayer(l);
    info.width = width; info.height = height;
  }
  // A picture that joins a wall: its stones and beds go to the renderer as they are.
  function join(built) {
    if (disposed || built === film) return;
    for (const L of built.layers) {
      const scene = film.scenes[L.scene.index];
      L.scene = scene;
      scene.layer = L;
      film.layers.push(L);
      if (!lost) renderer.addLayer(L);
      L.tiles = null; L.owners = null; L.pic.label = null; L.pic.color = null;
    }
    film.layers.sort((a, b) => a.scene.index - b.scene.index);
    base = makeTimeline(film, width, height);
    count();
    if (!lost) schedule();
  }
  // A frame looks straight at part of the panel instead of following the scene's camera. On a
  // wall of pictures placed with at, it is in the wall's own millimetres.
  function framed(c, t) {
    if (!frameNow) return c;
    const L = timeline.ownerAt(t).layer;
    const o = L.scene.at ? [0, 0] : L.world;
    const x = o[0] + finite(frameNow.x, L.W / 2) / 1000, y = o[1] - finite(frameNow.y, L.H / 2) / 1000;
    const w = Math.max(1, finite(frameNow.w, L.W));
    const dist = w / 1000 / (2 * Math.tan(FOVY / 2) * (width / height));
    return { ...c, eye: [x, y, dist], target: [x, y, 0], up: [0, 1, 0], dist, w, focus: dist };
  }
  function ensure() { if (disposed) throw new Error('This mosaic has been disposed.'); if (lost) throw new Error('The graphics context was lost.'); }
  // A replay reads its own clock at the film time; live input passes the page clock.
  function render(t, source = frameInput, at) {
    ensure(); time = clamp(finite(t, 0), 0, Math.max(0, duration - 1 / film.fps));
    frameInput = source; frameClock = at ?? time;
    // A page that follows its own scroll gives a function, read once for each frame drawn.
    frameNow = typeof view.frame === 'function' ? view.frame() : view.frame;
    if (source === live && typeof view.frame === 'function') look();
    renderer.render(time, samples);
    return time;
  }
  const redraw = () => render(time, frameInput, frameInput === live ? clock() : frameClock);
  // Notes where the view looks in this live frame, keeping enough to trace the whole trail
  // back, and when the wall moved under an active pointer.
  function look() {
    const c = timeline.cameraAt(time), last = looked.at(-1);
    if (last && (c.target[0] !== last.x || c.target[1] !== last.y || c.w !== last.w) && live(frameClock).strength > 0) slidAt = frameClock;
    looked.push({ at: frameClock, x: c.target[0], y: c.target[1], w: c.w });
    let old = 0;
    while (old < looked.length - 1 && looked[old + 1].at < frameClock - settleTime) old++;
    looked.splice(0, old);
  }
  function schedule() { if (!raf && !disposed && !lost) raf = requestAnimationFrame(tick); }
  // Listeners hear the stones the pointer touches as it slides over them, in each live frame.
  const listeners = new Set();
  // Where the pointer was on the wall when last heard, and when.
  let hear = null, heardOn = null, heardAt = 0;
  function heard(c) {
    hear ??= createContacts();
    const cam = timeline.cameraAt(time), w = cam.w / 1000;
    // How far the pointer has slid over the wall since the last frame, whether the hand moved
    // or the wall moved under it, as when the page scrolls. The newest input is where the
    // pointer is, whenever in the frame it arrived, and a jump of half a view, as when the view
    // is cut again, is not a slide. A fingertip reaches 0.28% of the view, about one course of
    // stones.
    const p = live(input.at(-1)?.t ?? -Infinity);
    let touch = null;
    if (p.strength > 0) {
      const at = onWall(unproject(cam), p);
      if (heardOn) {
        const moved = Math.hypot(at[0] - heardOn[0], at[1] - heardOn[1]) / w, dt = clamp(c - heardAt, 1e-3, .05);
        if (moved < .5) touch = { from: heardOn, at, reach: w * .0028, moved, dt, speed: moved / dt };
      }
      heardOn = at;
    } else heardOn = null;
    heardAt = c;
    const events = hear({ layers: base.layersAt(time), touch, time, clock: c,
      view: { x: cam.target[0], y: cam.target[1], w, h: w / (width / height) } });
    if (events.length) for (const listener of listeners) listener(events);
  }
  function tick(now) {
    raf = 0;
    if (disposed || lost) return;
    const dt = lastNow ? Math.min(.1, (now - lastNow) / 1000) : 1 / 60;
    lastNow = now;
    if (playing && goal !== null) {
      const left = goal - time;
      if (Math.abs(left) <= dt * rate) { time = goal; goal = null; playing = false; }
      else time += Math.sign(left) * dt * rate;
    } else if (playing) {
      time += dt * rate;
      if (loop && time >= loop[1]) time = loop[0] + (time - loop[1]) % (loop[1] - loop[0]);
      else if (time >= duration - 1 / film.fps) playing = false;
    }
    const c = clock();
    render(time, live, c);
    if (listeners.size) heard(c);
    // The stones keep moving until the newest input, and the wall's last move under the
    // pointer, have passed through the whole trail.
    if (playing || c - Math.max(input.at(-1)?.t ?? -Infinity, slidAt) < settleTime) schedule(); else lastNow = 0;
  }
  const contextLost = event => { event.preventDefault(); lost = true; playing = false; renderer?.dispose(); cancelAnimationFrame(raf); raf = 0; progress('Graphics context interrupted. Restoring the artwork…'); };
  const contextRestored = () => { if (disposed) return; lost = false; try { setup(); redraw(); progress('Artwork restored'); } catch (e) { progress(e.message); } };
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  try { setup(); render(0); } catch (error) { renderer?.dispose(); canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored); throw error; }
  // Keep the compact instance/bed arrays for resize; release tessellation scratch space.
  for (const l of film.layers) { l.tiles = null; l.owners = null; l.pic.label = null; l.pic.color = null; }
  info.setupMs = Math.round(performance.now() - started);
  const controller = {
    info,
    // Resolves once every picture of a wall has joined it.
    ready: Promise.allSettled(parts.map(p => p.then(join, error => progress(`A picture could not be built: ${error.message}`)))).then(() => controller),
    seek(t, state = {}) { ensure(); controller.pause(); input = []; looked = []; return render(t, replay(state)); },
    // Plays on from now, `rate` times as fast; given `to`, toward that time and stops there.
    play({ to, rate: speed = 1 } = {}) {
      ensure();
      if (!(Number.isFinite(speed) && speed > 0)) throw new Error('A rate must be a positive number.');
      if (to !== undefined && !Number.isFinite(to)) throw new Error('A time to play to must be a number.');
      goal = to === undefined ? null : clamp(to, 0, Math.max(0, duration - 1 / film.fps));
      rate = speed;
      playing = true; lastNow = 0; schedule();
    },
    pause() { playing = false; goal = null; cancelAnimationFrame(raf); raf = 0; lastNow = 0; },
    setPointer(p) {
      ensure();
      if (options.interactive === false) return;
      const from = input.length;
      addInput(input, { ...p, t: clock() });
      if (record) for (const s of input.slice(from)) record.push({ ...s, t: Math.max(0, s.t - recordStart) });
      // Keep the samples the trail can still reach, and the one it holds from.
      const horizon = input.at(-1).t - settleTime;
      let old = 0;
      while (old < input.length - 1 && input[old + 1].t < horizon) old++;
      input.splice(0, old);
      schedule();
    },
    setView(next = {}) {
      ensure();
      view = { zoom: clamp(finite(next.zoom, view.zoom), 1, 3), light: clamp(finite(next.light, view.light), -2, 2), frame: next.frame === undefined ? view.frame : next.frame || null };
      redraw();
    },
    // Draws once on the next animation frame, for a view that reads its frame as it draws.
    requestFrame() { ensure(); schedule(); },
    // listener(events) hears each live frame's contacts: the stones the pointer sets off as it
    // slides over them ('touch'), a few for every little distance it covers, each with its
    // material, size in millimetres, a strength from 0 to 1, the seconds after now it is
    // heard, and x and y on the canvas.
    onContact(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getState() { return { time, view: { ...view }, pointer: normalized(input.at(-1)), playing }; },
    startRecording() { ensure(); record = []; recordStart = clock(); if (input.length) record.push({ ...input.at(-1), t: 0 }); },
    stopRecording() { const result = record || []; record = null; return { version: 2, points: result }; },
    resize(w, h = w / film.aspect) { ensure(); width = size(w, width); height = size(h, height); setup(); redraw(); },
    async exportPNG(state = {}) {
      ensure();
      const previous = [frameInput, frameClock], previousTime = time, wasPlaying = playing;
      controller.pause();
      render(state.time ?? time, replay(state));
      try { return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png')); }
      finally { if (!disposed && !lost) { render(previousTime, ...previous); if (wasPlaying) controller.play(); } }
    },
    dispose() { if (disposed) return; controller.pause(); disposed = true; record = null; listeners.clear(); renderer?.dispose(); canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored); }
  };
  progress('Ready');
  return controller;
}
