// Power: a generator feeds an outlet; an extension cord plugs into it; string lights plug into the cord, hang between two points, and light up.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, PowerGrid, initPhysics, rayNearLine, type SavedProgress } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

describe('the power grid', () => {
  it('is live down a chain of cords to an outlet whose source is on; no loops', () => {
    const g = new PowerGrid();
    g.sources.set('gen', false);
    g.outlets.set('out', 'gen');
    g.plugs.set('a', { cable: 100, into: 'out' });
    g.cords.add('a');
    g.plugs.set('b', { cable: 100, into: 'a' });
    g.cords.add('b');
    expect(g.live('b')).toBe(false);
    g.sources.set('gen', true);
    expect(g.live('b')).toBe(true);
    expect(g.canPlug('a', 'b')).toBe(false);
    expect(g.canPlug('b', 'out')).toBe(true);
  });

  it('finds how close a look comes to a wire', () => {
    const r = rayNearLine([0, 0, 0], [0, 0, -1], [[-10, 2, -50], [10, 2, -50]], 100)!;
    expect(r.t).toBeCloseTo(50, 3);
    expect(r.d).toBeCloseTo(2, 3);
  });
});

/**
 * A room: a wall ahead (z = -80), a generator, an outlet on the wall, an extension cord and a coil of string
 * lights on the floor in front of the player.
 */
function world(saved: SavedProgress | null = null, ids?: Record<string, string>) {
  const s = newScene('power');
  const gen = newEntity('generator', { collider: { shape: 'box', size: [32, 24, 24] }, powerSource: { on: false } }, { position: [-50, 12, -50] });
  const outlet = newEntity('outlet', { collider: { shape: 'box', size: [8, 12, 2] }, outlet: { source: gen.id } }, { position: [0, 40, -79] });
  const cord = newEntity('cord', { collider: { shape: 'box', size: [16, 6, 10] }, rigidBody: { motion: 'dynamic', mass: 1 }, extender: { cable: 256 } }, { position: [0, 3, -40] });
  const lights = newEntity('lights', { collider: { shape: 'box', size: [12, 8, 12] }, rigidBody: { motion: 'dynamic', mass: 1 }, stringLights: {} }, { position: [24, 4, -40] });
  for (const [k, e] of Object.entries({ gen, outlet, cord, lights })) if (ids?.[k]) e.id = ids[k]!;
  s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), brush('wall', [-400, 0, -96], [400, 200, -80]), newEntity('start', { playerSpawn: {} }), gen, outlet, cord, lights];
  if (ids) outlet.components.outlet = { source: gen.id };
  const w = GameWorld.create(s, { rules: { saveWorld: true }, saved });
  run(w, 0.3);
  return { w, gen: gen.id, outlet: outlet.id, cord: cord.id, lights: lights.id };
}
/** Look at a point from where the player's eyes are. */
function lookAt(w: GameWorld, at: Vec3) {
  const p = w.player!;
  const [x, y, z] = p.eye();
  const dx = at[0] - x, dy = at[1] - y, dz = at[2] - z;
  w.setPlayerInput({ yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
  w.step(1 / 60);
}

describe('string lights and outlets', () => {
  it('plug the cord in, the lights into the cord, hang them, switch the generator on', () => {
    const { w, gen, outlet, cord, lights } = world();
    lookAt(w, [0, 3, -40]);
    w.use();
    run(w, 0.2);
    expect(w.holding).toBe(cord);
    lookAt(w, [0, 40, -79]);
    expect(w.usePrompt()).toBe('Plug in');
    w.use();
    run(w, 0.1);
    expect(w.pluggedInto(cord)).toBe(outlet);
    // Let go of the cord (Use on nothing).
    lookAt(w, [0, 200, 400]);
    w.use();
    run(w, 2);
    expect(w.holding).toBe(null);
    expect(w.pluggedInto(cord)).toBe(outlet);
    const c = w.positionOf(cord)!;
    lookAt(w, [24, 4, -40]);
    w.use();
    run(w, 0.2);
    expect(w.holding).toBe(lights);
    lookAt(w, c);
    expect(w.usePrompt()).toBe('Plug in');
    w.use();
    run(w, 0.1);
    expect(w.pluggedInto(lights)).toBe(cord);
    // One end on the wall, then the other.
    lookAt(w, [-40, 90, -80]);
    expect(w.usePrompt()).toBe('Hang one end');
    w.use();
    run(w, 0.1);
    lookAt(w, [40, 90, -80]);
    expect(w.usePrompt()).toBe('Hang the other end');
    w.use();
    run(w, 0.1);
    expect(w.holding).toBe(null);
    expect(w.bulbsOf(lights).length).toBeGreaterThan(5);
    expect(w.powered(lights)).toBe(false);
    lookAt(w, [-50, 12, -50]);
    expect(w.usePrompt()).toBe('Turn on');
    w.use();
    run(w, 0.1);
    expect(w.powerOn(gen)).toBe(true);
    expect(w.powered(lights)).toBe(true);
    expect(w.powerView().strings.find((s) => s.id === lights)!.lit).toBe(true);

    // Saved and loaded: still hung, plugged in and lit.
    const saved = JSON.parse(JSON.stringify(w.progress())) as SavedProgress;
    w.dispose();
    const w2 = world(saved, { gen, outlet, cord, lights }).w;
    expect(w2.bulbsOf(lights).length).toBeGreaterThan(5);
    expect(w2.powered(lights)).toBe(true);

    // Taken down: in the hands again; walked far away, it comes unplugged.
    lookAt(w2, [0, 82, -79]);
    expect(w2.usePrompt()).toBe('Take down');
    w2.use();
    run(w2, 0.1);
    expect(w2.holding).toBe(lights);
    w2.dispose();
  });

  it('a cord carried too far from its outlet comes unplugged', () => {
    const { w, outlet, cord } = world();
    lookAt(w, [0, 3, -40]);
    w.use();
    run(w, 0.2);
    lookAt(w, [0, 40, -79]);
    w.use();
    run(w, 0.1);
    expect(w.pluggedInto(cord)).toBe(outlet);
    w.setPlayerInput({ yaw: 0, pitch: 0, forward: -1 });
    run(w, 4);
    expect(w.pluggedInto(cord)).toBe(null);
    w.dispose();
  });
});
