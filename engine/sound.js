// Stone sounds, made from the stones themselves: each contact strikes a few damped partials
// and a breath of noise, tuned by the stone's material and size, in a small room. Nothing is
// recorded or downloaded. Browsers start audio only from a click or a key, so call start()
// from one.
import { clamp, rng, strSeed } from './util.js';

// Each material at the size it is tuned to: partials as ratios of a fundamental (Hz), their
// decay times (s) and levels, then the grit of the contact: its level, length (s), and
// brightness (Hz). Glass rings; stone clicks; limestone and fired clay are dull and short.
const MODELS = {
  glass: { f: 3200, ratios: [1, 2.24, 3.83, 5.71], decays: [0.08, 0.05, 0.035, 0.025], amps: [1, 0.55, 0.35, 0.22], grit: [0.25, 0.0025, 9000], gain: 0.65 },
  gold: { f: 3000, ratios: [1, 2.31, 4.02, 6.1], decays: [0.1, 0.065, 0.04, 0.028], amps: [1, 0.6, 0.4, 0.25], grit: [0.2, 0.0025, 9500], gain: 0.55 },
  silver: { f: 3300, ratios: [1, 2.31, 4.02, 6.1], decays: [0.1, 0.065, 0.04, 0.028], amps: [1, 0.6, 0.4, 0.25], grit: [0.2, 0.0025, 10000], gain: 0.55 },
  emit: { f: 2800, ratios: [1, 2.24, 3.83, 5.71], decays: [0.075, 0.048, 0.032, 0.022], amps: [1, 0.5, 0.3, 0.2], grit: [0.25, 0.0025, 8500], gain: 0.6 },
  marble: { f: 2200, ratios: [1, 2.6, 4.7], decays: [0.045, 0.028, 0.018], amps: [1, 0.5, 0.3], grit: [0.45, 0.004, 7000], gain: 0.6 },
  basalt: { f: 2600, ratios: [1, 2.4, 4.4], decays: [0.055, 0.032, 0.02], amps: [1, 0.55, 0.3], grit: [0.4, 0.003, 8000], gain: 0.6 },
  limestone: { f: 1500, ratios: [1, 2.7, 5.1], decays: [0.028, 0.018, 0.012], amps: [1, 0.4, 0.2], grit: [0.6, 0.006, 4500], gain: 0.7 },
  terracotta: { f: 1100, ratios: [1, 2.2, 4.1], decays: [0.035, 0.02, 0.013], amps: [1, 0.45, 0.2], grit: [0.5, 0.005, 3500], gain: 0.75 }
};
const TUNED = 12;
const VARIANTS = 4;
// A stone set into wet lime rings for about half as long, and is heard more softly.
const WET = { decay: 0.5, brightness: 0.6, gain: 0.4 };
// At most this many strikes start in one frame, and this many play at once.
const STRIKES = 4;
const VOICES = 32;

// One strike, rendered once: the partials ring down from the contact, which is a short burst
// of filtered noise.
function strike(ctx, model, seed, wet) {
  const R = rng(seed);
  const rate = ctx.sampleRate;
  const decays = model.decays.map((d) => d * (0.85 + 0.3 * R()) * (wet ? WET.decay : 1));
  const n = Math.ceil(rate * (Math.max(...decays) * 6.5 + 0.01));
  const buffer = ctx.createBuffer(1, n, rate);
  const out = buffer.getChannelData(0);
  model.ratios.forEach((ratio, p) => {
    const f = model.f * ratio * (1 + (R() - 0.5) * 0.06);
    if (f > rate * 0.45) return;
    const amp = model.amps[p] * (0.8 + 0.4 * R());
    const fall = Math.exp(-1 / (decays[p] * rate));
    const step = (2 * Math.PI * f) / rate;
    let env = amp, phase = R() * 2 * Math.PI;
    for (let i = 0; i < n; i++, env *= fall, phase += step) out[i] += env * Math.sin(phase);
  });
  const [level, length, bright] = model.grit;
  const smooth = Math.exp((-2 * Math.PI * bright * (wet ? WET.brightness : 1)) / rate);
  let y = 0;
  for (let i = 0, end = Math.min(n, Math.ceil(length * 5 * rate)); i < end; i++) {
    y = (1 - smooth) * (R() * 2 - 1) * level * Math.exp(-i / (length * rate)) + smooth * y;
    out[i] += y;
  }
  // A fifth of a millisecond of fade-in keeps the contact crisp without a click, and the
  // strike is levelled so the materials differ by their models' gains alone.
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    if (i < rate * 0.0002) out[i] *= i / (rate * 0.0002);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  return buffer;
}

// A small, soft room: stereo noise falling away over half a second, darkened as it falls.
function room(ctx) {
  const rate = ctx.sampleRate, n = Math.ceil(rate * 0.7);
  const buffer = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const R = rng(911 + c), out = buffer.getChannelData(c);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate, smooth = 0.2 + 0.7 * Math.min(1, t / 0.4);
      y = (1 - smooth) * (R() * 2 - 1) + smooth * y;
      out[i] = y * Math.exp(-t / 0.16);
    }
  }
  return buffer;
}

// context: an AudioContext to share, or an OfflineAudioContext to render strikes ahead.
export function createStoneSound({ volume = 0.55, context = null } = {}) {
  // Seeded, as everywhere in the engine: the small variations between strikes.
  const vary = rng(4242);
  // When each playing strike ends, on the audio clock, so the voices are counted the same
  // live and offline.
  let ctx = null, bus = null, strikes = null, ends = [], turn = 0;
  const offline = () => typeof OfflineAudioContext === 'function' && ctx instanceof OfflineAudioContext;
  function build() {
    ctx = context || new AudioContext();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.ratio.value = 3;
    compressor.connect(ctx.destination);
    bus = ctx.createGain();
    bus.gain.value = volume;
    bus.connect(compressor);
    const reverb = ctx.createConvolver();
    reverb.buffer = room(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    bus.connect(reverb).connect(wet).connect(compressor);
    strikes = {};
    for (const [name, model] of Object.entries(MODELS)) {
      strikes[name] = {
        dry: Array.from({ length: VARIANTS }, (_, v) => strike(ctx, model, strSeed(name) + v, false)),
        wet: Array.from({ length: VARIANTS }, (_, v) => strike(ctx, model, strSeed(name) + 97 + v, true))
      };
    }
  }
  return {
    get on() { return ctx?.state === 'running'; },
    // Call from a click or key press.
    async start() {
      if (!ctx) build();
      if (!offline()) await ctx.resume();
    },
    async stop() { if (!offline()) await ctx?.suspend(); },
    // events: contacts from controller.onContact, struck `after` seconds from now.
    play(events, after = 0) {
      if (!ctx || (ctx.state !== 'running' && !offline())) return;
      const now = ctx.currentTime + after;
      const loudest = events.length > STRIKES ? [...events].sort((a, b) => b.strength - a.strength).slice(0, STRIKES) : events;
      ends = ends.filter((end) => end > now);
      for (const e of loudest) {
        if (ends.length >= VOICES || !(e.strength > 0)) continue;
        const model = MODELS[e.material] || MODELS.glass;
        const wet = e.kind === 'lay';
        const variants = strikes[e.material in MODELS ? e.material : 'glass'][wet ? 'wet' : 'dry'];
        const source = ctx.createBufferSource();
        source.buffer = variants[turn++ % VARIANTS];
        source.playbackRate.value = clamp((TUNED / Math.max(1, e.size)) ** 0.7 * (0.97 + 0.06 * vary()), 0.5, 2.2);
        const gain = ctx.createGain();
        gain.gain.value = model.gain * Math.pow(clamp(e.strength, 0, 1), 1.3) * (wet ? WET.gain : 1);
        const pan = ctx.createStereoPanner();
        pan.pan.value = clamp(e.x * 2 - 1, -1, 1) * 0.75;
        source.connect(gain).connect(pan).connect(bus);
        source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect(); };
        const start = now + vary() * 0.012;
        source.start(start);
        ends.push(start + source.buffer.duration / source.playbackRate.value);
      }
    },
    close() {
      if (!context) ctx?.close();
      ctx = null;
      ends = [];
    }
  };
}
