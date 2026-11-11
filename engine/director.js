// The director: a camera that follows the laying of a picture as an operator would, from the
// stones' own schedule. It works in shots. In each one it frames the place where most of the
// stones are landing, as closely as still holds them, and drifts with them as they move on;
// between shots it moves quickly to the next place, arriving on a strong onset of the film's
// music when there is one; and once the last stone is laid it pulls back to show the whole
// picture. It returns camera keys, so a directed camera is an ordinary one: a function of
// time, the same in every frame, seek and export.

// A shot lasts from SHORT to LONG seconds, and a move between shots takes MOVE seconds. A
// frame holds at least HOLD of the stones landing in its shot, and is never narrower than
// CLOSE of the panel. The camera sets out for the whole picture REST seconds after the last
// stone, and takes REVEAL seconds to get there.
const SHORT = 2.4;
const LONG = 5.5;
const MOVE = 0.7;
const HOLD = 0.72;
const CLOSE = 0.26;
const REST = 0.15;
const REVEAL = 1.6;
// The frames a director chooses from, as shares of the widest view, and the grid the landing
// stones are counted on.
const WIDTHS = [CLOSE, 0.34, 0.44, 0.56, 0.72, 1];
const GRID = 96;

// stones: the stones being laid, each with x and y in panel millimetres and its landing time T;
// panel: the panel's w and h in millimetres; aspect: the film's; end: when the scene ends;
// onsets: the film's music as [seconds, strength] pairs on the film's clock, or none.
// Returns keys of [time, centre x, centre y, visible width].
export function direct(stones, { panel, aspect, end, onsets = [] }) {
  const widest = Math.round((Math.min(panel.w, panel.h * aspect) / 1.04) * 10) / 10, whole = [panel.w / 2, panel.h / 2, widest];
  if (!stones.length) return [[0, ...whole], [end, ...whole]];
  let first = Infinity, last = -Infinity;
  for (const s of stones) { first = Math.min(first, s.T); last = Math.max(last, s.T); }
  const nx = GRID, ny = Math.max(1, Math.round((GRID * panel.h) / panel.w)), cw = panel.w / nx, ch = panel.h / ny;

  // The closest frame that holds HOLD of the stones landing from a to b, placed to hold the
  // most of them, or the last frame if none land then.
  function frame(a, b, fallback) {
    const sum = new Float64Array((nx + 1) * (ny + 1));
    let all = 0;
    for (const s of stones) {
      if (s.T < a || s.T >= b) continue;
      const i = Math.min(nx - 1, Math.max(0, Math.floor(s.x / cw))), j = Math.min(ny - 1, Math.max(0, Math.floor(s.y / ch)));
      sum[(j + 1) * (nx + 1) + i + 1]++;
      all++;
    }
    if (!all) return fallback;
    for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) sum[j * (nx + 1) + i] += sum[j * (nx + 1) + i - 1] + sum[(j - 1) * (nx + 1) + i] - sum[(j - 1) * (nx + 1) + i - 1];
    const inside = (i0, j0, i1, j1) => sum[j1 * (nx + 1) + i1] - sum[j0 * (nx + 1) + i1] - sum[j1 * (nx + 1) + i0] + sum[j0 * (nx + 1) + i0];
    for (const share of WIDTHS) {
      const w = widest * share, h = w / aspect;
      // The stones sit within the frame's middle, clear of its edges.
      const gw = Math.max(1, Math.min(nx, Math.round((w * 0.84) / cw))), gh = Math.max(1, Math.min(ny, Math.round((h * 0.84) / ch)));
      let best = -1, at = null;
      for (let j = 0; j + gh <= ny; j++) {
        for (let i = 0; i + gw <= nx; i++) {
          const held = inside(i, j, i + gw, j + gh);
          if (held > best) { best = held; at = [i, j]; }
        }
      }
      if (best >= HOLD * all || share === 1) {
        // Among the places that hold as many, the middle one: the frame is centred on its stones.
        let x = 0, y = 0, n = 0;
        for (let j = 0; j + gh <= ny; j++) for (let i = 0; i + gw <= nx; i++) if (inside(i, j, i + gw, j + gh) >= best * 0.985) { x += i; y += j; n++; }
        return [(x / n + gw / 2) * cw, (y / n + gh / 2) * ch, w];
      }
    }
    return fallback;
  }

  // The shots: each ends on the strongest onset that falls where a shot may end, or, with no
  // music there, after a middling while.
  const cuts = [first];
  while (last - cuts.at(-1) > LONG) {
    const from = cuts.at(-1) + SHORT, to = Math.min(cuts.at(-1) + LONG, last - SHORT);
    if (to <= from) break;
    let cut = null;
    for (const [at, strength] of onsets) if (at >= from && at <= to && (!cut || strength > cut[1])) cut = [at, strength];
    cuts.push(cut ? cut[0] : (from + to) / 2);
  }
  cuts.push(last);

  // Each shot opens on where its first stones land and closes on where its last ones do, and
  // the camera reaches the next shot as it begins.
  const keys = [];
  let held = whole;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k], b = cuts[k + 1], mid = (a + b) / 2, span = (b - a) * 0.3;
    const open = frame(a, mid + span / 2, held), close = frame(mid - span / 2, b, open);
    // The shot keeps one width, that of its wider half, so it drifts and does not pump.
    const w = Math.max(open[2], close[2]);
    if (!k && a > 0.05) keys.push([0, open[0], open[1], w]);
    keys.push([a, open[0], open[1], w]);
    keys.push([Math.max(a + (b - a) * 0.5, b - (k + 2 < cuts.length ? MOVE : 0)), close[0], close[1], w]);
    held = close;
  }
  const rest = Math.min(last + REST, end), shown = Math.min(rest + REVEAL, end);
  if (rest > keys.at(-1)[0] + 1e-3) keys.push([rest, ...keys.at(-1).slice(1)]);
  if (shown > keys.at(-1)[0] + 1e-3) keys.push([shown, ...whole]);
  if (end > keys.at(-1)[0] + 1e-3) keys.push([end, ...whole]);
  return keys.map(([t, x, y, w]) => [Math.round(t * 1000) / 1000, Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(w * 10) / 10]);
}

// ---------------------------------------------------------------------------
// A finished picture has nothing landing to follow, so the director looks for its subjects:
// the places that stand out from the rest of the panel.
// ---------------------------------------------------------------------------

// A subject is looked for in frames of LOOKS of the widest view; its shot then takes in the
// whole of what stands out there, up to GROWN of the widest view, and gives it FILL of the frame. A place counts as a subject
// while it stands out at least WORTH as much as the first, and a picture has at most MOST.
const LOOKS = [0.2, 0.28, 0.38, 0.5, 0.64];
const FILL = 0.7;
const GROWN = 0.6;
const GROUND = 0.15;
const WORTH = 0.1;
const MOST = 5;

// stones: a picture's stones, each with x and y in panel millimetres, its area in square
// millimetres, its linear colour `lin`, a `glow` from 0 to 1 for gold and lit glass, and the
// name of its region. Returns the subjects, the most striking first, each as the frame that
// shows it: [centre x, centre y, visible width].
export function subjectsOf(stones, { panel, aspect }) {
  const widest = Math.round((Math.min(panel.w, panel.h * aspect) / 1.04) * 10) / 10;
  if (stones.length < 8) return [];
  // A stone stands out by how far its colour is from the panel's own and how little of the
  // panel shares that colour, by its glow, by how little of the panel its region covers, and by
  // how much of a body its region is: the heron more than the sea it stands in, and the moon
  // more than the glints scattered on the water.
  const mean = [0, 0, 0], regions = new Map(), shades = new Map();
  const shade = (s) => Math.round(Math.cbrt(s.lin[0]) * 8) * 10000 + Math.round(Math.cbrt(s.lin[1]) * 8) * 100 + Math.round(Math.cbrt(s.lin[2]) * 8);
  let area = 0;
  for (const s of stones) {
    for (let c = 0; c < 3; c++) mean[c] += Math.cbrt(s.lin[c]) * s.area;
    if (!regions.has(s.region)) regions.set(s.region, { area: 0, xs: [], ys: [] });
    const r = regions.get(s.region);
    r.area += s.area; r.xs.push(s.x); r.ys.push(s.y);
    shades.set(shade(s), (shades.get(shade(s)) || 0) + s.area);
    area += s.area;
  }
  for (let c = 0; c < 3; c++) mean[c] /= area;
  for (const r of regions.values()) {
    // A body fills the box around the middle nine tenths of its stones, and the box is not a
    // thin strip; scattered marks and long bands do neither.
    r.xs.sort((a, b) => a - b); r.ys.sort((a, b) => a - b);
    const n = r.xs.length, lo = Math.floor(n * 0.05), hi = Math.min(n - 1, Math.ceil(n * 0.95));
    const w = Math.max(r.xs[hi] - r.xs[lo], Math.sqrt(r.area)), h = Math.max(r.ys[hi] - r.ys[lo], Math.sqrt(r.area));
    r.body = Math.sqrt(Math.min(1, (0.9 * r.area) / (w * h)) * Math.sqrt(Math.min(w, h) / Math.max(w, h)));
    // A region that covers more than GROUND of the panel is ground, not a subject.
    r.rare = Math.max(0, 1 - r.area / area / GROUND) ** 2;
  }
  const nx = GRID, ny = Math.max(1, Math.round((GRID * panel.h) / panel.w)), cw = panel.w / nx, ch = panel.h / ny;
  const out = new Float64Array(nx * ny);
  for (const s of stones) {
    const away = Math.hypot(Math.cbrt(s.lin[0]) - mean[0], Math.cbrt(s.lin[1]) - mean[1], Math.cbrt(s.lin[2]) - mean[2]);
    const r = regions.get(s.region);
    const i = Math.min(nx - 1, Math.max(0, Math.floor(s.x / cw))), j = Math.min(ny - 1, Math.max(0, Math.floor(s.y / ch)));
    // A colour that a tenth of the panel shares stands out a third as much as one found nowhere else.
    const few = Math.exp(-shades.get(shade(s)) / area / 0.09);
    out[j * nx + i] += s.area * (0.3 + away + 0.35 * (s.glow || 0)) * few * r.rare * r.body;
  }
  const subjects = [];
  let worth = 0;
  while (subjects.length < MOST) {
    const sum = new Float64Array((nx + 1) * (ny + 1));
    for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) sum[j * (nx + 1) + i] = out[(j - 1) * nx + i - 1] + sum[j * (nx + 1) + i - 1] + sum[(j - 1) * (nx + 1) + i] - sum[(j - 1) * (nx + 1) + i - 1];
    // The director looks at several sizes of frame and takes the one that holds the most for
    // its width: a small subject is found by a small frame, and a tall one by a frame that
    // has room for all of it.
    let best = 0, at = null, gw = 0, gh = 0;
    for (const look of LOOKS) {
      const w = Math.max(1, Math.min(nx, Math.round((widest * look) / cw))), h = Math.max(1, Math.min(ny, Math.round((widest * look) / aspect / ch)));
      for (let j = 0; j + h <= ny; j++) {
        for (let i = 0; i + w <= nx; i++) {
          const held = (sum[(j + h) * (nx + 1) + i + w] - sum[j * (nx + 1) + i + w] - sum[(j + h) * (nx + 1) + i] + sum[j * (nx + 1) + i]) / look;
          if (held > best) { best = held; at = [i, j]; gw = w; gh = h; }
        }
      }
    }
    if (!at || best < worth * WORTH) break;
    if (!subjects.length) worth = best;
    // The frame grows to take in the whole of what stands out there, a row or a column at a
    // time, for as long as the next one stands out at least an eighth as much as what it holds,
    // and up to GROWN of the widest view: the heron's head with its body.
    let [i0, j0] = at, i1 = i0 + gw, j1 = j0 + gh;
    const held = (a, b, c, d) => sum[d * (nx + 1) + c] - sum[b * (nx + 1) + c] - sum[d * (nx + 1) + a] + sum[b * (nx + 1) + a];
    const limit = [Math.round((widest * GROWN) / cw), Math.round((widest * GROWN) / aspect / ch)];
    for (let grew = true; grew;) {
      grew = false;
      const dense = held(i0, j0, i1, j1) / ((i1 - i0) * (j1 - j0));
      const sides = [
        [i0 > 0 && i1 - i0 < limit[0], () => held(i0 - 1, j0, i0, j1) / (j1 - j0), () => i0--],
        [i1 < nx && i1 - i0 < limit[0], () => held(i1, j0, i1 + 1, j1) / (j1 - j0), () => i1++],
        [j0 > 0 && j1 - j0 < limit[1], () => held(i0, j0 - 1, i1, j0) / (i1 - i0), () => j0--],
        [j1 < ny && j1 - j0 < limit[1], () => held(i0, j1, i1, j1 + 1) / (i1 - i0), () => j1++]
      ];
      for (const [may, strip, grow] of sides) if (may && strip() >= dense / 8) { grow(); grew = true; }
    }
    // Then it is drawn in around the middle 92% of it each way, and the subject is given FILL of the frame.
    const span = (from, to, strip) => {
      let all = 0;
      for (let k = from; k < to; k++) all += strip(k);
      let lo = from, hi = to - 1, run = 0;
      for (run = 0; lo < hi && run + strip(lo) < all * 0.04; lo++) run += strip(lo);
      for (run = 0; hi > lo && run + strip(hi) < all * 0.04; hi--) run += strip(hi);
      return [lo, hi + 1];
    };
    const [x0, x1] = span(i0, i1, (i) => held(i, j0, i + 1, j1)), [y0, y1] = span(j0, j1, (j) => held(i0, j, i1, j + 1));
    const w = Math.min(widest, Math.max(widest * CLOSE, ((x1 - x0) * cw) / FILL, ((y1 - y0) * ch * aspect) / FILL));
    subjects.push([Math.round(((x0 + x1) / 2) * cw * 10) / 10, Math.round(((y0 + y1) / 2) * ch * 10) / 10, Math.round(w * 10) / 10]);
    at = [i0, j0]; gw = i1 - i0; gh = j1 - j0;
    // What has been shown is not shown again.
    for (let j = Math.max(0, at[1] - 1); j < Math.min(ny, at[1] + gh + 1); j++) for (let i = Math.max(0, at[0] - 1); i < Math.min(nx, at[0] + gw + 1); i++) out[j * nx + i] = 0;
  }
  return subjects;
}

// A tour of a finished picture, from `from` to `until` seconds: close shots of its subjects in
// turn, the most striking kept for last, each pushed in on slowly, and then the whole picture.
// open: 'whole' starts on the whole picture, as after a flow has landed or a laying is done,
// and 'close' starts on the first subject, as a film of a finished picture does. A shot lasts
// from 2.6 to 6 seconds and changes on a strong onset of the film's music when one is near.
// Returns camera keys, the first at time zero.
export function tour(subjects, { panel, aspect, from = 0, until, open = 'close', onsets = [] }) {
  const widest = Math.round((Math.min(panel.w, panel.h * aspect) / 1.04) * 10) / 10, whole = [panel.w / 2, panel.h / 2, widest];
  const lead = open === 'whole' ? 0.5 : 0, travel = 1.1, least = 2.6, most = 6, rest = 1.2;
  const room = until - from - lead - REVEAL - rest;
  // Only a subject seen closer than the whole is worth a shot, and only as many as there is time for.
  const shown = subjects.filter((s) => s[2] < widest * 0.8).slice(0, Math.max(0, Math.floor(room / least))).reverse();
  const keys = [];
  if (!shown.length) {
    // With no time for a shot, or nothing that stands out, the picture is simply looked at:
    // from a little closer to the whole, around its most striking place if it has one.
    const toward = subjects[0] || whole, k = until - from >= 2 ? 0.88 : 1;
    keys.push([from, whole[0] + (toward[0] - whole[0]) * (1 - k), whole[1] + (toward[1] - whole[1]) * (1 - k), widest * (open === 'whole' ? 1 : k)], [until, ...whole]);
  } else {
    const each = Math.min(most, room / shown.length);
    let t = from + lead;
    if (lead) keys.push([from, ...whole]);
    shown.forEach(([x, y, w], k) => {
      let end = t + each;
      // The shot ends on the strongest onset within three quarters of a second of its time.
      let cut = null;
      for (const [at, strength] of onsets) if (Math.abs(at - end) <= 0.75 && at - t >= least && (!cut || strength > cut[1])) cut = [at, strength];
      if (cut) end = cut[0];
      // It opens a little wide and pushes in for as long as it is held. Coming from the whole
      // picture or from another subject, the camera travels for the first part of the shot.
      const arrive = t + (k || lead ? travel : 0);
      keys.push([arrive, x, y, Math.min(widest, w * 1.12)], [end, x, y, w]);
      t = end;
    });
    keys.push([t + REVEAL, ...whole]);
    if (until > t + REVEAL + 1e-3) keys.push([until, ...whole]);
  }
  if (keys[0][0] > 1e-3) keys.unshift([0, ...keys[0].slice(1)]);
  return keys.map(([at, x, y, w]) => [Math.round(at * 1000) / 1000, Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(w * 10) / 10]);
}
