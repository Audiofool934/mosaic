// The sound of the stones under the hand, like a small pouch of stones poured onto a table: the
// pointer sets off stones as it slides, and each is heard as its own material landing on
// something solid. Each material's voice comes from published measurements of it, not from
// tuning by ear: the speed of sound in it sets its pitch, its density how hard it lands, and its
// internal damping how long it rings. docs/sound.md gives the sources and the method. All of it
// stays below the sharp range, with no hiss, and is synthesised; nothing is recorded or
// downloaded. Browsers start audio only from a click or a key, so call start() from one.
import { clamp, rng } from './util.js';

// Each material as measured: the speed of sound in it (m/s), its density (kg/m³), and its loss
// factor. Light is glass that glows.
const MEASURED = {
  glass: { speed: 4900, density: 2500, loss: 1.1e-3 },
  gold: { speed: 2000, density: 19300, loss: 3e-4 },
  silver: { speed: 2700, density: 10500, loss: 4e-4 },
  marble: { speed: 4900, density: 2700, loss: 3.3e-3 },
  basalt: { speed: 4550, density: 2900, loss: 1.8e-3 },
  limestone: { speed: 3350, density: 2650, loss: 1e-2 },
  terracotta: { speed: 2750, density: 2000, loss: 1.4e-2 }
};
const LIKE = { emit: 'glass' };
// The style, one for every material. A glass stone REFERENCE millimetres across sounds at PITCH
// Hz and rings for RING seconds. Every other material keeps its pitch relative to glass and
// KEEP of its measured difference in ringing, so metal rings on without drowning the stones.
const REFERENCE = 10;
const PITCH = 1000;
const RING = 0.018;
const KEEP = 0.6;
// The modes of a small square tile with free edges, as ratios of its lowest, and how strongly a
// soft fall sets each ringing: mostly the lowest, as a soft contact barely reaches the others.
const MODES = [[1, 1], [1.456, 0.4], [1.803, 0.25], [2.584, 0.12]];
// Versions of each material's sound, so a pour never repeats itself; the energy of every stone,
// so no material is louder than another; how loud a stone is at full strength; and at most how
// many sounds play at once.
const VARIANTS = 8;
const ENERGY = 0.003;
const LEVEL = 0.28;
const VOICES = 32;

const nameOf = (material) => {
  const name = Object.hasOwn(LIKE, material) ? LIKE[material] : material;
  return Object.hasOwn(MEASURED, name) ? name : 'glass';
};

// A material's voice: the pitch of a reference tile's lowest mode (Hz), how long that mode rings
// (s), and how hard the stone knocks the table, relative to glass. A tile's modes rise with the
// speed of sound in it, and each rings for 1 / (π f loss) seconds.
export function voiceOf(material) {
  const m = MEASURED[nameOf(material)], g = MEASURED.glass;
  return {
    pitch: PITCH * (m.speed / g.speed),
    ring: RING * ((g.loss * g.speed) / (m.loss * m.speed)) ** KEEP,
    thud: Math.sqrt(m.density / g.density)
  };
}

// A gentle two-pole low-pass, for rendering.
function lowpass(f, q, rate) {
  const w = (2 * Math.PI * f) / rate, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w);
  const b0 = (1 - cos) / 2, b1 = 1 - cos, b2 = (1 - cos) / 2, a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// One stone landing on a table: the tile's modes, each ringing less long the higher it is, as
// damping in a solid makes them; the table's own low knock, harder under a heavier stone; and a
// moment of grit where they meet. It opens over a fraction of a millisecond so nothing snaps
// and is rounded off below the sharp range. Returns its samples at `rate` a second.
function strike(rate, { pitch, ring, thud }, R) {
  const f = pitch * (0.96 + 0.08 * R()), tau = ring * (0.85 + 0.3 * R());
  const n = Math.ceil(rate * (tau * 7 + 0.03));
  const out = new Float32Array(n);
  const mode = (hz, level, decay) => {
    const w = (2 * Math.PI * hz) / rate, fall = Math.exp(-1 / (decay * rate));
    let env = level;
    for (let i = 0; i < n && env > 1e-4; i++, env *= fall) out[i] += env * Math.sin(w * i);
  };
  for (const [ratio, level] of MODES) mode(f * ratio, level, tau / ratio);
  mode(300 + 150 * R(), 0.35 * thud, 0.008 + 0.004 * R());
  const grit = lowpass(2000, 0.7, rate), length = rate * 0.0005;
  for (let i = 0; i < length * 8; i++) out[i] += 0.5 * grit((R() * 2 - 1) * Math.exp(-i / length));
  const soft = lowpass(3000, 0.6, rate), open = rate * 0.0006;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    out[i] = soft(out[i]) * (i < open ? 0.5 - 0.5 * Math.cos((Math.PI * i) / open) : 1) * Math.min(1, (n - i) / (n * 0.2));
    energy += out[i] * out[i];
  }
  const scale = Math.sqrt((ENERGY * rate) / energy);
  for (let i = 0; i < n; i++) out[i] *= scale;
  return out;
}

// Every material's sounds at `rate` samples a second, seeded, so they are the same each time.
function strikes(rate) {
  const R = rng(7001);
  return Object.fromEntries(Object.keys(MEASURED).map((name) => [name, Array.from({ length: VARIANTS }, () => strike(rate, voiceOf(name), R))]));
}

// Casts each stone heard as one of its material's sounds. Seeded, as everywhere in the engine:
// the small variations between sounds. It counts the sounds still playing on the clock of its
// events, so voices are counted the same live and rendered ahead.
function caster() {
  const vary = rng(4242);
  let ends = [];
  // events: the stones heard from `now` on; seconds(material, variant): how long that sound
  // lasts; voice(material, variant, rate, gain, pan, at): plays it.
  return (events, now, seconds, voice) => {
    ends = ends.filter((end) => end > now);
    for (const e of events) {
      if ((e.kind !== 'touch' && e.kind !== 'land') || !(e.strength > 0) || ends.length >= VOICES) continue;
      // A smaller stone sounds higher, as its modes are, within a quarter either way; most
      // stones in a pour land softly and a few land hard.
      const size = clamp(Math.sqrt(REFERENCE / Math.max(1, e.size || REFERENCE)), 0.8, 1.25);
      const loud = LEVEL * clamp(e.strength, 0, 1) * (0.25 + 0.75 * vary() ** 2);
      const material = nameOf(e.material), variant = Math.floor(vary() * VARIANTS), rate = size * (0.97 + 0.06 * vary());
      const pan = clamp((e.x * 2 - 1) * 0.5 + (vary() - 0.5) * 0.2, -1, 1), at = now + (e.delay || 0);
      voice(material, variant, rate, loud, pan, at);
      ends.push(at + seconds(material, variant) / rate);
    }
  };
}

// The whole mix is rounded off above SOFT hertz, so nothing reaches the sharp range, and cut
// below LOW, so there is no thump under the stones.
const SOFT = { type: 'lowpass', frequency: 4500, Q: 0.5 };
const LOW = { type: 'highpass', frequency: 150, Q: 1 };

// context: an AudioContext to share, or an OfflineAudioContext to render sounds ahead.
export function createStoneSound({ volume = 0.5, context = null } = {}) {
  let ctx = null, bus = null, sounds = null, cast = null;
  const offline = () => typeof OfflineAudioContext === 'function' && ctx instanceof OfflineAudioContext;
  function build() {
    ctx = context || new AudioContext({ latencyHint: 'interactive' });
    const low = ctx.createBiquadFilter();
    low.type = LOW.type;
    low.frequency.value = LOW.frequency;
    low.connect(ctx.destination);
    const soft = ctx.createBiquadFilter();
    soft.type = SOFT.type;
    soft.frequency.value = SOFT.frequency;
    soft.Q.value = SOFT.Q;
    soft.connect(low);
    bus = ctx.createGain();
    bus.gain.value = volume;
    bus.connect(soft);
    sounds = Object.fromEntries(Object.entries(strikes(ctx.sampleRate)).map(([name, list]) => [name, list.map((samples) => {
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      return buffer;
    })]));
    cast = caster();
  }
  function voice(material, variant, rate, gain, pan, at) {
    const source = ctx.createBufferSource();
    source.buffer = sounds[material][variant];
    source.playbackRate.value = rate;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(amp).connect(panner).connect(bus);
    source.onended = () => { source.disconnect(); amp.disconnect(); panner.disconnect(); };
    source.start(at);
  }
  return {
    get on() { return ctx?.state === 'running'; },
    // Call from a click or key press.
    async start() {
      if (!ctx) build();
      if (!offline()) await ctx.resume();
    },
    async stop() { if (!offline()) await ctx?.suspend(); },
    // events: contacts from controller.onContact or landings from controller.onLanding, heard
    // `after` seconds from now.
    play(events, after = 0) {
      if (!ctx || (ctx.state !== 'running' && !offline())) return;
      cast(events, ctx.currentTime + after, (material, variant) => sounds[material][variant].duration, voice);
    },
    close() {
      if (!context) ctx?.close();
      ctx = null;
      cast = null;
    }
  };
}

// A browser's own low-pass or high-pass filter, as the Web Audio specification defines it, with
// its Q in decibels, so a film is rounded off as the live sound is.
function biquad({ type, frequency, Q }, rate) {
  const w = (2 * Math.PI * frequency) / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * 10 ** (Q / 20));
  const high = type === 'highpass', b1 = high ? -(1 + cos) : 1 - cos, b0 = Math.abs(b1) / 2, a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  return (samples) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i], y = (b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      samples[i] = y;
    }
  };
}

// A film's score as sound: the landings of scoreLandings, heard from `from` seconds into the
// film for `duration` seconds, at `rate` samples a second. Returns the left and right
// channels. It casts and voices the stones as the live sound does, but mixes them itself, one
// after another in the order they land: a browser mixes its voices in no fixed order, which
// moves a sample by a rounding step from one render to the next, and a film must come out the
// same every time. It needs no browser. The last stones are faded over the final fiftieth of a
// second, so a film that ends on a landing does not click.
export function renderScore(events, { from = 0, duration, rate = 48000, volume = 1 } = {}) {
  const frames = Math.max(1, Math.round(duration * rate));
  const channels = [new Float32Array(frames), new Float32Array(frames)], sounds = strikes(rate), cast = caster();
  const voice = (material, variant, speed, gain, pan, at) => {
    // A sound played faster or slower is read between its samples, and set across the two
    // channels at equal power.
    const samples = sounds[material][variant], start = at * rate, across = ((pan + 1) / 2) * (Math.PI / 2);
    const left = volume * gain * Math.cos(across), right = volume * gain * Math.sin(across);
    for (let i = Math.max(0, Math.ceil(start)); i < frames; i++) {
      const p = (i - start) * speed, k = Math.floor(p);
      if (k >= samples.length) break;
      const s = samples[k] + ((k + 1 < samples.length ? samples[k + 1] : 0) - samples[k]) * (p - k);
      channels[0][i] += left * s;
      channels[1][i] += right * s;
    }
  };
  for (const e of events) cast([e], e.time - from, (material, variant) => sounds[material][variant].length / rate, voice);
  const fade = Math.min(frames, Math.round(rate / 50));
  for (const c of channels) {
    biquad(SOFT, rate)(c);
    biquad(LOW, rate)(c);
    for (let i = 1; i <= fade; i++) c[frames - i] *= (i - 1) / fade;
  }
  return channels;
}

// Channels of samples from -1 to 1 as a 16-bit WAV file's bytes.
export function wavOf(channels, rate = 48000) {
  const n = channels[0].length, k = channels.length, bytes = new DataView(new ArrayBuffer(44 + n * k * 2));
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); bytes.setUint32(4, 36 + n * k * 2, true); text(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, k, true);
  bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * k * 2, true); bytes.setUint16(32, k * 2, true); bytes.setUint16(34, 16, true);
  text(36, 'data'); bytes.setUint32(40, n * k * 2, true);
  for (let i = 0, at = 44; i < n; i++) for (let c = 0; c < k; c++, at += 2) bytes.setInt16(at, Math.round(clamp(channels[c][i], -1, 1) * 32767), true);
  return new Uint8Array(bytes.buffer);
}
