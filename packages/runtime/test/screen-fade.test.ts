// Screen fade blocks: to white or black (and every sound stops), then back in; the block waits for its fade.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Expr, Script, Statement } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
const spawn = () => newEntity('start', { playerSpawn: {} }, { position: [0, 0, 0], rotation: [0, 0, 0] });
const floor = () => brush('floor', [-2048, -16, -2048], [2048, 0, 2048]);
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
let k = 0;
const id = () => `s${k++}`;
const n = (value: number): Expr => ({ id: id(), kind: 'number', value });
const log = (t: string): Statement => ({ id: id(), kind: 'log', text: { id: id(), kind: 'text', value: t } });
const scripted = (e: EntityData, handlers: Script['handlers']): EntityData => ({ ...e, components: { ...e.components, script: { version: 1, variables: [], handlers } satisfies Script } });
const onStart = (body: Statement[]) => ({ id: id(), event: { id: id(), kind: 'start' as const }, body });

describe('screen fade blocks', () => {
  it('fades to black, waits, then fades back in', () => {
    const rules = scripted(newEntity('rules', {}), [
      onStart([{ id: id(), kind: 'screenBlack', seconds: n(1) }, log('black'), { id: id(), kind: 'screenBack', seconds: n(0.5) }, log('back')]),
    ]);
    const w = GameWorld.create(scene(floor(), spawn(), rules));
    run(w, 0.5);
    const mid = w.screenNow();
    expect(mid.color).toBe('black');
    expect(mid.out).toBe(true);
    expect(mid.alpha).toBeGreaterThan(0.3);
    expect(mid.alpha).toBeLessThan(0.7);
    expect(w.drainLogs().map((l) => l.text)).toEqual([]);
    run(w, 0.6);
    expect(w.drainLogs().map((l) => l.text)).toEqual(['black']);
    run(w, 0.6);
    expect(w.screenNow()).toMatchObject({ alpha: 0, out: false });
    expect(w.drainLogs().map((l) => l.text)).toEqual(['back']);
    w.dispose();
  });

  it('white at once; a covered screen is saved', () => {
    const rules = scripted(newEntity('rules', {}), [onStart([{ id: id(), kind: 'screenWhite', seconds: n(0) }])]);
    const w = GameWorld.create(scene(floor(), spawn(), rules));
    run(w, 0.1);
    expect(w.screenNow()).toEqual({ color: 'white', alpha: 1, out: true });
    expect((w as unknown as { saveScene(p: boolean): { screen?: string } }).saveScene(true).screen).toBe('white');
    w.dispose();
  });
});
