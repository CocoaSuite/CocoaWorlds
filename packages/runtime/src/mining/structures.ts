/**
 * Giant structures buried in the mine: an abandoned mine complex, a dwarven city, a crystal cathedral and a sunken
 * temple. Each is built once (from the seed) into a volume of blocks; cells it leaves alone stay natural rock.
 */
import { hash3 } from './noise';

/** A cell the structure leaves to the rock. */
export const KEEP = 0xfffe;

export type StructureKind = 'mine_complex' | 'dwarven_city' | 'crystal_cathedral' | 'sunken_temple';

export interface Structure {
  key: string;
  kind: StructureKind;
  /** Lowest corner (blocks) and size. */
  at: [number, number, number];
  size: [number, number, number];
  /** Where its boss waits (blocks). */
  boss: [number, number, number];
  data: Uint16Array | null;
}

/** Block ids the builders use (materials, and a few ores for crystal pockets). */
export interface Palette {
  mat(name: string): number;
  /** An ore block of the zone at this depth. */
  ore(name: string): number;
}

class Vol {
  readonly data: Uint16Array;
  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
  ) {
    this.data = new Uint16Array(sx * sy * sz).fill(KEEP);
  }
  in(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }
  set(x: number, y: number, z: number, v: number) {
    if (this.in(x, y, z)) this.data[x + this.sx * (z + this.sz * y)] = v;
  }
  get(x: number, y: number, z: number) {
    return this.in(x, y, z) ? this.data[x + this.sx * (z + this.sz * y)]! : KEEP;
  }
  /** Fill a box (corners included). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, v: number) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, v);
  }
  /** A room: walls, floor and ceiling of `wall`, air inside. */
  room(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: number, floor = wall) {
    this.box(x0, y0, z0, x1, y1, z1, wall);
    this.box(x0, y0, z0, x1, y0, z1, floor);
    this.box(x0 + 1, y0 + 1, z0 + 1, x1 - 1, y1 - 1, z1 - 1, 0);
  }
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, v: number | ((d: number, x: number, y: number, z: number) => number | null)) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry, (z + 0.5 - cz) / rz);
          if (d > 1) continue;
          const b = typeof v === 'number' ? v : v(d, x, y, z);
          if (b !== null) this.set(x, y, z, b);
        }
  }
  /** A pillar with a wider foot and head. */
  pillar(x: number, z: number, y0: number, y1: number, v: number, cap = v) {
    this.box(x - 1, y0, z - 1, x + 1, y1, z + 1, v);
    this.box(x - 2, y0, z - 2, x + 2, y0, z + 2, cap);
    this.box(x - 2, y1, z - 2, x + 2, y1, z + 2, cap);
  }
}

const rand = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
};

// ── Abandoned mine complex: three levels of timbered tunnels, stairwells, offices, and a great dig at the bottom. ──

function mineComplex(seed: number, p: Palette): { vol: Vol; boss: [number, number, number] } {
  const r = rand(seed), v = new Vol(96, 40, 96);
  const P = p.mat('planks'), Bm = p.mat('beam'), L = p.mat('lantern'), C = p.mat('chest'), R = p.mat('rail'), V = p.mat('vault');
  const levels = [4, 15, 26];
  const tunnel = (x0: number, z0: number, x1: number, z1: number, y: number) => {
    const alongX = z0 === z1;
    v.box(x0 - (alongX ? 0 : 1), y, z0 - (alongX ? 1 : 0), x1 + (alongX ? 0 : 1), y + 3, z1 + (alongX ? 1 : 0), 0);
    const n = alongX ? x1 - x0 : z1 - z0;
    for (let i = 0; i <= n; i++) {
      const x = alongX ? x0 + i : x0, z = alongX ? z0 : z0 + i;
      v.set(x, y - 1, z, R);
      if (i % 5 === 0) {
        // (Timber frame: two posts and a crossbeam; a lantern now and then.)
        if (alongX) {
          v.box(x, y, z - 2, x, y + 3, z - 2, Bm);
          v.box(x, y, z + 2, x, y + 3, z + 2, Bm);
          v.box(x, y + 4, z - 2, x, y + 4, z + 2, Bm);
        } else {
          v.box(x - 2, y, z, x - 2, y + 3, z, Bm);
          v.box(x + 2, y, z, x + 2, y + 3, z, Bm);
          v.box(x - 2, y + 4, z, x + 2, y + 4, z, Bm);
        }
        if (r() < 0.35) v.set(x, y + 3, z, L);
      }
    }
    // (A cave-in: a stretch left to the rock, to dig through.)
    if (r() < 0.35) {
      const c = Math.floor(n * (0.3 + r() * 0.4));
      const x = alongX ? x0 + c : x0, z = alongX ? z0 : z0 + c;
      v.box(x - 1, y, z - 1, x + 1, y + 3, z + 1, KEEP);
    }
  };
  for (const y of levels) {
    for (let i = 0; i < 6; i++) {
      const c = 8 + i * 16;
      if (r() < 0.85) tunnel(4, c, 91, c, y);
      if (r() < 0.85) tunnel(c, 4, c, 91, y);
    }
    // Rooms off the tunnels: stores with chests.
    for (let k = 0; k < 4; k++) {
      const x = 12 + Math.floor(r() * 5) * 16, z = 12 + Math.floor(r() * 5) * 16;
      v.room(x - 3, y - 1, z - 3, x + 3, y + 4, z + 3, P);
      v.box(x, y, z - 3, x, y + 2, z - 3, 0);
      v.set(x + 2, y, z + 2, C);
      v.set(x - 2, y + 3, z - 2, L);
    }
  }
  // Stairwells joining the levels: plank steps winding round a shaft.
  for (const [sx, sz] of [[24, 24], [72, 40], [40, 72]] as const) {
    v.box(sx - 3, levels[0]!, sz - 3, sx + 3, levels[2]! + 3, sz + 3, 0);
    const ring: [number, number][] = [];
    for (let i = -3; i < 3; i++) ring.push([i, -3]);
    for (let i = -3; i < 3; i++) ring.push([3, i]);
    for (let i = 3; i > -3; i--) ring.push([i, 3]);
    for (let i = 3; i > -3; i--) ring.push([-3, i]);
    for (let s = 0; s <= levels[2]! - levels[0]!; s++) {
      const [dx, dz] = ring[s % ring.length]!;
      v.set(sx + dx, levels[0]! + s - 1, sz + dz, P);
    }
    v.pillar(sx, sz, levels[0]! - 1, levels[2]! + 4, Bm);
  }
  // The foreman's office (with the strongbox, opened once he falls) and the great dig below.
  v.room(40, levels[1]! - 1, 40, 52, levels[1]! + 5, 50, P);
  v.box(46, levels[1]!, 40, 46, levels[1]! + 2, 40, 0);
  v.set(50, levels[1]!, 48, V);
  v.set(42, levels[1]! + 4, 42, L);
  v.set(50, levels[1]! + 4, 42, L);
  v.ellipsoid(48, 7, 48, 16, 7, 16, (_, x, y) => (y >= 1 ? 0 : null));
  v.box(32, 0, 32, 64, 0, 64, R);
  for (const [px, pz] of [[38, 38], [58, 38], [38, 58], [58, 58]] as const) v.pillar(px, pz, 1, 12, Bm);
  for (const [lx, lz] of [[38, 41], [58, 41], [38, 55], [58, 55]] as const) v.set(lx, 6, lz, L);
  v.box(46, levels[0]!, 33, 50, levels[0]! + 3, 47, 0);
  return { vol: v, boss: [48, 1, 48] };
}

// ── Dwarven city: two terraces of halls and houses either side of a lava chasm, bridged, under a pillared vault. ──

function dwarvenCity(seed: number, p: Palette): { vol: Vol; boss: [number, number, number] } {
  const r = rand(seed), v = new Vol(112, 48, 112);
  const S = p.mat('stone_bricks'), K = p.mat('cracked_bricks'), Cv = p.mat('carved_stone'), G = p.mat('gold_block'), L = p.mat('lantern');
  const Lv = p.mat('lava'), C = p.mat('chest'), V = p.mat('vault');
  const floorY = 16;
  // The hall: one huge space, its floor two terraces.
  v.box(2, floorY + 1, 2, 109, 40, 109, 0);
  v.box(2, floorY - 3, 2, 109, floorY, 109, S);
  v.box(2, 41, 2, 109, 42, 109, S);
  // The chasm, lava at its foot.
  v.box(44, 2, 2, 67, floorY, 109, 0);
  v.box(44, 1, 2, 67, 2, 109, Lv);
  v.box(43, 1, 2, 43, floorY, 109, S);
  v.box(68, 1, 2, 68, floorY, 109, S);
  // Bridges with low walls.
  for (const bz of [18, 54, 92]) {
    v.box(43, floorY, bz - 2, 68, floorY, bz + 2, Cv);
    v.box(43, floorY + 1, bz - 2, 68, floorY + 1, bz - 2, S);
    v.box(43, floorY + 1, bz + 2, 68, floorY + 1, bz + 2, S);
    v.set(55, floorY + 2, bz - 2, L);
    v.set(55, floorY + 2, bz + 2, L);
  }
  // Pillars up to the vault, lanterns on them.
  for (let x = 10; x < 110; x += 16)
    for (let z = 10; z < 110; z += 16) {
      if (x > 38) continue;
      v.pillar(x, z, floorY + 1, 40, Cv, S);
      v.set(x, floorY + 6, z - 2, L);
    }
  // Houses on the west terrace.
  for (let k = 0; k < 6; k++) {
    const x = 6 + (k % 2) * 16, z = 8 + Math.floor(k / 2) * 30;
    v.room(x, floorY, z, x + 9, floorY + 7, z + 9, k % 3 ? S : K, Cv);
    v.box(x + 4, floorY + 1, z, x + 5, floorY + 3, z, 0);
    v.set(x + 2, floorY + 5, z + 2, L);
    if (r() < 0.7) v.set(x + 7, floorY + 1, z + 7, C);
  }
  // The forge: lava troughs, gold ingots stacked.
  v.room(74, floorY, 8, 104, floorY + 10, 30, S, Cv);
  v.box(89, floorY + 1, 8, 90, floorY + 4, 8, 0);
  v.box(78, floorY, 12, 100, floorY, 13, Lv);
  v.box(78, floorY, 25, 100, floorY, 26, Lv);
  v.box(80, floorY + 1, 18, 84, floorY + 2, 20, G);
  v.set(100, floorY + 1, 20, C);
  // The vault: sealed, gold inside (dig or blast in).
  v.room(76, floorY - 1, 80, 96, floorY + 7, 100, Cv);
  v.box(78, floorY + 1, 82, 94, floorY + 2, 98, G);
  // The throne room: the king's hall at the east end, the strongbox behind the throne.
  v.room(74, floorY, 40, 106, floorY + 16, 72, Cv, S);
  v.box(74, floorY + 1, 54, 74, floorY + 5, 58, 0);
  for (const [px, pz] of [[80, 46], [80, 66], [100, 46], [100, 66]] as const) v.pillar(px, pz, floorY + 1, floorY + 15, S, Cv);
  v.box(102, floorY + 1, 52, 104, floorY + 6, 60, G);
  v.box(101, floorY + 1, 54, 101, floorY + 3, 58, Cv);
  v.set(104, floorY + 1, 56, 0);
  v.set(105, floorY + 1, 56, V);
  for (const [lx, lz] of [[78, 44], [78, 68], [102, 44], [102, 68]] as const) v.set(lx, floorY + 8, lz, L);
  return { vol: v, boss: [88, floorY + 1, 56] };
}

// ── Crystal cathedral: a vast geode, crystal spires rising and hanging, pockets of gems, an altar at its heart. ──

function crystalCathedral(seed: number, p: Palette): { vol: Vol; boss: [number, number, number] } {
  const r = rand(seed), v = new Vol(96, 64, 96);
  const X = p.mat('crystal_block'), Ca = p.mat('calcite'), C = p.mat('chest'), V = p.mat('vault');
  const gems = ['amethyst', 'quartz', 'diamond', 'sapphire', 'moonstone', 'opal'].map((g) => p.ore(g)).filter((g) => g > 0);
  v.ellipsoid(48, 32, 48, 47, 31, 47, (d, x, y, z) => {
    if (d < 0.9) return 0;
    if (d < 0.955) return hash3(x, y, z, seed) < 0.55 ? X : Ca;
    return Ca;
  });
  // A flat floor of calcite to fight on.
  v.box(4, 6, 4, 92, 8, 92, KEEP);
  v.ellipsoid(48, 32, 48, 43, 28, 43, (_, x, y) => (y <= 8 ? Ca : null));
  const cone = (cx: number, cz: number, y0: number, h: number, down: boolean) => {
    for (let k = 0; k < h; k++) {
      const rr = Math.max(0, Math.round(((h - k) / h) * 3));
      for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) if (Math.abs(dx) + Math.abs(dz) <= rr) v.set(cx + dx, down ? y0 - k : y0 + k, cz + dz, X);
    }
  };
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 12 + r() * 26;
    const cx = Math.round(48 + Math.cos(a) * d), cz = Math.round(48 + Math.sin(a) * d);
    if (Math.hypot(cx - 48, cz - 48) < 13) continue;
    if (i % 2) cone(cx, cz, 9, 6 + Math.floor(r() * 16), false);
    else cone(cx, cz, 62, 8 + Math.floor(r() * 12), true);
  }
  // Gem pockets in the walls.
  for (let i = 0; i < 18 && gems.length; i++) {
    const a = r() * Math.PI * 2, e = (r() - 0.3) * 0.9;
    const cx = Math.round(48 + Math.cos(a) * Math.cos(e) * 44), cy = Math.round(32 + Math.sin(e) * 29), cz = Math.round(48 + Math.sin(a) * Math.cos(e) * 44);
    const g = gems[Math.floor(r() * gems.length)]!;
    v.ellipsoid(cx, cy, cz, 2.6, 2.2, 2.6, (d) => (d < 0.5 ? 0 : g));
  }
  // The altar: a raised ring with a chest behind it.
  v.ellipsoid(48, 9, 48, 12, 1.5, 12, (_, x, y) => (y === 9 ? Ca : null));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    cone(Math.round(48 + Math.cos(a) * 12), Math.round(48 + Math.sin(a) * 12), 10, 7, false);
  }
  v.set(48, 10, 58, V);
  v.set(20, 9, 48, C);
  v.set(76, 9, 48, C);
  return { vol: v, boss: [48, 10, 48] };
}

// ── Sunken temple: a buried stepped pyramid; corridors full of webs and lava pits; the sanctum at its centre. ──

function sunkenTemple(seed: number, p: Palette): { vol: Vol; boss: [number, number, number] } {
  const r = rand(seed), v = new Vol(84, 44, 84);
  const T = p.mat('temple_bricks'), Cv = p.mat('carved_temple'), W = p.mat('web'), Lv = p.mat('lava'), C = p.mat('chest'), V = p.mat('vault'), G = p.mat('gold_block'), L = p.mat('lantern');
  // It stands in its own domed cave.
  v.ellipsoid(42, 0, 42, 46, 44, 46, 0);
  // The pyramid: six steps of brick.
  for (let s = 0; s < 6; s++) v.box(2 + s * 6, s * 7, 2 + s * 6, 81 - s * 6, s * 7 + 6, 81 - s * 6, s % 2 ? Cv : T);
  // The maze on the ground floor.
  const cell = 6, n = 12;
  const open = new Set<string>();
  const stack: [number, number][] = [[0, 0]];
  open.add('0,0');
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1]!;
    const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dz]) => [cx + dx, cz + dz] as const).filter(([x, z]) => x >= 0 && z >= 0 && x < n && z < n && !open.has(`${x},${z}`));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [nx, nz] = next[Math.floor(r() * next.length)]!;
    open.add(`${nx},${nz}`);
    const ax = 6 + cx * cell, az = 6 + cz * cell, bx = 6 + nx * cell, bz = 6 + nz * cell;
    v.box(Math.min(ax, bx), 1, Math.min(az, bz), Math.max(ax, bx) + 2, 4, Math.max(az, bz) + 2, 0);
    stack.push([nx, nz]);
  }
  v.box(0, 1, 6, 6, 4, 8, 0);
  v.box(74, 1, 72, 83, 4, 74, 0);
  // Webs and lava pits along the corridors, lanterns now and then.
  for (let i = 0; i < 160; i++) {
    const x = 6 + Math.floor(r() * 72), z = 6 + Math.floor(r() * 72), y = 1 + Math.floor(r() * 4);
    if (v.get(x, y, z) === 0) v.set(x, y, z, W);
  }
  for (let i = 0; i < 14; i++) {
    const x = 8 + Math.floor(r() * 66), z = 8 + Math.floor(r() * 66);
    if (v.get(x, 1, z) === 0 && v.get(x + 1, 1, z) === 0) v.box(x, 0, z, x + 1, 0, z + 1, Lv);
  }
  for (let i = 0; i < 30; i++) {
    const x = 6 + Math.floor(r() * 72), z = 6 + Math.floor(r() * 72);
    if (v.get(x, 4, z) === 0) v.set(x, 4, z, L);
  }
  for (let i = 0; i < 6; i++) {
    const x = 7 + Math.floor(r() * 70), z = 7 + Math.floor(r() * 70);
    if (v.get(x, 1, z) === 0) v.set(x, 1, z, C);
  }
  // The sanctum: a tall pillared chamber at the heart, stairs up into it from the maze.
  v.room(28, 7, 28, 56, 26, 56, Cv, T);
  for (const [px, pz] of [[33, 33], [51, 33], [33, 51], [51, 51]] as const) v.pillar(px, pz, 8, 25, Cv, T);
  for (let s = 0; s < 7; s++) v.box(42, 1 + s, 20 + s, 44, 4 + s, 20 + s, 0);
  v.box(42, 8, 26, 44, 11, 28, 0);
  v.box(40, 8, 52, 44, 9, 54, G);
  v.set(42, 10, 53, V);
  for (const [lx, lz] of [[30, 30], [54, 30], [30, 54], [54, 54]] as const) v.set(lx, 14, lz, L);
  for (let i = 0; i < 40; i++) {
    const x = 29 + Math.floor(r() * 27), y = 15 + Math.floor(r() * 10), z = 29 + Math.floor(r() * 27);
    if (v.get(x, y, z) === 0) v.set(x, y, z, W);
  }
  return { vol: v, boss: [42, 8, 42] };
}

const BUILD: Record<StructureKind, (seed: number, p: Palette) => { vol: Vol; boss: [number, number, number] }> = {
  mine_complex: mineComplex,
  dwarven_city: dwarvenCity,
  crystal_cathedral: crystalCathedral,
  sunken_temple: sunkenTemple,
};

export const STRUCTURE_SIZE: Record<StructureKind, [number, number, number]> = {
  mine_complex: [96, 40, 96],
  dwarven_city: [112, 48, 112],
  crystal_cathedral: [96, 64, 96],
  sunken_temple: [84, 44, 84],
};

export const STRUCTURE_BOSS: Record<StructureKind, [number, number, number]> = {
  mine_complex: [48, 1, 48],
  dwarven_city: [88, 17, 56],
  crystal_cathedral: [48, 10, 48],
  sunken_temple: [42, 8, 42],
};

/** Build a structure's blocks (done once, when it's first needed). */
export function buildStructure(kind: StructureKind, seed: number, p: Palette): Uint16Array {
  return BUILD[kind](seed, p).vol.data;
}
