// Capitals drawn as shapes, for words set in stone: a flared Roman sans, after the letters
// of classical inscriptions, drawn here rather than taken from a typeface so a word is cut
// the same everywhere. Each letter is drawn one cap high, with its top on the cap line, and
// only the letters a picture needs are here so far.
import { poly, ribbon, smoothLine } from "../engine/paint.js";

// As shares of the cap height: the thick strokes and the thin, how far a straight stem
// narrows at its middle, and how far round letters reach past the cap and base lines.
const THICK = 0.19;
const THIN = 0.14;
const WAIST = 0.012;
const OVER = 0.015;

// Where two lines meet, each given by two points.
function cross([a, b], [c, d]) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / (r[0] * s[1] - r[1] * s[0]);
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

// A line moved across by `w`, measured level.
const along = ([[x0, y0], [x1, y1]], w) => [[x0 + w, y0], [x1 + w, y1]];

// An oval a little squarer than an ellipse, as the round letters of a Roman sans are, from
// angle a0 to a1 (radians, clockwise from the right), backwards if `back`.
function oval(cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, back = false) {
  const n = 2.25, steps = 72, pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = back ? a1 - ((a1 - a0) * i) / steps : a0 + ((a1 - a0) * i) / steps;
    const c = Math.cos(a), s = Math.sin(a);
    pts.push([cx + rx * Math.sign(c) * Math.abs(c) ** (2 / n), cy + ry * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return pts;
}

// Each letter: its width, the space it keeps either side, and how it is drawn, with `at`
// placing a point given in cap heights.
const LETTERS = {
  A: {
    width: 0.86, side: [-0.01, -0.01],
    draw(p, at) {
      // Two legs from a narrow flat apex, the left thin and the right thick, joined by a
      // bar, with the counter above the bar cut out.
      const l = THIN * Math.hypot(1, 0.4), r = THICK * Math.hypot(1, 0.4);
      const inL = (y) => 0.4 + l - 0.4 * y, inR = (y) => 0.46 - r + 0.4 * y;
      const top = 0.63, foot = 0.75, apex = (0.4 + l - (0.46 - r)) / 0.8;
      p.addPath(poly([at(0.4, 0), at(0.46, 0), at(0.86, 1), at(0.86 - r, 1), at(inR(foot), foot), at(inL(foot), foot), at(l, 1), at(0, 1)]));
      p.addPath(poly([at(inL(apex), apex), at(inL(top), top), at(inR(top), top)]));
    }
  },
  C: {
    width: 0.84, side: [0.035, 0],
    draw(p, at) {
      // An open oval, thick at its side and thin at top and foot, its ends cut toward its centre.
      const [cx, cy] = at(0.42, 0.5), s = at(1, 1)[0] - at(0, 1)[0], open = 0.72;
      const rx = 0.42 * s, ry = (0.5 + OVER) * s;
      p.addPath(poly([...oval(cx, cy, rx, ry, open, Math.PI * 2 - open), ...oval(cx, cy, rx - 0.2 * s, ry - 0.13 * s, open, Math.PI * 2 - open, true)]));
    }
  },
  I: {
    width: THICK, side: [0.06, 0.06],
    draw(p, at, stem) { stem(0, THICK); }
  },
  M: {
    width: 1.04, side: [0.03, 0.03],
    draw(p, at) {
      // Splayed legs, thin on the left and nearly as thick as a stem on the right, and a
      // thick and a thin diagonal meeting in a narrow foot on the base line, drawn as one
      // outline with its counters where the strokes' edges cross.
      const legL = [[0.06, 0], [0, 1]], legR = [[0.98, 0], [1.04, 1]];
      const diagL = [[0.06, 0], [0.49, 1]], diagR = [[0.98, 0], [0.55, 1]];
      const l = THIN * Math.hypot(1, 0.06), r = 0.95 * THICK * Math.hypot(1, 0.06);
      const d1 = THICK * Math.hypot(1, 0.43), d2 = THIN * Math.hypot(1, 0.43);
      const inL = along(legL, l), inR = along(legR, -r), topL = along(diagL, d1), topR = along(diagR, -d2);
      p.addPath(poly([
        [0.06, 0], [0.06 + d1, 0], cross(topL, topR), [0.98 - d2, 0], [0.98, 0], [1.04, 1], [1.04 - r, 1],
        cross(inR, diagR), [0.55, 1], [0.49, 1], cross(diagL, inL), [l, 1], [0, 1]
      ].map(([u, v]) => at(u, v))));
    }
  },
  O: {
    width: 0.94, side: [0.035, 0.035],
    draw(p, at) {
      // An oval ring, thick at its sides and thin at top and foot.
      const [cx, cy] = at(0.47, 0.5), s = at(1, 1)[0] - at(0, 1)[0];
      const rx = 0.47 * s, ry = (0.5 + OVER) * s;
      p.addPath(poly(oval(cx, cy, rx, ry)));
      p.addPath(poly(oval(cx, cy, rx - 0.205 * s, ry - 0.13 * s, 0, Math.PI * 2, true)));
    }
  },
  S: {
    width: 0.66, side: [0.04, 0.04],
    draw(p, at) {
      // A spine from the upper terminal round the top bowl, down across the middle, and
      // round the lower bowl, thickest where it crosses and thin at its ends.
      const spine = [[0.555, 0.12], [0.48, 0.065], [0.37, 0.04], [0.26, 0.045], [0.155, 0.085], [0.095, 0.16], [0.098, 0.245], [0.15, 0.325], [0.25, 0.4], [0.36, 0.465], [0.46, 0.535], [0.535, 0.62], [0.565, 0.715], [0.545, 0.81], [0.475, 0.895], [0.365, 0.95], [0.24, 0.955], [0.125, 0.925], [0.04, 0.875]];
      const widths = [0.12, 0.12, 0.125, 0.13, 0.15, 0.17, 0.175, 0.18, 0.19, 0.195, 0.195, 0.19, 0.185, 0.18, 0.16, 0.135, 0.125, 0.12, 0.12];
      const steps = 8, line = smoothLine(spine.map(([x, y]) => at(x, y)), steps), s = at(1, 1)[0] - at(0, 1)[0];
      p.addPath(ribbon(line, line.map((_, j) => {
        const i = Math.min(widths.length - 2, Math.floor(j / steps)), t = j / steps - i;
        return (widths[i] + (widths[i + 1] - widths[i]) * t) * s;
      })));
    }
  }
};

// The letters of a word in cap heights: where each starts, and the whole width, with
// `tracking` added between letters.
function measure(text, tracking) {
  let x = 0;
  const places = [...text].map((ch, i) => {
    const L = LETTERS[ch];
    if (!L) throw new Error(`No drawn letter ${ch}.`);
    x += (i ? tracking : 0) + L.side[0];
    const at = x;
    x += L.width + L.side[1];
    return { ch, at };
  });
  return { places, width: x };
}

// How wide a word is, in cap heights.
export const wordWidth = (text, tracking = 0.07) => measure(text, tracking).width;

// A word as one path per letter, centred on x with its base line at y, cap high, or as wide
// as `width` if that is narrower.
export function word(text, { x, y, cap, width, tracking = 0.07 }) {
  const m = measure(text, tracking);
  const size = Math.min(cap, width ? width / m.width : cap);
  const left = x - (m.width * size) / 2, top = y - size;
  return m.places.map(({ ch, at }) => {
    const p = new Path2D();
    const point = (u, v) => [left + (at + u) * size, top + v * size];
    const stem = (u, w) => {
      const [x0, y0] = point(u, 0), [x1, y1] = point(u + w, 1);
      const q = new Path2D();
      q.moveTo(x0, y0);
      q.lineTo(x1, y0);
      q.quadraticCurveTo(x1 - 2 * WAIST * size, (y0 + y1) / 2, x1, y1);
      q.lineTo(x0, y1);
      q.quadraticCurveTo(x0 + 2 * WAIST * size, (y0 + y1) / 2, x0, y0);
      q.closePath();
      p.addPath(q);
    };
    LETTERS[ch].draw(p, point, stem);
    return { letter: ch, path: p, size };
  });
}
