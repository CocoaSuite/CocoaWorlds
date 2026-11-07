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

  it('“When day n starts” runs on that day: the first, at midnight, or set by a block (not again for the same day)', () => {
    const on = (day: number, amount: number): Handler => ({ id: `h${day}`, event: { id: `e${day}`, kind: 'dayStarts', day: n(day) }, body: [score(`s${day}`, amount)] });
    const set9 = { id: 'm', event: { id: 'em', kind: 'start' as const }, body: [{ id: 'w', kind: 'wait' as const, seconds: n(1) }, { id: 'd', kind: 'setDay' as const, value: n(9) }, { id: 'd2', kind: 'setDay' as const, value: n(9) }] };
    const w = world([on(3, 1), on(9, 100), on(10, 10), set9]);
    run(w, 0.1);
    expect(w.playerStatus()!.score).toBe(1);
    run(w, 1.1);
    expect(w.playerStatus()!.score).toBe(101);
    run(w, 2);
    expect(w.playerStatus()!.score).toBe(111);
  });

  it('“today is day n” and the day on screen', () => {
    const w = world([{ id: 'h', event: { id: 'e', kind: 'every', seconds: n(0.5) }, body: [{ id: 'i', kind: 'if', condition: { id: 'c', kind: 'isDay', a: n(4) }, then: [score('s', 1)], otherwise: [] }] }], { showDay: true });
    expect(w.playerStatus()!.day).toBe(3);
    run(w, 2);
    expect(w.playerStatus()!.score).toBe(0);
    run(w, 1.5);
    expect(w.playerStatus()!.day).toBe(4);
    expect(w.playerStatus()!.score).toBeGreaterThan(0);
    expect(world([]).playerStatus()!.day).toBeNull();
  });

  it('the clock on screen', () => {
    const w = world([], { showClock: true });
    expect(w.playerStatus()!.clock).toBe(23);
    run(w, 3);
    expect(w.playerStatus()!.clock).toBeLessThan(1);
    expect(world([]).playerStatus()!.clock).toBeNull();
  });

  it('setting the clock to an earlier hour passes midnight: a new day', () => {
    const at = (h: number, seconds: number): Handler => ({ id: `t${h}`, event: { id: `et${h}`, kind: 'start' }, body: [{ id: `w${h}`, kind: 'wait', seconds: n(seconds) }, { id: `s${h}`, kind: 'setTime', value: n(h) }] });
    const w = world([at(6, 0.5), at(23.5, 1), { id: 'h', event: { id: 'e', kind: 'newDay' }, body: [score('s', 1)] }], { minutes: 0 });
    run(w, 0.7);
    expect(w.day).toBe(4);
    expect(w.dayHour).toBe(6);
    run(w, 0.5);
    expect(w.day).toBe(4);
    expect(w.dayHour).toBe(23.5);
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
