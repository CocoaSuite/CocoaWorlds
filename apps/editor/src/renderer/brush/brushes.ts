/** Brushes inside scene entities: the `brush` component holds the role and the saved faces (world space). */
import {
  composeTransform,
  identityMat4,
  isIdentityMat4,
  mat4Key,
  multiplyMat4,
  newEntity,
  type EntityData,
  type Mat4,
  type SceneDoc,
} from '@cocoaworlds/core';
import {
  box,
  bounds,
  cylinder,
  extrudePolygon,
  defaultSurface,
  fromData,
  stairs,
  toData,
  brushToLocal,
  brushToWorld,
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
  /** Edited meshes only (G4). */
  mesh?: BrushData['mesh'];
}

export type BrushShape = 'box' | 'cylinder' | 'wedge' | 'stairs' | 'polygon';

/** A polygon brush's outline: corners on axes `a`/`b` of the view it was drawn in; depth runs along `e`. */
export interface Outline {
  points: [number, number][];
  axes: { a: 0 | 1 | 2; b: 0 | 1 | 2; e: 0 | 1 | 2 };
}
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
    b = fromData({ faces: c.faces, mesh: c.mesh });
    cache.set(c.faces, b);
  }
  return { role: c.role === 'subtract' ? 'subtract' : 'solid', brush: b };
}

export function brushComponent(brush: Brush, role: BrushRole): BrushComponent {
  const d = toData(brush);
  return d.mesh ? { role, faces: d.faces, mesh: d.mesh } : { role, faces: d.faces };
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

// ── Spaces (decision G3) ──
// A brush's faces are saved in its own space: its parent's space combined with its own transform (normally
// identity). The editor's tools work in world space and convert on the way in and out.

/** Move a brush from its own space into the world. Pure moves keep textures locked to the faces. */
export const toWorld = (local: Brush, space: Mat4): Brush => brushToWorld(local, space);

/** Move a world-space brush into a space (the inverse of toWorld). */
export const toLocal = (world: Brush, space: Mat4): Brush => brushToLocal(world, space);

/** Every entity's world matrix, computed once top-down. */
export function worldMatrices(doc: SceneDoc): Map<string, Mat4> {
  const out = new Map<string, Mat4>();
  const get = (e: EntityData): Mat4 => {
    const done = out.get(e.id);
    if (done) return done;
    const parent = e.parent ? doc.get(e.parent) : undefined;
    const m = multiplyMat4(parent ? get(parent) : identityMat4(), composeTransform(e.transform));
    out.set(e.id, m);
    return m;
  };
  for (const e of doc.entities) get(e);
  return out;
}

const worldCache = new WeakMap<object, { key: string; brush: Brush }>();

/** The brush in world space (cached by its saved data and where it sits). */
export function worldBrushOf(doc: SceneDoc, e: EntityData | undefined, space?: Mat4): { role: BrushRole; brush: Brush } | null {
  const b = brushOf(e);
  if (!b || !e) return null;
  const m = space ?? doc.worldMatrix(e.id);
  if (isIdentityMat4(m)) return b;
  const faces = (e.components.brush as unknown as BrushComponent).faces;
  const key = mat4Key(m);
  const hit = worldCache.get(faces);
  if (hit && hit.key === key) return { role: b.role, brush: hit.brush };
  const brush = toWorld(b.brush, m);
  worldCache.set(faces, { key, brush });
  return { role: b.role, brush };
}

/** All visible brushes in world space, for building the level. */
export function worldBrushes(doc: SceneDoc): WorldBrush[] {
  const out: WorldBrush[] = [];
  const mats = worldMatrices(doc);
  for (const e of doc.entities) {
    if (!e.components.brush || !isShown(doc, e)) continue;
    const b = worldBrushOf(doc, e, mats.get(e.id));
    // Trigger zones are brushes too, but they never become level geometry.
    if (b) out.push({ id: e.id, role: e.components.trigger ? 'trigger' : b.role, brush: b.brush });
  }
  return out;
}

/** The brushes for a shape spanning min–max. Stairs produce one brush per step. */
/** What the brush tool draws: level geometry, a live cutter, or a trigger zone. */
export type DrawRole = BrushRole | 'trigger';

export function shapeBrushes(o: ShapeOptions, min: V3, max: V3, role: DrawRole, outline?: Outline): Brush[] {
  const surface = defaultSurface(role === 'subtract' ? 'dev/subtract' : role === 'trigger' ? 'dev/trigger' : 'dev/grid');
  switch (o.shape) {
    case 'polygon':
      if (!outline) return [];
      return [extrudePolygon(outline.points, outline.axes, min[outline.axes.e]!, max[outline.axes.e]!, surface)];
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

export const shapeName: Record<BrushShape, string> = { box: 'block', cylinder: 'cylinder', wedge: 'wedge', stairs: 'stairs', polygon: 'prism' };

/** Bounds of a brush entity in its own space (for pivots), null for other objects. */
export const brushBounds = (e: EntityData) => {
  const b = brushOf(e);
  return b ? bounds(b.brush) : null;
};
