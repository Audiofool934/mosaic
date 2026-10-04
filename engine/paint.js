// Path helpers for the code drawings. Units are whatever the canvas transform says,
// which for a picture is millimetres on its panel.
import { lerp } from "./util.js";

export function capsule(ax, ay, ar, bx, by, br) {
  const p = new Path2D();
  const a = Math.atan2(by - ay, bx - ax);
  p.arc(ax, ay, ar, a + Math.PI / 2, a - Math.PI / 2 + Math.PI * 2, false);
  p.arc(bx, by, br, a - Math.PI / 2, a + Math.PI / 2, false);
  p.closePath();
  return p;
}

export function poly(points, close) {
  const p = new Path2D();
  p.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) p.lineTo(points[i][0], points[i][1]);
  if (close !== false) p.closePath();
  return p;
}

export function circle(x, y, r) {
  const p = new Path2D();
  p.arc(x, y, r, 0, Math.PI * 2);
  return p;
}

export function ellipse(x, y, rx, ry, rot) {
  const p = new Path2D();
  p.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
  return p;
}

export function ring(x, y, r0, r1) {
  const p = new Path2D();
  p.arc(x, y, r1, 0, Math.PI * 2);
  p.arc(x, y, r0, Math.PI * 2, 0, true);
  return p;
}

// Closed Catmull-Rom curve through points.
export function blob(points) {
  const p = new Path2D();
  const n = points.length;
  p.moveTo(points[0][0], points[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    p.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]
    );
  }
  p.closePath();
  return p;
}

// Open Catmull-Rom centreline sampled into a polyline.
export function smoothLine(points, steps) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  out.push(points[n - 1]);
  return out;
}

// A centreline with a width per point, as a filled ribbon.
export function ribbon(points, widths) {
  const left = [];
  const right = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const w = (typeof widths === "number" ? widths : widths[i]) / 2;
    left.push([points[i][0] - ty * w, points[i][1] + tx * w]);
    right.push([points[i][0] + ty * w, points[i][1] - tx * w]);
  }
  return poly(left.concat(right.reverse()));
}

// A smooth stroke through control points with tapering width.
export function stroke(points, w0, w1, steps) {
  const line = smoothLine(points, steps || 10);
  const widths = line.map((_, i) => lerp(w0, w1 === undefined ? w0 : w1, i / Math.max(1, line.length - 1)));
  return ribbon(line, widths);
}
