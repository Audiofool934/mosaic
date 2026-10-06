// A picture: a code drawing that paints both the region of every pixel and its
// colour, turned into the rasters the tessellation reads.
//
// pictures/<film>/<name>.js exports
//   config     panel size (mm), camera, light, build order, glints, flicker, sinopia
//              (the groups of regions it outlines, or false to lay onto bare plaster)
//   regions()  every region with its stone size, course mode, material, and tray
//   draw()     paints the picture; the same call paints labels and colour
//   arrivals   figures that come in during the scene, tessellated apart
//   events     ignitions, dissolves, and bursts on the film's clock
import { clamp01, edt, makeCanvas } from "./util.js";

export const MATERIALS = { glass: 0, gold: 1, silver: 2, marble: 3, basalt: 4, emit: 5, limestone: 6, terracotta: 7 };

// A label colour per region id. Blends between them are rejected when the labels are
// read back (see paintRasters), so these only need to be distinct.
function labelRgb(i) {
  return [(37 + i * 97) % 251 + 2, (113 + i * 59) % 241 + 7, (71 + i * 151) % 239 + 9];
}

function tray(list, mat, emit) {
  return list.map((t, i) => {
    const e = typeof t === "string" ? { hex: t } : Object.assign({}, t);
    const m = Array.isArray(mat) ? mat[i] : mat;
    e.mat = typeof e.mat === "number" ? e.mat : MATERIALS[e.mat || m || "glass"];
    e.emit = e.emit !== undefined ? e.emit : Array.isArray(emit) ? emit[i] : (emit || 0);
    return e;
  });
}

// source: a module path, a module-like object, an analysed picture, or { module, export,
// args }, a function in a module that returns a module-like object from plain arguments.
// That last form keeps a project plain data, so a worker can build it.
export async function loadPicture(source, baseURL = globalThis.location?.href) {
  if (source?.label && source?.regions) return { ...source };
  if (typeof source?.module === "string") {
    const factory = (await import(new URL(source.module, baseURL).href))[source.export || "default"];
    if (typeof factory !== "function") throw new Error(`${source.module}: no picture function ${source.export || "default"}.`);
    return loadPicture(await factory(source.args), baseURL);
  }
  const path = typeof source === "string" ? new URL(source, baseURL).href : "inline picture";
  const mod = typeof source === "string" ? await import(path) : source;
  if (!mod?.config?.panel || typeof mod.regions !== "function") throw new Error(`${path}: expected config, regions(), and draw().`);
  const cfg = mod.config;
  if (![cfg.panel.w, cfg.panel.h].every(v => Number.isFinite(v) && v > 0)) throw new Error(`${path}: invalid panel dimensions.`);
  const res = cfg.res || 2;
  const W = cfg.panel.w;
  const H = cfg.panel.h;
  const GW = Math.round(W * res);
  const GH = Math.round(H * res);
  if (GW < 2 || GH < 2 || GW > 8192 || GH > 8192 || GW * GH > 33554432) throw new Error(`${path}: raster exceeds the 32-megapixel working limit.`);
  const ref = (x, y) => [x, y];

  // Region 0 is nothing; then the picture's regions in its own order.
  const regions = [{ id: 0, name: "none", size: 10, mode: "contour", tray: [] }];
  for (const r of mod.regions()) regions.push(Object.assign({}, r, { tray: tray(r.tray, r.mat, r.emit) }));
  if (regions.length < 2 || regions.length > 255) throw new Error(`${path}: use 1 to 254 regions.`);
  for (const r of regions.slice(1)) {
    if (!r.name || !r.tray?.length || !Number.isFinite(r.size) || r.size <= 0) throw new Error(`${path}: every region needs a name, positive stone size, and tray.`);
  }
  if (new Set(regions.map(r => r.name)).size !== regions.length) throw new Error(`${path}: region names must be unique.`);
  regions.forEach((r, i) => (r.id = i));
  const REG = {};
  for (const r of regions) REG[r.name] = r;
  const bg = REG[cfg.background || regions[1].name];
  if (!bg) throw new Error(`${path}: no background region ${cfg.background}`);

  const D = { ref, k: 1, res, W, H, REG };
  const pic = { path, cfg, mod, W, H, res, GW, GH, seed: cfg.seed, regions, REG, ref, k: 1, D };

  // The base: everything is background until the drawing paints over it.
  const baseLabel = new Uint8Array(GW * GH).fill(bg.id);
  const baseColor = new Uint8ClampedArray(GW * GH * 4);
  const bc = bg.tray[(bg.tray.length / 2) | 0].hex;
  const n = parseInt(bc.slice(1), 16);
  for (let i = 0; i < GW * GH; i++) {
    baseColor[i * 4] = (n >> 16) & 255;
    baseColor[i * 4 + 1] = (n >> 8) & 255;
    baseColor[i * 4 + 2] = n & 255;
    baseColor[i * 4 + 3] = 255;
  }
  const base = paintRasters(pic, baseLabel, baseColor, (g, mode) => mod.draw && mod.draw(g, mode, helpers(g, mode, pic)));
  pic.label = base.label;
  pic.color = base.color;
  for (const rim of cfg.rims || []) applyRims(pic, pic.label, pic.color, rim);

  // Figures that arrive later are tessellated apart. Under each one the background is
  // re-labelled into its own regions, so its stones stop at the figure's outline.
  // Each is painted only inside its own bounds, found on a coarse first pass.
  pic.arrivals = [];
  for (const a of mod.arrivals || []) {
    const draw = (g, mode) => a.draw(g, mode, helpers(g, mode, pic));
    const box = probeBounds(pic, draw, a.pad || 30);
    if (!box) continue;
    const crop = { GW: box.gw, GH: box.gh, W: box.gw / res, H: box.gh / res, ox: box.x0 / res, oy: box.y0 / res, px: box.x0, py: box.y0, res, regions, REG };
    const r = paintRasters(crop, new Uint8Array(box.gw * box.gh), new Uint8ClampedArray(box.gw * box.gh * 4), draw);
    for (const rim of a.rims || cfg.rims || []) applyRims(crop, r.label, r.color, rim);
    const clones = new Map();
    for (let y = 0; y < box.gh; y++) {
      for (let x = 0; x < box.gw; x++) {
        if (!r.label[y * box.gw + x]) continue;
        const gi = (y + box.y0) * GW + x + box.x0;
        const L = pic.label[gi];
        if (!clones.has(L)) {
          const src = regions[L];
          const c = Object.assign({}, src, { id: regions.length, name: `${src.name}@${a.name}`, behind: a.name, base: L });
          regions.push(c);
          REG[c.name] = c;
          clones.set(L, c.id);
        }
        pic.label[gi] = clones.get(L);
      }
    }
    pic.arrivals.push(Object.assign({}, a, { label: r.label, color: r.color, crop }));
  }
  if (regions.length > 255) throw new Error(`${path}: ${regions.length} regions, at most 255`);
  return pic;
}

// The pixel bounds of what a drawing paints, padded by pad mm, from a pass at a quarter
// of a pixel per millimetre.
function probeBounds(pic, draw, pad) {
  const q = 0.25;
  const w = Math.ceil(pic.W * q);
  const h = Math.ceil(pic.H * q);
  const c = makeCanvas(w, h);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.setTransform(q, 0, 0, q, 0, 0);
  draw(g, "label");
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!d[(y * w + x) * 4 + 3]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const k = pic.res / q;
  const p = Math.ceil(pad * pic.res);
  const X0 = Math.max(0, Math.floor(x0 * k) - p);
  const Y0 = Math.max(0, Math.floor(y0 * k) - p);
  const X1 = Math.min(pic.GW, Math.ceil((x1 + 1) * k) + p);
  const Y1 = Math.min(pic.GH, Math.ceil((y1 + 1) * k) + p);
  return { x0: X0, y0: Y0, gw: X1 - X0, gh: Y1 - Y0 };
}

// Rim light. Figure pixels near the silhouette's edge that face the light become a
// course of lit stones; with a cool region, those facing the sky become a cold one.
// spec: { figures: [names], light: [x, y] (mm) or dir: [dx, dy], width (mm), warm,
// cool, sky: [dx, dy], reach (mm) }
function applyRims(pic, label, color, spec) {
  const { GW, GH, res, REG, regions } = pic;
  const isFig = new Uint8Array(regions.length);
  for (const r of regions) {
    if (spec.figures.some((n) => n === r.name || (n.endsWith("*") && r.name.startsWith(n.slice(0, -1))))) isFig[r.id] = 1;
  }
  let x0 = GW, y0 = GH, x1 = -1, y1 = -1;
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (!isFig[label[y * GW + x]]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return;
  const pad = Math.ceil((spec.width || 5) * res) + 2;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(GW - 1, x1 + pad);
  y1 = Math.min(GH - 1, y1 + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const src = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = isFig[label[(y + y0) * GW + x + x0]] ? 0 : 1;
  const { dist, near } = edt(src, w, h);
  const warm = REG[spec.warm];
  const cool = spec.cool ? REG[spec.cool] : null;
  const rimW = (spec.width || 5) * res;
  const hexes = (reg) => reg.tray.map((e) => {
    const n = parseInt(e.hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const warmRamp = hexes(warm);
  const coolRamp = cool ? hexes(cool) : null;
  let sky = spec.sky || [0, -1];
  const sl = Math.hypot(sky[0], sky[1]) || 1;
  sky = [sky[0] / sl, sky[1] / sl];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gi = (y + y0) * GW + x + x0;
      if (!isFig[label[gi]] || dist[i] > rimW || dist[i] < 0.5) continue;
      const q = near[i];
      let nx = (q % w) - x;
      let ny = ((q / w) | 0) - y;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const px = (x + x0 + 0.5) / res + (pic.ox || 0);
      const py = (y + y0 + 0.5) / res + (pic.oy || 0);
      let lx, ly, reach = 1;
      if (spec.light) {
        lx = spec.light[0] - px;
        ly = spec.light[1] - py;
        const ld = Math.hypot(lx, ly) || 1;
        lx /= ld;
        ly /= ld;
        if (spec.reach) reach = clamp01(1 - ld / spec.reach);
      } else {
        const d = spec.dir;
        const dl = Math.hypot(d[0], d[1]) || 1;
        lx = d[0] / dl;
        ly = d[1] / dl;
      }
      const facing = nx * lx + ny * ly;
      const k = facing * reach;
      if (facing > (spec.min || 0.25) && k > 0.06) {
        label[gi] = warm.id;
        const c = warmRamp[Math.min(warmRamp.length - 1, Math.floor(k * warmRamp.length * 1.05))];
        color[gi * 4] = c[0];
        color[gi * 4 + 1] = c[1];
        color[gi * 4 + 2] = c[2];
      } else if (cool && nx * sky[0] + ny * sky[1] > 0.55 && dist[i] < rimW * 0.8) {
        label[gi] = cool.id;
        const c = coolRamp[Math.min(coolRamp.length - 1, Math.floor(clamp01(nx * sky[0] + ny * sky[1]) * coolRamp.length * 0.99))];
        color[gi * 4] = c[0];
        color[gi * 4 + 1] = c[1];
        color[gi * 4 + 2] = c[2];
      }
    }
  }
}

// Fill helpers a drawing gets: the same call paints a region label or its colour.
function helpers(g, mode, pic) {
  const lab = mode === "label";
  const styleOf = (region, color) => {
    const r = pic.REG[region];
    if (!r) throw new Error(`no region ${region}`);
    if (lab) return `rgb(${labelRgb(r.id).join(",")})`;
    return typeof color === "function" ? color(g) : (color || r.tray[(r.tray.length / 2) | 0].hex);
  };
  return {
    mode,
    ref: pic.ref,
    k: 1,
    REG: pic.REG,
    W: pic.W,
    H: pic.H,
    fill(path, region, color) {
      g.fillStyle = styleOf(region, color);
      g.fill(path);
    },
    // A path drawn as a line of the given width, in mm.
    line(path, width, region, color, cap, join) {
      g.save();
      g.strokeStyle = styleOf(region, color);
      g.lineWidth = width;
      g.lineCap = cap || "round";
      g.lineJoin = join || "round";
      g.miterLimit = 6;
      g.stroke(path);
      g.restore();
    },
    // Colour only: shading inside a region that must not change its label.
    shade(path, color) {
      if (lab) return;
      g.fillStyle = typeof color === "function" ? color(g) : color;
      g.fill(path);
    },
    linear(x0, y0, x1, y1, stops) {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      return gr;
    },
    radial(x, y, r0, r1, stops) {
      const gr = g.createRadialGradient(x, y, r0, x, y, r1);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      return gr;
    },
    g
  };
}

// Paint labels and colour from the same drawing. `baseLabel` and `baseColor` are what
// the drawing goes over.
function paintRasters(pic, baseLabel, baseColor, draw) {
  const { GW, GH, res, regions } = pic;
  const N = GW * GH;
  const byKey = new Map();
  regions.forEach((r, i) => {
    const c = labelRgb(i);
    byKey.set((c[0] << 16) | (c[1] << 8) | c[2], i);
  });

  const ox = (pic.ox || 0) * res;
  const oy = (pic.oy || 0) * res;
  const lc = makeCanvas(GW, GH);
  const lg = lc.getContext("2d", { willReadFrequently: true });
  lg.setTransform(res, 0, 0, res, -ox, -oy);
  draw(lg, "label");
  const ld = lg.getImageData(0, 0, GW, GH).data;
  const label = new Uint8Array(baseLabel);
  const mark = new Uint8Array(N); // 1 clean overlay, 2 overlay edge
  // Where two drawn shapes meet, the antialiased blend of their label colours can equal
  // a third region's colour exactly (half of one plus half of another often does, as the
  // colours step evenly with the id), and along a straight edge it does so for whole runs
  // of pixels. A blend band is one pixel thick with pure colours on both sides, so a label
  // is trusted only where all eight neighbours share its colour; the rest are filled from
  // trusted neighbours below. That keeps the cut independent of how regions are listed.
  const key = new Int32Array(N).fill(-1);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    if (ld[p + 3] === 255) key[i] = (ld[p] << 16) | (ld[p + 1] << 8) | ld[p + 2];
  }
  for (let y = 0, i = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++, i++) {
      if (ld[i * 4 + 3] === 0) continue;
      const k = key[i];
      let trusted = k >= 0 && byKey.has(k);
      for (let dy = -1; dy <= 1 && trusted; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= GH) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= GW) continue;
          if (key[yy * GW + xx] !== k) {
            trusted = false;
            break;
          }
        }
      }
      if (trusted) {
        label[i] = byKey.get(k);
        mark[i] = 1;
      } else if (ld[i * 4 + 3] >= 96) {
        mark[i] = 2;
      }
    }
  }
  // Edge pixels of the drawing take the label of a clean neighbour.
  for (let pass = 0; pass < 6; pass++) {
    let left = 0;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        if (mark[i] !== 2) continue;
        let best = -1;
        if (x + 1 < GW && mark[i + 1] === 1) best = label[i + 1];
        else if (x > 0 && mark[i - 1] === 1) best = label[i - 1];
        else if (y + 1 < GH && mark[i + GW] === 1) best = label[i + GW];
        else if (y > 0 && mark[i - GW] === 1) best = label[i - GW];
        if (best >= 0) {
          label[i] = best;
          mark[i] = 3;
        } else {
          left++;
        }
      }
    }
    for (let i = 0; i < N; i++) if (mark[i] === 3) mark[i] = 1;
    if (!left) break;
  }

  const cc = makeCanvas(GW, GH);
  const cg = cc.getContext("2d", { willReadFrequently: true });
  cg.putImageData(new ImageData(new Uint8ClampedArray(baseColor), GW, GH), 0, 0);
  cg.setTransform(res, 0, 0, res, -ox, -oy);
  draw(cg, "color");
  const color = cg.getImageData(0, 0, GW, GH).data;
  return { label, color };
}
