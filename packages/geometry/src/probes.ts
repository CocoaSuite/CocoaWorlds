/**
 * Reflection probes found from the level: the rooms. The level's solids are sampled on a grid of cells; air
 * with a roof over it and walls on at least three sides is "inside". Inside air is split into rooms where it
 * narrows (doorways, gaps between rooms): only cells far enough from anything that isn't inside air seed a room,
 * and each room then grows back over the inside air nearest it. Big rooms are cut into pieces no longer than
 * `maxSize`. Each room becomes a box (its air's bounds) and a point to capture from (its air nearest the box's
 * middle). Plain data, no Three.js.
 */
import { bounds, containsPoint, type Brush } from './brush';
import type { V3 } from './vec';

export interface ProbeBox {
  min: V3;
  max: V3;
  /** Where the probe captures from (in its room's air). */
  at: V3;
}

export interface AutoProbeOptions {
  /** Most probes found (the biggest rooms are kept). Default 15. */
  max?: number;
  /** Smallest cell (u). Default 16; larger levels use larger cells. */
  cell?: number;
  /** The longest a probe box may be (u) before its room is cut in two. Default 1024. */
  maxSize?: number;
  /** How far up a roof may be (u) for the air below to count as inside. Default 1024. */
  roof?: number;
  /** Doorways and gaps narrower than this (u) separate rooms. Default 112. */
  doorway?: number;
}

/** Cells at most. */
const MAX_CELLS = 2_000_000;

export function autoProbes(solids: Brush[], opts: AutoProbeOptions = {}): ProbeBox[] {
  const boxes = solids.map((b) => bounds(b)).filter((b): b is { min: V3; max: V3 } => !!b);
  if (!boxes.length) return [];
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, b.min[k]!);
      hi[k] = Math.max(hi[k]!, b.max[k]!);
    }
  let cell = opts.cell ?? 16;
  const vol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
  while (vol / cell ** 3 > MAX_CELLS) cell *= 2;
  // Grid-aligned (walls on the grid then fall on cell edges), with a cell of room round the outside.
  const o: V3 = [Math.floor(lo[0] / cell) * cell - cell, Math.floor(lo[1] / cell) * cell - cell, Math.floor(lo[2] / cell) * cell - cell];
  const nx = Math.ceil((hi[0] - o[0]) / cell) + 1;
  const ny = Math.ceil((hi[1] - o[1]) / cell) + 1;
  const nz = Math.ceil((hi[2] - o[2]) / cell) + 1;
  const n = nx * ny * nz;
  if (n > MAX_CELLS * 2) return [];
  const idx = (x: number, y: number, z: number) => (z * ny + y) * nx + x;

  // Solid cells (a cell is solid when its middle is inside a solid).
  const solid = new Uint8Array(n);
  boxes.forEach((bb, i) => {
    const b = solids[i]!;
    const r = (k: number, v: number, up: boolean) => {
      const c = (v - o[k]!) / cell - 0.5;
      return up ? Math.min([nx, ny, nz][k]! - 1, Math.floor(c)) : Math.max(0, Math.ceil(c));
    };
    for (let z = r(2, bb.min[2], false); z <= r(2, bb.max[2], true); z++)
      for (let y = r(1, bb.min[1], false); y <= r(1, bb.max[1], true); y++)
        for (let x = r(0, bb.min[0], false); x <= r(0, bb.max[0], true); x++) {
          const i2 = idx(x, y, z);
          if (!solid[i2] && containsPoint(b, [o[0] + (x + 0.5) * cell, o[1] + (y + 0.5) * cell, o[2] + (z + 0.5) * cell], 1e-6)) solid[i2] = 1;
        }
  });

  // Inside: air with a roof not too far up and walls (within the same reach) on three sides or more.
  const reach = Math.max(1, Math.round((opts.roof ?? 1024) / cell));
  const inside = new Uint8Array(n);
  const sides = new Uint8Array(n);
  const sweep = (len: number, at: (t: number) => number, mark: (i: number) => void) => {
    let last = -Infinity;
    for (let t = 0; t < len; t++) {
      const i = at(t);
      if (solid[i]) last = t;
      else if (t - last <= reach) mark(i);
    }
  };
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++)
      sweep(ny, (t) => idx(x, ny - 1 - t, z), (i) => (inside[i] = 1));
  const side = (i: number) => sides[i]!++;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++) {
      sweep(nx, (t) => idx(t, y, z), side);
      sweep(nx, (t) => idx(nx - 1 - t, y, z), side);
    }
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      sweep(nz, (t) => idx(x, y, t), side);
      sweep(nz, (t) => idx(x, y, nz - 1 - t), side);
    }
  for (let i = 0; i < n; i++) if (sides[i]! < 3) inside[i] = 0;

  // Seeds: inside cells further (across the floor) than half a doorway from anything not inside.
  const far = Math.max(1, Math.ceil((opts.doorway ?? 112) / 2 / cell));
  const dist = new Uint16Array(n).fill(65535);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = idx(x, y, z);
        if (!inside[i]) continue;
        if (x === 0 || z === 0 || x === nx - 1 || z === nz - 1 || !inside[i - 1] || !inside[i + 1] || !inside[i - nx * ny] || !inside[i + nx * ny]) {
          dist[i] = 1;
          q[qt++] = i;
        }
      }
  while (qh < qt) {
    const i = q[qh++]!;
    const x = i % nx;
    const z = Math.floor(i / (nx * ny));
    const d = dist[i]! + 1;
    for (const j of [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, z > 0 ? i - nx * ny : -1, z < nz - 1 ? i + nx * ny : -1])
      if (j >= 0 && inside[j] && dist[j]! > d) {
        dist[j] = d;
        q[qt++] = j;
      }
  }

  // Rooms: connected seeds, then grown back over the rest of the inside air.
  const room = new Int32Array(n).fill(-1);
  let rooms = 0;
  const neighbours = (i: number): number[] => {
    const x = i % nx;
    const y = Math.floor(i / nx) % ny;
    const z = Math.floor(i / (nx * ny));
    const out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < nx - 1) out.push(i + 1);
    if (y > 0) out.push(i - nx);
    if (y < ny - 1) out.push(i + nx);
    if (z > 0) out.push(i - nx * ny);
    if (z < nz - 1) out.push(i + nx * ny);
    return out;
  };
  const flood = (start: number, ok: (j: number) => boolean) => {
    const r = rooms++;
    room[start] = r;
    const stack = [start];
    while (stack.length) for (const j of neighbours(stack.pop()!)) if (room[j] === -1 && ok(j)) (room[j] = r), stack.push(j);
  };
  for (let i = 0; i < n; i++) if (inside[i] && dist[i]! > far && room[i] === -1) flood(i, (j) => !!inside[j] && dist[j]! > far);
  qh = qt = 0;
  for (let i = 0; i < n; i++) if (room[i]! >= 0) q[qt++] = i;
  while (qh < qt) {
    const i = q[qh++]!;
    for (const j of neighbours(i))
      if (inside[j] && room[j] === -1) {
        room[j] = room[i]!;
        q[qt++] = j;
      }
  }
  // (Rooms too narrow to seed: each is a room of its own.)
  for (let i = 0; i < n; i++) if (inside[i] && room[i] === -1) flood(i, (j) => !!inside[j]);

  // Each room's cells, cut where too long, as boxes.
  const cells: number[][] = Array.from({ length: rooms }, () => []);
  for (let i = 0; i < n; i++) if (room[i]! >= 0) cells[room[i]!]!.push(i);
  const coord = (i: number): V3 => [i % nx, Math.floor(i / nx) % ny, Math.floor(i / (nx * ny))];
  const maxCells = Math.max(2, Math.floor((opts.maxSize ?? 1024) / cell));
  const minCells = Math.max(8, Math.ceil(32768 / cell ** 3));
  const out: { box: ProbeBox; size: number }[] = [];
  const emit = (list: number[]) => {
    if (list.length < minCells) return;
    const a: V3 = [Infinity, Infinity, Infinity];
    const b: V3 = [-Infinity, -Infinity, -Infinity];
    for (const i of list) {
      const c = coord(i);
      for (let k = 0; k < 3; k++) {
        a[k] = Math.min(a[k]!, c[k]!);
        b[k] = Math.max(b[k]!, c[k]!);
      }
    }
    const ext = [b[0] - a[0] + 1, b[1] - a[1] + 1, b[2] - a[2] + 1];
    const k = ext.indexOf(Math.max(...ext));
    if (ext[k]! > maxCells) {
      const pieces = Math.ceil(ext[k]! / maxCells);
      const parts: number[][] = Array.from({ length: pieces }, () => []);
      for (const i of list) parts[Math.min(pieces - 1, Math.floor(((coord(i)[k]! - a[k]!) / ext[k]!) * pieces))]!.push(i);
      for (const p of parts) emit(p);
      return;
    }
    const min: V3 = [o[0] + a[0] * cell, o[1] + a[1] * cell, o[2] + a[2] * cell];
    const max: V3 = [o[0] + (b[0] + 1) * cell, o[1] + (b[1] + 1) * cell, o[2] + (b[2] + 1) * cell];
    // Captured from the room's air nearest the middle of its box (at eye height or less above its floor).
    const mid: V3 = [(min[0] + max[0]) / 2, Math.min((min[1] + max[1]) / 2, min[1] + 64), (min[2] + max[2]) / 2];
    let at: V3 = mid;
    let best = Infinity;
    for (const i of list) {
      const c = coord(i);
      const p: V3 = [o[0] + (c[0] + 0.5) * cell, o[1] + (c[1] + 0.5) * cell, o[2] + (c[2] + 0.5) * cell];
      const d = (p[0] - mid[0]) ** 2 + (p[1] - mid[1]) ** 2 + (p[2] - mid[2]) ** 2;
      if (d < best) (best = d), (at = p);
    }
    out.push({ box: { min, max, at }, size: list.length });
  };
  for (const c of cells) emit(c);
  out.sort((x, y) => y.size - x.size);
  return out.slice(0, opts.max ?? 15).map((x) => x.box);
}
