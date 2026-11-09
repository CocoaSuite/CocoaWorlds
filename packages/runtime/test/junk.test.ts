// Junk: a wide pile on the ground; picked up, packed into a small bundle; dropped, a pile again where it lands.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, type ModelMesh } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
/** A box as triangles, in game units. */
function cube(a: Vec3, b: Vec3): ModelMesh {
  const pos: number[] = [];
  for (let i = 0; i < 8; i++) pos.push(i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]);
  return { positions: new Float32Array(pos), indices: new Uint32Array([0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5]) };
}
const models = new Map([
  ['pile.glb', cube([-24, 0, -24], [24, 10, 24])],
  ['bundle.glb', cube([-8, 0, -8], [8, 16, 8])],
]);

function world(packed = 'bundle.glb') {
  const s = newScene('junk');
  const j = newEntity('junk', { model: { model: 'pile.glb', units: 'units', collision: 'auto' }, rigidBody: { motion: 'dynamic', mass: 8 }, junk: { packed } }, { position: [0, 1, -80] });
  s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }), j];
  const w = GameWorld.create(s, { models });
  w.setPlayerInput({ pitch: -0.7 });
  run(w, 0.3);
  return { w, id: j.id };
}

describe('junk', () => {
  it('starts as a pile, packs when picked up, spreads upright where it lands', () => {
    const { w, id } = world();
    expect(w.junkPacked(id)).toBe(false);
    w.use();
    run(w, 0.3);
    expect(w.holding).toBe(id);
    expect(w.junkPacked(id)).toBe(true);
    w.setPlayerInput({ pitch: 0 });
    run(w, 0.5);
    // Still packed while held, up in the air.
    expect(w.junkPacked(id)).toBe(true);
    w.use();
    run(w, 2);
    expect(w.holding).toBe(null);
    expect(w.junkPacked(id)).toBe(false);
    // A pile on the floor (origin at its bottom), upright.
    const y = w.positionOf(id)![1];
    expect(y).toBeGreaterThan(-1);
    expect(y).toBeLessThan(4);
    w.dispose();
  });

  it('a pile on the floor is not pushed (the player walks into it and it stays)', () => {
    const { w, id } = world();
    const at = w.positionOf(id)!;
    w.setPlayerInput({ pitch: 0, forward: 1 });
    run(w, 2);
    const now = w.positionOf(id)!;
    expect(Math.hypot(now[0] - at[0], now[2] - at[2])).toBeLessThan(0.01);
    w.dispose();
  });

  it('without a packed model it just stays a pile', () => {
    const { w, id } = world('');
    expect(w.junkPacked(id)).toBe(null);
    w.use();
    run(w, 0.3);
    expect(w.holding).toBe(id);
    w.dispose();
  });
});
