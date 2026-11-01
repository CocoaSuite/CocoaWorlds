/**
 * Texture projection for brush faces, using Hammer's conventions so level designers' habits carry over:
 * coordinates are in texels, `scale` is world units per texel, `offset` shifts in texels, `rotation` turns the
 * projection about the face normal. World alignment picks the axis plane closest to the face; face alignment
 * projects onto the face itself.
 */
import type { FaceSurface } from './brush';
import type { Plane } from './plane';
import { add, cross, dot, normalize, scale, type V3 } from './vec';

export interface UvAxes {
  u: V3;
  v: V3;
}

export function uvAxes(plane: Plane, s: FaceSurface): UvAxes {
  const n = plane.n;
  let u: V3, v: V3;
  if (s.align === 'face') {
    const up: V3 = Math.abs(n[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0];
    u = normalize(cross(up, n));
    v = normalize(cross(u, n));
  } else {
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    if (ay >= ax && ay >= az) {
      u = [1, 0, 0];
      v = [0, 0, 1];
    } else if (ax >= az) {
      u = [0, 0, -1];
      v = [0, -1, 0];
    } else {
      u = [1, 0, 0];
      v = [0, -1, 0];
    }
  }
  if (s.rotation) {
    const a = (s.rotation * Math.PI) / 180;
    const c = Math.cos(a), si = Math.sin(a);
    const ru = add(scale(u, c), scale(v, si));
    const rv = add(scale(u, -si), scale(v, c));
    u = ru;
    v = rv;
  }
  return { u, v };
}

/** Texel coordinates of a point on a face. Divide by the texture's pixel size to get 0–1 UVs. */
export function uvAt(p: V3, plane: Plane, s: FaceSurface, axes = uvAxes(plane, s)): [number, number] {
  return [dot(p, axes.u) / (s.scale[0] || 1) + s.offset[0], dot(p, axes.v) / (s.scale[1] || 1) + s.offset[1]];
}

/** Texture lock: the offset that keeps the texture fixed to the surface after moving it by `delta`. */
export function lockedOffset(plane: Plane, s: FaceSurface, delta: V3): [number, number] {
  const axes = uvAxes(plane, s);
  return [s.offset[0] - dot(delta, axes.u) / (s.scale[0] || 1), s.offset[1] - dot(delta, axes.v) / (s.scale[1] || 1)];
}
