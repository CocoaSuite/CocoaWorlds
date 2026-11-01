/**
 * 4×4 matrices for nested transforms, column-major like Three.js and glTF (element [12..14] is the translation).
 * Rotation order matches `Transform`: Euler degrees applied Y, then X, then Z.
 */
import { identityTransform, type Transform, type Vec3 } from './math';

export type Mat4 = number[];

const DEG = Math.PI / 180;

export const identityMat4 = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** T · R · S for a transform. */
export function composeTransform(t: Transform): Mat4 {
  const [x, y, z] = t.rotation.map((d) => d * DEG) as Vec3;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;
  const [sx, sy, sz] = t.scale;
  return [
    (ce + df * b) * sx, a * f * sx, (cf * b - de) * sx, 0,
    (de * b - cf) * sy, a * e * sy, (df + ce * b) * sy, 0,
    a * d * sz, -b * sz, a * c * sz, 0,
    t.position[0], t.position[1], t.position[2], 1,
  ];
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row]! * b[col * 4 + k]!;
      o[col * 4 + row] = s;
    }
  return o;
}

export function invertMat4(m: Mat4): Mat4 | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det || !Number.isFinite(det)) return null;
  const i = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * i, (a02 * b10 - a01 * b11 - a03 * b09) * i, (a31 * b05 - a32 * b04 + a33 * b03) * i, (a22 * b04 - a21 * b05 - a23 * b03) * i,
    (a12 * b08 - a10 * b11 - a13 * b07) * i, (a00 * b11 - a02 * b08 + a03 * b07) * i, (a32 * b02 - a30 * b05 - a33 * b01) * i, (a20 * b05 - a22 * b02 + a23 * b01) * i,
    (a10 * b10 - a11 * b08 + a13 * b06) * i, (a01 * b08 - a00 * b10 - a03 * b06) * i, (a30 * b04 - a31 * b02 + a33 * b00) * i, (a21 * b02 - a20 * b04 - a23 * b00) * i,
    (a11 * b07 - a10 * b09 - a12 * b06) * i, (a00 * b09 - a01 * b07 + a02 * b06) * i, (a31 * b01 - a30 * b03 - a32 * b00) * i, (a20 * b03 - a21 * b01 + a22 * b00) * i,
  ];
}

export function applyMat4(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

const clean = (n: number, step = 1e-4) => {
  const r = Math.round(n / step) * step;
  const v = Math.abs(r) < step / 2 ? 0 : r;
  // Strip float noise such as 0.30000000000000004.
  return Number(v.toFixed(6));
};

/** Position, YXZ rotation in degrees and scale. Assumes no shear (true for any chain of uniform scales). */
export function decomposeMat4(m: Mat4): Transform {
  const len = (i: number) => Math.hypot(m[i]!, m[i + 1]!, m[i + 2]!);
  let sx = len(0);
  const sy = len(4), sz = len(8);
  const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
  if (det < 0) sx = -sx;
  if (!sx || !sy || !sz) return { ...identityTransform(), position: [clean(m[12]!), clean(m[13]!), clean(m[14]!)] };
  const m11 = m[0]! / sx, m21 = m[1]! / sx, m31 = m[2]! / sx;
  const m12 = m[4]! / sy, m22 = m[5]! / sy;
  const m13 = m[8]! / sz, m23 = m[9]! / sz, m33 = m[10]! / sz;
  const x = Math.asin(-Math.max(-1, Math.min(1, m23)));
  let y: number, z: number;
  if (Math.abs(m23) < 0.9999999) {
    y = Math.atan2(m13, m33);
    z = Math.atan2(m21, m22);
  } else {
    y = Math.atan2(-m31, m11);
    z = 0;
  }
  return {
    position: [clean(m[12]!), clean(m[13]!), clean(m[14]!)],
    rotation: [clean(x / DEG), clean(y / DEG), clean(z / DEG)],
    scale: [clean(sx), clean(sy), clean(sz)],
  };
}

export function isIdentityMat4(m: Mat4, eps = 1e-9): boolean {
  const id = identityMat4();
  return m.every((v, i) => Math.abs(v - id[i]!) <= eps);
}

/** True when the matrix only moves (no rotation or scale). */
export function isTranslationMat4(m: Mat4, eps = 1e-9): boolean {
  const id = identityMat4();
  for (let i = 0; i < 12; i++) if (Math.abs(m[i]! - id[i]!) > eps) return false;
  return Math.abs(m[15]! - 1) <= eps;
}

export const translationOf = (m: Mat4): Vec3 => [m[12]!, m[13]!, m[14]!];

/** A short key for caching things that depend on a matrix. */
export const mat4Key = (m: Mat4): string => m.map((v) => Math.round(v * 1e6)).join(',');
