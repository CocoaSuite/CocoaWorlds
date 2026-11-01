/**
 * Prefabs in the editor (decision P1): finding a copy's root, recording what each copy changed before
 * saving, bringing copies up to date, and choosing a sensible origin when a prefab is made.
 */
import {
  LINK,
  addEntitiesCmd,
  applyMat4,
  componentDef,
  composeTransform,
  decomposeMat4,
  deleteEntitiesCmd,
  invertMat4,
  linkOf,
  multiplyMat4,
  recordChanges,
  replaceEntitiesCmd,
  syncCopy,
  type Command,
  type EntityData,
  type PrefabFile,
  type SceneDoc,
  type SceneFile,
} from '@cocoaworlds/core';
import { translate, vertices, type V3 } from '@cocoaworlds/geometry';
import { brushComponent, brushOf, worldBrushOf } from './brush/brushes';

/** The root of the prefab copy an entity belongs to (itself, or the nearest linked ancestor marked as root). */
export function copyRootOf(doc: SceneDoc, id: string): EntityData | null {
  const link = linkOf(doc.get(id));
  if (!link) return null;
  for (let e = doc.get(id); e; e = e.parent ? doc.get(e.parent) : undefined) {
    const l = linkOf(e);
    if (!l || l.prefab !== link.prefab) return null;
    if (l.root) return e;
  }
  return null;
}

/** All copy roots in a scene (optionally of one prefab). */
export function copyRoots(entities: readonly EntityData[], prefabId?: string): EntityData[] {
  return entities.filter((e) => {
    const l = linkOf(e);
    return !!l?.root && (!prefabId || l.prefab === prefabId);
  });
}

function subtreeOf(entities: readonly EntityData[], rootId: string): EntityData[] {
  const kids = new Map<string, EntityData[]>();
  for (const e of entities) if (e.parent) kids.set(e.parent, [...(kids.get(e.parent) ?? []), e]);
  const out: EntityData[] = [];
  const visit = (e: EntityData) => {
    out.push(e);
    for (const k of kids.get(e.id) ?? []) visit(k);
  };
  const root = entities.find((e) => e.id === rootId);
  if (root) visit(root);
  return out;
}

/** A scene file ready to save: every copy records which values differ from its prefab. */
export function recordAllChanges(file: SceneFile, prefabs: Map<string, PrefabFile>): SceneFile {
  const replaced = new Map<string, EntityData>();
  for (const root of copyRoots(file.entities)) {
    const prefab = prefabs.get(linkOf(root)!.prefab);
    if (!prefab) continue; // missing prefab file: keep the links exactly as they were
    for (const e of recordChanges(subtreeOf(file.entities, root.id), prefab)) replaced.set(e.id, e);
  }
  return { ...file, entities: file.entities.map((e) => replaced.get(e.id) ?? e) };
}

/**
 * Commands that bring copies up to date with `next`. `previous` is the prefab the copies were last in step
 * with (null when the copies' saved change lists are current, e.g. right after opening a scene).
 */
export function syncCommands(doc: SceneDoc, next: PrefabFile, previous: PrefabFile | null): { cmds: Command[]; copies: number } {
  const cmds: Command[] = [];
  let copies = 0;
  for (const root of copyRoots(doc.entities, next.id)) {
    let tree = subtreeOf(doc.entities, root.id);
    if (previous) tree = recordChanges(tree, previous);
    const r = syncCopy(tree, next);
    if (!r.update.length && !r.add.length && !r.remove.length) continue;
    copies++;
    if (r.update.length) cmds.push(replaceEntitiesCmd(doc, r.update, 'Update from prefab'));
    if (r.add.length) cmds.push(addEntitiesCmd(doc, r.add, 'Update from prefab'));
    if (r.remove.length) cmds.push(deleteEntitiesCmd(doc, r.remove));
  }
  return { cmds, copies };
}

/** Strip prefab links from entities (Unlink, or pasting part of a copy). */
export function unlinked(entities: EntityData[]): EntityData[] {
  return entities.map((e) => {
    if (!e.components[LINK]) return e;
    const c = structuredClone(e);
    delete c.components[LINK];
    return c;
  });
}

/**
 * Move a tree's origin to the bottom centre of what it contains, without moving anything in the world, so a
 * prefab made from it can be placed by its base. Returns the tree's new versions (root and direct children).
 */
export function repivot(doc: SceneDoc, rootId: string): EntityData[] {
  const root = doc.get(rootId);
  if (!root) return [];
  const rootWorld = doc.worldMatrix(rootId);
  const toRoot = invertMat4(rootWorld);
  if (!toRoot) return [];
  // Bounds of everything inside, in the root's own space.
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  const add = (p: V3) => {
    const q = applyMat4(toRoot, p);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, q[i]!);
      max[i] = Math.max(max[i]!, q[i]!);
    }
  };
  for (const e of doc.subtree(rootId)) {
    const b = worldBrushOf(doc, e);
    if (b) for (const v of vertices(b.brush)) add(v);
    else if (e.id !== rootId || !doc.children(rootId).length) {
      const m = doc.worldMatrix(e.id);
      add([m[12]!, m[13]!, m[14]!]);
    }
  }
  if (!Number.isFinite(min[0])) return [];
  const q = (n: number) => Math.round(n * 1024) / 1024;
  const p: V3 = [q((min[0] + max[0]) / 2), q(min[1]), q((min[2] + max[2]) / 2)];
  if (p.every((v) => v === 0)) return [];
  const out: EntityData[] = [];
  // Root: its transform moves by p (in its own space); a brush root's faces move back by p.
  const r = structuredClone(root);
  r.transform = decomposeMat4(multiplyMat4(composeTransform(root.transform), composeTransform({ position: p, rotation: [0, 0, 0], scale: [1, 1, 1] })));
  const rb = brushOf(root);
  if (rb) r.components.brush = brushComponent(translate(rb.brush, [-p[0], -p[1], -p[2]]), rb.role) as unknown as Record<string, unknown>;
  out.push(r);
  // Direct children were placed relative to the old origin: shift them back by p.
  for (const c of doc.children(rootId)) {
    const n = structuredClone(c);
    const cb = brushOf(c);
    if (cb && isIdentityTransform(c)) {
      n.components.brush = brushComponent(translate(cb.brush, [-p[0], -p[1], -p[2]]), cb.role) as unknown as Record<string, unknown>;
    } else {
      n.transform = decomposeMat4(multiplyMat4(composeTransform({ position: [-p[0], -p[1], -p[2]], rotation: [0, 0, 0], scale: [1, 1, 1] }), composeTransform(c.transform)));
    }
    out.push(n);
  }
  return out;
}

const isIdentityTransform = (e: EntityData) =>
  e.transform.position.every((v) => v === 0) && e.transform.rotation.every((v) => v === 0) && e.transform.scale.every((v) => v === 1);

/** A change path in plain words for the Inspector, using the component registry's labels. */
export function describePath(path: string, lang: 'en' | 'ru'): string {
  const ru = lang === 'ru';
  const fixed: Record<string, [string, string]> = {
    name: ['Name', 'Имя'],
    visible: ['Visible', 'Видимость'],
    locked: ['Locked', 'Блокировка'],
    tags: ['Tags', 'Метки'],
    'transform.position': ['Position', 'Положение'],
    'transform.rotation': ['Rotation', 'Поворот'],
    'transform.scale': ['Scale', 'Масштаб'],
    'components.brush.*': ['Shape', 'Форма'],
  };
  const f = fixed[path];
  if (f) return ru ? f[1] : f[0];
  const [, comp, field] = path.split('.');
  const def = componentDef(comp!);
  const cl = def?.label[lang] ?? comp!;
  if (!field) return ru ? `${cl} (добавлен или убран)` : `${cl} (added or removed)`;
  const fl = def?.fields.find((x) => x.key === field)?.label[lang] ?? field;
  return `${cl} › ${fl}`;
}
