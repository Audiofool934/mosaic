// The sound of the stones under the hand, like a small pouch of stones poured onto a table: the
// pointer sets off stones as it slides, and each one is heard as its own material striking
// something solid. Stone and glass give a soft, dull knock; gold and silver ring like small
// blocks of metal. Each is short and kept below the sharp range, with no hiss. All of it is
// synthesised; nothing is recorded or downloaded. Browsers start audio only from a click or a
// key, so call start() from one.
import { clamp, rng } from './util.js';

// Versions of each sound, so a pour never repeats itself; how loud a stone is at full
// strength, and how high it sounds, for each kind of material.
const VARIANTS = 12;
const KINDS = {
  stone: { level: 0.5, pitch: 1 },
  gold: { level: 0.18, pitch: 0.9, metal: true },
  silver: { level: 0.18, pitch: 1.1, metal: true }
};
// At most this many sounds play at once.
const VOICES = 32;

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

// A small piece of material striking a table: its modes, each a frequency (Hz), level, and
// decay time (s), over a short grit of contact low-passed at grit (Hz), opening over rise
// seconds so nothing snaps, and rounded off above round (Hz).
function strike(ctx, seconds, modes, grit, rise, round, R) {
  const rate = ctx.sampleRate, n = Math.ceil(rate * seconds);
  const buffer = ctx.createBuffer(1, n, rate), out = buffer.getChannelData(0);
  for (const [f, level, decay] of modes) {
    const w = (2 * Math.PI * f) / rate, fall = Math.exp(-1 / (decay * rate));
    let env = level;
    for (let i = 0; i < n && env > 1e-4; i++, env *= fall) out[i] += env * Math.sin(w * i);
  }
  const contact = lowpass(grit, 0.7, rate), length = rate * 0.0005;
  for (let i = 0; i < length * 8; i++) out[i] += 0.5 * contact((R() * 2 - 1) * Math.exp(-i / length));
  const soft = lowpass(round, 0.6, rate), open = rate * rise;
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    out[i] = soft(out[i]) * (i < open ? 0.5 - 0.5 * Math.cos((Math.PI * i) / open) : 1) * Math.min(1, (n - i) / (n * 0.2));
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  return buffer;
}

// A small stone on a table: a soft knock of its body and a quieter overtone, both gone within
// a few milliseconds, over the table's own low knock.
function stone(ctx, R) {
  const f = 800 + 450 * R();
  return strike(ctx, 0.05, [[f, 1, 0.005 + 0.003 * R()], [f * (2.2 + 0.4 * R()), 0.12, 0.0025], [300 + 150 * R(), 0.4, 0.008 + 0.004 * R()]], 1800, 0.0007, 2500, R);
}

// A small block of metal on a table: a clear clink of partials out of tune with each other,
// two of them close enough to shimmer, ringing for a fraction of a second over the table.
function metal(ctx, R) {
  const f = 1250 + 400 * R(), ring = 0.08 + 0.05 * R();
  return strike(ctx, 0.4, [[f, 1, ring], [f * 1.012, 0.5, ring], [f * (1.72 + 0.06 * R()), 0.6, ring * 0.7], [f * (2.38 + 0.08 * R()), 0.35, ring * 0.5], [f * (2.95 + 0.1 * R()), 0.18, ring * 0.3], [380 + 120 * R(), 0.25, 0.01]], 4000, 0.0004, 5000, R);
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
    sounds = { stone: Array.from({ length: VARIANTS }, () => stone(ctx, R)), metal: Array.from({ length: VARIANTS }, () => metal(ctx, R)) };
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
        const kind = KINDS[e.material] || KINDS.stone, set = sounds[kind.metal ? 'metal' : 'stone'];
        // Most stones in a pour land softly and a few land hard.
        const loud = kind.level * clamp(e.strength, 0, 1) * (0.25 + 0.75 * vary() ** 2);
        voice(set[Math.floor(vary() * VARIANTS)], kind.pitch * (0.9 + 0.2 * vary()), loud, (e.x * 2 - 1) * 0.5 + (vary() - 0.5) * 0.2, now + (e.delay || 0));
      }
    },
    close() {
      if (!context) ctx?.close();
      ctx = null;
      ends = [];
    }
  };
}
