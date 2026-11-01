import { describe, expect, it } from 'vitest';
import { AabbTree, box, boxesTouch, buildMesh, type Aabb } from '../src';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('AabbTree', () => {
  it('finds exactly the boxes brute force finds', () => {
    const r = rng(7);
    const boxes: (Aabb | null)[] = [];
    for (let i = 0; i < 600; i++) {
      const min: [number, number, number] = [r() * 2000, r() * 200, r() * 2000];
      boxes.push(i % 50 === 0 ? null : { min, max: [min[0] + r() * 100, min[1] + r() * 50, min[2] + r() * 100] });
    }
    const tree = new AabbTree(boxes);
    for (let q = 0; q < 200; q++) {
      const min: [number, number, number] = [r() * 2000, r() * 200, r() * 2000];
      const query = { min, max: [min[0] + r() * 300, min[1] + r() * 100, min[2] + r() * 300] as [number, number, number] };
      const brute = boxes.flatMap((b, i) => (b && boxesTouch(b, query) ? [i] : []));
      expect(tree.near(query).sort((a, b) => a - b)).toEqual(brute);
    }
  });

  it('counts touching faces as near (within eps)', () => {
    const tree = new AabbTree([{ min: [0, 0, 0], max: [16, 16, 16] }]);
    expect(tree.near({ min: [16, 0, 0], max: [32, 16, 16] })).toEqual([0]);
    expect(tree.near({ min: [16.5, 0, 0], max: [32, 16, 16] })).toEqual([]);
    expect(tree.near({ min: [16.0005, 0, 0], max: [32, 16, 16] }, 0.001)).toEqual([0]);
  });

  it('handles an empty list', () => {
    expect(new AabbTree([]).near({ min: [0, 0, 0], max: [1, 1, 1] })).toEqual([]);
  });
});

describe('performance (one core; generous limits so slow machines pass)', () => {
  it('meshes 2,000 floor tiles with hidden-face removal quickly', () => {
    const tiles = [];
    for (let i = 0; i < 50; i++) for (let j = 0; j < 40; j++) tiles.push(box([i * 64, 0, j * 64], [i * 64 + 64, 16, j * 64 + 64]));
    const t = performance.now();
    const m = buildMesh(tiles, { cullTouchingFaces: true });
    const ms = performance.now() - t;
    // Only the outer ring of side faces and every top/bottom survive.
    const sideFaces = 2 * 50 + 2 * 40;
    expect(m.indices.length / 6).toBe(2000 * 2 + sideFaces);
    expect(ms).toBeLessThan(2000);
  });
});
