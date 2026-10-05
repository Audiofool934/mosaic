// Stone sounds, close, soft, and sparing: the hush of a fingertip sliding over the stones, the
// soft knock of a stone it catches now and then, and the dull tap of a laid stone pressed into
// its bed. Every sound is kept low and round, with nothing sharp in it. All of it is
// synthesised; nothing is recorded or downloaded. Browsers start audio only from a click or a
// key, so call start() from one.
import { clamp, rng, strSeed } from './util.js';

// Each material at the stone size it is tuned to. A knock is the stone's low tone (Hz) and a
// quieter overtone (its ratio to the tone, and its level), dying away in ring seconds, over a
// breath of grit where the stones meet; the hush of sliding is soft noise below hush (Hz).
// Glass and gilded glass ring a little longer; limestone and fired clay are lower, duller,
// and shorter.
const MODELS = {
  glass: { tone: 760, over: [2.4, 0.16], ring: 0.032, grit: 1, hush: 1500, gain: 0.7 },
  gold: { tone: 700, over: [2.3, 0.15], ring: 0.03, grit: 1, hush: 1400, gain: 0.72 },
  silver: { tone: 740, over: [2.3, 0.15], ring: 0.03, grit: 1, hush: 1450, gain: 0.72 },
  emit: { tone: 780, over: [2.4, 0.16], ring: 0.032, grit: 1, hush: 1500, gain: 0.7 },
  marble: { tone: 560, over: [2.7, 0.12], ring: 0.022, grit: 1.4, hush: 1200, gain: 0.85 },
  basalt: { tone: 520, over: [2.6, 0.12], ring: 0.024, grit: 1.4, hush: 1150, gain: 0.85 },
  limestone: { tone: 420, over: [2.9, 0.08], ring: 0.016, grit: 2, hush: 950, gain: 1 },
  terracotta: { tone: 340, over: [2.5, 0.08], ring: 0.015, grit: 2.2, hush: 850, gain: 1.05 }
};
const TUNED = 12;
const VARIANTS = 6;
// Levels of each kind of knock, before the material's own gain.
const LEVEL = { touch: 0.8, lay: 0.5 };
// How loud the hush gets at full speed, and how it follows the pointer: it opens within a few
// milliseconds of moving and dies away soon after the pointer stops.
const HUSH = { level: 0.19, attack: 0.015, hold: 0.04, release: 0.05 };
const VOICES = 16;

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

// Levels a rendered sound so materials differ by their gains alone, opening it over two
// milliseconds and letting its end fade, so nothing clicks.
function level(out, rate) {
  const rise = rate * 0.002, fall = out.length * 0.2;
  let peak = 1e-6;
  for (let i = 0; i < out.length; i++) {
    if (i < rise) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / rise);
    if (i > out.length - fall) out[i] *= (out.length - i) / fall;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
}

// A stone knocked softly: its low tone and a quieter overtone dying within a few tens of
// milliseconds over a breath of grit, all rounded off below the sharp range. Pressed into wet
// lime it is lower, shorter, and duller.
function knock(ctx, model, seed, wet) {
  const R = rng(seed), rate = ctx.sampleRate;
  const ring = model.ring * (0.85 + 0.3 * R()) * (wet ? 0.6 : 1);
  const n = Math.ceil(rate * (ring * 6 + 0.01));
  const buffer = ctx.createBuffer(1, n, rate), out = buffer.getChannelData(0);
  const tone = model.tone * (wet ? 0.85 : 1) * (0.96 + 0.08 * R()), [ratio, amp] = model.over;
  for (const [f, a, d] of [[tone, 1, ring], [tone * ratio * (0.98 + 0.04 * R()), amp, ring / 2]]) {
    const fall = Math.exp(-1 / (d * rate)), step = (2 * Math.PI * f) / rate;
    let env = a;
    for (let i = 0; i < n; i++, env *= fall) out[i] += env * Math.sin(step * i);
  }
  const grit = lowpass(wet ? 900 : 1500, 0.7, rate), length = rate * 0.003;
  for (let i = 0, end = Math.min(n, Math.ceil(length * 6)); i < end; i++) out[i] += model.grit * grit((R() * 2 - 1) * Math.exp(-i / length));
  const round = lowpass(wet ? 1300 : 2200, 0.6, rate);
  for (let i = 0; i < n; i++) out[i] = round(out[i]);
  level(out, rate);
  return buffer;
}

// The hush of skin on stone: two seconds of soft, pinkish noise that loops without a seam.
function hush(ctx) {
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
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  return buffer;
}

// A small, close, dark room: a third of a second of soft reflections, barely there.
function room(ctx) {
  const rate = ctx.sampleRate, n = Math.ceil(rate * 0.3);
  const buffer = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const R = rng(911 + c), out = buffer.getChannelData(c), dark = lowpass(2200, 0.7, rate);
    for (let i = 0; i < n; i++) out[i] = dark(R() * 2 - 1) * Math.exp(-i / (rate * 0.06));
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
    // Everything is rounded off above the presence range, and the thump under it is cut away.
    // The sounds are sparse and quiet enough to need no compressor, and its lookahead would
    // make every one of them late.
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 100;
    low.connect(ctx.destination);
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 3200;
    soft.Q.value = 0.5;
    soft.connect(low);
    bus = ctx.createGain();
    bus.gain.value = volume;
    bus.connect(soft);
    const reverb = ctx.createConvolver();
    reverb.buffer = room(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.1;
    bus.connect(reverb).connect(wet).connect(soft);
    // The hush runs all the time, silent until the pointer slides.
    const noise = ctx.createBufferSource();
    noise.buffer = hush(ctx);
    noise.loop = true;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1200;
    tone.Q.value = 0.5;
    const body = ctx.createBiquadFilter();
    body.type = 'highpass';
    body.frequency.value = 250;
    body.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    noise.connect(body).connect(tone).connect(gain).connect(pan).connect(bus);
    noise.start();
    slide = { tone, gain, pan };
    sounds = {};
    for (const [name, model] of Object.entries(MODELS)) {
      const seed = strSeed(name);
      sounds[name] = {
        touch: Array.from({ length: VARIANTS }, (_, v) => knock(ctx, model, seed + v, false)),
        lay: Array.from({ length: VARIANTS }, (_, v) => knock(ctx, model, seed + 97 + v, true))
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
      for (const e of events) {
        if (!(e.strength > 0)) continue;
        const name = e.material in MODELS ? e.material : 'glass', model = MODELS[name];
        if (e.kind === 'slide') {
          // The hush opens with each frame the pointer slides and closes soon after the last.
          const { tone, gain, pan } = slide;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setTargetAtTime(HUSH.level * clamp(e.strength, 0, 1), now, HUSH.attack);
          gain.gain.setTargetAtTime(0, now + HUSH.hold, HUSH.release);
          tone.frequency.setTargetAtTime(model.hush, now, 0.05);
          pan.pan.setTargetAtTime(clamp(e.x * 2 - 1, -1, 1) * 0.5, now, 0.05);
        } else if (Object.hasOwn(LEVEL, e.kind) && ends.length < VOICES) {
          const pitch = clamp((TUNED / Math.max(1, e.size)) ** 0.3 * (0.97 + 0.06 * vary()), 0.85, 1.2);
          const loud = LEVEL[e.kind] * model.gain * clamp(e.strength, 0, 1) * (0.85 + 0.15 * vary());
          voice(sounds[name][e.kind][turn++ % VARIANTS], pitch, loud, (e.x * 2 - 1) * 0.5 + (vary() - 0.5) * 0.1, now);
        }
      }
    },
    close() {
      if (!context) ctx?.close();
      ctx = null;
      ends = [];
    }
  };
}
