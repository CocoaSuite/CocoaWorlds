// The bench scene loads and plays in the game world (what the bench measures in the editor).
import { beforeAll, expect, it } from 'vitest';
import { GameWorld, initPhysics } from '@cocoaworlds/runtime';
import { BENCH, benchPlants, benchScene } from './scene';

beforeAll(async () => {
  await initPhysics();
});

it('the bench scene has what it promises and plays', () => {
  const s = benchScene();
  const count = (name: string) => s.entities.filter((e) => e.name === name).length;
  expect(count('crate')).toBe(BENCH.crates);
  expect(count('creature')).toBe(BENCH.creatures);
  expect(count('plant')).toBe(BENCH.plants);
  expect(count('bulb')).toBe(BENCH.bulbs);
  expect(count('wall')).toBeGreaterThan(200);
  expect(new Set(s.entities.filter((e) => e.components.plant).map((e) => (e.components.plant as { plant: string }).plant))).toEqual(new Set(benchPlants().map((p) => p.id)));
  // The same level every time.
  expect(JSON.stringify(benchScene().entities.map((e) => e.transform))).toBe(JSON.stringify(s.entities.map((e) => e.transform)));
  const w = GameWorld.create(s);
  expect(w.hasBlasts).toBe(true);
  w.giveItem('Launcher', 1);
  w.giveItem('Rockets', 5);
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  const f = w.snapshot();
  expect(f.bodyCount).toBe(BENCH.crates);
  expect(f.npcCount).toBe(BENCH.creatures);
  // Some walk about or come for the player (path search, sight, the Hunter's tree); wanderers rest between walks.
  const busy = w.npcStates().filter((n) => n.state !== 'idle' && n.state !== 'dead').length;
  expect(busy).toBeGreaterThan(5);
  w.dispose();
}, 60000);
