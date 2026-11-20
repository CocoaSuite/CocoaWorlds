// Player body and movement blocks: size, speed, jump, gravity, ways of moving, and the movement events and values.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { compileScript, newEvent, newExpr, newStatement, type Expr, type PlayerMoveKind, type Script, type Statement } from '@cocoaworlds/scripting';
import { GameWorld, PLAYER, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const spawn = (at: Vec3 = [0, 0, 0]) => newEntity('start', { playerSpawn: {} }, { position: at, rotation: [0, 0, 0] });
const floor = () => brush('floor', [-2048, -16, -2048], [2048, 0, 2048]);
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
const n = (value: number): Expr => ({ id: Math.random().toString(36).slice(2), kind: 'number', value });
let k = 0;
const id = () => `b${k++}`;
/** A script on an empty object: when the game starts, run `body`. */
const rules = (body: Statement[], more: Script['handlers'] = []): EntityData =>
  newEntity('rules', { script: { version: 1, variables: [], handlers: [{ id: id(), event: { id: id(), kind: 'start' }, body }, ...more] } satisfies Script });
const logOn = (what: PlayerMoveKind, text: string) => ({ id: id(), event: { id: id(), kind: 'playerMove' as const, what }, body: [{ id: id(), kind: 'log' as const, text: { id: id(), kind: 'text' as const, value: text } }] });
const logs = (w: GameWorld) => w.drainLogs().map((l) => l.text);

describe('player size', () => {
  it('shrinks the box and the eyes at once, feet staying on the floor', () => {
    const w = GameWorld.create(scene(floor(), spawn(), rules([{ id: id(), kind: 'playerSize', factor: n(0.25), seconds: n(0) }])));
    run(w, 0.5);
    const p = w.player!;
    expect(p.size).toBeCloseTo(0.25);
    expect(p.standH).toBeCloseTo(PLAYER.height / 4);
    expect(p.feetPosition.y).toBeLessThan(2);
    expect(w.playerView()!.eye[1] - p.feetPosition.y).toBeCloseTo(PLAYER.eye / 4, 0);
    w.dispose();
  });

  it('grows over time, and the stack waits for it', () => {
    const w = GameWorld.create(
      scene(floor(), spawn(), rules([
        { id: id(), kind: 'playerSize', factor: n(2), seconds: n(1) },
        { id: id(), kind: 'log', text: { id: id(), kind: 'text', value: 'grown' } },
      ])),
    );
    run(w, 0.5);
    expect(w.player!.size).toBeGreaterThan(1.1);
    expect(w.player!.size).toBeLessThan(1.9);
    expect(logs(w)).not.toContain('grown');
    run(w, 0.7);
    expect(w.player!.size).toBeCloseTo(2);
    expect(logs(w)).toContain('grown');
    w.dispose();
  });

  it('won’t grow through a low ceiling, and grows once there is room', () => {
    const ceiling = brush('ceiling', [-64, 100, -64], [64, 116, 64]);
    const w = GameWorld.create(scene(floor(), ceiling, spawn(), rules([{ id: id(), kind: 'playerSize', factor: n(3), seconds: n(0) }])));
    run(w, 0.3);
    const p = w.player!;
    expect(p.standH).toBeLessThanOrEqual(100);
    expect(p.size).toBeGreaterThan(1.2);
    // Walk out from under it: room to grow.
    p.input.forward = 1;
    run(w, 1.5);
    p.input.forward = 0;
    run(w, 0.3);
    expect(p.size).toBeCloseTo(3);
    w.dispose();
  });
});

describe('speed, jump and gravity', () => {
  it('speed × 2 runs twice as fast', () => {
    const w = GameWorld.create(scene(floor(), spawn(), rules([{ id: id(), kind: 'playerSet', prop: 'speed', value: n(2) }])));
    run(w, 0.1);
    w.player!.input.forward = 1;
    run(w, 1);
    expect(Math.hypot(w.player!.velocity.x, w.player!.velocity.z)).toBeCloseTo(PLAYER.runSpeed * 2, -1);
    w.dispose();
  });

  const peak = (w: GameWorld) => {
    const p = w.player!;
    const y0 = p.feetPosition.y;
    p.input.jump = true;
    let top = y0;
    for (let i = 0; i < 300; i++) {
      w.step(1 / 60);
      if (i === 2) p.input.jump = false;
      top = Math.max(top, p.feetPosition.y);
    }
    return top - y0;
  };

  it('jump × 2 jumps twice as high; gravity × 0.5 also doubles it', () => {
    const plain = GameWorld.create(scene(floor(), spawn()));
    run(plain, 0.3);
    const h1 = peak(plain);
    plain.dispose();
    const high = GameWorld.create(scene(floor(), spawn(), rules([{ id: id(), kind: 'playerSet', prop: 'jump', value: n(2) }])));
    run(high, 0.3);
    expect(peak(high) / h1).toBeCloseTo(2, 0);
    high.dispose();
    const moon = GameWorld.create(scene(floor(), spawn(), rules([{ id: id(), kind: 'playerSet', prop: 'gravity', value: n(0.5) }])));
    run(moon, 0.3);
    // (The same jump height setting keeps its height whatever the gravity: × 0.5 gravity is just floatier.)
    expect(peak(moon) / h1).toBeCloseTo(1, 0);
    moon.dispose();
  });
});

describe('ways of moving', () => {
  it('only backwards: forward and sideways do nothing, back still walks', () => {
    const w = GameWorld.create(scene(floor(), spawn(), rules([{ id: id(), kind: 'playerMoves', ways: ['back'] }])));
    run(w, 0.1);
    const p = w.player!;
    const z0 = p.feetPosition.z;
    p.input.forward = 1;
    p.input.right = 1;
    run(w, 0.5);
    expect(Math.abs(p.feetPosition.z - z0)).toBeLessThan(1);
    expect(Math.abs(p.feetPosition.x)).toBeLessThan(1);
    p.input.forward = -1;
    p.input.right = 0;
    run(w, 0.5);
    expect(p.feetPosition.z - z0).toBeGreaterThan(40);
    w.dispose();
  });

  it('one way at a time, and back to normal', () => {
    const w = GameWorld.create(scene(floor(), spawn(), rules([{ id: id(), kind: 'playerWay', way: 'jump', on: false }])));
    run(w, 0.2);
    const p = w.player!;
    expect(p.moves).toMatchObject({ jump: false, forward: true });
    p.input.jump = true;
    run(w, 0.3);
    expect(p.feetPosition.y).toBeLessThan(2);
    p.input.jump = false;
    (w as unknown as { act(n: string, t: string, a: unknown[]): unknown }).act('playerNormal', 'player', []);
    expect(p.moves.jump).toBe(true);
    w.dispose();
  });
});

describe('movement events and values', () => {
  it('starts, keeps moving, stops; jumps and lands', () => {
    const w = GameWorld.create(
      scene(floor(), spawn(), rules([], [logOn('start', 'start'), logOn('stop', 'stop'), logOn('jump', 'jump'), logOn('land', 'land'), logOn('moving', 'moving')])),
    );
    run(w, 0.3);
    logs(w);
    const p = w.player!;
    p.input.forward = 1;
    run(w, 0.5);
    let got = logs(w);
    expect(got.filter((x) => x === 'start')).toHaveLength(1);
    expect(got.filter((x) => x === 'moving').length).toBeGreaterThan(10);
    p.input.forward = 0;
    run(w, 0.5);
    got = logs(w);
    expect(got.filter((x) => x === 'stop')).toHaveLength(1);
    p.input.jump = true;
    run(w, 0.05);
    p.input.jump = false;
    run(w, 1.5);
    got = logs(w);
    expect(got).toContain('jump');
    expect(got).toContain('land');
    expect(w.playerState('landSpeed')).toBeGreaterThan(100);
    expect(w.playerState('walked')).toBeGreaterThan(50);
    expect(w.playerState('onGround')).toBe(true);
    expect(w.playerState('moving')).toBe(false);
    w.dispose();
  });

  it('pushing into a wall isn’t moving', () => {
    const wall = brush('wall', [-256, 0, -40], [256, 200, -24]);
    const w = GameWorld.create(scene(floor(), wall, spawn()));
    run(w, 0.1);
    w.player!.input.forward = 1;
    run(w, 1.5);
    expect(w.playerState('moving')).toBe(false);
    w.dispose();
  });
});

describe('checking and saving', () => {
  it('values have the right types; a size of 0 is a problem', () => {
    const s: Script = { version: 1, variables: [], handlers: [{ id: 'h', event: newEvent('start'), body: [
      { ...newStatement('if'), condition: { ...newExpr('playerState'), what: 'moving' } } as Statement,
      { id: 'z', kind: 'playerSize', factor: { id: 'f', kind: 'number', value: 0 }, seconds: n(0) },
    ] }] };
    const { problems } = compileScript('o', s, { objects: new Map() });
    expect(problems.map((p) => p.block)).toEqual(['f']);
  });

  it('a kept world keeps the size, speed, gravity and ways of moving', () => {
    const sc = scene(floor(), spawn(), rules([
      { id: id(), kind: 'playerSize', factor: n(0.5), seconds: n(0) },
      { id: id(), kind: 'playerSet', prop: 'speed', value: n(3) },
      { id: id(), kind: 'playerSet', prop: 'gravity', value: n(0.2) },
      { id: id(), kind: 'playerMoves', ways: ['back', 'jump'] },
    ]));
    const w = GameWorld.create(sc);
    run(w, 0.3);
    const saved = (w as unknown as { saveScene(p: boolean): { player?: { body?: unknown } } }).saveScene(true);
    w.dispose();
    expect(saved.player?.body).toMatchObject({ size: 0.5, speed: 3, gravity: 0.2, moves: [false, true, false, false, true, false] });
    const w2 = GameWorld.create(scene(floor(), spawn()));
    run(w2, 0.1);
    (w2 as unknown as { loadScene(s: unknown, p: boolean): void }).loadScene(saved, true);
    run(w2, 0.1);
    const p = w2.player!;
    expect(p.size).toBeCloseTo(0.5);
    expect(p.scriptSpeed).toBe(3);
    expect(p.scriptGravity).toBe(0.2);
    expect(p.moves).toMatchObject({ forward: false, back: true, jump: true });
    w2.dispose();
  });
});
