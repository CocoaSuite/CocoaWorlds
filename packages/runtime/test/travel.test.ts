// A1: level changes with landmarks.
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
function scene(name: string, ...entities: EntityData[]): SceneFile {
  const s = newScene(name);
  s.entities = entities;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

/**
 * Two scenes sharing a corridor: in a, the corridor runs along −Z from the start, with the landmark “door” at
 * z −300 and a change zone at z −320…−360. In b the same corridor is elsewhere (x 2000) with the same landmark,
 * and its change zone back to a at z −200…−240 relative to the landmark.
 */
function world(): { a: SceneFile; b: SceneFile } {
  const a = scene(
    'a',
    floor(),
    newEntity('start', { playerSpawn: {} }, { position: [0, 0, 0] }),
    newEntity('door', { landmark: {} }, { position: [0, 0, -300] }),
    brush('to_b', [-64, 0, -360], [64, 96, -320], { levelChange: { scene: 'b', landmark: 'door' } }),
  );
  const b = scene(
    'b',
    floor(),
    newEntity('start', { playerSpawn: {} }, { position: [3000, 0, 3000] }),
    newEntity('door', { landmark: {} }, { position: [2000, 0, -300] }),
    // On arrival the player is inside this zone (it overlaps the one in a): it mustn't send them back at once.
    brush('to_a', [1936, 0, -360], [2064, 96, -320], { levelChange: { scene: 'a', landmark: 'door' } }),
  );
  return { a, b };
}

describe('level changes', () => {
  it('walking into the zone leaves for the other scene, keeping where the player is by the landmark and what they carry', () => {
    const { a, b } = world();
    const w = GameWorld.create(a, { values: [{ name: 'Cash', type: 'number', initial: 0 }] });
    run(w, 0.2);
    w.giveItem('Key', 1);
    w.giveArmour(30);
    w.hurt(20);
    w.addScore(5);
    (w as unknown as { globals: Map<string, unknown> }).globals.set('Cash', 12);
    w.setPlayerInput({ forward: 1 });
    run(w, 3);
    const t = w.travel!;
    expect(t).not.toBeNull();
    expect(t.scene).toBe('b');
    expect(t.landmark).toBe('door');
    // Stopped: the scene is over.
    const z = w.player!.feetPosition.z;
    run(w, 0.5);
    expect(w.player!.feetPosition.z).toBe(z);
    w.dispose();

    const w2 = GameWorld.create(b, { arrive: t, values: [{ name: 'Cash', type: 'number', initial: 0 }] });
    const feet = w2.player!.feetPosition;
    expect(feet.x).toBeCloseTo(2000 + t.offset![0], 0);
    expect(feet.z).toBeCloseTo(-300 + t.offset![2], 0);
    expect(w2.player!.velocity.z).toBeLessThan(-100);
    const st = w2.playerStatus()!;
    expect(st.health).toBe(100 - 4);
    expect(st.armour).toBeCloseTo(30 - 8);
    expect(st.score).toBe(5);
    expect(w2.uiState().inventory).toEqual([{ item: 'Key', count: 1 }]);
    expect((w2 as unknown as { globals: Map<string, unknown> }).globals.get('Cash')).toBe(12);
    // Arrived inside b's own zone back to a: nothing happens until the player has left it and comes back.
    w2.setPlayerInput({ forward: 0 });
    run(w2, 0.5);
    expect(w2.travel).toBeNull();
    w2.setPlayerInput({ forward: -1 });
    run(w2, 1);
    expect(w2.travel).toBeNull();
    w2.setPlayerInput({ forward: 1 });
    run(w2, 2);
    expect(w2.travel?.scene).toBe('a');
    w2.dispose();
  });

  it('without a landmark the player arrives at the Player start; scripts can change scene too', () => {
    const { b } = world();
    const go = newEntity('menu', {
      script: { version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'start' }, body: [{ id: 's', kind: 'changeScene', scene: 'b', landmark: '' }] }] } satisfies Script as never,
    });
    const w = GameWorld.create(scene('title', floor(), newEntity('start', { playerSpawn: {} }), go));
    expect(w.scriptProblems).toEqual([]);
    run(w, 0.1);
    expect(w.travel).toMatchObject({ scene: 'b', landmark: '', offset: null });
    const w2 = GameWorld.create(b, { arrive: w.travel! });
    expect(w2.player!.feetPosition.x).toBeCloseTo(3000, 0);
    expect(w2.player!.feetPosition.z).toBeCloseTo(3000, 0);
    w.dispose();
    w2.dispose();
  });
});
