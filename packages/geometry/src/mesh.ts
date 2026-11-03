/**
 * Render and collision data from brushes. Plain typed arrays, no renderer imports, so this runs in a worker
 * and in the game runtime as well as in the editor.
 */
import { bounds, isInvisibleMaterial, polygons, vertices, type Brush, type BrushPolygon } from './brush';
import { AabbTree, type Aabb } from './spatial';
import { EPS, samePlane, flip } from './plane';
import { uvAt, uvAxes } from './uv';
import { type V3 } from './vec';

export interface MeshGroup {
  material: string;
  /** Range in `indices`. */
  start: number;
  count: number;
}

export interface BrushMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Texel coordinates (divide by texture size in the material). */
  uvs: Float32Array;
  indices: Uint32Array;
  groups: MeshGroup[];
  /** For picking: which brush and face each triangle came from. */
  triangleFaces: Uint32Array;
  triangleBrushes: Uint32Array;
  /**
   * With `wearRing`: per vertex, 1 + the distance (units) to the nearest outer edge of its face, and 1 + the
   * distance to the nearest crease (an edge where the face meets another brush), capped at the ring width.
   * (0 would mean “not known”, as for meshes without this data.)
   */
  wear?: Float32Array;
}

export interface MeshOptions {
  /** Drop faces that are pressed flat against an opposite face of another brush (hidden inside walls). */
  cullTouchingFaces?: boolean;
  /**
   * Give each face an inset ring this many units wide (less on small faces) carrying exact distances to its
   * edges and creases, for wear on edges and dirt in corners (CM3).
   */
  wearRing?: number;
  /**
   * Smooth shading: for brush `i`, the smoothing group it's in and the steepest angle (degrees) between faces still
   * shaded as one surface (null: flat). Faces of one group meeting at a gentler angle share normals at their
   * corners, so cylinders and spheres look round. Smoothed brushes get no wear ring (it would show as stripes).
   */
  smooth?: (brush: number) => { group: string; angle: number } | null;
}

/**
 * Triangulate many brushes into one mesh grouped by material. Each face polygon is fanned into triangles.
 * With `cullTouchingFaces`, a face exactly covered by an opposing face of another brush is skipped — the
 * common case of a wall sitting on a floor.
 */
export function buildMesh(brushes: Brush[], opts: MeshOptions = {}): BrushMesh {
  const all: { poly: BrushPolygon; brush: number }[] = [];
  const perBrush = brushes.map((b) => polygons(b));
  perBrush.forEach((polys, bi) => polys.forEach((poly) => all.push({ poly, brush: bi })));

  let visible = all;
  if (opts.cullTouchingFaces) {
    // Only brushes whose bounds touch a face's bounds can cover it.
    const tree = new AabbTree(brushes.map((b) => bounds(b)));
    visible = all.filter((x) => !isCovered(x.poly, x.brush, perBrush, tree.near(polyBounds(x.poly), EPS)));
  }
  const byMat = new Map<string, typeof visible>();
  for (const x of visible) {
    const k = x.poly.surface.material;
    if (!byMat.has(k)) byMat.set(k, []);
    byMat.get(k)!.push(x);
  }

  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [], tf: number[] = [], tb: number[] = [], wr: number[] = [];
  /** Each vertex's brush (for smoothing). */
  const vb: number[] = [];
  const ring = opts.wearRing ?? 0;
  const shown = new Set(visible.map((x) => x.poly));
  const groups: MeshGroup[] = [];
  for (const [material, list] of byMat) {
    const start = idx.length;
    for (const { poly, brush } of list) {
      const sm = opts.smooth?.(brush) ?? null;
      if (ring > 0 && !sm) {
        ringFace(poly, brush, perBrush[brush]!, shown, ring, (p, d) => {
          pos.push(p[0], p[1], p[2]);
          nor.push(poly.plane.n[0], poly.plane.n[1], poly.plane.n[2]);
          const [u, w] = uvAt(p, poly.plane, poly.surface, uvAxes(poly.plane, poly.surface));
          uv.push(u, w);
          wr.push(d[0] + 1, d[1] + 1);
          vb.push(brush);
          return pos.length / 3 - 1;
        }, (a, b, c) => {
          idx.push(a, b, c);
          tf.push(poly.face);
          tb.push(brush);
        });
        continue;
      }
      const base = pos.length / 3;
      const axes = uvAxes(poly.plane, poly.surface);
      for (const p of poly.points) {
        pos.push(p[0], p[1], p[2]);
        nor.push(poly.plane.n[0], poly.plane.n[1], poly.plane.n[2]);
        const [u, w] = uvAt(p, poly.plane, poly.surface, axes);
        uv.push(u, w);
        if (ring > 0) wr.push(ring + 1, ring + 1);
        vb.push(brush);
      }
      for (let i = 1; i + 1 < poly.points.length; i++) {
        idx.push(base, base + i, base + i + 1);
        tf.push(poly.face);
        tb.push(brush);
      }
    }
    groups.push({ material, start, count: idx.length - start });
  }
  if (opts.smooth) smoothNormals(pos, nor, vb, opts.smooth);
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
    groups,
    triangleFaces: new Uint32Array(tf),
    triangleBrushes: new Uint32Array(tb),
    ...(ring > 0 ? { wear: new Float32Array(wr) } : {}),
  };
}

/** Average the normals of smoothed faces where their corners meet (see `MeshOptions.smooth`). */
function smoothNormals(pos: number[], nor: number[], vb: number[], smooth: NonNullable<MeshOptions['smooth']>): void {
  const at = new Map<string, number[]>();
  const settings = new Map<number, { group: string; angle: number } | null>();
  const of = (b: number) => {
    if (!settings.has(b)) settings.set(b, smooth(b));
    return settings.get(b)!;
  };
  for (let v = 0; v < vb.length; v++) {
    const s = of(vb[v]!);
    if (!s) continue;
    const k = `${s.group}|${Math.round(pos[v * 3]! * 64)},${Math.round(pos[v * 3 + 1]! * 64)},${Math.round(pos[v * 3 + 2]! * 64)}`;
    const list = at.get(k);
    if (list) list.push(v);
    else at.set(k, [v]);
  }
  const flat = nor.slice();
  for (const list of at.values()) {
    if (list.length < 2) continue;
    for (const v of list) {
      const min = Math.cos((of(vb[v]!)!.angle * Math.PI) / 180);
      let x = 0, y = 0, z = 0;
      // (Each face counted once, however many of its corners land here.)
      const seen: number[][] = [];
      for (const u of list) {
        const n = [flat[u * 3]!, flat[u * 3 + 1]!, flat[u * 3 + 2]!];
        if (n[0]! * flat[v * 3]! + n[1]! * flat[v * 3 + 1]! + n[2]! * flat[v * 3 + 2]! < min - 1e-6) continue;
        if (seen.some((s) => Math.abs(s[0]! - n[0]!) + Math.abs(s[1]! - n[1]!) + Math.abs(s[2]! - n[2]!) < 1e-5)) continue;
        seen.push(n);
        x += n[0]!;
        y += n[1]!;
        z += n[2]!;
      }
      const l = Math.hypot(x, y, z) || 1;
      nor[v * 3] = x / l;
      nor[v * 3 + 1] = y / l;
      nor[v * 3 + 2] = z / l;
    }
  }
}

/** Points shared by two polygons of a brush: the edge between them. */
const samePoint = (a: V3, b: V3) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3;

/**
 * One face as an inset ring (a strip along each edge, carrying the distance to that edge) around an inner
 * polygon. Each edge is an outer edge when the face beside it (in the same brush) is shown, and a crease when
 * that face is hidden against another brush. `vert` adds a vertex with [edge distance, crease distance].
 */
function ringFace(
  poly: BrushPolygon,
  brush: number,
  own: BrushPolygon[],
  shown: Set<BrushPolygon>,
  width: number,
  vert: (p: V3, d: [number, number]) => number,
  tri: (a: number, b: number, c: number) => void,
): void {
  const pts = poly.points;
  const n = pts.length;
  const N = poly.plane.n;
  // Inward normals of the edges (counter-clockwise polygons).
  const inward = pts.map((a, i) => {
    const b = pts[(i + 1) % n]!;
    const e: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: V3 = [N[1] * e[2] - N[2] * e[1], N[2] * e[0] - N[0] * e[2], N[0] * e[1] - N[1] * e[0]];
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l] as V3;
  });
  // The ring can't be wider than about half the face (measured from its middle to the nearest edge).
  const c: V3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k]! += p[k]! / n;
  let inr = Infinity;
  pts.forEach((a, i) => (inr = Math.min(inr, (c[0] - a[0]) * inward[i]![0] + (c[1] - a[1]) * inward[i]![1] + (c[2] - a[2]) * inward[i]![2])));
  const w = Math.max(0, Math.min(width, inr * 0.9));
  // What each edge is: outer (0) or crease (1), from the face on its other side.
  const kind = pts.map((a, i) => {
    const b = pts[(i + 1) % n]!;
    const other = own.find((q) => q !== poly && q.points.some((x) => samePoint(x, a)) && q.points.some((x) => samePoint(x, b)));
    return other && !shown.has(other) ? 1 : 0;
  });
  if (w <= 1e-3) {
    // Too small for a ring: a plain fan, worn all over its outer edges.
    const ids = pts.map((p) => vert(p, [kind.includes(0) ? 0 : width, kind.includes(1) ? 0 : width]));
    for (let i = 1; i + 1 < n; i++) tri(ids[0]!, ids[i]!, ids[i + 1]!);
    return;
  }
  // Inner corners: where the edges, moved in by w, meet.
  const inner = pts.map((p, i) => {
    const a = inward[(i + n - 1) % n]!, b = inward[i]!;
    const s = w / Math.max(0.2, 1 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
    return [p[0] + (a[0] + b[0]) * s, p[1] + (a[1] + b[1]) * s, p[2] + (a[2] + b[2]) * s] as V3;
  });
  const far: [number, number] = [w, w];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // Along this edge: its own distance grows from 0 to w; the other kind stays far.
    const near = (d: number): [number, number] => (kind[i] === 0 ? [d, w] : [w, d]);
    const o0 = vert(pts[i]!, near(0)), o1 = vert(pts[j]!, near(0)), i1 = vert(inner[j]!, near(w)), i0 = vert(inner[i]!, near(w));
    tri(o0, o1, i1);
    tri(o0, i1, i0);
  }
  const mid = inner.map((p) => vert(p, far));
  for (let i = 1; i + 1 < n; i++) tri(mid[0]!, mid[i]!, mid[i + 1]!);
}

/** A face is covered when another brush has a face on the same plane facing the other way whose polygon contains it. */
function polyBounds(poly: BrushPolygon): Aabb {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of poly.points) for (let k = 0; k < 3; k++) {
    if (p[k]! < min[k]!) min[k] = p[k]!;
    if (p[k]! > max[k]!) max[k] = p[k]!;
  }
  return { min, max };
}

function isCovered(poly: BrushPolygon, self: number, perBrush: BrushPolygon[][], candidates: number[]): boolean {
  const opposite = flip(poly.plane);
  for (const bi of candidates) {
    if (bi === self) continue;
    for (const other of perBrush[bi]!) {
      if (!samePlane(other.plane, opposite)) continue;
      // An invisible collider never hides a visible face behind it (the game would show a hole).
      if (isInvisibleMaterial(other.surface.material) && !isInvisibleMaterial(poly.surface.material)) continue;
      if (poly.points.every((p) => insideConvex(p, other))) return true;
    }
  }
  return false;
}

function insideConvex(p: V3, poly: BrushPolygon): boolean {
  const w = poly.points;
  const n = poly.plane.n;
  for (let i = 0; i < w.length; i++) {
    const a = w[i]!, b = w[(i + 1) % w.length]!;
    // Edge normal pointing inward for a counter-clockwise polygon.
    const e: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const inward: V3 = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
    const d = (p[0] - a[0]) * inward[0] + (p[1] - a[1]) * inward[1] + (p[2] - a[2]) * inward[2];
    if (d < -EPS * Math.hypot(...inward)) return false;
  }
  return true;
}

/** Convex hull points for a physics collider (one hull per brush). */
export function hullPoints(b: Brush): Float32Array {
  return new Float32Array(vertices(b).flat());
}
