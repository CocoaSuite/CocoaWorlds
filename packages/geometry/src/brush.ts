/**
 * Convex brushes.
 *
 * A brush is a list of faces; each face is a plane (normal pointing out) plus the surface data painted on it.
 * The solid is the space behind every plane. Vertices, edges and polygons are derived by clipping each
 * face's plane by all the others, so a brush made of planes is always closed and convex by construction.
 *
 * An **edited mesh** (decision G4) is a brush whose corners were moved freely, possibly into a shape that is
 * no longer convex. It keeps its corners and polygons explicitly in `mesh`; `faces[i]` is the plane and
 * surface of `mesh.polys[i]`, so everything that works face by face (painting, picking, drawing) treats both
 * kinds alike. Every mesh polygon is flat and convex: a corner move that bends or dents one splits it into
 * triangles.
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
  /** `#rrggbb` multiplied into the material's colour on this face (missing: none, as white). */
  tint?: string;
}

export interface BrushFace {
  plane: Plane;
  surface: FaceSurface;
}

export interface EditMesh {
  verts: V3[];
  /** Corner indices of each polygon, counter-clockwise from outside; `polys[i]` belongs to `faces[i]`. */
  polys: number[][];
}

export interface Brush {
  faces: BrushFace[];
  /** Present on edited meshes (G4): the explicit corners and polygons. */
  mesh?: EditMesh;
}

export const isEditMesh = (b: Brush): b is Brush & { mesh: EditMesh } => !!b.mesh;

export interface BrushPolygon {
  face: number;
  plane: Plane;
  surface: FaceSurface;
  /** Counter-clockwise when seen from outside. */
  points: Winding;
}

export const DEFAULT_MATERIAL = 'dev/grid';

/** COL: an invisible collider. Faces with it collide in the game but are never drawn there (the editor shows them). */
export const COLLIDER_MATERIAL = 'tool/col';

/** NOGRASS: never drawn in the game and collides with nothing, but clears grass (Foliage) where it stands. */
export const NOGRASS_MATERIAL = 'tool/nograss';

/** Materials that are not drawn in the game. */
export const isInvisibleMaterial = (material: string): boolean => material === COLLIDER_MATERIAL || material === NOGRASS_MATERIAL;

/** A brush made only of NOGRASS: no collision, nothing drawn in the game; it only clears grass. */
export const isNoGrassBrush = (b: Brush): boolean => b.faces.length > 0 && b.faces.every((f) => f.surface.material === NOGRASS_MATERIAL);

export const defaultSurface = (material = DEFAULT_MATERIAL): FaceSurface => ({
  material,
  offset: [0, 0],
  scale: [0.25, 0.25],
  rotation: 0,
  align: 'world',
});

export const cloneSurface = (s: FaceSurface): FaceSurface => ({ ...s, offset: [...s.offset], scale: [...s.scale] });

/**
 * Polygons worked out before, by brush. Brushes are never changed in place (every edit makes a new one), so
 * the editor asking again for the same brush (selection outlines, the Inspector, the gizmo) costs nothing.
 */
const polyCache = new WeakMap<Brush, { eps: number; faces: BrushFace[]; polys: BrushPolygon[] }>();

/** The polygon of every face that actually touches the solid. Faces that are fully clipped away are omitted. */
export function polygons(b: Brush, eps = EPS): BrushPolygon[] {
  if (b.mesh) return clipPolygons(b, eps);
  const hit = polyCache.get(b);
  if (hit && hit.eps === eps && hit.faces === b.faces) return hit.polys.map((p) => ({ ...p, points: p.points.slice() }));
  const polys = clipPolygons(b, eps);
  polyCache.set(b, { eps, faces: b.faces, polys });
  return polys.map((p) => ({ ...p, points: p.points.slice() }));
}

function clipPolygons(b: Brush, eps: number): BrushPolygon[] {
  const out: BrushPolygon[] = [];
  if (b.mesh) {
    const { verts, polys } = b.mesh;
    polys.forEach((poly, i) => {
      const f = b.faces[i];
      if (f && poly.length >= 3) out.push({ face: i, plane: f.plane, surface: f.surface, points: poly.map((k) => verts[k]!) });
    });
    return out;
  }
  const buckets: number[][] = NEAR.map(() => []);
  b.faces.forEach((f, i) => {
    let w: Winding | null = baseWinding(f.plane);
    // Neighbours first (the planes facing most nearly the same way): the polygon shrinks to its final size in
    // a few cuts, and every later plane is then passed over without any work (many-sided spheres, cylinders).
    // (Rough buckets rather than a sort: sorting every face's planes costs more than it saves.)
    const n = f.plane.n;
    for (const bk of buckets) bk.length = 0;
    for (let j = 0; j < b.faces.length; j++) {
      const d = dot(b.faces[j]!.plane.n, n);
      let k = 0;
      while (d < NEAR[k]!) k++;
      buckets[k]!.push(j);
    }
    // A ball around the polygon: a plane that has the whole ball behind it can't cut the polygon.
    let ball = enclose(w);
    for (const bucket of buckets)
      for (const j of bucket) {
        if (!w) break;
        if (j === i) continue;
        const other = b.faces[j]!.plane;
        if (signedDist(other, ball.c) + ball.r < -eps) continue;
        if (samePlane(other, f.plane, eps)) {
          // Duplicate plane: keep only the first copy.
          if (j < i) w = null;
          continue;
        }
        if (allBehind(w, other, eps)) continue;
        const r = clipWinding(w, other, eps);
        w = r.onPlane ? null : r.back;
        if (w) ball = enclose(w);
      }
    if (!w) return;
    w = cleanWinding(w, eps);
    if (w.length >= 3 && windingArea(w) > eps * eps) out.push({ face: i, plane: f.plane, surface: f.surface, points: w });
  });
  return out;
}

/** Bucket limits for “how nearly the same way two planes face” (see `polygons`). */
const NEAR = [0.995, 0.98, 0.95, 0.85, 0.6, 0, -Infinity];

/** A ball that holds every point of the polygon (centred on the average point). */
function enclose(w: Winding): { c: V3; r: number } {
  let x = 0, y = 0, z = 0;
  for (const p of w) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const c: V3 = [x / w.length, y / w.length, z / w.length];
  let r2 = 0;
  for (const p of w) r2 = Math.max(r2, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2);
  return { c, r: Math.sqrt(r2) };
}

/** True when every point of the polygon is behind (or on) the plane: the plane doesn't cut it. */
function allBehind(w: Winding, p: Plane, eps: number): boolean {
  for (const x of w) if (signedDist(p, x) > eps) return false;
  return true;
}

/**
 * Unique points within a tolerance, found through a grid of cells instead of comparing with every point
 * (spheres have hundreds of corners). `index` returns the first matching point's index, adding it if new.
 */
export class PointSet {
  readonly points: V3[] = [];
  private cells = new Map<string, number[]>();
  private size: number;
  constructor(private tol: number) {
    this.size = Math.max(tol * 2, 1e-9);
  }
  private cell(p: V3, dx = 0, dy = 0, dz = 0) {
    return `${Math.floor(p[0] / this.size) + dx},${Math.floor(p[1] / this.size) + dy},${Math.floor(p[2] / this.size) + dz}`;
  }
  find(p: V3): number {
    let best = -1;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.cells.get(this.cell(p, dx, dy, dz));
          if (!list) continue;
          for (const k of list) if ((best < 0 || k < best) && eq(p, this.points[k]!, this.tol)) best = k;
        }
    return best;
  }
  index(p: V3): number {
    const found = this.find(p);
    if (found >= 0) return found;
    this.points.push(p);
    const key = this.cell(p);
    const list = this.cells.get(key);
    if (list) list.push(this.points.length - 1);
    else this.cells.set(key, [this.points.length - 1]);
    return this.points.length - 1;
  }
}

/** Unique corner points of the solid. */
export function vertices(b: Brush, eps = EPS): V3[] {
  if (b.mesh) return b.mesh.verts.map((v) => [...v] as V3);
  const set = new PointSet(eps * 4);
  for (const p of polygons(b, eps)) for (const x of p.points) set.index(x);
  return set.points;
}

/** Unique edges as index pairs into `vertices(b)`. */
export function edges(b: Brush, eps = EPS): { verts: V3[]; edges: [number, number][] } {
  if (!b.mesh) {
    // One pass: the corners and the edges from the same polygons.
    const set = new PointSet(eps * 4);
    const seen = new Set<string>();
    const out: [number, number][] = [];
    for (const poly of polygons(b, eps)) {
      const ids = poly.points.map((p) => set.index(p));
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i]!, c = ids[(i + 1) % ids.length]!;
        if (a === c) continue;
        const k = a < c ? `${a}:${c}` : `${c}:${a}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push([Math.min(a, c), Math.max(a, c)]);
        }
      }
    }
    return { verts: set.points, edges: out };
  }
  const verts = vertices(b, eps);
  const lookup = new PointSet(eps * 4);
  for (const v of verts) lookup.index(v);
  const idx = (p: V3) => lookup.find(p);
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
  if (b.mesh) return meshContains(b, p);
  return b.faces.every((f) => signedDist(f.plane, p) <= eps);
}

/** Drop faces that don't contribute a polygon (redundant planes). Keeps surfaces of the faces that remain. */
export function simplify(b: Brush, eps = EPS): Brush {
  if (b.mesh) return b;
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
  const set = new PointSet(EPS * 4);
  if (b.mesh) for (const v of b.mesh.verts) set.index([...v] as V3);
  else for (const p of polys) for (const x of p.points) set.index(x);
  const vs = set.points;
  const key = (p: V3) => set.find(p);
  const count = new Map<string, number>();
  for (const p of polys) {
    for (let i = 0; i < p.points.length; i++) {
      const a = key(p.points[i]!), c = key(p.points[(i + 1) % p.points.length]!);
      const k = a < c ? `${a}:${c}` : `${c}:${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  if ([...count.values()].some((n) => n !== 2)) problems.push('not-closed');
  // Thickness: distance across the solid along each face normal (meaningful for convex brushes only).
  for (const f of b.mesh ? [] : b.faces) {
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
  /** Edited meshes (G4): corners (rounded to 1/1024 unit) and polygons; `faces[i]` is `mesh.polys[i]`. */
  mesh?: EditMesh;
}

export function toData(b: Brush): BrushData {
  if (b.mesh) {
    const verts = b.mesh.verts.map((v) => quantize(v));
    return {
      faces: b.mesh.polys.map((poly, i) => ({ ...cloneSurface(b.faces[i]!.surface), points: pickPlanePoints(poly.map((k) => verts[k]!), b.faces[i]!.plane) })),
      mesh: { verts, polys: b.mesh.polys.map((p) => [...p]) },
    };
  }
  const polys = polygons(b);
  return {
    faces: polys.map((p) => {
      const pts = pickPlanePoints(p.points, p.plane);
      return { ...cloneSurface(p.surface), points: pts };
    }),
  };
}

export function fromData(d: BrushData): Brush {
  if (d.mesh && d.mesh.polys.length === d.faces.length) {
    const verts = d.mesh.verts.map((v) => [...v] as V3);
    const polys = d.mesh.polys.map((p) => [...p]);
    const faces = polys.map((poly, i) => {
      const { points: _points, ...surface } = d.faces[i]!;
      return { plane: polygonPlane(poly.map((k) => verts[k]!)) ?? { n: [0, 0, 1] as V3, d: 0 }, surface: cloneSurface(surface) };
    });
    return { faces, mesh: { verts, polys } };
  }
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

/** The plane of a (nearly) flat polygon by Newell's method: robust for any number of corners. Null if it has no area. */
export function polygonPlane(pts: V3[]): Plane | null {
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, c = pts[(i + 1) % pts.length]!;
    nx += (a[1] - c[1]) * (a[2] + c[2]);
    ny += (a[2] - c[2]) * (a[0] + c[0]);
    nz += (a[0] - c[0]) * (a[1] + c[1]);
    cx += a[0];
    cy += a[1];
    cz += a[2];
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  const n: V3 = [nx / len, ny / len, nz / len];
  const k = pts.length;
  return { n, d: (n[0] * cx + n[1] * cy + n[2] * cz) / k };
}

/** Inside test for an edited mesh: count crossings of a slightly skewed ray (works for dents too). */
function meshContains(b: Brush, p: V3): boolean {
  const dir: V3 = [0.5773, 0.5774, 0.5775];
  let hits = 0;
  for (const poly of polygons(b)) {
    const n = poly.plane.n;
    const denom = dot(n, dir);
    if (Math.abs(denom) < 1e-12) continue;
    const t = (poly.plane.d - dot(n, p)) / denom;
    if (t < -EPS) continue;
    if (t <= EPS) return true; // on the surface
    const x = add(p, scale(dir, t));
    const w = poly.points;
    let inside = true;
    for (let i = 0; i < w.length && inside; i++) {
      const e = sub(w[(i + 1) % w.length]!, w[i]!);
      if (dot(cross(e, sub(x, w[i]!)), n) < -1e-9) inside = false;
    }
    if (inside) hits++;
  }
  return hits % 2 === 1;
}
