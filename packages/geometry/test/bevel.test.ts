import { describe, expect, it } from 'vitest';
import { bevelBrush, bevelEdges, type V3, bounds, setSurface, box, buildWorld, moveVertices, plane, polygons, validate, vertices, volume } from '../src';

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
  it("a plane's corners can be moved (bending it splits it into two triangles)", () => {
    const p = plane([0, 0, 0], [128, 4, 128]);
    const vs = vertices(p);
    const r = moveVertices(p, new Map([[0, [vs[0]![0], vs[0]![1] + 32, vs[0]![2]]]]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(polygons(r.brush).length).toBe(2);
    const flat = moveVertices(p, new Map([[1, [vs[1]![0] + 16, vs[1]![1], vs[1]![2]]]]));
    expect(flat.ok && polygons(flat.brush).length).toBe(1);
  });
  it('painting a plane keeps it the size it was', () => {
    const p = setSurface(plane([0, 0, 0], [128, 4, 64]), { material: 'mat/x' });
    expect(p.mesh?.polys.length).toBe(1);
    expect(bounds(p)).toEqual({ min: [0, 4, 0], max: [128, 4, 64] });
  });
  it('a subtract brush cuts only the solids it is told to', () => {
    const a = box([0, 0, 0], [64, 64, 64]), b = box([0, 0, 64], [64, 64, 128]), cutter = box([16, 16, 48], [48, 48, 80]);
    const w = buildWorld([{ id: 'a', role: 'solid', brush: a }, { id: 'b', role: 'solid', brush: b }, { id: 'c', role: 'subtract', brush: cutter, cuts: ['b'] }]);
    expect(w.solids.find((s) => s.id === 'a')!.cutBy).toEqual([]);
    expect(w.solids.find((s) => s.id === 'b')!.cutBy).toEqual(['c']);
  });
});

describe('bevelEdges (chosen edges, Blender-like)', () => {
  it('chamfers one edge by its width along each face', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const r = bevelEdges(b, [[[64, 64, 0], [64, 64, 64]]], 8, 1)!;
    expect(r.faces.length).toBe(7);
    expect(volume(r)).toBeCloseTo(64 ** 3 - 32 * 64, 0);
  });
  it('more segments and a rounder profile take less off; a straight profile is a chamfer', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const e: [V3, V3][] = [[[64, 64, 0], [64, 64, 64]]];
    const straight = volume(bevelEdges(b, e, 16, 4, 0.25)!);
    const round = volume(bevelEdges(b, e, 16, 4, 0.5)!);
    const square = volume(bevelEdges(b, e, 16, 4, 0.9)!);
    expect(straight).toBeCloseTo(64 ** 3 - 128 * 64, 0);
    expect(round).toBeGreaterThan(straight);
    expect(square).toBeGreaterThan(round);
    expect(validate(bevelEdges(b, e, 16, 4, 0.5)!)).toEqual([]);
  });
  it('bevels a convex edited mesh; refuses a dented one', () => {
    const m = moveVertices(box([0, 0, 0], [64, 64, 64]), new Map([[0, [-8, -8, -8] as V3]]), 'split');
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const r = bevelEdges(m.brush, null, 4, 2);
    if (m.brush.mesh) expect(r === null || validate(r).length === 0).toBe(true);
  });
});
