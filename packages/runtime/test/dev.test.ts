import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, runDevCommand } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
const world = () => GameWorld.create(scene(brush('floor', [-1024, -16, -1024], [1024, 0, 1024]), brush('Crate', [200, 0, 200], [232, 32, 232]), newEntity('start', { playerSpawn: {} })));
const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < s; t += 1 / 60) w.step(1 / 60);
};

describe('dev console', () => {
  it('god mode stops damage; heal and kill work', () => {
    const w = world();
    run(w, 0.2);
    runDevCommand(w, 'god');
    w.hurt(50);
    expect(w.playerStatus()!.health).toBe(100);
    runDevCommand(w, 'god off');
    runDevCommand(w, 'hurt 30');
    expect(w.playerStatus()!.health).toBe(70);
    runDevCommand(w, 'heal');
    expect(w.playerStatus()!.health).toBe(100);
    runDevCommand(w, 'kill');
    expect(w.playerStatus()!.deaths).toBe(1);
  });

  it('teleports, gives items and answers unknown commands', () => {
    const w = world();
    run(w, 0.2);
    runDevCommand(w, 'tp 100 50 -100');
    const f = w.player!.feetPosition;
    expect([Math.round(f.x), Math.round(f.z)]).toEqual([100, -100]);
    expect(runDevCommand(w, 'tp crate')[0]).toContain('Crate');
    runDevCommand(w, 'give Rope 3');
    expect(w.items()).toEqual([['Rope', 3]]);
    expect(runDevCommand(w, 'nope')[0]).toContain('Unknown');
    expect(runDevCommand(w, 'help').length).toBeGreaterThan(10);
  });

  it('noclip flies up through the air, and timescale 0 freezes the game', () => {
    const w = world();
    run(w, 0.2);
    runDevCommand(w, 'noclip');
    w.setPlayerInput({ jump: true });
    const y0 = w.player!.feetPosition.y;
    run(w, 0.5);
    expect(w.player!.feetPosition.y).toBeGreaterThan(y0 + 50);
    runDevCommand(w, 'timescale 0');
    expect(w.step(1)).toBe(0);
  });
});
