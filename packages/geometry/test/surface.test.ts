import { describe, expect, it } from 'vitest';
import { box, buildMesh, defaultSurface, faceAt, fitSurface, fromData, justifySurface, polygons, setSurface, toData, uvAt, wedge } from '../src';

const TEX = 256;

/** The texel range a face's polygon covers along u and v. */
function uvRange(b: ReturnType<typeof box>, face: number) {
  const poly = polygons(b).find((p) => p.face === face)!;
  const us = poly.points.map((p) => uvAt(p, poly.plane, poly.surface));
  return {
    u: [Math.min(...us.map((x) => x[0])), Math.max(...us.map((x) => x[0]))],
    v: [Math.min(...us.map((x) => x[1])), Math.max(...us.map((x) => x[1]))],
  };
}

const faceFacing = (b: ReturnType<typeof box>, n: [number, number, number]) =>
  b.faces.findIndex((f) => f.plane.n.every((c, i) => Math.abs(c - n[i]!) < 1e-9));

describe('faceAt', () => {
  const b = box([0, 0, 0], [64, 32, 128]);
  it('finds the face under a surface point', () => {
    expect(faceAt(b, [32, 32, 64], [0, 1, 0])).toBe(faceFacing(b, [0, 1, 0]));
    expect(faceAt(b, [64, 10, 10], [1, 0, 0])).toBe(faceFacing(b, [1, 0, 0]));
  });
  it('returns -1 for points off every face or facing the wrong way', () => {
    expect(faceAt(b, [32, 16, 64], [0, 1, 0])).toBe(-1);
    expect(faceAt(b, [32, 32, 64], [0, -1, 0])).toBe(-1);
  });
  it('finds sloped faces', () => {
    const w = wedge([0, 0, 0], [64, 64, 64], 0);
    const slope = w.faces.findIndex((f) => Math.abs(f.plane.n[1]) > 0.1 && Math.abs(f.plane.n[1]) < 0.9);
    const n = w.faces[slope]!.plane.n;
    const poly = polygons(w).find((p) => p.face === slope)!;
    const mid = poly.points.reduce((a, p) => [a[0] + p[0] / poly.points.length, a[1] + p[1] / poly.points.length, a[2] + p[2] / poly.points.length], [0, 0, 0]) as [number, number, number];
    expect(faceAt(w, mid, n)).toBe(slope);
  });
});

describe('setSurface', () => {
  it('changes only the chosen faces and never the shape', () => {
    const b = box([0, 0, 0], [64, 64, 64]);
    const top = faceFacing(b, [0, 1, 0]);
    const out = setSurface(b, { material: 'dev/orange', rotation: 45, offset: [8, undefined] }, [top]);
    expect(out.faces[top]!.surface).toMatchObject({ material: 'dev/orange', rotation: 45, offset: [8, 0] });
    out.faces.forEach((f, i) => {
      expect(f.plane).toEqual(b.faces[i]!.plane);
      if (i !== top) expect(f.surface).toEqual(b.faces[i]!.surface);
    });
    // The original is untouched.
    expect(b.faces[top]!.surface.material).toBe('dev/grid');
  });
  it('applies to every face when no list is given', () => {
    const out = setSurface(box([0, 0, 0], [16, 16, 16]), { align: 'face' });
    expect(out.faces.every((f) => f.surface.align === 'face')).toBe(true);
  });
  it('refuses a zero scale', () => {
    const out = setSurface(box([0, 0, 0], [16, 16, 16]), { scale: [0, 0.5] });
    expect(out.faces[0]!.surface.scale[0]).not.toBe(0);
    expect(out.faces[0]!.surface.scale[1]).toBe(0.5);
  });
  it('survives saving: three points per face plus the surface', () => {
    const b = setSurface(box([0, 0, 0], [64, 64, 64]), { material: 'dev/blue', scale: [0.5, 0.125], rotation: 30 }, [2]);
    const again = fromData(JSON.parse(JSON.stringify(toData(b))));
    expect(again.faces.map((f) => f.surface)).toEqual(b.faces.map((f) => f.surface));
  });
  it('shows up in the mesh as its own material group', () => {
    const b = setSurface(box([0, 0, 0], [64, 64, 64]), { material: 'dev/blue' }, [0]);
    const m = buildMesh([b]);
    expect(m.groups.map((g) => g.material).sort()).toEqual(['dev/blue', 'dev/grid']);
  });
});

describe('fit and justify', () => {
  it('fit makes the texture cover the face exactly once', () => {
    const b = box([16, 0, -40], [208, 96, 88]);
    const front = faceFacing(b, [0, 0, 1]);
    const out = fitSurface(b, [front], TEX);
    const r = uvRange(out, front);
    expect(r.u[0]).toBeCloseTo(0, 6);
    expect(r.u[1]).toBeCloseTo(TEX, 6);
    expect(r.v[0]).toBeCloseTo(0, 6);
    expect(r.v[1]).toBeCloseTo(TEX, 6);
  });
  it('fit with repeats', () => {
    const b = box([0, 0, 0], [128, 64, 32]);
    const top = faceFacing(b, [0, 1, 0]);
    const r = uvRange(fitSurface(b, [top], TEX, [2, 4]), top);
    expect(r.u[1] - r.u[0]).toBeCloseTo(TEX * 2, 6);
    expect(r.v[1] - r.v[0]).toBeCloseTo(TEX * 4, 6);
  });
  it('fit works on rotated textures', () => {
    const b = setSurface(box([0, 0, 0], [128, 64, 32]), { rotation: 90 });
    const top = faceFacing(b, [0, 1, 0]);
    const r = uvRange(fitSurface(b, [top], TEX), top);
    expect(r.u[0]).toBeCloseTo(0, 6);
    expect(r.u[1]).toBeCloseTo(TEX, 6);
  });
  it('justify left puts the texture edge on the face edge', () => {
    const b = box([5, 0, 0], [133, 64, 32]);
    const front = faceFacing(b, [0, 0, 1]);
    const r = uvRange(justifySurface(b, [front], 'left', TEX), front);
    expect(((r.u[0] % TEX) + TEX) % TEX).toBeCloseTo(0, 6);
  });
  it('justify centre centres the texture on the face', () => {
    const b = box([0, 0, 0], [100, 60, 32]);
    const front = faceFacing(b, [0, 0, 1]);
    const r = uvRange(justifySurface(b, [front], 'center', TEX), front);
    const mid = (r.u[0] + r.u[1]) / 2;
    expect(((mid % TEX) + TEX) % TEX).toBeCloseTo(TEX / 2, 6);
  });
  it('default surface is world aligned at four texels per unit', () => {
    expect(defaultSurface()).toMatchObject({ align: 'world', scale: [0.25, 0.25] });
  });
});
