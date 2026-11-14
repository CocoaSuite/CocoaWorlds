/**
 * Mining: an endless block mine around the base. Pickaxe swings break blocks, ores fill the backpack, the base
 * buys them, money buys pickaxes and skills. Monsters live in the caves. The mine regenerates on a timer.
 */
import { AIR, blockId, EDGE, MineBlocks, oreOf, zoneOf, type Chunk, type RayHit } from './blocks';
import { mineConfig, type MineConfig, type MobDef, type Stat, type TwistDef } from './defs';
import { Mob, stepArrow, type Arrow, type MobWorld } from './mobs';

export interface MineHost {
  /** Game time (s). */
  time(): number;
  /** Real time (ms since 1970). */
  now(): number;
  /** The player's feet and eye (world units) and where they look, or null. */
  player(): { feet: [number, number, number]; eye: [number, number, number]; dir: [number, number, number] } | null;
  hurt(amount: number, cause: string): void;
  heal(amount: number): void;
  say(text: string, seconds: number): void;
  sound(file: string, at: [number, number, number] | null): void;
  home(): void;
  random(): number;
}

export type MineFx =
  | { kind: 'break'; x: number; y: number; z: number; block: number }
  | { kind: 'hit'; x: number; y: number; z: number; block: number }
  | { kind: 'mob'; id: string }
  | { kind: 'boom'; x: number; y: number; z: number; r: number };

/** A lit stick of dynamite (block space). */
export interface Bomb {
  pos: [number, number, number];
  vel: [number, number, number];
  at: number;
}

export interface MineHud {
  money: number;
  bag: number;
  cap: number;
  zone: string;
  distance: number;
  pickaxe: string;
  /** Seconds until the mine regenerates. */
  regen: number;
  home: boolean;
  /** A surface mine (home is above ground). */
  surface: boolean;
  /** Standing in the sell zone. */
  atSell: boolean;
  /** What the backpack holds: ore id, name, how many. */
  items: { id: string; label: string; n: number }[];
  /** This mine's twist. */
  twist: string;
  dynamite: number;
  /** The block aimed at: how broken (0…1), or why it can't be (needs a better pickaxe). */
  aim: { label: string; broken: number; needs: string } | null;
}

export interface MineMenu {
  money: number;
  pickaxe: { label: string; power: number; color: string; level: number; next: { label: string; price: number; power: number; color: string } | null };
  skills: { id: string; branch: string; label: string; text: string; level: number; max: number; cost: number; at: [number, number]; needs: string[]; open: boolean }[];
  branches: { id: string; label: string; color: string }[];
  bag: { id: string; label: string; n: number; value: number; color: string }[];
  /** Where ores sell: a sell zone, or anywhere back home. */
  sellZone: boolean;
  twist: { label: string; text: string };
  dynamite: { n: number; price: number };
  cap: number;
  home: boolean;
  surface: boolean;
}

const fmtCost = (n: number) => Math.round(n);

export class MineSystem {
  readonly config: MineConfig;
  readonly blocks: MineBlocks;
  readonly B: number;
  origin: [number, number, number] = [0, 0, 0];
  money = 0;
  tier = 0;
  level = 0;
  skills = new Map<string, number>();
  /** Ore index → count and their worth. */
  bag = new Map<number, { n: number; value: number }>();
  nextRegen = 0;
  menuOpen = false;
  mobs: Mob[] = [];
  arrows: Arrow[] = [];
  /** Aimed block and how much damage it has taken. */
  aim: RayHit | null = null;
  private dug: { x: number; y: number; z: number; damage: number } | null = null;
  private nextSwing = 0;
  /** When the pickaxe last swung (game time), for drawing. */
  swungAt = -1;
  private spawnAt = 0;
  /** This mine's twist (rolled each time it regenerates). */
  twist!: TwistDef;
  dynamite = 0;
  bombs: Bomb[] = [];
  /** Monsters still living in each cave sector (only sectors seen so far). */
  readonly sectors = new Map<string, number>();
  private fx: MineFx[] = [];
  private statCache: Map<Stat, number> | null = null;
  private saidAt = new Map<string, number>();
  inBase = false;
  /** Nothing else in the player's hands (set by the world): the pickaxe is out. */
  handFree = true;
  /** The sell zone's middle (world), from a scene object called “Sell”; null: selling happens on getting home. */
  sellAt: [number, number, number] | null = null;
  atSell = false;

  constructor(
    over: unknown,
    private host: MineHost,
  ) {
    this.config = mineConfig(over);
    this.B = this.config.block;
    this.blocks = new MineBlocks(this.config, this.newSeed());
    this.useTwist(this.rollTwist());
    this.blocks.reset(this.blocks.seed);
    this.nextRegen = host.now() + this.config.regenMinutes * 60000;
  }

  private rollTwist(): TwistDef {
    const list = this.config.twists.filter((t) => t.weight > 0 && t.id !== this.twist?.id);
    const total = list.reduce((s, t) => s + t.weight, 0);
    let r = this.host.random() * total;
    for (const t of list) if ((r -= t.weight) <= 0) return t;
    return list[list.length - 1] ?? { id: 'normal', label: '', text: '', weight: 1 };
  }

  private useTwist(t: TwistDef): void {
    this.twist = t;
    this.blocks.setTwist(t);
  }

  private newSeed(): number {
    return this.config.seed || Math.floor(this.host.random() * 2 ** 31) || 1;
  }

  // ── Places ──

  /** World point → block space (block (i, j, k) fills [i, i + 1)). */
  toBlock(p: readonly number[]): [number, number, number] {
    const [ox, oy, oz] = this.origin, B = this.B;
    return [(p[0]! - ox) / B + 0.5, (p[1]! - oy) / B, (p[2]! - oz) / B + 0.5];
  }

  /** Block space → world point. */
  toWorld(x: number, y: number, z: number): [number, number, number] {
    const [ox, oy, oz] = this.origin, B = this.B;
    return [ox + (x - 0.5) * B, oy + y * B, oz + (z - 0.5) * B];
  }

  distance(x: number, y: number, z: number): number {
    return this.blocks.depth(x, y, z);
  }

  // ── Stats ──

  stat(s: Stat): number {
    if (!this.statCache) {
      this.statCache = new Map();
      for (const d of this.config.skills) {
        const l = this.skills.get(d.id) ?? 0;
        if (l) this.statCache.set(d.stat, (this.statCache.get(d.stat) ?? 0) + l * d.per);
      }
    }
    return this.statCache.get(s) ?? 0;
  }

  get capacity(): number {
    return Math.floor((this.config.backpack + this.stat('capacity')) * (1 + this.stat('capacityMul')));
  }

  get carried(): number {
    let n = 0;
    for (const b of this.bag.values()) n += b.n;
    return n;
  }

  power(): number {
    const ps = this.config.pickaxes, p = ps[this.tier]!;
    return p.power * Math.pow(this.config.pickaxeLevels.power, this.level);
  }

  lightRadius(): number {
    return (this.config.light + this.stat('light')) * (this.twist.light ?? 1);
  }

  private hardness(id: number, d: number): number {
    const z = this.config.zones[zoneOf(id)]!, o = oreOf(id);
    return z.hardness * (o >= 0 ? this.config.ores[o]!.hardness : 1) * Math.pow(this.config.hardGrowth, d) * (this.twist.hardness ?? 1);
  }

  private label(id: number): string {
    if (id === EDGE) return 'Mine edge';
    const o = oreOf(id);
    return o >= 0 ? this.config.ores[o]!.label : this.config.zones[zoneOf(id)]!.label;
  }

  // ── Each step ──

  tick(dt: number, fire: boolean): void {
    const time = this.host.time();
    if (this.host.now() >= this.nextRegen) this.regenerate(true);
    const pl = this.host.player();
    if (!pl) return;
    const [px, py, pz] = this.toBlock(pl.feet);
    this.loadAround(px, py, pz);
    this.inBase = this.blocks.inBase(Math.floor(px), Math.floor(py + 0.1), Math.floor(pz));
    const wasSell = this.atSell, s = this.sellAt, f = pl.feet;
    this.atSell = s ? Math.hypot(f[0] - s[0], f[1] - s[1], f[2] - s[2]) < this.config.sellRadius * this.B : this.inBase;
    if (this.atSell && !wasSell) this.sell();
    const regen = this.stat('regen');
    if (regen > 0) this.host.heal(regen * dt);

    const eye = this.toBlock(pl.eye), d = pl.dir;
    const reach = this.config.reach;
    this.aim = this.menuOpen ? null : this.blocks.raycast(eye[0], eye[1], eye[2], d[0], d[1], d[2], reach);
    if (this.aim && this.blocks.inBase(this.aim.x, this.aim.y, this.aim.z)) this.aim = null;
    if (fire && !this.menuOpen && time >= this.nextSwing) {
      const speed = this.config.pickaxes[this.tier]!.speed * (1 + this.stat('swingSpeed'));
      this.nextSwing = time + 1 / speed;
      this.swungAt = time;
      this.swing(eye, d, time);
    }
    const world = this.mobWorld();
    for (const m of this.mobs) m.step(dt, world, time);
    this.mobs = this.mobs.filter((m) => !(m.dead && time - m.diedAt > 1.5) && Math.hypot(m.pos[0] - px, m.pos[1] - py, m.pos[2] - pz) < 48);
    this.arrows = this.arrows.filter((a) => stepArrow(a, dt, world, time));
    this.bombs = this.bombs.filter((b) => this.stepBomb(b, dt, time));
    if (time >= this.spawnAt) {
      const many = this.twist.mobs ?? 1;
      this.spawnAt = time + this.config.spawnEvery / Math.max(1, many);
      if (this.mobs.filter((m) => !m.dead).length < Math.round(this.config.maxMobs * many)) this.spawn(px, py, pz);
    }
  }

  // ── Dynamite ──

  dynamitePrice(): number {
    const d = this.config.dynamite;
    return Math.round(d.price * Math.pow(d.growth, this.tier));
  }

  buyDynamite(n: number): boolean {
    const cost = this.dynamitePrice() * n;
    if (n <= 0 || this.money < cost) return false;
    this.money -= cost;
    this.dynamite += n;
    this.play('buy', null);
    return true;
  }

  /** Throw a lit stick where the player looks. */
  throwDynamite(): boolean {
    const pl = this.host.player();
    if (!pl || this.dynamite <= 0 || !this.handFree || this.menuOpen) return false;
    this.dynamite--;
    const e = this.toBlock(pl.eye), d = pl.dir, s = this.config.dynamite.speed;
    this.bombs.push({ pos: [e[0] + d[0] * 0.5, e[1] + d[1] * 0.5, e[2] + d[2] * 0.5], vel: [d[0] * s, d[1] * s + 2, d[2] * s], at: this.host.time() + this.config.dynamite.fuse });
    this.play('fuse', null);
    return true;
  }

  private stepBomb(b: Bomb, dt: number, time: number): boolean {
    if (time >= b.at) {
      this.explode(b.pos);
      return false;
    }
    b.vel[1] -= (800 / this.B) * dt;
    for (const i of [0, 1, 2] as const) {
      const was = b.pos[i];
      b.pos[i] += b.vel[i] * dt;
      if (this.blocks.solid(Math.floor(b.pos[0]), Math.floor(b.pos[1]), Math.floor(b.pos[2]))) {
        b.pos[i] = was;
        b.vel[i] *= -0.25;
        // (It settles on the ground.)
        if (i === 1) {
          b.vel[0] *= 0.6;
          b.vel[2] *= 0.6;
        }
      }
    }
    return true;
  }

  /** Blow up: rock up to one tier past the pickaxe breaks (ores go in the backpack); monsters and the player get hurt. */
  explode(at: [number, number, number]): void {
    const r = this.config.dynamite.radius, [cx, cy, cz] = at;
    for (let y = Math.floor(cy - r); y <= Math.floor(cy + r); y++)
      for (let z = Math.floor(cz - r); z <= Math.floor(cz + r); z++)
        for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x++) {
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz) > r) continue;
          const id = this.blocks.get(x, y, z);
          if (id === AIR || id === EDGE || this.blocks.inBase(x, y, z)) continue;
          if (this.config.zones[zoneOf(id)]!.tier > this.tier + 1) continue;
          this.breakBlock(x, y, z, id, true);
        }
    const time = this.host.time();
    for (const m of this.mobs) {
      const d = Math.hypot(m.pos[0] - cx, m.pos[1] + m.h / 2 - cy, m.pos[2] - cz);
      if (m.dead || d > r + 1) continue;
      const l = Math.hypot(m.pos[0] - cx, m.pos[2] - cz) || 1;
      m.hit(m.maxHp * 0.8 + this.power() * 10, [((m.pos[0] - cx) / l) * 8, ((m.pos[2] - cz) / l) * 8], time);
      if (m.dead) this.paid(m);
    }
    const pl = this.host.player();
    if (pl) {
      const [px, py, pz] = this.toBlock(pl.feet);
      if (Math.hypot(px - cx, py + 0.9 - cy, pz - cz) < r + 0.5) this.host.hurt(this.config.dynamite.damage, 'dynamite');
    }
    this.fx.push({ kind: 'boom', x: cx, y: cy, z: cz, r });
    this.play('boom', { x: cx - 0.5, y: cy - 0.5, z: cz - 0.5 });
  }

  private loaded = 0;
  /** Chunks near the player are made a few at a time; far ones let go. */
  private loadAround(px: number, py: number, pz: number): void {
    const v = this.config.view;
    const [cx, cy, cz] = this.blocks.chunkOf(Math.floor(px), Math.floor(py), Math.floor(pz));
    let budget = 1;
    const want: [number, number, number, number][] = [];
    for (let y = -v; y <= v; y++) for (let z = -v; z <= v; z++) for (let x = -v; x <= v; x++) if (!this.blocks.loaded(cx + x, cy + y, cz + z)) want.push([x * x + y * y + z * z, cx + x, cy + y, cz + z]);
    want.sort((a, b) => a[0] - b[0]);
    for (const [r, x, y, z] of want) {
      // (The player's own chunk and its neighbours load at once: they collide.)
      if (budget <= 0 && r > 3) break;
      this.blocks.chunk(x, y, z);
      budget--;
    }
    if (++this.loaded % 60 === 0)
      for (const c of [...this.blocks.chunks.values()]) if (Math.max(Math.abs(c.cx - cx), Math.abs(c.cy - cy), Math.abs(c.cz - cz)) > v + 1) this.blocks.unload(c);
  }

  // ── Swinging ──

  private swing(eye: [number, number, number], dir: [number, number, number], time: number): void {
    const reach = this.config.reach;
    const blockT = this.aim?.t ?? Infinity;
    let best: Mob | null = null, bestT = Math.min(reach, blockT);
    for (const m of this.mobs) {
      if (m.dead) continue;
      const t = rayBox(eye, dir, [m.pos[0] - m.w / 2, m.pos[1], m.pos[2] - m.w / 2], [m.pos[0] + m.w / 2, m.pos[1] + m.h, m.pos[2] + m.w / 2]);
      if (t !== null && t < bestT) {
        best = m;
        bestT = t;
      }
    }
    if (best) return this.hitMob(best, dir, time);
    const a = this.aim;
    if (!a) return;
    const id = this.blocks.get(a.x, a.y, a.z);
    if (id === EDGE) return this.once('edge', 'That is the edge of the mine.');
    const zone = this.config.zones[zoneOf(id)]!;
    if (zone.tier > this.tier) {
      this.once(`tier${zone.tier}`, `Too hard. Needs a ${this.config.pickaxes[zone.tier]!.label}.`);
      return;
    }
    const d = this.distance(a.x, a.y, a.z);
    if (!this.dug || this.dug.x !== a.x || this.dug.y !== a.y || this.dug.z !== a.z) this.dug = { x: a.x, y: a.y, z: a.z, damage: 0 };
    this.dug.damage += this.power() * (1 + this.stat('mineDamage'));
    this.fx.push({ kind: 'hit', x: a.x, y: a.y, z: a.z, block: id });
    if (this.dug.damage < this.hardness(id, d)) {
      this.play('hit', a);
      return;
    }
    this.dug = null;
    this.breakBlock(a.x, a.y, a.z, id);
    if (this.host.random() < this.stat('multiBreak')) {
      const bx = a.x - a.n[0], by = a.y - a.n[1], bz = a.z - a.n[2], back = this.blocks.get(bx, by, bz);
      if (back !== AIR && back !== EDGE && !this.blocks.inBase(bx, by, bz) && this.config.zones[zoneOf(back)]!.tier <= this.tier) this.breakBlock(bx, by, bz, back);
    }
  }

  private breakBlock(x: number, y: number, z: number, id: number, quiet = false): void {
    this.blocks.set(x, y, z, AIR);
    this.fx.push({ kind: 'break', x, y, z, block: id });
    let ore = oreOf(id);
    let n = 0;
    if (ore >= 0) n = 1 + (this.host.random() < this.stat('doubleOre') + (this.twist.double ?? 0) ? 1 : 0);
    else if (this.host.random() < this.stat('oreChance')) {
      const t = this.config.zones[zoneOf(id)]!.ores, ids = Object.keys(t);
      if (ids.length) {
        ore = this.config.ores.findIndex((o) => o.id === ids[Math.floor(this.host.random() * ids.length)]);
        n = ore >= 0 ? 1 : 0;
      }
    }
    if (!quiet) this.play(n ? 'ore' : 'break', { x, y, z });
    if (!n) return;
    const room = this.capacity - this.carried;
    if (room <= 0) return this.once('full', 'Backpack full. Go and sell.');
    n = Math.min(n, room);
    const value = this.config.ores[ore]!.value * Math.pow(this.config.valueGrowth, this.distance(x, y, z)) * (1 + this.stat('oreValue')) * (this.twist.value ?? 1);
    const b = this.bag.get(ore) ?? { n: 0, value: 0 };
    b.n += n;
    b.value += value * n;
    this.bag.set(ore, b);
  }

  private hitMob(m: Mob, dir: [number, number, number], time: number): void {
    const push = 3 * (1 + this.stat('knockback'));
    const l = Math.hypot(dir[0], dir[2]) || 1;
    m.hit(this.power() * (1 + this.stat('mobDamage')), [(dir[0] / l) * push, (dir[2] / l) * push], time);
    this.fx.push({ kind: 'mob', id: m.id });
    const at = { x: m.pos[0] - 0.5, y: m.pos[1], z: m.pos[2] - 0.5 };
    if (!m.dead) return this.play('mobHit', at);
    this.play('mobDie', at);
    this.paid(m);
  }

  private paid(m: Mob): void {
    // (One fewer in its cave; a cave emptied stays empty.)
    const left = this.sectors.get(m.sector);
    if (left !== undefined && left > 0) {
      this.sectors.set(m.sector, left - 1);
      if (left === 1 && !this.mobs.some((o) => !o.dead && o.sector === m.sector)) this.once('cleared', 'Cave cleared.');
    }
    const pay = Math.round(m.reward * (1 + this.stat('bounty')) * (this.twist.reward ?? 1));
    if (pay > 0) {
      this.money += pay;
      this.host.say(`${m.def.label} +$${pay}`, 2);
    }
  }

  // ── Monsters ──

  private mobWorld(): MobWorld {
    const self = this;
    return {
      solid: (x, y, z) => this.blocks.solid(x, y, z) || this.blocks.inBase(x, y, z),
      player: () => {
        const p = self.host.player();
        if (!p) return null;
        const [x, y, z] = self.toBlock(p.feet);
        return { x, y, z, h: 72 / self.B, r: 16 / self.B };
      },
      hurt: (n, cause) => this.host.hurt(n, cause),
      sees: (ax, ay, az, bx, by, bz) => {
        const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz);
        const hit = this.blocks.raycast(ax, ay, az, dx, dy, dz, l);
        return !hit || hit.t >= l - 0.01;
      },
      shoot: (from, vel, damage, by) => {
        this.arrows.push({ pos: [...from], vel, damage, by, until: this.host.time() + 3 });
        this.play('arrow', { x: from[0] - 0.5, y: from[1], z: from[2] - 0.5 });
      },
      gravity: 800 / this.B,
      random: () => this.host.random(),
    };
  }

  private spawn(px: number, py: number, pz: number): void {
    const rnd = () => this.host.random();
    const [bx, , bz] = this.config.base, c0 = this.config;
    const eye = this.toBlock(this.host.player()?.eye ?? [0, 0, 0]);
    for (let tries = 0; tries < 12; tries++) {
      const a = rnd() * Math.PI * 2, e = (rnd() - 0.5) * 1.2, r = 12 + rnd() * 14;
      const x = Math.floor(px + Math.cos(a) * Math.cos(e) * r), z = Math.floor(pz + Math.sin(a) * Math.cos(e) * r);
      let y = Math.floor(py + Math.sin(e) * r);
      if (c0.surface ? y > -c0.crust - 2 : Math.max(Math.abs(x) - bx, Math.abs(z) - bz) < 6 && Math.abs(y) < 12) continue;
      if (this.blocks.solid(x, y, z)) continue;
      let k = 0;
      while (k++ < 8 && !this.blocks.solid(x, y - 1, z)) y--;
      if (!this.blocks.solid(x, y - 1, z) || this.blocks.solid(x, y + 1, z)) continue;
      // (Its cave sector must still have monsters to spare, and the player mustn't see it appear.)
      const sector = this.sectorOf(x, y, z);
      if (this.mobs.filter((m) => !m.dead && m.sector === sector).length >= this.population(sector)) continue;
      const dx = x + 0.5 - eye[0], dy = y + 1 - eye[1], dz = z + 0.5 - eye[2], l = Math.hypot(dx, dy, dz);
      const seen = this.blocks.raycast(eye[0], eye[1], eye[2], dx, dy, dz, l);
      if (!seen || seen.t >= l - 0.5) continue;
      const d = this.distance(x, y, z), zone = this.blocks.zoneAt(d);
      const kinds = this.config.mobs.filter((m) => m.zone <= zone && m.weight > 0);
      const def = pick(kinds, rnd());
      if (!def) return;
      if (def.size[1] / this.B > 1.05 && this.blocks.solid(x, y + 1, z)) continue;
      const c = this.config;
      const mob = new Mob(def, [x + 0.5, y, z + 0.5], this.B, def.damage * Math.pow(c.mobHitGrowth, d), def.reward * Math.pow(c.valueGrowth, d), def.health * Math.pow(c.mobGrowth, d));
      mob.sector = sector;
      this.mobs.push(mob);
      return;
    }
  }

  private sectorOf(x: number, y: number, z: number): string {
    const s = this.config.caveMobs.size;
    return `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`;
  }

  /** How many monsters a cave sector holds: from its natural open space the first time, then what's left. */
  private population(sector: string): number {
    const had = this.sectors.get(sector);
    if (had !== undefined) return had;
    const { size, per, max } = this.config.caveMobs, [sx, sy, sz] = sector.split(',').map(Number) as [number, number, number];
    let air = 0;
    for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) if (this.blocks.gen(sx * size + x, sy * size + y, sz * size + z) === AIR) air++;
    const n = Math.round(Math.min(max, Math.floor(air / per)) * (this.twist.mobs ?? 1));
    this.sectors.set(sector, n);
    return n;
  }

  // ── Base, menus and buying ──

  sell(): void {
    if (!this.bag.size) return;
    let total = 0;
    for (const b of this.bag.values()) total += b.value;
    total = Math.round(total * (1 + this.stat('sellPrice')));
    this.bag.clear();
    this.money += total;
    this.host.say(`Sold for $${total}`, 3);
    this.play('sell', null);
  }

  /** The player died: part of the backpack is lost. */
  died(): void {
    const loss = this.config.deathLoss * Math.max(0, 1 - this.stat('deathLoss'));
    for (const [k, b] of this.bag) {
      const keep = Math.floor(b.n * (1 - loss));
      if (keep <= 0) this.bag.delete(k);
      else this.bag.set(k, { n: keep, value: (b.value * keep) / b.n });
    }
  }

  nextPickaxe(): { label: string; price: number; power: number; color: string } | null {
    const ps = this.config.pickaxes, L = this.config.pickaxeLevels;
    if (this.tier + 1 < ps.length) {
      const n = ps[this.tier + 1]!;
      return { label: n.label, price: n.price, power: n.power, color: n.color };
    }
    const p = ps[this.tier]!;
    return { label: `${p.label} +${this.level + 1}`, price: fmtCost(L.price * Math.pow(L.growth, this.level)), power: p.power * Math.pow(L.power, this.level + 1), color: p.color };
  }

  buyPickaxe(): boolean {
    const n = this.nextPickaxe();
    if (!n || this.money < n.price) return false;
    this.money -= n.price;
    if (this.tier + 1 < this.config.pickaxes.length) this.tier++;
    else this.level++;
    this.play('buy', null);
    return true;
  }

  skillCost(id: string): number {
    const d = this.config.skills.find((s) => s.id === id);
    return d ? fmtCost(d.price * Math.pow(d.growth, this.skills.get(id) ?? 0)) : Infinity;
  }

  skillOpen(id: string): boolean {
    const d = this.config.skills.find((s) => s.id === id);
    return !!d && d.needs.every((n) => (this.skills.get(n) ?? 0) > 0);
  }

  buySkill(id: string): boolean {
    const d = this.config.skills.find((s) => s.id === id);
    if (!d || !this.skillOpen(id)) return false;
    const l = this.skills.get(id) ?? 0;
    if (d.max > 0 && l >= d.max) return false;
    const cost = this.skillCost(id);
    if (this.money < cost) return false;
    this.money -= cost;
    this.skills.set(id, l + 1);
    this.statCache = null;
    this.play('buy', null);
    return true;
  }

  /** Menu buttons. */
  action(name: string, arg = ''): void {
    if (name === 'menu') this.menuOpen = arg === 'open' ? true : arg === 'close' ? false : !this.menuOpen;
    else if (name === 'home') {
      this.menuOpen = false;
      this.host.home();
    } else if (name === 'pickaxe') this.buyPickaxe();
    else if (name === 'skill') this.buySkill(arg);
    else if (name === 'dynamite') this.buyDynamite(Math.max(1, Math.floor(Number(arg) || 1)));
    else if (name === 'throw') this.throwDynamite();
  }

  /** Regenerate: a new mine, the player taken home (unless already there). */
  regenerate(announce: boolean): void {
    this.useTwist(this.rollTwist());
    this.blocks.reset(this.newSeed());
    this.mobs = [];
    this.arrows = [];
    this.bombs = [];
    this.sectors.clear();
    this.dug = null;
    this.nextRegen = this.host.now() + this.config.regenMinutes * 60000;
    if (!this.inBase) this.host.home();
    if (announce) this.host.say(`The mine has shifted: ${this.twist.label}. ${this.twist.text}`, 6);
  }

  hud(): MineHud {
    const pl = this.host.player();
    const b = pl ? this.toBlock(pl.feet) : [0, 0, 0];
    const d = this.distance(b[0]! - 0.5, b[1]!, b[2]! - 0.5);
    let aim: MineHud['aim'] = null;
    if (this.aim) {
      const id = this.blocks.get(this.aim.x, this.aim.y, this.aim.z);
      const z = this.config.zones[Math.min(this.config.zones.length - 1, zoneOf(id))]!;
      const dug = this.dug && this.dug.x === this.aim.x && this.dug.y === this.aim.y && this.dug.z === this.aim.z ? this.dug.damage : 0;
      // (The aimed block may have just been dug out.)
      if (id === AIR) aim = null;
      else if (id === EDGE) aim = { label: this.label(id), broken: 0, needs: '' };
      else aim = { label: this.label(id), broken: Math.min(1, dug / this.hardness(id, this.distance(this.aim.x, this.aim.y, this.aim.z))), needs: z.tier > this.tier ? this.config.pickaxes[z.tier]!.label : '' };
    }
    const p = this.config.pickaxes[this.tier]!;
    return {
      money: Math.floor(this.money),
      bag: this.carried,
      cap: this.capacity,
      zone: this.config.zones[this.blocks.zoneAt(d)]!.label,
      distance: Math.floor(d),
      pickaxe: this.level ? `${p.label} +${this.level}` : p.label,
      regen: Math.max(0, Math.ceil((this.nextRegen - this.host.now()) / 1000)),
      home: this.inBase,
      surface: this.config.surface,
      atSell: !!this.sellAt && this.atSell,
      twist: this.twist.label,
      dynamite: this.dynamite,
      items: [...this.bag].map(([i, b]) => ({ id: this.config.ores[i]!.id, label: this.config.ores[i]!.label, n: b.n })),
      aim,
    };
  }

  menu(): MineMenu | null {
    if (!this.menuOpen) return null;
    const p = this.config.pickaxes[this.tier]!;
    return {
      money: Math.floor(this.money),
      pickaxe: { label: this.level ? `${p.label} +${this.level}` : p.label, power: Math.round(this.power()), color: p.color, level: this.level, next: this.nextPickaxe() },
      skills: this.config.skills.map((d) => ({ id: d.id, branch: d.branch, label: d.label, text: d.text, level: this.skills.get(d.id) ?? 0, max: d.max, cost: this.skillCost(d.id), at: d.at, needs: d.needs, open: this.skillOpen(d.id) })),
      branches: this.config.branches,
      sellZone: !!this.sellAt,
      twist: { label: this.twist.label, text: this.twist.text },
      dynamite: { n: this.dynamite, price: this.dynamitePrice() },
      bag: [...this.bag].map(([i, b]) => ({ id: this.config.ores[i]!.id, label: this.config.ores[i]!.label, n: b.n, value: Math.round(b.value), color: this.config.ores[i]!.color })),
      cap: this.capacity,
      home: this.inBase,
      surface: this.config.surface,
    };
  }

  /** What happened since last asked, for drawing (breaks, hits). */
  drainFx(): MineFx[] {
    const f = this.fx;
    this.fx = [];
    return f;
  }

  /** How broken the aimed block is (0…1). */
  crack(): number {
    const a = this.aim, d = this.dug;
    if (!a || !d || d.x !== a.x || d.y !== a.y || d.z !== a.z) return 0;
    const id = this.blocks.get(a.x, a.y, a.z);
    return id === AIR || id === EDGE ? 0 : Math.min(1, d.damage / this.hardness(id, this.distance(a.x, a.y, a.z)));
  }

  private play(kind: keyof MineConfig['sounds'], at: { x: number; y: number; z: number } | null): void {
    const f = this.config.sounds[kind];
    if (f) this.host.sound(f, at ? this.toWorld(at.x + 0.5, at.y + 0.5, at.z + 0.5) : null);
  }

  private once(key: string, text: string): void {
    const t = this.host.time();
    if ((this.saidAt.get(key) ?? -99) > t - 3) return;
    this.saidAt.set(key, t);
    this.host.say(text, 2.5);
  }

  // ── Saving ──

  save(): unknown {
    return {
      v: 1,
      money: this.money,
      tier: this.tier,
      level: this.level,
      skills: Object.fromEntries(this.skills),
      bag: [...this.bag].map(([i, b]) => [this.config.ores[i]!.id, b.n, b.value]),
      seed: this.blocks.seed,
      twist: this.twist.id,
      dynamite: this.dynamite,
      caves: Object.fromEntries(this.sectors),
      next: this.nextRegen,
      dug: this.blocks.save(),
    };
  }

  load(s: unknown): void {
    if (!s || typeof s !== 'object') return;
    const o = s as Record<string, unknown>;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    this.money = Math.max(0, num(o.money, 0));
    this.tier = Math.max(0, Math.min(this.config.pickaxes.length - 1, Math.floor(num(o.tier, 0))));
    this.level = Math.max(0, Math.floor(num(o.level, 0)));
    this.skills = new Map();
    if (o.skills && typeof o.skills === 'object')
      for (const [k, v] of Object.entries(o.skills)) if (this.config.skills.some((d) => d.id === k) && typeof v === 'number' && v > 0) this.skills.set(k, Math.floor(v));
    this.statCache = null;
    this.bag = new Map();
    if (Array.isArray(o.bag))
      for (const e of o.bag) {
        if (!Array.isArray(e)) continue;
        const i = this.config.ores.findIndex((x) => x.id === e[0]);
        if (i >= 0 && typeof e[1] === 'number' && e[1] > 0) this.bag.set(i, { n: Math.floor(e[1]), value: num(e[2], 0) });
      }
    this.nextRegen = num(o.next, this.nextRegen);
    this.dynamite = Math.max(0, Math.floor(num(o.dynamite, 0)));
    if (typeof o.seed === 'number' && this.host.now() < this.nextRegen) {
      const t = this.config.twists.find((x) => x.id === o.twist);
      if (t) this.useTwist(t);
      this.blocks.reset(o.seed);
      this.sectors.clear();
      if (o.caves && typeof o.caves === 'object') for (const [k, v] of Object.entries(o.caves)) if (typeof v === 'number' && v >= 0) this.sectors.set(k, Math.floor(v));
      this.blocks.load(o.dug);
    } else {
      this.useTwist(this.rollTwist());
      this.blocks.reset(this.newSeed());
      this.nextRegen = this.host.now() + this.config.regenMinutes * 60000;
    }
  }

  /** Every loaded chunk (for drawing and colliders). */
  chunks(): Iterable<Chunk> {
    return this.blocks.chunks.values();
  }
}

/** Weighted pick by `weight`. */
function pick(list: MobDef[], r: number): MobDef | null {
  const total = list.reduce((s, m) => s + m.weight, 0);
  let t = r * total;
  for (const m of list) if ((t -= m.weight) <= 0) return m;
  return list[list.length - 1] ?? null;
}

/** Distance along a ray to a box, or null. */
function rayBox(o: number[], d: number[], lo: number[], hi: number[]): number | null {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-9) {
      if (o[i]! < lo[i]! || o[i]! > hi[i]!) return null;
      continue;
    }
    let a = (lo[i]! - o[i]!) / d[i]!, b = (hi[i]! - o[i]!) / d[i]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

export { AIR, blockId, EDGE, oreOf, zoneOf };
