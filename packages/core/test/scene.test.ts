import { describe, expect, it } from 'vitest';
import { History } from '../src/history';
import {
  SceneDoc,
  addEntitiesCmd,
  deleteEntitiesCmd,
  duplicateCmd,
  newEntity,
  newScene,
  renameCmd,
  reparentCmd,
  setComponentCmd,
  setFlagCmd,
  setTransformCmd,
} from '../src/scene-doc';

function setup() {
  const doc = new SceneDoc(newScene('test'));
  const h = new History();
  const room = newEntity('room');
  const wall = newEntity('wall');
  wall.parent = room.id;
  h.execute(addEntitiesCmd(doc, [room, wall]));
  return { doc, h, room, wall };
}

describe('SceneDoc commands', () => {
  it('new scenes contain a spawn point and a light', () => {
    const s = newScene('a');
    expect(s.entities.map((e) => e.name)).toEqual(['player_spawn', 'sun']);
  });

  it('adds and undoes adding', () => {
    const { doc, h, room } = setup();
    expect(doc.get(room.id)).toBeTruthy();
    h.undo();
    expect(doc.get(room.id)).toBeUndefined();
    expect(doc.entities).toHaveLength(2);
  });

  it('deleting a parent deletes children, and undo restores both in place', () => {
    const { doc, h, room, wall } = setup();
    const before = doc.entities.map((e) => e.id);
    h.execute(deleteEntitiesCmd(doc, [room.id]));
    expect(doc.get(wall.id)).toBeUndefined();
    h.undo();
    expect(doc.entities.map((e) => e.id)).toEqual(before);
    expect(doc.get(wall.id)?.parent).toBe(room.id);
  });

  it('a transform drag merges into one undo step', () => {
    const { doc, h, room } = setup();
    h.begin('Move');
    for (let x = 1; x <= 10; x++) {
      h.execute(setTransformCmd(doc, room.id, { position: [x * 16, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, 'move'));
    }
    h.commit();
    expect(doc.get(room.id)?.transform.position[0]).toBe(160);
    h.undo();
    expect(doc.get(room.id)?.transform.position[0]).toBe(0);
  });

  it('renames, hides and locks with undo', () => {
    const { doc, h, room } = setup();
    h.execute(renameCmd(doc, room.id, 'Room A'));
    h.execute(setFlagCmd(doc, room.id, 'visible', false));
    h.execute(setFlagCmd(doc, room.id, 'locked', true));
    expect(doc.get(room.id)).toMatchObject({ name: 'Room A', visible: false, locked: true });
    h.undo();
    h.undo();
    h.undo();
    expect(doc.get(room.id)).toMatchObject({ name: 'room', visible: true, locked: false });
  });

  it('refuses to place an object inside its own child', () => {
    const { doc, room, wall } = setup();
    expect(() => reparentCmd(doc, room.id, wall.id)).toThrow();
  });

  it('duplicates a subtree with fresh ids and remapped parents', () => {
    const { doc, h, room } = setup();
    const { cmd, newIds } = duplicateCmd(doc, [room.id], [16, 0, 0]);
    h.execute(cmd);
    expect(newIds).toHaveLength(1);
    const copy = doc.get(newIds[0]!)!;
    expect(copy.name).toBe('room copy');
    expect(copy.transform.position).toEqual([16, 0, 0]);
    const kids = doc.children(copy.id);
    expect(kids).toHaveLength(1);
    expect(kids[0]!.id).not.toBe(room.id);
  });

  it('toFile returns a copy that later edits do not change', () => {
    const { doc, h, room } = setup();
    const file = doc.toFile();
    h.execute(renameCmd(doc, room.id, 'changed'));
    expect(file.entities.find((e) => e.id === room.id)?.name).toBe('room');
  });
});

describe('setComponentCmd', () => {
  it('sets, merges and removes component data with undo', () => {
    const { doc, h, room } = setup();
    h.begin('Drag');
    h.execute(setComponentCmd(doc, room.id, 'brush', { size: 1 }, 'Resize', 'k'));
    h.execute(setComponentCmd(doc, room.id, 'brush', { size: 2 }, 'Resize', 'k'));
    h.commit();
    expect(doc.get(room.id)?.components.brush).toEqual({ size: 2 });
    h.undo();
    expect(doc.get(room.id)?.components.brush).toBeUndefined();
    h.redo();
    h.execute(setComponentCmd(doc, room.id, 'brush', undefined));
    expect(doc.get(room.id)?.components.brush).toBeUndefined();
    h.undo();
    expect(doc.get(room.id)?.components.brush).toEqual({ size: 2 });
  });
});

describe('scene settings', () => {
  it('older scenes get a sky (off) filled in; settings change with undo', async () => {
    const { sceneSettings, setSceneSettingsCmd, SceneDoc, newScene } = await import('../src');
    const file = newScene('s');
    delete (file.settings as { sky?: unknown }).sky;
    expect(sceneSettings(file.settings).sky).toMatchObject({ enabled: false });
    const doc = new SceneDoc(file);
    const cmd = setSceneSettingsCmd(doc, { gravity: 400, sky: { enabled: true, top: '#000000', horizon: '#ffffff', ground: '#222222' } });
    cmd.apply();
    expect(doc.settings.gravity).toBe(400);
    expect(sceneSettings(doc.settings).sky!.enabled).toBe(true);
    cmd.revert();
    expect(doc.settings.gravity).toBe(800);
    expect(doc.settings.sky).toBeUndefined();
  });
});
