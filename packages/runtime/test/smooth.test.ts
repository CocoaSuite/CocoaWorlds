// Smooth frames: what is drawn between physics steps, blasts known up front, and paths found without fresh memory.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMat4, newEntity, newScene, newWeapon, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const floor = () => brush('floor', [-800, -16, -800], [800, 0, 800]);
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}

describe('smooth frames', () => {
  it('a falling crate is drawn between its last two physics steps, as far along as the time is', () => {
    const crate = brush('crate', [-16, 400, -16], [16, 432, 16], { rigidBody: { motion: 'dynamic' } });
    const w = GameWorld.create(scene(floor(), crate));
    for (let i = 0; i < 20; i++) w.step(1 / 60);
    const before = w.positionOf(crate.id)![1];
    w.step(1 / 60);
    const after = w.positionOf(crate.id)![1];
    expect(after).toBeLessThan(before - 1);
    // Right on a step: drawn where the step began (the player's view is drawn a step behind in just the same way).
    expect(applyMat4(w.drawnMotionOf(crate.id)!, [0, 416, 0])[1]).toBeCloseTo(before, 1);
    // Half a step on (no physics step yet): drawn half way from where it was to where it is.
    w.step(1 / 120);
    expect(w.positionOf(crate.id)![1]).toBeCloseTo(after, 5);
    expect(applyMat4(w.drawnMotionOf(crate.id)!, [0, 416, 0])[1]).toBeCloseTo((before + after) / 2, 0);
    // (The game itself still sees where it is.)
    expect(applyMat4(w.motionOf(crate.id)!, [0, 416, 0])[1]).toBeCloseTo(after, 1);
    w.dispose();
  });

  it('knows whether any weapon makes blasts', () => {
    const plain = GameWorld.create(scene(floor()));
    expect(plain.hasBlasts).toBe(false);
    plain.dispose();
    const s = scene(floor());
    s.settings.ui = { screens: [], items: [{ name: 'Pistol', icon: '', weapon: newWeapon('pistol') }, { name: 'Rockets', icon: '', weapon: newWeapon('rocket') }] };
    const w = GameWorld.create(s);
    expect(w.hasBlasts).toBe(true);
    w.dispose();
  });

  it('finds the same paths when searching again and again (its scratch memory is reused)', () => {
    const w = GameWorld.create(scene(floor(), brush('wall', [-800, 0, -8], [400, 160, 8])));
    const nav = w.navigation()!;
    const a = { x: 0, y: 0, z: -300 }, b = { x: 0, y: 0, z: 300 }, c = { x: -500, y: 0, z: 200 };
    const first = JSON.stringify(nav.path(a, b));
    expect(JSON.parse(first)).not.toBeNull();
    for (let i = 0; i < 5; i++) {
      nav.path(c, a);
      // (Cut short: a search that gives up still leaves nothing behind for the next.)
      nav.path(b, c, 20);
      expect(JSON.stringify(nav.path(a, b))).toBe(first);
    }
    w.dispose();
  });
});
