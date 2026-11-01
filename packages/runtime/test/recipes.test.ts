import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { RECIPES, compileScript, recipe, type Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const spawn = (at: Vec3 = [0, 0, 0]) => newEntity('start', { playerSpawn: {} }, { position: at });
const floor = () => brush('floor', [-1024, -16, -1024], [1024, 0, 1024]);
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

/** What the editor does: make the zone (if any) and put the blocks on the object. */
function apply(id: string, target: EntityData, min: Vec3, max: Vec3): EntityData[] {
  const r = recipe(id)!;
  const t = { id: target.id, name: target.name, min, max };
  let zone: EntityData | null = null;
  if (r.zone) {
    const z = r.zone(t);
    zone = brush(z.name, z.min, z.max, { trigger: { detects: z.detects, once: z.once } });
  }
  const out = r.build(t, zone?.id ?? null);
  const script: Script = { version: 1, variables: out.variables, handlers: out.handlers };
  target.components.script = script as never;
  return zone ? [target, zone] : [target];
}

function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}

describe('recipes', () => {
  it('every recipe compiles without problems', () => {
    for (const r of RECIPES) {
      const t = { id: 'obj', name: 'thing', min: [0, 0, 0] as Vec3, max: [64, 128, 16] as Vec3 };
      const out = r.build(t, r.zone ? 'zone' : null);
      const objects = new Map([
        ['obj', { name: 'thing', isZone: false }],
        ['zone', { name: 'zone', isZone: true }],
      ]);
      const c = compileScript('obj', { version: 1, variables: out.variables, handlers: out.handlers }, { objects });
      expect(c.problems, r.id).toEqual([]);
    }
  });

  it('door that opens when the player comes near', () => {
    const door = brush('door', [-64, 0, -320], [64, 128, -304]);
    const w = GameWorld.create(scene(floor(), spawn(), ...apply('door-near', door, [-64, 0, -320], [64, 128, -304])));
    run(w, 0.2);
    expect(w.positionOf(door.id)![1]).toBeCloseTo(64, 0);
    w.setPlayerInput({ forward: 1 });
    run(w, 1.2);
    w.setPlayerInput({ forward: 0 });
    run(w, 0.8);
    // Opened: up by its own height (its pivot, the middle of the door, starts at y = 64).
    expect(w.positionOf(door.id)![1]).toBeCloseTo(192, 0);
    w.setPlayerInput({ forward: -1 });
    run(w, 2);
    w.setPlayerInput({ forward: 0 });
    run(w, 0.8);
    expect(w.positionOf(door.id)![1]).toBeCloseTo(64, 0);
    w.dispose();
  });

  it('door that opens when used and closes by itself', () => {
    const door = brush('door', [-64, 0, -80], [64, 128, -64]);
    const w = GameWorld.create(scene(floor(), spawn(), ...apply('door-use', door, [-64, 0, -80], [64, 128, -64])));
    run(w, 0.3);
    w.use();
    run(w, 1);
    expect(w.positionOf(door.id)![1]).toBeCloseTo(192, 0);
    // Using it again while it moves does nothing; it closes by itself after 3 seconds.
    w.use();
    run(w, 1.5);
    expect(w.positionOf(door.id)![1]).toBeCloseTo(192, 0);
    run(w, 2.5);
    expect(w.positionOf(door.id)![1]).toBeCloseTo(64, 0);
    w.dispose();
  });

  it('platform that vanishes under the player, then comes back', () => {
    const plat = brush('plat', [-64, -16, -64], [64, 0, 64]);
    const w = GameWorld.create(scene(spawn(), ...apply('crumble', plat, [-64, -16, -64], [64, 0, 64])));
    run(w, 0.3);
    expect(w.player!.onGround).toBe(true);
    run(w, 0.8);
    // Gone: the player falls.
    expect(w.player!.feetPosition.y).toBeLessThan(-10);
    expect(w.isVisible(plat.id)).toBe(false);
    run(w, 3);
    expect(w.isVisible(plat.id)).toBe(true);
    w.dispose();
  });

  it('pickup disappears when touched and says so', () => {
    const gem = brush('gem', [-8, 16, -136], [8, 32, -120]);
    const w = GameWorld.create(scene(floor(), spawn(), ...apply('pickup', gem, [-8, 16, -136], [8, 32, -120])));
    w.setPlayerInput({ forward: 1 });
    run(w, 1);
    expect(w.isVisible(gem.id)).toBe(false);
    expect(w.drainLogs().map((l) => l.text)).toEqual(['Picked up gem']);
    w.dispose();
  });

  it('button sends “open”; a door with “Opens on message” opens', () => {
    const button = brush('button', [-16, 48, -80], [16, 80, -64]);
    const door = brush('door', [200, 0, 0], [216, 128, 128]);
    apply('button', button, [-16, 48, -80], [16, 80, -64]);
    apply('open-on-message', door, [200, 0, 0], [216, 128, 128]);
    const w = GameWorld.create(scene(floor(), spawn(), button, door));
    run(w, 0.3);
    w.use();
    run(w, 1.3);
    expect(w.positionOf(door.id)![1]).toBeCloseTo(192, 0);
    w.dispose();
  });
});

describe('use prompts', () => {
  it('looking at a door with “Door that opens when used” shows “Open”; looking away shows nothing', () => {
    const door = brush('door', [-64, 0, -80], [64, 128, -64]);
    const w = GameWorld.create(scene(floor(), spawn(), ...apply('door-use', door, [-64, 0, -80], [64, 128, -64])));
    run(w, 0.2);
    expect(w.usePrompt()).toBe('Open');
    w.setPlayerInput({ yaw: Math.PI });
    run(w, 0.05);
    expect(w.usePrompt()).toBeNull();
    // Out of reach: nothing either.
    w.setPlayerInput({ yaw: 0, forward: -1 });
    run(w, 1);
    w.setPlayerInput({ forward: 0 });
    run(w, 0.3);
    expect(w.usePrompt()).toBeNull();
    w.dispose();
  });

  it('a plain “When the player uses this” prompts with no word (shown as Use); the button says Press', () => {
    const button = brush('button', [-16, 32, -80], [16, 96, -64]);
    const w = GameWorld.create(scene(floor(), spawn(), ...apply('button', button, [-16, 32, -80], [16, 96, -64])));
    run(w, 0.2);
    expect(w.usePrompt()).toBe('Press');
    w.dispose();
    const box2 = brush('box', [-16, 32, -80], [16, 96, -64], { script: { version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'use' }, body: [] }] } });
    const w2 = GameWorld.create(scene(floor(), spawn(), box2));
    run(w2, 0.2);
    expect(w2.usePrompt()).toBe('');
    w2.dispose();
  });
});
