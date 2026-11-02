// A1: armour (Half-Life's suit) and wall chargers.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { emptyScript, recipe, type Script } from '@cocoaworlds/scripting';
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

describe('armour', () => {
  it('takes 80% of the damage, one point for every two it stops; falls go past it; dying loses it', () => {
    const w = GameWorld.create(scene(floor(), spawn()));
    run(w, 0.2);
    w.giveArmour(15);
    w.hurt(10);
    // 2 to health, 8 stopped for 4 armour.
    expect(w.playerStatus()!.health).toBeCloseTo(98);
    expect(w.playerStatus()!.armour).toBeCloseTo(11);
    // More damage than the armour can stop: it stops what it can (22), the rest hurts.
    w.hurt(50);
    expect(w.playerStatus()!.armour).toBe(0);
    expect(w.playerStatus()!.health).toBeCloseTo(98 - 28);
    w.giveArmour(500);
    expect(w.playerStatus()!.armour).toBe(100);
    w.hurt(20, 'a fall', true);
    expect(w.playerStatus()!.health).toBeCloseTo(50);
    expect(w.playerStatus()!.armour).toBe(100);
    w.hurt(100, 'lava', true);
    expect(w.playerStatus()!.armour).toBe(0);
    expect(w.playerStatus()!.health).toBe(100);
    w.dispose();
  });

  it('the battery recipe gives 15 and blocks can read it', () => {
    const battery = brush('battery', [-8, 0, -88], [8, 16, -72]);
    const r = recipe('armour-pickup')!;
    const t = { id: battery.id, name: 'battery', min: [-8, 0, -88] as Vec3, max: [8, 16, -72] as Vec3 };
    const zone = r.zone!(t);
    const zoneEnt = brush(zone.name, zone.min as Vec3, zone.max as Vec3, { trigger: { detects: 'player', once: false } });
    const out = r.build(t, zoneEnt.id);
    battery.components.script = { version: 1, variables: out.variables, handlers: out.handlers } as never;
    const w = GameWorld.create(scene(floor(), battery, zoneEnt, spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 1);
    expect(w.playerStatus()!.armour).toBe(15);
    expect(w.scriptProblems).toEqual([]);
    w.dispose();
  });
});

const chargerId = (w: GameWorld) => [...(w as unknown as { chargers: Map<string, unknown> }).chargers.keys()][0]!;

describe('chargers', () => {
  const charger = (gives: 'health' | 'armour', capacity = 50) => brush(`${gives}_charger`, [-32, 0, -72], [32, 96, -56], { charger: { gives, capacity, rate: 10 } });

  it('gives while Use is held on it, until the player is full or it runs dry', () => {
    const w = GameWorld.create(scene(floor(), charger('health', 30), spawn()));
    run(w, 0.2);
    w.hurt(60);
    expect(w.usePrompt()).toBe('');
    w.setPlayerInput({ use: true });
    run(w, 1);
    expect(w.playerStatus()!.health).toBeCloseTo(50, 0);
    w.setPlayerInput({ use: false });
    run(w, 1);
    expect(w.playerStatus()!.health).toBeCloseTo(50, 0);
    w.setPlayerInput({ use: true });
    run(w, 5);
    // Ran dry at 30.
    expect(w.playerStatus()!.health).toBeCloseTo(70, 0);
    expect(w.chargerLeft(chargerId(w))).toBeCloseTo(0);
    expect(w.usePrompt()).toBeNull();
    w.dispose();
  });

  it('a suit charger gives armour and stops at 100', () => {
    const w = GameWorld.create(scene(floor(), charger('armour', 200), spawn()));
    run(w, 0.2);
    w.giveArmour(95);
    w.setPlayerInput({ use: true });
    run(w, 2);
    expect(w.playerStatus()!.armour).toBe(100);
    expect(w.chargerLeft(chargerId(w))).toBeCloseTo(195, 0);
    w.dispose();
  });
});

// (A script that reads the armour compiles without problems.)
it('“the player’s armour” compiles', () => {
  const s: Script = emptyScript();
  s.handlers.push({ id: 'h', event: { id: 'e', kind: 'start' }, body: [{ id: 'a', kind: 'addScore', amount: { id: 't', kind: 'armour' } }] } as never);
  const w = GameWorld.create(scene(floor(), spawn(), newEntity('x', { script: s as never })));
  expect(w.scriptProblems).toEqual([]);
  w.dispose();
});
