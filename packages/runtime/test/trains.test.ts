// A1: paths and trains.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const floor = () => brush('floor', [-2048, -16, -2048], [2048, 0, 2048]);
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

/** Path points a → b → c (→ a when `loop`), 400 apart along −Z, 100 up. */
function path(loop: boolean, extra: Partial<Record<'a' | 'b' | 'c', Record<string, unknown>>> = {}) {
  const a = newEntity('a', {}, { position: [0, 100, 0] });
  const b = newEntity('b', {}, { position: [0, 100, -400] });
  const c = newEntity('c', {}, { position: [400, 100, -400] });
  a.components.pathPoint = { next: b.id, ...extra.a };
  b.components.pathPoint = { next: c.id, ...extra.b };
  c.components.pathPoint = { next: loop ? a.id : '', ...extra.c };
  return [a, b, c];
}
/** A 128-wide platform somewhere else; the train puts it at its first point. */
const platform = (start: string, data: Record<string, unknown> = {}) => brush('platform', [500, 0, 500], [628, 16, 628], { train: { start, speed: 200, ...data } });

describe('trains', () => {
  it('start at the first point, go point to point at their speed, and stop at the end', () => {
    const [a, b, c] = path(false);
    const p = platform(a!.id);
    const w = GameWorld.create(scene(floor(), a!, b!, c!, p));
    expect(w.positionOf(p.id)![2]).toBeCloseTo(0, 0);
    run(w, 1);
    // 200 u/s along −Z.
    expect(w.positionOf(p.id)![2]).toBeCloseTo(-200, -1);
    run(w, 4);
    const end = w.positionOf(p.id)!;
    expect(end[0]).toBeCloseTo(400, 0);
    expect(end[2]).toBeCloseTo(-400, 0);
    expect(w.trainState(p.id)).toEqual({ at: c!.id, to: null, moving: false });
    w.dispose();
  });

  it('wait at points, change speed, send messages, and loop', () => {
    const [a, b, c] = path(true, { b: { wait: 1, message: 'at b' }, c: { speed: 400 } });
    const p = platform(a!.id);
    let heard = 0;
    const listener = newEntity('listener', {
      script: {
        version: 1,
        variables: [],
        handlers: [{ id: 'h', event: { id: 'e', kind: 'message', message: 'at b' }, body: [{ id: 's', kind: 'addScore', amount: { id: 'n', kind: 'number', value: 1 } }] }],
      } satisfies Script as never,
    });
    const w = GameWorld.create(scene(floor(), a!, b!, c!, p, listener));
    run(w, 2.1);
    // At b and waiting.
    expect(w.trainState(p.id)!.at).toBe(b!.id);
    expect(w.positionOf(p.id)![2]).toBeCloseTo(-400, 0);
    expect(w.playerStatus()?.score ?? (w as unknown as { score: number }).score).toBe(1);
    void heard;
    run(w, 1);
    // Off again after the wait: 2 s to c, then 400 u/s back to a (566 u).
    run(w, 2 + 1.5);
    expect(w.trainState(p.id)!.at).toBe(a!.id);
    expect(w.trainState(p.id)!.moving).toBe(true);
    w.dispose();
  });

  it('carry the player, and scripts stop and start them', () => {
    const [a, b, c] = path(false);
    a!.transform.position = [0, 0, 0];
    b!.transform.position = [0, 0, -400];
    const p = platform(a!.id, { moving: false });
    const start = newEntity('start', { playerSpawn: {} }, { position: [0, 40, 0] });
    const ctrl = newEntity('control', {
      script: {
        version: 1,
        variables: [],
        handlers: [
          { id: 'h1', event: { id: 'e1', kind: 'message', message: 'go' }, body: [{ id: 's1', kind: 'startTrain', target: { entity: p.id } }] },
          { id: 'h2', event: { id: 'e2', kind: 'message', message: 'halt' }, body: [{ id: 's2', kind: 'stopTrain', target: { entity: p.id } }] },
        ],
      } satisfies Script as never,
    });
    const w = GameWorld.create(scene(floor(), a!, b!, c!, p, start, ctrl));
    expect(w.scriptProblems.map((x) => x.message)).toEqual([]);
    run(w, 1);
    expect(w.trainState(p.id)!.moving).toBe(false);
    const send = (m: string) => (w as unknown as { runner: { dispatch(e: unknown): void } }).runner.dispatch({ type: 'message', message: m, to: null, from: null });
    send('go');
    run(w, 1);
    expect(w.positionOf(p.id)![2]).toBeLessThan(-150);
    // The player rode along.
    expect(w.player!.feetPosition.z).toBeLessThan(-150);
    send('halt');
    // (The block runs on the next step.)
    run(w, 2 / 60);
    const z = w.positionOf(p.id)![2];
    run(w, 0.5);
    expect(w.positionOf(p.id)![2]).toBeCloseTo(z, 0);
    w.dispose();
  });

  it('turn to face their way when asked', () => {
    const [a, b, c] = path(false);
    const p = platform(a!.id, { turns: true });
    const w = GameWorld.create(scene(floor(), a!, b!, c!, p));
    run(w, 2.5);
    // Heading +X now: a quarter turn from facing −Z.
    const m = w.motionOf(p.id)!;
    expect(Math.abs(m[0]!)).toBeLessThan(0.05);
    w.dispose();
  });
});
