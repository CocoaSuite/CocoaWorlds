/** The mine's blocks: made from the seed as they're needed, in chunks, with what was dug out kept as edits. */
import type { MineConfig } from './defs';
import { fbm3, hash3, noise3 } from './noise';

export const AIR = 0;
/** The mine's edge (surface mines: around the patch, down to the crust): solid, never dug. */
export const EDGE = 0xffff;
export const blockId = (zone: number, ore: number) => 1 + zone * 64 + (ore + 1);
export const zoneOf = (id: number) => (id - 1) >> 6;
export const oreOf = (id: number) => ((id - 1) & 63) - 1;

export interface Chunk {
  cx: number;
  cy: number;
  cz: number;
  data: Uint16Array;
  version: number;
}

export interface RayHit {
  x: number;
  y: number;
  z: number;
  /** The face hit (outward). */
  n: [number, number, number];
  /** Distance in blocks. */
  t: number;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export class MineBlocks {
  readonly size: number;
  readonly chunks = new Map<string, Chunk>();
  private edits = new Map<string, Map<number, number>>();
  /** Bumps whenever a block changes or a chunk loads. */
  version = 0;
  private tables: { ores: number[]; cum: number[] }[] = [];
  /** The current twist's effect on what the seed makes. */
  private boost: Record<string, number> = {};
  private densityMul = 1;
  private caveMul = 1;

  constructor(
    readonly cfg: MineConfig,
    public seed: number,
  ) {
    this.size = cfg.chunk;
    this.makeTables();
  }

  /** A twist changes ore odds, how many veins and how many caves (for the next mine made). */
  setTwist(t: { ores?: Record<string, number>; density?: number; caves?: number } | null): void {
    this.boost = t?.ores ?? {};
    this.densityMul = t?.density ?? 1;
    this.caveMul = t?.caves ?? 1;
    this.makeTables();
  }

  private makeTables(): void {
    const ids = this.cfg.ores.map((o) => o.id);
    this.tables = this.cfg.zones.map((z) => {
      const ores: number[] = [], cum: number[] = [];
      let t = 0;
      for (const [id, w0] of Object.entries(z.ores)) {
        const i = ids.indexOf(id), w = w0 * (this.boost[id] ?? 1);
        if (i < 0 || !(w > 0)) continue;
        t += w;
        ores.push(i);
        cum.push(t);
      }
      return { ores, cum: cum.map((c) => c / (t || 1)) };
    });
  }

  /** Where the player is safe and sells: above ground (surface mines) or the base room. */
  inBase(x: number, y: number, z: number): boolean {
    if (this.cfg.surface) return y >= 0;
    const [bx, by, bz] = this.cfg.base;
    return Math.abs(x) <= bx && y >= 0 && y <= by && Math.abs(z) <= bz;
  }

  /** Index of the zone at a distance from the base (past the last one, the last one). */
  zoneAt(d: number): number {
    const zs = this.cfg.zones;
    let i = 0;
    while (i + 1 < zs.length && d >= zs[i + 1]!.from) i++;
    return i;
  }

  /** How far into the mine a block is: its depth (surface mines) or its distance from the base. */
  depth(x: number, y: number, z: number): number {
    return this.cfg.surface ? Math.max(0, -1 - y) : Math.hypot(x, y, z);
  }

  /** The block the seed makes here. */
  gen(x: number, y: number, z: number): number {
    if (this.inBase(x, y, z)) return AIR;
    const s = this.seed, [bx, , bz] = this.cfg.base, c = this.cfg;
    if (c.surface && y >= -c.crust && (Math.abs(x) > c.patch || Math.abs(z) > c.patch)) return EDGE;
    const d = Math.hypot(x, y, z);
    const cv = c.caves * this.caveMul;
    if (cv > 0 && (c.surface ? y < -c.crust - 3 : d > Math.max(bx, bz) + 6)) {
      if (fbm3(x * 0.07, y * 0.09, z * 0.07, s + 1) > 1 - 0.31 * cv) return AIR;
      const a = noise3(x * 0.045, y * 0.06, z * 0.045, s + 2), b = noise3(x * 0.045, y * 0.06, z * 0.045, s + 3);
      if (Math.abs(a - 0.5) < 0.045 * cv && Math.abs(b - 0.5) < 0.045 * cv) return AIR;
    }
    const zone = this.zoneAt(this.depth(x, y, z) + (noise3(x * 0.05, y * 0.05, z * 0.05, s + 4) - 0.5) * 6);
    const cx = Math.floor(x / 3), cy = Math.floor(y / 3), cz = Math.floor(z / 3);
    const t = this.tables[zone]!;
    if (t.ores.length && hash3(cx, cy, cz, s + 5) < c.oreDensity * this.densityMul && hash3(x, y, z, s + 7) < 0.6) {
      const r = hash3(cx, cy, cz, s + 6);
      let i = 0;
      while (i + 1 < t.cum.length && r > t.cum[i]!) i++;
      return blockId(zone, t.ores[i]!);
    }
    return blockId(zone, -1);
  }

  private cKey(cx: number, cy: number, cz: number) {
    return key(cx, cy, cz);
  }

  chunkOf(x: number, y: number, z: number): [number, number, number] {
    const S = this.size;
    return [Math.floor(x / S), Math.floor(y / S), Math.floor(z / S)];
  }

  loaded(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(this.cKey(cx, cy, cz));
  }

  /** Load (make) a chunk. */
  chunk(cx: number, cy: number, cz: number): Chunk {
    const k = this.cKey(cx, cy, cz);
    let c = this.chunks.get(k);
    if (c) return c;
    const S = this.size, data = new Uint16Array(S * S * S);
    const x0 = cx * S, y0 = cy * S, z0 = cz * S;
    let i = 0;
    for (let y = 0; y < S; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) data[i++] = this.gen(x0 + x, y0 + y, z0 + z);
    const ed = this.edits.get(k);
    if (ed) for (const [idx, id] of ed) data[idx] = id;
    c = { cx, cy, cz, data, version: 1 };
    this.chunks.set(k, c);
    this.version++;
    return c;
  }

  unload(c: Chunk): void {
    this.chunks.delete(this.cKey(c.cx, c.cy, c.cz));
  }

  get(x: number, y: number, z: number): number {
    const S = this.size, cx = Math.floor(x / S), cy = Math.floor(y / S), cz = Math.floor(z / S);
    const idx = x - cx * S + S * (z - cz * S + S * (y - cy * S));
    const c = this.chunks.get(this.cKey(cx, cy, cz));
    if (c) return c.data[idx]!;
    const e = this.edits.get(this.cKey(cx, cy, cz))?.get(idx);
    return e ?? this.gen(x, y, z);
  }

  solid(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== AIR;
  }

  set(x: number, y: number, z: number, id: number): void {
    const S = this.size, cx = Math.floor(x / S), cy = Math.floor(y / S), cz = Math.floor(z / S);
    const lx = x - cx * S, ly = y - cy * S, lz = z - cz * S, idx = lx + S * (lz + S * ly);
    const k = this.cKey(cx, cy, cz);
    let ed = this.edits.get(k);
    if (!ed) this.edits.set(k, (ed = new Map()));
    ed.set(idx, id);
    const c = this.chunks.get(k);
    if (c) {
      c.data[idx] = id;
      c.version++;
    }
    // (Faces on a chunk's edge belong to the neighbour's mesh too.)
    const touch = (dx: number, dy: number, dz: number) => {
      const n = this.chunks.get(this.cKey(cx + dx, cy + dy, cz + dz));
      if (n) n.version++;
    };
    if (lx === 0) touch(-1, 0, 0);
    if (lx === S - 1) touch(1, 0, 0);
    if (ly === 0) touch(0, -1, 0);
    if (ly === S - 1) touch(0, 1, 0);
    if (lz === 0) touch(0, 0, -1);
    if (lz === S - 1) touch(0, 0, 1);
    this.version++;
  }

  /** First solid block along a ray (block space: block (i, j, k) fills [i, i + 1)). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | null {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
    let tx = sx ? (sx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
    let ty = sy ? (sy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
    let tz = sz ? (sz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
    let n: [number, number, number] = [0, 0, 0], t = 0;
    for (let i = 0; i < 256 && t <= maxT; i++) {
      if (this.solid(x, y, z)) return { x, y, z, n, t };
      if (tx < ty && tx < tz) {
        x += sx;
        t = tx;
        tx += tdx;
        n = [-sx, 0, 0];
      } else if (ty < tz) {
        y += sy;
        t = ty;
        ty += tdy;
        n = [0, -sy, 0];
      } else {
        z += sz;
        t = tz;
        tz += tdz;
        n = [0, 0, -sz];
      }
    }
    return null;
  }

  /** A chunk's solid blocks as few boxes ([x0, y0, z0, x1, y1, z1] in blocks, max excluded), for colliders. */
  boxes(c: Chunk): number[][] {
    const S = this.size, d = c.data, done = new Uint8Array(S * S * S);
    const at = (x: number, y: number, z: number) => x + S * (z + S * y);
    const free = (x: number, y: number, z: number) => d[at(x, y, z)] !== AIR && !done[at(x, y, z)];
    const out: number[][] = [];
    for (let y = 0; y < S; y++)
      for (let z = 0; z < S; z++)
        for (let x = 0; x < S; x++) {
          if (!free(x, y, z)) continue;
          let x1 = x;
          while (x1 + 1 < S && free(x1 + 1, y, z)) x1++;
          let z1 = z;
          const rowFree = (zz: number, yy: number) => {
            for (let xx = x; xx <= x1; xx++) if (!free(xx, yy, zz)) return false;
            return true;
          };
          while (z1 + 1 < S && rowFree(z1 + 1, y)) z1++;
          let y1 = y;
          const layerFree = (yy: number) => {
            for (let zz = z; zz <= z1; zz++) if (!rowFree(zz, yy)) return false;
            return true;
          };
          while (y1 + 1 < S && layerFree(y1 + 1)) y1++;
          for (let yy = y; yy <= y1; yy++) for (let zz = z; zz <= z1; zz++) for (let xx = x; xx <= x1; xx++) done[at(xx, yy, zz)] = 1;
          const ox = c.cx * S, oy = c.cy * S, oz = c.cz * S;
          out.push([ox + x, oy + y, oz + z, ox + x1 + 1, oy + y1 + 1, oz + z1 + 1]);
        }
    return out;
  }

  /** A fresh mine: a new seed, nothing dug. */
  reset(seed: number): void {
    this.seed = seed;
    this.edits.clear();
    this.chunks.clear();
    this.version++;
  }

  save(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [k, ed] of this.edits) out[k] = [...ed].flat();
    return out;
  }

  load(saved: unknown): void {
    this.edits.clear();
    this.chunks.clear();
    if (!saved || typeof saved !== 'object') return;
    for (const [k, list] of Object.entries(saved as Record<string, unknown>)) {
      if (!Array.isArray(list) || !/^-?\d+,-?\d+,-?\d+$/.test(k)) continue;
      const ed = new Map<number, number>();
      for (let i = 0; i + 1 < list.length; i += 2) if (typeof list[i] === 'number' && typeof list[i + 1] === 'number') ed.set(list[i] as number, list[i + 1] as number);
      this.edits.set(k, ed);
    }
    this.version++;
  }
}
