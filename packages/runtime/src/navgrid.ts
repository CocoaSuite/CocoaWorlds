/**
 * Navigation (A2): where creatures can walk, as a grid of standing spots measured from the level itself.
 *
 * Every column of the grid is probed with rays straight down, so each floor in it (a room, the floor above,
 * a bridge) becomes a spot. A spot counts if the ground is not too steep and a creature-sized capsule fits
 * there without touching the level (so spots keep a creature's width away from walls, and under low ceilings
 * there are none). Neighbouring spots join when one step (or a short drop) gets from one to the other.
 * Paths are found with A* and then pulled straight wherever a straight walk stays on walkable spots.
 */
import RAPIER from '@dimforge/rapier3d-compat';

type V = { x: number; y: number; z: number };

export interface NavOptions {
  /** Grid spacing (u). */
  cell: number;
  /** The capsule that must fit: radius and height. */
  radius: number;
  height: number;
  /** The highest step up between neighbouring spots. */
  climb: number;
  /** The furthest drop down (one way). */
  drop: number;
  /** Steepest walkable ground (degrees). */
  slope: number;
  /** At most this many columns along each side (the cell grows on very large levels). */
  maxSide: number;
}

export const NAV_DEFAULTS: NavOptions = { cell: 16, radius: 16, height: 72, climb: 20, drop: 64, slope: 46, maxSide: 400 };

/** What the grid asks of the physics world. */
export interface NavQuery {
  world: RAPIER.World;
  /** Colliders that are ground and walls (fixed level pieces, not zones, doors or crates). */
  solid(c: RAPIER.Collider): boolean;
}

const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

export class NavGrid {
  /** Spot positions (x, y, z per spot). */
  readonly xyz: Float32Array;
  /** Spots by column: those in column c are colStart[c] … colStart[c + 1] − 1 (lowest first). */
  private colStart: Int32Array;
  private colOf: Int32Array;
  /** Each spot's neighbour in the 8 directions (NEIGHBOURS order), −1 for none; diagonals only where both sides are open. */
  private nb: Int32Array;
  readonly cell: number;
  private ox: number;
  private oz: number;
  private nx: number;
  private nz: number;

  private constructor(
    spots: number[],
    colOf: number[],
    cell: number,
    ox: number,
    oz: number,
    nx: number,
    nz: number,
    private o: NavOptions,
  ) {
    this.xyz = Float32Array.from(spots);
    this.colOf = Int32Array.from(colOf);
    this.cell = cell;
    this.ox = ox;
    this.oz = oz;
    this.nx = nx;
    this.nz = nz;
    this.colStart = new Int32Array(nx * nz + 1);
    for (const c of colOf) this.colStart[c + 1]!++;
    for (let c = 0; c < nx * nz; c++) this.colStart[c + 1]! += this.colStart[c]!;
    const n = colOf.length;
    this.nb = new Int32Array(n * 8).fill(-1);
    for (let a = 0; a < n; a++) {
      const c = colOf[a]!, i = c % nx, j = Math.floor(c / nx);
      for (let k = 0; k < 4; k++) this.nb[a * 8 + k] = this.neighbourIn(a, i + NEIGHBOURS[k]![0], j + NEIGHBOURS[k]![1]);
    }
    for (let a = 0; a < n; a++) {
      const c = colOf[a]!, i = c % nx, j = Math.floor(c / nx);
      for (let k = 4; k < 8; k++) {
        const [di, dj] = NEIGHBOURS[k]!;
        if (this.nb[a * 8 + (di > 0 ? 0 : 1)]! < 0 || this.nb[a * 8 + (dj > 0 ? 2 : 3)]! < 0) continue;
        this.nb[a * 8 + k] = this.neighbourIn(a, i + di, j + dj);
      }
    }
  }

  get count(): number {
    return this.colOf.length;
  }

  /** Measure the level between `min` and `max` (world, u). */
  static build(q: NavQuery, min: [number, number, number], max: [number, number, number], opts: Partial<NavOptions> = {}): NavGrid {
    const o = { ...NAV_DEFAULTS, ...opts };
    const sx = max[0] - min[0], sz = max[2] - min[2];
    const cell = Math.max(o.cell, Math.ceil(Math.max(sx, sz) / o.maxSide));
    const nx = Math.max(1, Math.ceil(sx / cell)), nz = Math.max(1, Math.ceil(sz / cell));
    const top = max[1] + 1, bottom = min[1] - 1;
    const minUp = Math.cos((o.slope * Math.PI) / 180);
    const filter = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const seg = Math.max(0, (o.height - o.climb) / 2 - o.radius);
    const capsule = new RAPIER.Capsule(seg, o.radius);
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const pass = (c: RAPIER.Collider) => q.solid(c);
    const spots: number[] = [];
    const colOf: number[] = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = min[0] + (i + 0.5) * cell, z = min[2] + (j + 0.5) * cell;
        let y = top;
        const found: number[] = [];
        for (let guard = 0; guard < 32 && y > bottom; guard++) {
          const hit = q.world.castRayAndGetNormal(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }), y - bottom, true, filter, undefined, undefined, undefined, pass);
          if (!hit) break;
          const floor = y - hit.timeOfImpact;
          if (hit.timeOfImpact > 0 && hit.normal.y >= minUp) found.push(floor);
          // Through to the underside of whatever was hit, then on down.
          const out = q.world.castRay(new RAPIER.Ray({ x, y: floor - 0.01, z }, { x: 0, y: -1, z: 0 }), floor - bottom, false, filter, undefined, undefined, undefined, pass);
          y = out ? floor - 0.01 - out.timeOfImpact - 0.01 : bottom;
        }
        for (let k = found.length - 1; k >= 0; k--) {
          const f = found[k]!;
          // The creature from just over a step above the ground to its full height must touch nothing.
          const centre = f + o.climb + (o.height - o.climb) / 2;
          if (q.world.intersectionWithShape({ x, y: centre, z }, rot, capsule, filter, undefined, undefined, undefined, pass)) continue;
          spots.push(x, f, z);
          colOf.push(j * nx + i);
        }
      }
    }
    return new NavGrid(spots, colOf, cell, min[0], min[2], nx, nz, o);
  }

  private at(id: number): V {
    return { x: this.xyz[id * 3]!, y: this.xyz[id * 3 + 1]!, z: this.xyz[id * 3 + 2]! };
  }

  private colIndex(x: number, z: number): [number, number] {
    return [Math.floor((x - this.ox) / this.cell), Math.floor((z - this.oz) / this.cell)];
  }

  /** The first spot in column (i, j) and one past the last (an empty range off the grid). */
  private range(i: number, j: number): [number, number] {
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return [0, 0];
    const c = j * this.nx + i;
    return [this.colStart[c]!, this.colStart[c + 1]!];
  }

  /** Can a walker get from spot a straight to spot b (a neighbour)? */
  private joins(a: number, b: number): boolean {
    const dy = this.xyz[b * 3 + 1]! - this.xyz[a * 3 + 1]!;
    return dy <= this.o.climb && dy >= -this.o.drop;
  }

  /** The neighbour of spot `a` in column (i, j) it joins, if any. */
  private neighbourIn(a: number, i: number, j: number): number {
    let best = -1, bestDy = Infinity;
    const [b0, b1] = this.range(i, j);
    for (let b = b0; b < b1; b++) {
      if (!this.joins(a, b)) continue;
      const dy = Math.abs(this.xyz[b * 3 + 1]! - this.xyz[a * 3 + 1]!);
      if (dy < bestDy) {
        best = b;
        bestDy = dy;
      }
    }
    return best;
  }

  /** The spot nearest a position: in its column at about its height, else close by. */
  nearest(p: V, reach = 4): number {
    const [ci, cj] = this.colIndex(p.x, p.z);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= reach; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          const [s0, s1] = this.range(i, j);
          for (let s = s0; s < s1; s++) {
            const dy = this.xyz[s * 3 + 1]! - p.y;
            // (Not a floor far above, nor one far below.)
            if (dy > this.o.climb + 8 || dy < -this.o.drop - this.o.height) continue;
            const d = Math.hypot(this.xyz[s * 3]! - p.x, dy * 2, this.xyz[s * 3 + 2]! - p.z);
            if (d < bestD) {
              best = s;
              bestD = d;
            }
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  /** Every link between spots (for drawing in the editor). */
  links(): [number, number][] {
    const out: [number, number][] = [];
    for (let a = 0; a < this.count; a++) {
      for (let k = 0; k < 4; k++) {
        const b = this.nb[a * 8 + k]!;
        if (b > a || (b >= 0 && !this.joins(b, a))) out.push([a, b]);
      }
    }
    return out;
  }

  /**
   * A walkable way from one place to another: the corners to head for in turn, ending at `to` itself (or at the
   * nearest spot to it that can be reached). Null when either end is off the grid or nothing joins them.
   */
  path(from: V, to: V, maxVisits = 40000): V[] | null {
    const start = this.nearest(from), goal = this.nearest(to);
    if (start < 0 || goal < 0) return null;
    if (start === goal || this.straight(start, goal)) return [{ ...to }];
    const n = this.count;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const gp = this.at(goal);
    const h = (s: number) => Math.hypot(this.xyz[s * 3]! - gp.x, this.xyz[s * 3 + 2]! - gp.z);
    // (Weighted A*: leaning towards the goal visits far fewer spots; the straightening below hides the difference.)
    g[start] = 0;
    heap.push(start, 1.5 * h(start));
    let best = start, bestH = h(start), visits = 0;
    while (heap.size && visits++ < maxVisits) {
      const a = heap.pop();
      if (closed[a]) continue;
      closed[a] = 1;
      if (a === goal) {
        best = a;
        break;
      }
      const ha = h(a);
      if (ha < bestH) {
        best = a;
        bestH = ha;
      }
      for (let k = 0; k < 8; k++) {
        const b = this.nb[a * 8 + k]!;
        if (b < 0 || closed[b]) continue;
        const step = k < 4 ? this.cell : this.cell * Math.SQRT2;
        const ng = g[a]! + step + Math.max(0, this.xyz[b * 3 + 1]! - this.xyz[a * 3 + 1]!);
        if (ng < g[b]!) {
          g[b] = ng;
          came[b] = a;
          heap.push(b, ng + 1.5 * h(b));
        }
      }
    }
    if (best === start && start !== goal) return null;
    const chain: number[] = [];
    for (let s = best; s >= 0; s = came[s]!) chain.push(s);
    chain.reverse();
    // Pull it straight: from each corner, on to the furthest spot reachable in a straight walk.
    const out: V[] = [];
    let k = 0;
    while (k < chain.length - 1) {
      // (Further and further while it stays straight, then halve back to the last that does.)
      const last = chain.length - 1;
      let far = k + 1, step = 2;
      while (far < last) {
        const m = Math.min(last, k + step);
        if (!this.straight(chain[k]!, chain[m]!)) break;
        far = m;
        step *= 2;
      }
      let hi = Math.min(last, k + step);
      while (hi - far > 1) {
        const m = (far + hi) >> 1;
        if (this.straight(chain[k]!, chain[m]!)) far = m;
        else hi = m;
      }
      out.push(this.at(chain[far]!));
      k = far;
    }
    if (best === goal) out[out.length - 1] = { ...to };
    return out.length ? out : [{ ...to }];
  }

  /** Whether a straight walk from spot a to spot b stays on joined spots all the way. */
  private straight(a: number, b: number): boolean {
    const A = this.at(a), B = this.at(b);
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const steps = Math.ceil(len / (this.cell / 2));
    let prev = a;
    // (A creature is as wide as a spot: check a little either side of the line too.)
    const side = { x: -(B.z - A.z) / (len || 1), z: (B.x - A.x) / (len || 1) };
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
      let next = -1;
      for (const off of [0, this.cell * 0.45, -this.cell * 0.45]) {
        const [i, j] = this.colIndex(x + side.x * off, z + side.z * off);
        const base = off === 0 ? prev : next;
        const c = this.colOf[base]!;
        const pi = c % this.nx, pj = Math.floor(c / this.nx);
        if (Math.max(Math.abs(i - pi), Math.abs(j - pj)) > 1) return false;
        const n = i === pi && j === pj ? base : this.neighbourIn(base, i, j);
        if (n < 0) return false;
        if (off === 0) next = n;
      }
      prev = next;
    }
    return true;
  }
}

/** A small binary heap of ids by priority. */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      ids[i] = ids[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0]!;
    const id = ids.pop()!, key = keys.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = key;
        if (l < ids.length && keys[l]! < mk) {
          m = l;
          mk = keys[l]!;
        }
        if (r < ids.length && keys[r]! < mk) m = r;
        if (m === i) break;
        ids[i] = ids[m]!;
        keys[i] = keys[m]!;
        i = m;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}
