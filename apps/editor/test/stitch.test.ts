// Stitching build pieces: touching boxes become one outside, with no faces between them.
import { describe, expect, it } from 'vitest';
import { stitch } from '../src/renderer/viewport/stitch';

const quads = (g: ReturnType<typeof stitch>) => g.getIndex()!.count / 6;

describe('stitching build pieces', () => {
  it('one box: six sides', () => {
    expect(quads(stitch([{ min: [0, 0, 0], max: [1, 1, 1] }]))).toBe(6);
  });

  it('two boxes side by side: still six sides (no face between them, long sides merged)', () => {
    expect(quads(stitch([{ min: [0, 0, 0], max: [1, 1, 1] }, { min: [1, 0, 0], max: [2, 1, 1] }]))).toBe(6);
  });

  it('a wall on a floor: one outside, the floor top split round the wall', () => {
    const g = stitch([{ min: [0, 0, 0], max: [96, 6, 96] }, { min: [0, 6, 0], max: [96, 102, 8] }]);
    // (Every face points out: no normals inside the join.)
    const n = g.getAttribute('normal'), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i) === 6 && n.getY(i) === -1).toBe(false);
    expect(quads(g)).toBe(10);
  });

  it('boxes far apart stay apart', () => {
    expect(quads(stitch([{ min: [0, 0, 0], max: [1, 1, 1] }, { min: [10, 0, 0], max: [11, 1, 1] }]))).toBe(12);
  });
});
