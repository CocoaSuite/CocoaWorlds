// T2: terrain tiles — grids side by side that share their edge points mesh as one ground, with no wall or gap at
// the seam and no face made twice.
import { describe, expect, it } from 'vitest';
import { VOXEL_CHUNK, VoxelField, stitchTiles, tileBeside, type VoxelMesh, type VoxelTile } from '../src';

const N = 17, NY = 9, CELL = 8;
/** Rolling ground with a cave, in world grid coordinates, so tiles cut from it agree on their shared points. */
const height = (gx: number, gz: number) => 32 + 12 * Math.sin(gx * 0.31) * Math.cos(gz * 0.23);
function cave(f: VoxelField, ox: number, oz: number) {
  f.sculpt('dig', [(16 - ox) * CELL, 28, (8 - oz) * CELL], 20, 1);
}

/** A tile at tile coordinates (i, j), cut from the same ground. */
function tile(i: number, j: number): VoxelField {
  const f = new VoxelField([N, NY, N], CELL);
  const ox = i * (N - 1), oz = j * (N - 1);
  f.fromHeights((x, z) => height(x + ox, z + oz));
  cave(f, ox, oz);
  return f;
}

/** The same ground as one grid covering `ti` × `tj` tiles. */
function whole(ti: number, tj: number): VoxelField {
  const f = new VoxelField([ti * (N - 1) + 1, NY, tj * (N - 1) + 1], CELL);
  f.fromHeights((x, z) => height(x, z));
  cave(f, 0, 0);
  return f;
}

/** Link tiles by their coordinates. */
function link(tiles: Map<string, VoxelField>) {
  for (const [k, f] of tiles) {
    const [i, j] = k.split(',').map(Number) as [number, number];
    f.neighbours = (dx, dz) => tiles.get(`${i + dx},${j + dz}`) ?? null;
  }
}

/** Every triangle as text (world positions, rounded: positions are kept as 32-bit floats from each grid's own
 * corner, so far from it the whole grid's last digits differ), from each tile's mesh placed at its offset. */
function triangles(parts: { mesh: VoxelMesh; ox: number; oz: number }[]): string[] {
  const out: string[] = [];
  for (const { mesh: m, ox, oz } of parts) {
    for (let t = 0; t < m.indices.length; t += 3) {
      const corners = [0, 1, 2].map((k) => {
        const v = m.indices[t + k]! * 3;
        return [m.positions[v]! + ox, m.positions[v + 1]!, m.positions[v + 2]! + oz].map((x) => x.toFixed(2)).join(' ');
      });
      // (Same triangle whichever corner it starts from.)
      const s = corners.indexOf([...corners].sort()[0]!);
      out.push([0, 1, 2].map((k) => corners[(s + k) % 3]).join('|'));
    }
  }
  return out.sort();
}

function tiled(coords: [number, number][]) {
  const tiles = new Map(coords.map(([i, j]) => [`${i},${j}`, tile(i, j)] as const));
  link(tiles);
  return { tiles, parts: [...tiles].map(([k, f]) => ({ mesh: f.meshAll(), ox: Number(k.split(',')[0]) * (N - 1) * CELL, oz: Number(k.split(',')[1]) * (N - 1) * CELL })) };
}

describe('terrain tiles', () => {
  it('two tiles side by side mesh exactly as one grid would', () => {
    const { parts } = tiled([
      [0, 0],
      [1, 0],
    ]);
    expect(triangles(parts)).toEqual(triangles([{ mesh: whole(2, 1).meshAll(), ox: 0, oz: 0 }]));
  });

  it('a 2 × 2 block of tiles, corner and all, meshes as one grid', () => {
    const { parts } = tiled([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(triangles(parts)).toEqual(triangles([{ mesh: whole(2, 2).meshAll(), ox: 0, oz: 0 }]));
  });

  it('three tiles in an L make no face twice, and close the open corner', () => {
    const { parts } = tiled([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    const t = triangles(parts);
    // (Leaving out triangles squashed to a line or a point, which one grid makes too.)
    const real = t.filter((x) => new Set(x.split('|')).size === 3);
    expect(new Set(real).size).toBe(real.length);
    // (Against the 2 × 2 grid: the same, less the missing tile's own ground, plus walls around it.)
    const all = triangles([{ mesh: whole(2, 2).meshAll(), ox: 0, oz: 0 }]);
    expect(t.length).toBeLessThan(all.length);
    expect(t.length).toBeGreaterThan(all.length / 2);
  });

  it('chunk by chunk, a tiled seam meets as the whole mesh does', () => {
    const { tiles } = tiled([
      [0, 0],
      [1, 0],
    ]);
    const parts: { mesh: VoxelMesh; ox: number; oz: number }[] = [];
    for (const [k, f] of tiles) {
      const [cx, cy, cz] = f.chunks;
      for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) parts.push({ mesh: f.meshChunk(x, y, z), ox: Number(k.split(',')[0]) * (N - 1) * CELL, oz: 0 });
    }
    expect(VOXEL_CHUNK).toBeLessThan(N);
    expect(triangles(parts)).toEqual(triangles([{ mesh: whole(2, 1).meshAll(), ox: 0, oz: 0 }]));
  });

  it('a lone tile is closed at its edges as before', () => {
    const f = tile(0, 0);
    const before = triangles([{ mesh: f.meshAll(), ox: 0, oz: 0 }]);
    f.neighbours = () => null;
    expect(triangles([{ mesh: f.meshAll(), ox: 0, oz: 0 }])).toEqual(before);
  });

  it('a tile made beside another carries its edge on, and meets it with no wall', () => {
    // (No cave here: its walls would stand upright by the seam.)
    const a = new VoxelField([N, NY, N], CELL);
    a.fromHeights(height);
    a.paint(2, [16 * CELL, 32, 8 * CELL], 24, 1);
    for (const side of ['+x', '-x', '+z', '-z'] as const) {
      const b = tileBeside(a, side);
      const [dx, dz] = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[side];
      // Its shared edge is the same points as `a`'s.
      for (let y = 0; y < NY; y++)
        for (let k = 0; k < N; k++) {
          const ax = dx > 0 ? N - 1 : dx < 0 ? 0 : k, az = dz > 0 ? N - 1 : dz < 0 ? 0 : k;
          const bx = dx > 0 ? 0 : dx < 0 ? N - 1 : k, bz = dz > 0 ? 0 : dz < 0 ? N - 1 : k;
          expect(b.at(bx, y, bz)).toBe(a.at(ax, y, az));
          expect(b.weights[b.index(bx, y, bz) * 4 + 2]).toBe(a.weights[a.index(ax, y, az) * 4 + 2]);
        }
      // Linked, the seam has no wall: no face there stands upright across the ground's height.
      const tiles = new Map([['0,0', a], [`${dx},${dz}`, b]]);
      link(tiles);
      const seam = (m: VoxelMesh, at: number, axis: 0 | 2) => {
        let n = 0;
        for (let v = 0; v < m.positions.length / 3; v++) if (Math.abs(m.positions[v * 3 + axis]! - at) < CELL && Math.abs(m.normals[v * 3 + axis]!) > 0.95) n++;
        return n;
      };
      const axis = dx ? 0 : 2;
      const edge = (dx > 0 || dz > 0 ? N - 1 : 0) * CELL;
      expect(seam(a.meshAll(), edge, axis)).toBe(0);
      a.neighbours = null;
      expect(seam(a.meshAll(), edge, axis)).toBeGreaterThan(0);
    }
  });

  it('stitching makes shared points agree after the tiles were edited apart', () => {
    const tiles: VoxelTile[] = [
      { field: tile(0, 0), i: 0, j: 0 },
      { field: tile(1, 0), i: 1, j: 0 },
      { field: tile(0, 1), i: 0, j: 1 },
      { field: tile(1, 1), i: 1, j: 1 },
    ];
    const [a, b, c, d] = tiles as [VoxelTile, VoxelTile, VoxelTile, VoxelTile];
    // A smooth near the corner only in `a`: the copies of its edge points now differ.
    const box = a.field.sculpt('raise', [16 * CELL, 32, 16 * CELL], 40, 1)!;
    a.field.paint(1, [16 * CELL, 32, 16 * CELL], 40, 1);
    const out = stitchTiles(tiles, new Map([[a, box]]));
    for (let y = 0; y < NY; y++) {
      // The corner point is in all four.
      const v = [a.field.at(16, y, 16), b.field.at(0, y, 16), c.field.at(16, y, 0), d.field.at(0, y, 0)];
      expect(new Set(v).size).toBe(1);
      for (let z = 0; z < N; z++) expect(b.field.at(0, y, z)).toBe(a.field.at(16, y, z));
      const wa = [...a.field.weights.subarray(a.field.index(16, y, 10) * 4, a.field.index(16, y, 10) * 4 + 4)];
      expect([...b.field.weights.subarray(b.field.index(0, y, 10) * 4, b.field.index(0, y, 10) * 4 + 4)]).toEqual(wa);
      expect(wa.reduce((p, q) => p + q, 0)).toBe(255);
    }
    // The neighbours were changed too, so they're in what to mesh again.
    expect([...out.keys()].length).toBe(4);
    expect(out.get(b)!.min[0]).toBe(0);
  });
});
