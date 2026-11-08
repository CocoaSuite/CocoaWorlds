// 3D printers: the Print block puts a still, untouchable copy on the plate; it is let go when its layers are done,
// “When a print is done” runs, the next print waits its turn, and a print under way is kept with the world.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics, type SavedProgress } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
const n = (value: number) => ({ id: Math.random().toString(36), kind: 'number' as const, value });
const send = (w: GameWorld, message: string) => {
  (w as unknown as { runner: { dispatch(e: unknown): void } }).runner.dispatch({ type: 'message', message, to: null, from: null });
  run(w, 0.1);
};
const store = (w: GameWorld): SavedProgress => JSON.parse(JSON.stringify(w.progress()));

function scene(): { s: SceneFile; crate: EntityData; printer: EntityData } {
  const s = newScene('home');
  // A 16 u crate (16 layers of 1 u, 0.1 s each: 1.6 s), kept out of sight as the catalogue's original.
  const crate = brush('crate', [300, 0, 300], [316, 16, 316], { rigidBody: { motion: 'dynamic', mass: 5 } });
  const printer = newEntity('printer', { printer: { bed: [0, 40, 0], layerHeight: 1, layerSeconds: 0.1 } as never }, { position: [0, 0, -200] });
  const script: Script = {
    version: 1,
    variables: [],
    handlers: [
      {
        id: 'h1',
        event: { id: 'e1', kind: 'message', message: 'buy' },
        body: [{ id: 'p', kind: 'print', template: { entity: crate.id }, printer: { entity: printer.id } }],
      },
    ],
  };
  printer.components.script = {
    version: 1,
    variables: [],
    handlers: [{ id: 'h2', event: { id: 'e2', kind: 'printed' }, body: [{ id: 'c', kind: 'change', variable: 'Printed', by: n(1) }] }],
  } as never;
  s.entities = [brush('floor', [-1024, -16, -1024], [1024, 0, 1024]), newEntity('start', { playerSpawn: {} }), crate, printer, newEntity('shop', { script: script as never })];
  return { s, crate, printer };
}
const values = [{ name: 'Printed', type: 'number' as const, initial: 0, show: false }];

describe('3D printer', () => {
  it('prints on the plate, lets go when done, then prints the next one', () => {
    const { s, crate, printer } = scene();
    const w = GameWorld.create(s, { values });
    expect(w.scriptProblems).toEqual([]);
    run(w, 0.1);
    send(w, 'buy');
    send(w, 'buy');
    const first = w.prints();
    expect(first).toHaveLength(1);
    expect(first[0]!.printer).toBe(printer.id);
    expect(w.printQueue(printer.id)).toBe(1);
    const copy = first[0]!.copy;
    expect(copy.startsWith(`${crate.id}#`)).toBe(true);
    // Standing on the plate (bottom at its top, middle over its middle), held still while it prints.
    const at = w.positionOf(copy)!;
    expect(at[0]).toBeCloseTo(0, 3);
    expect(at[1]).toBeCloseTo(48, 3);
    expect(at[2]).toBeCloseTo(-200, 3);
    run(w, 1);
    expect(w.positionOf(copy)![1]).toBeCloseTo(48, 3);
    expect(w.prints()[0]!.done).toBeGreaterThan(0.5);
    expect(w.gameValues()[0]!.value).toBe(0);
    // Done: it rests on the built-in printer's plate (not through it), the printer's “print done” ran, the next print began.
    run(w, 1.5);
    expect(w.gameValues()[0]!.value).toBe(1);
    expect(w.positionOf(copy)![1]).toBeGreaterThan(46);
    expect(w.positionOf(copy)![1]).toBeLessThan(50);
    const second = w.prints();
    expect(second).toHaveLength(1);
    expect(second[0]!.copy).not.toBe(copy);
    expect(w.printQueue(printer.id)).toBe(0);
    run(w, 2);
    expect(w.gameValues()[0]!.value).toBe(2);
    expect(w.prints()).toEqual([]);
  });

  it('a print under way is kept with the world and goes on after loading', () => {
    const { s, printer } = scene();
    const w1 = GameWorld.create(s, { values, rules: { saveWorld: true } });
    run(w1, 0.1);
    send(w1, 'buy');
    send(w1, 'buy');
    run(w1, 0.8);
    const copy = w1.prints()[0]!.copy;
    const saved = store(w1);
    const kept = saved.world!.home!;
    expect(kept.printers?.[printer.id]?.job?.[0]).toBeDefined();
    expect(kept.printers?.[printer.id]?.queue).toHaveLength(1);
    expect(kept.copies).toEqual([]);

    const w2 = GameWorld.create(s, { values, rules: { saveWorld: true }, saved });
    const again = w2.prints();
    expect(again).toHaveLength(1);
    expect(again[0]!.copy).toBe(copy);
    expect(again[0]!.done).toBeGreaterThan(0.4);
    expect(w2.positionOf(copy)![1]).toBeCloseTo(48, 3);
    run(w2, 1.2);
    expect(w2.prints()[0]?.copy).not.toBe(copy);
    expect(w2.prints()).toHaveLength(1);
    expect(w2.printQueue(printer.id)).toBe(0);
  });

  it('a printed prop keeps what is inside it: brushes and models ride its body', () => {
    const { s, crate, printer } = scene();
    const lid = brush('lid', [300, 16, 300], [316, 18, 316]);
    lid.parent = crate.id;
    const badge = newEntity('badge', { model: { model: 'badge.glb', collision: 'none' } as never }, { position: [308, 8, 316] });
    badge.parent = crate.id;
    const lamp = newEntity('lamp', { light: { kind: 'point', color: '#ffaa55', intensity: 3, range: 300, on: false } as never }, { position: [308, 12, 308] });
    lamp.parent = crate.id;
    s.entities.push(lid, badge, lamp);
    const w = GameWorld.create(s, { values });
    run(w, 0.1);
    send(w, 'buy');
    const copy = w.prints()[0]!.copy;
    expect(w.prints()[0]!.parts).toEqual(expect.arrayContaining([copy, `${lid.id}#1`, `${badge.id}#1`]));
    expect(w.bodyBrushes(copy)).toHaveLength(2);
    expect(w.riders(copy).map((r) => r.id)).toEqual([`${badge.id}#1`]);
    expect(w.bodyOf(`${lid.id}#1`)).toBe(copy);
    expect(w.bodyOf(`${badge.id}#1`)).toBe(copy);
    // Its light comes along as set up on the original: switched off, as bright and as far-reaching, carried by it.
    const light = `${lamp.id}#1`;
    expect(w.copiedLights().map((c) => c.id)).toEqual([light]);
    expect(w.lightOf(light)).toMatchObject({ on: false, intensity: 3, range: 300 });
    expect(w.bodyOf(light)).toBe(copy);
    void printer;
  });
});
