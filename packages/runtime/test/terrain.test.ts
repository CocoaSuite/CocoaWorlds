// T1: terrain in the game — fixed ground to stand on, and somewhere creatures can walk.
import { beforeAll, expect, it } from 'vitest';
import { newEntity, newScene } from '@cocoaworlds/core';
import { VoxelField } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, type ModelMesh } from '../src';

beforeAll(async () => {
  await initPhysics();
});

it('the player lands on a terrain, and navigation finds its surface', () => {
  const f = new VoxelField([33, 9, 33], 16);
  f.fillFlat(64);
  f.sculpt('fill', [256, 64, 256], 48, 1);
  const parts: ModelMesh[] = [];
  const [cx, cy, cz] = f.chunks;
  for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
    const m = f.meshChunk(x, y, z);
    if (m.indices.length) parts.push({ positions: m.positions, indices: m.indices });
  }
  const ground = newEntity('ground', { terrain: { file: 'assets/terrain/t.cwvox' } }, { position: [-256, -64, -256] });
  const s = newScene('t');
  s.entities = [ground, newEntity('start', { playerSpawn: {} }, { position: [-150, 100, -150] })];
  const w = GameWorld.create(s, { terrains: new Map([[ground.id, parts]]) });
  for (let t = 0; t < 3; t += 1 / 60) w.step(1 / 60);
  expect(w.player!.onGround).toBe(true);
  expect(Math.abs(w.player!.feetPosition.y)).toBeLessThan(4);
  const nav = w.navigation()!;
  expect(nav.count).toBeGreaterThan(500);
  // The hill in the middle (a filled sphere) is ground too.
  const top = nav.nearest({ x: 0, y: 48, z: 0 });
  expect(nav.xyz[top * 3 + 1]).toBeGreaterThan(30);
  w.dispose();
});
