/**
 * Moving brushes between spaces (decision G3). A brush is saved in its own space; `space` is the 4×4
 * column-major matrix that places that space in the world. Pure moves go through `translate`, which keeps
 * textures locked to the faces; anything else re-projects through `transform`.
 */
import type { Brush } from './brush';
import { transform, translate } from './ops';
import type { M4, V3 } from './vec';

const ID: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export const isIdentityM4 = (m: M4, eps = 1e-9) => m.every((v, i) => Math.abs(v - ID[i]!) <= eps);

export function isTranslationM4(m: M4, eps = 1e-9): boolean {
  for (let i = 0; i < 12; i++) if (Math.abs(m[i]! - ID[i]!) > eps) return false;
  return Math.abs(m[15]! - 1) <= eps;
}

export function invertAffineM4(m: M4): M4 | null {
  // Inverse of the upper 3×3, then the translation.
  const [a, b, c, , d, e, f, , g, h, i] = m as number[];
  const A = e! * i! - f! * h!, B = -(d! * i! - f! * g!), C = d! * h! - e! * g!;
  const det = a! * A + b! * B + c! * C;
  if (!det) return null;
  const inv = [
    A / det, -(b! * i! - c! * h!) / det, (b! * f! - c! * e!) / det, 0,
    B / det, (a! * i! - c! * g!) / det, -(a! * f! - c! * d!) / det, 0,
    C / det, -(a! * h! - b! * g!) / det, (a! * e! - b! * d!) / det, 0,
    0, 0, 0, 1,
  ];
  const t: V3 = [m[12]!, m[13]!, m[14]!];
  inv[12] = -(inv[0]! * t[0] + inv[4]! * t[1] + inv[8]! * t[2]);
  inv[13] = -(inv[1]! * t[0] + inv[5]! * t[1] + inv[9]! * t[2]);
  inv[14] = -(inv[2]! * t[0] + inv[6]! * t[1] + inv[10]! * t[2]);
  return inv;
}

/** A brush from its own space into the world. */
export function brushToWorld(local: Brush, space: M4): Brush {
  if (isIdentityM4(space)) return local;
  if (isTranslationM4(space)) return translate(local, [space[12]!, space[13]!, space[14]!]);
  return transform(local, space);
}

/** A world-space brush into a space (the inverse of brushToWorld). */
export function brushToLocal(world: Brush, space: M4): Brush {
  if (isIdentityM4(space)) return world;
  if (isTranslationM4(space)) return translate(world, [-space[12]!, -space[13]!, -space[14]!]);
  return transform(world, invertAffineM4(space) ?? ID);
}
