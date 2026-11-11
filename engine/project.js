// The portable project contract. No browser or rendering dependency.
const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

export function validateProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Project must be an object.');
  const p = { version: 1, seed: 7, ...input };
  if (p.version !== 1) throw new Error(`Unsupported project version: ${p.version}`);
  if (!Array.isArray(p.fps) || p.fps.length !== 2 || p.fps.some(n => !Number.isInteger(n) || n <= 0) || p.fps[0] / p.fps[1] > 240) throw new Error('fps must be [numerator, denominator], at most 240 fps.');
  if (!Number.isSafeInteger(p.frames) || p.frames < 1) throw new Error('frames must be a positive integer.');
  if (!Array.isArray(p.band) || p.band.length !== 2 || p.band.some(n => !Number.isInteger(n) || n < 2 || n > 8192)) throw new Error('band must contain two pixel dimensions from 2 to 8192.');
  if (!Number.isSafeInteger(p.seed)) throw new Error('seed must be an integer.');
  if (!Array.isArray(p.scenes) || !p.scenes.length) throw new Error('Project needs at least one scene.');
  const duration = p.frames * p.fps[1] / p.fps[0];
  const ids = new Set();
  let lastStart = -Infinity;
  for (const s of p.scenes) {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id)) throw new Error('Scene ids must be nonempty and unique.');
    ids.add(s.id);
    if (!s.picture) throw new Error(`${s.id}: picture is required.`);
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start || s.end > duration + 1e-6 || s.start < lastStart) throw new Error(`${s.id}: invalid scene times or ordering.`);
    lastStart = s.start;
    if (s.in && !['laid', 'flow', 'settled'].includes(s.in.type)) throw new Error(`${s.id}: unknown entry type.`);
    if (s.in?.type === 'flow' && (!Array.isArray(s.in.launch) || !Array.isArray(s.in.land))) throw new Error(`${s.id}: flow requires launch and land intervals.`);
    if (s.in?.rise !== undefined && !(Array.isArray(s.in.rise) && s.in.rise.length === 3 && s.in.rise.every(Number.isFinite) && s.in.rise[0] < s.in.rise[1] && s.in.rise[2] >= 0)) throw new Error(`${s.id}: rise must be [from, to, millimetres].`);
    if (s.in?.arc !== undefined && !(Number.isFinite(s.in.arc) && s.in.arc >= 0)) throw new Error(`${s.id}: arc must be a number from 0.`);
    if (s.in?.settle !== undefined && !(Array.isArray(s.in.settle) && s.in.settle.length === 2 && s.in.settle.every(Number.isFinite) && s.in.settle[0] < s.in.settle[1])) throw new Error(`${s.id}: settle must be [from, to].`);
    if (s.in?.focus !== undefined && !(isPoint(s.in.focus) || (Array.isArray(s.in.focus) && s.in.focus.length > 0 && s.in.focus.every(isPoint)))) throw new Error(`${s.id}: focus must be [x, y], or a list of them.`);
    for (const key of ['reach', 'columns']) {
      if (s.in?.[key] !== undefined && !(Number.isFinite(s.in[key]) && s.in[key] > 0)) throw new Error(`${s.id}: ${key} must be a length in millimetres.`);
    }
    if (s.at !== undefined && (!Array.isArray(s.at) || s.at.length !== 2 || !s.at.every(Number.isFinite))) throw new Error(`${s.id}: at must be [x, y] in millimetres.`);
    if (s.in?.music !== undefined && typeof s.in.music !== 'boolean') throw new Error(`${s.id}: music must be true or false.`);
    if (s.front !== undefined && typeof s.front !== 'boolean') throw new Error(`${s.id}: front must be true or false.`);
  }
  if (p.scenes[0].start !== 0) throw new Error('The first scene must start at zero.');
  if (p.music !== undefined) {
    const m = p.music;
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('music must be an object.');
    if (typeof m.src !== 'string' || !m.src) throw new Error('music needs src, the path of its track.');
    if (m.at !== undefined && !(Number.isFinite(m.at) && m.at >= 0)) throw new Error('music: at must be the seconds into the film at which the track starts.');
    if (m.onsets !== undefined && !(Array.isArray(m.onsets) && m.onsets.every((o, i) => isPoint(o) && o[0] >= 0 && o[1] >= 0 && o[1] <= 1 && (!i || o[0] >= m.onsets[i - 1][0])))) throw new Error('music: onsets must be [seconds, strength from 0 to 1] pairs in order.');
    if (m.steady !== undefined && !(Number.isFinite(m.steady) && m.steady >= 0 && m.steady <= 1)) throw new Error('music: steady must be a share from 0 to 1.');
    if (m.ring !== undefined && !(Number.isFinite(m.ring) && m.ring > 0)) throw new Error('music: ring must be a time in seconds.');
    if (m.contrast !== undefined && !(Number.isFinite(m.contrast) && m.contrast >= 0 && m.contrast <= 8)) throw new Error('music: contrast must be a number from 0 to 8.');
    if (m.kick !== undefined && !(Number.isFinite(m.kick) && m.kick >= 0 && m.kick <= 0.3)) throw new Error('music: kick must be a share of the view from 0 to 0.3.');
    for (const key of ['gain', 'stones']) {
      if (m[key] !== undefined && !(Number.isFinite(m[key]) && m[key] >= 0 && m[key] <= 4)) throw new Error(`music: ${key} must be a level from 0 to 4.`);
    }
  }
  return p;
}

export async function readProject(source, baseURL = globalThis.location?.href) {
  if (typeof source !== 'string' && !(source instanceof URL)) return { table: validateProject(source), baseURL };
  const url = new URL(source, baseURL);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load project: HTTP ${response.status}`);
  return { table: validateProject(await response.json()), baseURL: url.href };
}
