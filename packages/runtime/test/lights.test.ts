// Lights in play: riding the physics object they are inside, switched and changed by blocks; models' glow.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script, Statement } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
const n = (value: number) => ({ id: `n${value}`, kind: 'number' as const, value });
const onStart = (body: Statement[]): Script => ({ version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'start' }, body }] });

function world(body: (lamp: string) => Statement[], light: Record<string, unknown> = {}) {
  const s = newScene('lights');
  const flood = brush('floodlight', [-16, 0, -96], [16, 32, -64], { rigidBody: { motion: 'dynamic', mass: 10 } });
  const lamp = newEntity('lamp', { light: { kind: 'spot', intensity: 1, ...light } }, { position: [0, 40, -80], rotation: [0, 0, 0] });
  lamp.parent = flood.id;
  flood.components.script = onStart(body(lamp.id)) as never;
  s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }), flood, lamp];
  const w = GameWorld.create(s);
  w.setPlayerInput({ pitch: -0.45 });
  return { w, flood: flood.id, lamp: lamp.id };
}

describe('lights in play', () => {
  it('a light inside a physics object rides with it, and Turn off works on the light alone', () => {
    const { w, flood, lamp } = world((l) => [{ id: 's', kind: 'turnOff', target: { entity: l } }]);
    run(w, 0.2);
    expect(w.bodyOf(lamp)).toBe(flood);
    expect(w.lightOf(lamp)!.on).toBe(false);
    // (Still solid: switching the light didn't switch the floodlight's colliders.)
    expect(w.switchedOn(flood)).toBeUndefined();
    w.use();
    run(w, 0.3);
    expect(w.holding).toBe(flood);
  });

  it('starts off when set so, and blocks change brightness over time and colour at once', () => {
    const { w, lamp } = world(
      (l) => [
        { id: 'a', kind: 'setLight', target: { entity: l }, prop: 'intensity', value: n(3), seconds: n(1) },
        { id: 'b', kind: 'setLight', target: { entity: l }, prop: 'color', value: { id: 't', kind: 'text', value: '#ff0000' }, seconds: n(0) },
      ],
      { on: false },
    );
    expect(w.lightOf(lamp)!.on).toBe(false);
    run(w, 0.5);
    expect(w.lightOf(lamp)!.intensity).toBeGreaterThan(1.5);
    expect(w.lightOf(lamp)!.intensity).toBeLessThan(2.5);
    expect(w.lightOf(lamp)!.color).toEqual([1, 0, 0]);
    run(w, 1);
    expect(w.lightOf(lamp)!.intensity).toBeCloseTo(3);
  });

  it('“a light is on” reads the switch; the glow is kept for the model', () => {
    const { w, flood } = world((l) => [
      { id: 'o', kind: 'turnOff', target: { entity: l } },
      { id: 'i', kind: 'if', condition: { id: 'c', kind: 'lightOn', target: { entity: l } }, then: [], otherwise: [{ id: 'sc', kind: 'addScore', amount: n(5) }] },
      { id: 'g', kind: 'setGlow', target: { self: true }, strength: n(0), seconds: n(0) },
    ]);
    run(w, 0.2);
    expect(w.playerStatus()!.score).toBe(5);
    expect(w.glowing()).toEqual([[flood, null, 0, 1]]);
  });

  it('light blocks on something that is not a light are a problem', () => {
    const { w } = world(() => [{ id: 'x', kind: 'setLight', target: { self: true }, prop: 'intensity', value: n(1), seconds: n(0) }]);
    expect(w.scriptProblems.some((p) => /not a light/.test(p.message))).toBe(true);
  });

  it('the clock runs with day and night on; blocks set and read the time of day', () => {
    const s = newScene('day');
    s.settings.day = { enabled: true, minutes: 1, startHour: 6, night: 0.25, startDay: 1 };
    const box = newEntity('box', {});
    box.components.script = onStart([
      { id: 'w', kind: 'wait', seconds: n(0.5) },
      { id: 't', kind: 'setTime', value: n(21) },
      { id: 'i', kind: 'if', condition: { id: 'c', kind: 'compare', op: '>', a: { id: 'tod', kind: 'timeOfDay' }, b: n(20) }, then: [{ id: 'sc', kind: 'addScore', amount: n(1) }], otherwise: [] },
    ]) as never;
    s.entities = [brush('floor', [-512, -16, -512], [512, 0, 512]), newEntity('start', { playerSpawn: {} }), box];
    const w = GameWorld.create(s);
    expect(w.dayHour).toBe(6);
    run(w, 0.25);
    // (A day in a minute: 0.4 hours a second.)
    expect(w.dayHour).toBeCloseTo(6.1, 1);
    run(w, 0.5);
    expect(w.playerStatus()!.score).toBe(1);
    expect(w.dayHour).toBeGreaterThan(21);
  });
});

