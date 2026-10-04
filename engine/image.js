// Raster images become bounded colour regions, then use the same contour courses,
// cut stones, materials, and light as authored pictures. No image is uploaded.
import { MATERIALS } from "./picture.js";

const MAX_INPUT_PIXELS = 64 * 1024 * 1024;
const MATERIAL = { glass: MATERIALS.glass, stone: MATERIALS.marble, gold: MATERIALS.gold };
const DEFAULTS = Object.freeze({ stoneSize: 12, paletteSize: 18, material: "glass", detail: 0.6, seed: 7, width: 1600, maxDimension: 768, background: "#30322f" });

function numberOption(options, name, min, max, integer = false) {
  const value = options[name] === undefined ? DEFAULTS[name] : options[name];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError(`${name} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}.`);
  }
  return value;
}

function settings(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Image options must be an object.");
  const material = options.material === undefined ? DEFAULTS.material : options.material;
  if (!Object.hasOwn(MATERIAL, material)) throw new RangeError("material must be glass, stone, or gold.");
  const background = options.background === undefined ? DEFAULTS.background : options.background;
  if (typeof background !== "string" || !/^#[0-9a-f]{6}$/i.test(background)) throw new RangeError("background must be a six-digit hex colour, such as #30322f.");
  return {
    stoneSize: numberOption(options, "stoneSize", 3, 100),
    paletteSize: numberOption(options, "paletteSize", 2, 48, true),
    detail: numberOption(options, "detail", 0, 1),
    seed: numberOption(options, "seed", 0, 4294967295, true),
    width: numberOption(options, "width", 100, 8000),
    maxDimension: numberOption(options, "maxDimension", 64, 1024, true),
    material, background
  };
}

function validateImage(image) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new TypeError("An image must have positive integer width and height.");
  }
  if (image.width * image.height > MAX_INPUT_PIXELS) throw new RangeError("Image is too large; resize it to 64 megapixels or less.");
  const { data } = image;
  if (!(Array.isArray(data) || ArrayBuffer.isView(data)) || data.length !== image.width * image.height * 4) {
    throw new TypeError("Image data must contain exactly width × height × 4 RGBA values.");
  }
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) {
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i]) || data[i] < 0 || data[i] > 255) throw new RangeError("RGBA values must be finite numbers from 0 to 255.");
    }
  }
}

function dimensions(width, height, max) {
  const scale = max / Math.max(width, height);
  return [Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale))];
}

// Area sampling prevents fine texture from aliasing into false boundaries. Alpha is
// premultiplied while sampling, so hidden RGB in a transparent PNG cannot add a halo.
// Enlargement repeats source pixels rather than inventing new palette colours.
function resize(image, width, height) {
  const source = image.data;
  const data = new Uint8ClampedArray(width * height * 4);
  const sx = image.width / width;
  const sy = image.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      const o = (y * width + x) * 4;
      if (sx <= 1 && sy <= 1) {
        const i = (Math.min(image.height - 1, Math.floor((y + 0.5) * sy)) * image.width + Math.min(image.width - 1, Math.floor((x + 0.5) * sx))) * 4;
        data.set(source.subarray ? source.subarray(i, i + 4) : source.slice(i, i + 4), o);
        continue;
      }
      let r = 0, g = 0, b = 0, a = 0, total = 0;
      for (let yy = Math.floor(y0); yy < Math.min(image.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(image.width, Math.ceil(x1)); xx++) {
          const weight = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx));
          const i = (yy * image.width + xx) * 4;
          const wa = source[i + 3] * weight;
          r += source[i] * wa;
          g += source[i + 1] * wa;
          b += source[i + 2] * wa;
          a += wa;
          total += weight;
        }
      }
      if (a > 0) {
        data[o] = r / a;
        data[o + 1] = g / a;
        data[o + 2] = b / a;
      }
      data[o + 3] = a / total;
    }
  }
  return data;
}

function colourDistance(r, g, b, c) {
  return (2 * (r - c[0]) ** 2 + 4 * (g - c[1]) ** 2 + 3 * (b - c[2]) ** 2) / 9;
}

function hex(rgb) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

// A small bilateral neighbourhood removes texture below the stone scale while
// protecting strong silhouette edges. Transparent neighbours never enter the mean.
function smoothColour(data, mask, width, height, detail) {
  const result = new Uint8ClampedArray(data);
  const radius = Math.round(1 + (1 - detail) * 2);
  const sigma = 18 + (1 - detail) * 38;
  const weights = new Float32Array(8193);
  for (let i = 0; i < weights.length; i++) weights[i] = Math.exp(-i * 8 / (2 * sigma * sigma));
  const neighbours = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) neighbours.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (radius * radius + 1))]);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const o = i * 4;
      const r0 = data[o], g0 = data[o + 1], b0 = data[o + 2];
      let r = 0, g = 0, b = 0, total = 0;
      for (const [dx, dy, spatial] of neighbours) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const j = yy * width + xx;
        if (!mask[j]) continue;
        const p = j * 4;
        const d = (2 * (data[p] - r0) ** 2 + 4 * (data[p + 1] - g0) ** 2 + 3 * (data[p + 2] - b0) ** 2) / 9;
        const w = spatial * weights[Math.min(8192, Math.round(d / 8))];
        r += data[p] * w;
        g += data[p + 1] * w;
        b += data[p + 2] * w;
        total += w;
      }
      result[o] = r / total;
      result[o + 1] = g / total;
      result[o + 2] = b / total;
    }
  }
  return result;
}

// A weighted RGB histogram keeps palette fitting bounded even for large pictures.
// Farthest-colour initialization protects uncommon accents; weighted refinement
// brings each colour back toward the actual paint in the image.
function fitPalette(data, mask, requested) {
  const bins = new Map();
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = bins.get(key);
    if (bin) { bin[0] += r; bin[1] += g; bin[2] += b; bin[3]++; }
    else bins.set(key, [r, g, b, 1]);
  }
  const points = [...bins.values()].map(([r, g, b, count]) => [r / count, g / count, b / count, count]);
  if (!points.length) throw new RangeError("The image is fully transparent; choose an image with visible pixels.");
  const count = Math.min(requested, points.length);
  let first = 0;
  for (let i = 1; i < points.length; i++) if (points[i][3] > points[first][3]) first = i;
  let centres = [points[first].slice(0, 3)];
  const nearest = new Float64Array(points.length).fill(Infinity);
  while (centres.length < count) {
    const last = centres[centres.length - 1];
    let best = -1, bestScore = -1;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      nearest[i] = Math.min(nearest[i], colourDistance(p[0], p[1], p[2], last));
      const score = nearest[i] * Math.sqrt(p[3]);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (bestScore < 0.01) break;
    centres.push(points[best].slice(0, 3));
  }
  for (let iteration = 0; iteration < 7; iteration++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      let best = 0, distance = Infinity;
      for (let j = 0; j < centres.length; j++) {
        const d = colourDistance(p[0], p[1], p[2], centres[j]);
        if (d < distance) { distance = d; best = j; }
      }
      const sum = sums[best];
      for (let c = 0; c < 3; c++) sum[c] += p[c] * p[3];
      sum[3] += p[3];
    }
    centres = sums.filter((s) => s[3] > 0).map((s) => s.slice(0, 3).map((v) => v / s[3]));
  }
  return centres.map((c) => c.map(Math.round)).sort((a, b) => (a[0] * 2 + a[1] * 4 + a[2] * 3) - (b[0] * 2 + b[1] * 4 + b[2] * 3));
}

function classify(data, mask, palette) {
  const labels = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    let best = 0, distance = Infinity;
    for (let j = 0; j < palette.length; j++) {
      const d = colourDistance(data[o], data[o + 1], data[o + 2], palette[j]);
      if (d < distance) { distance = d; best = j; }
    }
    labels[i] = best + 1;
  }
  return labels;
}

// Merge islands smaller than a stone into a neighbouring colour, but retain small
// high-contrast marks (an eye, a star) that can still hold an individual stone.
// Regions are palette identities, not one entry per connected component.
function cleanIslands(labels, palette, width, height, minArea) {
  const seen = new Uint8Array(labels.length);
  const queue = new Int32Array(labels.length);
  const contacts = new Uint32Array(palette.length + 1);
  for (let start = 0; start < labels.length; start++) {
    if (!labels[start] || seen[start]) continue;
    const label = labels[start];
    let head = 0, tail = 1;
    queue[0] = start;
    seen[start] = 1;
    contacts.fill(0);
    while (head < tail) {
      const i = queue[head++];
      const x = i % width, y = (i / width) | 0;
      for (const j of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1]) {
        if (j < 0 || !labels[j]) continue;
        if (labels[j] !== label) contacts[labels[j]]++;
        else if (!seen[j]) { seen[j] = 1; queue[tail++] = j; }
      }
    }
    if (tail >= minArea) continue;
    const colour = palette[label - 1];
    let target = 0, best = Infinity, targetDistance = Infinity;
    for (let j = 1; j < contacts.length; j++) {
      if (!contacts[j]) continue;
      const d = colourDistance(colour[0], colour[1], colour[2], palette[j - 1]);
      const score = (d + 64) / Math.sqrt(contacts[j]);
      if (score < best) { target = j; best = score; targetDistance = d; }
    }
    if (!target || (targetDistance > 2500 && tail >= Math.max(3, minArea * 0.3))) continue;
    for (let j = 0; j < tail; j++) labels[queue[j]] = target;
  }
}

/**
 * Turn RGBA pixels into a complete engine picture without browser APIs.
 * Options: stoneSize in mm, paletteSize 2..48, material glass|stone|gold,
 * detail 0..1, seed uint32, width in mm, maxDimension 64..1024, background #rrggbb.
 * The physical panel retains the exact source aspect; analysis raster dimensions
 * are rounded to whole pixels. Alpha < 16 leaves bare mortar, and partial alpha
 * composites against background. A gold material is always an explicit choice.
 */
export function analyzeImage(image, options = {}) {
  const opts = settings(options);
  validateImage(image);
  const [GW, GH] = dimensions(image.width, image.height, opts.maxDimension);
  const W = opts.width, H = W * image.height / image.width, res = GW / W;
  const sampled = resize(image, GW, GH);
  const mask = new Uint8Array(GW * GH);
  const matte = [1, 3, 5].map((i) => parseInt(opts.background.slice(i, i + 2), 16));
  let visiblePixels = 0;
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    const alpha = sampled[o + 3] / 255;
    if (sampled[o + 3] < 16) { sampled.fill(0, o, o + 4); continue; }
    mask[i] = 1;
    visiblePixels++;
    for (let c = 0; c < 3; c++) sampled[o + c] = sampled[o + c] * alpha + matte[c] * (1 - alpha);
    sampled[o + 3] = 255;
  }
  const color = smoothColour(sampled, mask, GW, GH, opts.detail);
  const palette = fitPalette(color, mask, opts.paletteSize);
  const label = classify(color, mask, palette);
  const minArea = Math.max(3, Math.round((opts.stoneSize * res) ** 2 * (0.2 + (1 - opts.detail) * 0.7)));
  cleanIslands(label, palette, GW, GH, minArea);
  cleanIslands(label, palette, GW, GH, minArea);

  const entries = palette.map((rgb) => ({ hex: hex(rgb), mat: MATERIAL[opts.material], emit: 0 }));
  const regions = [{ id: 0, name: "none", size: opts.stoneSize, mode: "contour", tray: [] }];
  palette.forEach((rgb, index) => {
    // Nearby tray colours preserve shading after tiny colour islands are merged.
    // Every tray draws from the same finite palette, with no unrequested gold.
    const neighbours = palette.map((other, i) => ({ i, d: colourDistance(rgb[0], rgb[1], rgb[2], other) })).sort((a, b) => a.d - b.d);
    const tray = neighbours.slice(0, 3).filter((n, i) => i === 0 || n.d < 1400).map((n) => ({ ...entries[n.i] }));
    regions.push({ id: index + 1, name: `colour-${index + 1}`, size: opts.stoneSize, mode: "contour", grout: 0.06, tray });
  });
  const REG = Object.fromEntries(regions.map((r) => [r.name, r]));
  const cfg = {
    panel: { w: W, h: H }, res, background: regions[1].name,
    camera: { keys: [[0, W / 2, H / 2, W]], tilt: 0, yaw: 0, roll: 0, drift: 0, aperture: 0.01 },
    light: {
      key: { az: 135, el: 42, color: [1, 0.97, 0.91], power: 1.25 },
      fill: { az: -25, el: 55, color: [0.76, 0.86, 1], power: 0.28 },
      sky: [0.14, 0.16, 0.19], ground: [0.025, 0.021, 0.016],
      exposure: -0.08, grout: opts.background, wet: [0.58, 1.4]
    },
    build: { origin: [W / 2, H / 2], start: 0, end: 4, row: 2.2 }
  };
  const ref = (x, y) => [x, y];
  return {
    path: "imported-image", cfg, mod: { events: {} }, W, H, res, GW, GH,
    regions, REG, label, color, arrivals: [], seed: opts.seed, ref, k: 1,
    D: { ref, k: 1, res, W, H, REG },
    metadata: {
      kind: "image", sourceWidth: image.width, sourceHeight: image.height,
      analysisWidth: GW, analysisHeight: GH, palette: entries.map((e) => e.hex),
      visiblePixels, regionCount: regions.length - 1, options: { ...opts }
    }
  };
}

function canvasFor(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("Decoding an image file requires a browser; in Node pass RGBA pixels to analyzeImage().");
}

async function decode(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some browsers decode SVG and newer still-image formats only through Image.
    }
  }
  if (typeof Image === "undefined") throw new Error("This environment cannot decode image files. Pass RGBA pixels instead.");
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("Unable to decode this image. Try a PNG, JPEG, or WebP file.");
  }
}

/** Decode a local Blob/File, image URL, or RGBA image object into an engine picture. */
export async function imageToPicture(source, options = {}) {
  const opts = settings(options);
  if (source && typeof source === "object" && "data" in source) return analyzeImage(source, opts);
  let blob = source;
  if (typeof source === "string" || (typeof URL !== "undefined" && source instanceof URL)) {
    let response;
    try { response = await fetch(source); }
    catch { throw new Error("Unable to load this image URL. Download it and choose the local file, or use a URL that allows cross-origin access."); }
    if (!response.ok) throw new Error(`Unable to load image: HTTP ${response.status}.`);
    blob = await response.blob();
  }
  if (typeof Blob === "undefined" || !(blob instanceof Blob)) throw new TypeError("Choose an image File/Blob, URL, or RGBA image object.");
  if (blob.type.startsWith("video/")) throw new TypeError("Choose a still image; video conversion is outside this project's scope.");
  const decoded = await decode(blob);
  try {
    if (!decoded.width || !decoded.height) throw new Error("The image has no visible dimensions.");
    const [width, height] = dimensions(decoded.width, decoded.height, opts.maxDimension);
    const canvas = canvasFor(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("A 2D canvas is required to read the image.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.image, 0, 0, width, height);
    const picture = analyzeImage(context.getImageData(0, 0, width, height), opts);
    // Decoder scaling rounds the raster, but the source's panel aspect is exact.
    const H = picture.W * decoded.height / decoded.width;
    picture.H = H;
    picture.cfg.panel.h = H;
    picture.cfg.camera.keys[0][2] = H / 2;
    picture.cfg.build.origin[1] = H / 2;
    picture.D.H = H;
    picture.metadata.sourceWidth = decoded.width;
    picture.metadata.sourceHeight = decoded.height;
    return picture;
  } finally {
    decoded.close();
  }
}
