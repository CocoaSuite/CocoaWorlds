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
      if (patch.tint !== undefined) {
        const t = normalTint(patch.tint);
        if (t) s.tint = t;
        else delete s.tint;
      }
      if (patch.offset) s.offset = [patch.offset[0] ?? s.offset[0], patch.offset[1] ?? s.offset[1]];
      if (patch.scale) s.scale = [nonZero(patch.scale[0] ?? s.scale[0]), nonZero(patch.scale[1] ?? s.scale[1])];
      return { plane: f.plane, surface: s };
    }),
    // (An edited mesh or a plane keeps its corners: only the paint changes.)
    ...(b.mesh ? { mesh: { verts: b.mesh.verts.map((v) => [...v] as typeof v), polys: b.mesh.polys.map((p) => [...p]) } } : {}),
  };
}

/** A tint as stored: lower-case `#rrggbb`, or undefined for none (empty, white or not a colour). */
export function normalTint(t: string | undefined): string | undefined {
  const c = (t ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) && c !== '#ffffff' ? c : undefined;
}

const nonZero = (n: number) => (Math.abs(n) < 1e-4 ? (n < 0 ? -1e-4 : 1e-4) : n);

/** Extent of a face's polygon along its texture axes, in world units. */
export function faceExtent(b: Brush, face: number): { u: [number, number]; v: [number, number] } | null {
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

/** A rectangle on a hotspot sheet (0…1 of the texture, v down), and whether faces may lie in it turned 90°. */
export interface HotspotRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: boolean;
}

/**
 * Hotspot mapping: each face takes the rectangle of the sheet that best matches its shape (aspect first, then size
 * at `density` u per texel), turned 90° when that fits better and the rectangle allows it, and its texture is fitted
 * to that rectangle exactly. Equally good rectangles are picked between by `seed`, so repeats vary. `sheet` is the
 * texture's size in texels (one repeat).
 */
export function hotspotSurface(b: Brush, faces: number[], rects: readonly HotspotRect[], sheet: [number, number], seed = 1, density = 0.25): Brush {
  if (!rects.length) return b;
  let out = b;
  for (const face of faces) {
    const s0 = out.faces[face]?.surface;
    if (!s0) continue;
    // The face's size along its texture axes, unturned.
    const flat = setSurface(out, { rotation: 0 }, [face]);
    const ext = faceExtent(flat, face);
    if (!ext) continue;
    const fw = Math.max(1e-3, ext.u[1] - ext.u[0]), fh = Math.max(1e-3, ext.v[1] - ext.v[0]);
    const scored: { r: HotspotRect; turn: boolean; score: number }[] = [];
    for (const r of rects) {
      const rw = Math.max(1e-6, r.w * sheet[0] * density), rh = Math.max(1e-6, r.h * sheet[1] * density);
      for (const turn of r.rotate === false ? [false] : [false, true]) {
        const [w, h] = turn ? [fh, fw] : [fw, fh];
        const aspect = Math.abs(Math.log(w / h / (rw / rh)));
        const size = Math.abs(Math.log(Math.sqrt((w * h) / (rw * rh))));
        scored.push({ r, turn, score: aspect * 2 + size * 0.5 + (turn ? 0.01 : 0) });
      }
    }
    const best = Math.min(...scored.map((x) => x.score));
    const near = scored.filter((x) => x.score <= best + 0.05);
    const pick = near[Math.abs(Math.floor(Math.sin((face + 1) * 12.9898 + seed * 78.233) * 43758.5453)) % near.length]!;
    out = setSurface(out, { rotation: pick.turn ? 90 : 0 }, [face]);
    const e = faceExtent(out, face);
    if (!e) continue;
    const ru = pick.r.x * sheet[0], rv = pick.r.y * sheet[1], rw = pick.r.w * sheet[0], rh = pick.r.h * sheet[1];
    const su = (e.u[1] - e.u[0]) / rw, sv = (e.v[1] - e.v[0]) / rh;
    if (!(su > 0) || !(sv > 0)) continue;
    out = setSurface(out, { scale: [su, sv], offset: [ru - e.u[0] / su, rv - e.v[0] / sv] }, [face]);
  }
  return out;
}
