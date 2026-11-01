/**
 * Prefabs (D5, stored as decided in P1).
 *
 * A prefab file holds one entity tree whose root sits at the prefab's origin. A placed copy is stored in full
 * in the scene; every entity in it carries a `prefabLink` component naming the prefab and the prefab entity
 * it came from. When the scene is saved, each link records which values differ from the prefab
 * (`changed`), and the copy's root records prefab entities that were deleted from it (`removed`).
 * Syncing a copy with a (possibly newer) prefab takes every value from the prefab except the changed ones.
 *
 * Values are compared per "path": name, visibility, lock, tags, each transform part (not the copy's root,
 * which is placed per copy), the presence of each component, and each component field. The brush
 * component is compared whole (its faces are one value).
 */
import { newId } from './ids';
import { identityTransform } from './math';
import { CURRENT_SCHEMA_VERSION, type ComponentData, type EntityData } from './schema';

export const PREFAB_EXT = '.cwprefab';
export const LINK = 'prefabLink';

export interface PrefabFile {
  format: 'cocoaworlds.prefab';
  schemaVersion: number;
  id: string;
  name: string;
  /** Exactly one entity has `parent: null` (the root); its transform is the prefab's origin (identity). */
  entities: EntityData[];
}

export interface PrefabLink {
  /** Prefab file id. */
  prefab: string;
  /** The prefab entity this entity copies. */
  entity: string;
  /** Paths whose values differ from the prefab (recorded on save). */
  changed?: string[];
  /** On a copy's root: prefab entities the user deleted from this copy. */
  removed?: string[];
  root?: boolean;
}

export const linkOf = (e: EntityData | undefined): PrefabLink | null => {
  const l = e?.components[LINK] as unknown as PrefabLink | undefined;
  return l && typeof l.prefab === 'string' && typeof l.entity === 'string' ? l : null;
};

const clone = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every comparable value of an entity, by path. `isRoot` leaves out the name and transform (each copy has its own). */
export function entityPaths(e: EntityData, isRoot = false): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!isRoot) out.set('name', e.name);
  out.set('visible', e.visible);
  out.set('locked', e.locked);
  out.set('tags', e.tags);
  if (!isRoot) {
    out.set('transform.position', e.transform.position);
    out.set('transform.rotation', e.transform.rotation);
    out.set('transform.scale', e.transform.scale);
  }
  for (const [name, data] of Object.entries(e.components)) {
    if (name === LINK) continue;
    out.set(`components.${name}`, true);
    if (name === 'brush' || name === 'group') {
      out.set(`components.${name}.*`, data);
      continue;
    }
    for (const [k, v] of Object.entries(data)) out.set(`components.${name}.${k}`, v);
  }
  return out;
}

/** Paths where a copy's entity differs from the prefab entity. */
export function diffPaths(copy: EntityData, source: EntityData, isRoot = false): string[] {
  const a = entityPaths(copy, isRoot), b = entityPaths(source, isRoot);
  const out: string[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (k.startsWith('components.') && k.split('.').length === 3 && !k.endsWith('.*')) {
      // A field only counts when its component exists on both; otherwise the component path says it.
      const comp = k.split('.').slice(0, 2).join('.');
      if (!a.has(comp) || !b.has(comp)) continue;
    }
    if (!same(a.get(k), b.get(k))) out.push(k);
  }
  return out.sort();
}

/** `copy` with every value taken from `source` except the `keep` paths. Links and the copy's id/parent stay. */
export function applySource(copy: EntityData, source: EntityData, keep: Set<string>, isRoot: boolean): EntityData {
  const out = clone(copy);
  const take = (p: string) => !keep.has(p);
  if (!isRoot && take('name')) out.name = source.name;
  if (take('visible')) out.visible = source.visible;
  if (take('locked')) out.locked = source.locked;
  if (take('tags')) out.tags = clone(source.tags);
  if (!isRoot) {
    if (take('transform.position')) out.transform.position = clone(source.transform.position);
    if (take('transform.rotation')) out.transform.rotation = clone(source.transform.rotation);
    if (take('transform.scale')) out.transform.scale = clone(source.transform.scale);
  }
  const names = new Set([...Object.keys(copy.components), ...Object.keys(source.components)]);
  for (const name of names) {
    if (name === LINK) continue;
    const src = source.components[name];
    const has = `components.${name}`;
    if (take(has)) {
      if (!src) {
        delete out.components[name];
        continue;
      }
      if (!out.components[name]) out.components[name] = {};
    } else if (!out.components[name]) {
      continue; // removed on purpose in this copy
    }
    if (!src) continue; // added on purpose in this copy
    if (name === 'brush' || name === 'group') {
      if (take(`components.${name}.*`)) out.components[name] = clone(src);
      continue;
    }
    const dst = out.components[name] as ComponentData;
    for (const k of new Set([...Object.keys(src), ...Object.keys(dst)])) {
      if (!take(`components.${name}.${k}`)) continue;
      if (k in src) dst[k] = clone(src[k]);
      else delete dst[k];
    }
  }
  return out;
}

/** A prefab from an entity tree. `root` becomes the prefab's origin; give its world placement to the copy. */
export function makePrefab(name: string, tree: EntityData[], rootId: string): PrefabFile {
  const entities = tree.map((e) => {
    const c = clone(e);
    delete c.components[LINK];
    if (c.id === rootId) {
      c.parent = null;
      c.transform = identityTransform();
    }
    return c;
  });
  return { format: 'cocoaworlds.prefab', schemaVersion: CURRENT_SCHEMA_VERSION, id: newId(), name, entities };
}

export const prefabRoot = (p: PrefabFile): EntityData | undefined => p.entities.find((e) => e.parent === null);

/** Link an existing tree to a prefab made from it (ids match the prefab's). */
export function linkTree(tree: EntityData[], prefab: PrefabFile, rootId: string): EntityData[] {
  return tree.map((e) => {
    const c = clone(e);
    const link: PrefabLink = { prefab: prefab.id, entity: e.id };
    if (e.id === rootId) link.root = true;
    c.components[LINK] = link as unknown as ComponentData;
    return c;
  });
}

/** A new copy of a prefab: fresh ids, linked, root placed by `transform` under `parent`. */
export function instantiate(prefab: PrefabFile, parent: string | null, transform = identityTransform(), name?: string): EntityData[] {
  const ids = new Map(prefab.entities.map((e) => [e.id, newId()]));
  return prefab.entities.map((e) => {
    const c = clone(e);
    c.id = ids.get(e.id)!;
    const link: PrefabLink = { prefab: prefab.id, entity: e.id };
    if (e.parent === null) {
      c.parent = parent;
      c.transform = clone(transform);
      if (name) c.name = name;
      link.root = true;
    } else {
      c.parent = ids.get(e.parent) ?? null;
    }
    c.components[LINK] = link as unknown as ComponentData;
    return c;
  });
}

/**
 * Record, for one copy, which values differ from the prefab and which prefab entities were deleted.
 * `copy` is the copy's tree (root first). Returns updated entities (only links change).
 */
export function recordChanges(copy: EntityData[], prefab: PrefabFile): EntityData[] {
  const src = new Map(prefab.entities.map((e) => [e.id, e]));
  const present = new Set<string>();
  const out = copy.map((e) => {
    const link = linkOf(e);
    if (!link || link.prefab !== prefab.id) return e;
    const s = src.get(link.entity);
    if (!s) return e;
    present.add(link.entity);
    const c = clone(e);
    const l: PrefabLink = { ...link, changed: diffPaths(e, s, !!link.root) };
    if (!l.changed!.length) delete l.changed;
    c.components[LINK] = l as unknown as ComponentData;
    return c;
  });
  const root = out.find((e) => linkOf(e)?.root);
  if (root) {
    const removed = prefab.entities.filter((e) => e.parent !== null && !present.has(e.id)).map((e) => e.id);
    const l = { ...linkOf(root)! };
    if (removed.length) l.removed = removed;
    else delete l.removed;
    root.components[LINK] = l as unknown as ComponentData;
  }
  return out;
}

export interface SyncResult {
  /** Entities whose data changed (full new versions). */
  update: EntityData[];
  /** Entities new in the prefab, ready to insert. */
  add: EntityData[];
  /** Ids of linked entities whose prefab entity no longer exists. */
  remove: string[];
}

/**
 * Bring one copy up to date with a prefab. `copy` is the copy's whole tree (root first) with `changed` and
 * `removed` recorded (see recordChanges). Entities the user added inside the copy are left alone.
 */
export function syncCopy(copy: EntityData[], prefab: PrefabFile): SyncResult {
  const src = new Map(prefab.entities.map((e) => [e.id, e]));
  const root = copy.find((e) => linkOf(e)?.root);
  const removedOnPurpose = new Set(linkOf(root)?.removed ?? []);
  const bySource = new Map<string, EntityData>();
  const result: SyncResult = { update: [], add: [], remove: [] };
  for (const e of copy) {
    const link = linkOf(e);
    if (!link || link.prefab !== prefab.id) continue;
    const s = src.get(link.entity);
    if (!s) {
      result.remove.push(e.id);
      continue;
    }
    bySource.set(link.entity, e);
    const next = applySource(e, s, new Set(link.changed ?? []), !!link.root);
    if (!same(next, e)) result.update.push(next);
  }
  // Prefab entities this copy doesn't have yet (and didn't delete on purpose), parents first.
  const ids = new Map<string, string>();
  for (const [sid, e] of bySource) ids.set(sid, e.id);
  for (const s of prefab.entities) {
    if (s.parent === null || bySource.has(s.id) || removedOnPurpose.has(s.id)) continue;
    const parent = ids.get(s.parent);
    if (!parent) continue;
    const c = clone(s);
    c.id = newId();
    c.parent = parent;
    c.components[LINK] = { prefab: prefab.id, entity: s.id } as unknown as ComponentData;
    ids.set(s.id, c.id);
    result.add.push(c);
  }
  return result;
}

/** Make a value at a path on an entity equal to the prefab's (for "Revert"). */
export function revertPath(copy: EntityData, source: EntityData, path: string, isRoot: boolean): EntityData {
  return applySource(copy, source, keepAllBut(copy, source, path, isRoot), isRoot);
}

/** Put a copy's value at a path into the prefab entity (for "Apply to prefab"). */
export function applyPathToSource(copy: EntityData, source: EntityData, path: string, isRoot: boolean): EntityData {
  // The same move the other way: the prefab entity takes the copy's value; its id, parent and links stay.
  const out = applySource(source, copy, keepAllBut(copy, source, path, isRoot), isRoot);
  delete out.components[LINK];
  return out;
}

/** Every path except `path` (and, for a component's presence, except its fields too). */
function keepAllBut(a: EntityData, b: EntityData, path: string, isRoot: boolean): Set<string> {
  const keep = new Set(entityPathsUnion(a, b, isRoot));
  keep.delete(path);
  if (/^components\.[^.]+$/.test(path)) for (const p of [...keep]) if (p.startsWith(`${path}.`)) keep.delete(p);
  return keep;
}

function entityPathsUnion(a: EntityData, b: EntityData, isRoot: boolean): string[] {
  return [...new Set([...entityPaths(a, isRoot).keys(), ...entityPaths(b, isRoot).keys()])];
}
