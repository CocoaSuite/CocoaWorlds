// Footsteps, things hitting things, and the silent world.
import { beforeAll, describe, expect, it } from 'vitest';
import { guessSurface, newEntity, newProject, newScene, validateProject, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, defaultSurface, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, material: string, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max, { ...defaultSurface(), material })).faces } as never, ...extra });
const floor = () => brush('floor', [-2048, -16, -2048], [2048, 0, 2048], 'mat/aaaaaaaaaaaaaaaa');
const scene = (...entities: EntityData[]): SceneFile => {
  const s = newScene('t');
  s.entities = [...entities, newEntity('start', { playerSpawn: {} }, { position: [0, 0, 600] })];
  return s;
};
const surfaces = new Map([['mat/aaaaaaaaaaaaaaaa', 'concrete' as const], ['mat/bbbbbbbbbbbbbbbb', 'wood' as const]]);
const crate = (name: string, y: number, x = 0) => brush(name, [x - 12, y, -12], [x + 12, y + 24, 12], 'mat/bbbbbbbbbbbbbbbb', { rigidBody: { motion: 'dynamic', mass: 10 } });
const listen = (w: GameWorld, type: 'hit' | 'step') => {
  const out: { t: number; surface: string; volume: number; kind?: string }[] = [];
  w.bus.on(type, (e) => void out.push({ t: w.time, surface: e.surface, volume: e.volume, kind: 'kind' in e ? e.kind : undefined }));
  return out;
};
const run = (w: GameWorld, s: number) => {
  for (let i = 0; i < Math.round(s * 60); i++) w.step(1 / 60);
};

describe('hits', () => {
  it('a dropped crate thuds once as wood (a bounce or two at most) and is quiet once it rests', () => {
    const w = GameWorld.create(scene(floor(), crate('crate', 96)), { surfaces });
    const hits = listen(w, 'hit');
    run(w, 4);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits[0]!.surface).toBe('wood');
    expect(hits[0]!.volume).toBeGreaterThan(0.3);
    expect(hits.every((h) => h.t < 2)).toBe(true);
  });

  it('louder the faster: set down gently is a soft tap, a long drop is loud', () => {
    const gentle = GameWorld.create(scene(floor(), crate('crate', 2)), { surfaces });
    const soft = listen(gentle, 'hit');
    run(gentle, 2);
    const high = GameWorld.create(scene(floor(), crate('crate', 200)), { surfaces });
    const loud = listen(high, 'hit');
    run(high, 3);
    expect(soft.length).toBe(1);
    expect(soft[0]!.volume).toBeLessThan(0.2);
    expect(loud[0]!.volume).toBeGreaterThan(0.85);
  });

  it('a pile does not buzz: few hits, none once settled, and nothing at all from things lying still', () => {
    const crates = Array.from({ length: 12 }, (_, i) => crate(`c${i}`, 30 + i * 26, (i % 3) * 6 - 6));
    const w = GameWorld.create(scene(floor(), ...crates), { surfaces });
    const hits = listen(w, 'hit');
    run(w, 6);
    expect(hits.length).toBeLessThan(40);
    expect(hits.filter((h) => h.t > 4)).toEqual([]);
    const still = GameWorld.create(scene(floor(), crate('resting', 0)), { surfaces });
    const none = listen(still, 'hit');
    run(still, 3);
    expect(none).toEqual([]);
  });
});

describe('footsteps', () => {
  it('step on what is underfoot, a stride apart; a jump and a landing too', () => {
    const w = GameWorld.create(scene(floor(), brush('deck', [-200, 0, -400], [200, 4, 0], 'mat/bbbbbbbbbbbbbbbb')), { surfaces });
    const steps = listen(w, 'step');
    run(w, 0.5);
    steps.length = 0;
    w.setPlayerInput({ forward: 1 });
    run(w, 2);
    const walked = steps.filter((s) => s.kind === 'step');
    expect(walked.length).toBeGreaterThan(5);
    expect(walked.length).toBeLessThan(14);
    expect(walked[0]!.surface).toBe('concrete');
    run(w, 3);
    expect(steps.some((s) => s.surface === 'wood')).toBe(true);
    w.setPlayerInput({ forward: 0, jump: true });
    run(w, 0.1);
    w.setPlayerInput({ jump: false });
    run(w, 1.5);
    expect(steps.some((s) => s.kind === 'jump')).toBe(true);
    expect(steps.some((s) => s.kind === 'land')).toBe(true);
  });
});

describe('the silent world', () => {
  it('blocks silence the world and bring it back; Sound components are marked as the world’s', () => {
    const radio = newEntity('radio', { sound: { sound: 'assets/sounds/hum.ogg', volume: 1, loop: true, playOnStart: true, range: 512 } });
    radio.components.script = { version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'start' }, body: [{ id: 's', kind: 'silence' }, { id: 'w', kind: 'wait', seconds: { id: 'n', kind: 'number', value: 1 } }, { id: 'u', kind: 'unsilence' }] }] } as never;
    const w = GameWorld.create(scene(floor(), radio));
    const sounds: boolean[] = [];
    w.bus.on('sound', (e) => void sounds.push(!!e.ambient));
    run(w, 0.5);
    expect(w.silent).toBe(true);
    expect(sounds).toEqual([true]);
    run(w, 1);
    expect(w.silent).toBe(false);
  });
});

describe('surface kinds', () => {
  it('are guessed from names, and the project keeps each kind’s sound files', () => {
    expect(['Old oak planks', 'Rusty steel', 'Wet grass', 'Brick wall', 'Dev grid'].map(guessSurface)).toEqual(['wood', 'metal', 'grass', 'stone', 'generic']);
    const p = newProject('t').project;
    p.settings.surfaceSounds = { wood: { steps: ['assets/sounds/a.ogg'], hard: [] } };
    expect(validateProject(p).ok).toBe(true);
    p.settings.surfaceSounds = { lava: { steps: [] } } as never;
    expect(validateProject(p).ok).toBe(false);
  });
});
