import { describe, expect, it } from 'vitest';
import {
  applyPathToSource,
  diffPaths,
  instantiate,
  linkOf,
  linkTree,
  makePrefab,
  newEntity,
  parsePrefab,
  prefabRoot,
  recordChanges,
  revertPath,
  stringify,
  syncCopy,
  type EntityData,
  type PrefabFile,
} from '../src';

/** A lamp prefab: a group with a light and a base brush. */
function lampTree() {
  const root = newEntity('lamp', { group: {} }, { position: [500, 0, 500] });
  const bulb = newEntity('bulb', { light: { kind: 'point', color: '#ffffff', intensity: 1.5 } }, { position: [0, 64, 0] });
  bulb.parent = root.id;
  const base = newEntity('base', { brush: { role: 'solid', faces: [{ points: [[0, 0, 0], [0, 0, 1], [1, 0, 0]] }] } });
  base.parent = root.id;
  return { root, bulb, base, tree: [root, bulb, base] };
}

const byName = (list: EntityData[], n: string) => list.find((e) => e.name === n)!;

function setup() {
  const { root, tree } = lampTree();
  const prefab = makePrefab('lamp', tree, root.id);
  return { prefab, copy: instantiate(prefab, null, { position: [100, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1] }, 'lamp_2') };
}

/** Pretend to edit the prefab: returns a new version. */
function edit(prefab: PrefabFile, fn: (byName: (n: string) => EntityData) => void): PrefabFile {
  const next = structuredClone(prefab);
  fn((n) => byName(next.entities, n));
  return next;
}

/** Apply a sync result to a list (as the editor does with commands). */
function apply(list: EntityData[], r: ReturnType<typeof syncCopy>): EntityData[] {
  const upd = new Map(r.update.map((e) => [e.id, e]));
  return [...list.filter((e) => !r.remove.includes(e.id)).map((e) => upd.get(e.id) ?? e), ...r.add];
}

describe('prefabs', () => {
  it('a prefab puts its root at the origin; a copy is placed and linked', () => {
    const { prefab, copy } = setup();
    expect(prefabRoot(prefab)!.transform.position).toEqual([0, 0, 0]);
    expect(prefabRoot(prefab)!.parent).toBeNull();
    expect(copy).toHaveLength(3);
    const root = byName(copy, 'lamp_2');
    expect(root.transform.position).toEqual([100, 0, 0]);
    expect(linkOf(root)).toMatchObject({ prefab: prefab.id, root: true });
    expect(new Set(copy.map((e) => e.id)).size).toBe(3);
    expect(prefab.entities.some((e) => copy.some((c) => c.id === e.id))).toBe(false);
    expect(byName(copy, 'bulb').parent).toBe(root.id);
  });

  it('linking the source tree uses the same ids, so making a prefab changes nothing in the scene', () => {
    const { root, tree } = lampTree();
    const prefab = makePrefab('lamp', tree, root.id);
    const linked = linkTree(tree, prefab, root.id);
    expect(linked.map((e) => linkOf(e)!.entity)).toEqual(tree.map((e) => e.id));
    expect(recordChanges(linked, prefab).every((e) => !linkOf(e)!.changed)).toBe(true);
  });

  it('records changed values; the root’s placement and name never count', () => {
    const { prefab, copy } = setup();
    byName(copy, 'bulb').components.light!.color = '#ff0000';
    byName(copy, 'bulb').transform.position = [0, 80, 0];
    const rec = recordChanges(copy, prefab);
    expect(linkOf(byName(rec, 'bulb'))!.changed).toEqual(['components.light.color', 'transform.position']);
    expect(linkOf(byName(rec, 'lamp_2'))!.changed).toBeUndefined();
    expect(linkOf(byName(rec, 'base'))!.changed).toBeUndefined();
  });

  it('a prefab edit reaches every copy except the values a copy changed', () => {
    const { prefab, copy } = setup();
    byName(copy, 'bulb').components.light!.color = '#ff0000';
    const recorded = recordChanges(copy, prefab);
    const v2 = edit(prefab, (n) => {
      n('bulb').components.light!.color = '#00ff00';
      n('bulb').components.light!.intensity = 3;
      n('base').components.brush = { role: 'solid', faces: [] };
    });
    const after = apply(recorded, syncCopy(recorded, v2));
    expect(byName(after, 'bulb').components.light).toMatchObject({ color: '#ff0000', intensity: 3 });
    expect(byName(after, 'base').components.brush).toEqual({ role: 'solid', faces: [] });
    expect(byName(after, 'lamp_2').transform.position).toEqual([100, 0, 0]);
  });

  it('new prefab entities are added to copies; deleted ones are removed; deletions in a copy stick', () => {
    const { prefab, copy } = setup();
    // The user deleted the base from this copy.
    const withoutBase = copy.filter((e) => e.name !== 'base');
    const recorded = recordChanges(withoutBase, prefab);
    expect(linkOf(byName(recorded, 'lamp_2'))!.removed).toEqual([byName(prefab.entities, 'base').id]);
    // The prefab gains a shade and loses the bulb.
    const shade = newEntity('shade', { light: { kind: 'spot' } });
    shade.parent = prefabRoot(prefab)!.id;
    const v2 = edit(prefab, () => {});
    v2.entities = [...v2.entities.filter((e) => e.name !== 'bulb'), shade];
    const r = syncCopy(recorded, v2);
    expect(r.remove).toEqual([byName(recorded, 'bulb').id]);
    expect(r.add.map((e) => e.name)).toEqual(['shade']);
    expect(r.add[0]!.parent).toBe(byName(recorded, 'lamp_2').id);
    expect(linkOf(r.add[0])).toMatchObject({ prefab: prefab.id, entity: shade.id });
  });

  it('entities added inside a copy are left alone', () => {
    const { prefab, copy } = setup();
    const extra = newEntity('sticker', {});
    extra.parent = byName(copy, 'lamp_2').id;
    const r = syncCopy(recordChanges([...copy, extra], prefab), prefab);
    expect(r).toEqual({ update: [], add: [], remove: [] });
  });

  it('component presence: a component added or removed in a copy is a change of its own', () => {
    const { prefab, copy } = setup();
    byName(copy, 'base').components.rigidBody = { motion: 'dynamic' };
    delete byName(copy, 'bulb').components.light;
    const rec = recordChanges(copy, prefab);
    expect(linkOf(byName(rec, 'base'))!.changed).toEqual(['components.rigidBody']);
    expect(linkOf(byName(rec, 'bulb'))!.changed).toEqual(['components.light']);
    const v2 = edit(prefab, (n) => {
      n('bulb').components.light!.intensity = 9;
    });
    const after = apply(rec, syncCopy(rec, v2));
    expect(byName(after, 'base').components.rigidBody).toEqual({ motion: 'dynamic' });
    expect(byName(after, 'bulb').components.light).toBeUndefined();
  });

  it('revert takes the prefab’s value; apply puts the copy’s value into the prefab', () => {
    const { prefab, copy } = setup();
    const bulb = byName(copy, 'bulb');
    bulb.components.light!.color = '#ff0000';
    bulb.components.light!.intensity = 7;
    const src = byName(prefab.entities, 'bulb');
    const reverted = revertPath(bulb, src, 'components.light.color', false);
    expect(reverted.components.light).toMatchObject({ color: '#ffffff', intensity: 7 });
    const applied = applyPathToSource(bulb, src, 'components.light.intensity', false);
    expect(applied.components.light).toMatchObject({ color: '#ffffff', intensity: 7 });
    expect(applied.id).toBe(src.id);
    expect(applied.components.prefabLink).toBeUndefined();
    expect(diffPaths(reverted, src)).toEqual(['components.light.intensity']);
  });

  it('prefab files round-trip and are validated', () => {
    const { prefab } = setup();
    expect(parsePrefab(stringify(prefab)).prefab).toEqual(prefab);
    const bad = { ...prefab, entities: prefab.entities.map((e) => ({ ...e, parent: null })) };
    expect(() => parsePrefab(stringify(bad))).toThrow(/damaged/);
  });
});
