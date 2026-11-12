// Navigation measured off the game's thread: the job posted to workers, the rows that come back, and what the world
// does when they don't.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, navSize, openNavJob, type NavBuilder, type NavGrid, type NavJob, type NavRows } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
function level(creature = true): SceneFile {
  const s = newScene('test');
  s.entities = [
    brush('floor', [-800, -16, -800], [800, 0, 800]),
    brush('deck', [0, 200, 0], [400, 216, 400]),
    brush('wall', [-800, 0, -8], [400, 160, 8]),
    brush('ramp-ish step', [500, 0, 100], [700, 24, 300]),
    newEntity('crate', { brush: { role: 'solid', faces: toData(box([-300, 0, 200], [-236, 64, 264])).faces } as never, rigidBody: { motion: 'dynamic' } as never }),
    ...(creature ? [newEntity('walker', { npc: { side: 'neutral', speed: 220 } }, { position: [0, 0, -200] })] : []),
  ];
  return s;
}

/** What a worker does with a job: it arrives as a copy (as a posted message does), and its rows go back in bands. */
function measured(job: NavJob, bands: number): NavRows[] {
  const posted = structuredClone(job);
  const l = openNavJob(posted);
  const n = Math.min(bands, l.nz);
  const out = Array.from({ length: n }, (_, k) => structuredClone(l.rows(Math.floor((l.nz * k) / n), Math.floor((l.nz * (k + 1)) / n))));
  l.free();
  return out;
}

const same = (a: NavGrid, b: NavGrid) => {
  expect(b.count).toBe(a.count);
  expect(Array.from(b.xyz)).toEqual(Array.from(a.xyz));
  expect(b.links()).toEqual(a.links());
  const from = { x: 0, y: 0, z: -300 }, to = { x: 0, y: 0, z: 300 };
  expect(b.path(from, to)).toEqual(a.path(from, to));
};

describe('navigation measured elsewhere', () => {
  it('rows measured from the posted job, in any number of bands, make the grid the world measures itself', async () => {
    const here = GameWorld.create(level());
    const grid = here.navigation()!;
    expect(grid.count).toBeGreaterThan(1000);
    for (const bands of [1, 3, 7, 1000]) {
      let jobs = 0;
      const w = GameWorld.create(level(), { navBuilder: async (job) => (jobs++, measured(job, bands)) });
      await w.navReady;
      expect(jobs).toBe(1);
      same(grid, w.navigation()!);
      w.dispose();
    }
    here.dispose();
  });

  it('the job is plain data: a snapshot, the solid colliders, the box', () => {
    let seen: NavJob | null = null;
    const w = GameWorld.create(level(), { navBuilder: (job) => ((seen = job), new Promise(() => {})) });
    const job = seen!;
    expect(job.snapshot).toBeInstanceOf(Uint8Array);
    expect(job.snapshot.length).toBeGreaterThan(1000);
    // (Floor, deck, wall and step are ground; the crate and the creature are not.)
    expect(job.solid).toBeInstanceOf(Float64Array);
    expect(job.solid.length).toBe(4);
    expect(navSize(job.min, job.max).nz).toBeGreaterThan(50);
    expect(() => structuredClone(job)).not.toThrow();
    w.dispose();
  });

  it('the physics starts from the same state as when the world measures the level itself', async () => {
    const a = GameWorld.create(level());
    const b = GameWorld.create(level(), { navBuilder: async (job) => measured(job, 4) });
    await b.navReady;
    const raw = (w: GameWorld) => Array.from((w as unknown as { world: { takeSnapshot(): Uint8Array } }).world.takeSnapshot());
    expect(raw(b)).toEqual(raw(a));
    a.dispose();
    b.dispose();
  });

  it('asked for before the answer comes, the level is measured here; the late answer changes nothing', async () => {
    const here = GameWorld.create(level());
    let answer: (rows: NavRows[]) => void = () => {};
    const w = GameWorld.create(level(), { navBuilder: () => new Promise<NavRows[]>((r) => (answer = r)) });
    const grid = w.navigation()!;
    same(here.navigation()!, grid);
    answer([{ spots: new Float32Array(0), colOf: new Int32Array(0) }]);
    await w.navReady;
    expect(w.navigation()).toBe(grid);
    here.dispose();
    w.dispose();
  });

  it('a builder that fails leaves the world to measure the level itself', async () => {
    const here = GameWorld.create(level());
    const failing: NavBuilder = () => Promise.reject(new Error('no workers'));
    const w = GameWorld.create(level(), { navBuilder: failing });
    await w.navReady;
    same(here.navigation()!, w.navigation()!);
    here.dispose();
    w.dispose();
  });

  it('a level with no creatures asks for nothing', async () => {
    let jobs = 0;
    const w = GameWorld.create(level(false), { navBuilder: async (job) => (jobs++, measured(job, 2)) });
    await w.navReady;
    expect(jobs).toBe(0);
    w.dispose();
  });
});
