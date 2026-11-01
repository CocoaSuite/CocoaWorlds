/**
 * Scene helpers shared by duplicate, copy/paste and grouping. Positions are still world-space (nested
 * transforms arrive in Phase 4), so moving a copy moves every object in it, and brushes move their faces.
 */
import { newId, type EntityData, type SceneDoc } from '@cocoaworlds/core';
import { translate, type V3 } from '@cocoaworlds/geometry';
import { brushComponent, brushOf } from './brush/brushes';

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

/** Deep copies of the roots and everything under them, in scene order. */
export function snapshotSubtrees(doc: SceneDoc, roots: string[]): EntityData[] {
  const seen = new Set<string>();
  const out: EntityData[] = [];
  for (const id of roots) for (const e of doc.subtree(id)) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(structuredClone(e));
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
    if (moved) {
      const b = brushOf(c);
      if (b) c.components.brush = brushComponent(translate(b.brush, delta), b.role) as unknown as Record<string, unknown>;
      else c.transform.position = [c.transform.position[0] + delta[0], c.transform.position[1] + delta[1], c.transform.position[2] + delta[2]];
    }
    return c;
  });
  return { copies, roots };
}
