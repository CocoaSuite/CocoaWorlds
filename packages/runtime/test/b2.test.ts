// Benchmark step B2: copies while playing, object actions, conveyors and breakable objects, through the
// mechanics of the target games (a tycoon dropper line, a following pet, a disaster, planting, coins).
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { blockId, newEvent, newExpr, newStatement, num, text, type EventBlock, type Expr, type Handler, type Ref, type Script, type Statement } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}, visible = true): EntityData => {
  const e = newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
  e.visible = visible;
  return e;
};
const floor = () => brush('floor', [-2048, -16, -2048], [2048, 0, 2048]);
const spawnAt = (at: Vec3 = [0, 0, 0]) => newEntity('start', { playerSpawn: {} }, { position: at });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('b2');
  s.entities = entities;
  return s;
}
const h = (event: EventBlock, ...body: Statement[]): Handler => ({ id: blockId(), event, body });
const ev = (kind: EventBlock['kind'], patch: Record<string, unknown> = {}) => ({ ...newEvent(kind), ...patch }) as EventBlock;
const st = (kind: Statement['kind'], patch: Record<string, unknown> = {}) => ({ ...newStatement(kind), ...patch }) as Statement;
const ent = (id: string): Ref => ({ entity: id });
const script = (handlers: Handler[], variables: Script['variables'] = []) => ({ version: 1, variables, handlers }) as never;
const values = [{ name: 'Cash', type: 'number' as const, initial: 0, show: true }];

describe('B2: copies, actions, conveyors, breakables', () => {
  it('tycoon line: a dropper makes parts, a conveyor carries them, the collector pays their value and removes them', () => {
    // The part: a hidden template with Physics and its own value.
    const part = brush('part', [-8, 0, -8], [8, 16, 8], { rigidBody: { motion: 'dynamic', mass: 1 }, script: script([], [{ name: 'value', type: 'number', initial: 5 }]) }, false);
    const dropper = newEntity('dropper', {}, { position: [0, 48, 0] });
    const belt = brush('belt', [-32, 0, -32], [32, 8, 480], { conveyor: { speed: 160, direction: 'south' } });
    const collector = brush('collector', [-48, 8, 400], [48, 64, 520], { trigger: { detects: 'physics', once: false } });
    dropper.components.script = script([h(ev('every', { seconds: num(1) }), st('spawn', { template: ent(part.id), at: ent(dropper.id) }))]);
    collector.components.script = script([
      h(
        ev('enter', { zone: { self: true } }),
        st('change', { variable: 'Cash', by: { ...newExpr('varOf'), variable: 'value', of: { other: true } } as Expr }),
        st('remove', { target: { other: true } }),
      ),
    ]);
    const w = GameWorld.create(scene(floor(), part, dropper, belt, collector), { values });
    expect(w.scriptProblems).toEqual([]);
    run(w, 1.1);
    const first = w.drainChanges().spawned;
    expect(first).toHaveLength(1);
    expect(first[0]!.copy).toBe(true);
    const id = first[0]!.id;
    // It lands on the belt and is carried south (+Z).
    run(w, 1);
    expect(w.positionOf(id)![2]).toBeGreaterThan(60);
    run(w, 4);
    const { removed } = w.drainChanges();
    expect(removed).toContain(id);
    expect(w.positionOf(id)).toBeNull();
    expect(w.gameValues()[0]!.value).toBeGreaterThanOrEqual(10);
    expect(w.drainScriptErrors()).toEqual([]);
    w.dispose();
  });

  it('pet: a copy of the pet follows the player, keeping its distance', () => {
    const pet = brush('pet', [-8, 0, -8], [8, 16, 8], {}, false);
    pet.components.script = script([h(ev('start'), st('forever', { body: [st('moveTo', { target: { self: true }, to: { player: true }, seconds: num(0.25), gap: num(48) })] }))]);
    const egg = newEntity('egg', {}, { position: [0, 8, 96] });
    egg.components.script = script([h(ev('start'), st('spawn', { template: ent(pet.id), at: ent(egg.id) }))]);
    const w = GameWorld.create(scene(floor(), spawnAt(), pet, egg));
    run(w, 0.2);
    const petCopy = w.drainChanges().spawned[0]!.id;
    w.setPlayerInput({ forward: 1 });
    run(w, 2);
    w.setPlayerInput({ forward: 0 });
    run(w, 1);
    const f = w.player!.feetPosition, p = w.positionOf(petCopy)!;
    expect(f.z).toBeLessThan(-300);
    const d = Math.hypot(p[0] - f.x, p[2] - f.z);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(70);
    w.dispose();
  });

  it('disaster: a building collapses (falls with physics), wind pushes the player, the survivors are put back in the lobby', () => {
    const tower = brush('tower', [200, 64, -32], [264, 128, 32]);
    const lobby = newEntity('lobby', {}, { position: [-500, 0, 0], rotation: [0, 90, 0] });
    const quake = newEntity('quake', {
      script: script([
        h(
          ev('start'),
          st('wait', { seconds: num(0.5) }),
          st('physical', { target: ent(tower.id) }),
          st('push', { target: { player: true }, direction: 'up', strength: num(400) }),
          st('wait', { seconds: num(2) }),
          st('teleport', { to: ent(lobby.id) }),
        ),
      ]),
    });
    const w = GameWorld.create(scene(floor(), spawnAt(), tower, lobby, quake));
    expect(w.scriptProblems).toEqual([]);
    run(w, 0.4);
    expect(w.positionOf(tower.id)![1]).toBeCloseTo(96, 0);
    run(w, 0.4);
    expect(w.player!.feetPosition.y).toBeGreaterThan(20);
    run(w, 1.5);
    // It fell to the floor.
    expect(w.positionOf(tower.id)![1]).toBeLessThan(40);
    run(w, 0.5);
    const f = w.player!.feetPosition;
    expect(f.x).toBeCloseTo(-500, 0);
    expect(w.player!.input.yaw).toBeCloseTo(Math.PI / 2, 1);
    w.dispose();
  });

  it('planting: a seed copy appears where the player looks, then grows', () => {
    const seed = brush('seed', [-8, 0, -8], [8, 16, 8], {}, false);
    seed.components.script = script([h(ev('start'), st('scale', { target: { self: true }, factor: num(3), seconds: num(1) }))]);
    const ground = brush('plot', [-64, 0, -200], [64, 4, -100]);
    const planter = newEntity('planter', { script: script([h(ev('start'), st('wait', { seconds: num(0.1) }), st('spawn', { template: ent(seed.id), at: { aim: true } }))]) });
    const w2 = GameWorld.create(scene(floor(), spawnAt(), seed, planter, ground));
    w2.setPlayerInput({ pitch: -0.5 });
    run(w2, 0.3);
    const copy = w2.drainChanges().spawned[0]!.id;
    const p = w2.positionOf(copy)!;
    // About 115 u ahead (eye height 64, looking 0.5 rad down), on the plot surface.
    expect(p[2]).toBeLessThan(-100);
    expect(p[2]).toBeGreaterThan(-140);
    run(w2, 1.2);
    expect(w2.motionOf(copy)![0]).toBeCloseTo(3, 1);
    w2.dispose();
  });

  it('breakable coin: damage takes its health; at 0 it disappears and “When this breaks” pays out', () => {
    const coin = brush('coin', [-16, 0, -96], [16, 96, -64], { breakable: { health: 30 } });
    coin.components.script = script([
      h(ev('use'), st('damage', { target: { self: true }, amount: num(10) })),
      h(ev('breaks'), st('change', { variable: 'Cash', by: num(25) }), st('say', { text: text('Coin broken!'), seconds: num(1) })),
    ]);
    const w = GameWorld.create(scene(floor(), spawnAt(), coin), { values });
    expect(w.scriptProblems).toEqual([]);
    run(w, 0.1);
    for (let i = 0; i < 2; i++) {
      w.use();
      run(w, 0.1);
    }
    expect(w.healthOf(coin.id)).toBe(10);
    expect(w.isVisible(coin.id)).toBe(true);
    w.use();
    run(w, 0.1);
    expect(w.healthOf(coin.id)).toBe(0);
    expect(w.isVisible(coin.id)).toBe(false);
    expect(w.gameValues()[0]!.value).toBe(25);
    expect(w.screenMessages()).toEqual(['Coin broken!']);
    // Gone for the player too: Use now reaches nothing.
    w.use();
    run(w, 0.1);
    expect(w.gameValues()[0]!.value).toBe(25);
    w.dispose();
  });

  it('the player rides a conveyor', () => {
    const belt = brush('belt', [-64, 0, -512], [64, 4, 64], { conveyor: { speed: 100, direction: 'north' } });
    const w = GameWorld.create(scene(floor(), spawnAt(), belt));
    run(w, 0.3);
    const z0 = w.player!.feetPosition.z;
    run(w, 1);
    expect(z0 - w.player!.feetPosition.z).toBeGreaterThan(80);
    w.dispose();
  });

  it('blocks that need the right kind of target say so', () => {
    const wall = brush('wall', [0, 0, 0], [16, 16, 16]);
    const s = script([h(ev('start'), st('remove', { target: { player: true } }), st('spawn', { template: { player: true }, at: { self: true } }))]);
    const w = GameWorld.create(scene(floor(), newEntity('x', { script: s }), wall));
    expect(w.scriptProblems.map((p) => p.message)).toEqual(['This block works on objects, not on the player.', 'Pick an object to copy.']);
    const s2 = script([h(ev('start'), st('damage', { target: ent(wall.id), amount: num(5) }))]);
    const w2 = GameWorld.create(scene(floor(), newEntity('y', { script: s2 }), wall));
    run(w2, 0.1);
    expect(w2.drainScriptErrors().map((e) => e.message)).toEqual(['wall isn’t breakable. Add the Breakable component to it.'.replace('’', "'")]);
    w.dispose();
    w2.dispose();
  });
});

describe('third-person camera', () => {
  it('sits behind the player, and comes closer when a wall is in the way', () => {
    const run2 = (w: GameWorld) => {
      for (let i = 0; i < 10; i++) w.step(1 / 60);
    };
    const open = GameWorld.create(scene(floor(), spawnAt()), { rules: { thirdPerson: true } });
    run2(open);
    const v = open.playerView()!;
    expect(v.thirdPerson).toBe(true);
    // Looking north (−Z): the camera is south of the player.
    expect(v.eye[2]).toBeGreaterThan(130);
    open.dispose();
    const walled = GameWorld.create(scene(floor(), spawnAt(), brush('wall', [-128, 0, 48], [128, 200, 64])), { rules: { thirdPerson: true } });
    run2(walled);
    const vw = walled.playerView()!;
    expect(vw.eye[2]).toBeLessThan(48);
    walled.dispose();
    const first = GameWorld.create(scene(floor(), spawnAt()));
    run2(first);
    expect(first.playerView()!.eye[2]).toBeCloseTo(0, 0);
    first.dispose();
  });
});
