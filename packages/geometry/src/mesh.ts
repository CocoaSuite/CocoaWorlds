/**
 * Render and collision data from brushes. Plain typed arrays, no renderer imports, so this runs in a worker
 * and in the game runtime as well as in the editor.
 */
import { polygons, vertices, type Brush, type BrushPolygon } from './brush';
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
}

export interface MeshOptions {
  /** Drop faces that are pressed flat against an opposite face of another brush (hidden inside walls). */
  cullTouchingFaces?: boolean;
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

  const visible = opts.cullTouchingFaces ? all.filter((x) => !isCovered(x.poly, x.brush, perBrush)) : all;
  const byMat = new Map<string, typeof visible>();
  for (const x of visible) {
    const k = x.poly.surface.material;
    if (!byMat.has(k)) byMat.set(k, []);
    byMat.get(k)!.push(x);
  }

  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [], tf: number[] = [], tb: number[] = [];
  const groups: MeshGroup[] = [];
  for (const [material, list] of byMat) {
    const start = idx.length;
    for (const { poly, brush } of list) {
      const base = pos.length / 3;
      const axes = uvAxes(poly.plane, poly.surface);
      for (const p of poly.points) {
        pos.push(p[0], p[1], p[2]);
        nor.push(poly.plane.n[0], poly.plane.n[1], poly.plane.n[2]);
        const [u, w] = uvAt(p, poly.plane, poly.surface, axes);
        uv.push(u, w);
      }
      for (let i = 1; i + 1 < poly.points.length; i++) {
        idx.push(base, base + i, base + i + 1);
        tf.push(poly.face);
        tb.push(brush);
      }
    }
    groups.push({ material, start, count: idx.length - start });
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
    groups,
    triangleFaces: new Uint32Array(tf),
    triangleBrushes: new Uint32Array(tb),
  };
}

/** A face is covered when another brush has a face on the same plane facing the other way whose polygon contains it. */
function isCovered(poly: BrushPolygon, self: number, perBrush: BrushPolygon[][]): boolean {
  const opposite = flip(poly.plane);
  for (let bi = 0; bi < perBrush.length; bi++) {
    if (bi === self) continue;
    for (const other of perBrush[bi]!) {
      if (!samePlane(other.plane, opposite)) continue;
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
