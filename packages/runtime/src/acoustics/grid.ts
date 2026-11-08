/**
 * Where sound can travel through the air: a coarse grid of points over the level, with each point joined to its
 * neighbours when nothing solid is between them. Measured from the physics world itself (brushes, models,
 * terrain, closed doors), a little at a time and only near the ears, and kept: a level is measured once.
 *
 * From the ears, a flood over the joined points finds how far sound must go through the air to reach each point
 * (round corners, along corridors, through doorways and up stairwells), and which way it arrives from. That is
 * how a sound in the next room is heard through the open door rather than through the wall.
 *
 * Costs: measuring is ~3 rays per point, but a box test skips whole empty blocks (open air, sky) with one
 * query; the flood runs on flat arrays sized once, a slice per frame, and stops as soon as every sound that
 * needs it is reached. Nothing is allocated per frame.
 */
import RAPIER from '@dimforge/rapier3d-compat';

export type V = { x: number; y: number; z: number };

/** What the grid (and the rest of acoustics) asks of the physics world. */
export interface AcousticQuery {
  world: RAPIER.World;
  /** Colliders that stop sound (walls, floors, doors, props that stay put; not zones, crates or creatures). */
  solid(c: RAPIER.Collider): boolean;
  /** A collider to leave out of every query (the player's). */
  exclude(): RAPIER.Collider | undefined;
}

/** Points per chunk side (a chunk is measured on its own, then kept). */
const CHUNK = 16;
const CHUNK_CELLS = CHUNK * CHUNK * CHUNK;
/** Points per block side: a block with nothing solid near it is joined all round with one query. */
const BLOCK = 4;
const BLOCKS = (CHUNK / BLOCK) ** 3;
const FLAGS = RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
/** Joined toward +x, +y, +z. */
const PX = 1, PY = 2, PZ = 4, ALL = 7;

interface Chunk {
  /** Joins per point (PX | PY | PZ), or null: all open (nothing solid anywhere near). */
  bits: Uint8Array | null;
  /** Blocks measured so far (−1: not started; BLOCKS: done). */
  next: number;
  /** Points of the current block measured so far (−1: the block is all open). */
  cell: number;
}

export interface GridOptions {
  /** Spacing (u). Openings wider and taller than this always join. */
  cell: number;
  /** The flood's window, in points along x, y, z (around the ears). */
  window: [number, number, number];
}

export const GRID_DEFAULTS: GridOptions = { cell: 48, window: [56, 20, 56] };

/** One flood's result: distance through the air from the ears to each point of a window, and the way back. */
interface Field {
  dist: Float32Array;
  parent: Int32Array;
  stamp: Uint32Array;
  gen: number;
  /** The window's first point (grid coordinates). */
  x0: number;
  y0: number;
  z0: number;
  /** Where the ears were. */
  from: V;
  ready: boolean;
}

export class SoundGrid {
  readonly cell: number;
  private ox: number;
  private oy: number;
  private oz: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  private cnx: number;
  private cny: number;
  private cnz: number;
  private chunks = new Map<number, Chunk>();
  /** Cell boxes to measure again (something moved or was built there). */
  private dirty: { box: [number, number, number, number, number, number]; at: number }[] = [];
  /** Bumps whenever joins near the ears may have changed: floods made before are out of date. */
  epoch = 0;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  private chunkBox: RAPIER.Cuboid;
  private blockBox: RAPIER.Cuboid;
  private rot = { x: 0, y: 0, z: 0, w: 1 };
  private pos = { x: 0, y: 0, z: 0 };
  private pred: (c: RAPIER.Collider) => boolean;

  // The flood (made the first time one is asked for).
  private wx: number;
  private wy: number;
  private wz: number;
  private open: Uint8Array | null = null;
  private front: Field | null = null;
  private back: Field | null = null;
  private heapId: Int32Array | null = null;
  private heapKey: Float32Array | null = null;
  private heapSize = 0;
  private floodMax = 0;
  /** A flood is under way (in `back`). */
  flooding = false;
  /** Points measured, rays cast, floods run (for profiling). */
  readonly stats = { cells: 0, rays: 0, boxes: 0, floods: 0, visits: 0 };

  constructor(
    private q: AcousticQuery,
    min: [number, number, number],
    max: [number, number, number],
    opts: Partial<GridOptions> = {},
  ) {
    const o = { ...GRID_DEFAULTS, ...opts };
    let cell = o.cell;
    // (Very large levels get a coarser grid so grid coordinates stay small.)
    const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    while (span / cell > 4096) cell *= 2;
    this.cell = cell;
    this.ox = min[0] - cell;
    this.oy = min[1] - cell;
    this.oz = min[2] - cell;
    this.nx = Math.ceil((max[0] - min[0]) / cell) + 3;
    this.ny = Math.ceil((max[1] - min[1]) / cell) + 3;
    this.nz = Math.ceil((max[2] - min[2]) / cell) + 3;
    this.cnx = Math.ceil(this.nx / CHUNK);
    this.cny = Math.ceil(this.ny / CHUNK);
    this.cnz = Math.ceil(this.nz / CHUNK);
    [this.wx, this.wy, this.wz] = o.window;
    // Boxes reach from a block's first point to one past its last (so joins out of the block are covered too).
    this.chunkBox = new RAPIER.Cuboid((CHUNK * cell) / 2, (CHUNK * cell) / 2, (CHUNK * cell) / 2);
    this.blockBox = new RAPIER.Cuboid((BLOCK * cell) / 2, (BLOCK * cell) / 2, (BLOCK * cell) / 2);
    this.pred = (c) => q.solid(c);
  }

  // ── Measuring ──

  private key(cx: number, cy: number, cz: number): number {
    return (cx * this.cny + cy) * this.cnz + cz;
  }

  /** A point's place in the world. */
  centre(i: number, j: number, k: number, out: V): V {
    out.x = this.ox + (i + 0.5) * this.cell;
    out.y = this.oy + (j + 0.5) * this.cell;
    out.z = this.oz + (k + 0.5) * this.cell;
    return out;
  }

  /** Is something solid between a and b? (`trim`: ignore this much at b's end, where sources sit on surfaces.) */
  blocked(a: V, b: V, trim = 0): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len - trim <= 1e-3) return false;
    const r = this.ray;
    r.origin.x = a.x;
    r.origin.y = a.y;
    r.origin.z = a.z;
    r.dir.x = dx / len;
    r.dir.y = dy / len;
    r.dir.z = dz / len;
    this.stats.rays++;
    return !!this.q.world.castRay(r, len - trim, true, FLAGS, undefined, this.q.exclude(), undefined, this.pred);
  }

  private axisBlocked(c: V, axis: 0 | 1 | 2): boolean {
    const r = this.ray;
    r.origin.x = c.x;
    r.origin.y = c.y;
    r.origin.z = c.z;
    r.dir.x = axis === 0 ? 1 : 0;
    r.dir.y = axis === 1 ? 1 : 0;
    r.dir.z = axis === 2 ? 1 : 0;
    this.stats.rays++;
    return !!this.q.world.castRay(r, this.cell, true, FLAGS, undefined, this.q.exclude(), undefined, this.pred);
  }

  /** Is anything solid in a box of `n` points from (i, j, k), reaching one point past them? */
  private boxEmpty(i: number, j: number, k: number, shape: RAPIER.Cuboid, n: number): boolean {
    const p = this.pos, c = this.cell;
    p.x = this.ox + (i + 0.5 + n / 2) * c;
    p.y = this.oy + (j + 0.5 + n / 2) * c;
    p.z = this.oz + (k + 0.5 + n / 2) * c;
    this.stats.boxes++;
    return !this.q.world.intersectionWithShape(p, this.rot, shape, FLAGS, undefined, this.q.exclude(), undefined, this.pred);
  }

  private tmp: V = { x: 0, y: 0, z: 0 };

  /** Measure one point's three joins. */
  private measure(i: number, j: number, k: number): number {
    const c = this.centre(i, j, k, this.tmp);
    this.stats.cells++;
    return (this.axisBlocked(c, 0) ? 0 : PX) | (this.axisBlocked(c, 1) ? 0 : PY) | (this.axisBlocked(c, 2) ? 0 : PZ);
  }

  /** Measure some of a chunk; true when it's done. */
  private buildChunk(ch: Chunk, cx: number, cy: number, cz: number, until: number): boolean {
    if (ch.next < 0) {
      ch.next = 0;
      if (this.boxEmpty(cx * CHUNK, cy * CHUNK, cz * CHUNK, this.chunkBox, CHUNK)) {
        ch.bits = null;
        ch.next = BLOCKS;
        return true;
      }
      ch.bits = new Uint8Array(CHUNK_CELLS);
    }
    const per = CHUNK / BLOCK;
    while (ch.next < BLOCKS) {
      const b = ch.next;
      const bi = Math.floor(b / (per * per)), bj = Math.floor(b / per) % per, bk = b % per;
      const i0 = cx * CHUNK + bi * BLOCK, j0 = cy * CHUNK + bj * BLOCK, k0 = cz * CHUNK + bk * BLOCK;
      // (A block is all open, or measured a point at a time — resumable, so a frame never takes a whole block.)
      if (ch.cell === 0 && this.boxEmpty(i0, j0, k0, this.blockBox, BLOCK)) ch.cell = -1;
      while (ch.cell < BLOCK ** 3) {
        const q = ch.cell < 0 ? 0 : ch.cell;
        const a = q >> 4, bb = (q >> 2) & 3, cc = q & 3;
        const li = (bi * BLOCK + a) * CHUNK * CHUNK + (bj * BLOCK + bb) * CHUNK + (bk * BLOCK + cc);
        if (ch.cell < 0) {
          // (All open: fill the block's points at once.)
          for (let n = 0; n < BLOCK ** 3; n++) ch.bits![(bi * BLOCK + (n >> 4)) * CHUNK * CHUNK + (bj * BLOCK + ((n >> 2) & 3)) * CHUNK + (bk * BLOCK + (n & 3))] = ALL;
          ch.cell = BLOCK ** 3;
          break;
        }
        ch.bits![li] = this.measure(i0 + a, j0 + bb, k0 + cc);
        ch.cell++;
        if ((ch.cell & 7) === 0 && performance.now() > until) return false;
      }
      ch.next++;
      ch.cell = 0;
      if (performance.now() > until) return ch.next >= BLOCKS;
    }
    return true;
  }

  /** The joins of a point (0 where not measured yet or outside the grid). */
  joins(i: number, j: number, k: number): number {
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return 0;
    const ch = this.chunks.get(this.key(Math.floor(i / CHUNK), Math.floor(j / CHUNK), Math.floor(k / CHUNK)));
    if (!ch || ch.next < BLOCKS) return 0;
    if (!ch.bits) return ALL;
    return ch.bits[(i % CHUNK) * CHUNK * CHUNK + (j % CHUNK) * CHUNK + (k % CHUNK)]!;
  }

  /** Grid coordinates of a point in the world (may be outside the grid). */
  cellOf(p: V): [number, number, number] {
    return [Math.floor((p.x - this.ox) / this.cell), Math.floor((p.y - this.oy) / this.cell), Math.floor((p.z - this.oz) / this.cell)];
  }

  /** Something solid moved or appeared in this box (world units): measure the points there again. */
  invalidate(min: V, max: V): void {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((min.x - this.ox) / c) - 1), i1 = Math.min(this.nx - 1, Math.floor((max.x - this.ox) / c) + 1);
    const j0 = Math.max(0, Math.floor((min.y - this.oy) / c) - 1), j1 = Math.min(this.ny - 1, Math.floor((max.y - this.oy) / c) + 1);
    const k0 = Math.max(0, Math.floor((min.z - this.oz) / c) - 1), k1 = Math.min(this.nz - 1, Math.floor((max.z - this.oz) / c) + 1);
    if (i0 > i1 || j0 > j1 || k0 > k1) return;
    if ((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1) > CHUNK_CELLS) {
      // (Big: just measure those chunks again from scratch.)
      for (let cx = Math.floor(i0 / CHUNK); cx <= Math.floor(i1 / CHUNK); cx++)
        for (let cy = Math.floor(j0 / CHUNK); cy <= Math.floor(j1 / CHUNK); cy++)
          for (let cz = Math.floor(k0 / CHUNK); cz <= Math.floor(k1 / CHUNK); cz++) this.chunks.delete(this.key(cx, cy, cz));
      this.epoch++;
      return;
    }
    this.dirty.push({ box: [i0, j0, k0, i1, j1, k1], at: 0 });
  }

  /** Points left to measure again. */
  get pending(): number {
    return this.dirty.length;
  }

  /**
   * Measure for a while (until `until`, a performance.now() time): first what changed, then (`more`) the
   * unmeasured chunks nearest `near`, within the flood's window. Returns true while there's more to do.
   */
  build(near: V, until: number, more = true): boolean {
    while (this.dirty.length) {
      const d = this.dirty[0]!;
      const [i0, j0, k0, i1, j1, k1] = d.box;
      const ny = j1 - j0 + 1, nz = k1 - k0 + 1, total = (i1 - i0 + 1) * ny * nz;
      // (A point at a time, so a big change is spread over frames.)
      while (d.at < total) {
        const n = d.at++;
        const i = i0 + Math.floor(n / (ny * nz)), j = j0 + (Math.floor(n / nz) % ny), k = k0 + (n % nz);
        const ch = this.chunks.get(this.key(Math.floor(i / CHUNK), Math.floor(j / CHUNK), Math.floor(k / CHUNK)));
        // (Not measured yet: it will be measured as it is now.)
        if (ch && ch.next >= BLOCKS) {
          const v = this.measure(i, j, k);
          if (ch.bits || v !== ALL) {
            ch.bits ??= new Uint8Array(CHUNK_CELLS).fill(ALL);
            ch.bits[(i % CHUNK) * CHUNK * CHUNK + (j % CHUNK) * CHUNK + (k % CHUNK)] = v;
          }
        }
        if ((n & 15) === 15 && performance.now() > until) return true;
      }
      this.dirty.shift();
      this.epoch++;
      if (performance.now() > until) return true;
    }
    if (!more) return false;
    const want = this.nearestUnbuilt(near);
    if (!want) return false;
    const [cx, cy, cz] = want;
    const key = this.key(cx, cy, cz);
    let ch = this.chunks.get(key);
    if (!ch) this.chunks.set(key, (ch = { bits: null, next: -1, cell: 0 }));
    if (this.buildChunk(ch, cx, cy, cz, until)) this.epoch++;
    return true;
  }

  /** The unmeasured chunk nearest a place, among those the flood's window around it touches, or null. */
  private nearestUnbuilt(p: V): [number, number, number] | null {
    const [i, j, k] = this.cellOf(p);
    const r = [Math.ceil(this.wx / 2 / CHUNK), Math.ceil(this.wy / 2 / CHUNK), Math.ceil(this.wz / 2 / CHUNK)] as const;
    const ci = Math.floor(i / CHUNK), cj = Math.floor(j / CHUNK), ck = Math.floor(k / CHUNK);
    let best: [number, number, number] | null = null, bestD = Infinity;
    for (let cx = ci - r[0]; cx <= ci + r[0]; cx++) {
      if (cx < 0 || cx >= this.cnx) continue;
      for (let cy = cj - r[1]; cy <= cj + r[1]; cy++) {
        if (cy < 0 || cy >= this.cny) continue;
        for (let cz = ck - r[2]; cz <= ck + r[2]; cz++) {
          if (cz < 0 || cz >= this.cnz) continue;
          const ch = this.chunks.get(this.key(cx, cy, cz));
          if (ch && ch.next >= BLOCKS) continue;
          // (Distance from the ears' point to the chunk's middle, in points; vertical counts double.)
          const d = Math.abs((cx + 0.5) * CHUNK - i) + 2 * Math.abs((cy + 0.5) * CHUNK - j) + Math.abs((cz + 0.5) * CHUNK - k);
          // (One already started is finished first.)
          const dd = ch ? d - 1e6 : d;
          if (dd < bestD) [best, bestD] = [[cx, cy, cz], dd];
        }
      }
    }
    return best;
  }

  /** Chunks measured (and kept), and bytes they take. */
  get memory(): { chunks: number; bytes: number } {
    let bytes = 0;
    for (const c of this.chunks.values()) bytes += c.bits?.byteLength ?? 0;
    const n = this.wx * this.wy * this.wz;
    if (this.open) bytes += n * (1 + 2 * 12 + 8 * 2);
    return { chunks: this.chunks.size, bytes };
  }

  // ── The flood ──

  private field(): Field {
    const n = this.wx * this.wy * this.wz;
    return { dist: new Float32Array(n), parent: new Int32Array(n), stamp: new Uint32Array(n), gen: 0, x0: 0, y0: 0, z0: 0, from: { x: 0, y: 0, z: 0 }, ready: false };
  }

  /** The flood that's done (null: none yet). */
  get current(): { from: V; epoch: number } | null {
    return this.front?.ready ? { from: this.front.from, epoch: this.frontEpoch } : null;
  }

  private frontEpoch = -1;
  private backEpoch = -1;

  /** Start a flood from the ears at `p`, out to `maxDist` (u) of travel. */
  startFlood(p: V, maxDist: number): void {
    const n = this.wx * this.wy * this.wz;
    if (!this.open) {
      this.open = new Uint8Array(n);
      this.front = this.field();
      this.back = this.field();
      // (A point is pushed again only when a shorter way to it turns up: room for two per point is plenty.)
      this.heapId = new Int32Array(n * 2);
      this.heapKey = new Float32Array(n * 2);
    }
    const f = this.back!;
    const [ci, cj, ck] = this.cellOf(p);
    f.x0 = ci - (this.wx >> 1);
    f.y0 = cj - (this.wy >> 1);
    f.z0 = ck - (this.wz >> 1);
    f.from = { x: p.x, y: p.y, z: p.z };
    f.ready = false;
    f.gen++;
    if (f.gen === 0xffffffff) {
      f.stamp.fill(0);
      f.gen = 1;
    }
    this.backEpoch = this.epoch;
    this.heapSize = 0;
    this.floodMax = maxDist;
    // (The window's joins are copied in first, a chunk at a time; then the flood seeds and runs.)
    this.copyAt = 0;
    this.open!.fill(0);
    this.flooding = true;
    this.seeded = false;
    this.stats.floods++;
  }

  private copyAt = 0;
  private seeded = false;

  /** Seeds: the eight points round the ears that the ears can reach in a straight line. */
  private seed(f: Field): void {
    const p = f.from;
    const i0 = Math.floor((p.x - this.ox) / this.cell - 0.5), j0 = Math.floor((p.y - this.oy) / this.cell - 0.5), k0 = Math.floor((p.z - this.oz) / this.cell - 0.5);
    const c = this.tmp;
    for (let a = 0; a < 8; a++) {
      const i = i0 + (a & 1), j = j0 + ((a >> 1) & 1), k = k0 + ((a >> 2) & 1);
      const w = this.local(f, i, j, k);
      if (w < 0) continue;
      this.centre(i, j, k, c);
      const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
      if (this.blocked(p, c)) continue;
      this.reach(f, w, d, -1);
    }
    // (None: the ears are inside something, and nothing reaches them through the air.)
    this.seeded = true;
  }

  /** A grid point's index in a field's window, or −1 outside it. */
  private local(f: Field, i: number, j: number, k: number): number {
    const x = i - f.x0, y = j - f.y0, z = k - f.z0;
    if (x < 0 || y < 0 || z < 0 || x >= this.wx || y >= this.wy || z >= this.wz) return -1;
    return (x * this.wy + y) * this.wz + z;
  }

  /**
   * Copy the window's joins out of the chunks into one flat array (fast to read while flooding), a chunk at a
   * time from `copyAt`, until `until`. True when all are copied.
   */
  private copyJoins(f: Field, until: number): boolean {
    const open = this.open!;
    const wx = this.wx, wy = this.wy, wz = this.wz;
    const ca = Math.floor(Math.max(0, f.x0) / CHUNK), cb = Math.floor(Math.max(0, f.y0) / CHUNK), cc = Math.floor(Math.max(0, f.z0) / CHUNK);
    const na = Math.max(0, Math.ceil(Math.min(this.nx, f.x0 + wx) / CHUNK) - ca);
    const nb = Math.max(0, Math.ceil(Math.min(this.ny, f.y0 + wy) / CHUNK) - cb);
    const nc = Math.max(0, Math.ceil(Math.min(this.nz, f.z0 + wz) / CHUNK) - cc);
    while (this.copyAt < na * nb * nc) {
      const n = this.copyAt++;
      const cx = ca + Math.floor(n / (nb * nc)), cy = cb + (Math.floor(n / nc) % nb), cz = cc + (n % nc);
      const ch = this.chunks.get(this.key(cx, cy, cz));
      if (!ch || ch.next < BLOCKS) continue;
      const bits = ch.bits;
      const xa = Math.max(cx * CHUNK, f.x0, 0), xb = Math.min((cx + 1) * CHUNK, f.x0 + wx, this.nx);
      const ya = Math.max(cy * CHUNK, f.y0, 0), yb = Math.min((cy + 1) * CHUNK, f.y0 + wy, this.ny);
      const za = Math.max(cz * CHUNK, f.z0, 0), zb = Math.min((cz + 1) * CHUNK, f.z0 + wz, this.nz);
      for (let i = xa; i < xb; i++)
        for (let j = ya; j < yb; j++) {
          const w = ((i - f.x0) * wy + (j - f.y0)) * wz + (za - f.z0);
          if (!bits) {
            open.fill(ALL, w, w + (zb - za));
            continue;
          }
          const li = (i - cx * CHUNK) * CHUNK * CHUNK + (j - cy * CHUNK) * CHUNK + (za - cz * CHUNK);
          open.set(bits.subarray(li, li + (zb - za)), w);
        }
      if (performance.now() > until) return this.copyAt >= na * nb * nc;
    }
    return true;
  }

  private reach(f: Field, w: number, d: number, from: number): void {
    if (d > this.floodMax) return;
    if (f.stamp[w] === f.gen && f.dist[w]! <= d) return;
    f.stamp[w] = f.gen;
    f.dist[w] = d;
    f.parent[w] = from;
    if (this.heapSize >= this.heapId!.length) return;
    // (Push and sift up.)
    const ids = this.heapId!, keys = this.heapKey!;
    let i = this.heapSize++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (keys[up]! <= d) break;
      ids[i] = ids[up]!;
      keys[i] = keys[up]!;
      i = up;
    }
    ids[i] = w;
    keys[i] = d;
  }

  private popKey = 0;

  /**
   * Flood on until `until` (a performance.now() time). `targets`: window points that still need reaching; the
   * flood stops early once they all are. Returns true when the flood is done.
   */
  stepFlood(until: number, targets?: () => boolean): boolean {
    if (!this.flooding) return true;
    const f = this.back!;
    if (!this.seeded) {
      if (!this.copyJoins(f, until)) return false;
      this.seed(f);
      if (performance.now() > until) return false;
    }
    const open = this.open!, dist = f.dist, stamp = f.stamp, parent = f.parent, gen = f.gen;
    const wx = this.wx, wy = this.wy, wz = this.wz, sx = wy * wz, c = this.cell, diag = c * Math.SQRT2;
    const ids = this.heapId!, keys = this.heapKey!, cap = ids.length, max = this.floodMax;
    let size = this.heapSize, n = 0;
    // (Settle `to` at `d` if that's nearer, and put it on the heap.)
    const push = (to: number, d: number, from: number) => {
      if (d > max || (stamp[to] === gen && dist[to]! <= d)) return;
      stamp[to] = gen;
      dist[to] = d;
      parent[to] = from;
      if (size >= cap) return;
      let i = size++;
      while (i > 0) {
        const up = (i - 1) >> 1;
        if (keys[up]! <= d) break;
        ids[i] = ids[up]!;
        keys[i] = keys[up]!;
        i = up;
      }
      ids[i] = to;
      keys[i] = d;
    };
    while (size > 0) {
      const d = keys[0]!, w = ids[0]!;
      // (Pop the nearest.)
      const last = --size;
      if (last > 0) {
        const lid = ids[last]!, lk = keys[last]!;
        let i = 0;
        for (;;) {
          let ch = 2 * i + 1;
          if (ch >= last) break;
          if (ch + 1 < last && keys[ch + 1]! < keys[ch]!) ch++;
          if (keys[ch]! >= lk) break;
          ids[i] = ids[ch]!;
          keys[i] = keys[ch]!;
          i = ch;
        }
        ids[i] = lid;
        keys[i] = lk;
      }
      if (dist[w]! < d) continue;
      this.stats.visits++;
      const z = w % wz, y = ((w - z) / wz) % wy, x = (w - z - y * wz) / sx;
      const o = open[w]!;
      const ox = x > 0 ? open[w - sx]! : 0, oz = z > 0 ? open[w - 1]! : 0;
      const xp = o & PX && x + 1 < wx, xm = ox & PX, zp = o & PZ && z + 1 < wz, zm = oz & PZ;
      // Along the axes.
      if (xp) push(w + sx, d + c, w);
      if (xm) push(w - sx, d + c, w);
      if (o & PY && y + 1 < wy) push(w + wz, d + c, w);
      if (y > 0 && open[w - wz]! & PY) push(w - wz, d + c, w);
      if (zp) push(w + 1, d + c, w);
      if (zm) push(w - 1, d + c, w);
      // Level diagonals, where both ways round the corner are open (so distances aren't blocky).
      if (xp && zp && open[w + sx]! & PZ && open[w + 1]! & PX) push(w + sx + 1, d + diag, w);
      if (xp && zm && open[w + sx - 1]! & PZ && open[w - 1]! & PX) push(w + sx - 1, d + diag, w);
      if (xm && zp && open[w - sx]! & PZ && open[w - sx + 1]! & PX) push(w - sx + 1, d + diag, w);
      if (xm && zm && open[w - sx - 1]! & PZ && open[w - sx - 1]! & PX) push(w - sx - 1, d + diag, w);
      if ((++n & 255) === 0) {
        this.heapSize = size;
        this.popKey = size ? keys[0]! : Infinity;
        if (targets && targets()) break;
        if (performance.now() > until) return false;
      }
    }
    this.heapSize = size;
    this.finish();
    return true;
  }

  private finish(): void {
    this.flooding = false;
    const t = this.front!;
    this.front = this.back!;
    this.back = t;
    this.front.ready = true;
    this.frontEpoch = this.backEpoch;
  }

  /** Has the flood under way reached a place (its nearest point)? For stopping early. */
  reachedInFlood(p: V): boolean {
    const f = this.back;
    if (!f || !this.flooding) return true;
    const w = this.local(f, Math.floor((p.x - this.ox) / this.cell), Math.floor((p.y - this.oy) / this.cell), Math.floor((p.z - this.oz) / this.cell));
    if (w < 0) return true;
    return f.stamp[w] === f.gen && f.dist[w]! <= this.popKey;
  }

  private scratch = new Int32Array(256);

  /**
   * How far sound goes through the air from the ears (as of the last flood) to `p`, and a point along the way
   * near the ears that shows which way it arrives from. Null: it can't get there through the air (or no flood).
   */
  pathTo(p: V, out: { dist: number; via: V }): boolean {
    const f = this.front;
    if (!f?.ready) return false;
    const i0 = Math.floor((p.x - this.ox) / this.cell - 0.5), j0 = Math.floor((p.y - this.oy) / this.cell - 0.5), k0 = Math.floor((p.z - this.oz) / this.cell - 0.5);
    // The eight points round the source, nearest by travel first; the first the source can see is the way in.
    let tries = 0;
    let used = 0;
    const c = this.tmp;
    while (tries < 8) {
      let best = -1, bestD = Infinity, bestA = -1;
      for (let a = 0; a < 8; a++) {
        if (used & (1 << a)) continue;
        const i = i0 + (a & 1), j = j0 + ((a >> 1) & 1), k = k0 + ((a >> 2) & 1);
        const w = this.local(f, i, j, k);
        if (w < 0 || f.stamp[w] !== f.gen) continue;
        this.centre(i, j, k, c);
        const d = f.dist[w]! + Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
        if (d < bestD) [best, bestD, bestA] = [w, d, a];
      }
      if (best < 0) return false;
      used |= 1 << bestA;
      tries++;
      const i = i0 + (bestA & 1), j = j0 + ((bestA >> 1) & 1), k = k0 + ((bestA >> 2) & 1);
      this.centre(i, j, k, c);
      if (this.blocked(c, p, 4)) continue;
      out.dist = bestD;
      this.via(f, best, bestD, p, out.via);
      return true;
    }
    return false;
  }

  /** The way a path arrives at the ears: the middle of its points between one and four spacings out. */
  private via(f: Field, w: number, total: number, p: V, out: V): void {
    const s = this.scratch;
    let n = 0;
    for (let at = w; at >= 0 && n < s.length; at = f.parent[at]!) s[n++] = at;
    const lo = this.cell, hi = this.cell * 4;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (let q = n - 1; q >= 0; q--) {
      const at = s[q]!, d = f.dist[at]!;
      if (d < lo) continue;
      if (d > hi) break;
      const z = at % this.wz, y = ((at - z) / this.wz) % this.wy, x = (at - z - y * this.wz) / (this.wy * this.wz);
      this.centre(x + f.x0, y + f.y0, z + f.z0, this.tmp);
      sx += this.tmp.x;
      sy += this.tmp.y;
      sz += this.tmp.z;
      m++;
    }
    if (m) {
      out.x = sx / m;
      out.y = sy / m;
      out.z = sz / m;
    } else if (total <= hi) {
      out.x = p.x;
      out.y = p.y;
      out.z = p.z;
    } else {
      // (Path longer than the scratch: arrives from its last point kept.)
      const at = s[n - 1]!;
      const z = at % this.wz, y = ((at - z) / this.wz) % this.wy, x = (at - z - y * this.wz) / (this.wy * this.wz);
      this.centre(x + f.x0, y + f.y0, z + f.z0, out);
    }
  }
}
