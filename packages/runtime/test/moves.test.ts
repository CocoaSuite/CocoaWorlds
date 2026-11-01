import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}) => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const n = (value: number) => ({ id: Math.random().toString(36), kind: 'number' as const, value });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

describe('moves cut short', () => {
  // A pressure plate written by hand: in → down 6 over 0.5 s; out → up 6 over 0.5 s.
  const plate: Script = {
    version: 1,
    variables: [],
    handlers: [
      { id: 'a', event: { id: 'e1', kind: 'message', message: 'in' }, body: [{ id: 'm1', kind: 'move', target: { self: true }, direction: 'down', distance: n(6), seconds: n(0.5) }] },
      { id: 'b', event: { id: 'e2', kind: 'message', message: 'out' }, body: [{ id: 'm2', kind: 'move', target: { self: true }, direction: 'up', distance: n(6), seconds: n(0.5) }] },
      { id: 'c', event: { id: 'e3', kind: 'message', message: 'spin' }, body: [{ id: 't1', kind: 'turn', target: { self: true }, axis: 'up', degrees: n(45), seconds: n(1) }] },
    ],
  };
  const send = (w: GameWorld, message: string) => (w as unknown as { runner: { dispatch(e: unknown): void } }).runner.dispatch({ type: 'message', message, to: null, from: null });

  it('stepping on and off quickly never leaves the plate higher (or lower) than it started', () => {
    const s = newScene('t');
    const p = brush('plate', [-32, 0, -32], [32, 8, 32], { script: plate });
    s.entities = [p];
    const w = GameWorld.create(s);
    run(w, 0.1);
    const y0 = w.positionOf(p.id)![1];
    for (let i = 0; i < 20; i++) {
      send(w, 'in');
      run(w, 0.1 + (i % 3) * 0.05);
      send(w, 'out');
      run(w, 0.05 + (i % 2) * 0.1);
    }
    run(w, 1);
    expect(w.positionOf(p.id)![1]).toBeCloseTo(y0, 3);
    // Pressed and held: exactly 6 down.
    send(w, 'in');
    run(w, 1);
    expect(w.positionOf(p.id)![1]).toBeCloseTo(y0 - 6, 3);
    w.dispose();
  });

  it('a turn cut short by another adds up to both', () => {
    const s = newScene('t');
    const p = brush('door', [-32, 0, -4], [32, 64, 4], { script: plate });
    s.entities = [p];
    const w = GameWorld.create(s);
    run(w, 0.1);
    send(w, 'spin');
    run(w, 0.3);
    // (The stack is still running, so a second message doesn't restart it; let it be replaced by the runtime.)
    (w as unknown as { act(n: string, t: string, a: unknown[]): unknown }).act('turn', p.id, ['up', 45, 1]);
    run(w, 1.5);
    expect(w.yawOf(p.id)!).toBeCloseTo(90, 1);
    w.dispose();
  });
});
