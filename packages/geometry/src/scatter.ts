/**
 * Foliage placement (A2b): where grass tufts stand on a brush's upward-facing surfaces. Pure and seeded:
 * the same brush, settings and seed always give the same spots. Spots are spread out with a grid (no two in
 * one cell), so a dense patch looks even rather than clumped.
 */
import { buildMesh } from './mesh';
import type { Brush } from './brush';

export interface ScatterOptions {
  /** About how far apart the spots are (u). */
  spacing: number;
  /** Share of the spots that get a tuft, 0…1. */
  density: number;
  /** Tuft size (u); each varies by ±25%. */
  size: number;
  /** Steepest surface that grows tufts (degrees). */
  slope: number;
  seed: number;
  /** A cap on tufts per brush, so a huge surface can't freeze the editor. */
  max?: number;
}

/** One tuft: position (world), turn (radians), size (u) and the floor's normal there. TUFT_STRIDE numbers per tuft. */
export interface Tufts {
  count: number;
  data: Float32Array;
}

export const TUFT_MAX = 20000;
export const TUFT_STRIDE = 8;

/** A small seeded random generator (mulberry32): 0…1. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tufts on the upward-facing surfaces of a brush given in world space. */
export function scatterTufts(brush: Brush, o: ScatterOptions): Tufts {
  return scatterOnMesh(buildMesh([brush]), o);
}

/**
 * Tufts on the upward-facing triangles of any mesh in world space (a brush's, a terrain's). `keep` can leave
 * triangles out (by their first index's position in `indices`), e.g. a terrain's where a layer isn't painted.
 */
export function scatterOnMesh(mesh: { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number> }, o: ScatterOptions, keep?: (t: number) => boolean): Tufts {
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const minUp = Math.cos((Math.max(0, Math.min(90, o.slope)) * Math.PI) / 180);
  // Upward triangles, with their areas for an even spread.
  const tris: number[] = [];
  const cum: number[] = [];
  let total = 0;
  for (let t = 0; t + 2 < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const area = Math.hypot(cx, cy, cz) / 2;
    if (area <= 1e-6) continue;
    // Facing up: the vertices' normals, averaged.
    const ny = N[a + 1]! + N[b + 1]! + N[c + 1]!;
    const nl = Math.hypot(N[a]! + N[b]! + N[c]!, N[a + 1]! + N[b + 1]! + N[c + 1]!, N[a + 2]! + N[b + 2]! + N[c + 2]!) || 1;
    if (ny / nl < minUp) continue;
    if (keep && !keep(t)) continue;
    total += area;
    tris.push(t);
    cum.push(total);
  }
  if (!tris.length) return { count: 0, data: new Float32Array(0) };

  const rnd = seededRandom(o.seed);
  const want = Math.round((total / (o.spacing * o.spacing)) * Math.max(0, Math.min(1, o.density)));
  const max = o.max ?? TUFT_MAX;
  // (Plenty of tries: most land in a cell already taken once a patch fills up.)
  const tries = Math.min(want, max) * 8;
  const taken = new Set<string>();
  const out: number[] = [];
  for (let k = 0; k < tries && out.length / TUFT_STRIDE < max; k++) {
    // A triangle by area, then a uniform point on it.
    const pick = rnd() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m]! < pick) lo = m + 1;
      else hi = m;
    }
    const t = tris[lo]!;
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const r1 = Math.sqrt(rnd()), r2 = rnd();
    const wa = 1 - r1, wb = r1 * (1 - r2), wc = r1 * r2;
    const x = wa * P[a]! + wb * P[b]! + wc * P[c]!;
    const y = wa * P[a + 1]! + wb * P[b + 1]! + wc * P[c + 1]!;
    const z = wa * P[a + 2]! + wb * P[b + 2]! + wc * P[c + 2]!;
    // One tuft per cell of `spacing`, so they spread out.
    const cell = `${Math.floor(x / o.spacing)},${Math.floor(y / o.spacing)},${Math.floor(z / o.spacing)}`;
    if (taken.has(cell)) continue;
    taken.add(cell);
    // The floor's own normal (the face's, not smoothed), so the grass lights exactly like the ground under it.
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const flip = ny < 0 ? -1 : 1;
    nx = (nx / nl) * flip;
    ny = (ny / nl) * flip;
    nz = (nz / nl) * flip;
    out.push(x, y, z, rnd() * Math.PI * 2, o.size * (0.8 + 0.4 * rnd()), nx, ny, nz);
  }
  return { count: out.length / TUFT_STRIDE, data: Float32Array.from(out) };
}

/**
 * The surfaces that grow grass, as loose triangles (world positions, 9 numbers each), lifted a little along their
 * normals: drawn in the grass's root colour under the tufts, so no bare ground shows between them.
 */
export function grassCover(brush: Brush, slope: number, lift = 0.4): Float32Array {
  const mesh = buildMesh([brush]);
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const minUp = Math.cos((Math.max(0, Math.min(90, slope)) * Math.PI) / 180);
  const out: number[] = [];
  for (let t = 0; t + 2 < I.length; t += 3) {
    const v = [I[t]! * 3, I[t + 1]! * 3, I[t + 2]! * 3];
    const nx = N[v[0]!]! + N[v[1]!]! + N[v[2]!]!, ny = N[v[0]! + 1]! + N[v[1]! + 1]! + N[v[2]! + 1]!, nz = N[v[0]! + 2]! + N[v[1]! + 2]! + N[v[2]! + 2]!;
    const nl = Math.hypot(nx, ny, nz) || 1;
    if (ny / nl < minUp) continue;
    for (const k of v) out.push(P[k]! + (nx / nl) * lift, P[k + 1]! + (ny / nl) * lift, P[k + 2]! + (nz / nl) * lift);
  }
  return Float32Array.from(out);
}
