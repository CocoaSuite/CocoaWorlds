/**
 * Z is up (as in Blender), in what the editor shows: the engine stays Y-up inside, and every axis the editor shows
 * or takes in is turned to match: shown X = X, shown Y = −Z, shown Z = Y (a proper turn, so turns keep their sense
 * and a model's Blender coordinates read the same here). Sizes (scale) swap Y and Z without the sign.
 */
import type { Vec3 } from '@cocoaworlds/core';

export type AxisKind = 'point' | 'turn' | 'size';

export function savedZUp(): boolean {
  try {
    return localStorage.getItem('cw-z-up') !== '0';
  } catch {
    return true;
  }
}

export function saveZUp(v: boolean): void {
  try {
    localStorage.setItem('cw-z-up', v ? '1' : '0');
  } catch {
    /* (Not kept: storage is off.) */
  }
}

/** A stored (Y-up) vector as shown. */
export function shown(v: Vec3, kind: AxisKind, zUp: boolean): Vec3 {
  if (!zUp) return v;
  return kind === 'size' ? [v[0], v[2], v[1]] : [v[0], v[2] === 0 ? 0 : -v[2], v[1]];
}

/** A shown vector back as stored (Y-up). */
export function stored(v: Vec3, kind: AxisKind, zUp: boolean): Vec3 {
  if (!zUp) return v;
  return kind === 'size' ? [v[0], v[2], v[1]] : [v[0], v[2], v[1] === 0 ? 0 : -v[1]];
}

/** Which stored axis a shown one is, and its sign (for fields edited one axis at a time). */
export function storedAxis(i: number, kind: AxisKind, zUp: boolean): { i: number; sign: number } {
  if (!zUp || i === 0) return { i, sign: 1 };
  return i === 1 ? { i: 2, sign: kind === 'size' ? 1 : -1 } : { i: 1, sign: 1 };
}
