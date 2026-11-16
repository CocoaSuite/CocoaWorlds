/**
 * Work internal (a Script setting, `workInternal`): the objects a script names are looked for inside the object
 * the script is on first, then inside each object it is in, going out. So every copy of a work light (the model
 * with its light inside) drives its own light and its own glow, even though the script was written on one of them
 * and every copy's blocks still point at that one's parts.
 *
 * Done once on the scene before it is played (`workInternal(scene)`), for every block that names an object:
 * actions, values, events, messages sent to one object, templates of copies. Plain data, no engine imports.
 *
 * Which object counts as “the same” as the one a block names, at each level (the nearest level wins):
 * 1. the named object itself, if it is inside this level;
 * 2. an object copied from the same prefab object (both linked to it, or one is the prefab's source);
 * 3. an object with the same name;
 * 4. an object with the same name apart from a copy number (`Light_2` for `Light`).
 * When nothing matches at any level, the block keeps the object it named.
 */
import { LINK, type PrefabLink } from './prefab';
import type { EntityData, SceneFile } from './schema';

/** A name without the copy number the editor adds (`Light_3` → `Light`). */
const stem = (name: string) => name.replace(/_\d+$/, '');

/** Whether a Script component asks to work internal. */
export const worksInternal = (script: unknown): boolean => !!(script as { workInternal?: unknown } | undefined)?.workInternal;

/** A resolver for one scene: which object a block on `owner` means when it names `target`. */
export function internalResolver(entities: EntityData[]): (owner: string, target: string) => string {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const children = new Map<string | null, EntityData[]>();
  for (const e of entities) {
    const list = children.get(e.parent) ?? [];
    list.push(e);
    children.set(e.parent, list);
  }
  const subtree = (id: string): EntityData[] => {
    const out: EntityData[] = [];
    const visit = (e: EntityData) => {
      out.push(e);
      for (const c of children.get(e.id) ?? []) visit(c);
    };
    const root = byId.get(id);
    if (root) visit(root);
    return out;
  };
  const linkOf = (e: EntityData) => e.components[LINK] as unknown as PrefabLink | undefined;
  // The prefab object an entity stands for: its link, or itself (the scene object a prefab was made from keeps its id).
  const sourceOf = (e: EntityData) => linkOf(e)?.entity ?? e.id;
  const cache = new Map<string, string>();

  return (owner, target) => {
    const key = `${owner}\n${target}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const named = byId.get(target);
    let found = target;
    if (named) {
      const tests: ((c: EntityData) => boolean)[] = [
        (c) => c.id === target,
        (c) => sourceOf(c) === sourceOf(named) && (!!linkOf(c) || !!linkOf(named)),
        (c) => c.name === named.name,
        (c) => stem(c.name) === stem(named.name),
      ];
      search: for (let at: string | null = owner; at; at = byId.get(at)?.parent ?? null) {
        const inside = subtree(at);
        for (const test of tests) {
          const c = inside.find(test);
          if (c) {
            found = c.id;
            break search;
          }
        }
      }
    }
    cache.set(key, found);
    return found;
  };
}

/** Every object reference (`{ entity: id }`) in a script's blocks, rewritten by `fn`. */
export function mapEntityRefs<T>(script: T, fn: (id: string) => string): T {
  const visit = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(visit);
    if (!x || typeof x !== 'object') return x;
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === 'entity' && typeof o.entity === 'string') return { entity: fn(o.entity) };
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = visit(o[k]);
    return out;
  };
  return visit(script) as T;
}

/**
 * The scene with the blocks of every Work internal script pointing at the objects inside their own object (see
 * above). Other scripts are untouched. Returns the same file when no script works internal.
 */
export function workInternal(file: SceneFile): SceneFile {
  if (!file.entities.some((e) => worksInternal(e.components.script))) return file;
  const resolve = internalResolver(file.entities);
  return {
    ...file,
    entities: file.entities.map((e) => {
      const script = e.components.script;
      if (!script || !worksInternal(script)) return e;
      return { ...e, components: { ...e.components, script: mapEntityRefs(script, (id) => resolve(e.id, id)) } };
    }),
  };
}
