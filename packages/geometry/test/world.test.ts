import { describe, expect, it } from 'vitest';
import { bakeSubtract, box, buildWorld, containsPoint, hollowBox, translate, validate, volume, type Brush, type V3, type WorldBrush } from '../src';

const close = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const inAny = (bs: Brush[], p: V3) => bs.some((b) => containsPoint(b, p, -1e-6));

describe('buildWorld (live subtract)', () => {
  const wall: WorldBrush = { id: 'wall', role: 'solid', brush: box([0, 0, 0], [16, 256, 512]) };
  const door: WorldBrush = { id: 'door', role: 'subtract', brush: box([-8, 0, 192], [24, 128, 320]) };

  it('cuts solids that overlap a subtract brush and leaves the authored brush alone', () => {
    const before = JSON.stringify(wall.brush);
    const w = buildWorld([wall, door]);
    expect(w.solids).toHaveLength(1);
    expect(w.solids[0]!.cutBy).toEqual(['door']);
    expect(inAny(w.solids[0]!.pieces, [8, 64, 256])).toBe(false);
    expect(inAny(w.solids[0]!.pieces, [8, 200, 256])).toBe(true);
    expect(JSON.stringify(wall.brush)).toBe(before);
  });

  it('moving the doorway re-cuts in the new place', () => {
    const moved = { ...door, brush: translate(door.brush, [0, 0, 128]) };
    const pieces = buildWorld([wall, moved]).solids[0]!.pieces;
    expect(inAny(pieces, [8, 64, 256])).toBe(true);
    expect(inAny(pieces, [8, 64, 384])).toBe(false);
  });

  it('subtract brushes never appear as geometry and don’t cut each other', () => {
    const w = buildWorld([door, { id: 'd2', role: 'subtract', brush: box([0, 0, 0], [64, 64, 64]) }]);
    expect(w.solids).toEqual([]);
  });

  it('several doors cut the same wall', () => {
    const d2: WorldBrush = { id: 'door2', role: 'subtract', brush: box([-8, 0, 384], [24, 128, 448]) };
    const s = buildWorld([wall, door, d2]).solids[0]!;
    expect(s.cutBy.sort()).toEqual(['door', 'door2']);
    expect(inAny(s.pieces, [8, 64, 400])).toBe(false);
    close(s.pieces.reduce((t, p) => t + volume(p), 0), volume(wall.brush) - 16 * 128 * 128 - 16 * 128 * 64);
  });

  it('bake returns replacement pieces only for the solids that were cut', () => {
    const other: WorldBrush = { id: 'floor', role: 'solid', brush: box([0, -16, 0], [512, 0, 512]) };
    const { replace } = bakeSubtract([wall, other, door], ['door']);
    expect([...replace.keys()]).toEqual(['wall']);
    for (const p of replace.get('wall')!) expect(validate(p)).toEqual([]);
  });
});

describe('hollowBox', () => {
  it('turns a 512 × 256 × 512 block into six walls 16 units thick', () => {
    const walls = hollowBox([0, 0, 0], [512, 256, 512], 16);
    expect(walls).toHaveLength(6);
    for (const w of walls) expect(validate(w)).toEqual([]);
    const total = walls.reduce((t, w) => t + volume(w), 0);
    close(total, 512 * 256 * 512 - 480 * 224 * 480);
    expect(inAny(walls, [256, 128, 256])).toBe(false);
    expect(inAny(walls, [8, 128, 256])).toBe(true);
  });

  it('refuses walls thicker than the room', () => {
    expect(() => hollowBox([0, 0, 0], [16, 64, 64], 16)).toThrow();
  });

  it('outward keeps the block as the inside of the room', () => {
    const walls = hollowBox([0, 0, 0], [512, 256, 512], 16, undefined, 'outward');
    expect(walls).toHaveLength(6);
    for (const w of walls) expect(validate(w)).toEqual([]);
    const total = walls.reduce((t, w) => t + volume(w), 0);
    close(total, 544 * 288 * 544 - 512 * 256 * 512);
    // The whole drawn block is empty; the walls start just outside it.
    expect(inAny(walls, [1, 1, 1])).toBe(false);
    expect(inAny(walls, [511, 255, 511])).toBe(false);
    expect(inAny(walls, [-8, 128, 256])).toBe(true);
    expect(inAny(walls, [256, 264, 256])).toBe(true);
  });

  it('outward works even when the block is thinner than two walls', () => {
    const walls = hollowBox([0, 0, 0], [16, 64, 64], 16, undefined, 'outward');
    for (const w of walls) expect(validate(w)).toEqual([]);
    expect(inAny(walls, [8, 32, 32])).toBe(false);
  });
});
