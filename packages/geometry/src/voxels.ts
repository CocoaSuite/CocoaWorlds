/**
 * Voxel terrain (T1): a grid of density values, solid where positive, with the ground's surface where it crosses
 * zero. It's meshed smooth with surface nets (one vertex per grid cell the surface passes through, placed at the
 * average of where it crosses the cell's edges), so hills, cliffs, caves and overhangs all come out rounded.
 *
 * Each grid point also carries four layer weights (0…255) for painting: the ground's materials blend by them.
 * Edits work on a sphere and return the grid range they changed, so only the chunks there are meshed again and
 * only that range needs keeping for undo.
 */

/** Grid points per chunk side (a chunk is meshed by itself). */
export const VOXEL_CHUNK = 16;
/** Density is kept within ±this: enough slope for smooth normals, little enough for quick edits. */
const LIMIT = 4;

import type { V3 } from './vec';

/** A range of grid points, inclusive. */
export interface VoxelBox {
  min: V3;
  max: V3;
}

export interface VoxelMesh {
  /** Positions in the terrain's own space (u). */
  positions: Float32Array;
  normals: Float32Array;
  /** Four layer weights per vertex, 0…1. */
  weights: Float32Array;
  indices: Uint32Array;
}

export type SculptMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'dig' | 'fill';

export class VoxelField {
  readonly density: Float32Array;
  readonly weights: Uint8Array;

  /** `n`: grid points along x, y, z; `cell`: spacing (u). Starts empty (all air), layer 0 everywhere. */
  constructor(
    readonly n: V3,
    readonly cell: number,
  ) {
    const count = n[0] * n[1] * n[2];
    this.density = new Float32Array(count).fill(-LIMIT);
    this.weights = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) this.weights[i * 4] = 255;
  }

  index(x: number, y: number, z: number): number {
    return (z * this.n[1] + y) * this.n[0] + x;
  }

  /** Density at a grid point (air outside the grid, so the edges are closed). */
  at(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.n[0] || y >= this.n[1] || z >= this.n[2]) return -LIMIT;
    return this.density[this.index(x, y, z)]!;
  }

  /** Flat ground at height `h` (u, from the bottom of the grid). */
  fillFlat(h: number): void {
    this.fromHeights((_x, _z) => h);
  }

  /** Ground following a height for each column (u, from the bottom; given grid x and z). */
  fromHeights(height: (x: number, z: number) => number): void {
    const [nx, ny, nz] = this.n;
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const h = height(x, z);
        for (let y = 0; y < ny; y++) this.density[this.index(x, y, z)] = clamp((h - y * this.cell) / this.cell);
      }
    }
  }

  /** The grid points within `r` (u) of `c` (terrain space), clipped to the grid. */
  private around(c: V3, r: number): VoxelBox | null {
    const min: V3 = [0, 0, 0], max: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.max(0, Math.floor((c[k]! - r) / this.cell));
      max[k] = Math.min(this.n[k]! - 1, Math.ceil((c[k]! + r) / this.cell));
      if (min[k]! > max[k]!) return null;
    }
    return { min, max };
  }

  /**
   * Shape the ground in a sphere at `c` (terrain space) of radius `r` (u). `amount` 0…1 is how strongly (per call:
   * a stroke calls it again and again). Raise and lower push the ground out or in, softly towards the edge; smooth
   * evens it out; flatten draws it towards a level surface at `level` (u, default the centre's height); dig and fill
   * cut or add the whole sphere. Returns the grid range changed (null if none).
   */
  sculpt(mode: SculptMode, c: V3, r: number, amount: number, level = c[1]): VoxelBox | null {
    const box = this.around(c, r);
    if (!box) return null;
    const src = mode === 'smooth' ? this.density.slice() : this.density;
    const cell = this.cell;
    for (let z = box.min[2]; z <= box.max[2]; z++) {
      for (let y = box.min[1]; y <= box.max[1]; y++) {
        for (let x = box.min[0]; x <= box.max[0]; x++) {
          const d = Math.hypot(x * cell - c[0], y * cell - c[1], z * cell - c[2]);
          if (d > r) continue;
          const i = this.index(x, y, z);
          const t = 1 - d / r;
          const f = t * t * (3 - 2 * t) * amount;
          const v = this.density[i]!;
          let next = v;
          switch (mode) {
            case 'raise':
              next = v + f;
              break;
            case 'lower':
              next = v - f;
              break;
            case 'smooth': {
              const at = (a: number, b: number, e: number) => (a < 0 || b < 0 || e < 0 || a >= this.n[0] || b >= this.n[1] || e >= this.n[2] ? v : src[this.index(a, b, e)]!);
              const avg = (at(x - 1, y, z) + at(x + 1, y, z) + at(x, y - 1, z) + at(x, y + 1, z) + at(x, y, z - 1) + at(x, y, z + 1)) / 6;
              next = v + (avg - v) * Math.min(1, f * 2);
              break;
            }
            case 'flatten':
              next = v + ((level - y * cell) / cell - v) * Math.min(1, f * 2);
              break;
            case 'dig':
              next = Math.min(v, (d - r) / cell);
              break;
            case 'fill':
              next = Math.max(v, (r - d) / cell);
              break;
          }
          this.density[i] = clamp(next);
        }
      }
    }
    return box;
  }

  /** Paint layer `layer` (0…3) in a sphere, softly towards its edge; `amount` 0…1 per call. */
  paint(layer: number, c: V3, r: number, amount: number): VoxelBox | null {
    const box = this.around(c, r);
    if (!box) return null;
    const cell = this.cell;
    for (let z = box.min[2]; z <= box.max[2]; z++) {
      for (let y = box.min[1]; y <= box.max[1]; y++) {
        for (let x = box.min[0]; x <= box.max[0]; x++) {
          const d = Math.hypot(x * cell - c[0], y * cell - c[1], z * cell - c[2]);
          if (d > r) continue;
          const t = 1 - d / r;
          const f = Math.min(1, t * t * (3 - 2 * t) * amount);
          const o = this.index(x, y, z) * 4;
          // Towards all of this layer: the others give way in proportion, so the four always add up to 255.
          let sum = 0;
          const w = [0, 0, 0, 0];
          for (let k = 0; k < 4; k++) {
            const target = k === layer ? 255 : 0;
            w[k] = this.weights[o + k]! + (target - this.weights[o + k]!) * f;
            sum += w[k]!;
          }
          let given = 0;
          for (let k = 0; k < 4; k++) {
            const v = k === 3 ? 255 - given : Math.round((w[k]! / (sum || 1)) * 255);
            this.weights[o + k] = Math.max(0, Math.min(255, v));
            given += this.weights[o + k]!;
          }
        }
      }
    }
    return box;
  }

  /** A copy of a range (for undo). */
  save(box: VoxelBox): { box: VoxelBox; density: Float32Array; weights: Uint8Array } {
    const out: number[] = [], w: number[] = [];
    this.each(box, (i) => {
      out.push(this.density[i]!);
      for (let k = 0; k < 4; k++) w.push(this.weights[i * 4 + k]!);
    });
    return { box: { min: [...box.min], max: [...box.max] }, density: Float32Array.from(out), weights: Uint8Array.from(w) };
  }

  /** A copy of a range as it was in earlier copies of the whole grid (the start of a stroke, for undo). */
  saveFrom(density: Float32Array, weights: Uint8Array, box: VoxelBox): { box: VoxelBox; density: Float32Array; weights: Uint8Array } {
    const out: number[] = [], w: number[] = [];
    this.each(box, (i) => {
      out.push(density[i]!);
      for (let k = 0; k < 4; k++) w.push(weights[i * 4 + k]!);
    });
    return { box: { min: [...box.min], max: [...box.max] }, density: Float32Array.from(out), weights: Uint8Array.from(w) };
  }

  /** Put back a copy made with `save`. */
  restore(s: { box: VoxelBox; density: Float32Array; weights: Uint8Array }): void {
    let k = 0;
    this.each(s.box, (i) => {
      this.density[i] = s.density[k]!;
      for (let j = 0; j < 4; j++) this.weights[i * 4 + j] = s.weights[k * 4 + j]!;
      k++;
    });
  }

  private each(box: VoxelBox, fn: (i: number) => void): void {
    for (let z = box.min[2]; z <= box.max[2]; z++) for (let y = box.min[1]; y <= box.max[1]; y++) for (let x = box.min[0]; x <= box.max[0]; x++) fn(this.index(x, y, z));
  }

  /** How many chunks along each axis. */
  get chunks(): V3 {
    return [0, 1, 2].map((k) => Math.ceil(this.n[k]! / VOXEL_CHUNK)) as V3;
  }

  /** The chunks a changed grid range touches (a point on a chunk's edge touches its neighbours too). */
  chunksIn(box: VoxelBox): V3[] {
    const out: V3[] = [];
    const lo = box.min.map((v) => Math.max(0, Math.floor((v - 1) / VOXEL_CHUNK)));
    const hi = box.max.map((v, k) => Math.min(this.chunks[k]! - 1, Math.floor((v + 1) / VOXEL_CHUNK)));
    for (let z = lo[2]!; z <= hi[2]!; z++) for (let y = lo[1]!; y <= hi[1]!; y++) for (let x = lo[0]!; x <= hi[0]!; x++) out.push([x, y, z]);
    return out;
  }

  /** The smooth surface in one chunk (terrain space). Chunks meet without gaps. */
  meshChunk(cx: number, cy: number, cz: number): VoxelMesh {
    return surfaceNets(this, [cx * VOXEL_CHUNK, cy * VOXEL_CHUNK, cz * VOXEL_CHUNK], [VOXEL_CHUNK, VOXEL_CHUNK, VOXEL_CHUNK]);
  }

  /** The whole surface at once (tests, small terrains). */
  meshAll(): VoxelMesh {
    return surfaceNets(this, [0, 0, 0], [this.n[0], this.n[1], this.n[2]]);
  }

  // ── Saving: a small header, then density as 16-bit numbers and the weights as they are ──

  toBytes(): Uint8Array {
    const count = this.density.length;
    const out = new Uint8Array(16 + count * 2 + count * 4);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x31585643); // "CVX1"
    v.setUint16(4, this.n[0]);
    v.setUint16(6, this.n[1]);
    v.setUint16(8, this.n[2]);
    v.setFloat32(10, this.cell);
    for (let i = 0; i < count; i++) v.setInt16(16 + i * 2, Math.round((this.density[i]! / LIMIT) * 32767), true);
    out.set(this.weights, 16 + count * 2);
    return out;
  }

  static fromBytes(bytes: Uint8Array): VoxelField {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint32(0) !== 0x31585643) throw new Error('Not a terrain file.');
    const f = new VoxelField([v.getUint16(4), v.getUint16(6), v.getUint16(8)], v.getFloat32(10));
    const count = f.density.length;
    for (let i = 0; i < count; i++) f.density[i] = (v.getInt16(16 + i * 2, true) / 32767) * LIMIT;
    f.weights.set(bytes.subarray(16 + count * 2, 16 + count * 2 + count * 4));
    return f;
  }
}

const clamp = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v));

/**
 * Surface nets over the cells starting at `o` (grid points), `size` cells along each axis. A vertex goes in each
 * cell the surface crosses (including one cell before the range, which the faces on the range's near side need);
 * a quad goes across each grid edge in the range where the density changes sign.
 */
function surfaceNets(f: VoxelField, o: V3, size: V3): VoxelMesh {
  const cell = f.cell;
  // Cells from o-1 to o+size-1 (clipped to the grid's cells, which run 0…n-2; outside is air, so nothing there).
  const lo = o.map((v) => v - 1) as V3;
  const dims = size.map((s) => s + 1) as V3;
  const vert = new Int32Array(dims[0] * dims[1] * dims[2]).fill(-1);
  const P: number[] = [], N: number[] = [], W: number[] = [], I: number[] = [];
  const corner = [0, 0, 0, 0, 0, 0, 0, 0];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], // along x
    [0, 2], [1, 3], [4, 6], [5, 7], // along y
    [0, 4], [1, 5], [2, 6], [3, 7], // along z
  ] as const;
  const cornerAt = (k: number): V3 => [k & 1, (k >> 1) & 1, (k >> 2) & 1];
  const vi = (x: number, y: number, z: number) => ((z - lo[2]) * dims[1] + (y - lo[1])) * dims[0] + (x - lo[0]);

  // Weight at a grid point (outside the grid: the nearest one inside).
  const weightAt = (x: number, y: number, z: number, k: number) => {
    const cx = Math.max(0, Math.min(f.n[0] - 1, x)), cy = Math.max(0, Math.min(f.n[1] - 1, y)), cz = Math.max(0, Math.min(f.n[2] - 1, z));
    return f.weights[f.index(cx, cy, cz) * 4 + k]! / 255;
  };

  for (let z = lo[2]; z < lo[2] + dims[2]; z++) {
    for (let y = lo[1]; y < lo[1] + dims[1]; y++) {
      for (let x = lo[0]; x < lo[0] + dims[0]; x++) {
        // (Cells half outside the grid still count: the grid's edges are closed with air.)
        if (x < -1 || y < -1 || z < -1 || x >= f.n[0] || y >= f.n[1] || z >= f.n[2]) continue;
        let mask = 0;
        for (let k = 0; k < 8; k++) {
          const c = cornerAt(k);
          corner[k] = f.at(x + c[0], y + c[1], z + c[2]);
          if (corner[k]! > 0) mask |= 1 << k;
        }
        if (mask === 0 || mask === 255) continue;
        // Where the surface crosses this cell's edges, averaged.
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of EDGES) {
          const da = corner[a]!, db = corner[b]!;
          if (da > 0 === db > 0) continue;
          const t = da / (da - db);
          const ca = cornerAt(a), cb = cornerAt(b);
          sx += ca[0] + (cb[0] - ca[0]) * t;
          sy += ca[1] + (cb[1] - ca[1]) * t;
          sz += ca[2] + (cb[2] - ca[2]) * t;
          cnt++;
        }
        const px = x + sx / cnt, py = y + sy / cnt, pz = z + sz / cnt;
        vert[vi(x, y, z)] = P.length / 3;
        P.push(px * cell, py * cell, pz * cell);
        // Normal: pointing out of the ground (density falls), from the density's slope across the cell.
        let gx = (corner[1]! + corner[3]! + corner[5]! + corner[7]!) - (corner[0]! + corner[2]! + corner[4]! + corner[6]!);
        let gy = (corner[2]! + corner[3]! + corner[6]! + corner[7]!) - (corner[0]! + corner[1]! + corner[4]! + corner[5]!);
        let gz = (corner[4]! + corner[5]! + corner[6]! + corner[7]!) - (corner[0]! + corner[1]! + corner[2]! + corner[3]!);
        const gl = Math.hypot(gx, gy, gz) || 1;
        gx /= -gl;
        gy /= -gl;
        gz /= -gl;
        N.push(gx, gy, gz);
        // Layer weights at the vertex, from the nearest grid point.
        const rx = Math.round(px), ry = Math.round(py), rz = Math.round(pz);
        for (let k = 0; k < 4; k++) W.push(weightAt(rx, ry, rz, k));
      }
    }
  }

  // Quads: across each grid edge in the range where the density changes sign, joining the four cells around it.
  for (let z = o[2]; z < o[2] + size[2]; z++) {
    for (let y = o[1]; y < o[1] + size[1]; y++) {
      for (let x = o[0]; x < o[0] + size[0]; x++) {
        if (x >= f.n[0] || y >= f.n[1] || z >= f.n[2]) continue;
        const here = f.at(x, y, z) > 0;
        // Edge along +x from (x,y,z): cells around it are (x, y-1..y, z-1..z).
        const edge = (dx: number, dy: number, dz: number, u: V3, v: V3) => {
          const there = f.at(x + dx, y + dy, z + dz) > 0;
          if (here === there) return;
          const c0 = [x, y, z], c1 = [x - u[0], y - u[1], z - u[2]], c2 = [x - u[0] - v[0], y - u[1] - v[1], z - u[2] - v[2]], c3 = [x - v[0], y - v[1], z - v[2]];
          const ids = [c0, c1, c2, c3].map((c) => (c[0]! < lo[0] || c[1]! < lo[1] || c[2]! < lo[2] ? -1 : vert[vi(c[0]!, c[1]!, c[2]!)]!));
          if (ids.some((id) => id < 0)) return;
          // Facing out of the solid side.
          if (here) I.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
          else I.push(ids[0]!, ids[2]!, ids[1]!, ids[0]!, ids[3]!, ids[2]!);
        };
        edge(1, 0, 0, [0, 1, 0], [0, 0, 1]);
        edge(0, 1, 0, [0, 0, 1], [1, 0, 0]);
        edge(0, 0, 1, [1, 0, 0], [0, 1, 0]);
      }
    }
  }
  return { positions: Float32Array.from(P), normals: Float32Array.from(N), weights: Float32Array.from(W), indices: Uint32Array.from(I) };
}
