/**
 * Plain, serializable math types. The engine is Y-up and right-handed (the same as glTF, Three.js and Rapier).
 * One world unit is one game unit; the default grid is 16 units and a standing player is 72 units tall.
 */

export type Vec3 = [x: number, y: number, z: number];

/** Rotation as Euler angles in degrees, applied in YXZ order (yaw, then pitch, then roll). */
export type EulerDeg = [x: number, y: number, z: number];

export interface Transform {
  position: Vec3;
  rotation: EulerDeg;
  scale: Vec3;
}

export const identityTransform = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

export function isFiniteVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function snap(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

export function snapVec3(v: Vec3, step: number): Vec3 {
  return [snap(v[0], step), snap(v[1], step), snap(v[2], step)];
}
