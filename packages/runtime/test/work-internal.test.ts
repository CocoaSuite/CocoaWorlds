// Work internal: copies of an object with a script (a work light: the model with its light inside) work their own
// parts, though every copy's blocks point at the first one's.
import { beforeAll, describe, expect, it } from 'vitest';
import { LINK, internalResolver, newEntity, newScene, workInternal, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script, Statement } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
const n = (value: number) => ({ id: `n${value}`, kind: 'number' as const, value });
/** The work light's script: on `event`, turn its light on, brighten it, and make the model glow. */
const lightScript = (event: 'start' | 'message', target: string, internal: boolean): Script => ({
  version: 1,
  variables: [],
  handlers: [
    {
      id: 'h',
      event: (event === 'start' ? { id: 'e', kind: 'start' } : { id: 'e', kind: 'message', message: 'never' }) as never,
      body: [
        { id: 'on', kind: 'turnOn', target: { entity: target } },
        { id: 'b', kind: 'setLight', target: { entity: target }, prop: 'intensity', value: n(4), seconds: n(0) },
        { id: 'g', kind: 'setGlow', target: { self: true }, strength: n(2), seconds: n(0) },
      ],
    },
  ],
  ...(internal ? { workInternal: true } : {}),
});

/** A work light: an object with a light inside; its script names a light by id (the first one's, in copies). */
function workLight(name: string, x: number, event: 'start' | 'message', lightId: string | null, internal: boolean) {
  const holder = newEntity(name, {}, { position: [x, 32, 0], rotation: [0, 0, 0] });
  const light = newEntity('Work light bulb', { light: { kind: 'spot', intensity: 1, on: false } });
  light.parent = holder.id;
  holder.components.script = lightScript(event, lightId ?? light.id, internal) as never;
  return { holder, light };
}

/** The first work light never runs its stack; the two copies made from it in the editor run theirs at the start. */
function scene(internal: boolean) {
  const s = newScene('work lights');
  const a = workLight('Work light', 0, 'message', null, internal);
  const b = workLight('Work light_2', 200, 'start', a.light.id, internal);
  const c = workLight('Work light_3', 400, 'start', a.light.id, internal);
  s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }), a.holder, a.light, b.holder, b.light, c.holder, c.light];
  return { s, a, b, c };
}

describe('work internal', () => {
  it('finds the part inside the object first, then going out; by id, prefab part, name, or name without its copy number', () => {
    const group = newEntity('Lamp group', {});
    const holder = newEntity('Work light_2', {});
    holder.parent = group.id;
    const bulb = newEntity('Bulb', {});
    bulb.parent = holder.id;
    const switcher = newEntity('Switch', {});
    switcher.parent = group.id;
    const other = newEntity('Bulb', {});
    const otherHolder = newEntity('Work light', {});
    const linkedA = newEntity('Part A', { [LINK]: { prefab: 'p', entity: 'src' } as never });
    const linkedB = newEntity('Renamed part', { [LINK]: { prefab: 'p', entity: 'src' } as never });
    linkedB.parent = holder.id;
    const resolve = internalResolver([group, holder, bulb, switcher, other, otherHolder, linkedA, linkedB]);
    expect(resolve(holder.id, other.id)).toBe(bulb.id); // same name, inside itself
    expect(resolve(switcher.id, other.id)).toBe(bulb.id); // inside what it is in
    expect(resolve(switcher.id, otherHolder.id)).toBe(holder.id); // Work light_2 for Work light
    expect(resolve(holder.id, linkedA.id)).toBe(linkedB.id); // the same prefab part, renamed
    expect(resolve(other.id, bulb.id)).toBe(other.id);
    const lonely = newEntity('Lonely', {});
    expect(internalResolver([lonely, bulb])(lonely.id, bulb.id)).toBe(bulb.id); // nothing inside: unchanged
  });

  it('leaves scripts that do not work internal alone', () => {
    const { s } = scene(false);
    expect(workInternal(s)).toBe(s);
  });

  it('without it, copies all drive the first light (the old way)', () => {
    const { s, a, b, c } = scene(false);
    const w = GameWorld.create(s);
    run(w, 0.1);
    expect(w.lightOf(a.light.id)!.on).toBe(true);
    expect(w.lightOf(b.light.id)!.on).toBe(false);
    expect(w.lightOf(c.light.id)!.on).toBe(false);
  });

  it('each copy of a work light turns on its own light and brightness; the glow stays its own', () => {
    const { s, a, b, c } = scene(true);
    const w = GameWorld.create(s);
    run(w, 0.1);
    expect(w.scriptProblems).toEqual([]);
    expect(w.lightOf(a.light.id)!.on).toBe(false);
    expect(w.lightOf(a.light.id)!.intensity).toBeCloseTo(1);
    for (const copy of [b, c]) {
      expect(w.lightOf(copy.light.id)!.on).toBe(true);
      expect(w.lightOf(copy.light.id)!.intensity).toBeCloseTo(4);
    }
    expect(w.glowing().map((g) => g[0]).sort()).toEqual([b.holder.id, c.holder.id].sort());
  });

  it('works on every block that names an object: a message sent to one object, and moves', () => {
    const s = newScene('values');
    const lidScript: Script = {
      version: 1,
      variables: [],
      handlers: [{ id: 'h', event: { id: 'e', kind: 'message', message: 'open' } as never, body: [{ id: 'm', kind: 'move', target: { self: true }, direction: 'up', distance: n(40), seconds: n(0) }] }],
    };
    const make = (name: string, x: number) => {
      const holder = newEntity(name, {}, { position: [x, 32, 0], rotation: [0, 0, 0] });
      const lid = brush('Lid', [x - 16, 64, -16], [x + 16, 72, 16]);
      lid.parent = holder.id;
      lid.components.script = structuredClone(lidScript) as never;
      const knob = brush('Knob', [x - 4, 72, -4], [x + 4, 80, 4]);
      knob.parent = holder.id;
      return { holder, lid, knob };
    };
    const a = make('Crate', 0);
    const b = make('Crate_2', 300);
    // The copy's blocks name the first crate's lid and knob.
    b.holder.components.script = {
      version: 1,
      variables: [],
      workInternal: true,
      handlers: [
        {
          id: 'h',
          event: { id: 'e', kind: 'start' },
          body: [
            { id: 's', kind: 'send', message: 'open', to: { entity: a.lid.id } },
            { id: 'm', kind: 'move', target: { entity: a.knob.id }, direction: 'up', distance: n(100), seconds: n(0) },
          ],
        },
      ],
    } satisfies Script as never;
    s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }), a.holder, a.lid, a.knob, b.holder, b.lid, b.knob];
    const w = GameWorld.create(s);
    const lidA = w.positionOf(a.lid.id)!;
    const lidB = w.positionOf(b.lid.id)!;
    const knobB = w.positionOf(b.knob.id)!;
    run(w, 0.3);
    expect(w.scriptProblems).toEqual([]);
    expect(w.positionOf(a.lid.id)![1]).toBeCloseTo(lidA[1]);
    expect(w.positionOf(b.lid.id)![1]).toBeCloseTo(lidB[1] + 40);
    expect(w.positionOf(b.knob.id)![1]).toBeCloseTo(knobB[1] + 100);
    // (The first crate's knob isn't named by any script after the rewrite: it stays part of the still level.)
    expect(w.bodyOf(a.knob.id)).toBeFalsy();
  });
});
