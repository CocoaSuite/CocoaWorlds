/**
 * Planes and windings (convex polygons), the two building blocks of brush geometry.
 * A plane is n·p = d with unit normal n pointing OUT of the solid; "front" means outside.
 */
import { add, cross, dot, len, lerp, normalize, scale, sub, type V3 } from './vec';

/** Distance tolerance in world units. Points closer than this to a plane count as on it. */
export const EPS = 1e-3;
/** Half-size of the polygon a plane starts as before clipping; must exceed any level coordinate. */
const HUGE = 1 << 20;

export interface Plane {
  n: V3;
  d: number;
}

export function planeFromPoints(a: V3, b: V3, c: V3): Plane | null {
  const n = cross(sub(b, a), sub(c, a));
  const l = len(n);
  if (l < 1e-9) return null;
  const nn = scale(n, 1 / l);
  return { n: nn, d: dot(nn, a) };
}

export const signedDist = (p: Plane, x: V3): number => dot(p.n, x) - p.d;
export const flip = (p: Plane): Plane => ({ n: [-p.n[0], -p.n[1], -p.n[2]], d: -p.d });

/** True when two planes are the same surface facing the same way. */
export function samePlane(a: Plane, b: Plane, eps = EPS): boolean {
  return dot(a.n, b.n) > 1 - 1e-6 && Math.abs(a.d - b.d) < eps;
}

export type Winding = V3[];

/** A huge square lying on the plane, wound counter-clockwise when seen from the front. */
export function baseWinding(p: Plane): Winding {
  const n = p.n;
  // Pick the world axis least aligned with the normal to build a tangent frame.
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const up: V3 = ay <= ax && ay <= az ? [0, 1, 0] : ax <= az ? [1, 0, 0] : [0, 0, 1];
  const u = normalize(cross(up, n));
  const w = cross(n, u);
  const o = scale(n, p.d);
  const U = scale(u, HUGE), W = scale(w, HUGE);
  return [add(sub(o, U), sub([0, 0, 0], W)), add(add(o, U), scale(W, -1)), add(add(o, U), W), add(sub(o, U), W)].map(
    (q) => q,
  );
}

export interface ClipResult {
  front: Winding | null;
  back: Winding | null;
  /** True when every point lies on the plane. */
  onPlane: boolean;
}

/** Split a convex polygon by a plane into the part in front of it and the part behind it. */
export function clipWinding(w: Winding, p: Plane, eps = EPS): ClipResult {
  const dists = w.map((x) => signedDist(p, x));
  const sides = dists.map((d) => (d > eps ? 1 : d < -eps ? -1 : 0));
  const hasFront = sides.some((s) => s > 0);
  const hasBack = sides.some((s) => s < 0);
  if (!hasFront && !hasBack) return { front: null, back: null, onPlane: true };
  if (!hasBack) return { front: w, back: null, onPlane: false };
  if (!hasFront) return { front: null, back: w, onPlane: false };

  const front: Winding = [];
  const back: Winding = [];
  for (let i = 0; i < w.length; i++) {
    const a = w[i]!, b = w[(i + 1) % w.length]!;
    const sa = sides[i]!, sb = sides[(i + 1) % w.length]!;
    if (sa >= 0) front.push(a);
    if (sa <= 0) back.push(a);
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const da = dists[i]!, db = dists[(i + 1) % w.length]!;
      const mid = lerp(a, b, da / (da - db));
      front.push(mid);
      back.push(mid);
    }
  }
  return { front: front.length >= 3 ? front : null, back: back.length >= 3 ? back : null, onPlane: false };
}

/** Remove points that are (nearly) duplicates or lie on a straight edge between their neighbours. */
export function cleanWinding(w: Winding, eps = EPS): Winding {
  const out: Winding = [];
  for (const p of w) {
    const last = out[out.length - 1];
    if (!last || len(sub(p, last)) > eps) out.push(p);
  }
  while (out.length > 1 && len(sub(out[0]!, out[out.length - 1]!)) <= eps) out.pop();
  // Drop collinear points.
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length]!, b = out[i]!, c = out[(i + 1) % out.length]!;
      const ab = sub(b, a), bc = sub(c, b);
      const area = len(cross(ab, bc));
      if (area <= eps * Math.max(len(ab), len(bc), 1)) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export function windingArea(w: Winding): number {
  let s: V3 = [0, 0, 0];
  for (let i = 1; i + 1 < w.length; i++) s = add(s, cross(sub(w[i]!, w[0]!), sub(w[i + 1]!, w[0]!)));
  return len(s) / 2;
}

export function windingCenter(w: Winding): V3 {
  let c: V3 = [0, 0, 0];
  for (const p of w) c = add(c, p);
  return scale(c, 1 / w.length);
}
