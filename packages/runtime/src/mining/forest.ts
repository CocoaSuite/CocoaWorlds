/**
 * The twilit forest: a world of regions in rings round the glade. Gear comes from chests, ruins and bosses; each
 * boss's trophy lifts the curse on the next region. A sword and a pickaxe in hand, and blocks to build with.
 */
import { AIR, MAT, type MineBlocks } from './blocks';
import type { Boss } from './bosses';
import type { BossDef, Stat } from './defs';
import { ForestBlocks } from './forest-gen';
import { MineSystem, type MineHost, type MineHud, type MineMenu } from './mine';
import { Mob } from './mobs';

export interface ForestHud {
  region: string;
  curse: string;
  hand: number;
  slots: { kind: 'sword' | 'pickaxe' | 'block'; label: string; mat: string; color: string; block: number; n: number }[];
  trophies: number;
}

export interface ForestMenu {
  sword: string;
  pickaxe: string;
  armor: string;
  shards: number;
  charms: { label: string; text: string; owned: boolean }[];
  trophies: { boss: string; region: string; done: boolean }[];
  map: { radius: number; rings: { from: number; label: string; color: string; cursed: boolean }[]; lairs: { x: number; z: number; label: string; done: boolean }[]; at: [number, number] };
}

const SLOTS = 9;

export class ForestSystem extends MineSystem {
  /** Material id → how many. */
  inv = new Map<number, number>();
  /** Block slots, most recent first. */
  hot: number[] = [];
  hand = 0;
  sword = 0;
  armor = -1;
  shards = 0;
  readonly charms = new Set<string>();
  readonly trophies = new Set<string>();
  private cleared = new Map<string, number>();
  private placeHeld = false;
  private curseAt = 0;

  constructor(over: unknown, host: MineHost) {
    super(over, host);
  }

  protected override makeBlocks(seed: number): MineBlocks {
    return new ForestBlocks(this.config, seed);
  }

  get forestBlocks(): ForestBlocks {
    return this.blocks as ForestBlocks;
  }

  private get f() {
    return this.config.forest!;
  }

  private has(charm: string): boolean {
    return this.charms.has(charm) || this.charms.has('crown');
  }

  // ── Gear ──

  override stat(s: Stat): number {
    const a = this.f.armors[this.armor];
    if (s === 'maxHealth') return (a?.health ?? 0) + this.shards * this.f.shard;
    if (s === 'moveSpeed') return this.has('swift') ? 0.25 : 0;
    if (s === 'regen') return this.has('mend') ? 1.5 : 0;
    return 0;
  }

  override airJumps(): number {
    return this.has('leap') ? 1 : 0;
  }

  override moveScale(): number {
    return (this.has('swift') ? 1 : this.slow) * (this.blocking ? this.config.guard.slow : 1);
  }

  protected override burns(): boolean {
    return !this.has('fireproof');
  }

  protected override parryScale(): number {
    return (this.hand === 0 ? 1.4 : 1) * (this.has('ward') ? 1.5 : 1);
  }

  protected override hurt(n: number, cause: string): void {
    this.host.hurt(n * (1 - (this.f.armors[this.armor]?.defense ?? 0)), cause);
  }

  protected override canDig(): boolean {
    return this.hand !== 0;
  }

  protected override attack(): number {
    return this.hand === 0 ? this.f.swords[this.sword]!.damage : this.power() * 1.5;
  }

  protected override swingSpeed(): number {
    return this.hand === 0 ? this.f.swords[this.sword]!.speed : this.config.pickaxes[this.tier]!.speed;
  }

  protected override bossStats(def: BossDef): [number, number, number] {
    return [def.health, def.damage, 0];
  }

  /** Give an item (`kind:id`): better gear is put on; what's no better turns into dynamite. */
  give(item: string): string {
    const [kind, id = ''] = item.split(':');
    const f = this.f;
    if (kind === 'sword') {
      const i = f.swords.findIndex((s) => s.id === id);
      if (i > this.sword) {
        this.sword = i;
        return f.swords[i]!.label;
      }
    } else if (kind === 'armor') {
      const i = f.armors.findIndex((s) => s.id === id);
      if (i > this.armor) {
        this.armor = i;
        return f.armors[i]!.label;
      }
    } else if (kind === 'pickaxe') {
      const i = this.config.pickaxes.findIndex((s) => s.id === id);
      if (i > this.tier) {
        this.tier = i;
        return this.config.pickaxes[i]!.label;
      }
    } else if (kind === 'charm') {
      const c = f.charms.find((x) => x.id === id);
      if (c && !this.charms.has(id)) {
        this.charms.add(id);
        return c.label;
      }
    } else if (kind === 'shard') {
      this.shards++;
      return `+${f.shard} health`;
    }
    const n = 2 + Math.floor(this.host.random() * 2);
    this.dynamite += n;
    return `+${n} dynamite`;
  }

  // ── Each step ──

  override tick(dt: number, fire: boolean, block = false): void {
    const placing = this.hand >= 2;
    super.tick(dt, fire, placing ? false : block);
    if (placing && block && !this.placeHeld) this.place();
    this.placeHeld = block;
    const pl = this.host.player();
    if (!pl) return;
    const [px, , pz] = this.toBlock(pl.feet), time = this.host.time();
    const c = this.curse(px, pz);
    if (c && time >= this.curseAt) {
      this.curseAt = time + 0.5;
      this.host.hurt(c.hurt * 0.5, c.label.toLowerCase());
    }
  }

  /** The curse where the player stands, if it still holds. */
  private curse(x: number, z: number) {
    const r = this.f.regions.find((g) => g.id === this.config.zones[this.forestBlocks.region(x, z)]!.id);
    return r?.curse && !this.trophies.has(r.curse.lift) ? r.curse : null;
  }

  /** Put the block in hand against the face aimed at. */
  private place(): void {
    const a = this.aim, id = this.hot[this.hand - 2], pl = this.host.player();
    if (!a || id === undefined || !pl || !(this.inv.get(id) ?? 0)) return;
    const x = a.x + a.n[0], y = a.y + a.n[1], z = a.z + a.n[2], was = this.blocks.get(x, y, z);
    if (was !== AIR && !this.material(was)?.fluid) return;
    const [fx, fy, fz] = this.toBlock(pl.feet), r = 16 / this.B;
    if (x + 1 > fx - r && x < fx + r && z + 1 > fz - r && z < fz + r && y + 1 > fy && y < fy + 72 / this.B) return;
    if (this.mobs.some((m) => !m.dead && Math.abs(m.pos[0] - x - 0.5) < m.w / 2 + 0.5 && Math.abs(m.pos[2] - z - 0.5) < m.w / 2 + 0.5 && y + 1 > m.pos[1] && y < m.pos[1] + m.h)) return;
    this.blocks.set(x, y, z, id);
    this.take(id, 1);
    this.swungAt = this.host.time();
    this.play('hit', { x, y, z });
  }

  private take(id: number, n: number): void {
    const left = (this.inv.get(id) ?? 0) - n;
    if (left > 0) this.inv.set(id, left);
    else {
      this.inv.delete(id);
      const i = this.hot.indexOf(id);
      if (i >= 0) this.hot.splice(i, 1);
    }
  }

  private keep(id: number, n: number): void {
    this.inv.set(id, (this.inv.get(id) ?? 0) + n);
    if (!this.hot.includes(id)) {
      this.hot.unshift(id);
      if (this.hot.length > SLOTS - 2) this.hot.length = SLOTS - 2;
    }
  }

  select(slot: number): void {
    this.hand = ((Math.round(slot) % SLOTS) + SLOTS) % SLOTS;
  }

  // ── Blocks, chests and bosses ──

  protected override breakBlock(x: number, y: number, z: number, id: number, quiet = false): void {
    this.blocks.set(x, y, z, AIR);
    this.fx.push({ kind: 'break', x, y, z, block: id });
    if (!quiet) this.play('break', { x, y, z });
    const m = this.material(id);
    if (!m) return;
    if (m.id === 'chest' || m.id === 'vault') {
      const loot = this.f.regions[this.forestBlocks.region(x, z)]?.loot ?? {}, items = Object.entries(loot);
      const got: string[] = [];
      const n = m.id === 'vault' ? 3 : 1 + (this.host.random() < 0.35 ? 1 : 0);
      if (m.id === 'vault') got.push(this.give('shard'));
      for (let i = 0; i < n && items.length; i++) {
        let r = this.host.random() * items.reduce((a, [, w]) => a + w, 0);
        const it = items.find(([, w]) => (r -= w) <= 0)?.[0] ?? items[0]![0];
        got.push(this.give(it));
      }
      if (!items.length) got.push(this.give('dynamite'));
      this.host.say(got.join('   '), 3.5);
      return;
    }
    // (What's dug is kept to build with; grass gives dirt, lit and fluid blocks give nothing.)
    if (m.fluid || m.id.startsWith('pedestal')) return;
    const keep = m.id === 'dusk_grass' || m.id === 'moss' || m.id === 'mycel' ? this.forestBlocks.m('dirt') : id;
    this.keep(keep, 1);
  }

  protected override bossDown(b: Boss): void {
    this.beaten.add(b.key);
    this.shots = this.shots.filter((s) => s.boss !== b);
    for (const m of this.mobs) if (m.sector === b.key && !m.dead) m.hit(m.hp, [0, 0], this.host.time());
    this.trophies.add(b.def.id);
    const got = (this.f.drops[b.def.id] ?? []).map((it) => this.give(it));
    const i = this.config.bosses.findIndex((d) => d.id === b.def.id), ped = this.forestBlocks.pedestals()[i];
    if (ped) this.blocks.set(...ped, this.forestBlocks.m('pedestal_lit'));
    const freed = this.f.regions.find((r) => r.curse?.lift === b.def.id);
    const zone = freed && this.config.zones.find((z) => z.id === freed.id);
    this.host.say([`${b.def.label} falls.`, got.join(', '), zone ? `The curse on ${zone.label} lifts.` : ''].filter(Boolean).join(' '), 6);
  }

  // ── Monsters: the region's own, on the ground out of sight; cleared spots fill again in time ──

  protected override offLimits(x: number, z: number): boolean {
    return this.forestBlocks.safe(x, z);
  }

  protected override spawn(px: number, py: number, pz: number): void {
    const fb = this.forestBlocks, rnd = () => this.host.random();
    const eye = this.toBlock(this.host.player()?.eye ?? [0, 0, 0]);
    for (let tries = 0; tries < 10; tries++) {
      const a = rnd() * Math.PI * 2, r = 12 + rnd() * 16;
      const x = Math.floor(px + Math.cos(a) * r), z = Math.floor(pz + Math.sin(a) * r);
      if (fb.safe(x, z) || Math.hypot(x, z) > this.f.radius - 6) continue;
      let y = Math.floor(py) + 8, k = 0;
      while (k++ < 20 && !this.blocks.solid(x, y - 1, z)) y--;
      if (!this.blocks.solid(x, y - 1, z) || this.blocks.get(x, y, z) !== AIR || this.blocks.get(x, y + 1, z) !== AIR) continue;
      const sector = this.sectorOf(x, y, z);
      if (this.mobs.filter((m) => !m.dead && m.sector === sector).length >= this.population(sector)) continue;
      const dx = x + 0.5 - eye[0], dy = y + 1 - eye[1], dz = z + 0.5 - eye[2], l = Math.hypot(dx, dy, dz);
      const seen = this.blocks.raycast(eye[0], eye[1], eye[2], dx, dy, dz, l);
      if (!seen || seen.t >= l - 0.5) continue;
      const zone = fb.region(x, z), kinds = this.config.mobs.filter((m) => m.zone === zone && m.weight > 0);
      if (!kinds.length) return;
      let t = rnd() * kinds.reduce((s, m) => s + m.weight, 0);
      const def = kinds.find((m) => (t -= m.weight) <= 0) ?? kinds[0]!;
      const mob = new Mob(def, [x + 0.5, y, z + 0.5], this.B, def.damage, 0, def.health);
      mob.sector = sector;
      this.mobs.push(mob);
      return;
    }
  }

  protected override population(sector: string): number {
    const at = this.cleared.get(sector);
    if (at !== undefined && this.host.now() - at > this.f.respawnMinutes * 60000) {
      this.cleared.delete(sector);
      this.sectors.delete(sector);
    }
    return super.population(sector);
  }

  protected override paid(m: Mob): void {
    const left = this.sectors.get(m.sector);
    if (left !== undefined && left > 0) {
      this.sectors.set(m.sector, left - 1);
      if (left === 1) this.cleared.set(m.sector, this.host.now());
    }
  }

  override died(): void {
    for (const [id, n] of [...this.inv]) this.take(id, Math.ceil(n * this.config.deathLoss));
  }

  override action(name: string, arg = ''): void {
    if (name === 'slot') this.select(Number(arg) || 0);
    else if (name === 'menu' || name === 'home' || name === 'throw') super.action(name, arg);
  }

  // ── What's shown ──

  override hud(): MineHud & { forest: ForestHud } {
    const h = super.hud(), pl = this.host.player(), [x, , z] = pl ? this.toBlock(pl.feet) : [0, 0, 0];
    const f = this.f, sw = f.swords[this.sword]!, pk = this.config.pickaxes[this.tier]!;
    const slots: ForestHud['slots'] = [
      { kind: 'sword', label: sw.label, mat: '', color: sw.color, block: 0, n: 0 },
      { kind: 'pickaxe', label: pk.label, mat: '', color: pk.color, block: 0, n: 0 },
    ];
    for (let i = 0; i < SLOTS - 2; i++) {
      const id = this.hot[i];
      slots.push(id === undefined ? { kind: 'block', label: '', mat: '', color: '', block: 0, n: 0 } : { kind: 'block', label: this.config.materials[id - MAT]?.label ?? '', mat: this.config.materials[id - MAT]?.id ?? '', color: '', block: id, n: this.inv.get(id) ?? 0 });
    }
    return { ...h, zone: this.config.zones[this.forestBlocks.region(x, z)]!.label, forest: { region: this.config.zones[this.forestBlocks.region(x, z)]!.label, curse: this.curse(x, z)?.label ?? '', hand: this.hand, slots, trophies: this.trophies.size } };
  }

  override menu(): (MineMenu & { forest: ForestMenu }) | null {
    const m = super.menu();
    if (!m) return null;
    const f = this.f, fb = this.forestBlocks, pl = this.host.player(), [x, , z] = pl ? this.toBlock(pl.feet) : [0, 0, 0];
    return {
      ...m,
      forest: {
        sword: f.swords[this.sword]!.label,
        pickaxe: this.config.pickaxes[this.tier]!.label,
        armor: f.armors[this.armor]?.label ?? '',
        shards: this.shards,
        charms: f.charms.map((c) => ({ label: c.label, text: c.text, owned: this.charms.has(c.id) })),
        trophies: this.config.bosses.map((b, i) => ({ boss: b.label, region: this.config.zones[i + 1]?.label ?? '', done: this.trophies.has(b.id) })),
        map: {
          radius: f.radius,
          rings: this.config.zones.map((zn) => {
            const r = f.regions.find((g) => g.id === zn.id);
            return { from: zn.from, label: zn.label, color: r?.fog ?? '#333', cursed: !!r?.curse && !this.trophies.has(r.curse.lift) };
          }),
          lairs: fb.lairList().map((l) => ({ x: l.x, z: l.z, label: l.label, done: this.beaten.has(l.key) })),
          at: [x, z],
        },
      },
    };
  }

  // ── Saving ──

  override save(): unknown {
    const id = (b: number) => this.config.materials[b - MAT]?.id ?? '';
    return {
      v: 1,
      world: 'forest',
      seed: this.blocks.seed,
      inv: [...this.inv].map(([b, n]) => [id(b), n]),
      hot: this.hot.map(id),
      hand: this.hand,
      sword: this.sword,
      tier: this.tier,
      armor: this.armor,
      shards: this.shards,
      charms: [...this.charms],
      trophies: [...this.trophies],
      dynamite: this.dynamite,
      beaten: [...this.beaten],
      caves: Object.fromEntries(this.sectors),
      cleared: Object.fromEntries(this.cleared),
      dug: this.blocks.save(),
    };
  }

  override load(s: unknown): void {
    if (!s || typeof s !== 'object') return;
    const o = s as Record<string, unknown>, fb = this.forestBlocks;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    if (typeof o.seed === 'number') this.blocks.reset(o.seed);
    this.inv.clear();
    if (Array.isArray(o.inv)) for (const e of o.inv) if (Array.isArray(e) && fb.m(String(e[0])) && typeof e[1] === 'number' && e[1] > 0) this.inv.set(fb.m(String(e[0])), Math.floor(e[1]));
    this.hot = strs(o.hot).map((x) => fb.m(x)).filter((b) => this.inv.has(b)).slice(0, SLOTS - 2);
    this.hand = Math.floor(num(o.hand, 0)) % SLOTS;
    this.sword = Math.max(0, Math.min(this.f.swords.length - 1, Math.floor(num(o.sword, 0))));
    this.tier = Math.max(0, Math.min(this.config.pickaxes.length - 1, Math.floor(num(o.tier, 0))));
    this.armor = Math.max(-1, Math.min(this.f.armors.length - 1, Math.floor(num(o.armor, -1))));
    this.shards = Math.max(0, Math.floor(num(o.shards, 0)));
    this.dynamite = Math.max(0, Math.floor(num(o.dynamite, 0)));
    this.charms.clear();
    for (const c of strs(o.charms)) this.charms.add(c);
    this.trophies.clear();
    for (const t of strs(o.trophies)) this.trophies.add(t);
    this.beaten.clear();
    for (const k of strs(o.beaten)) this.beaten.add(k);
    this.sectors.clear();
    if (o.caves && typeof o.caves === 'object') for (const [k, v] of Object.entries(o.caves)) if (typeof v === 'number') this.sectors.set(k, v);
    this.cleared.clear();
    if (o.cleared && typeof o.cleared === 'object') for (const [k, v] of Object.entries(o.cleared)) if (typeof v === 'number') this.cleared.set(k, v);
    this.blocks.load(o.dug);
  }
}

