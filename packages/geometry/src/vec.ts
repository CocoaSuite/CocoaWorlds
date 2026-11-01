/** Small, allocation-light vector helpers on plain [x, y, z] tuples (the same shape as core's Vec3). */
export type V3 = [number, number, number];

export const v = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function normalize(a: V3): V3 {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

export const dist = (a: V3, b: V3): number => len(sub(a, b));

/** Round to a fixed grid (default 1/1024 unit) so values that should be equal compare equal after arithmetic. */
export function quantize(a: V3, q = 1024): V3 {
  const r = (n: number) => {
    const x = Math.round(n * q) / q;
    return x === 0 ? 0 : x; // no negative zero in saved files
  };
  return [r(a[0]), r(a[1]), r(a[2])];
}

export function eq(a: V3, b: V3, eps: number): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
}

/** A 4×4 column-major matrix (same layout as Three.js `Matrix4.elements`). */
export type M4 = number[];

export function applyM4(m: M4, p: V3): V3 {
  const [x, y, z] = p;
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]! || 1;
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w,
  ];
}

/** Rotation (degrees, YXZ order, matching the engine's Euler convention) + uniform/non-uniform scale + translation about a pivot. */
export function composeM4(t: V3, rotDeg: V3, s: V3, pivot: V3 = [0, 0, 0]): M4 {
  const [rx, ry, rz] = rotDeg.map((d) => (d * Math.PI) / 180) as V3;
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Ry * Rx * Rz (YXZ)
  const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
  const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
  const m = [
    r00 * s[0], r10 * s[0], r20 * s[0], 0,
    r01 * s[1], r11 * s[1], r21 * s[1], 0,
    r02 * s[2], r12 * s[2], r22 * s[2], 0,
    0, 0, 0, 1,
  ];
  // translate(pivot + t) * RS * translate(-pivot)
  const rp = applyM4(m, pivot);
  m[12] = pivot[0] + t[0] - rp[0];
  m[13] = pivot[1] + t[1] - rp[1];
  m[14] = pivot[2] + t[2] - rp[2];
  return m;
}
