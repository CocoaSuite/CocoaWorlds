import { describe, expect, it } from 'vitest';
import {
  box,
  buildMesh,
  carve,
  carveDetailed,
  SLIVER_VOLUME,
  composeM4,
  containsPoint,
  cylinder,
  defaultSurface,
  intersect,
  mergeAll,
  mergeConvex,
  moveVertices,
  overlaps,
  polygons,
  pushFace,
  split,
  transform,
  translate,
  uvAt,
  validate,
  vertices,
  volume,
  type Brush,
  type V3,
} from '../src';

const close = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const inAny = (bs: Brush[], p: V3) => bs.some((b) => containsPoint(b, p, -1e-6));

/** Deterministic pseudo-random points for property checks. */
function* samples(n: number, min: V3, max: V3) {
  let s = 12345;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) yield [min[0] + r() * (max[0] - min[0]), min[1] + r() * (max[1] - min[1]), min[2] + r() * (max[2] - min[2])] as V3;
}

describe('translate and transform', () => {
  it('moves brushes exactly', () => {
    const b = translate(box([0, 0, 0], [64, 64, 64]), [16, 32, -48]);
    expect(vertices(b).some((p) => p[0] === 16 && p[1] === 32 && p[2] === -48)).toBe(true);
  });

  it('texture lock keeps texels glued to the surface', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const top = b.faces.find((f) => f.plane.n[1] > 0.9)!;
    const corner: V3 = [0, 64, 0];
    const before = uvAt(corner, top.plane, top.surface);
    const moved = translate(b, [24, 0, 40]);
    const top2 = moved.faces.find((f) => f.plane.n[1] > 0.9)!;
    const after = uvAt([24, 64, 40], top2.plane, top2.surface);
    close(after[0], before[0]);
    close(after[1], before[1]);
  });

  it('rotation keeps volume and validity; mirroring keeps faces pointing out', () => {
    const b = box([0, 0, 0], [128, 64, 32]);
    const r = transform(b, composeM4([0, 0, 0], [0, 37, 0], [1, 1, 1]));
    close(volume(r), volume(b));
    expect(validate(r)).toEqual([]);
    const m = transform(b, composeM4([0, 0, 0], [0, 0, 0], [-1, 1, 1]));
    close(volume(m), volume(b));
    expect(validate(m)).toEqual([]);
  });

  it('non-uniform scale scales volume', () => {
    const b = cylinder([-32, 0, -32], [32, 64, 32], 8);
    const s = transform(b, composeM4([0, 0, 0], [0, 0, 0], [2, 0.5, 1]));
    close(volume(s), volume(b) * 1, 0.01);
  });
});

describe('split', () => {
  it('divides volume exactly and puts the cap surface on both halves', () => {
    const b = box([0, 0, 0], [128, 64, 64]);
    const { front, back } = split(b, { n: [1, 0, 0], d: 40 }, defaultSurface('cap'));
    close(volume(front!) + volume(back!), volume(b));
    close(volume(front!), 88 * 64 * 64);
    expect(front!.faces.some((f) => f.surface.material === 'cap')).toBe(true);
    expect(back!.faces.some((f) => f.surface.material === 'cap')).toBe(true);
  });
  it('returns the whole brush on one side when the plane misses', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    expect(split(b, { n: [1, 0, 0], d: 100 }, defaultSurface()).back).toBe(b);
    // A plane lying on a face does not cut.
    const r = split(b, { n: [1, 0, 0], d: 64 }, defaultSurface());
    expect(r.back).toBe(b);
    expect(r.front).toBeNull();
  });
});

describe('carve (subtract)', () => {
  const wall = box([0, 0, 0], [16, 256, 512], defaultSurface('concrete'));
  const door = box([-8, 0, 192], [24, 128, 320], defaultSurface('cutter'));

  it('cuts a doorway: three valid pieces whose volume is the wall minus the opening', () => {
    const pieces = carve(wall, door);
    expect(pieces.length).toBe(3);
    for (const p of pieces) expect(validate(p)).toEqual([]);
    const total = pieces.reduce((t, p) => t + volume(p), 0);
    close(total, volume(wall) - 16 * 128 * 128);
  });

  it('leaves the opening empty and everything else solid', () => {
    const pieces = carve(wall, door);
    for (const p of samples(2000, [0.01, 0.01, 0.01], [15.99, 255.99, 511.99])) {
      const inDoor = p[1] < 128 && p[2] > 192 && p[2] < 320;
      expect(inAny(pieces, p)).toBe(!inDoor);
    }
  });

  it('pieces never overlap each other', () => {
    const pieces = carve(wall, door);
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) expect(overlaps(pieces[i]!, pieces[j]!)).toBe(false);
  });

  it('new faces take the wall material, not the cutter material', () => {
    const pieces = carve(wall, door);
    for (const p of pieces) for (const f of p.faces) expect(f.surface.material).toBe('concrete');
  });

  it('keeps textures continuous across the cut (world alignment)', () => {
    const pieces = carve(wall, door);
    const outside = (b: Brush) => b.faces.find((f) => f.plane.n[0] > 0.9 && Math.abs(f.plane.d - 16) < 1e-6)!;
    const p0: V3 = [16, 200, 100];
    const refFace = outside(wall);
    const piece = pieces.find((b) => containsPoint(b, [8, 200, 100]))!;
    expect(uvAt(p0, outside(piece).plane, outside(piece).surface)).toEqual(uvAt(p0, refFace.plane, refFace.surface));
  });

  it('handles a cutter exactly as thick as the wall (coplanar faces)', () => {
    const flush = box([0, 0, 192], [16, 128, 320]);
    const pieces = carve(wall, flush);
    expect(pieces.length).toBe(3);
    close(pieces.reduce((t, p) => t + volume(p), 0), volume(wall) - 16 * 128 * 128);
  });

  it('a window (hole in the middle) leaves four pieces', () => {
    const win = box([-8, 96, 192], [24, 176, 320]);
    const pieces = carve(wall, win);
    expect(pieces.length).toBe(4);
    close(pieces.reduce((t, p) => t + volume(p), 0), volume(wall) - 16 * 80 * 128);
  });

  it('returns the target unchanged when they only touch or are apart', () => {
    const touching = box([16, 0, 0], [32, 64, 64]);
    expect(carve(wall, touching)).toEqual([wall]);
    expect(carve(wall, box([100, 0, 0], [200, 10, 10]))).toEqual([wall]);
  });

  it('returns nothing when the cutter swallows the target', () => {
    expect(carve(box([0, 0, 0], [8, 8, 8]), box([-1, -1, -1], [9, 9, 9]))).toEqual([]);
  });

  it('cuts with a rotated cutter and a cylinder', () => {
    const rotated = transform(box([-16, 0, -48], [16, 160, 48]), composeM4([8, 0, 256], [0, 30, 0], [1, 1, 1]));
    const a = carve(wall, rotated);
    for (const p of a) expect(validate(p)).toEqual([]);
    const i = intersect(wall, rotated)!;
    close(a.reduce((t, p) => t + volume(p), 0), volume(wall) - volume(i), 0.5);

    // A 16-sided column grazes the wall at shallow angles; hair-thin slivers (< 0.5 u thick, a few cubic
    // units) are removed and reported, everything else must be valid and add up.
    const col = cylinder([-32, 64, 224], [48, 200, 304], 16);
    const r = carveDetailed(wall, col);
    for (const p of r.pieces) expect(validate(p)).toEqual([]);
    expect(r.droppedSlivers).toBeLessThanOrEqual(2);
    close(r.pieces.reduce((t, p) => t + volume(p), 0), volume(wall) - volume(intersect(wall, col)!), 0.5 + r.droppedSlivers * SLIVER_VOLUME);
    // Convex neighbours are merged back, so far fewer than one piece per cutter face remain.
    expect(r.pieces.length).toBeLessThan(12);
  });

  it('numerically awkward inputs stay valid (off-grid cutter, tiny overlaps)', () => {
    const odd = box([-0.3333, 10.0001, 100.123], [16.7777, 99.9999, 200.987]);
    for (const p of carve(wall, odd)) expect(validate(p).filter((x) => x !== 'too-thin')).toEqual([]);
    const sliver = box([15.9995, 0, 0], [40, 64, 64]); // overlaps by 0.0005 — treated as touching
    expect(carve(wall, sliver)).toEqual([wall]);
  });
});

describe('intersect and merge', () => {
  it('intersect returns the overlap', () => {
    const i = intersect(box([0, 0, 0], [64, 64, 64]), box([32, 32, 32], [96, 96, 96]))!;
    close(volume(i), 32 * 32 * 32);
    expect(intersect(box([0, 0, 0], [8, 8, 8]), box([10, 0, 0], [20, 8, 8]))).toBeNull();
  });

  it('merges side-by-side boxes into one box', () => {
    const m = mergeConvex(box([0, 0, 0], [64, 64, 64]), box([64, 0, 0], [128, 64, 64]))!;
    expect(m).not.toBeNull();
    expect(polygons(m)).toHaveLength(6);
    close(volume(m), 128 * 64 * 64);
  });

  it('refuses an L shape (not convex)', () => {
    expect(mergeConvex(box([0, 0, 0], [64, 64, 64]), box([64, 0, 0], [128, 64, 32]))).toBeNull();
  });

  it('merges overlapping boxes that form a convex whole', () => {
    const m = mergeConvex(box([0, 0, 0], [96, 64, 64]), box([32, 0, 0], [128, 64, 64]))!;
    close(volume(m), 128 * 64 * 64);
  });

  it('carving then merging gives back the original wall', () => {
    const wall = box([0, 0, 0], [16, 256, 512]);
    const pieces = carve(wall, box([-8, 0, 192], [24, 128, 320]));
    const plug = box([0, 0, 192], [16, 128, 320]);
    const back = mergeAll([...pieces, plug]);
    expect(back).toHaveLength(1);
    close(volume(back[0]!), volume(wall));
  });
});

describe('face and vertex editing', () => {
  it('pushing a face resizes the brush', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const top = b.faces.findIndex((f) => f.plane.n[1] > 0.9);
    close(volume(pushFace(b, top, 32)!), 64 * 96 * 64);
    expect(pushFace(b, top, -64)).toBeNull();
  });

  it('moving one top corner up splits the bent top face into triangles', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const vs = vertices(b);
    const i = vs.findIndex((p) => p[0] === 64 && p[1] === 64 && p[2] === 64);
    const r = moveVertices(b, new Map([[i, [64, 96, 64] as V3]]), 'split');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.splitFaces).toBeGreaterThan(0);
      expect(validate(r.brush)).toEqual([]);
      expect(volume(r.brush)).toBeGreaterThan(volume(b));
    }
  });

  it('moving a whole top edge keeps faces flat (a ramp-like shape)', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const vs = vertices(b);
    const moves = new Map<number, V3>();
    vs.forEach((p, i) => {
      if (p[1] === 64 && p[2] === 64) moves.set(i, [p[0], 16, 64]);
    });
    const r = moveVertices(b, moves, 'reject');
    expect(r.ok).toBe(true);
    if (r.ok) close(volume(r.brush), 64 * 64 * 16 + (64 * 48 * 64) / 2);
  });

  it('a move that dents the brush makes an edited mesh (G4)', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const vs = vertices(b);
    const i = vs.findIndex((p) => p[0] === 64 && p[1] === 64 && p[2] === 64);
    const r = moveVertices(b, new Map([[i, [32, 32, 32] as V3]]), 'split');
    expect(r.ok && r.mesh).toBe(true);
  });
});

describe('mesh', () => {
  it('triangulates faces and groups them by material', () => {
    const a = box([0, 0, 0], [64, 64, 64], defaultSurface('a'));
    const b = box([64, 0, 0], [128, 64, 64], defaultSurface('b'));
    const m = buildMesh([a, b]);
    expect(m.indices.length / 3).toBe(24);
    expect(m.groups.map((g) => g.material).sort()).toEqual(['a', 'b']);
    expect(m.positions.length / 3).toBe(48);
  });

  it('hides faces pressed against each other', () => {
    const a = box([0, 0, 0], [64, 64, 64]);
    const b = box([64, 0, 0], [128, 64, 64]);
    expect(buildMesh([a, b], { cullTouchingFaces: true }).indices.length / 3).toBe(20);
    // Partially covered faces stay.
    const c = box([64, 0, 0], [128, 32, 64]);
    expect(buildMesh([a, c], { cullTouchingFaces: true }).indices.length / 3).toBe(22);
  });
});

describe('sphere primitive', () => {
  it('fits its box, is a valid convex brush, and gets rounder with more sides', async () => {
    const { sphere, bounds, validate, volume, vertices } = await import('../src');
    const s = sphere([-64, 0, -64], [64, 128, 64], 16);
    expect(validate(s)).toEqual([]);
    const b = bounds(s)!;
    expect(b.max[1]).toBeCloseTo(128, 3);
    expect(b.min[1]).toBeCloseTo(0, 3);
    expect(b.max[0]).toBeLessThanOrEqual(64.001);
    // 16 around × 8 rings.
    expect(s.faces.length).toBe(16 * 8);
    for (const v of vertices(s)) expect(Math.hypot(v[0], v[1] - 64, v[2])).toBeLessThan(64.01);
    const ideal = (4 / 3) * Math.PI * 64 ** 3;
    const v8 = volume(sphere([-64, 0, -64], [64, 128, 64], 8)), v24 = volume(sphere([-64, 0, -64], [64, 128, 64], 24));
    expect(v8).toBeLessThan(v24);
    expect(v24 / ideal).toBeGreaterThan(0.95);
  });
});
