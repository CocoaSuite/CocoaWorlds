import { describe, expect, it } from 'vitest';
import { SceneDoc, newEntity, newScene } from '@cocoaworlds/core';
import { bounds, box } from '@cocoaworlds/geometry';
import { brushOf, newBrushEntity, worldBrushOf } from '../src/renderer/brush/brushes';
import { cloneSnapshot, isGroup, rootsOf, snapshotSubtrees } from '../src/renderer/scene-ops';

function setup() {
  const doc = new SceneDoc(newScene('t'));
  const group = newEntity('room', { group: {} });
  const wall = newBrushEntity('wall', box([0, 0, 0], [16, 128, 256]), 'solid');
  wall.parent = group.id;
  const lamp = newEntity('lamp', { light: { kind: 'point' } }, { position: [8, 100, 8] });
  lamp.parent = group.id;
  const crate = newBrushEntity('crate', box([64, 0, 64], [96, 32, 96]), 'solid');
  doc.insert([group, wall, lamp, crate]);
  return { doc, group, wall, lamp, crate };
}

describe('groups', () => {
  it('knows groups: the group component, or an older empty entity with children', () => {
    const { doc, group, wall, crate } = setup();
    expect(isGroup(doc, doc.get(group.id))).toBe(true);
    expect(isGroup(doc, doc.get(wall.id))).toBe(false);
    const folder = newEntity('folder');
    doc.insert([folder]);
    expect(isGroup(doc, doc.get(folder.id))).toBe(false);
    doc.patch(crate.id, (e) => void (e.parent = folder.id));
    expect(isGroup(doc, doc.get(folder.id))).toBe(true);
    expect(isGroup(doc, newEntity('empty', { group: {} }))).toBe(true);
  });

  it('rootsOf drops objects whose group is also listed', () => {
    const { doc, group, wall, crate } = setup();
    expect(rootsOf(doc, [wall.id, group.id, crate.id])).toEqual([group.id, crate.id]);
  });
});

describe('copies', () => {
  it('copies a group with new ids, remapped parents and everything moved', () => {
    const { doc, group } = setup();
    const snap = snapshotSubtrees(doc, [group.id]);
    expect(snap.map((e) => e.name)).toEqual(['room', 'wall', 'lamp']);
    const { copies, roots } = cloneSnapshot(doc, snap, [16, 0, 16]);
    expect(roots).toHaveLength(1);
    const ids = new Set(copies.map((c) => c.id));
    for (const c of copies) expect(doc.get(c.id)).toBeUndefined();
    const root = copies.find((c) => c.id === roots[0])!;
    expect(root.name).toBe('room_2');
    expect(root.parent).toBeNull();
    for (const c of copies.filter((c) => c !== root)) {
      expect(ids.has(c.parent!)).toBe(true);
      expect(c.name).not.toMatch(/_2$/); // only roots are renamed
    }
    // Only the group moves; what's inside keeps its place relative to it and follows in the world.
    expect(root.transform.position).toEqual([16, 0, 16]);
    doc.insert(copies);
    const wall = copies.find((c) => c.name === 'wall')!;
    expect(bounds(brushOf(wall)!.brush)).toEqual({ min: [0, 0, 0], max: [16, 128, 256] });
    expect(bounds(worldBrushOf(doc, doc.get(wall.id))!.brush)).toEqual({ min: [16, 0, 16], max: [32, 128, 272] });
    const lamp = copies.find((c) => c.name === 'lamp')!;
    expect(lamp.transform.position).toEqual([8, 100, 8]);
    expect(doc.worldMatrix(lamp.id).slice(12, 15)).toEqual([24, 100, 24]);
  });

  it('a copied child goes back under its original parent when that still exists', () => {
    const { doc, group, lamp } = setup();
    const { copies } = cloneSnapshot(doc, snapshotSubtrees(doc, [lamp.id]), [0, 0, 0]);
    expect(copies[0]!.parent).toBe(group.id);
    expect(copies[0]!.name).toBe('lamp_2');
    expect(copies[0]!.transform.position).toEqual([8, 100, 8]);
  });

  it('pasting into another scene puts roots at the top level', () => {
    const { doc, lamp } = setup();
    const other = new SceneDoc(newScene('other'));
    const { copies } = cloneSnapshot(other, snapshotSubtrees(doc, [lamp.id]), [0, 0, 0]);
    expect(copies[0]!.parent).toBeNull();
    expect(copies[0]!.name).toBe('lamp');
  });

  it('snapshots are independent of later edits', () => {
    const { doc, crate } = setup();
    const snap = snapshotSubtrees(doc, [crate.id]);
    doc.patch(crate.id, (e) => void (e.name = 'renamed'));
    expect(snap[0]!.name).toBe('crate');
  });

  it('unique names count up past existing ones', () => {
    const { doc, crate } = setup();
    const a = cloneSnapshot(doc, snapshotSubtrees(doc, [crate.id]), [0, 0, 0]);
    doc.insert(a.copies);
    const b = cloneSnapshot(doc, snapshotSubtrees(doc, [a.roots[0]!]), [0, 0, 0]);
    expect(a.copies[0]!.name).toBe('crate_2');
    expect(b.copies[0]!.name).toBe('crate_3');
  });
});

describe('copies keep their world place', () => {
  it('a child pasted where its parent no longer exists lands at its world position', () => {
    const doc = new SceneDoc(newScene('t'));
    const g = newEntity('g', { group: {} }, { position: [100, 0, 0] });
    const lamp = newEntity('lamp', { light: {} }, { position: [10, 0, 0] });
    lamp.parent = g.id;
    doc.insert([g, lamp]);
    const snap = snapshotSubtrees(doc, [lamp.id]);
    const other = new SceneDoc(newScene('o'));
    const { copies } = cloneSnapshot(other, snap, [0, 0, 0]);
    expect(copies[0]!.parent).toBeNull();
    expect(copies[0]!.transform.position).toEqual([110, 0, 0]);
  });
});

describe('pasting prefab copies', () => {
  it('a whole copy stays linked; part of a copy becomes an ordinary object', async () => {
    const { instantiate, makePrefab, linkOf } = await import('@cocoaworlds/core');
    const doc = new SceneDoc(newScene('t'));
    const root = newEntity('lamp', { group: {} });
    const bulb = newEntity('bulb', { light: {} });
    bulb.parent = root.id;
    const prefab = makePrefab('lamp', [root, bulb], root.id);
    const copy = instantiate(prefab, null);
    doc.insert(copy);
    const whole = cloneSnapshot(doc, snapshotSubtrees(doc, [copy[0]!.id]), [16, 0, 0]);
    expect(whole.copies.every((c) => linkOf(c)?.prefab === prefab.id)).toBe(true);
    const part = cloneSnapshot(doc, snapshotSubtrees(doc, [copy[1]!.id]), [16, 0, 0]);
    expect(part.copies.every((c) => !linkOf(c))).toBe(true);
  });
});
