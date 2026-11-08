/**
 * Turning build pieces strictly on the grid: quarter turns about up (R, `yaw`) and about the piece's own x axis
 * (T, `tilt`). A piece turned so stays a box along the world axes, so its space is a plain box (`min` + size).
 */

type V3 = [number, number, number];

/** Quarter turns: `tilt` about x (tipping over, applied first), then `yaw` about up. 0…3 each. */
export interface Turn {
  yaw: number;
  tilt: number;
}

const COS = [1, 0, -1, 0];
const SIN = [0, 1, 0, -1];
const q = (n: number) => ((Math.round(n) % 4) + 4) % 4;

/** A vector turned (three.js convention: yaw θ takes x to (cos θ, 0, −sin θ)). */
export function turn(v: V3, t: Turn): V3 {
  const ct = COS[q(t.tilt)]!, st = SIN[q(t.tilt)]!;
  const x = v[0], y = v[1] * ct - v[2] * st, z = v[1] * st + v[2] * ct;
  const cy = COS[q(t.yaw)]!, sy = SIN[q(t.yaw)]!;
  return [x * cy + z * sy, y, -x * sy + z * cy];
}

/** A box's size once turned. */
export const turnedSize = (size: V3, t: Turn): V3 => turn(size, t).map(Math.abs) as V3;

export const normTurn = (t: Partial<Turn> | undefined): Turn => ({ yaw: q(Number(t?.yaw) || 0), tilt: q(Number(t?.tilt) || 0) });

/** How much two boxes (min, size) overlap, as a share of the smaller one's volume (0: they don't). */
export function overlapShare(aMin: V3, aSize: V3, bMin: V3, bSize: V3): number {
  let v = 1;
  for (let k = 0; k < 3; k++) {
    const o = Math.min(aMin[k]! + aSize[k]!, bMin[k]! + bSize[k]!) - Math.max(aMin[k]!, bMin[k]!);
    if (o <= 0) return 0;
    v *= o;
  }
  const vol = (s: V3) => Math.max(1e-6, s[0] * s[1] * s[2]);
  return v / Math.min(vol(aSize), vol(bSize));
}

/** Where a ray meets a box along the world axes (distance and the face's outward normal; null: it misses). */
export function rayAabb(o: V3, d: V3, min: V3, size: V3): { distance: number; normal: V3 } | null {
  let t0 = -Infinity, t1 = Infinity, axis = 0, sign = 1;
  for (let k = 0; k < 3; k++) {
    const lo = min[k]!, hi = lo + size[k]!;
    if (Math.abs(d[k]!) < 1e-9) {
      if (o[k]! < lo || o[k]! > hi) return null;
      continue;
    }
    let a = (lo - o[k]!) / d[k]!, b = (hi - o[k]!) / d[k]!;
    let s = -1;
    if (a > b) {
      [a, b] = [b, a];
      s = 1;
    }
    if (a > t0) {
      t0 = a;
      axis = k;
      sign = s;
    }
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  if (t1 < 0 || t0 < 0) return null;
  const normal: V3 = [0, 0, 0];
  normal[axis] = sign;
  return { distance: t0, normal };
}
