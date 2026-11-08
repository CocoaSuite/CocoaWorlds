/**
 * How each sound reaches the ears, worked out cheaply and a little at a time:
 *
 * 1. **Straight through.** One ray each way between the ears and the sound finds every wall in between and how
 *    thick it is; each wall takes off dB by its material (see materials.ts) and dulls the highs.
 * 2. **Round through the air.** When walls are in the way, the air grid (grid.ts) gives how far the sound must
 *    travel round corners, along corridors and through open doors, and which way it arrives from. Bending round
 *    costs a little by how much longer the way is.
 *    The louder of the two wins: a sound next door is heard through the open doorway (from the doorway's
 *    direction), or through a thin wall when that's shorter, and a closed door stops the way round.
 * 3. **The room the ears are in.** A few rays from the ears tell a small room from a corridor, a hall, a cave
 *    or the open air, and how hard its surfaces are: that picks the echo when no Sound area says otherwise.
 *
 * Costs are kept down by doing as little as possible: each sound is looked at again only when it or the ears
 * moved, the level changed or its time came (soon when loud and near, rarely when faint), the loudest first, at
 * most a few per frame within a time budget; sounds out of range aren't looked at; the grid is measured once
 * and its flood runs a slice per frame only while some sound is behind a wall. Nothing is allocated per frame.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { Surface } from '@cocoaworlds/core';
import { ACOUSTIC_MATERIALS, MAX_LOSS, bendCutoff, dbToGain, lossCutoff, wallLoss } from './materials';
import { SoundGrid, type AcousticQuery, type GridOptions, type V } from './grid';

export type { V } from './grid';

/** What the World gives acoustics. */
export interface AcousticHost extends AcousticQuery {
  /** What a collider sounds like at a point. */
  surfaceAt(handle: number, at: V): Surface;
  /** The level's bounds (null: empty). */
  extent(): { min: [number, number, number]; max: [number, number, number] } | null;
}

export interface AcousticOptions {
  /** Most time spent per frame (ms), all parts together. */
  budget: number;
  /** Of that, most spent measuring the grid (ms): it's done once per place, so it can take its time. */
  buildBudget: number;
  /** Most sounds looked at again per frame. */
  perFrame: number;
  /** Sooner and later than this, a sound isn't looked at again (s): the loudest at `fastest`, the faintest at `slowest`. */
  fastest: number;
  slowest: number;
  /** Moving this far (u) counts as moved. */
  moved: number;
  /**
   * dB lost bending round: this many per doubling of the extra way (beyond going straight, in units of 48 u).
   * A small detour costs quickly; a long corridor keeps guiding the sound, so it costs ever less per unit.
   */
  bend: number;
  /** Objects smaller than this (radius, u) don't stop sound: it goes round them. */
  small: number;
  /** Work out the echo of the place the ears are in. */
  environment: boolean;
  grid: Partial<GridOptions>;
}

export const ACOUSTIC_DEFAULTS: AcousticOptions = { budget: 0.8, buildBudget: 0.25, perFrame: 6, fastest: 0.08, slowest: 0.9, moved: 16, bend: 6, small: 20, environment: true, grid: {} };

/** Echo the ears' surroundings call for (the stage maps these onto its echoes). */
export type AutoEffect = 'none' | 'room' | 'corridor' | 'hall' | 'cave';

/** One sound being heard: where it is, how far it carries, and (worked out here) how it reaches the ears. */
export class AcousticVoice {
  x = 0;
  y = 0;
  z = 0;
  /** How far it carries (u): full volume within a quarter, silent at the range (the linear fall-off). */
  range = 1024;
  volume = 1;
  // ── Results (set here; `changed` tells the owner to apply them) ──
  /** Volume factor on top of distance (walls, bending round). */
  gain = 1;
  /** Lowpass (Hz). */
  cutoff = 22000;
  /** Where it seems to be (the sound itself, or out along the way it arrives by). */
  vx = 0;
  vy = 0;
  vz = 0;
  /** Arrives round something rather than straight. */
  bent = false;
  /** Within range at all. */
  audible = true;
  /** dB lost through walls going straight (for tests and the console). */
  loss = 0;
  changed = true;
  // ── Bookkeeping ──
  next = 0;
  private lx = NaN;
  private ly = NaN;
  private lz = NaN;
  private sx = NaN;
  private sy = NaN;
  private sz = NaN;
  epoch = -1;
  /** Walls are in the way (so the way round is wanted). */
  occluded = false;
  /** How much it matters now (0…1: volume × fall-off). */
  weight = 0;
  /** Worked out at least once. */
  seen = false;

  /** Note what it was worked out for. */
  mark(l: V, epoch: number): void {
    this.lx = l.x;
    this.ly = l.y;
    this.lz = l.z;
    this.sx = this.x;
    this.sy = this.y;
    this.sz = this.z;
    this.epoch = epoch;
  }

  /** Has it or the ears moved since? */
  movedSince(l: V, d: number): boolean {
    const dd = d * d;
    return (l.x - this.lx) ** 2 + (l.y - this.ly) ** 2 + (l.z - this.lz) ** 2 > dd || (this.x - this.sx) ** 2 + (this.y - this.sy) ** 2 + (this.z - this.sz) ** 2 > dd || this.lx !== this.lx;
  }
}

const FLAGS = RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
/** Most walls one ray keeps track of. */
const MAX_HITS = 32;
/** Ears-round directions for the echo (up first; then level; then up at an angle). */
const PROBE_DIRS: [number, number, number][] = (() => {
  const out: [number, number, number][] = [[0, 1, 0]];
  for (let i = 0; i < 8; i++) out.push([Math.cos((i * Math.PI) / 4), 0, Math.sin((i * Math.PI) / 4)]);
  const e = Math.cos(0.7), u = Math.sin(0.7);
  for (let i = 0; i < 4; i++) out.push([Math.cos((i + 0.5) * (Math.PI / 2)) * e, u, Math.sin((i + 0.5) * (Math.PI / 2)) * e]);
  return out;
})();
const PROBE_REACH = 2400;
const NATURAL: readonly Surface[] = ['stone', 'dirt', 'gravel', 'mud', 'sand', 'snow', 'grass'];

/** Loudest first; among equals, the longest overdue. */
const byUrgency = (a: AcousticVoice, b: AcousticVoice): number => b.weight - a.weight + (a.next - b.next) * 0.5;

/** The linear fall-off the game's sounds use: 1 within a quarter of the range, 0 at the range. */
export function falloff(d: number, range: number): number {
  const ref = Math.max(1, range / 4);
  if (d <= ref) return 1;
  if (d >= range) return 0;
  return 1 - (d - ref) / Math.max(1e-6, range - ref);
}

export class Acoustics {
  readonly o: AcousticOptions;
  private voices: AcousticVoice[] = [];
  private grid: SoundGrid | null | undefined;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  private pred: (c: RAPIER.Collider) => boolean;
  private big = new Map<number, boolean>();
  // Ray hits (reused): handle and distance, forward and back. (Handles are 64-bit floats, not integers.)
  private fH = new Float64Array(MAX_HITS);
  private fT = new Float32Array(MAX_HITS);
  private fN = 0;
  private fC: RAPIER.Collider[] = [];
  private onF: (h: RAPIER.RayColliderIntersection) => boolean;
  private iA = new Float32Array(MAX_HITS);
  private iB = new Float32Array(MAX_HITS);
  private iH = new Float64Array(MAX_HITS);
  private order: number[] = [];
  private path = { dist: 0, via: { x: 0, y: 0, z: 0 } };
  private due: AcousticVoice[] = [];
  private ears: V = { x: NaN, y: NaN, z: NaN };
  private lastFlood = -Infinity;
  private kinematic = new Map<number, { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; r: number }>();
  private nextScan = 0;
  private env: { effect: AutoEffect; mix: number } | null = null;
  private envSeen: { effect: AutoEffect; mix: number } | null = null;
  private envAt: V = { x: NaN, y: NaN, z: NaN };
  private envNext = 0;
  /** Time spent (ms) and work done, for profiling. */
  readonly stats = { frameMs: 0, peakMs: 0, updates: 0, rays: 0, frames: 0, totalMs: 0, phase: [0, 0, 0, 0] as number[] };

  constructor(
    private host: AcousticHost,
    opts: Partial<AcousticOptions> = {},
  ) {
    this.o = { ...ACOUSTIC_DEFAULTS, ...opts };
    this.pred = (c) => host.solid(c) && this.significant(c);
    // (Which colliders count is checked here, on real hits only: as a query filter it would run for every
    // candidate the broad phase finds, which costs several times more.)
    this.onF = (h) => {
      if (this.fN < MAX_HITS && this.pred(h.collider)) {
        this.fC[this.fN] = h.collider;
        this.fH[this.fN] = h.collider.handle;
        this.fT[this.fN++] = h.timeOfImpact;
      }
      return true;
    };
  }

  /** Big enough to stop sound? (Small things — a mug, a carried box — sound goes round.) */
  private significant(c: RAPIER.Collider): boolean {
    let v = this.big.get(c.handle);
    if (v === undefined) {
      v = shapeExtent(c).size >= this.o.small;
      this.big.set(c.handle, v);
    }
    return v;
  }

  /** The air grid (made the first time it's wanted; null for an empty level). */
  private air(): SoundGrid | null {
    if (this.grid !== undefined) return this.grid;
    const x = this.host.extent();
    if (!x) return (this.grid = null);
    return (this.grid = new SoundGrid({ world: this.host.world, solid: this.pred, exclude: () => this.host.exclude() }, x.min, x.max, this.o.grid));
  }

  /** Start hearing a sound. */
  add(at: V, range: number, volume = 1): AcousticVoice {
    const v = new AcousticVoice();
    v.x = v.vx = at.x;
    v.y = v.vy = at.y;
    v.z = v.vz = at.z;
    v.range = range;
    v.volume = volume;
    this.voices.push(v);
    // (Worked out at once where the ears are known, so it never starts heard through a wall.)
    if (this.ears.x === this.ears.x) this.update(v, this.ears);
    return v;
  }

  remove(v: AcousticVoice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) {
      this.voices[i] = this.voices[this.voices.length - 1]!;
      this.voices.pop();
    }
  }

  get count(): number {
    return this.voices.length;
  }

  /** A short sound (a footstep, a hit): how it reaches the ears, once, now. */
  probe(ears: V, at: V, range: number): { gain: number; cutoff: number } {
    const d = Math.hypot(at.x - ears.x, at.y - ears.y, at.z - ears.z);
    if (d < 24 || d > range) return { gain: 1, cutoff: 22000 };
    const loss = this.straight(ears, at, d);
    if (loss < 0.5) return { gain: 1, cutoff: 22000 };
    const g = this.air();
    let best = { gain: dbToGain(loss), cutoff: lossCutoff(loss) };
    if (g?.pathTo(at, this.path)) {
      const bend = this.bendLoss(this.path.dist, d, g.cell);
      const viaPath = falloff(this.path.dist, range) * dbToGain(bend);
      if (viaPath > falloff(d, range) * best.gain) {
        // (Short sounds stay where they are: only louder and brighter for the way round.)
        best = { gain: Math.min(1, viaPath / Math.max(1e-6, falloff(d, range))), cutoff: bendCutoff(bend) };
      }
    }
    return best;
  }

  private bendLoss(path: number, straight: number, cell: number): number {
    // (The grid's way runs up to ~8% longer than the true one, steps and diagonals: that much isn't counted.)
    const extra = Math.max(0, path / 1.08 - straight - cell * 0.5);
    return Math.min(30, this.o.bend * Math.log2(1 + extra / 48));
  }

  /**
   * Each frame: look again at the sounds that are due (loudest first, within budget), flood the grid a slice if
   * a sound behind a wall needs it, measure the grid a little, and now and then the room round the ears.
   */
  frame(ears: V, now: number): void {
    const t0 = performance.now();
    const until = t0 + this.o.budget;
    const e = this.ears;
    e.x = ears.x;
    e.y = ears.y;
    e.z = ears.z;
    const g = this.air();
    const epoch = g?.epoch ?? 0;
    // Which sounds are due.
    const due = this.due;
    due.length = 0;
    let needPath = 0, farthest = 0;
    for (const v of this.voices) {
      const d = Math.hypot(v.x - e.x, v.y - e.y, v.z - e.z);
      v.weight = v.volume * falloff(d, v.range);
      if (d > v.range * 1.05) {
        if (v.audible) {
          v.audible = false;
          v.changed = true;
        }
        v.mark(e, -2);
        continue;
      }
      if (v.occluded) {
        needPath++;
        farthest = Math.max(farthest, v.range);
      }
      // Due when it or the ears moved (by more the farther it is) or the level changed — but no sooner than its
      // time, which comes soon for loud, near sounds and late for faint ones. Nothing moved: nothing to redo
      // (but now and then anyway, in case).
      if (!v.audible || !v.seen || ((v.epoch !== epoch || v.movedSince(e, Math.max(this.o.moved, d * 0.06))) && now >= v.next) || now >= v.next + 2) due.push(v);
    }
    if (due.length > this.o.perFrame) due.sort(byUrgency);
    let n = 0;
    for (const v of due) {
      if (n >= this.o.perFrame || (n > 0 && performance.now() > until)) break;
      this.update(v, e);
      v.epoch = epoch;
      v.next = now + this.o.fastest + (this.o.slowest - this.o.fastest) * (1 - Math.min(1, v.weight));
      n++;
    }
    this.stats.updates += n;
    const t1 = performance.now();
    if (g) {
      // The flood: only while something is behind a wall, and only again once the ears or the level moved on.
      if (g.flooding) {
        const done = g.stepFlood(until, this.allReached);
        // (Done: the sounds behind walls are looked at again straight away, with the new ways round.)
        if (done)
          for (const v of this.voices)
            if (v.occluded) {
              v.next = 0;
              v.epoch = -3;
            }
      } else if (needPath && now - this.lastFlood >= 0.25 && performance.now() < until) {
        const cur = g.current;
        if (!cur || cur.epoch !== g.epoch || Math.hypot(cur.from.x - e.x, cur.from.y - e.y, cur.from.z - e.z) > g.cell * 0.75) {
          this.lastFlood = now;
          g.startFlood(e, Math.min(farthest, 4096));
        }
      }
      // Measuring: what changed first, then the chunks round the ears.
      if (now >= this.nextScan) {
        this.nextScan = now + 0.25;
        this.scanMovers(g);
      }
    }
    const t2 = performance.now();
    if (this.o.environment && now >= this.envNext && performance.now() < until) this.sampleRoom(e, now);
    const t3 = performance.now();
    // Measuring: what changed, always; new places only while a sound is behind a wall (else no way round is
    // wanted, and the grid costs nothing).
    if (g && (needPath || g.pending)) {
      const left = performance.now();
      if (left < until) g.build(e, Math.min(until, left + this.o.buildBudget), needPath > 0);
    }
    const ms = performance.now() - t0;
    const ph = this.stats.phase;
    ph[0] = Math.max(ph[0]!, t1 - t0);
    ph[1] = Math.max(ph[1]!, t2 - t1);
    ph[2] = Math.max(ph[2]!, t3 - t2);
    ph[3] = Math.max(ph[3]!, t0 + ms - t3);
    this.stats.frameMs = ms;
    this.stats.peakMs = Math.max(this.stats.peakMs, ms);
    this.stats.totalMs += ms;
    this.stats.frames++;
  }

  /** Has the flood under way reached every sound behind a wall? (So it can stop early.) */
  private allReached = (): boolean => {
    const g = this.grid!;
    for (const v of this.voices) if (v.occluded && v.audible && !g.reachedInFlood(v)) return false;
    return true;
  };

  /** Work out how one sound reaches the ears now. */
  private update(v: AcousticVoice, e: V): void {
    const d = Math.hypot(v.x - e.x, v.y - e.y, v.z - e.z);
    const wg = v.gain, wc = v.cutoff, wb = v.bent, wa = v.audible, wx = v.vx, wy = v.vy, wz = v.vz;
    v.mark(e, v.epoch);
    v.seen = true;
    v.audible = d <= v.range * 1.05;
    v.bent = false;
    v.vx = v.x;
    v.vy = v.y;
    v.vz = v.z;
    if (!v.audible || d < 24) {
      v.gain = 1;
      v.cutoff = 22000;
      v.loss = 0;
      v.occluded = false;
    } else {
      const loss = this.straight(e, v, d);
      v.loss = loss;
      v.occluded = loss >= 0.5;
      v.gain = dbToGain(loss);
      v.cutoff = lossCutoff(loss);
      const g = v.occluded ? this.air() : null;
      if (g?.pathTo(v, this.path)) {
        const p = this.path;
        const bend = this.bendLoss(p.dist, d, g.cell);
        if (falloff(p.dist, v.range) * dbToGain(bend) > falloff(d, v.range) * v.gain) {
          // Heard by the way round: from the way it arrives, as far off as the way is long.
          const ax = p.via.x - e.x, ay = p.via.y - e.y, az = p.via.z - e.z;
          const al = Math.hypot(ax, ay, az) || 1;
          v.vx = e.x + (ax / al) * p.dist;
          v.vy = e.y + (ay / al) * p.dist;
          v.vz = e.z + (az / al) * p.dist;
          v.gain = dbToGain(bend);
          v.cutoff = bendCutoff(bend);
          v.bent = true;
        }
      }
    }
    if (
      wa !== v.audible ||
      wb !== v.bent ||
      Math.abs(wg - v.gain) > 0.01 ||
      Math.abs(Math.log2(wc / v.cutoff)) > 0.05 ||
      (v.bent && (wx - v.vx) ** 2 + (wy - v.vy) ** 2 + (wz - v.vz) ** 2 > 16)
    )
      v.changed = true;
  }

  /**
   * dB lost going straight from `a` to `b` (`d` apart): every wall in between, by material and thickness. One
   * ray each way: the forward hits are where walls start, the backward ones where they end.
   */
  private straight(a: V, b: V, d: number): number {
    // (The last few units at the sound's end are left out: sounds sit on surfaces.)
    const trim = Math.min(8, d * 0.25);
    const len = d - trim;
    const dx = (b.x - a.x) / d, dy = (b.y - a.y) / d, dz = (b.z - a.z) / d;
    const r = this.ray, w = this.host.world, ex = this.host.exclude();
    r.origin.x = a.x;
    r.origin.y = a.y;
    r.origin.z = a.z;
    r.dir.x = dx;
    r.dir.y = dy;
    r.dir.z = dz;
    this.fN = 0;
    w.intersectionsWithRay(r, len, true, this.onF, FLAGS, undefined, ex);
    if (!this.fN) return 0;
    // Where each one ends: the same ray backward from the sound's end, against that collider alone.
    r.origin.x = a.x + dx * len;
    r.origin.y = a.y + dy * len;
    r.origin.z = a.z + dz * len;
    r.dir.x = -dx;
    r.dir.y = -dy;
    r.dir.z = -dz;
    this.stats.rays += 1 + this.fN;
    let m = 0;
    for (let i = 0; i < this.fN; i++) {
      const t = this.fT[i]!;
      // (Ears inside it: not a wall between.)
      if (t <= 0) continue;
      const back = this.fC[i]!.castRay(r, len, true);
      // (The sound's own object, the one it's in.)
      if (back === 0) continue;
      this.iA[m] = t;
      this.iB[m] = back > 0 ? Math.max(t, len - back) : len;
      this.iH[m++] = this.fH[i]!;
    }
    this.fC.length = 0;
    if (!m) return 0;
    const ord = this.order;
    ord.length = 0;
    for (let i = 0; i < m; i++) ord.push(i);
    if (m > 1) ord.sort((p, q) => this.iA[p]! - this.iA[q]!);
    // Touching or overlapping pieces are one wall.
    let loss = 0;
    let s = this.iA[ord[0]!]!, t = this.iB[ord[0]!]!, h = this.iH[ord[0]!]!;
    for (let k = 1; k < m; k++) {
      const i = ord[k]!;
      if (this.iA[i]! <= t + 2) {
        t = Math.max(t, this.iB[i]!);
        continue;
      }
      loss += this.wall(a, dx, dy, dz, s, t, h);
      s = this.iA[i]!;
      t = this.iB[i]!;
      h = this.iH[i]!;
    }
    loss += this.wall(a, dx, dy, dz, s, t, h);
    return Math.min(MAX_LOSS, loss);
  }

  /** One wall's loss: its material where the ray met it, and its thickness. */
  private wall(a: V, dx: number, dy: number, dz: number, from: number, to: number, handle: number): number {
    const at = this.tmp;
    at.x = a.x + dx * from;
    at.y = a.y + dy * from;
    at.z = a.z + dz * from;
    return wallLoss(this.host.surfaceAt(handle, at), to - from);
  }

  private tmp: V = { x: 0, y: 0, z: 0 };

  /** Moving things that stop sound (doors, lifts): where they moved, the grid is measured again. */
  private scanMovers(g: SoundGrid): void {
    const pred = this.pred;
    this.host.world.forEachRigidBody((b) => {
      if (!b.isKinematic()) return;
      const t = b.translation(), q = b.rotation();
      let k = this.kinematic.get(b.handle);
      if (!k) {
        // (How far its solid parts reach from it; 0: nothing that stops sound.)
        let r = 0;
        for (let i = 0; i < b.numColliders(); i++) {
          const c = b.collider(i);
          if (c.isSensor() || !pred(c)) continue;
          const ct = c.translation();
          r = Math.max(r, Math.hypot(ct.x - t.x, ct.y - t.y, ct.z - t.z) + shapeExtent(c).reach);
        }
        this.kinematic.set(b.handle, { x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, r });
        return;
      }
      if (!k.r) return;
      const moved = Math.hypot(t.x - k.x, t.y - k.y, t.z - k.z) > 2;
      const turned = Math.abs(q.x * k.qx + q.y * k.qy + q.z * k.qz + q.w * k.qw) < 0.9995;
      if (!moved && !turned) return;
      g.invalidate({ x: Math.min(t.x, k.x) - k.r, y: Math.min(t.y, k.y) - k.r, z: Math.min(t.z, k.z) - k.r }, { x: Math.max(t.x, k.x) + k.r, y: Math.max(t.y, k.y) + k.r, z: Math.max(t.z, k.z) + k.r });
      Object.assign(k, { x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
    });
  }

  /** Something solid was added, removed or moved here (world units): measure again what sound can get through. */
  changed(min: V, max: V): void {
    this.big.clear();
    this.grid?.invalidate(min, max);
  }

  // ── The room round the ears ──

  /** The echo the ears' surroundings call for, or null before it's been worked out. */
  get environment(): { effect: AutoEffect; mix: number } | null {
    return this.env;
  }

  private sampleRoom(e: V, now: number): void {
    const moved = Math.hypot(e.x - this.envAt.x, e.y - this.envAt.y, e.z - this.envAt.z);
    if (moved <= 32 && now < this.envNext + 2.5) return;
    this.envNext = now + 0.4;
    this.envAt = { x: e.x, y: e.y, z: e.z };
    const r = this.ray, w = this.host.world, ex = this.host.exclude();
    r.origin.x = e.x;
    r.origin.y = e.y;
    r.origin.z = e.z;
    let hits = 0, up = Infinity, absorb = 0, natural = 0;
    const flat: number[] = [];
    for (let i = 0; i < PROBE_DIRS.length; i++) {
      const [x, y, z] = PROBE_DIRS[i]!;
      r.dir.x = x;
      r.dir.y = y;
      r.dir.z = z;
      const h = w.castRay(r, PROBE_REACH, true, FLAGS, undefined, ex, undefined, this.pred);
      this.stats.rays++;
      const dist = h ? h.timeOfImpact : PROBE_REACH;
      if (i === 0) up = h ? h.timeOfImpact : Infinity;
      else if (i <= 8) flat.push(dist);
      if (!h) continue;
      hits++;
      const s = this.host.surfaceAt(h.collider.handle, { x: e.x + x * h.timeOfImpact, y: e.y + y * h.timeOfImpact, z: e.z + z * h.timeOfImpact });
      absorb += (ACOUSTIC_MATERIALS[s] ?? ACOUSTIC_MATERIALS.generic).absorb;
      if (NATURAL.includes(s)) natural++;
    }
    const seen = classifyRoom(hits / PROBE_DIRS.length, up, flat, hits ? absorb / hits : 0, hits ? natural / hits : 0);
    // (Changed only once it's been seen twice running, so a doorway doesn't flicker between two.)
    const same = this.envSeen && this.envSeen.effect === seen.effect;
    this.envSeen = seen;
    if (!this.env || same) this.env = seen;
  }
}

/**
 * The echo a place calls for, from rays out of the ears: how many hit something (`enclosed`, 0…1), how far up
 * the roof is, the level distances all round, and how soft (0…1) and how natural (rock, earth) the surfaces are.
 */
export function classifyRoom(enclosed: number, up: number, flat: number[], absorb: number, natural: number): { effect: AutoEffect; mix: number } {
  const roofed = up < 1200;
  if (!roofed && enclosed < 0.75) return { effect: 'none', mix: 0 };
  const h = [...flat].sort((a, b) => a - b);
  const mean = h.reduce((s, x) => s + x, 0) / Math.max(1, h.length);
  const narrow = ((h[0] ?? 0) + (h[1] ?? 0)) / 2;
  const long = ((h[h.length - 1] ?? 0) + (h[h.length - 2] ?? 0)) / 2;
  const mix = Math.max(0.15, Math.min(1, enclosed * (1 - absorb * 1.2) * (roofed ? 1 : 0.6)));
  let effect: AutoEffect;
  if (narrow < 160 && long > 400 && long > narrow * 4) effect = 'corridor';
  else if (mean < 240) effect = 'room';
  else if (natural > 0.6) effect = 'cave';
  else effect = 'hall';
  return { effect, mix };
}

/**
 * How big a collider's shape is (`size`: half the diagonal of its bounds) and how far it reaches from the
 * collider's own origin (`reach`), in units. Hulls may be stored far from their origin, hence both.
 */
export function shapeExtent(c: RAPIER.Collider): { size: number; reach: number } {
  const s = c.shape as RAPIER.Shape & { halfExtents?: RAPIER.Vector; radius?: number; halfHeight?: number; vertices?: Float32Array };
  if (s.halfExtents) {
    const r = Math.hypot(s.halfExtents.x, s.halfExtents.y, s.halfExtents.z) + (s.radius ?? 0);
    return { size: r, reach: r };
  }
  if (s.vertices) {
    const v = s.vertices;
    let reach = 0, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i + 2 < v.length; i += 3) {
      const x = v[i]!, y = v[i + 1]!, z = v[i + 2]!;
      reach = Math.max(reach, Math.hypot(x, y, z));
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    return { size: v.length >= 3 ? Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 : 0, reach };
  }
  if (s.halfHeight !== undefined) {
    const r = s.halfHeight + (s.radius ?? 0);
    return { size: r, reach: r };
  }
  if (s.radius !== undefined) return { size: s.radius, reach: s.radius };
  // (Heightfields and the like: the ground, always big.)
  return { size: Infinity, reach: Infinity };
}
