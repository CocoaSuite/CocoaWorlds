// Hiding spots: in and out with E, unseen inside unless seen getting in, pulled out by a creature that saw.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const floor = () => brush('floor', [-4096, -16, -4096], [4096, 0, 4096]);
const spawn = () => newEntity('start', { playerSpawn: {} }, { position: [0, 0, 0], rotation: [0, 0, 0] });
const script: Script = {
  version: 1,
  variables: [],
  handlers: [
    { id: 'h1', event: { id: 'e1', kind: 'hides' }, body: [{ id: 's1', kind: 'addScore', amount: { id: 'n1', kind: 'number', value: 1 } }] },
    { id: 'h2', event: { id: 'e2', kind: 'unhides' }, body: [{ id: 's2', kind: 'addScore', amount: { id: 'n2', kind: 'number', value: 100 } }] },
    { id: 'h3', event: { id: 'e3', kind: 'found' }, body: [{ id: 's3', kind: 'addScore', amount: { id: 'n3', kind: 'number', value: 10 } }] },
  ],
};
/** A locker just in front of the player (who looks along −Z at it). */
const locker = (spot: Record<string, unknown> = {}) => brush('locker', [-30, 0, -70], [30, 100, -40], { hidingSpot: { ...spot }, script: script as never });
const enemy = (yawDeg: number) => newEntity('enemy', { npc: { side: 'hostile', speed: 200, attack: 'melee', damage: 10, rate: 1, pull: 0.5 } }, { position: [400, 0, -400], rotation: [0, yawDeg, 0] });
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
const npcOf = (w: GameWorld) => [...(w as never as { npcs: Map<string, { yaw: number; state: string }> }).npcs.values()][0]!;

describe('hiding spots', () => {
  it('E gets in (the view moves to the spot) and out again (back where the player stood)', () => {
    const l = locker();
    const w = GameWorld.create(scene(floor(), spawn(), l));
    run(w, 0.1);
    expect(w.usePrompt()).toBe('Hide');
    w.use();
    run(w, 0.5);
    expect(w.hidingIn).toBe(l.id);
    expect(w.usePrompt()).toBeNull();
    const v = w.playerView()!;
    expect(v.eye[2]).toBeCloseTo(-55, 0);
    expect(v.eye[1]).toBeCloseTo(50, 0);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.3);
    expect(w.playerView()!.eye[2]).toBeCloseTo(-55, 0);
    w.setPlayerInput({ forward: 0 });
    w.use();
    run(w, 0.5);
    expect(w.hidingIn).toBeNull();
    expect(Math.abs(w.player!.feetPosition.z)).toBeLessThan(2);
    expect(w.playerStatus()!.score).toBe(101);
    w.dispose();
  });

  it('Reach sets how close the player must be to get in', () => {
    const near = GameWorld.create(scene(floor(), spawn(), brush('locker', [-30, 0, -170], [30, 100, -140], { hidingSpot: { reach: 64 } })));
    run(near, 0.1);
    expect(near.usePrompt()).toBeNull();
    near.dispose();
    const far = GameWorld.create(scene(floor(), spawn(), brush('locker', [-30, 0, -170], [30, 100, -140], { hidingSpot: { reach: 200 } })));
    run(far, 0.1);
    expect(far.usePrompt()).toBe('Hide');
    far.use();
    run(far, 0.5);
    expect(far.hidingIn).not.toBeNull();
    far.dispose();
  });

  it('the view is fixed in a locker, and turns only so far under a plank', () => {
    const w = GameWorld.create(scene(floor(), spawn(), locker()));
    run(w, 0.1);
    w.use();
    run(w, 0.5);
    w.setPlayerInput({ yaw: 1, pitch: 0.5 });
    expect([w.player!.input.yaw, w.player!.input.pitch]).toEqual([0, 0]);
    w.dispose();

    const w2 = GameWorld.create(scene(floor(), spawn(), locker({ side: 60, upDown: 15 })));
    run(w2, 0.1);
    w2.use();
    run(w2, 0.5);
    w2.setPlayerInput({ yaw: 2, pitch: -1 });
    expect(w2.player!.input.yaw).toBeCloseTo(Math.PI / 3);
    expect(w2.player!.input.pitch).toBeCloseTo(-Math.PI / 12);
    w2.setPlayerInput({ yaw: 0.2 });
    expect(w2.player!.input.yaw).toBeCloseTo(0.2);
    w2.dispose();
  });

  it('a creature that didn’t see the player get in doesn’t see them inside', () => {
    const w = GameWorld.create(scene(floor(), spawn(), locker(), enemy(0)));
    run(w, 0.1);
    w.use();
    run(w, 0.5);
    npcOf(w).yaw = Math.PI;
    run(w, 3);
    expect(npcOf(w).state).toBe('idle');
    expect(w.playerStatus()!.health).toBe(100);
    expect(w.hidingIn).not.toBeNull();
    // Out again in plain view: seen.
    w.use();
    run(w, 0.5);
    expect(npcOf(w).state).toBe('chase');
    w.dispose();
  });

  it('a creature that saw the player get in pulls them out and attacks', () => {
    const w = GameWorld.create(scene(floor(), spawn(), locker(), enemy(180)));
    run(w, 0.1);
    w.use();
    run(w, 0.2);
    expect(w.hidingIn).not.toBeNull();
    run(w, 4);
    expect(w.hidingIn).toBeNull();
    expect(w.playerStatus()!.score).toBe(111);
    expect(w.playerStatus()!.health).toBeLessThan(100);
    w.dispose();
  });

  it('a seat: E sits (the view moves there, the body under it), creatures still see the player, E gets up', () => {
    const chair = brush('chair', [-30, 0, -70], [30, 40, -40], {
      seat: {},
      script: { version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'sits' }, body: [{ id: 's', kind: 'addScore', amount: { id: 'n', kind: 'number', value: 1 } }] }] } as never,
    });
    const w = GameWorld.create(scene(floor(), spawn(), chair));
    w.setPlayerInput({ pitch: -0.6 });
    run(w, 0.1);
    expect(w.usePrompt()).toBe('Sit');
    w.use();
    run(w, 0.6);
    expect(w.hidingIn).toBe(chair.id);
    expect(w.player!.feetPosition.z).toBeLessThan(-40);
    expect(w.playerStatus()!.score).toBe(1);
    const p = (w as never as { npcWorld(): { player(): { hidden: string | null } } }).npcWorld().player();
    expect(p.hidden).toBeNull();
    w.use();
    run(w, 0.6);
    expect(w.hidingIn).toBeNull();
    expect(Math.abs(w.player!.feetPosition.z)).toBeLessThan(2);
    w.dispose();
  });

  it('a physics seat with its own key: E picks it up, F sits (it holds still) and gets up; no sitting while held', () => {
    const chair = brush('chair', [-30, 0, -90], [30, 40, -50], { seat: { key: 'KeyF' }, rigidBody: { motion: 'dynamic', mass: 10 } });
    const w = GameWorld.create(scene(floor(), spawn(), chair));
    w.setPlayerInput({ pitch: -0.6 });
    run(w, 0.3);
    expect(w.usePrompt()).toBe('');
    expect(w.keyPrompts()).toEqual([{ key: 'KeyF', prompt: 'Sit' }]);
    w.pressKey('KeyF');
    run(w, 0.6);
    expect(w.hidingIn).toBe(chair.id);
    const body = (w as never as { bodies: Map<string, { body: { isDynamic(): boolean } }> }).bodies.get(chair.id)!.body;
    expect(body.isDynamic()).toBe(false);
    w.pressKey('KeyF');
    run(w, 0.6);
    expect(w.hidingIn).toBeNull();
    expect(body.isDynamic()).toBe(true);
    w.setPlayerInput({ pitch: -0.6, yaw: 0 });
    run(w, 0.2);
    w.use();
    run(w, 0.5);
    expect(w.holding).toBe(chair.id);
    expect(w.keyPrompts()).toEqual([]);
    w.pressKey('KeyF');
    run(w, 0.3);
    expect(w.hidingIn).toBeNull();
    w.dispose();
  });
});

