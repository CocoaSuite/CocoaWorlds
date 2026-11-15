/**
 * The twilit forest's ground: regions in rings round the glade (each its own ground, trees and height), a lair in
 * each, ruins about, and a wall of night at the edge. Chunks are made whole, a column at a time.
 */
import { AIR, EDGE, MAT, MineBlocks, type Structure } from './blocks';
import type { ForestConfig, MineConfig, RegionDef, StructureDef } from './defs';
import { camp, LAIRS, PEDESTALS, ruin, tree, type Built, type Tree } from './forest-lairs';
import { hash3, noise3 } from './noise';
import { KEEP } from './structures';

const BOTTOM = -48;
const RUIN_CELL = 64;

interface Placed extends Structure {
  vol: Built['vol'];
}

const n2 = (x: number, z: number, f: number, s: number) => noise3(x * f, 0.5, z * f, s);

export class ForestBlocks extends MineBlocks {
  readonly forest: ForestConfig;
  private mats = new Map<string, number>();
  private lairs: Placed[] = [];
  private ruins = new Map<number, Placed | null>();
  private raw = new Map<string, Uint16Array>();

  constructor(cfg: MineConfig, seed: number) {
    super(cfg, seed);
    this.forest = cfg.forest!;
    cfg.materials.forEach((m, i) => this.mats.set(m.id, MAT + i));
    this.placeLairs();
  }

  /** A material's block id (0: unknown). */
  m = (id: string): number => this.mats.get(id) ?? AIR;

  override reset(seed: number): void {
    super.reset(seed);
    this.ruins.clear();
    this.raw.clear();
    this.placeLairs();
  }

  /** Distance from the glade (zones are rings). */
  override depth(x: number, _y: number, z: number): number {
    return Math.hypot(x, z);
  }

  override inBase(): boolean {
    return false;
  }

  /** The glade's middle, where monsters don't come. */
  safe(x: number, z: number): boolean {
    return Math.hypot(x, z) < 14;
  }

  /** Region index here (the rings' edges wander a little). */
  region(x: number, z: number): number {
    return this.zoneAt(Math.hypot(x, z) + (n2(x, z, 0.02, this.seed + 21) - 0.5) * 28);
  }

  private regionDef(i: number): RegionDef {
    const id = this.cfg.zones[i]!.id;
    return this.forest.regions.find((r) => r.id === id) ?? this.forest.regions[0]!;
  }

  /** Ground height (the top block's y). Near a ring's edge the two regions blend. */
  height(x: number, z: number): number {
    const r = Math.hypot(x, z) + (n2(x, z, 0.02, this.seed + 21) - 0.5) * 28, zs = this.cfg.zones, s = this.seed;
    const i = this.zoneAt(r), at = (k: number) => {
      const d = this.regionDef(k), [base, amp] = d.height;
      let h = base + amp * (n2(x, z, 0.03, s + 31) * 0.7 + n2(x, z, 0.09, s + 32) * 0.3);
      if (zs[k]!.id === 'ember') h += Math.max(0, n2(x, z, 0.012, s + 33) - 0.5) * 60;
      if (zs[k]!.id === 'frostpine') h += Math.max(0, n2(x, z, 0.02, s + 34) - 0.55) * 40;
      return h;
    };
    let h = at(i);
    const edge = zs[i + 1] ? zs[i + 1]!.from - r : Infinity, back = r - zs[i]!.from;
    if (edge < 14) h += (at(i + 1) - h) * (0.5 - edge / 28);
    else if (i > 0 && back < 14) h += (at(i - 1) - h) * (0.5 - back / 28);
    // (The glade is flat at its heart.)
    const g = Math.hypot(x, z);
    if (g < 16) h += (2 - h) * (1 - g / 16);
    return Math.floor(h);
  }

  /** Where each region's lair stands, and the camp (from the seed). */
  private placeLairs(): void {
    this.lairs = [];
    const zs = this.cfg.zones, pal = this.m;
    const c = camp(pal);
    this.lairs.push(this.put('camp', c, -9, -9, { id: 'camp', label: c.label, from: 0, weight: 0, boss: '' }));
    zs.forEach((z, i) => {
      const r = this.regionDef(i);
      if (!r.lair || !LAIRS[r.lair]) return;
      const b = LAIRS[r.lair]!(Math.floor(hash3(i, 7, 7, this.seed) * 2 ** 30), pal);
      const mid = zs[i + 1] ? (z.from + zs[i + 1]!.from) / 2 : z.from + 60;
      const a = hash3(i, 1, 1, this.seed + 41) * Math.PI * 2;
      const boss = this.cfg.bosses[i - 1]?.id ?? '';
      const [sx, , sz] = [b.vol.sx, b.vol.sy, b.vol.sz];
      this.lairs.push(this.put(r.lair, b, Math.round(Math.cos(a) * mid - sx / 2), Math.round(Math.sin(a) * mid - sz / 2), { id: r.lair, label: b.label, from: 0, weight: 0, boss }));
    });
  }

  private put(key: string, b: Built, ax: number, az: number, def: StructureDef): Placed {
    const { sx, sy, sz } = b.vol;
    // (Stood on the lowest ground under it, so nothing floats.)
    let h = Infinity;
    for (let z = 0; z < sz; z += 4) for (let x = 0; x < sx; x += 4) h = Math.min(h, this.height(ax + x, az + z));
    if (def.id === 'drowned_temple') h = Math.min(h, this.forest.water - 1);
    const ay = h + 1 - b.sink;
    const boss: [number, number, number] = b.boss ? [ax + b.boss[0], ay + b.boss[1], az + b.boss[2]] : [ax + sx / 2, ay, az + sz / 2];
    return { key, def, at: [ax, ay, az], size: [sx, sy, sz], boss, data: b.vol.data, vol: b.vol };
  }

  /** The glade pedestals (block positions). */
  pedestals(): [number, number, number][] {
    const c = this.lairs[0]!;
    return PEDESTALS.map(([x, z]) => [c.at[0] + 9 + x, c.at[1] + 1, c.at[2] + 9 + z]);
  }

  /** Lairs: where they stand (for the map). */
  lairList(): { label: string; boss: string; key: string; x: number; z: number }[] {
    return this.lairs.slice(1).map((l) => ({ label: l.def.label, boss: l.def.boss, key: l.key, x: l.at[0] + l.size[0] / 2, z: l.at[2] + l.size[2] / 2 }));
  }

  private ruinAt(cx: number, cz: number): Placed | null {
    const k = (cx + 4096) * 8192 + (cz + 4096);
    let p = this.ruins.get(k);
    if (p !== undefined) return p;
    p = null;
    const s = this.seed + 51, x = cx * RUIN_CELL + 8 + Math.floor(hash3(cx, 0, cz, s) * (RUIN_CELL - 30)), z = cz * RUIN_CELL + 8 + Math.floor(hash3(cx, 1, cz, s) * (RUIN_CELL - 30));
    const ri = this.region(x, z), r = this.regionDef(ri);
    const clear = this.lairs.every((l) => x + 20 < l.at[0] - 6 || x > l.at[0] + l.size[0] + 6 || z + 20 < l.at[2] - 6 || z > l.at[2] + l.size[2] + 6);
    if (clear && Math.hypot(x, z) < this.forest.radius - 30 && hash3(cx, 2, cz, s) < (r.ruins * RUIN_CELL * RUIN_CELL) / 10000) {
      const brick = this.m(['root_bricks', 'root_bricks', 'drowned_bricks', 'spore_bricks', 'rime_bricks', 'forge_bricks', 'moon_bricks'][ri] ?? 'root_bricks');
      const b = ruin(Math.floor(hash3(cx, 3, cz, s) * 3), Math.floor(hash3(cx, 4, cz, s) * 2 ** 30), brick, this.m);
      p = this.put(`ruin${cx},${cz}`, b, x, z, { id: 'ruin', label: b.label, from: 0, weight: 0, boss: '' });
    }
    this.ruins.set(k, p);
    return p;
  }

  /** Structures whose box meets this one (blocks). */
  private near(x0: number, z0: number, x1: number, z1: number): Placed[] {
    const out = this.lairs.filter((l) => l.at[0] <= x1 && l.at[0] + l.size[0] > x0 && l.at[2] <= z1 && l.at[2] + l.size[2] > z0);
    for (let cz = Math.floor((z0 - 24) / RUIN_CELL); cz <= Math.floor(z1 / RUIN_CELL); cz++)
      for (let cx = Math.floor((x0 - 24) / RUIN_CELL); cx <= Math.floor(x1 / RUIN_CELL); cx++) {
        const r = this.ruinAt(cx, cz);
        if (r && r.at[0] <= x1 && r.at[0] + r.size[0] > x0 && r.at[2] <= z1 && r.at[2] + r.size[2] > z0) out.push(r);
      }
    return out;
  }

  override structureAt(x: number, y: number, z: number): Structure | null {
    for (const s of this.near(x, z, x, z)) {
      const [ax, ay, az] = s.at, [sx, sy, sz] = s.size;
      if (y >= ay && y < ay + sy && x >= ax && x < ax + sx && z >= az && z < az + sz) return s;
    }
    return null;
  }

  override gen(x: number, y: number, z: number): number {
    const S = this.size, cx = Math.floor(x / S), cy = Math.floor(y / S), cz = Math.floor(z / S), k = `${cx},${cy},${cz}`;
    let d = this.raw.get(k);
    if (!d) {
      d = this.fill(cx, cy, cz);
      if (this.raw.size > 96) this.raw.delete(this.raw.keys().next().value!);
      this.raw.set(k, d);
    }
    return d[x - cx * S + S * (z - cz * S + S * (y - cy * S))]!;
  }

  protected override fill(cx: number, cy: number, cz: number): Uint16Array {
    const S = this.size, data = new Uint16Array(S * S * S), x0 = cx * S, y0 = cy * S, z0 = cz * S, s = this.seed, f = this.forest;
    const at = (x: number, y: number, z: number) => x - x0 + S * (z - z0 + S * (y - y0));
    const inside = (x: number, y: number, z: number) => x >= x0 && y >= y0 && z >= z0 && x < x0 + S && y < y0 + S && z < z0 + S;
    const W = this.m('water'), Lv = this.m('lava'), heights = new Int32Array(S * S);
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++) {
        const wx = x0 + x, wz = z0 + z, r = Math.hypot(wx, wz), h = this.height(wx, wz);
        heights[x + S * z] = h;
        const ri = this.region(wx, wz), reg = this.regionDef(ri), zid = this.cfg.zones[ri]!.id;
        if (y0 > Math.max(h, f.water) + 1 && r <= f.radius && (zid !== 'mooncrown' || y0 >= 80)) continue;
        const top = this.m(reg.top), soil = this.m(reg.soil), stone = this.m(reg.stone), deep = this.m('deepstone');
        const pool = zid === 'ember' && n2(wx, wz, 0.05, s + 61) > 0.68;
        for (let y = 0; y < S; y++) {
          const wy = y0 + y;
          let b = AIR;
          if (r > f.radius) b = wy < 96 ? EDGE : AIR;
          else if (wy <= BOTTOM) b = EDGE;
          else if (wy <= h) {
            b = wy === h ? (pool ? Lv : top) : wy > h - 4 ? soil : wy < -24 ? deep : stone;
            if (pool && wy === h - 1) b = Lv;
            // (A few tunnels under the roots.)
            if (wy < h - 5 && wy > BOTTOM + 3) {
              const a = noise3(wx * 0.04, wy * 0.06, wz * 0.04, s + 71), c = noise3(wx * 0.04, wy * 0.06, wz * 0.04, s + 72);
              if (Math.abs(a - 0.5) < 0.03 && Math.abs(c - 0.5) < 0.03) b = AIR;
            }
          } else if (wy <= f.water && zid === 'mirefen') b = W;
          else if (zid === 'mooncrown' && wy > 30 && wy < 80) {
            // Floating islands over the Mooncrown.
            const isl = noise3(wx * 0.025, wy * 0.06, wz * 0.025, s + 81) - Math.abs(wy - 55) / 50;
            if (isl > 0.36) b = this.m(hash3(wx, wy, wz, s) < 0.02 ? 'star_block' : 'moon_stone');
          }
          data[x + S * (z + S * y)] = b;
        }
      }
    // Trees: one may grow in each 4 × 4 patch of ground, looked for out to the widest tree's reach.
    const reach = 10;
    for (let tz = Math.floor((z0 - reach) / 4); tz <= Math.floor((z0 + S + reach) / 4); tz++)
      for (let tx = Math.floor((x0 - reach) / 4); tx <= Math.floor((x0 + S + reach) / 4); tx++) {
        const px = tx * 4 + Math.floor(hash3(tx, 5, tz, s) * 4), pz = tz * 4 + Math.floor(hash3(tx, 6, tz, s) * 4);
        if (Math.hypot(px, pz) > f.radius - 4 || this.safe(px, pz)) continue;
        const reg = this.regionDef(this.region(px, pz)), kinds = Object.entries(reg.trees), total = kinds.reduce((a, [, n]) => a + n, 0);
        if (!total || hash3(tx, 7, tz, s) > (total * 16) / 100) continue;
        let pick = hash3(tx, 8, tz, s) * total, kind = kinds[0]![0];
        for (const [k, n] of kinds) if ((pick -= n) <= 0) {
          kind = k;
          break;
        }
        const big = kind === 'giant';
        if (big && hash3(tx, 9, tz, s) > 0.5) continue;
        const gx = px - x0, gz = pz - z0;
        const h = gx >= 0 && gz >= 0 && gx < S && gz < S ? heights[gx + S * gz]! : this.height(px, pz);
        if (h < f.water && kind !== 'willow') continue;
        if (y0 > h + 40 || y0 + S < h - 4) continue;
        if (this.near(px - 3, pz - 3, px + 3, pz + 3).length) continue;
        const t: Tree = tree(kind, Math.floor(hash3(px, 0, pz, s) * 2 ** 30), this.m);
        for (const [dx, dy, dz, id] of t) {
          const x = px + dx, y = h + 1 + dy, z = pz + dz;
          if (!inside(x, y, z)) continue;
          const i = at(x, y, z), was = data[i]!;
          // (Leaves don't overwrite wood or ground; trunks and hollows do.)
          if (this.clear(id) && id !== AIR && was !== AIR && was !== W) continue;
          data[i] = id;
        }
      }
    // Structures last: they clear what's in their way.
    for (const st of this.near(x0, z0, x0 + S - 1, z0 + S - 1)) {
      const [ax, ay, az] = st.at, [sx, sy, sz] = st.size, d = st.vol.data;
      for (let y = Math.max(y0, ay); y < Math.min(y0 + S, ay + sy); y++)
        for (let z = Math.max(z0, az); z < Math.min(z0 + S, az + sz); z++)
          for (let x = Math.max(x0, ax); x < Math.min(x0 + S, ax + sx); x++) {
            const v = d[x - ax + sx * (z - az + sz * (y - ay))]!;
            if (v !== KEEP) data[at(x, y, z)] = v;
          }
    }
    return data;
  }
}
