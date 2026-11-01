import { describe, expect, it } from 'vitest';
import {
  box,
  buildMesh,
  carve,
  clipBrush,
  composeM4,
  containsPoint,
  fromData,
  loopCut,
  moveVertices,
  polygons,
  toData,
  toEditMesh,
  transform,
  translate,
  tryConvex,
  validate,
  vertices,
  volume,
  type V3,
} from '../src';

const at = (b: ReturnType<typeof box>, p: V3) => vertices(b).findIndex((q) => q.every((x, k) => Math.abs(x - p[k]!) < 1e-6));

describe('edited meshes (G4)', () => {
  it('a convex brush round-trips through a mesh unchanged', () => {
    const b = box([0, 0, 0], [64, 32, 16]);
    const m = toEditMesh(b);
    expect(m.mesh.verts).toHaveLength(8);
    expect(m.mesh.polys).toHaveLength(6);
    expect(volume(m)).toBeCloseTo(64 * 32 * 16);
    const back = tryConvex(m)!;
    expect(back.mesh).toBeUndefined();
    expect(volume(back)).toBeCloseTo(64 * 32 * 16);
  });

  it('pushing a corner in makes a dented, closed mesh with triangles where faces bent', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const r = moveVertices(b, new Map([[at(b, [64, 64, 64]), [32, 32, 32]]]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mesh).toBe(true);
    expect(r.splitFaces).toBe(3);
    expect(validate(r.brush)).toEqual([]);
    // Every polygon is flat (and a triangle where it bent).
    for (const p of polygons(r.brush)) for (const x of p.points) expect(Math.abs(p.plane.n[0] * x[0] + p.plane.n[1] * x[1] + p.plane.n[2] * x[2] - p.plane.d)).toBeLessThan(1e-6);
    // The dent: a cube minus a tetrahedron-ish corner.
    expect(volume(r.brush)).toBeLessThan(64 ** 3);
    expect(volume(r.brush)).toBeGreaterThan(64 ** 3 / 2);
    // Inside test works on the dented shape.
    expect(containsPoint(r.brush, [8, 8, 8])).toBe(true);
    expect(containsPoint(r.brush, [60, 60, 60])).toBe(false);
  });

  it('moving it back out turns it into a normal brush again', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const i = at(b, [64, 64, 64]);
    const r = moveVertices(b, new Map([[i, [32, 32, 32]]]));
    if (!r.ok) throw new Error('refused');
    const j = vertices(r.brush).findIndex((q) => q[0] === 32 && q[1] === 32 && q[2] === 32);
    const back = moveVertices(r.brush, new Map([[j, [64, 64, 64]]]));
    expect(back.ok && back.mesh).toBe(false);
    if (back.ok) expect(volume(back.brush)).toBeCloseTo(64 ** 3);
  });

  it('only a shape with no volume is refused', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const moves = new Map<number, V3>();
    vertices(b).forEach((p, i) => moves.set(i, [p[0], 0, p[2]]));
    expect(moveVertices(b, moves)).toEqual({ ok: false, reason: 'collapsed' });
  });

  it('saves and loads, moves and transforms with its corners', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const r = moveVertices(b, new Map([[at(b, [64, 64, 64]), [40, 40, 40]]]));
    if (!r.ok) throw new Error('refused');
    const data = JSON.parse(JSON.stringify(toData(r.brush)));
    expect(data.mesh.polys).toHaveLength(data.faces.length);
    const loaded = fromData(data);
    expect(loaded.mesh).toBeDefined();
    expect(volume(loaded)).toBeCloseTo(volume(r.brush), 3);
    expect(volume(translate(loaded, [100, 0, 0]))).toBeCloseTo(volume(loaded), 3);
    expect(vertices(translate(loaded, [100, 0, 0])).some((v) => v[0] === 140)).toBe(true);
    const mirrored = transform(loaded, composeM4([0, 0, 0], [0, 0, 0], [-1, 1, 1]));
    expect(volume(mirrored)).toBeCloseTo(volume(loaded), 3);
    expect(validate(mirrored)).toEqual([]);
  });

  it('is drawn like any brush', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const r = moveVertices(b, new Map([[at(b, [64, 64, 64]), [32, 32, 32]]]));
    if (!r.ok) throw new Error('refused');
    const m = buildMesh([r.brush]);
    expect(m.indices.length / 3).toBe(3 * 2 + 3 * 2); // three untouched quads, six triangles
  });

  it('is not carved or clipped', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const r = moveVertices(b, new Map([[at(b, [64, 64, 64]), [32, 32, 32]]]));
    if (!r.ok) throw new Error('refused');
    expect(carve(r.brush, box([10, 10, 10], [20, 20, 20]))).toEqual([r.brush]);
    expect(clipBrush(r.brush, { n: [1, 0, 0], d: 16 }).cut).toBe(false);
  });
});

describe('loop cut', () => {
  it('one cut around a box splits the four side faces in two', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    // A vertical edge: the ring runs horizontally around the box.
    const r = loopCut(b, [0, 0, 0], [0, 64, 0], 1)!;
    expect(r).not.toBeNull();
    expect(r.brush.mesh!.verts).toHaveLength(12);
    expect(r.brush.mesh!.polys).toHaveLength(10);
    expect(r.lines).toHaveLength(4);
    for (const [a, c] of r.lines) {
      expect(a[1]).toBeCloseTo(32);
      expect(c[1]).toBeCloseTo(32);
    }
    expect(validate(r.brush)).toEqual([]);
    expect(volume(r.brush)).toBeCloseTo(64 ** 3);
    // The extra corners are kept (not folded back into a plain box).
    expect(tryConvex(r.brush)).toBeNull();
  });

  it('several cuts space evenly; then the new ring can be pulled out', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const r = loopCut(b, [0, 0, 0], [64, 0, 0], 3)!;
    const xs = [...new Set(r.lines.map(([a]) => Math.round(a[0])))].sort((p, q) => p - q);
    expect(xs).toEqual([16, 32, 48]);
    // Pull the middle ring outward: a bulge.
    const vs = vertices(r.brush);
    const moves = new Map<number, V3>();
    vs.forEach((v, i) => {
      if (Math.abs(v[0] - 32) < 1e-6) moves.set(i, [32, v[1] < 32 ? v[1] - 16 : v[1] + 16, v[2] < 32 ? v[2] - 16 : v[2] + 16]);
    });
    const m = moveVertices(r.brush, moves);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(validate(m.brush)).toEqual([]);
      expect(volume(m.brush)).toBeGreaterThan(64 ** 3);
    }
  });

  it('works on an edited mesh and stops at triangles', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const dented = moveVertices(b, new Map([[at(b, [64, 64, 64]), [48, 48, 48]]]));
    if (!dented.ok) throw new Error('refused');
    const r = loopCut(dented.brush, [0, 0, 0], [0, 64, 0], 1);
    expect(r).not.toBeNull();
    expect(validate(r!.brush)).toEqual([]);
    expect(volume(r!.brush)).toBeCloseTo(volume(dented.brush), 3);
  });
});

describe('COL (invisible collider)', () => {
  it('never hides a visible face pressed against it, but hides COL against COL', async () => {
    const { buildMesh: build, box: mk, defaultSurface: surf, COLLIDER_MATERIAL } = await import('../src');
    const wall = mk([0, 0, 0], [64, 64, 64], surf('dev/grid'));
    const col = mk([64, 0, 0], [128, 64, 64], surf(COLLIDER_MATERIAL));
    // Wall's +X face touches COL's −X face: the wall face stays (6), COL's face is still hidden by the wall (5).
    expect(build([wall, col], { cullTouchingFaces: true }).indices.length / 3).toBe((6 + 5) * 2);
    const col2 = mk([128, 0, 0], [192, 64, 64], surf(COLLIDER_MATERIAL));
    expect(build([col, col2], { cullTouchingFaces: true }).indices.length / 3).toBe((5 + 5) * 2);
  });
});
