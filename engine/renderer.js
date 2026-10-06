// WebGL2: bevelled stones as one merged mesh per layer, reading their data from a
// float texture; a key light with shadows, a fill, and up to four point lights;
// a procedural lime bed with the sinopia drawn on it; four jittered subframes of
// motion blur; thin-lens depth of field; AgX. Grown from piece/odyssey-lantern.
import { clamp, halton, invert, lookAt, mat4Mul, ortho, perspective, v3norm, xform } from "./util.js";

// Per stone, ten RGBA32F texels:
//   A: x, y (world, m), T (seat time), seed
//   B: corner 0 xy, corner 1 xy (world-oriented, relative to the centre, m)
//   C: corner 2 xy, corner 3 xy
//   D: linear rgb, material
//   E: thickness, bevel, tilt x, tilt y
//   F: emission, seated lift, drop height, fall duration
//   G: U (lift-off time), exit angle, exit speed, entry angle (>= 100 drops straight down)
//   H: flight source x, y (world, m), launch time (before T: the stone flies in from the source), turn at launch
//   I: source linear rgb, source emission
//   J: ignition time, extinction time, glint amplitude, flags * 10 + exit duration
export const TEXELS = 10;
export const PER_ROW = 256;
export const FLAG_TYPE = 1;
export const POINTS = 4;
// The pointer's recent path: TRAIL samples, TRAIL_STEP seconds apart, newest first,
// long enough for the slowest stone's spring to come to rest.
export const TRAIL = 24;
export const TRAIL_STEP = 0.025;
// Each stone's spring under the pointer: natural frequency (rad/s), damping ratio, and
// how far each stone's own frequency strays from it.
const SPRING = { omega: 16, zeta: 0.55, spread: 0.15 };

const GLSL_COMMON = `
// Hash without Sine: David Hoskins, via David A Roberts MIT port.
// https://gist.github.com/davidar/5f9677a0ccfbd63d7a8657ad9af3a856
// See THIRD_PARTY_NOTICES.md.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 noised(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  // Interpolate each horizontal pair, then vertically. Differentiate those
  // two linear interpolations with the cubic easing chain rule.
  float lower = mix(a, b, u.x);
  float upper = mix(c, d, u.x);
  float dx = mix(b - a, d - c, u.y) * du.x;
  float dy = (upper - lower) * du.y;
  return vec3(mix(lower, upper, u.y), dx, dy);
}
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * noised(p).x;
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}
const float PI = 3.14159265;
uniform vec3 uEye;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uFillDir;
uniform vec3 uFillCol;
uniform vec4 uPt[${POINTS}];
uniform vec3 uPtCol[${POINTS}];
// A lamp held over the wall: its position and power, and its colour and the cosine of its
// cone's half angle. It is off while its power is zero.
uniform vec4 uLamp;
uniform vec4 uLampCol;
uniform vec3 uSky;
uniform vec3 uGround;
uniform highp sampler2DShadow uKeySh;
uniform mat4 uKeyM;
uniform vec2 uKeyTx;
uniform float uSpin;
const vec2 PD[4] = vec2[4](vec2(0.33, 0.33), vec2(-0.86, 0.42), vec2(0.42, -0.86), vec2(-0.18, -0.18));
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float pcf(highp sampler2DShadow sm, vec3 s, float r) {
  float a = (ign(gl_FragCoord.xy) + uSpin) * 6.2832;
  mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
  float acc = 0.0;
  for (int i = 0; i < 4; i++) acc += texture(sm, vec3(s.xy + rot * PD[i] * r, s.z));
  return acc * 0.25;
}
float shadowKey(vec3 P, vec3 N) {
  vec4 q = uKeyM * vec4(P + N * uKeyTx.y, 1.0);
  vec3 s = q.xyz * 0.5 + 0.5;
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  return pcf(uKeySh, s - vec3(0.0, 0.0, 0.0004), uKeyTx.x);
}
vec3 brdf(vec3 N, vec3 V, vec3 L, vec3 albedo, float metal, float rough, vec3 F0, float wrap) {
  vec3 H = normalize(L + V);
  float NdLr = dot(N, L);
  float NdL = max(NdLr, 0.0);
  float NdV = max(dot(N, V), 1e-3);
  float NdH = max(dot(N, H), 0.0);
  float VdH = max(dot(V, H), 0.0);
  float a = rough * rough;
  float a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
  vec3 spec = D * G * F / max(4.0 * NdL * NdV, 1e-4);
  float diffL = max((NdLr + wrap) / (1.0 + wrap), 0.0);
  vec3 diff = (1.0 - F) * (1.0 - metal) * albedo / PI * diffL;
  return diff + spec * NdL;
}
vec3 shade(vec3 P, vec3 N, vec3 V, vec3 albedo, float metal, float rough, vec3 F0, float ao, float wrap, float sideAo) {
  vec3 col = vec3(0.0);
  float hemi = N.z * 0.5 + 0.5;
  col += (1.0 - metal) * albedo * mix(uGround, uSky, hemi) * ao;
  vec3 R = reflect(-V, N);
  float gloss = 1.0 - rough;
  vec3 env = mix(uGround * 0.6, uSky * 1.25, smoothstep(-0.25, 0.9, R.z));
  env += uKeyCol * 0.5 * pow(max(dot(R, uKeyDir), 0.0), mix(6.0, 90.0, gloss * gloss));
  env += uFillCol * 0.35 * pow(max(dot(R, uFillDir), 0.0), mix(4.0, 40.0, gloss * gloss));
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 Fe = F0 + (max(vec3(gloss), F0) - F0) * fres;
  col += env * Fe * ao * sideAo;
  float sk = shadowKey(P, N);
  col += brdf(N, V, uKeyDir, albedo, metal, rough, F0, wrap) * uKeyCol * sk * sideAo;
  col += brdf(N, V, uFillDir, albedo, metal, min(rough + 0.15, 1.0), F0, wrap + 0.3) * uFillCol * ao * sideAo;
  // Fire, lamps, and the eye: point lights that rake the stones, with the soft bounce
  // they throw around a dark room.
  for (int i = 0; i < ${POINTS}; i++) {
    if (uPt[i].w <= 0.0) continue;
    vec3 Lv = uPt[i].xyz - P;
    float d2 = dot(Lv, Lv);
    vec3 L = Lv * inversesqrt(d2);
    vec3 c = uPtCol[i] * uPt[i].w;
    col += brdf(N, V, L, albedo, metal, clamp(rough + 0.012 / sqrt(d2), 0.0, 1.0), F0, wrap) * c / (d2 + 0.0006) * sideAo;
    col += (1.0 - metal) * albedo * c * (0.11 / (d2 + 0.005)) * (0.6 + 0.4 * hemi) * ao * sideAo;
  }
  // The lamp shines straight down in a cone with a soft edge, and polished stones mirror it.
  if (uLamp.w > 0.0) {
    vec3 Lv = uLamp.xyz - P;
    float d2 = dot(Lv, Lv);
    vec3 L = Lv * inversesqrt(d2);
    float cone = smoothstep(uLampCol.w, mix(uLampCol.w, 1.0, 0.55), L.z);
    vec3 c = uLampCol.rgb * uLamp.w * cone;
    col += brdf(N, V, L, albedo, metal, rough, F0, wrap) * c / (d2 + 0.0006) * sideAo;
    col += (1.0 - metal) * albedo * c * (0.05 / (d2 + 0.005)) * ao * sideAo;
  }
  return col;
}
`;

// The pointer's recent path, as the stones answer it. The stones and the mortar under them
// read the same motion.
const POINTER_CURL = `
// Cull centre xy and cull radius of the trail, and the curl radius (m); no input culls everything.
uniform vec4 uPointer;
// Wall xy and strength of each trail sample (k + 0.5) * TRAIL_STEP seconds ago.
uniform vec4 uTrail[${TRAIL}];
// How the pointer's recent path moves the stone seated at seat: its sideways shift and its
// turn, both still to be scaled, and its lift as a share of the full curl. Each stone answers
// the path as a damped spring of its own, so it rises under the hand, trails it, and rocks
// back into the mortar once the hand has passed. A resting pointer holds the plain curl.
bool pointerCurl(vec2 seat, float seed, out vec2 shift, out vec3 turn, out float lift) {
  shift = vec2(0.0);
  turn = vec3(0.0);
  lift = 0.0;
  if (uPointer.z <= 0.0 || distance(seat, uPointer.xy) >= uPointer.z) return false;
  float radius = uPointer.w;
  float w0 = ${SPRING.omega.toFixed(3)} * (1.0 + ${SPRING.spread.toFixed(3)} * (2.0 * fract(seed * 71.3) - 1.0));
  float ed = exp(-${SPRING.zeta.toFixed(3)} * w0 * ${TRAIL_STEP});
  float wd = ${Math.sqrt(1 - SPRING.zeta ** 2).toFixed(4)} * w0 * ${TRAIL_STEP};
  vec2 turnStep = vec2(cos(wd), sin(wd));
  // The spring's impulse response at each sample's age, stepped by recurrence.
  float env = sqrt(ed);
  vec2 phase = vec2(cos(0.5 * wd), sin(0.5 * wd));
  float norm = 0.0;
  for (int k = 0; k < ${TRAIL}; k++) {
    float g = env * phase.y;
    norm += g;
    env *= ed;
    phase = vec2(phase.x * turnStep.x - phase.y * turnStep.y, phase.x * turnStep.y + phase.y * turnStep.x);
    vec4 s = uTrail[k];
    vec2 delta = seat - s.xy;
    float d = length(delta);
    float q = clamp(1.0 - d / radius, 0.0, 1.0);
    float weight = q * q * (3.0 - 2.0 * q) * s.z * g;
    if (weight == 0.0) continue;
    vec2 tangent = vec2(-delta.y, delta.x) / max(d, radius * 0.15);
    shift += tangent * weight;
    turn += normalize(vec3(tangent.y, -tangent.x, 0.25)) * weight;
    lift += weight;
  }
  shift /= norm;
  turn /= norm;
  lift /= norm;
  return true;
}
`;

// Where a stone is, and how it is turned, at uTime.
const STONE_POSE = `
uniform highp sampler2D uInst;
uniform mat4 uVP;
uniform float uTime;
uniform vec4 uRipple;
uniform float uFlicker;
${POINTER_CURL}
vec4 iA;
vec4 iB;
vec4 iC;
vec4 iD;
vec4 iE;
vec4 iF;
vec4 iG;
vec4 iH;
vec4 iI;
vec4 iJ;
void fetchStone(uint id) {
  ivec2 b = ivec2(int(id % ${PER_ROW}u) * ${TEXELS}, int(id / ${PER_ROW}u));
  iA = texelFetch(uInst, b, 0);
  iB = texelFetch(uInst, b + ivec2(1, 0), 0);
  iC = texelFetch(uInst, b + ivec2(2, 0), 0);
  iD = texelFetch(uInst, b + ivec2(3, 0), 0);
  iE = texelFetch(uInst, b + ivec2(4, 0), 0);
  iF = texelFetch(uInst, b + ivec2(5, 0), 0);
  iG = texelFetch(uInst, b + ivec2(6, 0), 0);
  iH = texelFetch(uInst, b + ivec2(7, 0), 0);
  iI = texelFetch(uInst, b + ivec2(8, 0), 0);
  iJ = texelFetch(uInst, b + ivec2(9, 0), 0);
}
mat3 rotAxis(vec3 a, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  float t = 1.0 - c;
  return mat3(t * a.x * a.x + c, t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
              t * a.x * a.y - s * a.z, t * a.y * a.y + c, t * a.y * a.z + s * a.x,
              t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c);
}
float stoneFlags() { return floor(iJ.w / 10.0); }
float exitDur() { return iJ.w - 10.0 * floor(iJ.w / 10.0); }
bool flies() { return iH.z < iA.z - 1e-4; }
bool stoneHidden() {
  float appear = flies() ? iH.z : iA.z - iF.w;
  if (uTime < appear) return true;
  if (uTime > iG.x + exitDur()) return true;
  // A stone that sits on its own seat, or falls onto it, can be culled off screen.
  if (uTime < iG.x && !(flies() && uTime < iA.z)) {
    vec4 cc = uVP * vec4(iA.xy, 0.0, 1.0);
    if (cc.w > 0.0) {
      float m = cc.w * 1.25 + 0.05;
      if (abs(cc.x) > m || abs(cc.y) > m) return true;
    }
  }
  return false;
}
// Arrival: dropped from h0 above the seat, thrown in along the bed from one side, or
// flown in from another picture's stone along an arc toward the lens; then rocked into
// the mortar by a damped spring (omega 36, zeta 0.4). Letters seat without overshoot.
// Departure: popped out of the mortar and swept off along the exit angle, turning.
// flight is the share of a flight done, and 1 for a stone that is not flying.
void stonePose(out mat3 R, out vec3 off, out float flight) {
  float T = iA.z;
  float seed = iA.w;
  float fall = iF.w;
  float thick = iE.x;
  bool letter = mod(stoneFlags(), 2.0) > 0.5;
  vec2 tilt = iE.zw;
  // Water: the stone rocks with a wave that runs across the wall, so the glint travels.
  if (iJ.z > 0.0) {
    float ph = dot(uRipple.xy, iA.xy) * uRipple.z - uRipple.w * uTime + seed * 1.7;
    tilt += iJ.z * vec2(sin(ph), 0.6 * cos(ph * 0.83 + seed * 4.0));
  }
  R = rotAxis(vec3(1.0, 0.0, 0.0), tilt.x) * rotAxis(vec3(0.0, 1.0, 0.0), tilt.y);
  off = vec3(iA.xy, iF.y - 0.5 * thick);
  flight = 1.0;
  float h0 = iF.z;
  float h1 = fract(seed * 91.37);
  float h2 = fract(seed * 47.11);
  float h3 = fract(seed * 13.91);
  vec3 axis = normalize(vec3(cos(h1 * 6.2832), sin(h1 * 6.2832), (h2 - 0.5) * 0.7));
  float spin = letter ? 0.0 : (0.7 + 1.5 * h3) * (h2 > 0.5 ? 1.0 : -1.0);
  float resid = letter ? 0.0 : 0.07 + 0.07 * h2;
  if (uTime < T) {
    if (flies()) {
      float L = iH.z;
      float s = clamp((uTime - L) / (T - L), 0.0, 1.0);
      flight = s;
      float e = s * s * (3.0 - 2.0 * s);
      vec2 src = iH.xy;
      float dist = length(iA.xy - src);
      float arc = clamp(0.3 * dist, 0.012, 0.55) * (0.6 + 0.8 * h1);
      off.xy = mix(src, iA.xy, e);
      off.z += arc * sin(3.14159265 * s);
      R = rotAxis(vec3(0.0, 0.0, 1.0), iH.w * (1.0 - e)) * rotAxis(axis, spin * 2.4 * sin(3.14159265 * s) + resid * e) * R;
    } else {
      float s = clamp((uTime - (T - fall)) / fall, 0.0, 1.0);
      float u = 1.0 - s;
      if (iG.w < 100.0) {
        vec2 d = vec2(cos(iG.w), sin(iG.w));
        off.xy += d * h0 * 2.2 * u * u;
        off.z += h0 * 0.6 * (1.0 - s * s);
      } else {
        off.z += h0 * (1.0 - s * s);
        off.xy += vec2(cos(h3 * 6.2832 + 1.0), sin(h3 * 6.2832 + 1.0)) * h0 * 0.16 * u * u;
      }
      R = rotAxis(axis, resid + spin * u * u) * R;
    }
  } else if (uTime < iG.x) {
    float tt = uTime - T;
    float w0 = 36.0;
    float zeta = 0.4;
    float wd = w0 * sqrt(1.0 - zeta * zeta);
    float env = exp(-zeta * w0 * tt);
    if (!letter) off.z -= 0.0006 * env * sin(wd * tt);
    R = rotAxis(axis, resid * env * cos(wd * tt)) * R;
  } else {
    float tt = uTime - iG.x;
    vec2 d = vec2(cos(iG.y), sin(iG.y));
    float v = iG.z * (0.8 + 0.4 * h1);
    off.z += 0.006 * (1.0 - exp(-tt / 0.03)) + v * 0.55 * tt;
    off.xy += d * (v * tt + 2.6 * v * tt * tt);
    R = rotAxis(axis, (spin == 0.0 ? 1.2 : spin) * (tt * 9.0 + tt * tt * 14.0)) * R;
  }
  // A bounded curl around the pointer. The shadow pass shares this pose.
  vec2 shift;
  vec3 turn;
  float lift;
  if (uTime >= T && uTime < iG.x && pointerCurl(iA.xy, seed, shift, turn, lift)) {
    float radius = uPointer.w;
    off.xy += shift * radius * 0.12;
    // The rebound rocks the stone; the mortar keeps it from sinking more than half a millimetre.
    off.z += radius * 0.085 * max(lift, -0.02);
    float a = length(turn);
    if (a > 1e-6) R = rotAxis(turn / a, 0.32 * a) * R;
  }
}
// Lit smalti: on from its ignition, out at its extinction, flickering on seeded
// noise; a laid stone glows as it lands, and a flying one carries its source's light.
float stoneEmission(float flight) {
  float on = smoothstep(iJ.x, iJ.x + 0.3, uTime) * (1.0 - smoothstep(iJ.y, iJ.y + 0.25, uTime));
  float fl = 1.0 + uFlicker * (0.5 * sin(uTime * 11.3 + iA.w * 61.0) + 0.3 * sin(uTime * 23.7 + iA.w * 17.0) + 0.2 * sin(uTime * 5.1 + iA.w * 29.0));
  float e = iF.x * on * fl;
  if (flight < 1.0) return mix(iI.w, e, smoothstep(0.1, 0.9, flight));
  if (!flies()) e *= smoothstep(iA.z - 0.04, iA.z + 0.4, uTime);
  return e;
}
`;

function stoneMesh() {
  const v = [];
  const idx = [];
  const quad = (a, b, c, d) => {
    const base = v.length / 4;
    v.push(...a, ...b, ...c, ...d);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad([0, 0, 0, 0], [1, 0, 0, 0], [2, 0, 0, 0], [3, 0, 0, 0]);
  for (let e = 0; e < 4; e++) {
    const f = (e + 1) % 4;
    quad([e, 0, 1, e], [e, 1, 1, e], [f, 1, 1, e], [f, 0, 1, e]);
    quad([e, 1, 2, e], [e, 2, 2, e], [f, 2, 2, e], [f, 1, 2, e]);
  }
  quad([3, 2, 3, 0], [2, 2, 3, 0], [1, 2, 3, 0], [0, 2, 3, 0]);
  const tpl = [];
  for (let i = 0; i < v.length; i += 4) tpl.push("vec4(" + v.slice(i, i + 4).map((x) => x.toFixed(1)).join(", ") + ")");
  return { verts: v.length / 4, index: idx, tpl: tpl.join(", ") };
}

function shadowMesh() {
  const v = [];
  const idx = [];
  for (let k = 0; k < 4; k++) v.push(k, 3, 0, 0);
  for (let k = 0; k < 4; k++) v.push(k, 2, 0, 0);
  idx.push(0, 1, 2, 0, 2, 3);
  for (let e = 0; e < 4; e++) {
    const f = (e + 1) % 4;
    idx.push(e, 4 + e, 4 + f, e, 4 + f, f);
  }
  return { verts: v.length / 4, index: idx };
}

const MESH = stoneMesh();

const TILE_VS = `#version 300 es
precision highp float;
layout(location=0) in uint aID;
${STONE_POSE}
const vec4 TPL[40] = vec4[40](${MESH.tpl});
out vec3 vP;
out vec3 vN;
out vec3 vL;
out vec3 vAx;
out vec3 vAy;
flat out vec4 vD;
flat out vec4 vX;
flat out float vHalf;
void main() {
  fetchStone(aID >> 6u);
  vec4 aV = TPL[int(aID & 63u)];
  if (stoneHidden()) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  mat3 R;
  vec3 off;
  float flight;
  stonePose(R, off, flight);
  int k = int(aV.x + 0.5);
  int level = int(aV.y + 0.5);
  int face = int(aV.z + 0.5);
  int e = int(aV.w + 0.5);
  vec2 c[4] = vec2[4](iB.xy, iB.zw, iC.xy, iC.zw);
  float thick = iE.x;
  float bev = iE.y;
  vec2 p = c[k];
  if (level == 0) {
    vec2 e1 = normalize(c[k] - c[(k + 3) % 4]);
    vec2 e2 = normalize(c[(k + 1) % 4] - c[k]);
    vec2 n1 = vec2(-e1.y, e1.x);
    vec2 n2 = vec2(-e2.y, e2.x);
    vec2 m = n1 + n2;
    float ml = length(m);
    m = ml > 1e-4 ? m / ml : n1;
    p += m * min(bev / max(dot(m, n1), 0.3), bev * 2.5);
  }
  float z = level == 0 ? thick : (level == 1 ? thick - bev : 0.0);
  vec2 ed = c[(e + 1) % 4] - c[e];
  vec2 on = normalize(vec2(ed.y, -ed.x));
  vec3 n;
  if (face == 0) n = vec3(0.0, 0.0, 1.0);
  else if (face == 1) n = level == 0 ? normalize(vec3(on * 0.5, 1.0)) : normalize(vec3(on, 0.6));
  else if (face == 2) n = vec3(on, 0.0);
  else n = vec3(0.0, 0.0, -1.0);
  vec3 wp = R * vec3(p, z - 0.5 * thick) + off;
  vP = wp;
  vN = R * n;
  vL = vec3(p, z);
  vAx = R * vec3(1.0, 0.0, 0.0);
  vAy = R * vec3(0.0, 1.0, 0.0);
  vD = vec4(flight < 1.0 ? mix(iI.rgb, iD.rgb, smoothstep(0.1, 0.9, flight)) : iD.rgb, iD.w);
  vX = vec4(iA.w, float(face), 1.0, stoneEmission(flight));
  vHalf = 250.0 * (length(c[0]) + length(c[1]) + length(c[2]) + length(c[3]));
  gl_Position = uVP * vec4(wp, 1.0);
}
`;

const SHADOW_VS = `#version 300 es
precision highp float;
layout(location=0) in uint aID;
${STONE_POSE}
void main() {
  fetchStone(aID >> 6u);
  int tv = int(aID & 63u);
  if (stoneHidden()) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  mat3 R;
  vec3 off;
  float flight;
  stonePose(R, off, flight);
  vec2 c[4] = vec2[4](iB.xy, iB.zw, iC.xy, iC.zw);
  float z = tv < 4 ? iE.x : 0.0;
  gl_Position = uVP * vec4(R * vec3(c[tv & 3], z - 0.5 * iE.x) + off, 1.0);
}
`;

const TILE_FS = `#version 300 es
precision highp float;
in vec3 vP;
in vec3 vN;
in vec3 vL;
in vec3 vAx;
in vec3 vAy;
flat in vec4 vD;
flat in vec4 vX;
flat in float vHalf;
uniform float uEmit;
out vec4 o;
${GLSL_COMMON}
void main() {
  int face = int(vX.y + 0.5);
  float seed = vX.x;
  int mat = int(vD.w + 0.5);
  vec3 albedo = vD.rgb;
  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vP);
  vec2 q = vL.xy * 1000.0 + seed * 173.0;
  float fp = max(length(fwidth(vL.xy * 1000.0)), 1e-4);
  float rough = 0.24;
  float metal = 0.0;
  vec3 F0 = vec3(0.05);
  float wrap = 0.2;
  float amp = 0.0;
  vec2 g = vec2(0.0);
  if (mat == 1 || mat == 2) {
    // Gold and silver leaf under a thin glass skin: metal, softly hammered.
    metal = 1.0;
    F0 = albedo;
    rough = 0.17;
    vec3 n1 = noised(q / 1.4);
    float f = 1.0 - smoothstep(0.2, 0.9, fp);
    g = n1.yz / 1.4 * 0.9;
    amp = 0.05 * f;
    rough = mix(0.3, rough, f);
  } else if (mat == 3) {
    rough = 0.52;
    F0 = vec3(0.04);
    wrap = 0.45;
    vec3 n1 = noised(q / 0.45);
    float f = 1.0 - smoothstep(0.08, 0.35, fp);
    g = n1.yz / 0.45;
    amp = 0.035 * f;
    albedo *= 0.94 + 0.12 * noised(q / 5.0 + vec2(seed * 31.0)).x;
  } else if (mat == 4) {
    rough = 0.42;
    F0 = vec3(0.045);
    wrap = 0.05;
    vec3 n1 = noised(q / 0.55);
    float f = 1.0 - smoothstep(0.1, 0.45, fp);
    g = n1.yz / 0.55;
    amp = 0.07 * f;
    rough = mix(0.5, rough, f);
    vec2 cell = floor(q / 0.42);
    float sp = hash12(cell + 7.0);
    float fs = 1.0 - smoothstep(0.06, 0.2, fp);
    if (sp > 0.92 && fs > 0.0) {
      vec2 rn = vec2(hash12(cell + 1.3), hash12(cell + 9.1)) - 0.5;
      g += rn * 9.0 * fs;
      rough = mix(rough, 0.07, fs);
    }
  } else if (mat == 6) {
    // Limestone: matte, with small pits and a soft grain.
    rough = 0.7;
    F0 = vec3(0.035);
    wrap = 0.4;
    vec3 n1 = noised(q / 0.6);
    float f = 1.0 - smoothstep(0.08, 0.4, fp);
    g = n1.yz / 0.6;
    amp = 0.05 * f;
    float pit = noised(q / 0.28 + 3.7).x;
    albedo *= (0.93 + 0.12 * noised(q / 3.5 + vec2(seed * 17.0)).x) * (1.0 - 0.3 * smoothstep(0.82, 0.95, pit) * f);
  } else if (mat == 7) {
    // Terracotta: fired clay, matte, warmer in its hollows.
    rough = 0.78;
    F0 = vec3(0.03);
    wrap = 0.3;
    vec3 n1 = noised(q / 0.9);
    float f = 1.0 - smoothstep(0.1, 0.5, fp);
    g = n1.yz / 0.9;
    amp = 0.06 * f;
    float m2 = noised(q / 2.2 + vec2(seed * 7.0)).x;
    albedo *= 0.9 + 0.18 * m2;
  } else {
    // Glass smalti, broken face up: soft conchoidal ripples and a few bubbles.
    rough = 0.2;
    F0 = vec3(0.05);
    wrap = 0.3;
    vec3 n1 = noised(q / 3.1);
    float f1 = 1.0 - smoothstep(0.35, 1.4, fp);
    float f2 = 1.0 - smoothstep(0.12, 0.5, fp);
    g = n1.yz / 3.1 * f1;
    if (f2 > 0.0) {
      vec3 n2 = noised(q / 1.05 + 4.1);
      g += n2.yz / 1.05 * 0.5 * f2;
      float bub = noised(q / 0.32 + 9.0).x;
      albedo *= 1.0 - 0.25 * smoothstep(0.86, 0.95, bub) * f2;
    }
    amp = 0.36;
    rough = mix(0.3, 0.23, f1);
  }
  if (face == 0) {
    N = normalize(N - amp * (g.x * normalize(vAx) + g.y * normalize(vAy)));
  } else if (face == 1) {
    rough *= 0.75;
  } else {
    rough = clamp(rough + 0.25, 0.0, 1.0);
    albedo *= mat == 0 || mat == 5 ? 0.82 : 0.9;
  }
  vec3 dN = fwidth(N);
  float var = min(dot(dN, dN) * 0.5, 0.2);
  rough = sqrt(clamp(rough * rough + var, 0.0, 1.0));
  float sideAo = face == 2 ? mix(0.3, 1.0, smoothstep(-0.0015, 0.0025, vP.z)) : 1.0;
  if (face == 3) sideAo = 0.3;
  vec3 col = shade(vP, N, V, albedo, metal, rough, F0, 1.0, wrap, sideAo);
  if (vX.w > 0.0) {
    vec2 c4 = vL.xy * 1000.0 / max(vHalf, 0.5);
    float heart = exp(-dot(c4, c4) * 2.0);
    vec3 deep = vD.rgb * vec3(1.0, 0.72, 0.42);
    vec3 glow = mix(deep, vD.rgb, heart) * (0.55 + 0.75 * heart);
    float faceK = face == 0 ? 1.0 : (face == 1 ? 0.8 : 0.45);
    col += glow * vX.w * vX.z * uEmit * faceK;
  }
  o = vec4(col, 1.0);
}
`;

const SHADOW_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(1.0); }
`;

// Clears the depth wherever a picture set in front has a stone seated, with its mortar, so
// that both, drawn next, stay in front of any stone flying past. Where its stone has not yet
// landed, or has lifted off, whatever lies under it shows.
const CLEAR_FS = `#version 300 es
precision highp float;
in vec3 vP;
uniform float uTime;
uniform highp sampler2D uInstB;
uniform highp sampler2D uOwnB;
uniform vec4 uPanelB;
out vec4 o;
void main() {
  vec2 uv = vec2((vP.x - uPanelB.x) * 1000.0, (uPanelB.y - vP.y) * 1000.0) / uPanelB.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 ow = texelFetch(uOwnB, ivec2(uv * vec2(textureSize(uOwnB, 0))), 0);
  int id = int(ow.r * 255.0 + 0.5) + 256 * int(ow.g * 255.0 + 0.5);
  if (id >= 65535) discard;
  ivec2 at = ivec2((id % ${PER_ROW}) * ${TEXELS}, id / ${PER_ROW});
  float T = texelFetch(uInstB, at, 0).z, U = texelFetch(uInstB, at + ivec2(6, 0), 0).x;
  if (uTime < T || uTime >= U) discard;
  o = vec4(0.0);
  gl_FragDepth = 1.0;
}
`;

// The bed. One quad over the wall; per pixel it decides whose mortar it is: the
// outgoing picture's while its stone is still seated there, the incoming one's after. A wall
// of more than two pictures draws it again for each further pair, newest last, where that
// pair has a stone or a seat, and once more for each picture set in front.
const BED_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aP;
uniform mat4 uVP;
out vec3 vP;
void main() {
  vP = vec3(aP, 0.0);
  gl_Position = uVP * vec4(vP, 1.0);
}
`;

const BED_FS = `#version 300 es
precision highp float;
in vec3 vP;
uniform float uTime;
uniform int uHasA;
uniform int uOver;
uniform int uFront;
uniform highp sampler2D uInstA;
uniform highp sampler2D uOwnA;
uniform highp sampler2D uOwn2A;
uniform sampler2D uSinA;
uniform vec4 uPanelA;   // world x of panel x=0, world y of panel y=0, width mm, height mm
uniform vec3 uGroutA;
uniform vec2 uWetA;     // fresh lime lead and drying time, s
uniform highp sampler2D uInstB;
uniform highp sampler2D uOwnB;
uniform highp sampler2D uOwn2B;
uniform sampler2D uSinB;
uniform vec4 uPanelB;
uniform vec3 uGroutB;
uniform vec2 uWetB;
uniform vec3 uCoat;
uniform vec3 uSinopia;
out vec4 o;
${GLSL_COMMON}
${POINTER_CURL}
vec4 seatA(highp sampler2D inst, int id) { return texelFetch(inst, ivec2((id % ${PER_ROW}) * ${TEXELS}, id / ${PER_ROW}), 0); }
float seatT(highp sampler2D inst, int id) { return texelFetch(inst, ivec2((id % ${PER_ROW}) * ${TEXELS}, id / ${PER_ROW}), 0).z; }
float liftU(highp sampler2D inst, int id) { return texelFetch(inst, ivec2((id % ${PER_ROW}) * ${TEXELS} + 6, id / ${PER_ROW}), 0).x; }
vec3 stoneRgb(highp sampler2D inst, int id) { return texelFetch(inst, ivec2((id % ${PER_ROW}) * ${TEXELS} + 3, id / ${PER_ROW}), 0).rgb; }
// mm coordinates of this point on a panel.
vec2 panelMM(vec4 pan) { return vec2((vP.x - pan.x) * 1000.0, (pan.y - vP.y) * 1000.0); }
// One picture's mortar at this point. alive is true while a stone of this picture
// still sits here, which is what decides whose mortar shows during a re-lay.
void layer(highp sampler2D inst, highp sampler2D own0, highp sampler2D own2, sampler2D sinTex, vec4 pan, vec3 grout, vec2 wetT,
           out vec3 albedo, out float ao, out float sheen, out bool alive, out bool owned, out bool spread) {
  vec2 mm = panelMM(pan);
  vec2 uv = mm / pan.zw;
  albedo = uCoat;
  ao = 1.0;
  sheen = 0.0;
  alive = false;
  owned = false;
  spread = false;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return;
  // The sinopia's brush coverage, baked with the stroke's wandering width and pressure.
  float a = texture(sinTex, uv).r;
  vec3 coat = mix(uCoat, uSinopia, a);
  albedo = coat;
  ivec2 ip = ivec2(uv * vec2(textureSize(own0, 0)));
  vec4 ow = texelFetch(own0, ip, 0);
  int id = int(ow.r * 255.0 + 0.5) + 256 * int(ow.g * 255.0 + 0.5);
  float e = texture(own0, uv).b * 255.0 / 48.0;
  // A figure that arrives later owns this mortar from the moment it starts to land.
  vec4 ow2 = texelFetch(own2, ip, 0);
  int id2 = int(ow2.r * 255.0 + 0.5) + 256 * int(ow2.g * 255.0 + 0.5);
  if (id2 < 65535 && uTime >= seatT(inst, id2) - 0.15) {
    id = id2;
    e = texture(own2, uv).b * 255.0 / 48.0;
  }
  if (id < 65535) {
    owned = true;
    float T = seatT(inst, id);
    float U = liftU(inst, id);
    float seated = smoothstep(T - 0.01, T + 0.08, uTime) * (1.0 - smoothstep(U, U + 0.06, uTime));
    // Mortar that a stone has been moved off is lit and shaded only by the stone above it,
    // instead of the shadowed footprint the stone left in it.
    float moved = 0.0;
    vec4 seat = seatA(inst, id);
    vec2 shift;
    vec3 turn;
    float lift;
    if (seated > 0.0 && pointerCurl(seat.xy, seat.w, shift, turn, lift)) moved = smoothstep(0.03, 0.5, lift) * seated;
    float wet = smoothstep(T - wetT.x, T - wetT.x * 0.4, uTime);
    spread = uTime >= T - wetT.x;
    float dry = smoothstep(T + 0.3, T + wetT.y, uTime);
    sheen = wet * (1.0 - dry);
    // The lime spread ahead of a stone is plain. Once the stone is set, the grout pressed
    // in round it is tinted to suit it, darker under dark glass, and the bed a stone is lifted
    // off is a deeper shade of the same, so a lifted stone floats over its own colour.
    float set = smoothstep(T - 0.01, T + 0.12, uTime);
    vec3 tint = mix(grout, mix(grout, stoneRgb(inst, id), 0.9), set) * mix(1.0, 0.5, moved);
    vec3 bed = mix(tint * 0.62, tint, dry);
    albedo = mix(coat, bed, wet);
    ao = 1.0 - seated * (1.0 - moved) * 0.5 * exp(-e / 0.4);
    alive = uTime < U + 0.05;
  }
}
void main() {
  vec3 V = normalize(uEye - vP);
  vec3 albedo;
  float ao;
  float sheen;
  bool alive;
  bool owned;
  bool spread;
  layer(uInstB, uOwnB, uOwn2B, uSinB, uPanelB, uGroutB, uWetB, albedo, ao, sheen, alive, owned, spread);
  // A picture set in front lays its mortar only where its lime is spread and its stone has not
  // lifted off again.
  if (uFront == 1 && !(owned && alive && spread)) discard;
  bool alive2 = false;
  if (uHasA == 1) {
    vec3 a2;
    float ao2;
    float sh2;
    bool owned2;
    bool spread2;
    layer(uInstA, uOwnA, uOwn2A, uSinA, uPanelA, uGroutA, uWetA, a2, ao2, sh2, alive2, owned2, spread2);
    if (alive2) {
      albedo = a2;
      ao = ao2;
      sheen = sh2;
    }
  }
  // A later pair leaves the mortar of the pairs before it wherever it has no stone.
  if (uOver == 1 && !owned && !alive2) discard;
  vec2 mm = vP.xy * 1000.0;
  float fp = max(length(fwidth(mm)), 1e-4);
  float f1 = 1.0 - smoothstep(0.06, 0.25, fp);
  float f2 = 1.0 - smoothstep(0.6, 2.5, fp);
  vec2 g = vec2(0.0);
  float n0 = fbm3(mm / 23.0 + 5.0);
  albedo *= 0.9 + 0.2 * n0;
  if (f1 > 0.0) {
    vec3 n1 = noised(mm / 0.35);
    g += n1.yz / 0.35 * 0.05 * f1 * (1.0 - 0.6 * sheen);
    albedo *= 0.92 + 0.16 * n1.x * f1;
  }
  if (f2 > 0.0) g += noised(mm / 4.0 + 3.0).yz / 4.0 * 0.12 * f2;
  vec3 N = normalize(vec3(-g, 1.0));
  float rough = mix(0.92, 0.38, sheen);
  vec3 col = shade(vP, N, V, albedo, 0.0, rough, vec3(0.04), ao, 0.0, 1.0);
  o = vec4(col, 1.0);
}
`;

const QUAD_VS = `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const ACC_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uW;
out vec4 o;
void main() { o = vec4(texture(uSrc, vUv).rgb * uW, uW); }
`;

const LENS_GLSL = `
uniform vec4 uLens;
float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uLens.x * uLens.y / (uLens.y + uLens.x - z * (uLens.y - uLens.x));
}
float cocOf(float d) { return clamp(uLens.w * (1.0 / uLens.z - 1.0 / linDepth(d)), -64.0, 64.0); }
`;

const PREP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform highp sampler2D uDepth;
uniform vec2 uTexel;
${LENS_GLSL}
out vec4 o;
void main() {
  vec3 c = vec3(0.0);
  float dmin = 1.0;
  for (int i = 0; i < 4; i++) {
    vec2 off = (vec2(float(i & 1), float(i >> 1)) - 0.5) * uTexel;
    c += texture(uSrc, vUv + off).rgb;
    dmin = min(dmin, texture(uDepth, vUv + off).r);
  }
  o = vec4(c * 0.25, cocOf(dmin));
}
`;

const TILEMAX_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHalf;
uniform vec2 uHalfSize;
out vec4 o;
void main() {
  vec2 base = floor(vUv * uHalfSize / 8.0) * 8.0;
  float m = 0.0;
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      float c = texture(uHalf, (base + vec2(float(x), float(y)) + 0.5) / uHalfSize).a;
      m = max(m, -c);
    }
  }
  o = vec4(m);
}
`;

const DILATE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTile;
uniform vec2 uTileTexel;
out vec4 o;
void main() {
  float m = 0.0;
  for (int y = -3; y <= 3; y++) {
    for (int x = -3; x <= 3; x++) {
      m = max(m, texture(uTile, vUv + vec2(float(x), float(y)) * uTileTexel).r);
    }
  }
  o = vec4(m);
}
`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHalf;
uniform sampler2D uTile;
uniform vec2 uTexel;
uniform float uMaxR;
layout(location=0) out vec4 oFar;
layout(location=1) out vec4 oNear;
void main() {
  vec4 cen = texture(uHalf, vUv);
  float rc = abs(cen.a) * 0.5;
  float rn = texture(uTile, vUv).r * 0.5;
  float R = min(max(rc, rn), uMaxR);
  float w0 = 1.0 / max(rc * rc, 1.0);
  vec3 facc = cen.rgb * w0;
  float fw = w0;
  vec3 nacc = vec3(0.0);
  float nw = 0.0;
  if (cen.a < -1.0) {
    nacc = cen.rgb;
    nw = 1.0;
  }
  for (int i = 0; i < 36; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 36.0) * R;
    float a = fi * 2.39996323;
    vec4 s = texture(uHalf, vUv + vec2(cos(a), sin(a)) * r * uTexel);
    float sr = abs(s.a) * 0.5;
    if (s.a < -1.0) {
      float cover = smoothstep(r - 1.0, r + 0.5, sr);
      nacc += s.rgb * cover;
      nw += cover;
    }
    if (s.a >= cen.a - 0.5) {
      float se = min(sr, rc);
      float w = smoothstep(r - 1.0, r + 0.5, se) / max(se * se, 1.0);
      facc += s.rgb * w;
      fw += w;
    }
  }
  oFar = vec4(facc / fw, rc);
  float alpha = clamp(nw / 37.0 * 2.2, 0.0, 1.0);
  oNear = vec4(nw > 0.0 ? nacc / nw : vec3(0.0), alpha);
}
`;

const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAcc;
uniform sampler2D uFar;
uniform sampler2D uNear;
uniform highp sampler2D uDepth;
uniform float uDof;
uniform float uExposure;
uniform float uFade;
uniform float uFrame;
uniform float uAspect;
uniform float uCA;
${LENS_GLSL}
out vec4 o;
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
// Minimal AgX: Benjamin Wrensch / Missing Deadlines, MIT (2024).
// https://iolite-engine.com/blog_posts/minimal_agx_implementation
// Modified look and exposure/output handling. See THIRD_PARTY_NOTICES.md.
vec3 agx(vec3 v) {
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  v = m * v;
  v = clamp(log2(max(v, vec3(1e-10))), -12.47393, 4.026069);
  v = (v + 12.47393) / (4.026069 + 12.47393);
  v = agxContrast(v);
  float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = pow(max(v, vec3(0.0)), vec3(1.22));
  v = l + 1.25 * (v - l);
  return mi * v;
}
vec3 lensAt(vec2 uv) {
  vec3 c = texture(uAcc, uv).rgb;
  if (uDof > 0.5) {
    float coc = abs(cocOf(texture(uDepth, uv).r));
    vec4 far = texture(uFar, uv);
    c = mix(c, far.rgb, smoothstep(0.7, 2.4, coc));
    vec4 nr = texture(uNear, uv);
    c = mix(c, nr.rgb, nr.a);
  }
  return c;
}
void main() {
  // A touch of lateral colour toward the edges of the frame.
  vec2 d0 = vUv - 0.5;
  vec2 shift = d0 * dot(d0, d0) * uCA;
  vec3 c = vec3(lensAt(vUv + shift).r, lensAt(vUv).g, lensAt(vUv - shift).b);
  vec2 d = d0 * vec2(1.0, 1.0 / uAspect) * 1.9;
  float vig = 1.0 / (1.0 + dot(d, d) * 0.3);
  c *= uExposure * vig * vig;
  c = agx(c) * uFade;
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * vec2(5.588238, 3.17), vec2(0.06711056, 0.00583715))));
  float n2 = fract(n * 7.13 + 0.37);
  c += (n + n2 - 1.0) / 255.0;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

function fail(msg) { throw new Error(msg); }

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const lines = src.split("\n").map((l, i) => (i + 1) + ": " + l).join("\n");
    const message = (gl.getShaderInfoLog(s) || "shader") + "\n" + lines;
    gl.deleteShader(s);
    fail(message);
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  const shaders = [];
  try {
    shaders.push(compile(gl, gl.VERTEX_SHADER, vs));
    shaders.push(compile(gl, gl.FRAGMENT_SHADER, fs));
    for (const s of shaders) gl.attachShader(p, s);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) fail(gl.getProgramInfoLog(p) || "link");
  } catch (error) {
    gl.deleteProgram(p);
    throw error;
  } finally {
    for (const s of shaders) gl.deleteShader(s);
  }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// opts: W, H (band pixels), FOVY, shutter (s), aperture (m), timeline (cameraAt, rigAt, layersAt).
export function createRenderer(gl, opts) {
  const { W, H } = opts;
  const resources = [];
  const own = (kind, value) => { resources.push([kind, value]); return value; };
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [kind, value] of resources.reverse()) gl[`delete${kind}`](value);
    resources.length = 0;
  }
  try {
    if (!gl.getExtension("EXT_color_buffer_float")) fail("EXT_color_buffer_float is missing");
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    const tileProg = program(gl, TILE_VS, TILE_FS);
    own("Program", tileProg.p);
    const shadowProg = program(gl, SHADOW_VS, SHADOW_FS);
    own("Program", shadowProg.p);

    const bedProg = program(gl, BED_VS, BED_FS);
    own("Program", bedProg.p);
    const clearProg = program(gl, BED_VS, CLEAR_FS);
    own("Program", clearProg.p);
    const accProg = program(gl, QUAD_VS, ACC_FS);
    own("Program", accProg.p);
    const prepProg = program(gl, QUAD_VS, PREP_FS);
    own("Program", prepProg.p);
    const tileMaxProg = program(gl, QUAD_VS, TILEMAX_FS);
    own("Program", tileMaxProg.p);
    const dilateProg = program(gl, QUAD_VS, DILATE_FS);
    own("Program", dilateProg.p);
    const blurProg = program(gl, QUAD_VS, BLUR_FS);
    own("Program", blurProg.p);
    const finalProg = program(gl, QUAD_VS, FINAL_FS);
    own("Program", finalProg.p);

    // Rows of one-byte textures (the sinopia) are packed with no padding at any width.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    function tex(w, h, internal, format, type, data, filter, mips) {
      const t = own("Texture", gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (mips) {
        gl.generateMipmap(gl.TEXTURE_2D);
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      }
      return t;
    }

    // The triangles of every stone, listed in the given order so a run of stones can be drawn.
    function stoneVao(count, mesh, order) {
      const vao = own("VertexArray", gl.createVertexArray());
      gl.bindVertexArray(vao);
      const ids = new Uint32Array(count * mesh.verts);
      for (let i = 0; i < count; i++) for (let k = 0; k < mesh.verts; k++) ids[i * mesh.verts + k] = i * 64 + k;
      const per = mesh.index.length;
      const ix = new Uint32Array(count * per);
      for (let j = 0; j < count; j++) {
        const i = order ? order[j] : j;
        for (let k = 0; k < per; k++) ix[j * per + k] = i * mesh.verts + mesh.index[k];
      }
      const vb = own("Buffer", gl.createBuffer());
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 0, 0);
      const eb = own("Buffer", gl.createBuffer());
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: ix.length, per, buffers: [vb, eb] };
    }

    // A layer: one shot's stones and its bed, uploaded once.
    // A tall picture that asks for rows (config.rows), such as a page that scrolls across one
    // wall, lists its stones by height, and a frame draws only the rows within reach of its
    // view. Stones that fly in or leave can be anywhere, so their picture is drawn whole.
    // Other pictures keep their own drawing order, and so their exact pixels.
    function rows(L) {
      if (!L.pic?.cfg?.rows) return null;
      const n = L.count, d = L.data;
      let reach = 0.15;
      for (let i = 0; i < n; i++) {
        const o = i * TEXELS * 4;
        if (d[o + 24] < 1e5 || d[o + 30] < 1e5) return null;
        reach = Math.max(reach, d[o + 22] * 2.4 + 0.05);
      }
      const order = new Uint32Array(n).map((_, i) => i).sort((a, b) => d[a * TEXELS * 4 + 1] - d[b * TEXELS * 4 + 1] || a - b);
      return { order, y: Float32Array.from(order, (i) => d[i * TEXELS * 4 + 1]), reach };
    }

    function addLayer(L) {
      const instH = Math.ceil(L.count / PER_ROW);
      const data = new Float32Array(PER_ROW * TEXELS * instH * 4);
      data.set(L.data);
      const byRow = rows(L);
      const g = {
        inst: tex(PER_ROW * TEXELS, instH, gl.RGBA32F, gl.RGBA, gl.FLOAT, data, gl.NEAREST, false),
        rows: byRow,
        stones: stoneVao(L.count, MESH, byRow?.order),
        casters: stoneVao(L.count, shadowMesh(), byRow?.order),
        own: tex(L.bed.w, L.bed.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, L.bed.own, gl.LINEAR, false),
        own2: tex(L.bed.w, L.bed.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, L.bed.own2, gl.LINEAR, false),
        sin: tex(L.bed.w, L.bed.h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, L.bed.sin, gl.LINEAR, true)
      };
      L.gpu = g;
      return L;
    }

    function depthTarget(size) {
      const t = own("Texture", gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      const fb = own("Framebuffer", gl.createFramebuffer());
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      return { t, fb, size };
    }
    const SH = opts.shadowSize || 4096;
    const keySh = depthTarget(SH);
    let frontSh = null;

    function colorTarget(w, h, withDepth, attachments) {
      const fb = own("Framebuffer", gl.createFramebuffer());
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      const ts = [];
      for (let a = 0; a < (attachments || 1); a++) {
        const t = tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.LINEAR, false);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + a, gl.TEXTURE_2D, t, 0);
        ts.push(t);
      }
      if (ts.length > 1) gl.drawBuffers(ts.map((_, a) => gl.COLOR_ATTACHMENT0 + a));
      let d = null;
      if (withDepth) {
        d = own("Texture", gl.createTexture());
        gl.bindTexture(gl.TEXTURE_2D, d);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, d, 0);
      }
      const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) fail("framebuffer incomplete " + st);
      return { t: ts[0], ts, fb, d, w, h };
    }
    const scene = colorTarget(W, H, true);
    const acc = colorTarget(W, H, false);
    const hw = Math.ceil(W / 2);
    const hh = Math.ceil(H / 2);
    const half = colorTarget(hw, hh, false);
    const tileMax = colorTarget(Math.ceil(hw / 8), Math.ceil(hh / 8), false);
    const tileDil = colorTarget(Math.ceil(hw / 8), Math.ceil(hh / 8), false);
    const blurred = colorTarget(hw, hh, false, 2);

    const bedVao = own("VertexArray", gl.createVertexArray());
    const bedBuf = own("Buffer", gl.createBuffer());
    gl.bindVertexArray(bedVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, bedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(12), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    function setLights(prog, L) {
      const u = prog.u;
      const r = L.rig;
      gl.uniform3fv(u.uEye, L.eye);
      gl.uniform3fv(u.uKeyDir, r.keyDir);
      gl.uniform3fv(u.uKeyCol, r.keyCol);
      gl.uniform3fv(u.uFillDir, r.fillDir);
      gl.uniform3fv(u.uFillCol, r.fillCol);
      // Point lights: world position and power, and colour.
      const pts = new Float32Array(POINTS * 4);
      const cols = new Float32Array(POINTS * 3);
      (r.points || []).slice(0, POINTS).forEach((pt, i) => {
        pts.set([pt.pos[0], pt.pos[1], pt.pos[2], pt.power], i * 4);
        cols.set(pt.color, i * 3);
      });
      gl.uniform4fv(u.uPt, pts);
      gl.uniform3fv(u.uPtCol, cols);
      const lamp = L.lamp;
      gl.uniform4fv(u.uLamp, lamp ? [...lamp.pos, lamp.power] : [0, 0, 0, 0]);
      gl.uniform4fv(u.uLampCol, lamp ? [...lamp.color, lamp.cone] : [0, 0, 0, 1]);
      gl.uniform3fv(u.uSky, r.sky);
      gl.uniform3fv(u.uGround, r.ground);
      gl.uniformMatrix4fv(u.uKeyM, false, L.keyM);
      gl.uniform2f(u.uKeyTx, L.keyR, 0.00035);
      gl.uniform1f(u.uSpin, L.spin);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, keySh.t);
      gl.uniform1i(u.uKeySh, 5);
    }

    // Footprint of the view on the wall, padded.
    function footprint(view, proj) {
      const inv = invert(mat4Mul(proj, view));
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const a = xform(inv, [x, y, -1]);
        const b = xform(inv, [x, y, 1]);
        const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
        const p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
        const dz = p1[2] - p0[2];
        const t = clamp(dz < -1e-6 ? -p0[2] / dz : 1, 0, 1);
        const px = p0[0] + (p1[0] - p0[0]) * t;
        const py = p0[1] + (p1[1] - p0[1]) * t;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px);
        y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      const pad = 0.06 * Math.max(x1 - x0, y1 - y0) + 0.004;
      return [x0 - pad, x1 + pad, y0 - pad, y1 + pad];
    }

    function camMatrices(t, jitter) {
      const cam = opts.timeline.cameraAt(t);
      const near = Math.max(0.004, cam.dist * 0.04);
      const far = Math.min(8.0, cam.dist * 4 + 0.5);
      const view = lookAt(cam.eye, cam.target, cam.up);
      const proj = perspective(opts.FOVY, W / H, near, far);
      proj[8] += (jitter[0] * 2) / W;
      proj[9] += (jitter[1] * 2) / H;
      return { cam, near, far, view, proj, vp: mat4Mul(proj, view) };
    }

    const noTrail = new Float32Array(TRAIL * 4);
    // The first stone at or above height y, in a layer's rows.
    function rowAt(y, h) {
      let lo = 0, hi = y.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (y[mid] < h) lo = mid + 1; else hi = mid; }
      return lo;
    }
    // span: the wall heights in view, padded; stones listed by row outside it are skipped.
    function drawStones(prog, layer, geo, vp, t, span) {
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.u.uVP, false, vp);
      gl.uniform1f(prog.u.uTime, t);
      const pointer = opts.pointerAt?.(t);
      gl.uniform4fv(prog.u.uPointer, pointer?.head || [0, 0, 0, 1]);
      gl.uniform4fv(prog.u.uTrail, pointer?.trail || noTrail);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, layer.gpu.inst);
      gl.uniform1i(prog.u.uInst, 7);
      // Each picture has its own water wave and its own flicker for lit smalti.
      gl.uniform4fv(prog.u.uRipple, layer.ripple || [1, 0, 0, 0]);
      gl.uniform1f(prog.u.uFlicker, layer.flicker || 0);
      gl.bindVertexArray(geo.vao);
      const R = layer.gpu.rows;
      const first = R && span ? rowAt(R.y, span[0] - R.reach) : 0;
      const last = R && span ? rowAt(R.y, span[1] + R.reach) : layer.count;
      if (last > first) gl.drawElements(gl.TRIANGLES, (last - first) * geo.per, gl.UNSIGNED_INT, first * geo.per * 4);
    }

    function lightsAt(t, layers) {
      const C = camMatrices(t, [0, 0]);
      const fp = footprint(C.view, C.proj);
      const rig = opts.timeline.rigAt(t);
      const cx = (fp[0] + fp[1]) / 2;
      const cy = (fp[2] + fp[3]) / 2;
      const kd = rig.keyDir;
      const keyView = lookAt([cx + kd[0], cy + kd[1], kd[2]], [cx, cy, 0], [0, 0, 1]);
      let lx0 = 1e9, lx1 = -1e9, ly0 = 1e9, ly1 = -1e9;
      for (const x of [fp[0], fp[1]]) {
        for (const y of [fp[2], fp[3]]) {
          for (const z of [0, 0.05]) {
            const p = xform(keyView, [x, y, z]);
            lx0 = Math.min(lx0, p[0]); lx1 = Math.max(lx1, p[0]);
            ly0 = Math.min(ly0, p[1]); ly1 = Math.max(ly1, p[1]);
          }
        }
      }
      const keyM = mat4Mul(ortho(lx0, lx1, ly0, ly1, 0.2, 2.5), keyView);
      const L = { eye: C.cam.eye, rig, keyM, keyR: 0.8 / SH, spin: 0, footprint: fp, lamp: opts.lampAt?.() || null };
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 3.0);
      gl.disable(gl.CULL_FACE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, keySh.fb);
      gl.viewport(0, 0, SH, SH);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      for (const layer of layers) drawStones(shadowProg, layer, layer.gpu.casters, keyM, t, [fp[2], fp[3]]);
      // A picture set in front is shaded only by its own stones, never by the stones flying
      // past behind it.
      const front = layers.filter((layer) => layer.scene.front);
      if (front.length) {
        frontSh ??= depthTarget(SH);
        gl.bindFramebuffer(gl.FRAMEBUFFER, frontSh.fb);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        for (const layer of front) drawStones(shadowProg, layer, layer.gpu.casters, keyM, t, [fp[2], fp[3]]);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      return L;
    }

    function bindTex(unit, t, loc) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(loc, unit);
    }

    function setBed(u, suffix, layer, unit0) {
      bindTex(unit0, layer.gpu.inst, u["uInst" + suffix]);
      bindTex(unit0 + 1, layer.gpu.own, u["uOwn" + suffix]);
      bindTex(unit0 + 2, layer.gpu.own2, u["uOwn2" + suffix]);
      bindTex(unit0 + 3, layer.gpu.sin, u["uSin" + suffix]);
      gl.uniform4f(u["uPanel" + suffix], layer.world[0], layer.world[1], layer.W, layer.H);
      gl.uniform3fv(u["uGrout" + suffix], layer.grout);
      gl.uniform2fv(u["uWet" + suffix], layer.wet);
    }

    function renderScene(t, jitter, L, layers, lensOut) {
      const C = camMatrices(t, jitter);
      L.eye = C.cam.eye;
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      gl.clearColor(0.004, 0.004, 0.005, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // Stones first, so the mortar they cover is never shaded.
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.useProgram(tileProg.p);
      setLights(tileProg, L);
      gl.uniform1f(tileProg.u.uEmit, 1.0);
      const span = [L.footprint[2], L.footprint[3]];
      for (const layer of layers) if (!layer.scene.front) drawStones(tileProg, layer, layer.gpu.stones, C.vp, t, span);
      // The bed covers the footprint of the view.
      const fp = L.footprint;
      gl.bindBuffer(gl.ARRAY_BUFFER, bedBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([fp[0], fp[2], fp[1], fp[2], fp[1], fp[3], fp[0], fp[2], fp[1], fp[3], fp[0], fp[3]]));
      // A picture set in front stays in front of every stone that flies past it.
      const front = layers.filter((layer) => layer.scene.front);
      if (front.length) {
        gl.disable(gl.CULL_FACE);
        gl.depthFunc(gl.ALWAYS);
        gl.colorMask(false, false, false, false);
        gl.useProgram(clearProg.p);
        gl.uniformMatrix4fv(clearProg.u.uVP, false, C.vp);
        gl.uniform1f(clearProg.u.uTime, t);
        gl.bindVertexArray(bedVao);
        for (const layer of front) {
          setBed(clearProg.u, "B", layer, 8);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        gl.colorMask(true, true, true, true);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.CULL_FACE);
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, frontSh.t);
        for (const layer of front) drawStones(tileProg, layer, layer.gpu.stones, C.vp, t, span);
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, keySh.t);
      }
      gl.disable(gl.CULL_FACE);
      gl.useProgram(bedProg.p);
      setLights(bedProg, L);
      const u = bedProg.u;
      gl.uniformMatrix4fv(u.uVP, false, C.vp);
      gl.uniform1f(u.uTime, t);
      const pointer = opts.pointerAt?.(t);
      gl.uniform4fv(u.uPointer, pointer?.head || [0, 0, 0, 1]);
      gl.uniform4fv(u.uTrail, pointer?.trail || noTrail);
      gl.uniform3fv(u.uCoat, opts.coat);
      gl.uniform3fv(u.uSinopia, opts.sinopia);
      gl.bindVertexArray(bedVao);
      // The pictures in pairs, the newest two last, and then each picture set in front on its
      // own, shaded only by its own stones.
      const back = layers.filter((layer) => !layer.scene.front), pairs = [];
      for (let i = back.length; i > 0; i -= 2) pairs.unshift([back[i - 1], i > 1 ? back[i - 2] : null]);
      for (const layer of front) pairs.push([layer, null]);
      pairs.forEach(([B, A], k) => {
        setBed(u, "B", B, 8);
        setBed(u, "A", A || B, 12);
        gl.uniform1i(u.uHasA, A ? 1 : 0);
        gl.uniform1i(u.uOver, k ? 1 : 0);
        gl.uniform1i(u.uFront, B.scene.front ? 1 : 0);
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, B.scene.front ? frontSh.t : keySh.t);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });
      if (lensOut) {
        const fpx = (H / 2) / Math.tan(opts.FOVY / 2);
        lensOut.near = C.near;
        lensOut.far = C.far;
        lensOut.focus = C.cam.focus || C.cam.dist;
        lensOut.k = (C.cam.aperture || opts.aperture) * fpx;
      }
    }

    function quad(prog) {
      gl.useProgram(prog.p);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function render(t, subframes) {
      const n = Math.max(1, subframes | 0);
      const layers = opts.timeline.layersAt(t);
      const look = opts.timeline.lookAt(t);
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const lens = {};
      if (layers.length && look.fade > 0) {
        const L = lightsAt(t, layers);
        for (let i = 0; i < n; i++) {
          const ts = n > 1 ? t + ((i + 0.5) / n - 0.5) * opts.shutter : t;
          const jitter = n > 1 ? [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5] : [0, 0];
          L.spin = i / n;
          renderScene(ts, jitter, L, layers, lens);
          gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb);
          gl.viewport(0, 0, W, H);
          gl.disable(gl.DEPTH_TEST);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(accProg.p);
          bindTex(0, scene.t, accProg.u.uSrc);
          gl.uniform1f(accProg.u.uW, 1 / n);
          quad(accProg);
          gl.disable(gl.BLEND);
        }
      }
      const useDof = lens.k > 0 && lens.k * (1 / (lens.focus * 0.85) - 1 / lens.focus) > 1.0;
      const lensV = [lens.near || 0.01, lens.far || 1, lens.focus || 1, lens.k || 0];
      gl.disable(gl.DEPTH_TEST);
      if (useDof) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, half.fb);
        gl.viewport(0, 0, hw, hh);
        gl.useProgram(prepProg.p);
        bindTex(0, acc.t, prepProg.u.uSrc);
        bindTex(1, scene.d, prepProg.u.uDepth);
        gl.uniform2f(prepProg.u.uTexel, 1 / W, 1 / H);
        gl.uniform4fv(prepProg.u.uLens, lensV);
        quad(prepProg);
        gl.bindFramebuffer(gl.FRAMEBUFFER, tileMax.fb);
        gl.viewport(0, 0, tileMax.w, tileMax.h);
        gl.useProgram(tileMaxProg.p);
        bindTex(0, half.t, tileMaxProg.u.uHalf);
        gl.uniform2f(tileMaxProg.u.uHalfSize, hw, hh);
        quad(tileMaxProg);
        gl.bindFramebuffer(gl.FRAMEBUFFER, tileDil.fb);
        gl.useProgram(dilateProg.p);
        bindTex(0, tileMax.t, dilateProg.u.uTile);
        gl.uniform2f(dilateProg.u.uTileTexel, 1 / tileMax.w, 1 / tileMax.h);
        quad(dilateProg);
        gl.bindFramebuffer(gl.FRAMEBUFFER, blurred.fb);
        gl.viewport(0, 0, hw, hh);
        gl.useProgram(blurProg.p);
        bindTex(0, half.t, blurProg.u.uHalf);
        bindTex(1, tileDil.t, blurProg.u.uTile);
        gl.uniform2f(blurProg.u.uTexel, 1 / hw, 1 / hh);
        gl.uniform1f(blurProg.u.uMaxR, 30 * W / 1920);
        quad(blurProg);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(finalProg.p);
      bindTex(0, acc.t, finalProg.u.uAcc);
      bindTex(1, blurred.ts[0], finalProg.u.uFar);
      bindTex(2, blurred.ts[1], finalProg.u.uNear);
      bindTex(3, scene.d, finalProg.u.uDepth);
      gl.uniform4fv(finalProg.u.uLens, lensV);
      gl.uniform1f(finalProg.u.uDof, useDof ? 1 : 0);
      gl.uniform1f(finalProg.u.uExposure, look.exposure);
      gl.uniform1f(finalProg.u.uFade, look.fade);
      gl.uniform1f(finalProg.u.uFrame, Math.round(t * 24));
      gl.uniform1f(finalProg.u.uAspect, W / H);
      gl.uniform1f(finalProg.u.uCA, look.ca === undefined ? 0.0015 : look.ca);
      quad(finalProg);
    }

    return { render, addLayer, dispose };
  } catch (error) { dispose(); throw error; }
}

// Directional light from azimuth and elevation in degrees (azimuth 0 is +x, 90 is +y up the wall).
export function lightDir(az, el) {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  return v3norm([Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)]);
}
