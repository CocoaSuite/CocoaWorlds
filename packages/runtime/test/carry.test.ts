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

describe('placing what is held with scripts', () => {
  it('holding the crate, Use on the pedestal puts it on the spot; Use on it there picks it up again', async () => {
    const { blockId, newEvent, newExpr, newStatement, num } = await import('@cocoaworlds/scripting');
    const s = newScene('place');
    const crate = brush('crate', [-16, 0, -96], [16, 32, -64], { rigidBody: { motion: 'dynamic', mass: 10 } });
    const spot = newEntity('spot', {}, { position: [-80, 48, 0] });
    const pedestal = brush('pedestal', [-100, 0, -20], [-60, 32, 20]);
    const h = (event: unknown, ...body: unknown[]) => ({ id: blockId(), event, body });
    pedestal.components.script = {
      version: 1,
      variables: [],
      handlers: [h({ ...newEvent('useHolding'), item: { entity: crate.id }, reach: num(160) }, { ...newStatement('place'), target: { held: true }, spot: { entity: spot.id }, still: true })],
    } as never;
    // The crate: picked up by its own script (the player holds nothing), saying so when it was on the spot.
    const near = { ...newExpr('compare'), op: '<', a: { ...newExpr('distance'), from: { self: true }, to: { entity: spot.id } }, b: num(4) };
    const free = { ...newExpr('not'), a: newExpr('holds') };
    crate.components.script = {
      version: 1,
      variables: [],
      handlers: [
        h(newEvent('use'), {
          ...newStatement('if'),
          condition: { ...newExpr('logic'), op: 'and', a: free, b: near },
          then: [{ ...newStatement('say'), text: { ...newExpr('text'), value: 'Off the spot' } }],
        }, { ...newStatement('pickUp'), target: { self: true } }),
      ],
    } as never;
    s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }), crate, spot, pedestal];
    const w = GameWorld.create(s);
    expect(w.scriptProblems).toEqual([]);
    w.setPlayerInput({ pitch: -0.45 });
    run(w, 0.2);
    w.use();
    run(w, 0.3);
    expect(w.holding).toBe(crate.id);
    // Look at the pedestal and use it.
    w.setPlayerInput({ yaw: Math.PI / 2, pitch: -0.45 });
    run(w, 0.4);
    expect(w.usePrompt()).toBe('');
    w.use();
    run(w, 0.5);
    expect(w.holding).toBe(null);
    expect(w.positionOf(crate.id)!.map((v) => Math.round(v))).toEqual([-80, 48, 0]);
    // Still there a second later (it stays put).
    run(w, 1);
    expect(w.positionOf(crate.id)![1]).toBeCloseTo(48, 0);
    // Use on it: picked up again, and the script saw it was on the spot.
    w.setPlayerInput({ yaw: Math.PI / 2, pitch: -0.2 });
    run(w, 0.1);
    w.use();
    run(w, 0.3);
    expect(w.holding).toBe(crate.id);
    expect(w.screenMessages()).toEqual(['Off the spot']);
    w.dispose();
  });

  it('a held crate turns with the player, and R with the mouse turns it in the hands', () => {
    const { w, id } = world({});
    w.use();
    run(w, 0.5);
    w.setPlayerInput({ pitch: 0, yaw: Math.PI / 2 });
    run(w, 1);
    expect(Math.abs(w.yawOf(id)! - 90)).toBeLessThan(5);
    // (0.006 rad a pixel: 262 px is about 90 degrees.)
    w.rotateHeld(262, 0);
    run(w, 1);
    expect(w.holding).toBe(id);
    expect(Math.abs(w.yawOf(id)!)).toBeLessThan(8);
    w.dispose();
  });

  it('“When the player presses a key at this” fires when looking at it within reach or holding it, with its prompt', () => {
    const s = newScene('press');
    const lamp = brush('lamp', [-16, 0, -96], [16, 32, -64], { rigidBody: { motion: 'dynamic', mass: 10 } });
    lamp.components.script = {
      version: 1,
      variables: [],
      handlers: [{ id: 'h', event: { id: 'e', kind: 'press', key: 'KeyF', prompt: 'Switch' }, body: [{ id: 'a', kind: 'addScore', amount: { id: 'n', kind: 'number', value: 1 } }] }],
    } as never;
    s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }), lamp];
    const w = GameWorld.create(s);
    w.setPlayerInput({ pitch: -0.45 });
    run(w, 0.2);
    expect(w.keyPrompts()).toEqual([{ key: 'KeyF', prompt: 'Switch' }]);
    w.pressKey('KeyF');
    run(w, 0.1);
    expect(w.playerStatus()!.score).toBe(1);
    w.use();
    run(w, 0.5);
    w.setPlayerInput({ pitch: 1.2 });
    run(w, 0.2);
    expect(w.holding).toBe(lamp.id);
    expect(w.keyPrompts()).toEqual([{ key: 'KeyF', prompt: 'Switch' }]);
    w.pressKey('KeyF');
    run(w, 0.1);
    expect(w.playerStatus()!.score).toBe(2);
    w.dropHeld();
    w.setPlayerInput({ yaw: Math.PI, pitch: 0 });
    run(w, 1);
    expect(w.keyPrompts()).toEqual([]);
    w.pressKey('KeyF');
    run(w, 0.1);
    expect(w.playerStatus()!.score).toBe(2);
    w.dispose();
  });
});

