// Computers: E moves the view to the screen (the player stays put), the shop lists Shop item objects, Buy pays from a
// game value and prints on the 3D printer, and what the desktop keeps is saved with the world.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, type SavedProgress } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
const sit = (w: GameWorld, id: string) => (w as unknown as { enterHiding(id: string): void }).enterHiding(id);
const values = [{ name: 'Cash', type: 'number' as const, initial: 50, show: false }];

function scene(): { s: SceneFile; pc: EntityData; crate: EntityData } {
  const s = newScene('home');
  const crate = brush('crate', [300, 0, 300], [316, 16, 316], { rigidBody: { motion: 'dynamic', mass: 5 }, shopItem: { name: 'Crate', price: 30 } });
  const printer = newEntity('printer', { printer: { bed: [0, 40, 0], layerHeight: 1, layerSeconds: 0.1 } as never }, { position: [0, 0, -200] });
  const plate = brush('plate', [-24, 30, -224], [24, 40, -176]);
  const pc = brush('pc', [100, 0, -16], [116, 48, 16], { computer: { money: 'Cash', time: 0.1 } });
  s.entities = [brush('floor', [-1024, -16, -1024], [1024, 0, 1024]), newEntity('start', { playerSpawn: {} }), crate, printer, plate, pc];
  return { s, pc, crate };
}

describe('computer', () => {
  it('opens once the view is there, sells shop items for money and prints them', () => {
    const { s, pc, crate } = scene();
    const w = GameWorld.create(s, { values });
    run(w, 0.1);
    expect(w.computer()).toBeNull();
    sit(w, pc.id);
    expect(w.atComputer).toBeNull();
    run(w, 0.2);
    expect(w.atComputer).toBe(pc.id);
    expect(w.uiState().freesMouse).toBe(true);
    expect(w.computer()).toMatchObject({ id: pc.id, money: 50, printer: 'ready', printing: null, items: [{ id: crate.id, name: 'Crate', price: 30, picture: '' }] });
    expect(w.computerAction('buy', crate.id)).toBe('ok');
    expect(w.computer()).toMatchObject({ money: 20, printer: 'printing', printing: crate.id });
    // (Busy, and too poor for another.)
    expect(w.computerAction('buy', crate.id)).toBe('poor');
    w.setValue('Cash', 100);
    expect(w.computerAction('buy', crate.id)).toBe('busy');
    expect(w.computer()!.money).toBe(100);
    expect(w.computerAction('exit')).toBe('ok');
    run(w, 0.3);
    expect(w.atComputer).toBeNull();
    expect(w.uiState().freesMouse).toBe(false);
  });

  it('keeps its desktop with the saved game', () => {
    const { s, pc } = scene();
    const w = GameWorld.create(s, { values, rules: { saveWorld: true } });
    run(w, 0.1);
    w.setComputerState(pc.id, { notes: [{ name: 'todo.txt', text: 'buy a crate' }], theme: 'light' });
    const saved: SavedProgress = JSON.parse(JSON.stringify(w.progress()));
    const again = GameWorld.create(s, { values, rules: { saveWorld: true }, saved });
    run(again, 0.1);
    expect(again.computerState(pc.id)).toEqual({ notes: [{ name: 'todo.txt', text: 'buy a crate' }], theme: 'light' });
  });
});
