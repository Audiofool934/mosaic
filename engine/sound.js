// Stone sounds, made from the stones themselves, close and quiet: a fingertip's ticks and the
// rustle of skin as the pointer slides over the stones, the soft knocks of stones the curl
// tilts against each other, and the clack of each one settling back into its mortar. All of
// it is synthesised; nothing is recorded or downloaded. Browsers start audio only from a click
// or a key, so call start() from one.
import { clamp, rng, strSeed } from './util.js';

// Each material at the stone size it is tuned to. A touch is a tick through the stone's own
// resonance (Hz, and how narrow it rings); the rustle of sliding is noise centred on rub (Hz);
// a knock is a few damped partials, as ratios of knock (Hz) with their decay times (s) and
// levels. Glass and gilded glass ring a little; marble and basalt click; limestone and fired
// clay are dull and short.
const MODELS = {
  glass: { tick: [3800, 6], rub: 3000, knock: 2200, ratios: [1, 2.3, 3.9], decays: [0.018, 0.011, 0.006], amps: [1, 0.3, 0.12], gain: 0.9 },
  gold: { tick: [3400, 6], rub: 2800, knock: 2000, ratios: [1, 2.31, 4.02], decays: [0.021, 0.012, 0.007], amps: [1, 0.35, 0.14], gain: 0.85 },
  silver: { tick: [3600, 6], rub: 3000, knock: 2150, ratios: [1, 2.31, 4.02], decays: [0.021, 0.012, 0.007], amps: [1, 0.35, 0.14], gain: 0.85 },
  emit: { tick: [3600, 6], rub: 2900, knock: 2100, ratios: [1, 2.3, 3.9], decays: [0.017, 0.01, 0.006], amps: [1, 0.3, 0.12], gain: 0.9 },
  marble: { tick: [2400, 2.4], rub: 2200, knock: 1600, ratios: [1, 2.6, 4.7], decays: [0.01, 0.006, 0.004], amps: [1, 0.3, 0.12], gain: 1 },
  basalt: { tick: [2800, 2.8], rub: 2500, knock: 1800, ratios: [1, 2.4, 4.4], decays: [0.012, 0.007, 0.004], amps: [1, 0.35, 0.12], gain: 1 },
  limestone: { tick: [1700, 1.5], rub: 1700, knock: 1150, ratios: [1, 2.7, 5.1], decays: [0.008, 0.005, 0.003], amps: [1, 0.25, 0.08], gain: 1.1 },
  terracotta: { tick: [1200, 1.5], rub: 1300, knock: 850, ratios: [1, 2.2, 4.1], decays: [0.01, 0.006, 0.004], amps: [1, 0.3, 0.1], gain: 1.15 }
};
const TUNED = 12;
const VARIANTS = 6;
// Levels of each kind of sound, before the material's own gain: the touch is the quietest and
// the most frequent, and a stone laid into wet lime is heard softly and dull.
const LEVEL = { touch: 0.42, lift: 0.1, settle: 0.26, lay: 0.2 };
// How loud the rustle of sliding gets at full speed, and how it follows the pointer: it opens
// within a few milliseconds of moving and dies away soon after the pointer stops.
const RUSTLE = { level: 0.09, attack: 0.012, hold: 0.06, release: 0.07 };
// At most this many knocks start in one frame, and this many sounds play at once.
const KNOCKS = 2;
const VOICES = 64;

// Two-pole filters, for rendering: a resonant band-pass and a gentle low-pass.
function biquad(type, f, q, rate) {
  const w = (2 * Math.PI * f) / rate, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w);
  const [b0, b1, b2] = type === 'band' ? [alpha, 0, -alpha] : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// Levels a rendered sound so materials differ by their gains alone, softening its first
// fraction of a millisecond so the contact is crisp without a click.
function level(out, rate) {
  let peak = 1e-6;
  for (let i = 0; i < out.length; i++) {
    if (i < rate * 0.0004) out[i] *= i / (rate * 0.0004);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
}

// A fingertip catching one stone's edge: a burst a fraction of a millisecond long, rung
// through the stone's resonance and rounded off by the skin.
function tick(ctx, model, seed) {
  const R = rng(seed), rate = ctx.sampleRate, n = Math.ceil(rate * 0.03);
  const buffer = ctx.createBuffer(1, n, rate), out = buffer.getChannelData(0);
  const [f, q] = model.tick;
  const ring = biquad('band', f * (0.92 + 0.16 * R()), q * (0.8 + 0.4 * R()), rate);
  const skin = biquad('low', 6000, 0.6, rate);
  const length = rate * (0.0003 + 0.0006 * R());
  for (let i = 0; i < n; i++) out[i] = skin(ring((R() * 2 - 1) * Math.exp(-i / length)) + 0.15 * (R() * 2 - 1) * Math.exp(-i / (length * 3)));
  level(out, rate);
  return buffer;
}

// Two stones meeting: a short, rounded clack, the partials of the struck stone dying within a
// few tens of milliseconds, and nothing above the presence range. Wet lime damps it further.
function knock(ctx, model, seed, wet) {
  const R = rng(seed), rate = ctx.sampleRate;
  const decays = model.decays.map((d) => d * (0.8 + 0.4 * R()) * (wet ? 0.6 : 1));
  const n = Math.ceil(rate * (Math.max(...decays) * 6 + 0.006));
  const buffer = ctx.createBuffer(1, n, rate), out = buffer.getChannelData(0);
  model.ratios.forEach((ratio, p) => {
    const f = model.knock * ratio * (1 + (R() - 0.5) * 0.08);
    const fall = Math.exp(-1 / (decays[p] * rate)), step = (2 * Math.PI * f) / rate;
    let env = model.amps[p] * (0.8 + 0.4 * R()), phase = R() * 2 * Math.PI;
    for (let i = 0; i < n; i++, env *= fall, phase += step) out[i] += env * Math.sin(phase);
  });
  const contact = biquad('low', wet ? 1800 : 4200, 0.7, rate), length = rate * 0.0012;
  for (let i = 0, end = Math.min(n, Math.ceil(length * 6)); i < end; i++) out[i] += 0.55 * contact((R() * 2 - 1) * Math.exp(-i / length));
  const round = biquad('low', wet ? 2500 : 6000, 0.6, rate);
  for (let i = 0; i < n; i++) out[i] = round(out[i]);
  level(out, rate);
  return buffer;
}

// The rustle of skin on stone: two seconds of soft, pinkish noise that loops without a seam.
function rustle(ctx) {
  const R = rng(271), rate = ctx.sampleRate, n = rate * 2;
  const buffer = ctx.createBuffer(1, n, rate), out = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = R() * 2 - 1;
    b0 = 0.997 * b0 + 0.029 * w; b1 = 0.985 * b1 + 0.032 * w; b2 = 0.95 * b2 + 0.048 * w;
    out[i] = b0 + b1 + b2 + 0.02 * w;
  }
  const fade = rate * 0.05;
  for (let i = 0; i < fade; i++) { const u = i / fade; out[i] = out[i] * u + out[n - fade + i] * (1 - u); }
  level(out, rate);
  return buffer;
}

// A small, close room: a quarter of a second of soft reflections, barely there.
function room(ctx) {
  const rate = ctx.sampleRate, n = Math.ceil(rate * 0.25);
  const buffer = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const R = rng(911 + c), out = buffer.getChannelData(c), dark = biquad('low', 3500, 0.7, rate);
    for (let i = 0; i < n; i++) out[i] = dark(R() * 2 - 1) * Math.exp(-i / (rate * 0.05));
  }
  return buffer;
}

// context: an AudioContext to share, or an OfflineAudioContext to render sounds ahead.
export function createStoneSound({ volume = 0.5, context = null } = {}) {
  // Seeded, as everywhere in the engine: the small variations between sounds.
  const vary = rng(4242);
  // When each playing sound ends, on the audio clock, so voices are counted the same live and
  // offline.
  let ctx = null, bus = null, sounds = null, ends = [], turn = 0, slide = null;
  const offline = () => typeof OfflineAudioContext === 'function' && ctx instanceof OfflineAudioContext;
  function build() {
    ctx = context || new AudioContext({ latencyHint: 'interactive' });
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 12;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    compressor.connect(ctx.destination);
    // The top end is shelved down, close, soft, and never sharp, and the thump under each
    // click is cut away.
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 120;
    low.connect(compressor);
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 5000;
    shelf.gain.value = -5;
    shelf.connect(low);
    bus = ctx.createGain();
    bus.gain.value = volume;
    bus.connect(shelf);
    const reverb = ctx.createConvolver();
    reverb.buffer = room(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.05;
    bus.connect(reverb).connect(wet).connect(shelf);
    // The rustle runs all the time, silent until the pointer slides.
    const noise = ctx.createBufferSource();
    noise.buffer = rustle(ctx);
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2400;
    band.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    noise.connect(band).connect(gain).connect(pan).connect(bus);
    noise.start();
    slide = { band, gain, pan };
    sounds = {};
    for (const [name, model] of Object.entries(MODELS)) {
      const seed = strSeed(name);
      sounds[name] = {
        touch: Array.from({ length: VARIANTS }, (_, v) => tick(ctx, model, seed + v)),
        knock: Array.from({ length: VARIANTS }, (_, v) => knock(ctx, model, seed + 97 + v, false)),
        wet: Array.from({ length: VARIANTS }, (_, v) => knock(ctx, model, seed + 193 + v, true))
      };
    }
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
      // The rustle opens with the touches of this frame and closes soon after the last one.
      let sliding = 0, rub = 0, x = 0;
      for (const e of events) {
        if (e.kind !== 'touch' || !(e.strength > 0)) continue;
        if (e.strength > sliding) { sliding = e.strength; rub = (MODELS[e.material] || MODELS.glass).rub; x = e.x; }
      }
      if (sliding) {
        const { gain, band, pan } = slide;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(RUSTLE.level * sliding, now, RUSTLE.attack);
        gain.gain.setTargetAtTime(0, now + RUSTLE.hold, RUSTLE.release);
        band.frequency.setTargetAtTime(rub, now, 0.05);
        pan.pan.setTargetAtTime(clamp(x * 2 - 1, -1, 1) * 0.6, now, 0.05);
      }
      const knocks = events.filter((e) => e.kind !== 'touch').sort((a, b) => b.strength - a.strength).slice(0, KNOCKS);
      for (const e of [...events.filter((e) => e.kind === 'touch'), ...knocks]) {
        if (ends.length >= VOICES || !(e.strength > 0)) continue;
        const name = e.material in MODELS ? e.material : 'glass', model = MODELS[name];
        const set = sounds[name][e.kind === 'touch' ? 'touch' : e.kind === 'lay' ? 'wet' : 'knock'];
        const pitch = clamp((TUNED / Math.max(1, e.size)) ** 0.5 * (0.94 + 0.12 * vary()), 0.6, 1.8);
        const loud = LEVEL[e.kind] * model.gain * Math.pow(clamp(e.strength, 0, 1), 1.2) * (0.75 + 0.25 * vary());
        voice(set[turn++ % VARIANTS], pitch, loud, (e.x * 2 - 1) * 0.7 + (vary() - 0.5) * 0.1, now + (e.delay || 0) + vary() * 0.003);
      }
    },
    close() {
      if (!context) ctx?.close();
      ctx = null;
      ends = [];
    }
  };
}
