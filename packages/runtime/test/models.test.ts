import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import RAPIER from '@dimforge/rapier3d-compat';
import { GameWorld, initPhysics, type ModelMesh } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
const floor = () => brush('floor', [-1024, -16, -1024], [1024, 0, 1024]);
const spawn = () => newEntity('start', { playerSpawn: {} }, { position: [0, 0, 0] });
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

/** Boxes as triangles (in metres, like a file from Blender). */
function boxes(list: [Vec3, Vec3][]): ModelMesh {
  const pos: number[] = [], idx: number[] = [];
  for (const [a, b] of list) {
    const base = pos.length / 3;
    for (let i = 0; i < 8; i++) pos.push(i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]);
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    for (const [p, q, r, s] of quads) idx.push(base + p!, base + q!, base + r!, base + p!, base + r!, base + s!);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// An arch 3 m wide and 3 m tall, its opening 2 m wide and 2.5 m tall, standing 4 m ahead of the player.
const ARCH = boxes([
  [[-1.5, 0, -0.25], [-1, 3, 0.25]],
  [[1, 0, -0.25], [1.5, 3, 0.25]],
  [[-1.5, 2.5, -0.25], [1.5, 3, 0.25]],
]);
const arch = (collision: string, extra: Record<string, unknown> = {}) =>
  newEntity('arch', { model: { model: 'assets/models/arch.glb', units: 'metres', animation: '', castShadows: true, collision } as never, ...extra }, { position: [0, 0, -160] });

describe('models collide by their own shape', () => {
  const walk = (e: EntityData) => {
    const w = GameWorld.create(scene(floor(), e, spawn()), { models: new Map([['assets/models/arch.glb', ARCH]]) });
    run(w, 0.3);
    w.setPlayerInput({ forward: 1 });
    run(w, 2);
    const z = w.player!.feetPosition.z;
    w.dispose();
    return z;
  };

  it('none: walks straight through', () => {
    expect(walk(arch('none'))).toBeLessThan(-300);
  });

  it('box and hull: the opening is filled in, so the player stops in front of it', () => {
    for (const c of ['box', 'hull']) {
      const z = walk(arch(c));
      expect(z, c).toBeGreaterThan(-160 + 10 - 30);
      expect(z, c).toBeLessThan(-100);
    }
  });

  it('exact: walks through the opening', () => {
    expect(walk(arch('exact'))).toBeLessThan(-300);
  });

  it('a model with Physics falls and lands on the floor, using its hull', () => {
    const crate = newEntity('crate', { model: { model: 'assets/models/crate.glb', units: 'metres', animation: '', castShadows: true, collision: 'exact' } as never, rigidBody: { motion: 'dynamic' } as never }, { position: [200, 100, 0] });
    const w = GameWorld.create(scene(floor(), crate, spawn()), { models: new Map([['assets/models/crate.glb', boxes([[[-0.5, 0, -0.5], [0.5, 1, 0.5]]])]]) });
    run(w, 2);
    expect(w.positionOf(crate.id)![1]).toBeCloseTo(0, 0);
    w.dispose();
  });

  it('a model with Physics and its own collision says where it starts (so it is drawn)', () => {
    const ball = newEntity('ball', { model: { model: 'assets/models/crate.glb', units: 'metres', animation: '', castShadows: true, collision: 'hull' } as never, rigidBody: { motion: 'dynamic' } as never }, { position: [200, 100, 0] });
    const w = GameWorld.create(scene(floor(), ball, spawn()), { models: new Map([['assets/models/crate.glb', boxes([[[-0.5, 0, -0.5], [0.5, 1, 0.5]]])]]) });
    expect(w.movingBodies().some((b) => b.id === ball.id)).toBe(true);
    expect(w.pointShape(ball.id)).toBeNull();
    expect(w.pointMatrix(ball.id)!.slice(12, 15)).toEqual([200, 100, 0]);
    w.dispose();
  });

  it('a Collision shape without Physics stays put and blocks the player', () => {
    const post = newEntity('post', { collider: { shape: 'box', size: [64, 128, 64], offset: [0, 64, 0] } as never }, { position: [0, 0, -160] });
    const w = GameWorld.create(scene(floor(), post, spawn()));
    run(w, 0.3);
    w.setPlayerInput({ forward: 1 });
    run(w, 2);
    expect(w.player!.feetPosition.z).toBeGreaterThan(-140);
    w.dispose();
  });
});

describe('Auto: collision meshes from the file', () => {
  const part = (list: [Vec3, Vec3][], moves = false) => ({ ...boxes(list), exact: false, moves });
  const walk = (parts: ReturnType<typeof part>[], before?: (w: GameWorld, id: string) => void, mode = 'auto') => {
    const e = arch(mode);
    const w = GameWorld.create(scene(floor(), e, spawn()), { models: new Map([['assets/models/arch.glb', { ...ARCH, parts }]]) });
    before?.(w, e.id);
    run(w, 0.3);
    w.setPlayerInput({ forward: 1 });
    run(w, 2);
    const z = w.player!.feetPosition.z;
    w.dispose();
    return z;
  };
  const DOOR: [Vec3, Vec3] = [[-1, 0, -0.1], [1, 2.5, 0.1]];

  it('no collision meshes: no collision', () => {
    expect(walk([])).toBeLessThan(-300);
  });

  it('collides by its collision meshes only', () => {
    expect(walk([part([[[-1.5, 0, -0.25], [-1, 3, 0.25]]]), part([[[1, 0, -0.25], [1.5, 3, 0.25]]])])).toBeLessThan(-300);
    expect(walk([part([DOOR])])).toBeGreaterThan(-160 + 10 - 30);
  });

  it('they win over Box, Hull and Exact too; None still turns collision off', () => {
    const posts = [part([[[-1.5, 0, -0.25], [-1, 3, 0.25]]]), part([[[1, 0, -0.25], [1.5, 3, 0.25]]])];
    for (const mode of ['box', 'hull', 'exact']) expect(walk(posts, undefined, mode), mode).toBeLessThan(-300);
    expect(walk([part([DOOR])], undefined, 'none')).toBeLessThan(-300);
  });

  it('a box mesh becomes a box, turned ones too; anything else a hull', () => {
    const turn = (p: ReturnType<typeof part>) => {
      const c = Math.SQRT1_2;
      const q = new Float32Array(p.positions);
      for (let i = 0; i < q.length; i += 3) [q[i], q[i + 2]] = [c * q[i]! - c * q[i + 2]!, c * q[i]! + c * q[i + 2]!];
      return { ...p, positions: q };
    };
    const wedge = part([DOOR]);
    wedge.positions[1] = 0.5;
    const w = GameWorld.create(scene(arch('auto'), spawn()), { models: new Map([['assets/models/arch.glb', { ...ARCH, parts: [part([DOOR]), turn(part([DOOR])), wedge] }]]) });
    const kinds: number[] = [];
    (w as unknown as { world: RAPIER.World }).world.forEachCollider((c) => void (c.parent()?.isFixed() && c.shape.type !== RAPIER.ShapeType.Cylinder && c.shape.type !== RAPIER.ShapeType.Capsule && kinds.push(c.shape.type)));
    expect(kinds.sort()).toEqual([RAPIER.ShapeType.Cuboid, RAPIER.ShapeType.Cuboid, RAPIER.ShapeType.ConvexPolyhedron].sort());
    w.dispose();
  });

  it('a collision mesh the animation moves takes the collider with it', () => {
    const open = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 1];
    expect(walk([part([DOOR], true)])).toBeGreaterThan(-160 + 10 - 30);
    expect(walk([part([DOOR], true)], (w, id) => w.movePart(id, 0, open))).toBeLessThan(-300);
  });
});
