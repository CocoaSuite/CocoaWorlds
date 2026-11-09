import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const scene = (...entities: EntityData[]): SceneFile => ({ ...newScene('test'), entities });
const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < s; t += 1 / 60) w.step(1 / 60);
};

describe('No Render zones (asset parks)', () => {
  it('objects in the zone are off while playing, and copies of them come out live', () => {
    const floor = brush('floor', [-512, -16, -512], [512, 0, 512]);
    const park = brush('park', [2000, -100, -100], [2400, 300, 300], { noRender: {} });
    const crate = brush('crate', [2100, 100, 0], [2132, 132, 32], { rigidBody: { motion: 'dynamic' } });
    const mark = newEntity('mark', {}, { position: [0, 100, 0] });
    const w = GameWorld.create(scene(floor, park, crate, mark));
    run(w, 1);
    // Parked: no body, so it doesn't fall (there is no floor under it anyway).
    expect(w.positionOf(crate.id)).toBeFalsy();
    const copy = w.spawn(crate.id, { ref: mark.id } as never)!;
    run(w, 2);
    expect(w.positionOf(copy)![1]).toBeCloseTo(16, 0);
    w.dispose();
  });

  it('objects outside the zone are untouched', () => {
    const floor = brush('floor', [-512, -16, -512], [512, 0, 512]);
    const park = brush('park', [2000, -100, -100], [2400, 300, 300], { noRender: {} });
    const crate = brush('crate', [-16, 100, -16], [16, 132, 16], { rigidBody: { motion: 'dynamic' } });
    const w = GameWorld.create(scene(floor, park, crate));
    run(w, 2);
    expect(w.positionOf(crate.id)![1]).toBeCloseTo(16, 0);
    w.dispose();
  });
});
