/**
 * Face-level editing: find the face under a point, change the surface (material and texture alignment) of
 * chosen faces, and fit or align textures. Planes are never touched here, so the brush shape cannot change.
 */
import { cloneSurface, polygons, type Brush, type FaceSurface } from './brush';
import { signedDist } from './plane';
import { dot, type V3 } from './vec';
import { uvAxes } from './uv';

/** The authored face a surface point belongs to, or -1 (e.g. a face created by a live cut). */
export function faceAt(b: Brush, point: V3, normal: V3, tolerance = 0.01): number {
  let best = -1;
  let bestDist = Infinity;
  b.faces.forEach((f, i) => {
    if (dot(f.plane.n, normal) < 0.999) return;
    const d = Math.abs(signedDist(f.plane, point));
    if (d < tolerance && d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

export type SurfacePatch = Partial<Omit<FaceSurface, 'offset' | 'scale'>> & {
  offset?: [number | undefined, number | undefined];
  scale?: [number | undefined, number | undefined];
};

/** Apply a partial surface change to the listed faces (all faces when `faces` is omitted). */
export function setSurface(b: Brush, patch: SurfacePatch, faces?: number[]): Brush {
  const pick = faces ? new Set(faces) : null;
  return {
    faces: b.faces.map((f, i) => {
      if (pick && !pick.has(i)) return f;
      const s = cloneSurface(f.surface);
      if (patch.material !== undefined) s.material = patch.material;
      if (patch.rotation !== undefined) s.rotation = patch.rotation;
      if (patch.align !== undefined) s.align = patch.align;
      if (patch.offset) s.offset = [patch.offset[0] ?? s.offset[0], patch.offset[1] ?? s.offset[1]];
      if (patch.scale) s.scale = [nonZero(patch.scale[0] ?? s.scale[0]), nonZero(patch.scale[1] ?? s.scale[1])];
      return { plane: f.plane, surface: s };
    }),
  };
}

const nonZero = (n: number) => (Math.abs(n) < 1e-4 ? (n < 0 ? -1e-4 : 1e-4) : n);

/** Extent of a face's polygon along its texture axes, in world units. */
function faceExtent(b: Brush, face: number): { u: [number, number]; v: [number, number] } | null {
  const poly = polygons(b).find((p) => p.face === face);
  if (!poly) return null;
  const axes = uvAxes(poly.plane, poly.surface);
  const u: [number, number] = [Infinity, -Infinity], v: [number, number] = [Infinity, -Infinity];
  for (const p of poly.points) {
    const a = dot(p, axes.u), c = dot(p, axes.v);
    u[0] = Math.min(u[0], a); u[1] = Math.max(u[1], a);
    v[0] = Math.min(v[0], c); v[1] = Math.max(v[1], c);
  }
  return { u, v };
}

/** Stretch the texture so it covers the face exactly `repeat` times on each axis. */
export function fitSurface(b: Brush, faces: number[], texSize: number, repeat: [number, number] = [1, 1]): Brush {
  let out = b;
  for (const face of faces) {
    const ext = faceExtent(out, face);
    if (!ext) continue;
    const su = (ext.u[1] - ext.u[0]) / (texSize * (repeat[0] || 1));
    const sv = (ext.v[1] - ext.v[0]) / (texSize * (repeat[1] || 1));
    if (!(su > 0) || !(sv > 0)) continue;
    out = setSurface(out, { scale: [su, sv], offset: [-ext.u[0] / su, -ext.v[0] / sv] }, [face]);
  }
  return out;
}

/** Move the texture so its edge starts at one side of the face. */
export function justifySurface(b: Brush, faces: number[], side: 'left' | 'right' | 'top' | 'bottom' | 'center', texSize: number): Brush {
  let out = b;
  for (const face of faces) {
    const ext = faceExtent(out, face);
    const s = out.faces[face]?.surface;
    if (!ext || !s) continue;
    const su = s.scale[0] || 1, sv = s.scale[1] || 1;
    let ou = s.offset[0], ov = s.offset[1];
    if (side === 'left') ou = -ext.u[0] / su;
    if (side === 'right') ou = texSize - ext.u[1] / su;
    if (side === 'top') ov = -ext.v[0] / sv;
    if (side === 'bottom') ov = texSize - ext.v[1] / sv;
    if (side === 'center') {
      ou = texSize / 2 - (ext.u[0] + ext.u[1]) / 2 / su;
      ov = texSize / 2 - (ext.v[0] + ext.v[1]) / 2 / sv;
    }
    const wrap = (n: number) => ((n % texSize) + texSize) % texSize;
    out = setSurface(out, { offset: [wrap(ou), wrap(ov)] }, [face]);
  }
  return out;
}
