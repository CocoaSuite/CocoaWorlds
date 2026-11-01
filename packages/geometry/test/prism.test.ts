import { describe, expect, it } from 'vitest';
import { bounds, containsPoint, convexHull2D, extrudePolygon, polygons, toData, validate, volume } from '../src';

const TOP = { a: 0, b: 2, e: 1 } as const;
const FRONT = { a: 0, b: 1, e: 2 } as const;
const SIDE = { a: 2, b: 1, e: 0 } as const;

describe('convexHull2D', () => {
  it('drops inner and collinear points', () => {
    const hull = convexHull2D([[0, 0], [64, 0], [128, 0], [128, 128], [0, 128], [64, 64]]);
    expect(hull).toHaveLength(4);
  });
  it('fills in a dent', () => {
    const hull = convexHull2D([[0, 0], [100, 0], [50, 30], [100, 100], [0, 100]]);
    expect(hull.some(([x, y]) => x === 50 && y === 30)).toBe(false);
  });
});

describe('extrudePolygon', () => {
  it('makes a triangle prism in the top view, any winding', () => {
    for (const pts of [[[0, 0], [128, 0], [0, 128]], [[0, 0], [0, 128], [128, 0]]] as [number, number][][]) {
      const b = extrudePolygon(pts, TOP, 0, 64);
      expect(validate(b)).toEqual([]);
      expect(polygons(b)).toHaveLength(5);
      expect(volume(b)).toBeCloseTo((128 * 128) / 2 * 64, 3);
      expect(containsPoint(b, [20, 32, 20])).toBe(true);
      expect(containsPoint(b, [100, 32, 100])).toBe(false);
    }
  });

  it('makes a hexagon column drawn in the front view (depth along Z)', () => {
    const hex: [number, number][] = [[0, 64], [32, 0], [96, 0], [128, 64], [96, 128], [32, 128]];
    const b = extrudePolygon(hex, FRONT, -32, 32);
    expect(validate(b)).toEqual([]);
    expect(polygons(b)).toHaveLength(8);
    expect(bounds(b)).toEqual({ min: [0, 0, -32], max: [128, 128, 32] });
  });

  it('side view extrudes along X', () => {
    const b = extrudePolygon([[0, 0], [64, 0], [32, 64]], SIDE, 10, 20);
    expect(bounds(b)).toEqual({ min: [10, 0, 0], max: [20, 64, 64] });
  });

  it('saves with exact integer points for grid input', () => {
    const b = extrudePolygon([[0, 0], [128, 0], [64, 96]], TOP, 0, 32);
    for (const f of toData(b).faces) for (const p of f.points) for (const c of p) expect(Number.isInteger(c)).toBe(true);
  });

  it('refuses outlines in a line, or no depth', () => {
    expect(() => extrudePolygon([[0, 0], [64, 0], [128, 0]], TOP, 0, 16)).toThrow();
    expect(() => extrudePolygon([[0, 0], [64, 0], [0, 64]], TOP, 8, 8)).toThrow();
  });
});
