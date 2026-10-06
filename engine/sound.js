// The sound of the stones under the hand. A finger run across small stones makes them roll and
// click lightly against each other: one short, grainy sound of a few soft clicks, played as
// soon as the pointer moves and again as it keeps moving, kept low, with no hiss and nothing
// sharp. All of it is synthesised; nothing is recorded or downloaded. Browsers start audio
// only from a click or a key, so call start() from one.
import { clamp, rng } from './util.js';

// Versions of the sound, so no two touches in a row sound the same, and how loud a touch at
// full strength is.
const VARIANTS = 8;
const LEVEL = 1.1;
// At most this many sounds play at once.
const VOICES = 8;

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

// Small stones rolling against each other: a first click and a few lighter ones following it
// closer and closer, each a few milliseconds of a damped knock with a grain of grit in it,
// opening over half a millisecond so nothing snaps, and all of it rounded off below the
// sharp range.
function pebbles(ctx, seed) {
  const R = rng(seed), rate = ctx.sampleRate, n = Math.ceil(rate * 0.12);
  const buffer = ctx.createBuffer(1, n, rate), out = buffer.getChannelData(0);
  const grit = lowpass(2000, 0.7, rate), rise = rate * 0.0005;
  let at = 0, gap = 0.012 + 0.01 * R(), amp = 1;
  for (let k = 0, count = 3 + Math.floor(R() * 2); k < count; k++) {
    const f = 600 + 500 * R(), decay = rate * (0.0008 + 0.0007 * R()), w = (2 * Math.PI * f) / rate;
    const start = Math.round(at * rate), end = Math.min(n, start + Math.ceil(decay * 7));
    for (let i = start; i < end; i++) {
      const t = i - start, open = t < rise ? 0.5 - 0.5 * Math.cos((Math.PI * t) / rise) : 1;
      out[i] += amp * open * Math.exp(-t / decay) * (Math.sin(w * t) + 1.2 * grit(R() * 2 - 1));
    }
    at += gap * (0.75 + 0.5 * R());
    gap *= 0.7;
    amp *= 0.4 + 0.3 * R();
  }
  const round = lowpass(2400, 0.6, rate);
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs((out[i] = round(out[i]))));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  return buffer;
}

// context: an AudioContext to share, or an OfflineAudioContext to render sounds ahead.
export function createStoneSound({ volume = 0.5, context = null } = {}) {
  // Seeded, as everywhere in the engine: the small variations between sounds.
  const vary = rng(4242);
  // When each playing sound ends, on the audio clock, so voices are counted the same live and
  // offline.
  let ctx = null, bus = null, sounds = null, ends = [], turn = 0;
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
    soft.frequency.value = 3000;
    soft.Q.value = 0.5;
    soft.connect(low);
    bus = ctx.createGain();
    bus.gain.value = volume;
    bus.connect(soft);
    sounds = Array.from({ length: VARIANTS }, (_, v) => pebbles(ctx, 7001 + v));
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
        const loud = LEVEL * clamp(e.strength, 0, 1) * (0.85 + 0.15 * vary());
        voice(sounds[turn++ % VARIANTS], 0.95 + 0.1 * vary(), loud, (e.x * 2 - 1) * 0.4, now);
      }
    },
    close() {
      if (!context) ctx?.close();
      ctx = null;
      ends = [];
    }
  };
}
