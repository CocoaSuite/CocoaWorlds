/**
 * Free vertex editing and loop cuts (decision G4).
 *
 * Corners move wherever they're dragged. A brush that stops being a clean convex shape becomes an **edited
 * mesh** (see `Brush.mesh`): polygons that bend or dent are split into triangles, so every polygon stays flat
 * and convex and the shape stays closed. When an edited mesh is convex again and every corner is a real
 * corner, it turns back into a normal brush, which can be carved and clipped again.
 *
 * The only refusal left is a shape with no volume (everything squashed flat).
 */
import { cloneSurface, isEditMesh, polygonPlane, polygons, simplify, vertices, volume, type Brush, type BrushFace, type EditMesh, type FaceSurface } from './brush';
import { EPS, samePlane, signedDist } from './plane';
import { add, cross, dot, eq, scale, sub, type V3 } from './vec';

/** Kept for callers of the old API; both modes now accept any shape. */
export type NonPlanarMode = 'split' | 'reject';

export type VertexEditResult =
  | { ok: true; brush: Brush; splitFaces: number; mesh: boolean }
  | { ok: false; reason: 'collapsed' };

/** The brush as an edited mesh (a convex brush gains explicit corners; a mesh is returned as is). */
export function toEditMesh(b: Brush): Brush & { mesh: EditMesh } {
  if (isEditMesh(b)) return b;
  const polys = polygons(b);
  const verts: V3[] = [];
  const idx = (p: V3) => {
    let i = verts.findIndex((q) => eq(p, q, EPS * 4));
    if (i < 0) i = verts.push([...p] as V3) - 1;
    return i;
  };
  const list = polys.map((p) => p.points.map(idx));
  const faces = polys.map((p) => ({ plane: { n: [...p.plane.n] as V3, d: p.plane.d }, surface: cloneSurface(p.surface) }));
  return { faces, mesh: { verts, polys: list } };
}

/**
 * Tidy a mesh after corners moved: weld corners that landed on each other, drop polygons that collapsed,
 * and split every polygon that is bent or dented into triangles. Returns the faces (one per polygon).
 */
export function rebuildMesh(verts: V3[], polys: number[][], surfaces: FaceSurface[]): { brush: Brush & { mesh: EditMesh }; splitFaces: number } {
  // Weld.
  const remap: number[] = [];
  const out: V3[] = [];
  for (const v of verts) {
    let j = out.findIndex((q) => eq(v, q, EPS * 4));
    if (j < 0) j = out.push([...v] as V3) - 1;
    remap.push(j);
  }
  const faces: BrushFace[] = [];
  const list: number[][] = [];
  let splitFaces = 0;
  polys.forEach((poly, pi) => {
    // Remove repeated corners (after welding) and corners that sit on a straight line between their neighbours
    // only when they are duplicates; collinear corners shared with a neighbour stay so the mesh stays closed.
    const p: number[] = [];
    for (const k of poly.map((i) => remap[i]!)) if (p[p.length - 1] !== k) p.push(k);
    while (p.length > 1 && p[0] === p[p.length - 1]) p.pop();
    if (p.length < 3) return;
    const pts = p.map((k) => out[k]!);
    const plane = polygonPlane(pts);
    if (!plane) return;
    const surface = surfaces[pi]!;
    if (isFlatConvex(pts, plane.n)) {
      faces.push({ plane, surface: cloneSurface(surface) });
      list.push(p);
      return;
    }
    splitFaces++;
    for (const tri of triangulate(pts, plane.n)) {
      const tp = polygonPlane(tri.map((i) => pts[i]!));
      if (!tp) continue;
      faces.push({ plane: tp, surface: cloneSurface(surface) });
      list.push(tri.map((i) => p[i]!));
    }
  });
  // Drop corners nothing uses any more.
  const used = [...new Set(list.flat())].sort((a, b) => a - b);
  const pack = new Map(used.map((k, i) => [k, i]));
  return { brush: { faces, mesh: { verts: used.map((k) => out[k]!), polys: list.map((p) => p.map((k) => pack.get(k)!)) } }, splitFaces };
}

function isFlatConvex(pts: V3[], n: V3): boolean {
  const plane = polygonPlane(pts)!;
  if (pts.some((p) => Math.abs(signedDist(plane, p)) > EPS * 4)) return false;
  // Every turn goes the same way (straight runs allowed).
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!, c = pts[(i + 2) % pts.length]!;
    const turn = dot(cross(sub(b, a), sub(c, b)), n);
    if (turn < -1e-6 * Math.max(1, Math.hypot(...sub(b, a)) * Math.hypot(...sub(c, b)))) return false;
  }
  return true;
}

/** Ear clipping in the polygon's best-fit plane. Works for dented and bent polygons alike. */
function triangulate(pts: V3[], n: V3): [number, number, number][] {
  const idx = pts.map((_, i) => i);
  const tris: [number, number, number][] = [];
  const area2 = (a: V3, b: V3, c: V3) => dot(cross(sub(b, a), sub(c, a)), n);
  const inTri = (p: V3, a: V3, b: V3, c: V3) => area2(a, b, p) > 1e-9 && area2(b, c, p) > 1e-9 && area2(c, a, p) > 1e-9;
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!, ib = idx[i]!, ic = idx[(i + 1) % idx.length]!;
      const a = pts[ia]!, b = pts[ib]!, c = pts[ic]!;
      if (area2(a, b, c) <= 1e-9) continue;
      if (idx.some((k) => k !== ia && k !== ib && k !== ic && inTri(pts[k]!, a, b, c))) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0]!, idx[1]!, idx[2]!]);
  else for (let i = 1; i + 1 < idx.length; i++) tris.push([idx[0]!, idx[i]!, idx[i + 1]!]);
  return tris;
}

/**
 * A normal (convex) brush with the same shape, when there is one: the mesh is convex and every corner is a
 * real corner (a corner in the middle of a flat face, e.g. from a loop cut, would be lost). Otherwise null.
 */
export function tryConvex(b: Brush): Brush | null {
  if (!b.mesh) return b;
  const verts = b.mesh.verts;
  for (const f of b.faces) for (const v of verts) if (signedDist(f.plane, v) > EPS * 8) return null;
  const faces: BrushFace[] = [];
  for (const f of b.faces) if (!faces.some((g) => samePlane(g.plane, f.plane, EPS * 4))) faces.push({ plane: f.plane, surface: cloneSurface(f.surface) });
  const convex = simplify({ faces });
  const corners = vertices(convex);
  if (corners.length !== verts.length) return null;
  if (!verts.every((v) => corners.some((c) => eq(c, v, EPS * 8)))) return null;
  if (Math.abs(volume(convex) - volume(b)) > Math.max(0.5, volume(b) * 1e-5)) return null;
  return convex;
}

/** Move corners (indices into `vertices(b)`) to new positions. Never refuses a shape, only a squashed one. */
export function moveVertices(b: Brush, moves: Map<number, V3>, _mode: NonPlanarMode = 'split'): VertexEditResult {
  const m = toEditMesh(b);
  const verts = m.mesh.verts.map((v, i) => moves.get(i) ?? v);
  const { brush, splitFaces } = rebuildMesh(verts, m.mesh.polys, m.faces.map((f) => f.surface));
  if (brush.mesh.polys.length < 4 || volume(brush) <= 0.01) return { ok: false, reason: 'collapsed' };
  const convex = tryConvex(brush);
  return convex ? { ok: true, brush: convex, splitFaces, mesh: false } : { ok: true, brush, splitFaces, mesh: true };
}

// ── loop cut ──

export interface LoopCut {
  /** The brush with the new edge loop(s), as an edited mesh. */
  brush: Brush;
  /** The new edges, for previewing. */
  lines: [V3, V3][];
}

/**
 * Cut a ring of new edges around a brush, like Blender's loop cut: starting from the edge between corners
 * `a` and `c`, walk across four-sided faces to the opposite edge, all the way round (or until a face that
 * isn't four-sided). Every edge on the way is divided into `cuts + 1` equal parts and the faces in the ring
 * are split along the new corners. Null when no four-sided face touches the edge.
 */
export function loopCut(b: Brush, a: V3, c: V3, cuts = 1): LoopCut | null {
  const m = toEditMesh(b);
  const { verts, polys } = m.mesh;
  const find = (p: V3) => verts.findIndex((q) => eq(p, q, EPS * 8));
  const ia = find(a), ic = find(c);
  if (ia < 0 || ic < 0 || ia === ic || cuts < 1) return null;
  const n = Math.min(64, Math.floor(cuts));

  const key = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);
  const polysOf = new Map<string, number[]>();
  polys.forEach((p, pi) => p.forEach((u, i) => {
    const k = key(u, p[(i + 1) % p.length]!);
    polysOf.set(k, [...(polysOf.get(k) ?? []), pi]);
  }));
  if (!polysOf.has(key(ia, ic))) return null;

  // Ring edges, each oriented so its first corner is on the same side as `a`.
  const ring: [number, number][] = [[ia, ic]];
  const ringPolys = new Set<number>();
  const walk = (start: [number, number], from: number | null) => {
    let [u, v] = start;
    let prev = from;
    for (let guard = 0; guard < polys.length + 2; guard++) {
      const next = (polysOf.get(key(u, v)) ?? []).find((pi) => pi !== prev && !ringPolys.has(pi) && polys[pi]!.length === 4);
      if (next === undefined) return;
      ringPolys.add(next);
      const p = polys[next]!;
      const iu = p.indexOf(u), iv = p.indexOf(v);
      // In a quad the opposite edge pairs u with the corner beside u, and v with the corner beside v.
      const step = (iv - iu + 4) % 4 === 1 ? 1 : -1;
      const x = p[(iu - step + 4) % 4]!, w = p[(iv + step + 4) % 4]!;
      if (key(x, w) === key(ia, ic)) return; // back where we started
      ring.push([x, w]);
      u = x;
      v = w;
      prev = next;
    }
  };
  walk([ia, ic], null);
  walk([ia, ic], [...ringPolys][0] ?? null);
  if (!ringPolys.size) return null;

  // New corners along every ring edge.
  const out = verts.map((v) => [...v] as V3);
  const along = new Map<string, number[]>(); // key → new corner ids from the edge's first corner to its second
  const lines: [V3, V3][] = [];
  for (const [u, v] of ring) {
    const ids: number[] = [];
    for (let k = 1; k <= n; k++) ids.push(out.push(add(verts[u]!, scale(sub(verts[v]!, verts[u]!), k / (n + 1)))) - 1);
    along.set(`${u}>${v}`, ids);
  }
  const between = (u: number, v: number): number[] => {
    const f = along.get(`${u}>${v}`);
    if (f) return f;
    const r = along.get(`${v}>${u}`);
    return r ? [...r].reverse() : [];
  };

  const newPolys: number[][] = [];
  const surfaces: FaceSurface[] = [];
  polys.forEach((p, pi) => {
    const surface = m.faces[pi]!.surface;
    if (!ringPolys.has(pi)) {
      // A face beside the ring gets the new corners on its edge, so the shape stays closed.
      const q: number[] = [];
      p.forEach((u, i) => {
        q.push(u);
        q.push(...between(u, p[(i + 1) % p.length]!));
      });
      newPolys.push(q);
      surfaces.push(surface);
      return;
    }
    // A ring face: [s0, s1, t1, t0] in its own winding, with s0→s1 and t0→t1 both ring edges.
    const e = [0, 1, 2, 3].find((i) => between(p[i]!, p[(i + 1) % 4]!).length && between(p[(i + 2) % 4]!, p[(i + 3) % 4]!).length)!;
    const s0 = p[e]!, s1 = p[(e + 1) % 4]!, t1 = p[(e + 2) % 4]!, t0 = p[(e + 3) % 4]!;
    const S = [s0, ...between(s0, s1), s1];
    const T = [t0, ...between(t0, t1), t1];
    for (let k = 0; k <= n; k++) {
      newPolys.push([S[k]!, S[k + 1]!, T[k + 1]!, T[k]!]);
      surfaces.push(surface);
    }
    for (let k = 1; k <= n; k++) lines.push([out[S[k]!]!, out[T[k]!]!]);
  });
  const { brush } = rebuildMesh(out, newPolys, surfaces);
  return { brush, lines };
}

/** The edge of a brush nearest a point (for picking which way a loop cut runs). */
export function nearestEdge(b: Brush, p: V3): [V3, V3] | null {
  let best: [V3, V3] | null = null;
  let bestD = Infinity;
  for (const poly of polygons(b)) {
    const w = poly.points;
    for (let i = 0; i < w.length; i++) {
      const a = w[i]!, c = w[(i + 1) % w.length]!;
      const ab = sub(c, a);
      const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-12, dot(ab, ab))));
      const d = Math.hypot(...sub(p, add(a, scale(ab, t))));
      if (d < bestD) {
        bestD = d;
        best = [a, c];
      }
    }
  }
  return best;
}
