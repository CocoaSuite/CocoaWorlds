import { describe, expect, it } from 'vitest';
import { autoProbes, box, type Brush, type V3 } from '../src';

/** A closed room (16 u walls) from `a` to `b` (inside air), with optional holes cut by leaving wall pieces out. */
function room(a: V3, b: V3): Brush[] {
  const t = 16;
  return [
    box([a[0] - t, a[1] - t, a[2] - t], [b[0] + t, a[1], b[2] + t]), // floor
    box([a[0] - t, b[1], a[2] - t], [b[0] + t, b[1] + t, b[2] + t]), // roof
    box([a[0] - t, a[1], a[2] - t], [a[0], b[1], b[2] + t]),
    box([b[0], a[1], a[2] - t], [b[0] + t, b[1], b[2] + t]),
    box([a[0], a[1], a[2] - t], [b[0], b[1], a[2]]),
    box([a[0], a[1], b[2]], [b[0], b[1], b[2] + t]),
  ];
}

describe('autoProbes', () => {
  it('finds a closed room as one box', () => {
    const p = autoProbes(room([0, 0, 0], [256, 128, 256]));
    expect(p).toHaveLength(1);
    expect(p[0]!.min).toEqual([0, 0, 0]);
    expect(p[0]!.max).toEqual([256, 128, 256]);
  });

  it('splits two rooms joined by a doorway and ignores open ground', () => {
    // Two rooms side by side sharing the wall at x 256..272, with a 64 u doorway through it.
    const a = room([0, 0, 0], [256, 128, 256]);
    const b = room([272, 0, 0], [528, 128, 256]);
    const wall = (bs: Brush[]) => bs.filter((x, i) => i !== 3);
    const level = [...wall(a), ...b.filter((x, i) => i !== 2), box([256, 0, -16], [272, 128, 96]), box([256, 0, 160], [272, 128, 272]), box([256, 96, 96], [272, 128, 160])];
    level.push(box([-1024, -64, -1024], [1600, -16, 1600])); // ground outside
    const p = autoProbes(level);
    expect(p).toHaveLength(2);
    const xs = p.map((x) => [x.min[0], x.max[0]]).sort((u, v) => u[0]! - v[0]!);
    expect(xs[0]![1]).toBeLessThanOrEqual(272);
    expect(xs[1]![0]).toBeGreaterThanOrEqual(256);
  });

  it('cuts a long hall', () => {
    const p = autoProbes(room([0, 0, 0], [2048, 128, 256]));
    expect(p.length).toBe(2);
  });
});
