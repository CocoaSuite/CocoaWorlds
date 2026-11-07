// Posters and paintings: carried against a wall they stick there flat; Use takes them down again.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
function world(poster: Record<string, unknown>) {
  const s = newScene('posters');
  // A wall 200 u ahead of the player (who looks along −Z).
  const p = newEntity('poster', { poster }, { position: [0, 8, -48] });
  s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), brush('wall', [-512, 0, -232], [512, 256, -200]), newEntity('start', { playerSpawn: {} }), p];
  const w = GameWorld.create(s);
  w.setPlayerInput({ pitch: -0.9 });
  run(w, 0.3);
  return { w, id: p.id };
}

describe('posters', () => {
  it('a poster carried into a wall sticks there, facing out; Use takes it down', () => {
    const { w, id } = world({ rolls: true });
    expect(w.posterHung(id)).toBe(false);
    w.use();
    run(w, 0.2);
    expect(w.holding).toBe(id);
    w.setPlayerInput({ pitch: 0, forward: 1 });
    run(w, 3);
    w.setPlayerInput({ forward: 0 });
    expect(w.posterHung(id)).toBe(true);
    expect(w.holding).toBe(null);
    const at = w.positionOf(id)!;
    // On the wall's face (z = −200), not fallen.
    expect(at[2]).toBeGreaterThan(-200);
    expect(at[2]).toBeLessThan(-195);
    run(w, 1);
    expect(w.positionOf(id)![1]).toBeCloseTo(at[1], 3);
    w.use();
    run(w, 0.2);
    expect(w.posterHung(id)).toBe(false);
    expect(w.holding).toBe(id);
    // Stepping back and in again hangs it once more.
    w.setPlayerInput({ forward: -1 });
    run(w, 0.5);
    w.setPlayerInput({ forward: 1 });
    run(w, 1.5);
    expect(w.posterHung(id)).toBe(true);
    w.dispose();
  });

  it('a painting hung at start stays put', () => {
    const { w, id } = world({ rolls: false, hungAtStart: true });
    run(w, 1);
    expect(w.posterHung(id)).toBe(true);
    expect(w.positionOf(id)![1]).toBeCloseTo(8, 3);
    w.dispose();
  });
});
