import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, PLAYER, initPhysics } from '../src';

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

describe('Player', () => {
  it('stands on the floor at the Player start, eyes at 64', () => {
    const w = GameWorld.create(scene(floor(), spawn([0, 0, 0])));
    run(w, 0.5);
    const v = w.playerView()!;
    expect(v.eye[1]).toBeCloseTo(PLAYER.eye, 0);
    expect(w.player!.onGround).toBe(true);
    w.dispose();
  });

  it('no Player start, no player', () => {
    const w = GameWorld.create(scene(floor()));
    expect(w.player).toBeNull();
    expect(w.playerView()).toBeNull();
    w.dispose();
  });

  it('runs at about 320 u/s and walks slower; stops with friction', () => {
    const w = GameWorld.create(scene(floor(), spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 1);
    expect(Math.hypot(w.player!.velocity.x, w.player!.velocity.z)).toBeCloseTo(PLAYER.runSpeed, -1);
    // Yaw 0 looks along −Z.
    expect(w.player!.feetPosition.z).toBeLessThan(-200);
    w.setPlayerInput({ walk: true });
    run(w, 1);
    expect(Math.hypot(w.player!.velocity.x, w.player!.velocity.z)).toBeCloseTo(PLAYER.walkSpeed, -1);
    w.setPlayerInput({ forward: 0 });
    run(w, 0.5);
    expect(Math.hypot(w.player!.velocity.x, w.player!.velocity.z)).toBe(0);
    w.dispose();
  });

  it('faces the way the Player start faces', () => {
    const w = GameWorld.create(scene(floor(), spawn([0, 0, 0], 90)));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.5);
    // Turned 90° left: forward is −X.
    expect(w.player!.feetPosition.x).toBeLessThan(-50);
    expect(Math.abs(w.player!.feetPosition.z)).toBeLessThan(5);
    w.dispose();
  });

  it('jumps about 45 u high, once per press', () => {
    const w = GameWorld.create(scene(floor(), spawn()));
    run(w, 0.3);
    w.setPlayerInput({ jump: true });
    let top = 0;
    for (let i = 0; i < 90; i++) {
      w.step(1 / 60);
      top = Math.max(top, w.player!.feetPosition.y);
    }
    expect(top).toBeGreaterThan(38);
    expect(top).toBeLessThan(50);
    // Still holding jump: no second jump.
    expect(w.player!.onGround).toBe(true);
    run(w, 0.5);
    expect(w.player!.feetPosition.y).toBeLessThan(2);
    w.dispose();
  });

  it('walks up a step of 16 but not a wall of 40', () => {
    const step = brush('step', [-64, 0, -200], [64, 16, -100]);
    const w = GameWorld.create(scene(floor(), step, spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.5);
    expect(w.player!.feetPosition.z).toBeLessThan(-110);
    expect(w.player!.feetPosition.y).toBeCloseTo(16, 0);
    w.dispose();

    const wall = brush('wall', [-64, 0, -200], [64, 40, -100]);
    const w2 = GameWorld.create(scene(floor(), wall, spawn()));
    run(w2, 0.2);
    w2.setPlayerInput({ forward: 1 });
    run(w2, 1);
    expect(w2.player!.feetPosition.y).toBeLessThan(2);
    // Stopped with the front of its box at the wall.
    expect(w2.player!.feetPosition.z).toBeGreaterThan(-100 + PLAYER.radius - 2);
    w2.dispose();
  });

  it('crouches under a low ceiling and cannot stand up there', () => {
    const roof = brush('roof', [-64, 50, -300], [64, 66, -100]);
    const w = GameWorld.create(scene(floor(), roof, spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1, crouch: true });
    run(w, 2);
    expect(w.player!.feetPosition.z).toBeLessThan(-150);
    w.setPlayerInput({ forward: 0, crouch: false });
    run(w, 0.2);
    expect(w.player!.crouched).toBe(true);
    w.dispose();
  });

  it('falls out of the world and starts again', () => {
    const w = GameWorld.create(scene(brush('ledge', [-64, -16, -64], [64, 0, 64]), spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 6);
    w.setPlayerInput({ forward: 0 });
    // Back at the start at some point after the fall.
    expect(w.player!.feetPosition.y).toBeGreaterThan(-2048);
    w.dispose();
  });

  it('a zone that notices the player sees the player walk in', () => {
    const zone = brush('zone', [-64, 0, -300], [64, 100, -200], { trigger: { detects: 'player' } });
    const w = GameWorld.create(scene(floor(), zone, spawn()));
    const seen: string[] = [];
    w.bus.on('trigger.enter', (e) => seen.push(e.other));
    w.setPlayerInput({ forward: 1 });
    run(w, 1.5);
    expect(seen).toEqual(['player']);
    w.dispose();
  });

  it('Use runs “When the player uses this” on what the player looks at (and what it is inside)', () => {
    const door = brush('door', [-32, 0, -80], [32, 96, -64]);
    const group = newEntity('doorway', {
      group: {},
      script: {
        version: 1,
        variables: [],
        handlers: [{ id: 'h1', event: { id: 'e1', kind: 'use' }, body: [{ id: 's1', kind: 'log', text: { id: 'x1', kind: 'text', value: 'used' } }] }],
      },
    } as never);
    door.parent = group.id;
    const w = GameWorld.create(scene(floor(), group, door, spawn()));
    const uses: string[] = [];
    w.bus.on('use', (e) => uses.push(e.target));
    run(w, 0.3);
    w.use();
    run(w, 0.1);
    expect(uses).toEqual([door.id]);
    expect(w.drainLogs().map((l) => l.text)).toEqual(['used']);
    // Looking away: nothing in reach.
    w.setPlayerInput({ yaw: Math.PI });
    w.use();
    run(w, 0.1);
    expect(uses).toHaveLength(1);
    w.dispose();
  });
});
