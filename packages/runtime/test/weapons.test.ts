// A1: weapons — bullets, shotguns, melee, rockets and grenades, ammo, blasts, “When this is hit”.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, newWeapon, type EntityData, type ItemDef, type SceneFile, type Vec3, type WeaponDef } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics, scatter } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const spawn = (at: Vec3 = [0, 0, 0], yawDeg = 0) => newEntity('start', { playerSpawn: {} }, { position: at, rotation: [0, yawDeg, 0] });
const floor = () => brush('floor', [-2048, -16, -2048], [2048, 0, 2048]);
function scene(items: ItemDef[], ...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  s.settings.ui = { screens: [], items } as never;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
const item = (name: string, weapon?: WeaponDef): ItemDef => ({ name, icon: '', ...(weapon ? { weapon } : {}) });
/** A breakable crate 300 ahead (−Z), at eye height. */
const target = (health = 100, extra: Record<string, unknown> = {}) => brush('crate', [-32, 32, -332], [32, 96, -268], { breakable: { health }, ...extra });

function armed(w: GameWorld, weapon: string, ammo?: [string, number]): void {
  w.giveItem(weapon, 1);
  if (ammo) w.giveItem(ammo[0], ammo[1]);
  w.selectSlot(0);
  run(w, 0.2);
}

describe('weapons', () => {
  it('a pistol fires once per click, uses a bullet each time, and hurts what it hits', () => {
    const w = GameWorld.create(scene([item('Pistol', newWeapon('pistol')), item('9mm')], floor(), target(), spawn()));
    armed(w, 'Pistol', ['9mm', 3]);
    expect(w.playerStatus()!.weapon).toEqual({ name: 'Pistol', ammo: 3, ammoName: '9mm' });
    const shots: unknown[] = [];
    w.bus.on('shot', (e) => void shots.push(e));
    w.setPlayerInput({ fire: true });
    run(w, 1);
    // Held, but not automatic: one shot.
    expect(shots).toHaveLength(1);
    expect(w.healthOf(w['doc'].entities.find((e) => e.name === 'crate')!.id)).toBe(92);
    for (let i = 0; i < 4; i++) {
      w.setPlayerInput({ fire: false });
      run(w, 0.3);
      w.setPlayerInput({ fire: true });
      run(w, 0.05);
    }
    // Out of bullets after three.
    expect(shots).toHaveLength(3);
    expect(w.playerStatus()!.weapon!.ammo).toBe(0);
    w.dispose();
  });

  it('an automatic weapon keeps firing at its rate; a shotgun fires its pellets in a spread', () => {
    const smg = { ...newWeapon('smg'), spread: 0 };
    const w = GameWorld.create(scene([item('SMG', smg), item('9mm'), item('Shotgun', newWeapon('shotgun')), item('Shells')], floor(), target(500), spawn()));
    armed(w, 'SMG', ['9mm', 100]);
    let n = 0;
    w.bus.on('shot', () => void n++);
    w.setPlayerInput({ fire: true });
    run(w, 1);
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
    w.dispose();

    const ends: [number, number, number][] = [];
    const w2 = GameWorld.create(scene([item('Shotgun', newWeapon('shotgun')), item('Shells')], floor(), spawn()));
    armed(w2, 'Shotgun', ['Shells', 5]);
    w2.bus.on('shot', (e) => void ends.push(e.to));
    w2.setPlayerInput({ fire: true });
    run(w2, 0.1);
    expect(ends).toHaveLength(6);
    expect(new Set(ends.map((e) => e.join())).size).toBe(6);
    expect(w2.playerStatus()!.weapon!.ammo).toBe(4);
    w2.dispose();
  });

  it('melee only reaches what is close and needs no ammo', () => {
    const near = brush('near', [-32, 0, -100], [32, 96, -40], { breakable: { health: 25 } });
    const w = GameWorld.create(scene([item('Crowbar', newWeapon('crowbar'))], floor(), near, spawn()));
    armed(w, 'Crowbar');
    w.setPlayerInput({ fire: true });
    run(w, 1.1);
    // Swings at 2.5 a second for 10: broken after three.
    expect(w.healthOf(near.id)).toBe(0);
    w.dispose();
    const w2 = GameWorld.create(scene([item('Crowbar', newWeapon('crowbar'))], floor(), target(), spawn()));
    armed(w2, 'Crowbar');
    w2.setPlayerInput({ fire: true });
    run(w2, 1);
    expect(w2.healthOf(w2['doc'].entities.find((e) => e.name === 'crate')!.id)).toBe(100);
    w2.dispose();
  });

  it('a rocket flies, blows up on what it hits, hurts things around it but not through walls, and throws physics objects', () => {
    const crate = target(200);
    const behindWall = brush('hidden', [200, 0, -320], [264, 64, -256], { breakable: { health: 200 } });
    const wall = brush('wall', [140, 0, -400], [156, 256, -200]);
    const ball = newEntity('ball', { rigidBody: { motion: 'dynamic', mass: 10 }, collider: { shape: 'box', size: [32, 32, 32] } }, { position: [-80, 16, -230] });
    const w = GameWorld.create(scene([item('RPG', newWeapon('rocket')), item('Rockets')], floor(), crate, behindWall, wall, ball, spawn()));
    armed(w, 'RPG', ['Rockets', 1]);
    const blasts: unknown[] = [];
    w.bus.on('explosion', (e) => void blasts.push(e));
    w.setPlayerInput({ fire: true });
    run(w, 0.1);
    expect(w.projectilesNow()).toHaveLength(1);
    run(w, 0.5);
    expect(w.projectilesNow()).toHaveLength(0);
    expect(blasts).toHaveLength(1);
    expect(w.healthOf(crate.id)!).toBeLessThan(150);
    expect(w.healthOf(behindWall.id)).toBe(200);
    run(w, 0.2);
    const p = w.positionOf(ball.id)!;
    expect(Math.hypot(p[0] + 80, p[2] + 230)).toBeGreaterThan(10);
    // Far from the blast: the player isn't hurt.
    expect(w.playerStatus()!.health).toBe(100);
    w.dispose();
  });

  it('your own blast hurts and throws you (rocket jump)', () => {
    const w = GameWorld.create(scene([item('RPG', newWeapon('rocket')), item('Rockets')], floor(), spawn()));
    armed(w, 'RPG', ['Rockets', 1]);
    w.setPlayerInput({ fire: true, pitch: -Math.PI / 2 + 0.05 });
    let top = 0;
    for (let i = 0; i < 60; i++) {
      w.step(1 / 60);
      top = Math.max(top, w.player!.feetPosition.y);
    }
    expect(w.playerStatus()!.health).toBeLessThan(100);
    expect(top).toBeGreaterThan(60);
    w.dispose();
  });

  it('a grenade arcs, bounces and goes off after its fuse', () => {
    const w = GameWorld.create(scene([item('Grenade', newWeapon('grenade')), item('Grenades')], floor(), spawn()));
    armed(w, 'Grenade', ['Grenades', 1]);
    let blast: [number, number, number] | null = null;
    w.bus.on('explosion', (e) => void (blast = e.at));
    w.setPlayerInput({ fire: true, pitch: 0.3 });
    run(w, 1);
    expect(w.projectilesNow()).toHaveLength(1);
    expect(blast).toBeNull();
    run(w, 2);
    expect(blast).not.toBeNull();
    expect(blast![1]).toBeLessThan(20);
    expect(blast![2]).toBeLessThan(-200);
    w.dispose();
  });

  it('“When this is hit” runs on what is hit and what it is inside', () => {
    const group = newEntity('target group', {});
    const plate = brush('plate', [-32, 32, -302], [32, 96, -298]);
    plate.parent = group.id;
    group.components.script = {
      version: 1,
      variables: [],
      handlers: [{ id: 'h', event: { id: 'e', kind: 'hit' }, body: [{ id: 's', kind: 'addScore', amount: { id: 'n', kind: 'number', value: 1 } }] }],
    } satisfies Script as never;
    const w = GameWorld.create(scene([item('Pistol', { ...newWeapon('pistol'), spread: 0, ammo: '' })], floor(), group, plate, spawn()));
    armed(w, 'Pistol');
    w.setPlayerInput({ fire: true });
    run(w, 0.2);
    expect(w.playerStatus()!.score).toBe(1);
    w.dispose();
  });

  it('spread stays within its angle', () => {
    let worst = 0;
    for (let i = 0; i < 500; i++) {
      const d = scatter([0, 0, -1], 5, Math.random);
      worst = Math.max(worst, Math.acos(-d[2]));
    }
    expect((worst * 180) / Math.PI).toBeLessThanOrEqual(5.01);
  });
});
