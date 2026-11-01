/**
 * Vertex editing. Moving corners can bend a flat face; `nonPlanar` decides what happens then:
 *  - 'split'  the bent face becomes two (or more) triangles, each with its own plane (Hammer's behaviour);
 *  - 'reject' the move is refused and the brush is left unchanged.
 * Either way the result must stay convex; moves that would make a dent are refused.
 */
import { cloneSurface, polygons, simplify, vertices, volume, type Brush, type BrushFace } from './brush';
import { EPS, planeFromPoints, signedDist } from './plane';
import { eq, type V3 } from './vec';

export type NonPlanarMode = 'split' | 'reject';

export type VertexEditResult =
  | { ok: true; brush: Brush; splitFaces: number }
  | { ok: false; reason: 'concave' | 'non-planar' | 'collapsed' };

/** Move vertices (indices into `vertices(b)`) to new positions. */
export function moveVertices(b: Brush, moves: Map<number, V3>, nonPlanar: NonPlanarMode = 'split'): VertexEditResult {
  const verts = vertices(b);
  const idx = (p: V3) => verts.findIndex((q) => eq(p, q, EPS * 4));
  const moved = verts.map((p, i) => moves.get(i) ?? p);

  const faces: BrushFace[] = [];
  let splitFaces = 0;
  for (const poly of polygons(b)) {
    const pts = poly.points.map((p) => moved[idx(p)] ?? p);
    const plane = planeFromPoints(pts[0]!, pts[1]!, pts[2]!) ?? findPlane(pts);
    const planar = plane && pts.every((p) => Math.abs(signedDist(plane, p)) <= EPS * 4);
    if (planar && plane) {
      faces.push({ plane, surface: cloneSurface(poly.surface) });
      continue;
    }
    if (nonPlanar === 'reject') return { ok: false, reason: 'non-planar' };
    splitFaces++;
    for (let i = 1; i + 1 < pts.length; i++) {
      const tp = planeFromPoints(pts[0]!, pts[i]!, pts[i + 1]!);
      if (tp) faces.push({ plane: tp, surface: cloneSurface(poly.surface) });
    }
  }

  // Convexity: every moved corner must be on or behind every plane.
  for (const f of faces) for (const p of moved) if (signedDist(f.plane, p) > EPS * 8) return { ok: false, reason: 'concave' };

  const result = simplify({ faces });
  if (polygons(result).length < 4 || volume(result) <= 0.01) return { ok: false, reason: 'collapsed' };
  return { ok: true, brush: result, splitFaces };
}

function findPlane(pts: V3[]) {
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      for (let k = j + 1; k < pts.length; k++) {
        const p = planeFromPoints(pts[i]!, pts[j]!, pts[k]!);
        if (p) return p;
      }
  return null;
}
