/**
 * The editable scene: a SceneFile plus an id index and change notifications.
 * All edits that should be undoable go through the command factories at the bottom of this file.
 */
import type { Command } from './history';
import { composeTransform, identityMat4, multiplyMat4, type Mat4 } from './matrix';
import { newId } from './ids';
import { identityTransform, type Transform } from './math';
import {
  CURRENT_SCHEMA_VERSION,
  defaultSceneSettings,
  type ComponentData,
  type EntityData,
  type SceneFile,
  type SceneSettings,
} from './schema';

export type SceneChange =
  | { kind: 'added'; ids: string[] }
  | { kind: 'removed'; ids: string[] }
  | { kind: 'updated'; ids: string[] }
  | { kind: 'reset' };

const clone = <T>(v: T): T => structuredClone(v);

export class SceneDoc {
  private file: SceneFile;
  private index = new Map<string, EntityData>();
  private listeners = new Set<(c: SceneChange) => void>();

  constructor(file: SceneFile) {
    this.file = clone(file);
    this.reindex();
  }

  get id(): string {
    return this.file.id;
  }
  get name(): string {
    return this.file.name;
  }
  get settings() {
    return this.file.settings;
  }
  get entities(): readonly EntityData[] {
    return this.file.entities;
  }

  get(id: string): EntityData | undefined {
    return this.index.get(id);
  }

  children(parent: string | null): EntityData[] {
    return this.file.entities.filter((e) => e.parent === parent);
  }

  /** The entity and every descendant, parents first. */
  subtree(id: string): EntityData[] {
    const out: EntityData[] = [];
    const visit = (eid: string) => {
      const e = this.index.get(eid);
      if (!e) return;
      out.push(e);
      for (const c of this.children(eid)) visit(c.id);
    };
    visit(id);
    return out;
  }

  /** Where the entity's own space sits in the world: its parents' transforms then its own. */
  worldMatrix(id: string): Mat4 {
    const chain: EntityData[] = [];
    for (let e = this.index.get(id); e; e = e.parent ? this.index.get(e.parent) : undefined) chain.push(e);
    let m = identityMat4();
    for (let i = chain.length - 1; i >= 0; i--) m = multiplyMat4(m, composeTransform(chain[i]!.transform));
    return m;
  }

  /** The space an entity's transform is expressed in (its parent's world matrix; identity at the top level). */
  parentMatrix(id: string): Mat4 {
    const p = this.index.get(id)?.parent;
    return p ? this.worldMatrix(p) : identityMat4();
  }

  isAncestor(ancestor: string, id: string): boolean {
    let cur = this.index.get(id)?.parent ?? null;
    while (cur) {
      if (cur === ancestor) return true;
      cur = this.index.get(cur)?.parent ?? null;
    }
    return false;
  }

  /** A deep copy suitable for saving or for building a Play-mode world. */
  toFile(): SceneFile {
    return clone(this.file);
  }

  /** Replace the scene settings (tells listeners, like any other change). */
  setSettings(next: SceneSettings): void {
    this.file.settings = clone(next);
    this.emit({ kind: 'updated', ids: [] });
  }

  subscribe(fn: (c: SceneChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── low-level mutations (used by commands; not undoable on their own) ──

  insert(entities: EntityData[], at?: number): void {
    const copies = entities.map(clone);
    if (at === undefined || at < 0 || at > this.file.entities.length) this.file.entities.push(...copies);
    else this.file.entities.splice(at, 0, ...copies);
    for (const e of copies) this.index.set(e.id, e);
    this.emit({ kind: 'added', ids: copies.map((e) => e.id) });
  }

  remove(ids: string[]): void {
    const set = new Set(ids);
    this.file.entities = this.file.entities.filter((e) => !set.has(e.id));
    for (const id of ids) this.index.delete(id);
    this.emit({ kind: 'removed', ids });
  }

  patch(id: string, fn: (e: EntityData) => void): void {
    const e = this.index.get(id);
    if (!e) return;
    fn(e);
    this.emit({ kind: 'updated', ids: [id] });
  }

  indexOf(id: string): number {
    return this.file.entities.findIndex((e) => e.id === id);
  }

  private reindex(): void {
    this.index.clear();
    for (const e of this.file.entities) this.index.set(e.id, e);
  }

  private emit(c: SceneChange): void {
    for (const fn of this.listeners) fn(c);
  }
}

// ── factories ──

export function newEntity(name: string, components: Record<string, ComponentData> = {}, transform?: Partial<Transform>): EntityData {
  return {
    id: newId(),
    name,
    parent: null,
    transform: { ...identityTransform(), ...transform },
    tags: [],
    layer: 'default',
    visible: true,
    locked: false,
    components,
  };
}

/** A new level: a player spawn and a sun, so pressing Play later has somewhere to start. */
export function newScene(name: string): SceneFile {
  return {
    format: 'cocoaworlds.scene',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId(),
    name,
    settings: defaultSceneSettings(),
    entities: [
      newEntity('player_spawn', { playerSpawn: {} }, { position: [0, 0, 0] }),
      newEntity('sun', { light: { kind: 'directional', color: '#fff4e0', intensity: 2, castShadows: true } }, {
        position: [256, 512, 128],
        rotation: [-50, 30, 0],
      }),
    ],
  };
}

// ── undoable commands ──

export function addEntitiesCmd(doc: SceneDoc, entities: EntityData[], label = 'Add'): Command {
  const snapshot = entities.map(clone);
  return {
    label,
    apply: () => doc.insert(snapshot),
    revert: () => doc.remove(snapshot.map((e) => e.id)),
  };
}

/** Deletes the entities and all their descendants, restoring them at their original positions on undo. */
export function deleteEntitiesCmd(doc: SceneDoc, ids: string[]): Command {
  const all = new Map<string, EntityData>();
  for (const id of ids) for (const e of doc.subtree(id)) all.set(e.id, e);
  const saved = [...all.values()].map((e) => ({ at: doc.indexOf(e.id), e: clone(e) })).sort((a, b) => a.at - b.at);
  return {
    label: saved.length === 1 ? `Delete ${saved[0]!.e.name}` : `Delete ${saved.length} objects`,
    apply: () => doc.remove(saved.map((s) => s.e.id)),
    revert: () => {
      for (const s of saved) doc.insert([s.e], s.at);
    },
  };
}

export function setTransformCmd(doc: SceneDoc, id: string, next: Transform, mergeKey?: string): Command {
  const prev = clone(doc.get(id)?.transform ?? identityTransform());
  const n = clone(next);
  return {
    label: 'Move',
    mergeKey,
    apply: () => doc.patch(id, (e) => void (e.transform = clone(n))),
    revert: () => doc.patch(id, (e) => void (e.transform = clone(prev))),
  };
}

type Flag = 'visible' | 'locked';
export function setFlagCmd(doc: SceneDoc, id: string, flag: Flag, value: boolean): Command {
  const prev = doc.get(id)?.[flag] ?? !value;
  return {
    label: flag === 'visible' ? (value ? 'Show' : 'Hide') : value ? 'Lock' : 'Unlock',
    apply: () => doc.patch(id, (e) => void (e[flag] = value)),
    revert: () => doc.patch(id, (e) => void (e[flag] = prev)),
  };
}

/** Change some scene settings (merged into the current ones). */
export function setSceneSettingsCmd(doc: SceneDoc, patch: Partial<SceneSettings>, label = 'Edit scene settings', mergeKey?: string): Command {
  const prev = clone(doc.settings);
  const next = clone({ ...doc.settings, ...patch });
  return { label, mergeKey, apply: () => doc.setSettings(next), revert: () => doc.setSettings(prev) };
}

export function renameCmd(doc: SceneDoc, id: string, name: string): Command {
  const prev = doc.get(id)?.name ?? '';
  return {
    label: 'Rename',
    apply: () => doc.patch(id, (e) => void (e.name = name)),
    revert: () => doc.patch(id, (e) => void (e.name = prev)),
  };
}

export function reparentCmd(doc: SceneDoc, id: string, parent: string | null): Command {
  if (parent === id || (parent && doc.isAncestor(id, parent))) {
    throw new Error('An object cannot be placed inside itself.');
  }
  const prev = doc.get(id)?.parent ?? null;
  return {
    label: 'Move in hierarchy',
    apply: () => doc.patch(id, (e) => void (e.parent = parent)),
    revert: () => doc.patch(id, (e) => void (e.parent = prev)),
  };
}

/** Copies entities (with descendants) under new ids, offset by `offset`. Returns the command and the new root ids. */
export function duplicateCmd(doc: SceneDoc, ids: string[], offset: [number, number, number]): { cmd: Command; newIds: string[] } {
  const map = new Map<string, string>();
  const copies: EntityData[] = [];
  const roots: string[] = [];
  for (const id of ids) {
    for (const e of doc.subtree(id)) {
      if (map.has(e.id)) continue;
      const c = clone(e);
      c.id = newId();
      map.set(e.id, c.id);
      copies.push(c);
    }
  }
  for (const c of copies) {
    const orig = [...map.entries()].find(([, v]) => v === c.id)![0];
    if (c.parent && map.has(c.parent)) c.parent = map.get(c.parent)!;
    if (ids.includes(orig)) {
      roots.push(c.id);
      c.name = `${c.name} copy`;
      c.transform.position = [
        c.transform.position[0] + offset[0],
        c.transform.position[1] + offset[1],
        c.transform.position[2] + offset[2],
      ];
    }
  }
  return { cmd: addEntitiesCmd(doc, copies, 'Duplicate'), newIds: roots };
}

/** Set (or remove, with `undefined`) one component's data. Consecutive edits with the same merge key collapse into one undo step. */
export function setComponentCmd(doc: SceneDoc, id: string, name: string, data: ComponentData | undefined, label = 'Edit', mergeKey?: string): Command {
  const prev = doc.get(id)?.components[name];
  const before = prev === undefined ? undefined : clone(prev);
  const after = data === undefined ? undefined : clone(data);
  const put = (v: ComponentData | undefined) =>
    doc.patch(id, (e) => {
      if (v === undefined) delete e.components[name];
      else e.components[name] = clone(v);
    });
  return { label, mergeKey, apply: () => put(after), revert: () => put(before) };
}

/** Replace entities with new versions (same ids), as one undoable step. */
export function replaceEntitiesCmd(doc: SceneDoc, next: EntityData[], label = 'Edit'): Command {
  const before = next.map((e) => doc.get(e.id)).filter(Boolean).map((e) => clone(e!));
  const after = next.map(clone);
  const put = (list: EntityData[]) => {
    for (const e of list) doc.patch(e.id, (cur) => void Object.assign(cur, clone(e)));
  };
  return { label, apply: () => put(after), revert: () => put(before) };
}
