/** Brushes inside scene entities: the `brush` component holds the role and the saved faces (world space). */
import { newEntity, type EntityData, type SceneDoc } from '@cocoaworlds/core';
import {
  box,
  cylinder,
  defaultSurface,
  fromData,
  stairs,
  toData,
  wedge,
  type Brush,
  type BrushData,
  type BrushRole,
  type V3,
  type WorldBrush,
} from '@cocoaworlds/geometry';

export interface BrushComponent {
  role: BrushRole;
  faces: BrushData['faces'];
}

export type BrushShape = 'box' | 'cylinder' | 'wedge' | 'stairs';
export type Facing = 0 | 90 | 180 | 270;

export interface ShapeOptions {
  shape: BrushShape;
  sides: number;
  steps: number;
  facing: Facing;
}

export const isBrush = (e: EntityData | undefined): boolean => !!e?.components.brush;

/** Cache parsed brushes by the identity of their saved data so the viewport doesn't re-parse every frame. */
const cache = new WeakMap<object, Brush>();

export function brushOf(e: EntityData | undefined): { role: BrushRole; brush: Brush } | null {
  const c = e?.components.brush as BrushComponent | undefined;
  if (!c || !Array.isArray(c.faces)) return null;
  let b = cache.get(c.faces);
  if (!b) {
    b = fromData({ faces: c.faces });
    cache.set(c.faces, b);
  }
  return { role: c.role === 'subtract' ? 'subtract' : 'solid', brush: b };
}

export function brushComponent(brush: Brush, role: BrushRole): BrushComponent {
  return { role, faces: toData(brush).faces };
}

export function newBrushEntity(name: string, brush: Brush, role: BrushRole): EntityData {
  return newEntity(name, { brush: brushComponent(brush, role) as unknown as Record<string, unknown> });
}

/** Visible when it and every group around it are visible. */
export function isShown(doc: SceneDoc, e: EntityData | undefined): boolean {
  for (let x = e; x; x = x.parent ? doc.get(x.parent) : undefined) if (!x.visible) return false;
  return !!e;
}

/** Locked when it or any group around it is locked. */
export function isLocked(doc: SceneDoc, e: EntityData | undefined): boolean {
  for (let x = e; x; x = x.parent ? doc.get(x.parent) : undefined) if (x.locked) return true;
  return false;
}

export function worldBrushes(doc: SceneDoc): WorldBrush[] {
  const out: WorldBrush[] = [];
  for (const e of doc.entities) {
    if (!isShown(doc, e)) continue;
    const b = brushOf(e);
    if (b) out.push({ id: e.id, role: b.role, brush: b.brush });
  }
  return out;
}

/** The brushes for a shape spanning min–max. Stairs produce one brush per step. */
export function shapeBrushes(o: ShapeOptions, min: V3, max: V3, role: 'solid' | 'subtract'): Brush[] {
  const surface = defaultSurface(role === 'subtract' ? 'dev/subtract' : 'dev/grid');
  switch (o.shape) {
    case 'cylinder':
      return [cylinder(min, max, o.sides, surface)];
    case 'wedge':
      return [wedge(min, max, o.facing, surface)];
    case 'stairs':
      return stairs(min, max, o.steps, o.facing, surface);
    default:
      return [box(min, max, surface)];
  }
}

export const shapeName: Record<BrushShape, string> = { box: 'block', cylinder: 'cylinder', wedge: 'wedge', stairs: 'stairs' };
