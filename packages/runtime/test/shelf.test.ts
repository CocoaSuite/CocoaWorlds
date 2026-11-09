// Shelves: carried with their back (−Z) to a wall and mounted there; a single Use does nothing, a held one takes it down.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, type SavedProgress } from '../src';

const HELD_TURN = 0.006;

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
function lookAt(w: GameWorld, at: Vec3) {
  const [x, y, z] = w.player!.eye();
  const dx = at[0] - x, dy = at[1] - y, dz = at[2] - z;
  w.setPlayerInput({ yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
  w.step(1 / 60);
}

function world(saved: SavedProgress | null = null, id?: string) {
  const s = newScene('shelf');
  const shelf = newEntity('shelf', { collider: { shape: 'box', size: [32, 2, 12] }, rigidBody: { motion: 'dynamic', mass: 2 }, shelf: { mountedAtStart: false } }, { position: [0, 1, -40] });
  if (id) shelf.id = id;
  s.entities = [brush('floor', [-1024, -16, -1024], [1024, 0, 1024]), brush('wall', [-400, 0, -96], [400, 200, -80]), newEntity('start', { playerSpawn: {} }), shelf];
  const w = GameWorld.create(s, { rules: { saveWorld: true }, saved });
  run(w, 0.3);
  return { w, shelf: shelf.id };
}

describe('shelves', () => {
  it('mounts by its back, ignores a tap of Use, comes down for a held Use; saved', () => {
    const { w, shelf } = world();
    lookAt(w, [0, 1, -40]);
    w.use();
    run(w, 0.3);
    expect(w.holding).toBe(shelf);
    lookAt(w, [0, 60, -80]);
    run(w, 0.3);
    expect(w.usePrompt()).toBe('Mount on the wall');
    w.use();
    run(w, 0.2);
    expect(w.holding).toBe(null);
    expect(w.shelfMounted(shelf)).toBe(true);
    const at = w.positionOf(shelf)!;
    // Its back on the wall (6 u behind its middle).
    expect(at[2]).toBeCloseTo(-80 + 6 + 0.05, 0);
    run(w, 1);
    expect(w.positionOf(shelf)![1]).toBeCloseTo(at[1], 3);

    // A tap of Use: nothing.
    lookAt(w, at);
    expect(w.usePrompt()).toBe('Hold to take down');
    w.use();
    w.setPlayerInput({ use: true });
    run(w, 0.1);
    w.setPlayerInput({ use: false });
    run(w, 0.2);
    expect(w.shelfMounted(shelf)).toBe(true);
    expect(w.holding).toBe(null);

    // Saved and loaded: still on the wall.
    const saved = JSON.parse(JSON.stringify(w.progress())) as SavedProgress;
    w.dispose();
    const w2 = world(saved, shelf).w;
    expect(w2.shelfMounted(shelf)).toBe(true);
    // Held: down into the hands.
    lookAt(w2, at);
    w2.setPlayerInput({ use: true });
    run(w2, 0.8);
    expect(w2.shelfMounted(shelf)).toBe(false);
    expect(w2.holding).toBe(shelf);
    w2.dispose();
  });

  it('turned the wrong way, it will not mount', () => {
    const { w, shelf } = world();
    lookAt(w, [0, 1, -40]);
    w.use();
    run(w, 0.3);
    // Spun half round: its back now toward the player.
    w.rotateHeld(Math.PI / HELD_TURN, 0);
    lookAt(w, [0, 60, -80]);
    run(w, 0.5);
    expect(w.usePrompt()).toBe('Turn its back to the wall');
    w.use();
    run(w, 0.2);
    expect(w.shelfMounted(shelf)).toBe(false);
    expect(w.holding).toBe(shelf);
    w.dispose();
  });
});
