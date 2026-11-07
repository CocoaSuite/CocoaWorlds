// The frame snapshot: one picture of what is drawn, the same values as asking the world object by object.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { AT, BODY_PRESENT, GameWorld, NPC, POSE, VIEW, initPhysics, type FrameSnapshot } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const floor = () => brush('floor', [-2048, -16, -2048], [2048, 0, 2048]);
const spawn = () => newEntity('start', { playerSpawn: {} }, { position: [0, 0, 0], rotation: [0, 0, 0] });
const npc = (name: string, at: Vec3) => newEntity(name, { npc: { side: 'hostile', speed: 150 } }, { position: at, rotation: [0, 180, 0] });
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}

/** The snapshot holds exactly what the per-object calls give now. */
function matches(w: GameWorld, s: FrameSnapshot, ids: string[]): void {
  for (const id of ids) {
    const i = s.body(id);
    expect(i, id).toBeGreaterThanOrEqual(0);
    const motion = w.drawnMotionOf(id);
    expect(s.present(i)).toBe(motion !== null);
    if (motion) {
      expect([...s.bodyPose.subarray(i * POSE, i * POSE + POSE)]).toEqual(motion);
      expect([...s.bodyAt.subarray(i * AT, i * AT + AT)]).toEqual(w.positionOf(id));
    }
    expect(s.visible(i)).toBe(w.isVisible(id));
  }
  const npcs = w.npcStates(true);
  expect(s.npcCount).toBe(npcs.length);
  for (const n of npcs) {
    const i = s.npc(n.id);
    expect([...s.npcPose.subarray(i * NPC, i * NPC + NPC)]).toEqual([...n.feet, n.yaw]);
    expect(s.npcAlive[i]).toBe(n.alive ? 1 : 0);
    expect(s.npcHealth[i]).toBe(n.health);
    expect(s.npcState[i]).toBe(n.state);
  }
  const v = w.playerView();
  expect(s.hasView).toBe(v !== null);
  if (v) {
    expect([...s.view].slice(0, VIEW)).toEqual([...v.eye, v.yaw, v.pitch, ...v.feet]);
    expect(s.thirdPerson).toBe(v.thirdPerson);
    expect(s.crouched).toBe(w.player!.crouched);
  }
}

describe('frame snapshot', () => {
  it('matches the per-object values, between steps too, with stable indices', () => {
    const crate = brush('crate', [-16, 300, -116], [16, 332, -84], { rigidBody: { motion: 'dynamic' } });
    const lift = brush('lift', [200, 0, 200], [264, 16, 264], { rigidBody: { motion: 'kinematic' } });
    const wall = brush('wall', [-400, 0, 300], [400, 160, 316], { rigidBody: { motion: 'fixed' } });
    const z = npc('zombie', [0, 0, -600]);
    const w = GameWorld.create(scene(floor(), spawn(), crate, lift, wall, z));
    // (A body that doesn't move is in the picture only when asked for, and at once.)
    const wi = w.drawn(wall.id);
    expect(w.snapshot().body(wall.id)).toBe(wi);
    w.player!.input.yaw = 0.7;
    const first = new Map<string, number>();
    let s = w.snapshot();
    for (const id of [crate.id, lift.id, wall.id]) first.set(id, s.body(id));
    first.set(z.id, s.npc(z.id));
    // Steps of different lengths: on a step, between two, several in one frame.
    for (const dt of [1 / 60, 1 / 120, 1 / 90, 1 / 30, 0.05, 1 / 144, 1 / 60, 1 / 200]) {
      for (let k = 0; k < 6; k++) {
        w.moveKinematic(lift.id, [0, 4 * k, 0]);
        w.step(dt);
        s = w.snapshot();
        matches(w, s, [crate.id, lift.id, wall.id]);
      }
    }
    // The crate has fallen and the creature has come closer: the picture moved with them.
    expect(s.bodyAt[s.body(crate.id) * AT + 1]).toBeLessThan(200);
    expect(s.npcPose[s.npc(z.id) * NPC + 2]).toBeGreaterThan(-600);
    // Indices never changed.
    for (const id of [crate.id, lift.id, wall.id]) expect(s.body(id)).toBe(first.get(id));
    expect(s.npc(z.id)).toBe(first.get(z.id));
    w.dispose();
  });

  it('a hidden body is shown as hidden, a gone one is no longer present, and its index is not reused', () => {
    const a = brush('a', [-16, 0, -216], [16, 32, -184], { rigidBody: { motion: 'dynamic' } });
    const b = brush('b', [84, 0, -216], [116, 32, -184], { rigidBody: { motion: 'dynamic' } });
    const w = GameWorld.create(scene(floor(), spawn(), a, b));
    w.step(1 / 60);
    let s = w.snapshot();
    const ia = s.body(a.id), ib = s.body(b.id);
    expect(ia).not.toBe(ib);
    // (As breaking does: hidden, still there.)
    (w as unknown as { bodies: Map<string, { visible: boolean }> }).bodies.get(a.id)!.visible = false;
    // (And one taken out of the world.)
    (w as unknown as { bodies: Map<string, unknown> }).bodies.delete(b.id);
    w.step(1 / 60);
    s = w.snapshot();
    expect(s.present(ia)).toBe(true);
    expect(s.visible(ia)).toBe(false);
    expect(w.isVisible(a.id)).toBe(false);
    expect(s.present(ib)).toBe(false);
    expect(s.bodyFlags[ib]! & BODY_PRESENT).toBe(0);
    expect(s.visible(ib)).toBe(w.isVisible(b.id));
    expect(s.body(b.id)).toBe(ib);
    expect(s.bodyCount).toBe(2);
    w.dispose();
  });

  it('grows past its first size without losing what it holds', () => {
    const crates = Array.from({ length: 30 }, (_, i) => brush(`c${i}`, [i * 40 - 600, 100, -16], [i * 40 - 570, 130, 16], { rigidBody: { motion: 'dynamic' } }));
    const w = GameWorld.create(scene(floor(), spawn(), ...crates));
    for (let k = 0; k < 10; k++) w.step(1 / 60);
    const s = w.snapshot();
    expect(s.bodyCount).toBe(30);
    matches(w, s, crates.map((c) => c.id));
    w.dispose();
  });
});
