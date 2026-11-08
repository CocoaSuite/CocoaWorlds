import { beforeAll, describe, expect, it } from 'vitest';
import { applyMat4, newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { COLLIDER_MATERIAL, box, defaultSurface, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}, role = 'solid'): EntityData =>
  newEntity(name, { brush: { role, faces: toData(box(min, max)).faces } as never, ...extra });

function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}

const colBrush = (name: string, min: Vec3, max: Vec3): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max, { ...defaultSurface(), material: COLLIDER_MATERIAL })).faces } as never });

const floor = () => brush('floor', [-512, -16, -512], [512, 0, 512]);
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

describe('GameWorld', () => {
  it('a brush wholly inside a COL brush has no collider of its own (the COL does it)', () => {
    const detail = brush('detail', [0, 0, 0], [32, 32, 32]);
    const outside = brush('outside', [200, 0, 0], [232, 32, 32]);
    const col = colBrush('col', [-8, -8, -8], [40, 40, 40]);
    const w = GameWorld.create(scene(detail, outside, col));
    // The COL and the brush outside it; not the one inside.
    expect(w.stats.staticPieces).toBe(2);
    w.dispose();
  });


  it('a crate brush falls and comes to rest on the floor', () => {
    const crate = brush('crate', [-16, 200, -16], [16, 232, 16], { rigidBody: { motion: 'dynamic' } });
    const w = GameWorld.create(scene(floor(), crate));
    expect(w.stats).toMatchObject({ staticPieces: 1, bodies: 1 });
    run(w, 3);
    // Centre ends half its height above the floor.
    expect(w.positionOf(crate.id)![1]).toBeCloseTo(16, 0);
    // Motion maps the crate's starting centre to where it is now.
    const now = applyMat4(w.motionOf(crate.id)!, [0, 216, 0]);
    expect(now[1]).toBeCloseTo(16, 0);
    w.dispose();
  });

  it('fixed bodies stay; kinematic bodies move only when told', () => {
    const fixedOne = brush('pillar', [100, 100, 0], [132, 132, 32], { rigidBody: { motion: 'fixed' } });
    const lift = brush('lift', [200, 100, 0], [264, 116, 64], { rigidBody: { motion: 'kinematic' } });
    const w = GameWorld.create(scene(floor(), fixedOne, lift));
    run(w, 1);
    expect(w.positionOf(fixedOne.id)![1]).toBeCloseTo(116);
    expect(w.positionOf(lift.id)![1]).toBeCloseTo(108);
    w.moveKinematic(lift.id, [232, 300, 32]);
    run(w, 0.1);
    expect(w.positionOf(lift.id)![1]).toBeCloseTo(300);
    expect(w.movingBodies().map((b) => b.id)).toEqual([lift.id]);
    w.dispose();
  });

  it('a ball with a collision shape bounces', () => {
    const ball = newEntity('ball', { rigidBody: { motion: 'dynamic', bounciness: 0.9 }, collider: { shape: 'sphere', size: [32, 32, 32] } }, { position: [0, 300, 0] });
    const w = GameWorld.create(scene(floor(), ball));
    let lowest = Infinity, bouncedTo = 0, wentUp = false;
    let prev = 300;
    for (let i = 0; i < 180; i++) {
      w.step(1 / 60);
      const y = w.positionOf(ball.id)![1];
      lowest = Math.min(lowest, y);
      if (y > prev && lowest < 30) wentUp = true;
      if (wentUp) bouncedTo = Math.max(bouncedTo, y);
      prev = y;
    }
    expect(lowest).toBeGreaterThan(13); // never sinks into the floor (contact skin aside)
    expect(bouncedTo).toBeGreaterThan(150);
    w.dispose();
  });

  it('a trigger zone reports physics objects entering and leaving', () => {
    const crate = brush('crate', [-16, 400, -16], [16, 432, 16], { rigidBody: { motion: 'dynamic' } });
    const zone = brush('zone', [-64, 100, -64], [64, 200, 64], { trigger: { detects: 'physics' } });
    const w = GameWorld.create(scene(floor(), crate, zone));
    expect(w.stats.triggers).toBe(1);
    run(w, 3);
    const ev = w.drainEvents();
    expect(ev.map((e) => e.kind)).toEqual(['enter', 'exit']);
    expect(ev.every((e) => e.trigger === zone.id && e.other === crate.id)).toBe(true);
    expect(ev[1]!.time).toBeGreaterThan(ev[0]!.time);
    expect(w.drainEvents()).toEqual([]);
    w.dispose();
  });

  it('trigger filters: a player-only zone ignores crates', () => {
    const crate = brush('crate', [-16, 400, -16], [16, 432, 16], { rigidBody: { motion: 'dynamic' } });
    const zone = brush('zone', [-64, 100, -64], [64, 200, 64], { trigger: { detects: 'player' } });
    const w = GameWorld.create(scene(floor(), crate, zone));
    run(w, 3);
    expect(w.drainEvents()).toEqual([]);
    w.dispose();
  });

  it('a live subtract brush makes a hole that things fall through', () => {
    const crate = brush('crate', [-16, 100, -16], [16, 132, 16], { rigidBody: { motion: 'dynamic' } });
    const hole = brush('cut', [-48, -32, -48], [48, 16, 48], {}, 'subtract');
    const w = GameWorld.create(scene(floor(), crate, hole));
    expect(w.stats.staticPieces).toBeGreaterThan(1);
    run(w, 2);
    expect(w.positionOf(crate.id)![1]).toBeLessThan(-100);
    w.dispose();
  });

  it('hidden objects are left out, and groups place their contents', () => {
    const g = newEntity('room', { group: {} }, { position: [1000, 0, 0] });
    const f = floor();
    f.parent = g.id;
    const crate = brush('crate', [-16, 100, -16], [16, 132, 16], { rigidBody: { motion: 'dynamic' } });
    crate.parent = g.id;
    const ghost = brush('ghost', [-512, 50, -512], [512, 60, 512]);
    ghost.visible = false;
    const w = GameWorld.create(scene(g, f, crate, ghost));
    run(w, 2);
    const p = w.positionOf(crate.id)!;
    expect(Math.abs(p[0] - 1000)).toBeLessThan(2);
    expect(p[1]).toBeCloseTo(16, 0);
    w.dispose();
  });
});

describe('event bus', () => {
  it('trigger events reach listeners; a failing listener is reported and the rest still run', () => {
    const crate = brush('crate', [-16, 400, -16], [16, 432, 16], { rigidBody: { motion: 'dynamic' } });
    const zone = brush('zone', [-64, 100, -64], [64, 200, 64], { trigger: { detects: 'physics' } });
    const w = GameWorld.create(scene(floor(), crate, zone));
    const seen: string[] = [];
    w.bus.on('trigger.enter', () => {
      throw new Error('boom');
    });
    w.bus.on('trigger.enter', (e) => seen.push(`enter ${e.other === crate.id}`));
    // (Footsteps and hits aren't what this is about.)
    const stop = w.bus.on('*', (e) => void (e.type !== 'hit' && e.type !== 'step' && seen.push(`any ${e.type}`)));
    run(w, 3);
    expect(seen).toEqual(['enter true', 'any trigger.enter', 'any trigger.exit']);
    expect(w.bus.errors).toEqual([{ event: 'trigger.enter', message: 'boom' }]);
    stop();
    w.bus.emit({ type: 'message', name: 'open', from: null, time: 0 });
    expect(seen).toHaveLength(3);
    w.dispose();
  });
});

describe('scripts in the game world', () => {
  // Minimal block builders (the editor makes these through the palette).
  let n = 0;
  const id = () => `b${++n}`;
  const num = (value: number) => ({ id: id(), kind: 'number', value });
  const script = (...handlers: unknown[]) => ({ script: { version: 1, variables: [], handlers } });

  it('a door group opens when a crate drops into the zone, then the crate rests on the floor', () => {
    const door = newEntity('door', { group: {} });
    const left = brush('left', [100, 0, 0], [116, 128, 64]);
    const right = brush('right', [116, 0, 0], [132, 128, 64]);
    left.parent = right.parent = door.id;
    const crate = brush('crate', [-16, 300, -16], [16, 332, 16], { rigidBody: { motion: 'dynamic' } });
    const zone = brush('zone', [-64, 50, -64], [64, 150, 64], {
      trigger: { detects: 'physics' },
      ...script({
        id: id(),
        event: { id: id(), kind: 'enter', zone: { self: true } },
        body: [
          { id: id(), kind: 'move', target: { entity: door.id }, direction: 'up', distance: num(128), seconds: num(0.5) },
          { id: id(), kind: 'log', text: { id: id(), kind: 'text', value: 'opened' } },
        ],
      }),
    });
    const w = GameWorld.create(scene(floor(), door, left, right, crate, zone));
    expect(w.scriptProblems).toEqual([]);
    expect(w.movingBodies().map((b) => `${b.kind}`).sort()).toEqual(['brush', 'unit']);
    expect(w.bodyBrushes(door.id)).toHaveLength(2);
    run(w, 3);
    // The group's pivot is the middle of its brushes (y = 64), moved up 128.
    expect(w.positionOf(door.id)![1]).toBeCloseTo(192, 3);
    expect(w.drainLogs().map((l) => l.text)).toEqual(['opened']);
    expect(w.positionOf(crate.id)![1]).toBeCloseTo(16, 0);
    w.dispose();
  });

  it('hide turns collisions off: a hidden crate falls through the floor', () => {
    const crate = brush('crate', [-16, 100, -16], [16, 132, 16], {
      rigidBody: { motion: 'dynamic' },
      ...script({ id: id(), event: { id: id(), kind: 'start' }, body: [{ id: id(), kind: 'hide', target: { self: true } }] }),
    });
    const w = GameWorld.create(scene(floor(), crate));
    run(w, 2);
    expect(w.isVisible(crate.id)).toBe(false);
    expect(w.positionOf(crate.id)![1]).toBeLessThan(-100);
    w.dispose();
  });

  it('turning a door 90° around a hinge pivot, and returning it to the start', () => {
    const door = brush('door', [0, 0, 0], [64, 128, 8], {
      // Hinge at the door's near edge: x = 0, z = 0 (an offset from the brush's centre).
      pivot: { point: [-32, 0, -4] },
      ...script({
        id: id(),
        event: { id: id(), kind: 'start' },
        body: [
          { id: id(), kind: 'turn', target: { self: true }, axis: 'up', degrees: num(90), seconds: num(0.5) },
          { id: id(), kind: 'wait', seconds: num(1) },
          { id: id(), kind: 'return', target: { self: true }, seconds: num(0.5) },
        ],
      }),
    });
    const w = GameWorld.create(scene(door));
    run(w, 0.6);
    // Yaw 90°: a point 64 along +X from the pivot ends up along −Z.
    const m = w.motionOf(door.id)!;
    const p = applyMat4(m, [64, 0, 0]);
    expect(p[0]).toBeCloseTo(0, 1);
    expect(p[2]).toBeCloseTo(-64, 1);
    run(w, 1.5);
    const back = applyMat4(w.motionOf(door.id)!, [64, 0, 0]);
    expect(back[0]).toBeCloseTo(64, 1);
    w.dispose();
  });

  it('without a pivot set, an object turns around its own middle', () => {
    const door = brush('door', [0, 0, 0], [64, 128, 8], {
      ...script({ id: id(), event: { id: id(), kind: 'start' }, body: [{ id: id(), kind: 'turn', target: { self: true }, axis: 'up', degrees: num(90), seconds: num(0.5) }] }),
    });
    const w = GameWorld.create(scene(door));
    run(w, 0.6);
    expect(w.positionOf(door.id)).toEqual([32, 64, 4]);
    const p = applyMat4(w.motionOf(door.id)!, [64, 0, 4]);
    expect(p[0]).toBeCloseTo(32, 1);
    expect(p[2]).toBeCloseTo(4 - 32, 1);
    w.dispose();
  });

  it('broken stacks are reported and left out; a runaway loop is stopped while physics keeps going', () => {
    const crate = brush('crate', [-16, 200, -16], [16, 232, 16], { rigidBody: { motion: 'dynamic' } });
    const rules = newEntity('rules', {
      script: {
        version: 1,
        variables: [{ name: 'n', type: 'number', initial: 0 }],
        handlers: [
          { id: 'bad', event: { id: id(), kind: 'start' }, body: [{ id: 'gone', kind: 'hide', target: { entity: 'nothing' } }] },
          {
            id: 'loop',
            event: { id: id(), kind: 'start' },
            body: [{ id: 'forever', kind: 'forever', body: [{ id: id(), kind: 'change', variable: 'n', by: num(1) }] }],
          },
        ],
      } as never,
    });
    const w = GameWorld.create(scene(floor(), crate, rules));
    expect(w.scriptProblems.map((p) => [p.block, p.severity])).toEqual([
      ['gone', 'error'],
      ['forever', 'warning'],
    ]);
    run(w, 2);
    expect(w.drainScriptErrors().map((e) => e.block)).toEqual(['forever']);
    expect(w.positionOf(crate.id)![1]).toBeCloseTo(16, 0);
    w.dispose();
  });
});
