import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type SceneFile } from '@cocoaworlds/core';
import type { GameValueDef, Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const n = (value: number) => ({ id: Math.random().toString(36), kind: 'number' as const, value });
const values: GameValueDef[] = [
  { name: 'Cash', type: 'number', initial: 10, show: true, saved: true },
  { name: 'Round', type: 'number', initial: 1, show: true },
  { name: 'PlantedAt', type: 'number', initial: 0, show: false, saved: true },
];

function scene(script: Script): SceneFile {
  const s = newScene('test');
  s.entities = [newEntity('farm', { script: script as never })];
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

describe('saved progress', () => {
  // A garden: planting records the real time; the seed is ready when 60 real seconds have passed, even if the
  // game was closed in between.
  const script: Script = {
    version: 1,
    variables: [],
    handlers: [
      {
        id: 'h',
        event: { id: 'e', kind: 'message', message: 'plant' },
        body: [
          { id: 'a', kind: 'change', variable: 'Cash', by: n(-5) },
          { id: 'b', kind: 'set', variable: 'PlantedAt', value: { id: 'c', kind: 'clock' } },
          { id: 'g', kind: 'giveItem', item: 'Seed', amount: n(2) },
        ],
      },
      {
        id: 'r',
        event: { id: 'e2', kind: 'message', message: 'check' },
        body: [
          {
            id: 'i',
            kind: 'if',
            condition: { id: 'q', kind: 'compare', op: '≥', a: { id: 'm', kind: 'maths', op: '-', a: { id: 'c2', kind: 'clock' }, b: { id: 'v', kind: 'variable', name: 'PlantedAt' } }, b: n(60) },
            then: [{ id: 's', kind: 'say', text: { id: 't', kind: 'text', value: 'Ready!' }, seconds: n(5) }],
            otherwise: [{ id: 's2', kind: 'say', text: { id: 't2', kind: 'text', value: 'Growing' }, seconds: n(5) }],
          },
        ],
      },
      { id: 'f', event: { id: 'e3', kind: 'message', message: 'reset' }, body: [{ id: 'x', kind: 'forgetProgress' }] },
    ],
  };
  const send = (w: GameWorld, message: string) => {
    (w as unknown as { runner: { dispatch(e: unknown): void } }).runner.dispatch({ type: 'message', message, to: null, from: null });
    run(w, 0.1);
  };

  it('keeps marked values (and items, when the game keeps them) from one session to the next', () => {
    let now = 1_000_000;
    const w1 = GameWorld.create(scene(script), { values, rules: { saveItems: true }, clock: () => now });
    run(w1, 0.1);
    expect(w1.progress()).toEqual({ values: { Cash: 10, PlantedAt: 0 }, items: [] });
    send(w1, 'plant');
    send(w1, 'check');
    expect(w1.screenMessages()).toEqual(['Growing']);
    const saved = JSON.parse(JSON.stringify(w1.progress()));
    expect(saved).toEqual({ values: { Cash: 5, PlantedAt: 1_000_000 }, items: [['Seed', 2]] });
    w1.dispose();

    // A day later, a new session starts from it: Round (not kept) is back to 1.
    now += 86_400;
    const w2 = GameWorld.create(scene(script), { values, rules: { saveItems: true }, saved, clock: () => now });
    run(w2, 0.1);
    expect(w2.gameValues().map((v) => [v.name, v.value])).toEqual([['Cash', 5], ['Round', 1], ['PlantedAt', 1_000_000]]);
    expect(w2.uiState().inventory).toEqual([{ item: 'Seed', count: 2 }]);
    send(w2, 'check');
    expect(w2.screenMessages()).toEqual(['Ready!']);

    // Starting over.
    send(w2, 'reset');
    expect(w2.progress()).toEqual({ values: { Cash: 10, PlantedAt: 0 }, items: [] });
    w2.dispose();
  });

  it('ignores saved values of the wrong type, values no longer kept, and items when the game doesn’t keep them', () => {
    const saved = { values: { Cash: 'lots', Round: 7, PlantedAt: 5 }, items: [['Seed', 3]] as [string, number][] };
    const w = GameWorld.create(scene(script), { values, saved });
    expect(w.gameValues().map((v) => v.value)).toEqual([10, 1, 5]);
    expect(w.uiState().inventory).toEqual([]);
    expect(w.progress()).toEqual({ values: { Cash: 10, PlantedAt: 5 } });
    w.dispose();
    // Nothing kept: nothing to save.
    expect(GameWorld.create(scene(script), { values: values.map((v) => ({ ...v, saved: false })) }).progress()).toBeNull();
  });
});
