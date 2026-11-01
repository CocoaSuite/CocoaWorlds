/**
 * Scene helpers shared by duplicate, copy/paste and grouping. Transforms nest (decision G3), so a copy is
 * placed by moving only its top-level objects; everything inside follows through the hierarchy.
 */
import { composeTransform, decomposeMat4, identityMat4, identityTransform, invertMat4, multiplyMat4, newId, type EntityData, type SceneDoc } from '@cocoaworlds/core';
import { translate, type V3 } from '@cocoaworlds/geometry';
import { brushComponent, brushOf, toLocal, worldBrushOf } from './brush/brushes';

/** A group: an entity made to hold others (the `group` component), or an older empty entity with children. */
export function isGroup(doc: SceneDoc, e: EntityData | undefined): boolean {
  if (!e) return false;
  if (e.components.group) return true;
  return Object.keys(e.components).length === 0 && doc.children(e.id).length > 0;
}

/** Drop ids whose ancestor is also in the list (they come along with it). Keeps scene order. */
export function rootsOf(doc: SceneDoc, ids: string[]): string[] {
  const set = new Set(ids);
  return doc.entities.filter((e) => set.has(e.id) && !ids.some((o) => o !== e.id && doc.isAncestor(o, e.id))).map((e) => e.id);
}

/**
 * Deep copies of the roots and everything under them, in scene order. Each root is stored in world space
 * (as if it had no parent), so a paste can place it under any parent, or none, without moving it.
 */
export function snapshotSubtrees(doc: SceneDoc, roots: string[]): EntityData[] {
  const seen = new Set<string>();
  const out: EntityData[] = [];
  const rootSet = new Set(roots);
  for (const id of roots) for (const e of doc.subtree(id)) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const c = structuredClone(e);
    if (rootSet.has(e.id)) {
      const b = worldBrushOf(doc, e);
      if (b) {
        c.components.brush = brushComponent(b.brush, b.role) as unknown as Record<string, unknown>;
        c.transform = identityTransform();
      } else {
        c.transform = decomposeMat4(doc.worldMatrix(e.id));
      }
    }
    out.push(c);
  }
  return out;
}

/**
 * New entities from a snapshot: fresh ids, parents remapped inside the copy, roots placed under their original
 * parent when it still exists, everything offset by `delta`, roots given unique names.
 */
export function cloneSnapshot(doc: SceneDoc, snapshot: EntityData[], delta: V3): { copies: EntityData[]; roots: string[] } {
  const ids = new Map(snapshot.map((e) => [e.id, newId()]));
  const names = new Set(doc.entities.map((e) => e.name));
  const unique = (base: string) => {
    const stem = base.replace(/_\d+$/, '');
    let n = stem, i = 2;
    while (names.has(n)) n = `${stem}_${i++}`;
    names.add(n);
    return n;
  };
  const moved = delta.some((v) => v !== 0);
  const roots: string[] = [];
  const copies = snapshot.map((src) => {
    const c = structuredClone(src);
    c.id = ids.get(src.id)!;
    const inside = src.parent !== null && ids.has(src.parent);
    if (inside) c.parent = ids.get(src.parent!)!;
    else {
      c.parent = src.parent && doc.get(src.parent) ? src.parent : null;
      c.name = unique(src.name);
      roots.push(c.id);
    }
    if (inside) return c;
    // Roots: offset in the world, then express them in their new parent's space. Contents follow.
    const b = brushOf(c);
    const parentSpace = c.parent ? doc.worldMatrix(c.parent) : identityMat4();
    if (b) {
      const world = moved ? translate(b.brush, delta) : b.brush;
      c.components.brush = brushComponent(toLocal(world, parentSpace), b.role) as unknown as Record<string, unknown>;
    } else {
      const w = composeTransform(c.transform);
      w[12] = w[12]! + delta[0];
      w[13] = w[13]! + delta[1];
      w[14] = w[14]! + delta[2];
      c.transform = decomposeMat4(multiplyMat4(invertMat4(parentSpace) ?? identityMat4(), w));
    }
    return c;
  });
  return { copies, roots };
}
