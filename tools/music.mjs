// Listening to a track: reading its samples, and finding its onsets, the moments a note or a
// beat begins, which a film's stones land on. A WAV file is read as it is; any other format is
// decoded by ffmpeg.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// A PCM or floating-point WAV file's sample rate and channels, or null if it is not one.
export function readWav(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.length < 12 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') return null;
  let format = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = bytes.toString('latin1', at, at + 4), size = bytes.readUInt32LE(at + 4), body = at + 8;
    if (id === 'fmt ' && size >= 16) {
      // An extensible format names its real one in the first two bytes of its subformat.
      const tag = bytes.readUInt16LE(body);
      format = { tag: tag === 0xfffe && size >= 26 ? bytes.readUInt16LE(body + 24) : tag, channels: bytes.readUInt16LE(body + 2), rate: bytes.readUInt32LE(body + 4), bits: bytes.readUInt16LE(body + 14) };
    } else if (id === 'data' && format) {
      const { tag, channels: k, rate, bits } = format, width = bits / 8;
      if (!k || !rate || !((tag === 1 && [8, 16, 24, 32].includes(bits)) || (tag === 3 && [32, 64].includes(bits)))) return null;
      const n = Math.floor(Math.min(size, bytes.length - body) / (width * k));
      const read = tag === 3 ? (bits === 32 ? (o) => bytes.readFloatLE(o) : (o) => bytes.readDoubleLE(o))
        : bits === 8 ? (o) => (bytes[o] - 128) / 128 : bits === 16 ? (o) => bytes.readInt16LE(o) / 32768 : bits === 24 ? (o) => bytes.readIntLE(o, 3) / 8388608 : (o) => bytes.readInt32LE(o) / 2147483648;
      const channels = Array.from({ length: k }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) channels[c][i] = read(body + (i * k + c) * width);
      return { rate, channels };
    }
    at = body + size + (size % 2);
  }
  return null;
}

// A track of any format ffmpeg reads, as `channels` channels at `rate` samples a second.
export async function decodeTrack(file, { rate = 48000, channels = 2, signal } = {}) {
  const process = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-f', 'f32le', '-ac', String(channels), '-ar', String(rate), 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], signal });
  const chunks = [];
  let stderr = '';
  process.stdout.on('data', (chunk) => chunks.push(chunk));
  process.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  await new Promise((resolve, reject) => {
    process.once('error', (error) => reject(error.code === 'ENOENT' ? new Error('Reading this track needs ffmpeg on PATH; a WAV file needs none.') : error));
    process.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg could not read the track: ${stderr.trim() || 'exit ' + code}`))));
  });
  const bytes = Buffer.concat(chunks), n = Math.floor(bytes.length / (4 * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = bytes.readFloatLE((i * channels + c) * 4);
  return { rate, channels: out };
}

// A track as one channel, for listening to: a WAV file as it is, anything else through ffmpeg.
export async function readTrack(file) {
  const wav = readWav(await readFile(file));
  const { rate, channels } = wav || await decodeTrack(file, { rate: 22050, channels: 1 });
  const mono = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / channels.length;
  return { rate, samples: mono, duration: mono.length / rate };
}

// The spectrum of 2^k real samples, in place: re and im become its real and imaginary parts.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, turn = (-2 * Math.PI) / size;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(turn * k), wi = Math.sin(turn * k);
      for (let i = k; i < n; i += size) {
        const j = i + half, xr = re[j] * wr - im[j] * wi, xi = re[j] * wi + im[j] * wr;
        re[j] = re[i] - xr; im[j] = im[i] - xi; re[i] += xr; im[i] += xi;
      }
    }
  }
}

// The onsets of a track: where its spectrum grows, the standard spectral-flux measure. Each
// window of about 46 ms is compared with the one about 12 ms before it, and the growth of
// every frequency is added up; an onset is a peak of that growth standing clear of the growth
// around it, at least GAP seconds after the last. Returns [seconds, strength from 0 to 1]
// pairs in order, the strongest onset of the track at 1. A full-scale tone has a magnitude of
// 1, and growth below FLOOR, about that of a tone 34 dB under full scale coming in, is taken
// for the breathing of a held note or of hiss, not for an onset.
const GAP = 0.06;
const FLOOR = 1;
export function findOnsets(samples, rate) {
  const size = 2 ** Math.round(Math.log2(rate * 0.046)), hop = Math.max(1, Math.round(rate * 0.0116));
  const frames = Math.floor((samples.length - size) / hop) + 1;
  if (frames < 3) return [];
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const re = new Float64Array(size), im = new Float64Array(size), bins = size / 2;
  let last = new Float64Array(bins), now = new Float64Array(bins);
  const flux = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) { re[i] = samples[f * hop + i] * window[i]; im[i] = 0; }
    fft(re, im);
    // Loudness is heard by its ratio, so each frequency is compared on a logarithmic scale.
    for (let b = 0; b < bins; b++) {
      now[b] = Math.log1p((100 * Math.hypot(re[b], im[b])) / (size / 4));
      if (f && now[b] > last[b]) flux[f] += now[b] - last[b];
    }
    [last, now] = [now, last];
  }
  let top = 0;
  for (const v of flux) top = Math.max(top, v);
  if (!(top > 0)) return [];
  const around = Math.max(1, Math.round((0.1 * rate) / hop)), near = Math.max(1, Math.round((0.035 * rate) / hop));
  const onsets = [];
  for (let f = 1; f < frames - 1; f++) {
    let mean = 0, count = 0, peak = true;
    for (let k = Math.max(0, f - around); k <= Math.min(frames - 1, f + around); k++, count++) mean += flux[k];
    for (let k = Math.max(0, f - near); k <= Math.min(frames - 1, f + near) && peak; k++) peak = flux[k] < flux[f] || k === f || (flux[k] === flux[f] && k > f);
    if (!peak || flux[f] < FLOOR || flux[f] < 1.5 * (mean / count) + 0.05 * top) continue;
    // The growth is greatest as the onset passes the middle of the later window.
    const at = (f * hop + size / 2) / rate;
    if (onsets.length && at - onsets.at(-1)[0] < GAP) continue;
    onsets.push([Math.round(at * 1000) / 1000, Math.round((flux[f] / top) * 1000) / 1000]);
  }
  return onsets;
}
