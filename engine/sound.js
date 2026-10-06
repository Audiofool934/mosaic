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
// and is rounded off below the sharp range.
function strike(ctx, { pitch, ring, thud }, R) {
  const rate = ctx.sampleRate, f = pitch * (0.96 + 0.08 * R()), tau = ring * (0.85 + 0.3 * R());
  const n = Math.ceil(rate * (tau * 7 + 0.03));
  const buffer = ctx.createBuffer(1, n, rate), out = buffer.getChannelData(0);
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
  return buffer;
}

// context: an AudioContext to share, or an OfflineAudioContext to render sounds ahead.
export function createStoneSound({ volume = 0.5, context = null } = {}) {
  // Seeded, as everywhere in the engine: the small variations between sounds.
  const vary = rng(4242);
  // When each playing sound ends, on the audio clock, so voices are counted the same live and
  // offline.
  let ctx = null, bus = null, sounds = null, ends = [];
  const offline = () => typeof OfflineAudioContext === 'function' && ctx instanceof OfflineAudioContext;
  function build() {
    ctx = context || new AudioContext({ latencyHint: 'interactive' });
    // Nothing above the presence range and no thump below the stones.
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 150;
    low.connect(ctx.destination);
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 4500;
    soft.Q.value = 0.5;
    soft.connect(low);
    bus = ctx.createGain();
    bus.gain.value = volume;
    bus.connect(soft);
    const R = rng(7001);
    sounds = Object.fromEntries(Object.keys(MEASURED).map((name) => [name, Array.from({ length: VARIANTS }, () => strike(ctx, voiceOf(name), R))]));
  }
  function voice(buffer, rate, gain, pan, at) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    source.connect(amp).connect(panner).connect(bus);
    source.onended = () => { source.disconnect(); amp.disconnect(); panner.disconnect(); };
    source.start(at);
    ends.push(at + buffer.duration / rate);
  }
  return {
    get on() { return ctx?.state === 'running'; },
    // Call from a click or key press.
    async start() {
      if (!ctx) build();
      if (!offline()) await ctx.resume();
    },
    async stop() { if (!offline()) await ctx?.suspend(); },
    // events: contacts from controller.onContact, heard `after` seconds from now.
    play(events, after = 0) {
      if (!ctx || (ctx.state !== 'running' && !offline())) return;
      const now = ctx.currentTime + after;
      ends = ends.filter((end) => end > now);
      for (const e of events) {
        if (e.kind !== 'touch' || !(e.strength > 0) || ends.length >= VOICES) continue;
        // A smaller stone sounds higher, as its modes are, within a quarter either way; most
        // stones in a pour land softly and a few land hard.
        const size = clamp(Math.sqrt(REFERENCE / Math.max(1, e.size || REFERENCE)), 0.8, 1.25);
        const loud = LEVEL * clamp(e.strength, 0, 1) * (0.25 + 0.75 * vary() ** 2);
        voice(sounds[nameOf(e.material)][Math.floor(vary() * VARIANTS)], size * (0.97 + 0.06 * vary()), loud, (e.x * 2 - 1) * 0.5 + (vary() - 0.5) * 0.2, now + (e.delay || 0));
      }
    },
    close() {
      if (!context) ctx?.close();
      ctx = null;
      ends = [];
    }
  };
}
