import test from 'node:test';
import assert from 'node:assert/strict';
import { createContacts } from '../engine/contact.js';
import { MATERIALS } from '../engine/picture.js';
import { validateProject } from '../engine/project.js';
import { TEXELS } from '../engine/renderer.js';
import { addInput, pointerAtTime } from '../engine/runtime.js';
import { packFilm, unpackFilm } from '../engine/timeline.js';
const project = () => ({ fps:[60,1], frames:480, band:[1920,1080], scenes:[{id:'one',picture:'./scene.js',start:0,end:8,in:{type:'settled'}}] });
test('portable manifest validates rational frame rates and independent aspect ratios', () => {
  const p=project(); p.fps=[30000,1001]; p.frames=240; p.band=[1080,1920];
  assert.equal(validateProject(p).seed,7);
  assert.equal(validateProject(p).version,1);
  assert.equal(p.seed,undefined);
});
test('rejects malformed manifests before allocating raster or GPU resources', () => {
  for (const change of [p=>p.frames=0,p=>p.fps=[60,0],p=>p.band=[99999,1080],p=>p.scenes[0].start=1,p=>p.scenes[0].end=9,p=>p.scenes[0].in.type='unknown',p=>p.scenes.push({...p.scenes[0]}),p=>p.seed=NaN]) {
    const p=project();change(p);assert.throws(()=>validateProject(p));
  }
});
test('recorded pointer input has no dependency on previous seek order', () => {
  const points=[{t:0,x:.2,y:.3,strength:0},{t:1,x:.8,y:.7,strength:1},{t:2,x:.8,y:.7,strength:0}];
  const before=JSON.stringify(points);
  const halfway=pointerAtTime(points,.5);
  assert.deepEqual([halfway.x,halfway.y,halfway.strength],[.5,.5,.5]);
  pointerAtTime(points,1.9); pointerAtTime(points,0);
  assert.deepEqual(pointerAtTime(points,.5),halfway);
  assert.equal(pointerAtTime(points,-1).strength,0);
  assert.equal(pointerAtTime(points,3).strength,0);
  assert.equal(JSON.stringify(points),before);
});
test('input samples replay the gesture: arrivals start in place, rests hold, releases stay put', () => {
  const points = [];
  addInput(points, { t: 0, x: .2, y: .3, active: true });
  addInput(points, { t: .01, x: .21, y: .3, active: true });
  // Two seconds at rest, then a release.
  addInput(points, { t: 2.01, x: .5, y: .5, active: false });
  const held = pointerAtTime(points, 1.5);
  assert.deepEqual([held.x, held.y, held.strength], [.21, .3, 1]);
  const released = pointerAtTime(points, 2.5);
  assert.deepEqual([released.x, released.y, released.strength], [.21, .3, 0]);
  // A new arrival elsewhere never slides over from the last place the pointer left.
  addInput(points, { t: 3, x: .8, y: .7, active: true });
  for (const t of [2.2, 2.6, 2.95, 2.998]) assert.equal(pointerAtTime(points, t).strength, 0);
  const arrived = pointerAtTime(points, 3);
  assert.deepEqual([arrived.x, arrived.y, arrived.strength], [.8, .7, 1]);
  // Continuous movement is interpolated, and time never runs backwards.
  addInput(points, { t: 3.02, x: .9, y: .7, active: true });
  assert.ok(Math.abs(pointerAtTime(points, 3.01).x - .85) < 1e-9);
  addInput(points, { t: 1, x: .1, y: .1, active: true });
  assert.ok(points.every((p, i) => !i || p.t >= points[i - 1].t));
});
test('pictures placed on one wall need a position and cannot flow in', () => {
  const p = project();
  p.scenes.push({ id: 'two', picture: './two.js', start: 0, end: 8, at: [1600, 0], in: { type: 'laid' } });
  p.scenes[0].at = [0, 0];
  assert.doesNotThrow(() => validateProject(p));
  for (const at of [[0], [0, NaN], 'top', [0, 0, 0]]) {
    const q = structuredClone(p);
    q.scenes[1].at = at;
    assert.throws(() => validateProject(q), /at must be/);
  }
  const q = structuredClone(p);
  q.scenes[1].in = { type: 'flow', launch: [0, 1], land: [1, 2] };
  assert.throws(() => validateProject(q), /cannot flow/);
});
test('a built film crosses to the page as plain data and comes back whole', () => {
  const cfg = { camera: { keys: [[0, 50, 40, 100], [1, 60, 40, 90]] }, light: { exposure: 0.5 } };
  const scene = { id: 'one', index: 0, start: 0, end: 1, at: [0, 0], picture: { module: './one.js' }, in: { type: 'laid' } };
  const layer = {
    scene, W: 100, H: 80, world: [0, 0], grout: [0.1, 0.1, 0.1], wet: [0.2, 1], flicker: 0, ripple: [1, 0, 0, 0], timing: { base: [1, 2, 3, 4] },
    count: 1, data: new Float32Array(40).fill(0.5), bed: { w: 2, h: 1, own: new Uint8Array(8), own2: new Uint8Array(8), sin: new Uint8Array(2) },
    first: 0, last: 1, pic: { cfg, mod: { draw() {} }, label: new Uint8Array(4) }, tiles: [{}], cam: null
  };
  scene.layer = layer;
  const film = { table: { title: 'Wall', scenes: [{ id: 'one', picture: { draw() {} } }] }, fps: 60, aspect: 1.5, no: 'Wall', scenes: [scene], layers: [layer] };
  const { film: packed, transfer } = packFilm(film);
  assert.equal(transfer.length, 4);
  const back = unpackFilm(structuredClone(packed, { transfer }));
  const L = back.layers[0];
  assert.equal(L.scene, back.scenes[0]);
  assert.equal(back.scenes[0].layer, L);
  assert.deepEqual(back.scenes[0].at, [0, 0]);
  assert.equal(L.data.length, 40);
  assert.equal(L.pic.cfg.light.exposure, 0.5);
  assert.equal(typeof L.cam.X, 'function');
  assert.equal(L.tiles, undefined);
  assert.equal(back.table.scenes[0].picture, undefined);
});
test('a sliding hand is heard at once and then sparingly, a resting one not at all, and laying now and then', () => {
  // A wall of 9 mm marble stones in a view 1.6 m wide, seated one after another over two seconds.
  const STRIDE = TEXELS * 4, cols = 160, rows = 40, count = cols * rows, data = new Float32Array(count * STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE, h = 0.0045;
    data[o] = (i % cols) * 0.01; data[o + 1] = -Math.floor(i / cols) * 0.01; data[o + 2] = (2 * i) / count;
    [[-h, -h], [h, -h], [h, h], [-h, h]].forEach(([x, y], k) => { data[o + 4 + k * 2] = x; data[o + 5 + k * 2] = y; });
    data[o + 15] = MATERIALS.marble; data[o + 24] = Infinity;
  }
  const layers = [{ data, count }], view = { x: 0.8, y: -0.2, w: 1.6, h: 0.4 };
  const heard = [], hear = createContacts();
  // Half a view width a second for a second over the laid wall, then half a second at rest.
  for (let f = 0; f < 90; f++) {
    const clock = f / 60, touch = f < 60 ? { at: [0.1 + (f / 60) * 0.8, -0.2], reach: 0.0045, moved: 0.5 / 60, speed: 0.5 } : null;
    heard.push(...hear({ layers, touch, time: 3, from: 3, view, clock }).map(e => ({ ...e, clock })));
  }
  const touches = heard.filter(e => e.kind === 'touch');
  assert.equal(touches[0].clock, 0);
  assert.ok(touches.length >= 4 && touches.length <= 9, `${touches.length} stones caught in a second`);
  assert.ok(touches.every((e, i) => !i || e.clock - touches[i - 1].clock > 0.09));
  assert.ok(touches.every(e => e.material === 'marble' && Math.abs(e.size - 9) < 0.01 && e.strength > 0 && e.strength <= 1));
  assert.equal(heard.filter(e => e.kind === 'slide').length, 60);
  assert.equal(heard.filter(e => e.clock >= 1).length, 0);
  // The wall laid over two seconds is heard landing a few times a second, never in a clatter.
  const laid = [], laying = createContacts();
  for (let f = 1; f <= 120; f++) laid.push(...laying({ layers, touch: null, time: f / 60, from: (f - 1) / 60, view, clock: f / 60 }).map(e => ({ ...e, clock: f / 60 })));
  assert.ok(laid.length >= 6 && laid.length <= 16 && laid.every(e => e.kind === 'lay'), `${laid.length} laid stones heard in two seconds`);
  assert.ok(laid.every((e, i) => !i || e.clock - laid[i - 1].clock > 0.1));
});
