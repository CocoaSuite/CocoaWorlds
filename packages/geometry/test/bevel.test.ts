import { describe, expect, it } from 'vitest';
import { bevelBrush, box, buildWorld, plane, polygons, validate, volume } from '../src';

describe('bevel, plane, chosen cuts', () => {
  it('bevels a box: more faces, a little less volume, still valid', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const r = bevelBrush(b, 8, 3);
    expect(r.faces.length).toBe(6 + 12 * 3);
    expect(volume(r)).toBeLessThan(volume(b));
    expect(volume(r)).toBeGreaterThan(volume(b) * 0.9);
    expect(validate(r)).toEqual([]);
  });
  it('a plane is one face', () => {
    const p = plane([0, 0, 0], [128, 4, 64]);
    const ps = polygons(p);
    expect(ps.length).toBe(1);
    expect(ps[0]!.plane.n).toEqual([0, 1, 0]);
  });
  it('a subtract brush cuts only the solids it is told to', () => {
    const a = box([0, 0, 0], [64, 64, 64]), b = box([0, 0, 64], [64, 64, 128]), cutter = box([16, 16, 48], [48, 48, 80]);
    const w = buildWorld([{ id: 'a', role: 'solid', brush: a }, { id: 'b', role: 'solid', brush: b }, { id: 'c', role: 'subtract', brush: cutter, cuts: ['b'] }]);
    expect(w.solids.find((s) => s.id === 'a')!.cutBy).toEqual([]);
    expect(w.solids.find((s) => s.id === 'b')!.cutBy).toEqual(['c']);
  });
});
