// A1: ladders, water and swimming, floating, drowning.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const spawn = (at: Vec3 = [0, 0, 0], yawDeg = 0) => newEntity('start', { playerSpawn: {} }, { position: at, rotation: [0, yawDeg, 0] });
const floor = () => brush('floor', [-1024, -16, -1024], [1024, 0, 1024]);
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

/** A pool: floor at −256, water up to 0, walls round it, the player starting on the edge at (0, 0, 200). */
const pool = (drowns = true) => [
  brush('bottom', [-512, -272, -512], [512, -256, 512]),
  brush('rim_n', [-512, -256, -512], [512, 0, -160]),
  brush('rim_s', [-512, -256, 160], [512, 0, 512]),
  brush('rim_w', [-512, -256, -160], [-160, 0, 160]),
  brush('rim_e', [160, -256, -160], [512, 0, 160]),
  brush('water', [-160, -256, -160], [160, -8, 160], { water: { tint: '#28607a', clearness: 640, drowns } }),
];

describe('ladders', () => {
  // A wall at z = −64 with a ladder zone in front of it, up to a ledge at 256.
  const tower = () => [
    floor(),
    brush('wall', [-64, 0, -128], [64, 256, -64]),
    brush('ledge', [-64, 240, -320], [64, 256, -64]),
    brush('ladder', [-32, 0, -72], [32, 256, -56], { ladder: { speed: 200 } }),
  ];

  it('climbs up looking ahead, steps off at the top, and goes down looking down', () => {
    const w = GameWorld.create(scene(...tower(), spawn([0, 0, -20])));
    run(w, 0.3);
    w.setPlayerInput({ forward: 1, pitch: 0 });
    run(w, 0.3);
    expect(w.player!.onLadder).toBe(true);
    run(w, 2);
    // Over the top and onto the ledge.
    const p = w.player!.feetPosition;
    expect(p.y).toBeCloseTo(256, -1);
    expect(p.z).toBeLessThan(-70);
    expect(w.player!.onGround).toBe(true);
    // Back onto the ladder facing it from above and look down: down again.
    w.setPlayerInput({ forward: -1 });
    run(w, 0.4);
    w.setPlayerInput({ forward: 1, pitch: -1 });
    run(w, 0.15);
    w.setPlayerInput({ forward: -1, pitch: 0 });
    run(w, 2);
    expect(w.player!.feetPosition.y).toBeLessThan(200);
    w.dispose();
  });

  it('holds still on the ladder without input, and jumping lets go (no fall damage)', () => {
    const w = GameWorld.create(scene(...tower(), spawn([0, 0, -20])));
    run(w, 0.3);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.8);
    w.setPlayerInput({ forward: 0 });
    const y = w.player!.feetPosition.y;
    expect(y).toBeGreaterThan(80);
    run(w, 1);
    expect(w.player!.feetPosition.y).toBeCloseTo(y, 0);
    w.setPlayerInput({ jump: true });
    run(w, 0.2);
    w.setPlayerInput({ jump: false });
    expect(w.player!.onLadder).toBe(false);
    run(w, 2);
    expect(w.player!.feetPosition.y).toBeCloseTo(0, 0);
    expect(w.player!.feetPosition.z).toBeGreaterThan(-20);
    w.dispose();
  });
});

describe('water', () => {
  it('the player swims: sinks slowly, rises with Jump, dives along the view, and the fall into it is safe', () => {
    // Dropped from 200 above the water.
    const w = GameWorld.create(scene(...pool(), spawn([0, 200, 0])));
    run(w, 2);
    const p = w.player!;
    expect(p.waterLevel).toBeGreaterThanOrEqual(2);
    expect(w.health).toBe(100);
    // Idle: sinks, slowly.
    const y0 = p.feetPosition.y;
    run(w, 1);
    expect(p.feetPosition.y).toBeLessThan(y0);
    expect(p.feetPosition.y).toBeGreaterThan(y0 - 80);
    // Jump: up to the surface, bobbing there with the head out.
    w.setPlayerInput({ jump: true });
    run(w, 3);
    expect(p.waterLevel).toBeLessThanOrEqual(2);
    expect(p.eye()[1]).toBeGreaterThan(-20);
    // Forward while looking down: dives.
    w.setPlayerInput({ jump: false, forward: 1, pitch: -1.2 });
    run(w, 1);
    expect(p.waterLevel).toBe(3);
    expect(p.feetPosition.y).toBeLessThan(-120);
    w.dispose();
  });

  it('jumping out onto the edge from the surface', () => {
    const w = GameWorld.create(scene(...pool(), spawn([0, -60, 0])));
    run(w, 0.5);
    w.setPlayerInput({ jump: true });
    run(w, 2);
    // Swim to the south edge (+Z), holding Jump: out onto the rim.
    w.setPlayerInput({ jump: true, forward: 1, yaw: Math.PI, pitch: 0 });
    run(w, 2.5);
    const p = w.player!.feetPosition;
    expect(p.z).toBeGreaterThan(160);
    expect(p.y).toBeCloseTo(0, -1);
    w.dispose();
  });

  it('drowns after 12 s under water, unless the water is set not to', () => {
    for (const drowns of [true, false]) {
      const w = GameWorld.create(scene(...pool(drowns), spawn([0, -250, 0])));
      run(w, 11);
      expect(w.health).toBe(100);
      run(w, 3.1);
      expect(w.health).toBe(drowns ? 70 : 100);
      w.dispose();
    }
  });

  it('physics objects float; heavy or light, they settle at the surface', () => {
    const crate = (name: string, x: number, mass: number) =>
      newEntity(name, { brush: { role: 'solid', faces: toData(box([x - 16, -200, -16], [x + 16, -168, 16])).faces } as never, rigidBody: { motion: 'dynamic', mass } });
    const w = GameWorld.create(scene(...pool(), crate('light', -60, 5), crate('heavy', 60, 200)));
    run(w, 8);
    for (const b of w.movingBodies()) {
      const y = w.positionOf(b.id)![1];
      expect(y, b.id).toBeGreaterThan(-60);
      expect(y, b.id).toBeLessThan(10);
    }
    w.dispose();
  });

  it('knows which water a point is in', () => {
    const w = GameWorld.create(scene(...pool()));
    expect(w.waterAt({ x: 0, y: -100, z: 0 })?.tint).toBe('#28607a');
    expect(w.waterAt({ x: 0, y: 10, z: 0 })).toBeNull();
    expect(w.waterAt({ x: 300, y: -100, z: 0 })).toBeNull();
    w.dispose();
  });
});
