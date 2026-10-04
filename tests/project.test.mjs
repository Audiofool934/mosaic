import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject } from '../engine/project.js';
import { pointerAtTime } from '../engine/runtime.js';
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
