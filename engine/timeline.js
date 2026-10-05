import { readProject } from "./project.js";
// The director. A film is a list of scenes on one clock (shots/film-N.json); each scene
// is a picture, a layer of stones on the one wall. A scene comes in laid from the bare
// bed, or as a flock: the stones of the picture before it lift, fly, and seat as this
// one. It can go out by falling. Everything is decided once, at load, so that seek(t)
// is a pure function of t.
import { loadPicture } from "./picture.js";
import { tessellate } from "./tessellate.js";
import { FLAG_TYPE, lightDir } from "./renderer.js";
import { clamp, clamp01, edt, fbm, hash, hexRgb, lerp, monotone, noise1, smoothstep, strSeed, toLinear } from "./util.js";

export const FOVY = (24 * Math.PI) / 180;

const MAT = { GOLD: 1, SILVER: 2, MARBLE: 3, BASALT: 4, LIMESTONE: 6, TERRACOTTA: 7 };
const NEVER = 1e6;

function linHex(hex) {
  return hexRgb(hex).map(toLinear);
}

// A number, or [[t, v], ...] keys, as a function of t.
function keyed(v, dflt) {
  if (v === undefined) return () => dflt;
  if (typeof v === "number") return () => v;
  if (v.length === 1) return () => v[0][1];
  const f = monotone(v, 0);
  return (t) => f(t);
}

function baseName(pic, r) {
  return r.behind ? pic.regions[r.base].name : r.name;
}

function matches(list, name) {
  return list.some((n) => n === name || (n.endsWith("*") && name.startsWith(n.slice(0, -1))));
}

// ---------------------------------------------------------------------------
// Build order for a laid scene: outward from one stone along geodesic distance,
// figures faster than the ground, each course run along its row once the front
// reaches it, then paced so the stones per second rise, hold, and ease.
// ---------------------------------------------------------------------------

function geodesic(pic, origin, speedOf) {
  const C = 4;
  const nx = Math.ceil(pic.W / C);
  const ny = Math.ceil(pic.H / C);
  const N = nx * ny;
  const cost = new Float32Array(N);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const gx = Math.min(pic.GW - 1, Math.round((i * C + C / 2) * pic.res));
      const gy = Math.min(pic.GH - 1, Math.round((j * C + C / 2) * pic.res));
      cost[j * nx + i] = 1 / speedOf(pic.regions[pic.label[gy * pic.GW + gx]]);
    }
  }
  const dist = new Float64Array(N).fill(1e9);
  const cap = N * 9;
  const hd = new Float64Array(cap);
  const hi = new Int32Array(cap);
  let hn = 0;
  const push = (d, i) => {
    let c = hn++;
    hd[c] = d;
    hi[c] = i;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hd[p] <= hd[c]) break;
      const td = hd[p]; hd[p] = hd[c]; hd[c] = td;
      const ti = hi[p]; hi[p] = hi[c]; hi[c] = ti;
      c = p;
    }
  };
  const pop = () => {
    const top = hi[0];
    const topD = hd[0];
    hn--;
    hd[0] = hd[hn];
    hi[0] = hi[hn];
    let c = 0;
    for (;;) {
      const l = c * 2 + 1;
      const r = l + 1;
      let m = c;
      if (l < hn && hd[l] < hd[m]) m = l;
      if (r < hn && hd[r] < hd[m]) m = r;
      if (m === c) break;
      const td = hd[m]; hd[m] = hd[c]; hd[c] = td;
      const ti = hi[m]; hi[m] = hi[c]; hi[c] = ti;
      c = m;
    }
    return [topD, top];
  };
  const si = clamp(Math.floor(origin[1] / C), 0, ny - 1) * nx + clamp(Math.floor(origin[0] / C), 0, nx - 1);
  dist[si] = 0;
  push(0, si);
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (hn) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const x = i % nx;
    const y = (i / nx) | 0;
    for (const [dx, dy, l] of nb) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
      const j = Y * nx + X;
      const nd = d + C * l * 0.5 * (cost[i] + cost[j]);
      if (nd < dist[j]) {
        dist[j] = nd;
        push(nd, j);
      }
    }
  }
  return (x, y) => {
    const fx = clamp(x / C - 0.5, 0, nx - 1.001);
    const fy = clamp(y / C - 0.5, 0, ny - 1.001);
    const ix = fx | 0;
    const iy = fy | 0;
    const tx = fx - ix;
    const ty = fy - iy;
    const i = iy * nx + ix;
    return lerp(lerp(dist[i], dist[i + 1], tx), lerp(dist[i + nx], dist[i + nx + 1], tx), ty);
  };
}

function regionSpeed(pic, build, reg) {
  const name = baseName(pic, reg);
  const sp = build.speeds || {};
  if (sp[name] !== undefined) return sp[name];
  for (const k of Object.keys(sp)) if (k.endsWith("*") && name.startsWith(k.slice(0, -1))) return sp[k];
  return 1;
}

// Seat times by rank, so the count of seated stones follows a smooth curve.
function pace(tiles, start, end, rise, ease) {
  tiles.sort((a, b) => a.key - b.key);
  const n = tiles.length;
  const steps = 2000;
  const rate = (u) => smoothstep(0, rise, u) * (1 - 0.7 * smoothstep(1 - ease, 1, u)) + 0.02;
  const cum = [0];
  for (let i = 0; i < steps; i++) cum.push(cum[i] + rate((i + 0.5) / steps));
  const total = cum[steps];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const want = ((i + 0.5) / n) * total;
    while (j < steps - 1 && cum[j + 1] < want) j++;
    const f = (want - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9);
    tiles[i].T = start + ((j + f) / steps) * (end - start);
  }
}

// A laid build can be given in stages: [{ until, end }] splits the stones by rank so
// the first share is laid slowly (a silent word) and the rest faster.
function scheduleLaid(tiles, pic, build) {
  const geo = geodesic(pic, build.origin, (reg) => regionSpeed(pic, build, reg));
  const byLine = new Map();
  for (const t of tiles) {
    const n = fbm(t.x / 90, t.y / 90, 31, 3);
    t.B = Math.max(0, geo(t.x, t.y) * (1 + 0.14 * (n - 0.5)));
    if (t.line >= 0) {
      if (!byLine.has(t.line)) byLine.set(t.line, []);
      byLine.get(t.line).push(t);
    } else {
      t.key = t.B + (t.seed - 0.5) * 6;
    }
  }
  const rowRate = build.row || 2.2;
  for (const [line, row] of byLine) {
    let first = row[0];
    for (const t of row) if (t.B < first.B) first = t;
    const jitter = (hash(line, 77) - 0.5) * 8;
    for (const t of row) t.key = Math.max(t.B, first.B + jitter + Math.abs(t.arc - first.arc) / rowRate) + (t.seed - 0.5) * 1.5;
  }
  if (!build.stages) {
    pace(tiles, build.start, build.end, build.rise || 0.12, build.ease || 0.35);
    return;
  }
  // Stages: by geodesic reach, each stage paced on its own clock.
  tiles.sort((a, b) => a.key - b.key);
  let from = 0;
  let t0 = build.start;
  for (const st of build.stages) {
    const upto = st.reach === undefined ? tiles.length : tiles.findIndex((t) => t.B > st.reach);
    const to = upto < 0 ? tiles.length : Math.max(from, upto);
    pace(tiles.slice(from, to), t0, st.end, st.rise || 0.1, st.ease || 0.3);
    from = to;
    t0 = st.end;
  }
}

// ---------------------------------------------------------------------------
// The camera: monotone cubics through keys in seconds and panel millimetres, plus
// tilt, yaw, roll, and a breath of drift.
// ---------------------------------------------------------------------------

function cameraPath(cfg, panelW, panelH, aspect) {
  const cam = cfg.camera;
  const keys = cam.keys.map((k) => ({ t: k[0], x: k[1], y: k[2], w: k[3] }));
  const X = keys.length > 1 ? monotone(keys.map((k) => [k.t, k.x])) : () => keys[0].x;
  const Y = keys.length > 1 ? monotone(keys.map((k) => [k.t, k.y])) : () => keys[0].y;
  const Wl = keys.length > 1 ? monotone(keys.map((k) => [k.t, Math.log(k.w)])) : () => Math.log(keys[0].w);
  const tilt = keyed(cam.tilt, 0);
  // The view never leaves the panel: the width is capped to what the panel can fill,
  // and the centre is held far enough from every edge. A tilted view reaches further
  // up and down the wall, so its height is padded by the tilt.
  const view = (t) => {
    const k = 1 + 1.6 * Math.sin((Math.abs(tilt(t)) * Math.PI) / 180);
    const w = Math.min(Math.exp(Wl(t)), panelW / 1.04, (panelH * aspect) / (k * 1.04));
    const hw = (w / 2) * 1.04;
    const hh = (w / aspect / 2) * k * 1.04;
    return { x: clamp(X(t), hw, panelW - hw), y: clamp(Y(t), hh, panelH - hh), w };
  };
  return {
    X: (t) => view(t).x, Y: (t) => view(t).y, W: (t) => view(t).w,
    tilt,
    yaw: keyed(cam.yaw, 0),
    roll: keyed(cam.roll, 0),
    focusShift: cam.focusShift || 0,
    aperture: cam.aperture,
    drift: cam.drift === undefined ? 0.005 : cam.drift
  };
}

// ---------------------------------------------------------------------------
// Stones as instance data. Positions are world metres: panel (x, y) mm sits at
// (world[0] + x / 1000, world[1] - y / 1000).
// ---------------------------------------------------------------------------

function toWorld(layer, x, y) {
  return [layer.world[0] + x / 1000, layer.world[1] - y / 1000];
}

function buildInstances(layer, aspect) {
  const tiles = layer.tiles;
  const n = tiles.length;
  const data = new Float32Array(n * 40);
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    const c = Math.cos(t.ang);
    const sn = Math.sin(t.ang);
    let pts = t.quad.map((q) => [(q[0] * c - q[1] * sn) / 1000, -(q[0] * sn + q[1] * c) / 1000]);
    let area = 0;
    for (let k = 0; k < 4; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % 4];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) pts = pts.reverse();
    const s = Math.min(t.a, t.b);
    const st = t.stone;
    const mat = st.mat;
    const lin = t.lin2;
    const stone = mat === MAT.MARBLE || mat === MAT.BASALT || mat === MAT.LIMESTONE || mat === MAT.TERRACOTTA;
    const h2 = hash(i, 5);
    const thick = clamp(0.62 * s, 3.0, 7.2) * (0.9 + 0.2 * h2) / 1000;
    const bevel = clamp((stone ? 0.11 : 0.085) * s, 0.35, 1.1) / 1000;
    const tiltAmp = mat === MAT.GOLD || mat === MAT.SILVER ? 0.085 : mat === MAT.MARBLE ? 0.022 : stone ? 0.03 : 0.045;
    const tx = (hash(i, 11) - 0.5) * 2 * tiltAmp;
    const ty = (hash(i, 13) - 0.5) * 2 * tiltAmp;
    const lift = (clamp(0.24 * thick * 1000, 0.9, 1.8) + (hash(i, 17) - 0.5) * 0.4) / 1000;
    const camDist = layer.cam.W(t.T) / 1000 / (2 * Math.tan(FOVY / 2) * aspect);
    const drop = (1.6 * s / 1000 + 0.014 * camDist) * (0.8 + 0.4 * hash(i, 19)) * (t.dropK || 1);
    const fall = (t.fall || 0.3) * (0.85 + 0.3 * hash(i, 23));
    const [X, Y] = toWorld(layer, t.x, t.y);
    const src = t.src || [X, Y];
    const sLin = t.srcLin || lin;
    const flags = t.flags || 0;
    const exitDur = clamp(t.exitDur === undefined ? 0.45 : t.exitDur, 0, 9.99);
    const o = i * 40;
    data.set([X, Y, t.T, t.seed], o);
    data.set([pts[0][0], pts[0][1], pts[1][0], pts[1][1]], o + 4);
    data.set([pts[2][0], pts[2][1], pts[3][0], pts[3][1]], o + 8);
    data.set([lin[0], lin[1], lin[2], mat], o + 12);
    data.set([thick, bevel, tx, ty], o + 16);
    data.set([st.emit || 0, lift, drop, fall], o + 20);
    data.set([t.U === undefined ? NEVER : t.U, t.exitAng || 0, t.exitV || 0, t.entryAng === undefined ? 1000 : t.entryAng], o + 24);
    data.set([src[0], src[1], t.launch === undefined ? NEVER : t.launch, t.dAng || 0], o + 28);
    data.set([sLin[0], sLin[1], sLin[2], t.srcEmit || 0], o + 32);
    data.set([t.ignite === undefined ? -NEVER : t.ignite, t.extinguish === undefined ? NEVER : t.extinguish, t.ripple || 0, flags * 10 + exitDur], o + 36);
  }
  return data;
}

// ---------------------------------------------------------------------------
// The bed: which stone owns each patch of mortar (and how far it is from that
// stone's edge), and the sinopia's brush coverage.
// ---------------------------------------------------------------------------

function bedData(layer) {
  const pic = layer.pic;
  const { GW, GH, res } = pic;
  const N = GW * GH;
  const groupOf = new Int32Array(pic.regions.length);
  const groups = (pic.cfg.sinopia && pic.cfg.sinopia.groups) || [];
  pic.regions.forEach((r, i) => {
    const name = baseName(pic, r);
    let g = 1000 + (r.behind ? r.base : i);
    groups.forEach((list, gi) => {
      if (matches(list, name)) g = gi + 1;
    });
    groupOf[i] = g;
  });
  const label = pic.label;
  const edge = new Uint8Array(N);
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      const g = groupOf[label[i]];
      if (g !== groupOf[label[i + 1]] || g !== groupOf[label[i + GW]]) edge[i] = 1;
    }
  }
  const { dist } = edt(edge, GW, GH);
  // The sinopia as brush coverage, so mipmaps average lines instead of distances: the
  // width and pressure of the stroke wander along it, with a faint second pass.
  const G = 2;
  const gw = Math.ceil(pic.W / G) + 2;
  const gh = Math.ceil(pic.H / G) + 2;
  const wdG = new Float32Array(gw * gh);
  const prG = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      wdG[j * gw + i] = 0.55 + 0.75 * fbm((i * G) / 31 + 17, (j * G) / 31, 17, 2);
      prG[j * gw + i] = 0.62 + 0.45 * fbm((i * G) / 47 + 3, (j * G) / 47, 23, 3);
    }
  }
  const sin = new Uint8Array(N);
  for (let y = 0; y < GH; y++) {
    const fy = (y + 0.5) / res / G;
    const j = Math.min(gh - 2, fy | 0);
    const ty = fy - j;
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const d = dist[i] / res;
      if (d > 3) continue;
      const fx = (x + 0.5) / res / G;
      const q = Math.min(gw - 2, fx | 0);
      const tx = fx - q;
      const o = j * gw + q;
      const wd = lerp(lerp(wdG[o], wdG[o + 1], tx), lerp(wdG[o + gw], wdG[o + gw + 1], tx), ty);
      const pr = lerp(lerp(prG[o], prG[o + 1], tx), lerp(prG[o + gw], prG[o + gw + 1], tx), ty);
      const a = Math.max((1 - smoothstep(wd - 0.25, wd + 0.35, d)) * pr, (1 - smoothstep(wd + 0.9, wd + 1.8, d)) * 0.16 * pr);
      sin[i] = Math.round(255 * clamp01(a));
    }
  }

  // Ownership. Stones of an arrival own their patch once they start to land; before
  // that the stones they replace do, which is the same patch.
  const tiles = layer.tiles;
  const lines = tiles.map((t) => {
    const c = Math.cos(t.ang);
    const s = Math.sin(t.ang);
    const p = t.quad.map((q) => [t.x + q[0] * c - q[1] * s, t.y + q[0] * s + q[1] * c]);
    const cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4;
    const cy = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
    const L = [];
    for (let k = 0; k < 4; k++) {
      const a = p[k];
      const b = p[(k + 1) % 4];
      let nx = b[1] - a[1];
      let ny = -(b[0] - a[0]);
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      if ((cx - a[0]) * nx + (cy - a[1]) * ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      L.push([nx, ny, -(a[0] * nx + a[1] * ny)]);
    }
    return L;
  });
  const make = () => new Uint8Array(N * 4).fill(255);
  const own = make();
  const own2 = make();
  layer.owners.forEach((src, k) => {
    const dst = k === 0 ? own : own2;
    const { owner, offset } = src;
    const c = src.crop || { GW, GH, px: 0, py: 0 };
    for (let j = 0; j < c.GW * c.GH; j++) {
      const si = owner[j];
      if (si < 0) continue;
      const ti = src.bySi[si];
      if (ti < 0) continue;
      const idx = ti + offset;
      const gx = (j % c.GW) + c.px;
      const gy = ((j / c.GW) | 0) + c.py;
      const i = gy * GW + gx;
      const px = (gx + 0.5) / res;
      const py = (gy + 0.5) / res;
      let d = -1e9;
      for (const e of lines[idx]) d = Math.max(d, e[0] * px + e[1] * py + e[2]);
      const o = i * 4;
      dst[o] = idx & 255;
      dst[o + 1] = idx >> 8;
      dst[o + 2] = clamp(Math.round(Math.max(0, d) * 48), 0, 255);
    }
  });
  // Slivers no stone claimed, at the edges of thin regions, take the mortar of the nearest
  // stone, so bare plaster does not show through the finished wall in a stair of specks.
  const free = (i) => own[i * 4] === 255 && own[i * 4 + 1] === 255;
  let gaps = [];
  for (let i = 0; i < N; i++) if (label[i] && free(i)) gaps.push(i);
  for (let pass = 0; pass < 6 && gaps.length; pass++) {
    const found = [];
    for (const i of gaps) {
      const x = i % GW;
      for (const j of [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, i - GW, i + GW]) {
        if (j < 0 || j >= N || free(j)) continue;
        found.push(i, own[j * 4] + 256 * own[j * 4 + 1]);
        break;
      }
    }
    for (let f = 0; f < found.length; f += 2) {
      const i = found[f], idx = found[f + 1], o = i * 4;
      const px = ((i % GW) + 0.5) / res;
      const py = (((i / GW) | 0) + 0.5) / res;
      let d = -1e9;
      for (const e of lines[idx]) d = Math.max(d, e[0] * px + e[1] * py + e[2]);
      own[o] = idx & 255;
      own[o + 1] = idx >> 8;
      own[o + 2] = clamp(Math.round(Math.max(0, d) * 48), 0, 255);
    }
    gaps = gaps.filter(free);
  }
  return { w: GW, h: GH, own, own2, sin };
}

// ---------------------------------------------------------------------------
// Loading a film.
// ---------------------------------------------------------------------------

export async function loadFilm(source, opts = {}) {
  const { table, baseURL } = await readProject(source, opts.baseURL);
  const fps = table.fps[0] / table.fps[1];
  const aspect = table.band[0] / table.band[1];
  const film = { table, fps, aspect, scenes: [], layers: [], no: table.title || "Untitled" };
  const t0 = opts.from === undefined ? 0 : opts.from / fps;
  const t1 = opts.to === undefined ? table.frames / fps : opts.to / fps;
  const log = opts.log || (() => {});

  // Which scenes to build: those that touch the range, and the one a flow comes from.
  const scenes = table.scenes.map((s, i) => Object.assign({}, s, { index: i }));
  const want = new Set();
  scenes.forEach((s, i) => {
    if (s.end >= t0 - 0.1 && s.start <= t1 + 0.1) {
      want.add(i);
      if (s.in && s.in.type === "flow" && i > 0) want.add(i - 1);
    }
  });

  for (const s of scenes) {
    film.scenes.push(s);
    if (!s.picture || !want.has(s.index) || (opts.scenes && !opts.scenes.includes(s.id))) continue;
    const tStart = performance.now();
    const pic = await loadPicture(opts.resolvePicture ? await opts.resolvePicture(s.picture) : s.picture, baseURL);
    if (pic.seed === undefined) pic.seed = table.seed;
    const T = tessellate(pic);
    const cfg = pic.cfg;
    const rip = cfg.ripple;
    const layer = {
      scene: s, pic, W: pic.W, H: pic.H,
      grout: linHex((cfg.light && cfg.light.grout) || "#8a8174"),
      wet: (cfg.light && cfg.light.wet) || [0.6, 1.5],
      cam: cameraPath(cfg, pic.W, pic.H, aspect),
      flicker: cfg.flicker || 0,
      ripple: rip ? (() => {
        const l = Math.hypot(rip.dir[0], rip.dir[1]) || 1;
        // World y runs up the wall, panel y down it.
        return [rip.dir[0] / l, -rip.dir[1] / l, (2 * Math.PI) / (rip.wavelength / 1000), (2 * Math.PI * (rip.speed / 1000)) / (rip.wavelength / 1000)];
      })() : [1, 0, 0, 0],
      timing: { base: T.timing }
    };
    const tiles = T.tiles.slice();
    const owners = [{ owner: T.cells.owner, bySi: null, offset: 0, tiles: T.tiles }];
    const arrivals = [];
    for (const a of pic.arrivals) {
      const c = a.crop;
      const A = tessellate(Object.assign({}, pic, { GW: c.GW, GH: c.GH, W: c.W, H: c.H, ox: c.ox, oy: c.oy, label: a.label, color: a.color, seed: strSeed(a.name) }));
      const offset = tiles.length;
      for (const t of A.tiles) {
        t.x += c.ox;
        t.y += c.oy;
        t.arrival = a.name;
        tiles.push(t);
      }
      owners.push({ owner: A.cells.owner, bySi: null, offset, tiles: A.tiles, crop: c });
      arrivals.push({ a, tiles: A.tiles });
    }
    // The bed's ownership texture reserves 65535 for an empty patch.
    if (tiles.length > 65535) throw new Error(`${s.id}: ${tiles.length} stones exceed the bed's 65535-stone limit; enlarge the background stones.`);
    for (const o of owners) {
      let top = 1;
      for (const t of o.tiles) top = Math.max(top, t.si + 1);
      const m = new Int32Array(top).fill(-1);
      o.tiles.forEach((t, i) => (m[t.si] = i));
      o.bySi = m;
    }
    layer.tiles = tiles;
    layer.owners = owners;

    // Per-stone colour with the small variation of any tray of cut stone, and the
    // region's own settings.
    tiles.forEach((t, i) => {
      const st = t.stone;
      const h1 = hash(i + (t.arrival ? 77777 : 0), 3);
      const h2 = hash(i + (t.arrival ? 77777 : 0), 5);
      const h3 = hash(i + (t.arrival ? 77777 : 0), 7);
      const v = 0.95 + 0.1 * h1;
      t.lin2 = [st.lin[0] * v * (1 + 0.03 * (h2 - 0.5)), st.lin[1] * v, st.lin[2] * v * (1 + 0.03 * (h3 - 0.5))];
      const reg = pic.regions[t.L];
      if (reg.type) t.flags = (t.flags || 0) | FLAG_TYPE;
      if (reg.ripple) t.ripple = reg.ripple;
    });

    // Arrival into the scene.
    const base = tiles.filter((t) => !t.arrival);
    const kind = (s.in && s.in.type) || "laid";
    if (kind === "laid") {
      scheduleLaid(base, pic, Object.assign({}, cfg.build, s.in && s.in.build));
      for (const t of base) t.fall = (s.in && s.in.fall) || 0.24;
      if (s.in && s.in.bed !== undefined) layer.relayFrom = s.in.bed;
    } else {
      for (const t of base) {
        t.T = kind === "settled" ? s.start - 10 : s.start;
        t.fall = 0.24;
      }
    }

    // Figures that come in during the scene.
    for (const { a, tiles: at } of arrivals) {
      const fr = a.from || [1, 0];
      const fl = Math.hypot(fr[0], fr[1]) || 1;
      const dir = [fr[0] / fl, fr[1] / fl];
      const proj = (t) => t.x * dir[0] + t.y * dir[1];
      let lo = Infinity;
      let hi = -Infinity;
      for (const t of at) {
        lo = Math.min(lo, proj(t));
        hi = Math.max(hi, proj(t));
      }
      const sweep = (t) => 1 - (proj(t) - lo) / Math.max(hi - lo, 1e-6);
      const entryAng = Math.atan2(-dir[1], dir[0]);
      for (const t of at) {
        t.T = a.at + sweep(t) * a.dur + (t.seed - 0.5) * 0.03;
        if (a.drop) {
          t.dropK = a.drop;
        } else {
          t.entryAng = entryAng;
          t.dropK = 1.6;
        }
        t.fall = a.fall || 0.24;
      }
      for (const t of base) {
        const r = pic.regions[t.L];
        if (r.behind !== a.name) continue;
        t.U = a.at + sweep(t) * a.dur - 0.12 + (t.seed - 0.5) * 0.03;
        t.exitAng = Math.atan2(-dir[1], dir[0]);
        t.exitV = a.exitV || 2.2;
      }
    }
    applyEvents(layer, pic.mod.events || {});
    layer.timing.total = Math.round(performance.now() - tStart);
    film.layers.push(layer);
    s.layer = layer;
    log(`${s.id}: ${tiles.length} stones in ${layer.timing.total} ms ${JSON.stringify(layer.timing.base)}`);
  }

  // Place each picture on the wall and hand the scenes over.
  let prev = null;
  for (const s of film.scenes) {
    const L = s.layer;
    if (!L) {
      prev = null;
      continue;
    }
    const kind = (s.in && s.in.type) || "laid";
    if (kind === "flow" && prev) {
      // The incoming picture is placed so its camera picks up where the last one is.
      const tc = s.in.launch[0];
      const [ax, ay] = toWorld(prev, prev.cam.X(tc), prev.cam.Y(tc));
      L.world = [ax - L.cam.X(tc) / 1000, ay + L.cam.Y(tc) / 1000];
      flowInto(film, prev, L, s.in);
    } else if (s.at) {
      // Pictures placed with at share one wall, whose top left corner is the world origin.
      L.world = [s.at[0] / 1000, -s.at[1] / 1000];
    } else {
      L.world = [-L.W / 2000, L.H / 2000];
    }
    if (s.out && s.out.type === "fall") fallOut(film, L, s.out);
    prev = L;
  }

  for (const layer of film.layers) {
    layer.count = layer.tiles.length;
    layer.data = buildInstances(layer, aspect);
    layer.bed = bedData(layer);
    let first = layer.relayFrom === undefined ? Infinity : layer.relayFrom;
    let last = -Infinity;
    for (const t of layer.tiles) {
      first = Math.min(first, t.launch !== undefined && t.launch < t.T ? t.launch : t.T - (t.fall || 0.3) * 1.2);
      const gone = t.U === undefined || t.U >= NEVER ? layer.scene.end : t.U + (t.exitDur === undefined ? 0.45 : t.exitDur);
      last = Math.max(last, gone);
    }
    layer.first = first;
    layer.last = Math.min(last, layer.scene.end);
  }
  return film;
}

// ---------------------------------------------------------------------------
// A built film as plain data and the buffers it can hand over, so a worker can build it
// and a page can draw it. The camera paths are made again from each picture's config.
// ---------------------------------------------------------------------------

export function packFilm(film) {
  const plain = ({ layer, picture, ...scene }) => scene;
  const layers = film.layers.map((L) => ({
    scene: film.scenes.indexOf(L.scene), W: L.W, H: L.H, world: L.world, grout: L.grout, wet: L.wet, flicker: L.flicker, ripple: L.ripple,
    timing: L.timing, count: L.count, data: L.data, bed: L.bed, first: L.first, last: L.last, cfg: L.pic.cfg
  }));
  const film2 = { table: { ...film.table, scenes: film.table.scenes.map(plain) }, fps: film.fps, aspect: film.aspect, no: film.no, scenes: film.scenes.map(plain), layers };
  return { film: film2, transfer: layers.flatMap((L) => [L.data.buffer, L.bed.own.buffer, L.bed.own2.buffer, L.bed.sin.buffer]) };
}

export function unpackFilm(packed) {
  const film = { ...packed, layers: [] };
  for (const L of packed.layers) {
    const scene = film.scenes[L.scene];
    const layer = { ...L, scene, pic: { cfg: L.cfg }, cam: cameraPath(L.cfg, L.W, L.H, packed.aspect) };
    scene.layer = layer;
    film.layers.push(layer);
  }
  return film;
}

// ---------------------------------------------------------------------------
// Events inside a scene, on the film's clock.
// ---------------------------------------------------------------------------

function applyEvents(layer, ev) {
  const pic = layer.pic;
  const nameOf = (t) => baseName(pic, pic.regions[t.L]);
  // spec.arrival: a name picks that arrival's stones; present but undefined picks the
  // base picture's; absent picks both.
  const pick = (spec) => layer.tiles.filter((t) => {
    if ("arrival" in spec && t.arrival !== spec.arrival) return false;
    if (spec.regions && !matches(spec.regions, nameOf(t))) return false;
    if (spec.within) {
      const [x0, y0, x1, y1] = spec.within;
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) return false;
    }
    return true;
  });
  // Lit smalti catch, spreading from a point at a given speed (mm/s).
  for (const e of ev.ignite || []) {
    for (const t of pick(e)) {
      const d = e.from ? Math.hypot(t.x - e.from[0], t.y - e.from[1]) : 0;
      t.ignite = e.at + (e.speed ? d / e.speed : 0) + (t.seed - 0.5) * (e.jitter || 0.1);
      if (e.out !== undefined) t.extinguish = e.out + (t.seed - 0.5) * 0.04;
    }
  }
  // A figure that breaks into stones and drifts away like smoke, a share at a time.
  for (const e of ev.dissolve || []) {
    const n = e.times.length;
    for (const t of pick(e)) {
      const k = Math.min(n - 1, Math.floor(hash(Math.round(t.x * 7), Math.round(t.y * 7)) * n));
      t.U = e.times[k] + (t.seed - 0.5) * 0.25 + (e.rise ? (t.y - e.rise) / 900 : 0);
      t.exitAng = Math.PI / 2 + (t.seed - 0.5) * 1.4;
      t.exitV = (e.speed || 0.18) * (0.6 + 0.8 * t.seed);
      t.exitDur = e.dur || 1.6;
    }
  }
  // Violence: stones thrown off the wall from a centre.
  for (const e of ev.burst || []) {
    for (const t of pick(e)) {
      const dx = t.x - e.center[0];
      const dy = t.y - e.center[1];
      const d = Math.hypot(dx, dy);
      t.U = e.at + d / (e.speed || 4000) + (t.seed - 0.5) * 0.02;
      t.exitAng = Math.atan2(-dy, dx) + (t.seed - 0.5) * 0.4;
      t.exitV = (e.v || 3.5) * (0.7 + 0.6 * t.seed);
      t.exitDur = e.dur || 0.6;
    }
  }
}

// Every stone of the scene falls off the wall, in a wave, tumbling.
function fallOut(film, L, out) {
  const at = out.at;
  const dur = out.dur || 0.5;
  for (const t of L.tiles) {
    if (t.U !== undefined && t.U < at) continue;
    if (t.T > at) {
      t.U = at;
      t.exitDur = 0;
      continue;
    }
    const u = clamp01(1 - t.y / L.H) * 0.6 + 0.4 * hash(Math.round(t.x), Math.round(t.y));
    t.U = at + u * dur;
    t.exitAng = -Math.PI / 2 + (t.seed - 0.5) * 0.7;
    t.exitV = 0.5 + 1.1 * t.seed;
    t.exitDur = out.exitDur || 1.2;
  }
}

// ---------------------------------------------------------------------------
// The flock. The stones of A that the camera sees lift and fly to become the stones
// of B that it will see. Pairs are made by tone first and then by place on the
// screen, so dark stones go to dark places and nearby stones travel together. The
// flock launches in a wave and seats in a wave outward from B's focus.
// ---------------------------------------------------------------------------

function hilbert(n, x, y) {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const tmp = x;
      x = y;
      y = tmp;
    }
  }
  return d;
}

function viewRect(film, L, t, pad) {
  const w = L.cam.W(t) / 1000;
  const h = w / film.aspect;
  const [cx, cy] = toWorld(L, L.cam.X(t), L.cam.Y(t));
  const p = pad === undefined ? 0.15 : pad;
  return [cx - w * (0.5 + p), cx + w * (0.5 + p), cy - h * (0.5 + p), cy + h * (0.5 + p)];
}

function flowInto(film, A, B, flow) {
  const [l0, l1] = flow.launch;
  const [d0, d1] = flow.land;
  B.relayFrom = l0 - 0.05;
  const rA = viewRect(film, A, l0);
  const rB = viewRect(film, B, d1);
  const inside = (r, p) => p[0] > r[0] && p[0] < r[1] && p[1] > r[2] && p[1] < r[3];
  const norm = (r, p) => [clamp01((p[0] - r[0]) / (r[1] - r[0])), clamp01((r[3] - p[1]) / (r[3] - r[2]))];
  const lum = (c) => Math.cbrt(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
  const NB = flow.bands || 14;
  const HN = 256;
  const keyOf = (t, layer, r) => {
    const p = norm(r, toWorld(layer, t.x, t.y));
    const band = Math.min(NB - 1, Math.floor(lum(t.lin2) * NB));
    return band * HN * HN + hilbert(HN, Math.min(HN - 1, (p[0] * HN) | 0), Math.min(HN - 1, (p[1] * HN) | 0));
  };
  const As = [];
  for (const t of A.tiles) {
    if (t.U !== undefined && t.U < l0) continue;
    if (t.T > l0) {
      // Not yet seated when the flock leaves: it never arrives.
      t.U = Math.max(t.T - (t.fall || 0.3) * 1.3, l0 - 1);
      t.exitDur = 0;
      continue;
    }
    if (inside(rA, toWorld(A, t.x, t.y))) {
      As.push(t);
    } else {
      t.U = l0;
      t.exitDur = 0;
    }
  }
  const Bs = [];
  for (const t of B.tiles) {
    if (t.arrival) continue;
    if (inside(rB, toWorld(B, t.x, t.y))) {
      Bs.push(t);
    } else {
      t.T = d0;
      t.fall = 0.0005;
    }
  }
  for (const t of As) t.k = keyOf(t, A, rA);
  for (const t of Bs) t.k = keyOf(t, B, rB);
  As.sort((a, b) => a.k - b.k);
  Bs.sort((a, b) => a.k - b.k);
  const focus = toWorld(B, ...(flow.focus || [B.cam.X(d1), B.cam.Y(d1)]));
  const wB = B.cam.W(d1) / 1000;
  const order = (t) => {
    const p = toWorld(B, t.x, t.y);
    return clamp01(Math.hypot(p[0] - focus[0], (p[1] - focus[1]) * 1.3) / (0.75 * wB));
  };
  const used = new Uint8Array(As.length);
  for (let i = 0; i < Bs.length; i++) {
    const b = Bs[i];
    if (!As.length) {
      b.T = d0 + order(b) * (d1 - d0);
      continue;
    }
    const j = Math.min(As.length - 1, Math.floor(((i + 0.5) * As.length) / Bs.length));
    const a = As[j];
    const u = Math.pow(order(b), flow.curve || 1);
    const jit = (b.seed - 0.5) * 0.06;
    b.launch = l0 + u * (l1 - l0) + jit;
    b.T = Math.max(d0 + u * (d1 - d0) + jit, b.launch + 0.25);
    b.src = toWorld(A, a.x, a.y);
    b.srcLin = a.lin2;
    b.srcEmit = a.stone.emit || 0;
    let dAng = b.ang - a.ang;
    dAng = ((dAng + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
    b.dAng = dAng;
    b.fall = 0.3;
    if (!used[j] || b.launch < a.U) a.U = b.launch;
    used[j] = 1;
    a.exitDur = 0;
  }
  // Stones of A with no partner scatter toward the lens.
  for (let j = 0; j < As.length; j++) {
    if (used[j]) continue;
    const a = As[j];
    const p = norm(rA, toWorld(A, a.x, a.y));
    a.U = l0 + (0.3 + 0.7 * a.seed) * (l1 - l0);
    a.exitAng = Math.atan2(0.5 - p[1], p[0] - 0.5) + (a.seed - 0.5) * 0.8;
    a.exitV = 0.8 + 0.8 * a.seed;
    a.exitDur = 0.7;
  }
  for (const t of As) delete t.k;
  for (const t of Bs) delete t.k;
}

// ---------------------------------------------------------------------------
// What the renderer asks for, at any t.
// ---------------------------------------------------------------------------

export function makeTimeline(film, W, H) {
  const aspect = W / H;
  const live = film.scenes.filter((s) => s.layer);
  // The scene that owns the frame, and the one handing over to it.
  const ownerAt = (t) => {
    let cur = live[0];
    for (const s of live) if (t >= s.start - 1e-9) cur = s;
    return cur;
  };
  const blendAt = (t) => {
    const s = ownerAt(t);
    const i = live.indexOf(s);
    const prev = i > 0 ? live[i - 1] : null;
    if (prev && s.in && s.in.type === "flow") {
      const a = s.in.launch[0];
      const b = s.in.land[1];
      if (t < b) return { from: prev, to: s, u: smoothstep(a, b, t) };
    }
    return { from: s, to: s, u: 1 };
  };

  function camOf(L, t) {
    const c = L.cam;
    const [tx, ty] = toWorld(L, c.X(t), c.Y(t));
    return { tx, ty, w: c.W(t), tilt: c.tilt(t), yaw: c.yaw(t), roll: c.roll(t), drift: c.drift, focusShift: c.focusShift, aperture: c.aperture };
  }
  function cameraAt(t) {
    const B = blendAt(t);
    let c = camOf(B.to.layer, t);
    if (B.u < 1) {
      const a = camOf(B.from.layer, t);
      const u = B.u;
      c = {
        tx: lerp(a.tx, c.tx, u), ty: lerp(a.ty, c.ty, u), w: Math.exp(lerp(Math.log(a.w), Math.log(c.w), u)),
        tilt: lerp(a.tilt, c.tilt, u), yaw: lerp(a.yaw, c.yaw, u), roll: lerp(a.roll, c.roll, u), drift: lerp(a.drift, c.drift, u),
        focusShift: lerp(a.focusShift, c.focusShift, u), aperture: lerp(a.aperture || 0.03, c.aperture || 0.03, u)
      };
    }
    const dist = c.w / 1000 / (2 * Math.tan(FOVY / 2) * aspect);
    const tilt = (c.tilt * Math.PI) / 180;
    const drift = c.drift * Math.sin(t * 0.37 + 0.4) + c.drift * 0.6 * noise1(t * 0.23, 5);
    const yaw = (c.yaw * Math.PI) / 180 + drift;
    const roll = (c.roll * Math.PI) / 180;
    const dir = [Math.sin(tilt) * Math.sin(yaw), -Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt)];
    const eye = [c.tx + dir[0] * dist, c.ty + dir[1] * dist, dir[2] * dist];
    const up = [-Math.sin(yaw + roll), Math.cos(yaw + roll), 0];
    return { eye, target: [c.tx, c.ty, 0], up, dist, w: c.w, focus: dist * (1 + c.focusShift), aperture: c.aperture };
  }

  // The light of a scene at t.
  const rigFns = new Map();
  for (const s of live) {
    const L = s.layer;
    const lt = L.pic.cfg.light || {};
    const k = lt.key || { az: 135, el: 40, color: [1, 1, 1], power: 1 };
    const f = lt.fill || { az: -45, el: 30, color: [0.6, 0.7, 0.9], power: 0.2 };
    const kp = keyed(k.power, 1);
    const fp = keyed(f.power, 0.2);
    const kaz = keyed(k.az, 135);
    const kel = keyed(k.el, 40);
    const ev = keyed(lt.exposure, 0);
    const pts = (lt.points || []).map((p, i) => ({
      p, power: keyed(p.power, 1), px: keyed(p.x, 0), py: keyed(p.y, 0), pz: keyed(p.z, 60), seed: 31 + i * 7
    }));
    rigFns.set(s, (t) => {
      let flash = 0;
      for (const fl of lt.flashes || []) {
        if (t < fl.t) continue;
        const dt = t - fl.t;
        // A strike: a hard white flash, a flicker, and a tail.
        flash += fl.power * (Math.exp(-dt / (fl.decay || 0.08)) + 0.5 * Math.exp(-Math.abs(dt - 0.09) / 0.02));
      }
      const fc = (lt.flashColor || [0.85, 0.9, 1]);
      const keyCol = k.color.map((v, i) => v * kp(t) + fc[i] * flash);
      const points = pts.map(({ p, power, px, py, pz, seed }) => {
        const on = p.on ? smoothstep(p.on[0], p.on[0] + (p.on[2] || 0.25), t) * (p.on[1] !== undefined && p.on[1] !== null ? 1 - smoothstep(p.on[1], p.on[1] + 0.25, t) : 1) : 1;
        const fl = 1 + (p.flicker || 0) * (0.55 * noise1(t * 2.7, seed) + 0.3 * noise1(t * 6.1, seed + 1) + 0.15 * noise1(t * 13.3, seed + 2));
        const [wx, wy] = toWorld(L, px(t), py(t));
        return { pos: [wx, wy, pz(t) / 1000], power: power(t) * on * fl, color: linHex(p.color || "#ffb060") };
      });
      return {
        keyDir: lightDir(kaz(t), kel(t)), keyCol,
        fillDir: lightDir(f.az, f.el), fillCol: f.color.map((v) => v * fp(t)),
        sky: lt.sky || [0.1, 0.11, 0.13], ground: lt.ground || [0.02, 0.02, 0.02],
        exposure: ev(t), points
      };
    });
  }
  const mixRig = (a, b, u) => {
    const m = (x, y) => x.map((v, i) => lerp(v, y[i], u));
    // Point lights are not mixed: the outgoing scene's fade out and the incoming's in.
    const points = a.points.map((p) => Object.assign({}, p, { power: p.power * (1 - u) }))
      .concat(b.points.map((p) => Object.assign({}, p, { power: p.power * u })))
      .sort((x, y) => y.power - x.power).slice(0, 4);
    return {
      keyDir: v3lerpNorm(a.keyDir, b.keyDir, u), keyCol: m(a.keyCol, b.keyCol), fillDir: v3lerpNorm(a.fillDir, b.fillDir, u), fillCol: m(a.fillCol, b.fillCol),
      sky: m(a.sky, b.sky), ground: m(a.ground, b.ground), exposure: lerp(a.exposure, b.exposure, u), points
    };
  };
  function rigAt(t) {
    const B = blendAt(t);
    const b = rigFns.get(B.to)(t);
    if (B.u >= 1) return b;
    return mixRig(rigFns.get(B.from)(t), b, B.u);
  }
  // The film's own light: [[t, fade], ...], for the dark at the start, the wreck, the end.
  const fade = keyed(film.table.look, 1);
  function lookAt(t) {
    const r = rigAt(t);
    return { exposure: Math.pow(2, r.exposure), fade: clamp01(fade(t)), ca: 0.0015 };
  }
  function layersAt(t) {
    return film.layers.filter((L) => t >= L.first && t <= L.last).sort((a, b) => a.scene.index - b.scene.index);
  }
  return { cameraAt, rigAt, lookAt, layersAt, ownerAt };
}

function v3lerpNorm(a, b, u) {
  const v = [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
