// T1: voxel terrain — smooth meshing, chunks that meet, sculpting, painting, undo copies and saving.
import { describe, expect, it } from 'vitest';
import { VoxelField, type VoxelMesh } from '../src';

const flat = () => {
  const f = new VoxelField([33, 17, 33], 8);
  f.fillFlat(40);
  return f;
};
const tris = (m: VoxelMesh) => m.indices.length / 3;

/** Every triangle's winding agrees with its vertices' normals (faces point out of the ground). */
function facesOut(m: VoxelMesh): boolean {
  const P = m.positions, N = m.normals, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t]! * 3, I[t + 1]! * 3, I[t + 2]! * 3];
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = nx * (N[a]! + N[b]! + N[c]!) + ny * (N[a + 1]! + N[b + 1]! + N[c + 1]!) + nz * (N[a + 2]! + N[b + 2]! + N[c + 2]!);
    if (dot < 0) return false;
  }
  return true;
}

describe('voxel terrain', () => {
  it('flat ground meshes at its height, faces pointing out', () => {
    const m = flat().meshAll();
    expect(tris(m)).toBeGreaterThan(1000);
    let top = 0;
    for (let i = 0; i < m.positions.length / 3; i++) {
      if (m.normals[i * 3 + 1]! > 0.9) {
        top++;
        expect(m.positions[i * 3 + 1]).toBeCloseTo(40, 0);
      }
    }
    expect(top).toBeGreaterThan(500);
    expect(facesOut(m)).toBe(true);
  });

  it('chunks meet without gaps: together they make the same surface as one mesh', () => {
    const f = flat();
    f.sculpt('raise', [128, 40, 128], 60, 3);
    f.sculpt('dig', [64, 40, 200], 30, 1);
    const [cx, cy, cz] = f.chunks;
    let sum = 0;
    for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) sum += tris(f.meshChunk(x, y, z));
    expect(sum).toBe(tris(f.meshAll()));
  });

  it('dig makes a hole, raise a hill, fill a lump', () => {
    const lowest = (m: VoxelMesh, x: number, z: number) => {
      let lo = Infinity;
      for (let i = 0; i < m.positions.length / 3; i++) if (Math.hypot(m.positions[i * 3]! - x, m.positions[i * 3 + 2]! - z) < 8) lo = Math.min(lo, m.positions[i * 3 + 1]!);
      return lo;
    };
    const highest = (m: VoxelMesh) => Math.max(...Array.from({ length: m.positions.length / 3 }, (_, i) => m.positions[i * 3 + 1]!));
    const f = flat();
    f.sculpt('dig', [128, 40, 128], 32, 1);
    expect(lowest(f.meshAll(), 128, 128)).toBeLessThan(16);
    const g = flat();
    for (let i = 0; i < 10; i++) g.sculpt('raise', [128, 40, 128], 48, 0.5);
    expect(highest(g.meshAll())).toBeGreaterThan(55);
    const h = flat();
    h.sculpt('fill', [128, 64, 128], 24, 1);
    expect(highest(h.meshAll())).toBeGreaterThan(80);
    expect(facesOut(f.meshAll()) && facesOut(g.meshAll()) && facesOut(h.meshAll())).toBe(true);
  });

  it('flatten levels a hill; smooth softens a step', () => {
    const f = flat();
    for (let i = 0; i < 10; i++) f.sculpt('raise', [128, 40, 128], 48, 0.5);
    for (let i = 0; i < 30; i++) f.sculpt('flatten', [128, 40, 128], 64, 1, 40);
    let max = 0;
    const m = f.meshAll();
    for (let i = 0; i < m.positions.length / 3; i++) max = Math.max(max, m.positions[i * 3 + 1]!);
    expect(max).toBeLessThan(46);
    const before = f.density.slice();
    f.sculpt('dig', [128, 40, 128], 20, 1);
    const dug = f.density.slice();
    f.sculpt('smooth', [128, 40, 128], 32, 1);
    // Smoothing moves the dug grid towards its neighbours: closer to what it was.
    let a = 0, b = 0;
    for (let i = 0; i < before.length; i++) {
      a += Math.abs(dug[i]! - before[i]!);
      b += Math.abs(f.density[i]! - before[i]!);
    }
    expect(b).toBeLessThan(a);
  });

  it('paints a layer, weights always adding up', () => {
    const f = flat();
    for (let i = 0; i < 5; i++) f.paint(2, [128, 40, 128], 40, 1);
    const o = f.index(16, 5, 16) * 4;
    expect(f.weights[o + 2]).toBeGreaterThan(240);
    for (let i = 0; i < f.weights.length; i += 4) expect(f.weights[i]! + f.weights[i + 1]! + f.weights[i + 2]! + f.weights[i + 3]!).toBe(255);
    const m = f.meshAll();
    expect(Math.max(...Array.from(m.weights.filter((_, i) => i % 4 === 2)))).toBeGreaterThan(0.9);
  });

  it('an edit reports the chunks it changed; nothing else changes', () => {
    const f = flat();
    const [cx, cy, cz] = f.chunks;
    const all = () => {
      const out = new Map<string, string>();
      for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) out.set(`${x},${y},${z}`, Array.from(f.meshChunk(x, y, z).positions).join(','));
      return out;
    };
    const before = all();
    const box = f.sculpt('dig', [130, 40, 60], 20, 1)!;
    const touched = new Set(f.chunksIn(box).map((c) => c.join(',')));
    const after = all();
    for (const [k, v] of after) if (!touched.has(k)) expect(v).toBe(before.get(k));
    expect([...touched].some((k) => after.get(k) !== before.get(k))).toBe(true);
  });

  it('undo copies put a range back exactly; saving and loading keeps the ground', () => {
    const f = flat();
    const original = f.density.slice();
    const box = f.sculpt('dig', [128, 40, 128], 30, 1)!;
    const g = flat();
    const copy = g.save(box);
    void copy;
    const saved = flat().save(box);
    f.restore(saved);
    expect(Array.from(f.density)).toEqual(Array.from(original));
    f.paint(1, [64, 40, 64], 30, 1);
    f.sculpt('raise', [200, 40, 200], 40, 1);
    const back = VoxelField.fromBytes(f.toBytes());
    expect(back.n).toEqual(f.n);
    expect(back.cell).toBe(f.cell);
    expect(Array.from(back.weights)).toEqual(Array.from(f.weights));
    for (let i = 0; i < f.density.length; i++) expect(Math.abs(back.density[i]! - f.density[i]!)).toBeLessThan(0.001);
    expect(tris(back.meshAll())).toBe(tris(f.meshAll()));
  });
});
