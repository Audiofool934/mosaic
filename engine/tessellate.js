// The cut: an andamento field that follows every region's edge, evenly spaced courses
// along it (Jobard and Lefer), stones cut along each course, and the pixels each stone
// owns. Ported from piece/odyssey-lantern and made to take any picture.
//
// A picture P has: GW, GH (analysis pixels), res (pixels per mm), regions, label
// (region id per pixel, 0 is nothing), color (sRGB RGBA per pixel), priority.
import { clamp, clamp01, edt, boxBlur, hash, hexRgb, lerp, rng, toLinear } from "./util.js";

export function regionSize(P, reg, x, y) {
  const r = reg.ramp;
  if (!r) return reg.size || 10;
  let u;
  if (r.axis === "y") u = (y - r.from) / (r.to - r.from);
  else if (r.axis === "x") u = (x - r.from) / (r.to - r.from);
  else u = (Math.hypot(x - r.center[0], y - r.center[1]) - r.from) / (r.to - r.from);
  return lerp(r.a, r.b, clamp01(u));
}

export function buildField(P) {
  const FW = P.GW;
  const FH = P.GH;
  const FR = P.res;
  const N = FW * FH;
  const lab = P.label;
  const src = new Uint8Array(N);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const i = y * FW + x;
      const l = lab[i];
      if (x === 0 || y === 0 || x === FW - 1 || y === FH - 1 ||
          lab[i - 1] !== l || lab[i + 1] !== l || lab[i - FW] !== l || lab[i + FW] !== l) src[i] = 1;
    }
  }
  const { dist, near } = edt(src, FW, FH);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  const size = new Float32Array(N);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const i = y * FW + x;
      const reg = P.regions[lab[i]];
      const px = (x + 0.5) / FR + (P.ox || 0);
      const py = (y + 0.5) / FR + (P.oy || 0);
      const s = regionSize(P, reg, px, py);
      size[i] = s;
      const q = near[i];
      const gx = x - (q % FW);
      const gy = y - ((q / FW) | 0);
      const g2 = gx * gx + gy * gy;
      let tx = 0;
      let ty = 0;
      if (g2 > 0.25) {
        tx = -(gx * gx - gy * gy) / g2;
        ty = -(2 * gx * gy) / g2;
      }
      const D = dist[i] / FR;
      dist[i] = D;
      let w = 1;
      let bx = 1;
      let by = 0;
      if (reg.mode === "sky") {
        w = Math.exp(-Math.pow(D / (2.3 * s), 2));
        const a = (reg.tilt || 0) + 0.05 * Math.sin(px / 140 + 0.6) + 0.03 * Math.sin(px / 61);
        bx = Math.cos(2 * a);
        by = Math.sin(2 * a);
      } else if (reg.mode === "ground") {
        w = Math.exp(-Math.pow(D / (1.9 * s), 2));
        const a = (reg.tilt || 0) + 0.035 * Math.sin(px / 170 + 1.3);
        bx = Math.cos(2 * a);
        by = Math.sin(2 * a);
      } else if (reg.mode === "radial" || reg.mode === "halo") {
        // Concentric rings around a centre.
        w = Math.exp(-Math.pow(D / (1.1 * s), 2));
        const ang = Math.atan2(py - reg.center[1], px - reg.center[0]);
        bx = -Math.cos(2 * ang);
        by = -Math.sin(2 * ang);
      } else if (reg.mode === "rays") {
        // Courses run out from a centre, like hair from a crest box.
        w = Math.exp(-Math.pow(D / (1.0 * s), 2));
        const ang = Math.atan2(py - reg.center[1], px - reg.center[0]);
        bx = Math.cos(2 * ang);
        by = Math.sin(2 * ang);
      } else if (reg.mode === "flow") {
        // A fixed direction, for hanging cloth and falling water.
        w = Math.exp(-Math.pow(D / (1.4 * s), 2));
        const a = reg.angle || 0;
        bx = Math.cos(2 * a);
        by = Math.sin(2 * a);
      }
      vx[i] = w * tx + (1 - w) * bx;
      vy[i] = w * ty + (1 - w) * by;
    }
  }
  const r1 = Math.max(1, Math.round(3 * FR));
  const r2 = Math.max(1, Math.round(2 * FR));
  boxBlur(vx, FW, FH, r1);
  boxBlur(vy, FW, FH, r1);
  boxBlur(vx, FW, FH, r2);
  boxBlur(vy, FW, FH, r2);
  for (let i = 0; i < N; i++) {
    const l = Math.hypot(vx[i], vy[i]);
    if (l > 1e-6) {
      vx[i] /= l;
      vy[i] /= l;
    } else {
      vx[i] = 1;
      vy[i] = 0;
    }
  }
  return { lab, dist, vx, vy, size, FW, FH, FR };
}

function fieldAt(F, arr, x, y) {
  const fx = clamp(x * F.FR - 0.5, 0, F.FW - 1.001);
  const fy = clamp(y * F.FR - 0.5, 0, F.FH - 1.001);
  const ix = fx | 0;
  const iy = fy | 0;
  const tx = fx - ix;
  const ty = fy - iy;
  const i = iy * F.FW + ix;
  return lerp(lerp(arr[i], arr[i + 1], tx), lerp(arr[i + F.FW], arr[i + F.FW + 1], tx), ty);
}

function labAt(F, x, y) {
  const ix = Math.floor(x * F.FR);
  const iy = Math.floor(y * F.FR);
  if (ix < 0 || iy < 0 || ix >= F.FW || iy >= F.FH) return 255;
  return F.lab[iy * F.FW + ix];
}

export function dirAt(F, x, y) {
  const a = fieldAt(F, F.vx, x, y);
  const b = fieldAt(F, F.vy, x, y);
  const t = 0.5 * Math.atan2(b, a);
  return [Math.cos(t), Math.sin(t)];
}

export function layCourses(P, F) {
  const CELL = 4;
  const FW = F.FW;
  const FH = F.FH;
  const FR = F.FR;
  const GXN = Math.ceil(FW / CELL);
  const GYN = Math.ceil(FH / CELL);
  const head = new Int32Array(GXN * GYN).fill(-1);
  const px = [];
  const py = [];
  const pline = [];
  const parc = [];
  const next = [];
  const lines = [];
  const lineLabel = [];
  // Course points are kept in analysis pixels, so the grid cell is CELL pixels.
  const toG = FR;

  function insert(x, y, line, arc) {
    const id = px.length;
    px.push(x);
    py.push(y);
    pline.push(line);
    parc.push(arc);
    const c = clamp(Math.floor((y * toG) / CELL), 0, GYN - 1) * GXN + clamp(Math.floor((x * toG) / CELL), 0, GXN - 1);
    next.push(head[c]);
    head[c] = id;
  }

  // Is any course point of label L within r of (x, y)? Points of `line` within `skipArc` of `arc` are ignored.
  function near(x, y, r, L, line, arc, skipArc) {
    const c0 = Math.floor(((x - r) * toG) / CELL);
    const c1 = Math.floor(((x + r) * toG) / CELL);
    const r0 = Math.floor(((y - r) * toG) / CELL);
    const r1 = Math.floor(((y + r) * toG) / CELL);
    const r2 = r * r;
    for (let cy = Math.max(0, r0); cy <= Math.min(GYN - 1, r1); cy++) {
      for (let cx = Math.max(0, c0); cx <= Math.min(GXN - 1, c1); cx++) {
        for (let id = head[cy * GXN + cx]; id >= 0; id = next[id]) {
          if (lineLabel[pline[id]] !== L) continue;
          if (pline[id] === line && Math.abs(parc[id] - arc) < skipArc) continue;
          const dx = px[id] - x;
          const dy = py[id] - y;
          if (dx * dx + dy * dy < r2) return true;
        }
      }
    }
    return false;
  }

  function trace(x0, y0, L) {
    const thin = P.regions[L].thin;
    const edgeK = thin ? 0.14 : 0.28;
    const lineId = lines.length;
    lineLabel.push(L);
    const fwd = [];
    const back = [];
    const s0 = fieldAt(F, F.size, x0, y0);
    insert(x0, y0, lineId, 0);
    for (const sign of [1, -1]) {
      const out = sign > 0 ? fwd : back;
      let d = dirAt(F, x0, y0);
      d = [d[0] * sign, d[1] * sign];
      let x = x0;
      let y = y0;
      let arc = 0;
      for (let step = 0; step < 6000; step++) {
        const s = fieldAt(F, F.size, x, y);
        const h = 0.3 * s;
        let a = dirAt(F, x, y);
        if (a[0] * d[0] + a[1] * d[1] < 0) a = [-a[0], -a[1]];
        const mx = x + a[0] * h * 0.5;
        const my = y + a[1] * h * 0.5;
        let b = dirAt(F, mx, my);
        if (b[0] * a[0] + b[1] * a[1] < 0) b = [-b[0], -b[1]];
        const nx = x + b[0] * h;
        const ny = y + b[1] * h;
        if (labAt(F, nx, ny) !== L) break;
        if (fieldAt(F, F.dist, nx, ny) < edgeK * s) break;
        const na = arc + sign * h;
        if (near(nx, ny, 0.55 * s, L, lineId, na, 1.6 * s)) break;
        x = nx;
        y = ny;
        arc = na;
        d = b;
        out.push([x, y, arc]);
        insert(x, y, lineId, arc);
      }
    }
    const pts = back.reverse().concat([[x0, y0, 0]], fwd);
    lines.push({ L, pts, s0 });
    return lineId;
  }

  function tryStart(cx, cy, L, queue) {
    if (labAt(F, cx, cy) !== L) return false;
    const s = fieldAt(F, F.size, cx, cy);
    if (fieldAt(F, F.dist, cx, cy) < (P.regions[L].thin ? 0.16 : 0.3) * s) return false;
    if (near(cx, cy, 0.92 * s, L, -1, 0, 0)) return false;
    queue.push(trace(cx, cy, L));
    return true;
  }

  function spawn(lineId, queue) {
    const ln = lines[lineId];
    const pts = ln.pts;
    let lastArc = -1e9;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const s = fieldAt(F, F.size, p[0], p[1]);
      if (p[2] - lastArc < 0.45 * s) continue;
      lastArc = p[2];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-6) continue;
      tx /= tl;
      ty /= tl;
      for (const side of [1, -1]) tryStart(p[0] - ty * s * side, p[1] + tx * s * side, ln.L, queue);
    }
  }

  function flood(queue) {
    while (queue.length) spawn(queue.shift(), queue);
  }

  // Which labels are present, so empty regions cost nothing.
  const present = new Uint8Array(P.regions.length);
  for (let i = 0; i < F.lab.length; i++) present[F.lab[i]] = 1;
  // Courses only test against their own region, so the order of regions changes nothing.
  const order = P.priority || P.regions.map((r) => r.id);
  for (const L of order) {
    // Opus palladianum: no courses at all; the gap fill cuts irregular stones.
    if (!present[L] || L === 0 || P.regions[L].mode === "rubble") continue;
    const thin = P.regions[L].thin;
    // First the course that runs along the region's own edge.
    const cand = [];
    for (let i = 0; i < F.lab.length; i++) {
      if (F.lab[i] !== L) continue;
      const s = F.size[i];
      const want = thin ? Math.min(0.5 * s, 1.6) : 0.5 * s;
      if (Math.abs(F.dist[i] - want) < 0.35) cand.push(i);
    }
    cand.sort((a, b) => hash(a, 7) - hash(b, 7));
    for (const i of cand) {
      const queue = [];
      if (tryStart(((i % FW) + 0.5) / FR, (((i / FW) | 0) + 0.5) / FR, L, queue)) flood(queue);
    }
    // Then anything left uncovered.
    const stepPx = Math.max(2, Math.round(1.5 * FR));
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 1; y < FH; y += stepPx) {
        for (let x = 1; x < FW; x += stepPx) {
          if (F.lab[y * FW + x] !== L) continue;
          const queue = [];
          if (tryStart((x + 0.5) / FR, (y + 0.5) / FR, L, queue)) flood(queue);
        }
      }
    }
  }
  return lines;
}

export function cutStones(F, lines) {
  const stones = [];
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    const pts = ln.pts;
    const L = ln.L;
    const total = pts[pts.length - 1][2] - pts[0][2];
    const mid = pts[(pts.length / 2) | 0];
    const sMid = fieldAt(F, F.size, mid[0], mid[1]);
    const R = rng(li * 7919 + 13);
    if (total < 0.35 * sMid) {
      const d = dirAt(F, mid[0], mid[1]);
      stones.push({ x: mid[0], y: mid[1], ang: Math.atan2(d[1], d[0]), a: Math.max(total, 0.5 * sMid), b: sMid, L, line: li, arc: mid[2] });
      continue;
    }
    const n = Math.max(1, Math.round(total / (sMid * (0.94 + 0.12 * R()))));
    const step = total / n;
    let j = 0;
    for (let k = 0; k < n; k++) {
      const target = pts[0][2] + (k + 0.5 + (R() - 0.5) * 0.14) * step;
      while (j < pts.length - 2 && pts[j + 1][2] < target) j++;
      const p0 = pts[j];
      const p1 = pts[Math.min(pts.length - 1, j + 1)];
      const span = p1[2] - p0[2] || 1;
      const t = clamp01((target - p0[2]) / span);
      const x = lerp(p0[0], p1[0], t);
      const y = lerp(p0[1], p1[1], t);
      const s = fieldAt(F, F.size, x, y);
      const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      stones.push({ x, y, ang, a: step * (0.98 + 0.04 * R()), b: s, L, line: li, arc: target });
    }
  }
  return stones;
}

function splat(P, stones, from, best, owner, onlyFree) {
  const GW = P.GW;
  const GH = P.GH;
  const RES = P.res;
  for (let si = from; si < stones.length; si++) {
    const st = stones[si];
    const c = Math.cos(st.ang);
    const sn = Math.sin(st.ang);
    const ha = st.a * 0.5 * RES;
    const hb = st.b * 0.5 * RES;
    const reach = Math.max(ha, hb) * 2.2;
    const cx = st.x * RES;
    const cy = st.y * RES;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(GW - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(GH - 1, Math.ceil(cy + reach));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const i = y * GW + x;
        if (P.label[i] !== st.L) continue;
        if (onlyFree && owner[i] >= 0) continue;
        const dx = x + 0.5 - cx;
        const u = dx * c + dy * sn;
        const v = -dx * sn + dy * c;
        const d = Math.max(Math.abs(u) / ha, Math.abs(v) / hb);
        if (d < best[i] && d < 2.1) {
          best[i] = d;
          owner[i] = si;
        }
      }
    }
  }
}

function fillGaps(P, stones, best, owner, F) {
  const GW = P.GW;
  const GH = P.GH;
  const RES = P.res;
  const N = GW * GH;
  const comp = new Int32Array(N);
  const stack = new Int32Array(N);
  const from = stones.length;
  let compId = 0;
  for (let i0 = 0; i0 < N; i0++) {
    if (owner[i0] >= 0 || comp[i0] || P.label[i0] === 0) continue;
    const L = P.label[i0];
    const id = ++compId;
    let sp = 0;
    stack[sp++] = i0;
    comp[i0] = id;
    const pix = [];
    let bx0 = GW, by0 = GH, bx1 = 0, by1 = 0;
    while (sp) {
      const j = stack[--sp];
      pix.push(j);
      const x = j % GW;
      const y = (j / GW) | 0;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      if (x > 0) { const k = j - 1; if (!comp[k] && owner[k] < 0 && P.label[k] === L) { comp[k] = id; stack[sp++] = k; } }
      if (x < GW - 1) { const k = j + 1; if (!comp[k] && owner[k] < 0 && P.label[k] === L) { comp[k] = id; stack[sp++] = k; } }
      if (y > 0) { const k = j - GW; if (!comp[k] && owner[k] < 0 && P.label[k] === L) { comp[k] = id; stack[sp++] = k; } }
      if (y < GH - 1) { const k = j + GW; if (!comp[k] && owner[k] < 0 && P.label[k] === L) { comp[k] = id; stack[sp++] = k; } }
    }
    let sx = 0;
    let sy = 0;
    for (const j of pix) {
      sx += (j % GW) + 0.5;
      sy += ((j / GW) | 0) + 0.5;
    }
    const cxmm = sx / pix.length / RES;
    const cymm = sy / pix.length / RES;
    // The stone size of the gap's own region: the centroid of a wrapped region can fall
    // inside another one, so it is averaged over the gap's own pixels.
    let s = 0;
    const stride = Math.max(1, Math.floor(pix.length / 512));
    let ns = 0;
    for (let q = 0; q < pix.length; q += stride) {
      s += F.size[pix[q]];
      ns++;
    }
    s /= ns;
    const area = pix.length / (RES * RES);
    if (area < 0.1 * s * s) continue;
    const k = Math.max(1, Math.round(area / (0.85 * s * s)));
    const rubble = P.regions[L].mode === "rubble";
    if (k > 48 || rubble) {
      // A big gap, or a rubble field: seeds on a jittered grid, kept where they fall
      // inside, each with its own size and turn, so the stones are irregular.
      const step = Math.sqrt(area / k) * RES;
      let n = 0;
      for (let gy = by0 + step / 2; gy <= by1; gy += step) {
        for (let gx = bx0 + step / 2; gx <= bx1; gx += step) {
          const h1 = hash(Math.round(gx * 3.1), Math.round(gy * 1.7) + compId);
          const h2 = hash(Math.round(gy * 2.3) + 17, Math.round(gx * 1.3) + compId);
          const x = Math.min(GW - 1, Math.max(0, Math.round(gx + (h1 - 0.5) * 0.9 * step)));
          const y = Math.min(GH - 1, Math.max(0, Math.round(gy + (h2 - 0.5) * 0.9 * step)));
          if (comp[y * GW + x] !== id) continue;
          const mx = (x + 0.5) / RES;
          const my = (y + 0.5) / RES;
          const h3 = hash(x + 911, y + compId);
          const h4 = hash(y + 313, x - compId);
          const sz = Math.min(1.15 * s, Math.max(0.45 * s, step / RES)) * (rubble ? 0.75 + 0.5 * h3 : 1);
          const d = dirAt(F, mx, my);
          const ang = rubble ? h4 * Math.PI : Math.atan2(d[1], d[0]);
          stones.push({ x: mx, y: my, ang, a: sz * (rubble ? 0.85 + 0.3 * h4 : 1), b: sz, L, fill: true, line: -1, arc: 0 });
          n++;
        }
      }
      if (n) continue;
    }
    // Farthest-point seeds inside a small gap.
    const seeds = [];
    let bestJ = pix[0];
    let bestD = 1e18;
    for (const j of pix) {
      const d = ((j % GW) + 0.5 - cxmm * RES) ** 2 + (((j / GW) | 0) + 0.5 - cymm * RES) ** 2;
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    seeds.push(bestJ);
    const dmin = new Float64Array(pix.length).fill(1e18);
    while (seeds.length < k) {
      const last = seeds[seeds.length - 1];
      const lx = last % GW;
      const ly = (last / GW) | 0;
      let far = -1;
      let farD = -1;
      for (let q = 0; q < pix.length; q++) {
        const j = pix[q];
        const d = ((j % GW) - lx) ** 2 + (((j / GW) | 0) - ly) ** 2;
        if (d < dmin[q]) dmin[q] = d;
        if (dmin[q] > farD) { farD = dmin[q]; far = j; }
      }
      seeds.push(far);
    }
    const side = clamp(Math.sqrt(area / k), 0.45 * s, 1.15 * s);
    for (const j of seeds) {
      const x = ((j % GW) + 0.5) / RES;
      const y = (((j / GW) | 0) + 0.5) / RES;
      const d = dirAt(F, x, y);
      stones.push({ x, y, ang: Math.atan2(d[1], d[0]), a: side, b: side, L, fill: true, line: -1, arc: 0 });
    }
  }
  splat(P, stones, from, best, owner, true);
  return stones.length - from;
}

// Each stone takes the pixels nearest to it in its own square metric, inside its own region.
function cellsAndQuads(P, stones, F) {
  const GW = P.GW;
  const GH = P.GH;
  const RES = P.res;
  const N = GW * GH;
  const best = new Float32Array(N).fill(1e9);
  const owner = new Int32Array(N).fill(-1);
  splat(P, stones, 0, best, owner, false);
  for (let iter = 0; iter < 3; iter++) {
    if (!fillGaps(P, stones, best, owner, F)) break;
  }
  // Diagonal extremes in each stone's own frame give its four corners.
  const S = stones.length;
  const ext = new Float32Array(S * 4).fill(-1e9);
  const cor = new Float32Array(S * 8);
  const cnt = new Uint32Array(S);
  const col = new Float64Array(S * 3);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = toLinear(i);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const si = owner[i];
      if (si < 0) continue;
      const st = stones[si];
      const c = Math.cos(st.ang);
      const sn = Math.sin(st.ang);
      const dx = (x + 0.5) / RES - st.x;
      const dy = (y + 0.5) / RES - st.y;
      const u = dx * c + dy * sn;
      const v = -dx * sn + dy * c;
      const e0 = u + v;
      const e1 = -u + v;
      const e2 = -u - v;
      const e3 = u - v;
      const o = si * 4;
      if (e0 > ext[o]) { ext[o] = e0; cor[si * 8] = u; cor[si * 8 + 1] = v; }
      if (e1 > ext[o + 1]) { ext[o + 1] = e1; cor[si * 8 + 2] = u; cor[si * 8 + 3] = v; }
      if (e2 > ext[o + 2]) { ext[o + 2] = e2; cor[si * 8 + 4] = u; cor[si * 8 + 5] = v; }
      if (e3 > ext[o + 3]) { ext[o + 3] = e3; cor[si * 8 + 6] = u; cor[si * 8 + 7] = v; }
      cnt[si]++;
      col[si * 3] += lut[P.color[i * 4]];
      col[si * 3 + 1] += lut[P.color[i * 4 + 1]];
      col[si * 3 + 2] += lut[P.color[i * 4 + 2]];
    }
  }
  let unowned = 0;
  for (let i = 0; i < N; i++) if (owner[i] < 0 && P.label[i] !== 0) unowned++;
  const half = 0.5 / RES;
  const diag = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const out = [];
  for (let si = 0; si < S; si++) {
    if (cnt[si] < 3) continue;
    const st = stones[si];
    const q = [];
    for (let k = 0; k < 4; k++) q.push([cor[si * 8 + k * 2] + diag[k][0] * half, cor[si * 8 + k * 2 + 1] + diag[k][1] * half]);
    out.push({
      si, x: st.x, y: st.y, ang: st.ang, L: st.L, a: st.a, b: st.b, quad: q, area: cnt[si] / (RES * RES), line: st.line, arc: st.arc,
      lin: [col[si * 3] / cnt[si], col[si * 3 + 1] / cnt[si], col[si * 3 + 2] / cnt[si]]
    });
  }
  return { tiles: out, unowned, owner, stoneCount: S };
}

// Shrink a quad so mortar shows between neighbours, and nick it like a hand-cut stone.
function finishQuad(q, grout, R, s) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const lines = [];
  for (let k = 0; k < 4; k++) {
    const a = q[k];
    const b = q[(k + 1) % 4];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const l = Math.hypot(nx, ny);
    if (l < 1e-6) {
      lines.push(null);
      continue;
    }
    nx /= l;
    ny /= l;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    if ((cx - mx) * nx + (cy - my) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    lines.push([a[0] + nx * grout, a[1] + ny * grout, b[0] - a[0], b[1] - a[1]]);
  }
  const out = [];
  for (let k = 0; k < 4; k++) {
    const l1 = lines[(k + 3) % 4];
    const l2 = lines[k];
    let p = null;
    if (l1 && l2) {
      const den = l1[2] * l2[3] - l1[3] * l2[2];
      if (Math.abs(den) > 1e-6 * Math.hypot(l1[2], l1[3]) * Math.hypot(l2[2], l2[3])) {
        const t = ((l2[0] - l1[0]) * l2[3] - (l2[1] - l1[1]) * l2[2]) / den;
        p = [l1[0] + l1[2] * t, l1[1] + l1[3] * t];
        if (Math.hypot(p[0] - q[k][0], p[1] - q[k][1]) > grout * 3) p = null;
      }
    }
    if (!p) {
      const dx = cx - q[k][0];
      const dy = cy - q[k][1];
      const dl = Math.hypot(dx, dy) || 1;
      p = [q[k][0] + (dx / dl) * grout * 1.3, q[k][1] + (dy / dl) * grout * 1.3];
    }
    p[0] += (R() - 0.5) * s * 0.07;
    p[1] += (R() - 0.5) * s * 0.07;
    out.push(p);
  }
  return out;
}

function trayEntry(e) {
  if (!e.g) {
    const c = hexRgb(e.hex);
    e.lin = [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];
    e.g = e.lin.map((v) => Math.pow(v, 1 / 2.2));
  }
  return e;
}

// Pick a stone from the region's tray. Gradients come out as a mix of neighbouring shades.
export function pickStone(reg, lin, seed) {
  const tr = reg.tray;
  if (!tr.length) return null;
  const target = [lin[0], lin[1], lin[2]].map((v) => Math.pow(Math.max(0, v), 1 / 2.2));
  let i1 = 0;
  let i2 = 0;
  let d1 = 1e9;
  let d2 = 1e9;
  for (let i = 0; i < tr.length; i++) {
    const g = trayEntry(tr[i]).g;
    const d = 2 * (g[0] - target[0]) ** 2 + 4 * (g[1] - target[1]) ** 2 + 3 * (g[2] - target[2]) ** 2;
    if (d < d1) {
      d2 = d1;
      i2 = i1;
      d1 = d;
      i1 = i;
    } else if (d < d2) {
      d2 = d;
      i2 = i;
    }
  }
  const a = tr[i1].g;
  const b = tr[i2].g;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  let t = 0;
  if (l2 > 1e-9) t = clamp01(((target[0] - a[0]) * ab[0] + (target[1] - a[1]) * ab[1] + (target[2] - a[2]) * ab[2]) / l2);
  return seed < t ? tr[i2] : tr[i1];
}

export function tessellate(P) {
  const t0 = performance.now();
  const F = buildField(P);
  const t1 = performance.now();
  const lines = layCourses(P, F);
  const t2 = performance.now();
  const stones = cutStones(F, lines);
  const cells = cellsAndQuads(P, stones, F);
  const t3 = performance.now();
  const tiles = [];
  for (let i = 0; i < cells.tiles.length; i++) {
    const t = cells.tiles[i];
    const reg = P.regions[t.L];
    const s = Math.min(t.a, t.b);
    const R = rng(i * 2654435761 + (P.seed || 7));
    const grout = clamp((reg.grout || 0.065) * s, 0.38, 0.85);
    const quad = finishQuad(t.quad, grout, R, s);
    const pick = pickStone(reg, t.lin, R());
    if (!pick) continue;
    tiles.push(Object.assign(t, { quad, stone: pick, seed: R() }));
  }
  const t4 = performance.now();
  return {
    F, lines, tiles, cells, unowned: cells.unowned,
    timing: [t1 - t0, t2 - t1, t3 - t2, t4 - t3].map((v) => Math.round(v))
  };
}
