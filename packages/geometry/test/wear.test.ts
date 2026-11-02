// CM3: inset edge rings carrying exact distances to a face's outer edges and creases.
import { describe, expect, it } from 'vitest';
import { box, buildMesh } from '../src';

/** [edge distance, crease distance] of every vertex, and the normal it belongs to. */
function wear(m: ReturnType<typeof buildMesh>) {
  const out: { p: number[]; n: number[]; edge: number; crease: number }[] = [];
  for (let i = 0; i < m.positions.length / 3; i++)
    out.push({ p: [...m.positions.slice(i * 3, i * 3 + 3)], n: [...m.normals.slice(i * 3, i * 3 + 3)], edge: m.wear![i * 2]! - 1, crease: m.wear![i * 2 + 1]! - 1 });
  return out;
}

describe('wear rings', () => {
  it('a lone block: every edge is an outer edge, 0 on the edge and the ring width inside; no creases', () => {
    const m = buildMesh([box([0, 0, 0], [128, 64, 128])], { wearRing: 16 });
    const v = wear(m);
    expect(Math.min(...v.map((x) => x.edge))).toBe(0);
    expect(Math.max(...v.map((x) => x.edge))).toBeCloseTo(16, 5);
    expect(v.every((x) => x.crease === 16)).toBe(true);
    // The top face's inner corners sit 16 in from both edges.
    const top = v.filter((x) => x.n[1] === 1 && x.edge === 16 && x.crease === 16);
    expect(top.some((x) => Math.abs(x.p[0]! - 16) < 1e-4 && Math.abs(x.p[2]! - 16) < 1e-4)).toBe(true);
    // Same surface as without rings (area of all triangles).
    const area = (mm: ReturnType<typeof buildMesh>) => {
      let s = 0;
      for (let t = 0; t < mm.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => [...mm.positions.slice(mm.indices[t + k]! * 3, mm.indices[t + k]! * 3 + 3)]);
        const u = a!.map((x, i) => b![i]! - x), w = a!.map((x, i) => c![i]! - x);
        s += Math.hypot(u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!) / 2;
      }
      return s;
    };
    expect(area(m)).toBeCloseTo(area(buildMesh([box([0, 0, 0], [128, 64, 128])])), 3);
    expect(m.triangleFaces.length).toBe(m.indices.length / 3);
  });

  it('a wall standing on a floor: its foot is a crease, its top an outer edge', () => {
    const floor = box([-256, -16, -256], [256, 0, 256]);
    const wall = box([-64, 0, -16], [64, 128, 16]);
    const v = wear(buildMesh([floor, wall], { cullTouchingFaces: true, wearRing: 16 }));
    const front = v.filter((x) => x.n[2] === 1 && x.p[2] === 16);
    // (Corners belong to two strips: the foot's strip says crease, the top's strip says outer edge.)
    const foot = front.filter((x) => x.p[1] === 0);
    const top = front.filter((x) => x.p[1] === 128);
    expect(foot.some((x) => x.crease === 0 && x.edge === 16)).toBe(true);
    expect(foot.some((x) => x.crease === 0 && x.edge === 0)).toBe(false);
    expect(top.some((x) => x.edge === 0 && x.crease === 16)).toBe(true);
    expect(top.some((x) => x.crease === 0)).toBe(false);
  });

  it('small faces get a narrower ring (never inside out)', () => {
    const v = wear(buildMesh([box([0, 0, 0], [8, 8, 8])], { wearRing: 16 }));
    expect(Math.max(...v.map((x) => x.edge))).toBeLessThan(4);
  });
});
