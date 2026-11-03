// Picking things up: Use holds a light physics object in front of the player, Use again drops it, Fire throws it.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
function world(rb: Record<string, unknown>) {
  const s = newScene('carry');
  const crate = brush('crate', [-16, 0, -96], [16, 32, -64], { rigidBody: { motion: 'dynamic', mass: 10, ...rb } });
  s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }), crate];
  const w = GameWorld.create(s);
  w.setPlayerInput({ pitch: -0.45 });
  run(w, 0.2);
  return { w, id: crate.id };
}

describe('carrying', () => {
  it('Use picks a crate up; it follows the view; Use drops it', () => {
    const { w, id } = world({});
    expect(w.usePrompt()).toBe('');
    w.use();
    run(w, 0.5);
    expect(w.holding).toBe(id);
    w.setPlayerInput({ pitch: 0 });
    run(w, 0.5);
    // Held up at eye height in front.
    expect(w.positionOf(id)![1]).toBeGreaterThan(40);
    w.setPlayerInput({ yaw: Math.PI / 2 });
    run(w, 0.5);
    const p = w.positionOf(id)!;
    expect(w.holding).toBe(id);
    expect(Math.abs(p[0])).toBeGreaterThan(40);
    w.use();
    run(w, 1.5);
    expect(w.holding).toBe(null);
    expect(w.positionOf(id)![1]).toBeLessThan(30);
    w.dispose();
  });

  it('Fire throws it', () => {
    const { w, id } = world({});
    w.use();
    run(w, 0.3);
    w.setPlayerInput({ pitch: 0, fire: true });
    run(w, 0.05);
    w.setPlayerInput({ fire: false });
    expect(w.holding).toBe(null);
    const z0 = w.positionOf(id)![2];
    run(w, 0.2);
    expect(w.positionOf(id)![2]).toBeLessThan(z0 - 80);
    w.dispose();
  });

  it('too heavy, or set not to, stays put', () => {
    for (const rb of [{ mass: 200 }, { pickUp: false }]) {
      const { w } = world(rb);
      expect(w.usePrompt()).toBe(null);
      w.use();
      run(w, 0.2);
      expect(w.holding).toBe(null);
      w.dispose();
    }
  });
});
