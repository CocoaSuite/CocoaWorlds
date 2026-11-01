import { describe, expect, it } from 'vitest';
import {
  bounds,
  box,
  containsPoint,
  cylinder,
  defaultSurface,
  edges,
  fromData,
  polygons,
  prism,
  stairs,
  toData,
  validate,
  vertices,
  volume,
  wedge,
  type Brush,
} from '../src';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe('box', () => {
  const b = box([0, 0, 0], [512, 256, 512]);
  it('has 8 corners, 12 edges and 6 faces', () => {
    expect(vertices(b)).toHaveLength(8);
    expect(edges(b).edges).toHaveLength(12);
    expect(polygons(b)).toHaveLength(6);
  });
  it('has the right volume and bounds (the 512 × 512 × 256 room from the brief)', () => {
    close(volume(b), 512 * 512 * 256, 1e-3);
    expect(bounds(b)).toEqual({ min: [0, 0, 0], max: [512, 256, 512] });
  });
  it('accepts corners in any order', () => {
    close(volume(box([10, 5, 3], [-2, 1, -7])), 12 * 4 * 10, 1e-6);
  });
  it('face polygons wind counter-clockwise seen from outside', () => {
    for (const p of polygons(b)) {
      const [a, c, d] = p.points;
      const n = [
        (c![1] - a![1]) * (d![2] - a![2]) - (c![2] - a![2]) * (d![1] - a![1]),
        (c![2] - a![2]) * (d![0] - a![0]) - (c![0] - a![0]) * (d![2] - a![2]),
        (c![0] - a![0]) * (d![1] - a![1]) - (c![1] - a![1]) * (d![0] - a![0]),
      ];
      expect(n[0]! * p.plane.n[0] + n[1]! * p.plane.n[1] + n[2]! * p.plane.n[2]).toBeGreaterThan(0);
    }
  });
  it('is valid', () => expect(validate(b)).toEqual([]));
});

describe('other primitives', () => {
  it('cylinder has the requested number of sides and integer-ish corners', () => {
    const c = cylinder([-64, 0, -64], [64, 128, 64], 12);
    expect(polygons(c)).toHaveLength(14);
    expect(vertices(c)).toHaveLength(24);
    expect(validate(c)).toEqual([]);
    // Volume between the inscribed polygon area and the circle.
    const v = volume(c);
    expect(v).toBeLessThan(Math.PI * 64 * 64 * 128);
    expect(v).toBeGreaterThan(0.95 * Math.PI * 64 * 64 * 128);
  });

  it('wedge is half a box in every facing', () => {
    for (const f of [0, 90, 180, 270] as const) {
      const w = wedge([0, 0, 0], [128, 64, 256], f);
      expect(validate(w)).toEqual([]);
      close(volume(w), (128 * 64 * 256) / 2, 1e-3);
      expect(vertices(w)).toHaveLength(6);
    }
  });

  it('wedge slopes down toward its facing side', () => {
    const w = wedge([0, 0, 0], [128, 64, 256], 0);
    expect(containsPoint(w, [64, 60, 4])).toBe(true); // high at the back (−Z)
    expect(containsPoint(w, [64, 60, 250])).toBe(false); // low at the front (+Z)
  });

  it('prism works with either winding of its footprint', () => {
    const tri: [number, number][] = [
      [0, 0],
      [128, 0],
      [0, 128],
    ];
    for (const fp of [tri, [...tri].reverse()]) {
      const p = prism(fp, 0, 64);
      expect(validate(p)).toEqual([]);
      close(volume(p), (128 * 128) / 2 * 64, 1e-3);
    }
  });

  it('stairs are non-overlapping columns that climb to the full height', () => {
    const s = stairs([0, 0, 0], [64, 128, 256], 8, 0);
    expect(s).toHaveLength(8);
    const total = s.reduce((t, b) => t + volume(b), 0);
    // Columns of heights 16, 32, … 128, each 32 deep and 64 wide.
    close(total, 64 * 32 * (16 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8)), 1e-3);
    const tops = s.map((b) => bounds(b)!.max[1]);
    expect(tops).toEqual([16, 32, 48, 64, 80, 96, 112, 128]);
    // Lowest step is at the +Z end.
    expect(bounds(s[0]!)!.max[2]).toBe(256);
  });
});

describe('serialization', () => {
  it('round-trips grid brushes exactly', () => {
    const b = box([0, 0, 0], [512, 256, 512]);
    const back = fromData(JSON.parse(JSON.stringify(toData(b))));
    expect(vertices(back).map(String).sort()).toEqual(vertices(b).map(String).sort());
  });

  it('stores three points per face that are integers for grid brushes', () => {
    const d = toData(box([16, 0, -32], [64, 128, 32]));
    for (const f of d.faces) for (const p of f.points) for (const c of p) expect(Number.isInteger(c)).toBe(true);
  });

  it('keeps per-face surfaces', () => {
    const b: Brush = box([0, 0, 0], [64, 64, 64]);
    b.faces[2]!.surface = { ...defaultSurface('concrete'), offset: [8, 4], rotation: 90, align: 'face' };
    const back = fromData(JSON.parse(JSON.stringify(toData(b))));
    const top = back.faces.find((f) => f.plane.n[1] > 0.9)!;
    expect(top.surface).toMatchObject({ material: 'concrete', offset: [8, 4], rotation: 90, align: 'face' });
  });

  it('a cylinder survives many save/load cycles without drifting', () => {
    let c = cylinder([-100, 0, -100], [100, 64, 100], 24);
    const v0 = volume(c);
    for (let i = 0; i < 20; i++) c = fromData(JSON.parse(JSON.stringify(toData(c))));
    close(volume(c), v0, 0.5);
    expect(validate(c)).toEqual([]);
  });
});

describe('validation', () => {
  it('flags slivers', () => {
    expect(validate(box([0, 0, 0], [64, 0.1, 64]))).toContain('too-thin');
  });
  it('flags open solids', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    b.faces.pop();
    expect(validate(b)).not.toEqual([]);
  });
});
