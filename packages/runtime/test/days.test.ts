// The day count: up at midnight, blocks for new days and hours, kept in saved progress and across scenes.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Handler } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const n = (value: number) => ({ id: `n${value}`, kind: 'number' as const, value });
const score = (id: string, amount: number) => ({ id, kind: 'addScore' as const, amount: n(amount) });
const floor = (min: Vec3, max: Vec3) => newEntity('floor', { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });

function world(handlers: Handler[], day: Record<string, unknown> = {}, values = false) {
  const s = newScene('days');
  s.settings.day = { enabled: true, minutes: 1, startHour: 23, night: 0.25, startDay: 3, ...day };
  const clock = newEntity('clock', {});
  clock.components.script = { version: 1, variables: [], handlers } as never;
  s.entities = [floor([-512, -16, -512], [512, 0, 512]), newEntity('start', { playerSpawn: {} }), clock];
  return GameWorld.create(s, values ? { values: [{ name: 'Gems', type: 'number', initial: 0, show: false, saved: true }] } : {});
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

describe('days', () => {
  it('starts on the first day and counts up at midnight, starting “When a new day starts”', () => {
    const w = world([{ id: 'h', event: { id: 'e', kind: 'newDay' }, body: [score('s', 1)] }]);
    expect(w.day).toBe(3);
    // (A day in a minute: 0.4 hours a second; midnight is 2.5 s away.)
    run(w, 2);
    expect(w.day).toBe(3);
    run(w, 1);
    expect(w.day).toBe(4);
    expect(w.dayHour).toBeLessThan(1);
    expect(w.playerStatus()!.score).toBe(1);
  });

  it('“When the clock reaches” starts once each time that hour passes', () => {
    const w = world([{ id: 'h', event: { id: 'e', kind: 'atHour', hour: n(0.5) }, body: [score('s', 1)] }]);
    run(w, 3);
    expect(w.playerStatus()!.score).toBe(0);
    run(w, 1.5);
    expect(w.playerStatus()!.score).toBe(1);
    run(w, 2);
    expect(w.playerStatus()!.score).toBe(1);
  });

  it('blocks set and read the day', () => {
    const w = world([
      {
        id: 'h',
        event: { id: 'e', kind: 'start' },
        body: [
          { id: 'd', kind: 'setDay', value: n(7) },
          { id: 'i', kind: 'if', condition: { id: 'c', kind: 'compare', op: '=', a: { id: 'v', kind: 'day' }, b: n(7) }, then: [score('s', 1)], otherwise: [] },
        ],
      },
    ]);
    run(w, 0.1);
    expect(w.day).toBe(7);
    expect(w.playerStatus()!.score).toBe(1);
  });

  it('an hour outside 0–24 is a problem', () => {
    const w = world([{ id: 'h', event: { id: 'e', kind: 'atHour', hour: n(30) }, body: [] }]);
    expect(w.scriptProblems.some((p) => /0 to 24/.test(p.message))).toBe(true);
  });

  it('is kept in saved progress and forgotten with it', () => {
    const w = world([], {}, true);
    run(w, 3);
    expect(w.progress()!.day).toBe(4);
    const s = newScene('days');
    s.settings.day = { enabled: true, minutes: 1, startHour: 9, night: 0.25, startDay: 1 };
    s.entities = [newEntity('start', { playerSpawn: {} })];
    const again = GameWorld.create(s, { values: [{ name: 'Gems', type: 'number', initial: 0, show: false, saved: true }], saved: w.progress() });
    expect(again.day).toBe(4);
    again.forgetProgress();
    expect(again.day).toBe(1);
  });

  it('goes with the player to another scene', () => {
    const w = world([]);
    run(w, 3);
    w.changeScene('next');
    expect(w.travel!.day).toBe(4);
  });
});
