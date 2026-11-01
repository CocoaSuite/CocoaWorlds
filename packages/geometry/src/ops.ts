/**
 * Brush operations: move/transform, split by a plane, carve (subtract), intersect and convex merge.
 *
 * Carve follows the classic brush-CSG method used by Quake/Hammer-family editors: the target is split by each
 * plane of the cutter in turn; every piece that falls outside a cutter plane is kept as its own convex brush,
 * and whatever ends up inside all of them is the overlap, which is discarded. Results are therefore always
 * convex, closed and editable, and they keep the original faces' materials and texture alignment.
 */
import {
  bounds,
  cloneSurface,
  polygonPlane,
  polygons,
  simplify,
  validate,
  vertices,
  volume,
  type Brush,
  type BrushFace,
  type FaceSurface,
} from './brush';
import { EPS, flip, planeFromPoints, samePlane, signedDist, type Plane } from './plane';
import { lockedOffset } from './uv';
import { add, applyM4, cross, dot, scale, sub, type M4, type V3 } from './vec';

/** Smallest volume (cubic units) for a piece to count as real; smaller slivers are dropped. */
export const MIN_PIECE_VOLUME = 0.01;

export function cloneBrush(b: Brush): Brush {
  const faces = b.faces.map((f) => ({ plane: { n: [...f.plane.n] as V3, d: f.plane.d }, surface: cloneSurface(f.surface) }));
  return b.mesh ? { faces, mesh: { verts: b.mesh.verts.map((v) => [...v] as V3), polys: b.mesh.polys.map((p) => [...p]) } } : { faces };
}

/** Move a brush. With `textureLock` the textures stay glued to the faces instead of sliding. */
export function translate(b: Brush, delta: V3, textureLock = true): Brush {
  const faces = b.faces.map((f) => ({
    plane: { n: [...f.plane.n] as V3, d: f.plane.d + dot(f.plane.n, delta) },
    surface: textureLock ? { ...cloneSurface(f.surface), offset: lockedOffset(f.plane, f.surface, delta) } : cloneSurface(f.surface),
  }));
  if (!b.mesh) return { faces };
  return { faces, mesh: { verts: b.mesh.verts.map((v) => add(v, delta)), polys: b.mesh.polys.map((p) => [...p]) } };
}

/**
 * Apply an affine matrix (rotation, scale, mirror, translation). Planes are rebuilt from the transformed
 * face polygons, so non-uniform scale and mirroring stay exact. World-aligned textures re-project.
 */
export function transform(b: Brush, m: M4): Brush {
  const polys = polygons(b);
  const det =
    m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
  if (b.mesh) {
    const verts = b.mesh.verts.map((v) => applyM4(m, v));
    const mpolys = b.mesh.polys.map((p) => (det < 0 ? [...p].reverse() : [...p]));
    const faces = mpolys.map((p, i) => ({
      plane: polygonPlane(p.map((k) => verts[k]!)) ?? { n: [0, 0, 1] as V3, d: 0 },
      surface: cloneSurface(b.faces[i]!.surface),
    }));
    return { faces, mesh: { verts, polys: mpolys } };
  }
  const faces: BrushFace[] = [];
  for (const p of polys) {
    let pts = p.points.map((x) => applyM4(m, x));
    if (det < 0) pts = pts.reverse();
    const plane = widestPlane(pts);
    if (plane) faces.push({ plane, surface: cloneSurface(p.surface) });
  }
  return { faces };
}

function widestPlane(pts: V3[]): Plane | null {
  let best: Plane | null = null;
  let bestArea = 0;
  const n = pts.length;
  for (let i = 1; i + 1 < n; i++) {
    const a = pts[0]!, b = pts[Math.floor(i)]!, c = pts[i + 1]!;
    const pl = planeFromPoints(a, b, c);
    if (!pl) continue;
    const area = Math.abs(dot(pl.n, pl.n)) * triArea(a, b, c);
    if (area > bestArea) {
      bestArea = area;
      best = pl;
    }
  }
  return best;
}

function triArea(a: V3, b: V3, c: V3): number {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cr: V3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  return Math.sqrt(dot(cr, cr)) / 2;
}

/** Which side of a plane the brush lies on. */
export function classify(b: Brush, p: Plane, eps = EPS): 'front' | 'back' | 'spanning' | 'empty' {
  const vs = vertices(b, eps);
  if (!vs.length) return 'empty';
  let f = false, k = false;
  for (const x of vs) {
    const d = signedDist(p, x);
    if (d > eps) f = true;
    else if (d < -eps) k = true;
  }
  return f && k ? 'spanning' : f ? 'front' : 'back';
}

/**
 * Split a brush by a plane. Returns the part in front (outside, the side the normal points to) and the part
 * behind. New cap faces use `capSurface`. A side is null when the plane doesn't cut into it.
 */
export function split(b: Brush, p: Plane, capSurface: FaceSurface): { front: Brush | null; back: Brush | null } {
  const side = classify(b, p);
  if (side === 'empty') return { front: null, back: null };
  if (side === 'front') return { front: b, back: null };
  if (side === 'back') return { front: null, back: b };
  const front = keepSolid(simplify({ faces: [...b.faces, { plane: flip(p), surface: cloneSurface(capSurface) }] }));
  const back = keepSolid(simplify({ faces: [...b.faces, { plane: { n: [...p.n] as V3, d: p.d }, surface: cloneSurface(capSurface) }] }));
  return { front, back };
}

function keepSolid(b: Brush): Brush | null {
  return polygons(b).length >= 4 && volume(b) > MIN_PIECE_VOLUME ? b : null;
}

/** True when the two brushes share interior volume (touching faces don't count). */
export function overlaps(a: Brush, b: Brush): boolean {
  if (a.mesh || b.mesh) {
    // Edited meshes: by their bounds (good enough for "does this touch that").
    const x = bounds(a), y = bounds(b);
    return !!x && !!y && [0, 1, 2].every((k) => x.min[k]! < y.max[k]! - EPS && y.min[k]! < x.max[k]! - EPS);
  }
  // Separating-plane test using both brushes' face planes; enough for convex solids in practice,
  // backed by an intersection-volume check to rule out edge-on cases.
  for (const f of a.faces) if (classify(b, f.plane) === 'front') return false;
  for (const f of b.faces) if (classify(a, f.plane) === 'front') return false;
  const i = intersect(a, b);
  return !!i && volume(i) > MIN_PIECE_VOLUME;
}

/** The surface to put on a newly cut face: the target face whose direction best matches the new face. */
function matchSurface(target: Brush, normal: V3): FaceSurface {
  let best = target.faces[0]!.surface;
  let bestDot = -Infinity;
  for (const f of target.faces) {
    const d = dot(f.plane.n, normal);
    if (d > bestDot) {
      bestDot = d;
      best = f.surface;
    }
  }
  return best;
}

/**
 * Subtract `cutter` from `target`. Returns the remaining convex pieces (an empty list when the cutter
 * swallows the target, `[target]` unchanged when they don't overlap). Faces created by the cut take the
 * material of the target face pointing the same way, so a doorway's sides look like the wall.
 */
export function carve(target: Brush, cutter: Brush): Brush[] {
  return carveDetailed(target, cutter).pieces;
}

export interface CarveResult {
  pieces: Brush[];
  /** Slivers thinner than MIN_THICKNESS and smaller than SLIVER_VOLUME that could not be merged into a neighbour. */
  droppedSlivers: number;
}

/** Slivers at most this many cubic units may be dropped after carving. */
export const SLIVER_VOLUME = 8;

/**
 * Carve, then tidy up: pieces whose union is convex are merged back together (fewer, larger brushes), and
 * hair-thin slivers left by nearly parallel cutter faces are removed when they are negligibly small.
 */
export function carveDetailed(target: Brush, cutter: Brush): CarveResult {
  // Edited meshes (G4) are not cut and do not cut: CSG needs convex brushes.
  if (target.mesh || cutter.mesh || !overlaps(target, cutter)) return { pieces: [target], droppedSlivers: 0 };
  const merged = mergeAll(rawCarve(target, cutter));
  const pieces: Brush[] = [];
  let droppedSlivers = 0;
  for (const p of merged) {
    if (validate(p).includes('too-thin') && volume(p) <= SLIVER_VOLUME) droppedSlivers++;
    else pieces.push(p);
  }
  return { pieces, droppedSlivers };
}

function rawCarve(target: Brush, cutter: Brush): Brush[] {
  const pieces: Brush[] = [];
  let rest: Brush | null = target;
  for (const f of cutter.faces) {
    if (!rest) break;
    // The cap on the outside piece faces back toward the hole.
    const cap = matchSurface(target, scale(f.plane.n, -1));
    const { front, back } = split(rest, f.plane, cap);
    if (front) pieces.push(front);
    rest = back;
  }
  return pieces;
}

/** The overlapping volume of two brushes, or null. New faces take the second brush's surfaces. */
export function intersect(a: Brush, b: Brush): Brush | null {
  let rest: Brush | null = a;
  for (const f of b.faces) {
    if (!rest) return null;
    rest = split(rest, f.plane, f.surface).back;
  }
  return rest;
}

/**
 * Merge two brushes into one when their union is itself convex (e.g. two boxes side by side forming a longer box).
 * Returns null when the union would not be convex; callers then keep them as a group.
 */
export function mergeConvex(a: Brush, b: Brush): Brush | null {
  if (a.mesh || b.mesh) return null;
  const pts = [...vertices(a), ...vertices(b)];
  if (!pts.length) return null;
  const faces: BrushFace[] = [];
  for (const f of [...a.faces, ...b.faces]) {
    if (faces.some((g) => samePlane(g.plane, f.plane))) continue;
    if (pts.every((p) => signedDist(f.plane, p) <= EPS * 4)) faces.push({ plane: f.plane, surface: cloneSurface(f.surface) });
  }
  const merged = simplify({ faces });
  if (polygons(merged).length < 4) return null;
  const inter = intersect(a, b);
  const expected = volume(a) + volume(b) - (inter ? volume(inter) : 0);
  const got = volume(merged);
  return Math.abs(got - expected) <= Math.max(0.5, expected * 1e-6) ? merged : null;
}

/** Union of many brushes: greedily merge pairs whose union is convex. Returns the reduced list. */
export function mergeAll(brushes: Brush[]): Brush[] {
  const list = [...brushes];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const m = mergeConvex(list[i]!, list[j]!);
        if (m) {
          list.splice(j, 1);
          list[i] = m;
          merged = true;
          break outer;
        }
      }
    }
  }
  return list;
}

/** Move a single plane of the brush outward/inward along its normal (face drag). Returns null if the result collapses. */
export function pushFace(b: Brush, faceIndex: number, distance: number): Brush | null {
  if (b.mesh) return null;
  const faces = b.faces.map((f, i) =>
    i === faceIndex ? { plane: { n: [...f.plane.n] as V3, d: f.plane.d + distance }, surface: cloneSurface(f.surface) } : f,
  );
  return keepSolid(simplify({ faces }));
}

export const offsetPoint = (p: V3, n: V3, d: number): V3 => add(p, scale(n, d));

/**
 * The clip plane for two points drawn in a view: it contains both points and the view's depth direction
 * (`along`), like Hammer's clipper. Null when the points coincide or the line runs along `along`.
 */
export function clipPlane(a: V3, b: V3, along: V3): Plane | null {
  const n = cross(sub(b, a), along);
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-9) return null;
  const u: V3 = [n[0] / len, n[1] / len, n[2] / len];
  return { n: u, d: dot(u, a) };
}

/**
 * Clip a brush with a plane. `front` is the piece on the side the normal points to. Each new cap face takes
 * the surface of the brush face pointing the same way, so a clipped wall keeps its look. Brushes the plane
 * doesn't cut come back whole on their side.
 */
export function clipBrush(b: Brush, p: Plane): { front: Brush | null; back: Brush | null; cut: boolean } {
  const side = classify(b, p);
  // An edited mesh can't be clipped (G4); it stays whole, on the side most of it is on.
  if (b.mesh && side === 'spanning') return { front: null, back: b, cut: false };
  if (side !== 'spanning') return { front: side === 'front' ? b : null, back: side === 'back' ? b : null, cut: false };
  const front = split(b, p, matchSurface(b, scale(p.n, -1))).front;
  const back = split(b, p, matchSurface(b, p.n)).back;
  return { front, back, cut: true };
}
