import { describe, expect, it } from 'vitest';
import { box, defaultSurface, faceExtent, hotspotSurface, polygons, uvAt } from '../src';

describe('hotspot mapping', () => {
  const rects = [
    { x: 0, y: 0, w: 1, h: 0.25 },
    { x: 0, y: 0.25, w: 0.5, h: 0.5 },
  ];
  it('fits each face exactly into the rectangle matching its shape', () => {
    // 256 × 64 × 64: the long faces (4:1) take the strip, the square ends take the square.
    const b = box([0, 0, 0], [256, 64, 64], { ...defaultSurface(), material: 'mat/x' });
    const out = hotspotSurface(b, b.faces.map((_, i) => i), rects, [256, 256]);
    for (const poly of polygons(out)) {
      const uv = poly.points.map((p) => uvAt(p, poly.plane, poly.surface).map((t) => t / 256));
      const us = uv.map((p) => p[0]!), vs = uv.map((p) => p[1]!);
      const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
      const long = Math.max(u1 - u0, v1 - v0) > 0.75;
      const r = long ? rects[0]! : rects[1]!;
      expect(u0).toBeCloseTo(r.x, 5);
      expect(v0).toBeCloseTo(r.y, 5);
      expect(Math.max(u1 - u0, v1 - v0)).toBeCloseTo(Math.max(r.w, r.h), 5);
    }
    expect(faceExtent(out, 0)).not.toBeNull();
  });
});
