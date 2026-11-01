/**
 * Convex brushes.
 *
 * A brush is a list of faces; each face is a plane (normal pointing out) plus the surface data painted on it.
 * The solid is the space behind every plane. Vertices, edges and polygons are derived by clipping each
 * face's plane by all the others, so a brush made of planes is always closed and convex by construction.
 */
import { EPS, baseWinding, cleanWinding, clipWinding, planeFromPoints, samePlane, signedDist, windingArea, type Plane, type Winding } from './plane';
import { add, cross, dot, eq, quantize, scale, sub, type V3 } from './vec';

/** How a texture is projected onto a face. */
export interface FaceSurface {
  /** Material asset id (or a built-in name such as `dev/grid`). */
  material: string;
  /** Texture offset in texels. */
  offset: [number, number];
  /** World units per texel (Hammer convention: 0.25 = four texels per unit). */
  scale: [number, number];
  /** Texture rotation in degrees. */
  rotation: number;
  /**
   * `world`: projected along the nearest world axis, so neighbouring faces line up (default, survives cutting).
   * `face`: projected along the face's own plane, so textures follow slopes.
   */
  align: 'world' | 'face';
}

export interface BrushFace {
  plane: Plane;
  surface: FaceSurface;
}

export interface Brush {
  faces: BrushFace[];
}

export interface BrushPolygon {
  face: number;
  plane: Plane;
  surface: FaceSurface;
  /** Counter-clockwise when seen from outside. */
  points: Winding;
}

export const DEFAULT_MATERIAL = 'dev/grid';

export const defaultSurface = (material = DEFAULT_MATERIAL): FaceSurface => ({
  material,
  offset: [0, 0],
  scale: [0.25, 0.25],
  rotation: 0,
  align: 'world',
});

export const cloneSurface = (s: FaceSurface): FaceSurface => ({ ...s, offset: [...s.offset], scale: [...s.scale] });

/** The polygon of every face that actually touches the solid. Faces that are fully clipped away are omitted. */
export function polygons(b: Brush, eps = EPS): BrushPolygon[] {
  const out: BrushPolygon[] = [];
  b.faces.forEach((f, i) => {
    let w: Winding | null = baseWinding(f.plane);
    for (let j = 0; j < b.faces.length && w; j++) {
      if (j === i) continue;
      const other = b.faces[j]!.plane;
      if (samePlane(other, f.plane, eps)) {
        // Duplicate plane: keep only the first copy.
        if (j < i) w = null;
        continue;
      }
      const r = clipWinding(w, other, eps);
      w = r.onPlane ? null : r.back;
    }
    if (!w) return;
    w = cleanWinding(w, eps);
    if (w.length >= 3 && windingArea(w) > eps * eps) out.push({ face: i, plane: f.plane, surface: f.surface, points: w });
  });
  return out;
}

/** Unique corner points of the solid. */
export function vertices(b: Brush, eps = EPS): V3[] {
  const out: V3[] = [];
  for (const p of polygons(b, eps)) for (const x of p.points) if (!out.some((y) => eq(x, y, eps * 4))) out.push(x);
  return out;
}

/** Unique edges as index pairs into `vertices(b)`. */
export function edges(b: Brush, eps = EPS): { verts: V3[]; edges: [number, number][] } {
  const verts = vertices(b, eps);
  const idx = (p: V3) => verts.findIndex((q) => eq(p, q, eps * 4));
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const poly of polygons(b, eps)) {
    for (let i = 0; i < poly.points.length; i++) {
      const a = idx(poly.points[i]!), c = idx(poly.points[(i + 1) % poly.points.length]!);
      if (a < 0 || c < 0 || a === c) continue;
      const k = a < c ? `${a}:${c}` : `${c}:${a}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push([Math.min(a, c), Math.max(a, c)]);
      }
    }
  }
  return { verts, edges: out };
}

/** Volume by the divergence theorem over the face polygons. */
export function volume(b: Brush): number {
  let v = 0;
  for (const p of polygons(b)) {
    const w = p.points;
    for (let i = 1; i + 1 < w.length; i++) v += dot(w[0]!, cross(w[i]!, w[i + 1]!));
  }
  return v / 6;
}

export function bounds(b: Brush): { min: V3; max: V3 } | null {
  const vs = vertices(b);
  if (!vs.length) return null;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of vs) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i]!, p[i]!);
    max[i] = Math.max(max[i]!, p[i]!);
  }
  return { min, max };
}

export function center(b: Brush): V3 {
  const bb = bounds(b);
  return bb ? scale(add(bb.min, bb.max), 0.5) : [0, 0, 0];
}

/** True if the point is inside (or on the surface of) the solid. */
export function containsPoint(b: Brush, p: V3, eps = EPS): boolean {
  return b.faces.every((f) => signedDist(f.plane, p) <= eps);
}

/** Drop faces that don't contribute a polygon (redundant planes). Keeps surfaces of the faces that remain. */
export function simplify(b: Brush, eps = EPS): Brush {
  const keep = new Set(polygons(b, eps).map((p) => p.face));
  return { faces: b.faces.filter((_, i) => keep.has(i)) };
}

// ── validation ──

export type BrushProblem = 'too-few-faces' | 'not-closed' | 'too-thin' | 'too-large' | 'non-finite';

/** Smallest allowed thickness, in units. Thinner solids cause physics and rendering trouble. */
export const MIN_THICKNESS = 0.5;
export const MAX_COORD = 65536;

export function validate(b: Brush): BrushProblem[] {
  const problems: BrushProblem[] = [];
  if (b.faces.some((f) => ![...f.plane.n, f.plane.d].every(Number.isFinite))) return ['non-finite'];
  const polys = polygons(b);
  if (polys.length < 4) return ['too-few-faces'];
  // Closed: every polygon edge is shared by exactly two polygons.
  const vs = vertices(b);
  const key = (p: V3) => vs.findIndex((q) => eq(p, q, EPS * 4));
  const count = new Map<string, number>();
  for (const p of polys) {
    for (let i = 0; i < p.points.length; i++) {
      const a = key(p.points[i]!), c = key(p.points[(i + 1) % p.points.length]!);
      const k = a < c ? `${a}:${c}` : `${c}:${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  if ([...count.values()].some((n) => n !== 2)) problems.push('not-closed');
  // Thickness: distance across the solid along each face normal.
  for (const f of b.faces) {
    let depth = 0;
    for (const p of vs) depth = Math.max(depth, -signedDist(f.plane, p));
    if (depth < MIN_THICKNESS) {
      problems.push('too-thin');
      break;
    }
  }
  if (vs.some((p) => p.some((c) => Math.abs(c) > MAX_COORD))) problems.push('too-large');
  return problems;
}

export const isValid = (b: Brush) => validate(b).length === 0;

// ── construction ──

/** Build a brush from outward-facing planes. */
export function fromPlanes(planes: Plane[], surface: FaceSurface = defaultSurface()): Brush {
  return { faces: planes.map((p) => ({ plane: p, surface: cloneSurface(surface) })) };
}

// ── serialization ──
//
// On disk each face stores three points on its plane (as Hammer's .vmf does) instead of a normal and distance.
// Points on the grid stay exact integers, so axis-aligned and grid-snapped brushes never drift when saved and reopened.

export interface FaceData extends FaceSurface {
  points: [V3, V3, V3];
}

export interface BrushData {
  faces: FaceData[];
}

export function toData(b: Brush): BrushData {
  const polys = polygons(b);
  return {
    faces: polys.map((p) => {
      const pts = pickPlanePoints(p.points, p.plane);
      return { ...cloneSurface(p.surface), points: pts };
    }),
  };
}

export function fromData(d: BrushData): Brush {
  const faces: BrushFace[] = [];
  for (const f of d.faces) {
    const plane = planeFromPoints(f.points[0], f.points[1], f.points[2]);
    if (!plane) continue;
    const { points: _points, ...surface } = f;
    faces.push({ plane, surface: cloneSurface(surface) });
  }
  return { faces };
}

/** Three well-separated polygon corners (rounded to 1/1024 unit), ordered so their plane normal faces out. */
function pickPlanePoints(w: Winding, plane: Plane): [V3, V3, V3] {
  const q = w.map((p) => quantize(p));
  let best: [V3, V3, V3] = [q[0]!, q[1]!, q[2]!];
  let bestArea = -1;
  const n = q.length;
  // The widest triangle from evenly spread corners keeps the derived plane accurate.
  for (let i = 0; i < n; i++) {
    const a = q[0]!, b = q[Math.floor(n / 3) || 1]!, c = q[Math.floor((2 * n) / 3) || 2]!;
    const area = cross(sub(b, a), sub(c, a));
    const s = dot(area, plane.n);
    if (s > bestArea) {
      bestArea = s;
      best = [a, b, c];
    }
    q.push(q.shift()!);
  }
  return best;
}
