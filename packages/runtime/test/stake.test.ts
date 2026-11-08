// Props that stick into the ground when they hit it hard enough, tip first.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, type SavedProgress } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
function world(height: number, saved: SavedProgress | null = null, keepId?: string) {
  const s = newScene('stakes');
  const p = newEntity('sign', { collider: { shape: 'box', size: [4, 48, 4] }, rigidBody: { motion: 'dynamic' }, stake: { tip: 'bottom', speed: 160, depth: 6, tilt: 10 } }, { position: [64, height, -64] });
  if (keepId) p.id = keepId;
  s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }), p];
  const w = GameWorld.create(s, { rules: { saveWorld: true }, saved });
  return { w, id: p.id };
}

describe('stakes', () => {
  it('sticks in when dropped from high up, sunk and leaning a little', () => {
    const { w, id } = world(600);
    run(w, 3);
    expect(w.stakeStuck(id)).toBe(true);
    const at = w.positionOf(id)!;
    // Centre 24 u from the tip, 6 u in: about 18 u up.
    expect(at[1]).toBeGreaterThan(14);
    expect(at[1]).toBeLessThan(20);
    run(w, 1);
    expect(w.positionOf(id)![1]).toBeCloseTo(at[1], 3);
    w.dispose();
  });

  it('just falls over when dropped from low', () => {
    const { w, id } = world(30);
    run(w, 2);
    expect(w.stakeStuck(id)).toBe(false);
    w.dispose();
  });

  it('stays stuck after saving and loading', () => {
    const { w, id } = world(600);
    run(w, 3);
    const at = w.positionOf(id)!;
    const saved = JSON.parse(JSON.stringify(w.progress())) as SavedProgress;
    w.dispose();
    const { w: w2 } = world(600, saved, id);
    run(w2, 1);
    expect(w2.stakeStuck(id)).toBe(true);
    const at2 = w2.positionOf(id)!;
    expect(Math.hypot(at2[0] - at[0], at2[1] - at[1], at2[2] - at[2])).toBeLessThan(0.5);
    w2.dispose();
  });
});
