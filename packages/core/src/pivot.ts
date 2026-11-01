/**
 * Pivots: the point an object turns and scales around, and where a script's “turn” spins it.
 *
 * Without a `pivot` component the pivot is where you'd expect it: the centre of a brush, the centre of the
 * brushes inside a group, or a point object's own position. Setting one stores it in the object's own space
 * (`components.pivot.point`), so it travels with the object:
 *  - brushes: an offset from the centre of the brush (moving or reshaping the brush keeps it in place on it);
 *  - everything else: a point in the object's own space (it follows the object's transform).
 */
import { applyMat4, invertMat4 } from './matrix';
import type { SceneDoc } from './scene-doc';
import type { Vec3 } from './math';
import type { EntityData } from './schema';

export const PIVOT = 'pivot';

/** Bounds of a brush entity in its own space, or null for objects that aren't brushes. */
export type BrushBounds = (e: EntityData) => { min: Vec3; max: Vec3 } | null;

const mid = (b: { min: Vec3; max: Vec3 }): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];

export function pivotPoint(e: EntityData): Vec3 | null {
  const p = (e.components[PIVOT] as { point?: unknown } | undefined)?.point;
  return Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) ? (p as Vec3) : null;
}

/** World bounds of everything drawn inside an object (its own brush and the brushes below it). */
export function worldBoundsOf(doc: SceneDoc, id: string, boundsOf: BrushBounds): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of doc.subtree(id)) {
    const b = boundsOf(x);
    if (!b) continue;
    const m = doc.worldMatrix(x.id);
    for (let i = 0; i < 8; i++) {
      const c = applyMat4(m, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, c[k]!);
        max[k] = Math.max(max[k]!, c[k]!);
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/** Where an object's pivot is in the world. */
export function pivotOf(doc: SceneDoc, id: string, boundsOf: BrushBounds): Vec3 {
  const e = doc.get(id);
  if (!e) return [0, 0, 0];
  const m = doc.worldMatrix(id);
  const p = pivotPoint(e);
  const own = boundsOf(e);
  if (own) {
    const c = mid(own);
    return applyMat4(m, p ? [c[0] + p[0], c[1] + p[1], c[2] + p[2]] : c);
  }
  if (p) return applyMat4(m, p);
  if (e.components.group) {
    const wb = worldBoundsOf(doc, id, boundsOf);
    if (wb) return mid(wb);
  }
  return [m[12]!, m[13]!, m[14]!];
}

/** The `pivot` component that puts an object's pivot at a world position. */
export function pivotData(doc: SceneDoc, id: string, world: Vec3, boundsOf: BrushBounds): { point: Vec3 } {
  const e = doc.get(id)!;
  const inv = invertMat4(doc.worldMatrix(id));
  const local = inv ? applyMat4(inv, world) : world;
  const own = boundsOf(e);
  const r = (v: number) => Math.round(v * 1024) / 1024;
  if (own) {
    const c = mid(own);
    return { point: [r(local[0] - c[0]), r(local[1] - c[1]), r(local[2] - c[2])] };
  }
  return { point: [r(local[0]), r(local[1]), r(local[2])] };
}
