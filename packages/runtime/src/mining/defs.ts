/** The mine's settings: rock zones, ores, pickaxes, skills and mobs (data/mine.json, merged with `settings.mining`). */
import defaults from './data/mine.json';

export interface ZoneDef {
  id: string;
  label: string;
  /** Where it starts: blocks down from the surface (surface mines), or blocks from the base. */
  from: number;
  /** Project image (16 × 16 tile); '' uses the built-in one of the same id. */
  texture: string;
  hardness: number;
  /** Pickaxe tier needed. */
  tier: number;
  /** Ore id → weight. */
  ores: Record<string, number>;
}

export interface OreDef {
  id: string;
  label: string;
  value: number;
  /** Times the rock's hardness. */
  hardness: number;
  texture: string;
  color: string;
  /** 0…1: shines in the dark. */
  glow: number;
}

export interface PickaxeDef {
  id: string;
  label: string;
  price: number;
  power: number;
  /** Swings a second. */
  speed: number;
  color: string;
  /** Project model held in view (optional). */
  model?: string;
}

export type Stat =
  | 'mineDamage' | 'swingSpeed' | 'oreChance' | 'doubleOre' | 'multiBreak' | 'oreValue'
  | 'capacity' | 'capacityMul' | 'sellPrice' | 'deathLoss'
  | 'maxHealth' | 'mobDamage' | 'regen' | 'knockback' | 'bounty'
  | 'moveSpeed' | 'light' | 'nightEyes' | 'oreSense';

export interface SkillDef {
  id: string;
  branch: string;
  label: string;
  text: string;
  price: number;
  growth: number;
  /** 0: no limit. */
  max: number;
  stat: Stat;
  per: number;
  needs: string[];
  /** Place in the tree (grid cells from the middle). */
  at: [number, number];
}

export interface MobDef {
  id: string;
  label: string;
  /** The scene object whose model it uses (by name); missing: a plain figure. */
  template: string;
  kind: 'walker' | 'archer' | 'climber';
  /** First zone (index) it lives in. */
  zone: number;
  weight: number;
  health: number;
  damage: number;
  speed: number;
  reward: number;
  /** Width and height (u). */
  size: [number, number];
  /** Archers: shooting range in blocks. */
  range: number;
  anims: { idle: string; walk: string; attack: string; die: string };
}

/** A twist rolled each time the mine regenerates. */
export interface TwistDef {
  id: string;
  label: string;
  text: string;
  weight: number;
  /** Ore id → how much likelier. */
  ores?: Record<string, number>;
  density?: number;
  caves?: number;
  hardness?: number;
  value?: number;
  /** Monsters: how many (0: none), and what they pay. */
  mobs?: number;
  reward?: number;
  light?: number;
  /** Added chance of a second ore. */
  double?: number;
}

/** Built blocks in structures: planks, bricks, lanterns, chests, lava, webs. */
export interface MaterialDef {
  id: string;
  label: string;
  texture: string;
  /** Times the rock's hardness where it lies. Up to 0.5: any pickaxe breaks it. */
  hardness: number;
  glow: number;
  /** False: walked through (lava, webs). */
  solid?: boolean;
  /** Seen through (webs). */
  clear?: boolean;
  /** Can't be aimed at or dug (lava). */
  fluid?: boolean;
  /** Casts light: colour and radius in blocks. */
  light?: [string, number];
  /** Health lost a second inside it. */
  hurt?: number;
  /** Movement inside it (× speed). */
  slow?: number;
  /** Breaking it gives ore, money (share of the next pickaxe's price where it lies) or dynamite. */
  drops?: { ore?: string; n?: number; money?: number; dynamite?: number };
  /** Opens only once the structure's boss is beaten. */
  locked?: boolean;
}

export interface StructureDef {
  /** mine_complex, dwarven_city, crystal_cathedral or sunken_temple. */
  id: string;
  label: string;
  /** Shallowest depth it's found at. */
  from: number;
  weight: number;
  boss: string;
}

export type BossAttack = 'swing' | 'slam' | 'charge' | 'volley' | 'summon';

export interface BossDef {
  id: string;
  label: string;
  /** Health in hits of the pickaxe expected where it lives. */
  health: number;
  damage: number;
  /** Blocks a second. */
  speed: number;
  /** Share of the next pickaxe's price. */
  reward: number;
  /** Width and height in blocks. */
  size: [number, number];
  attacks: BossAttack[];
  /** Monster it calls up (mob id). */
  minion: string;
  /** Its shots' colour. */
  color: string;
}

export interface DynamiteDef {
  /** Price of one stick at the first pickaxe; × `growth` for each pickaxe tier. */
  price: number;
  growth: number;
  /** Blast radius in blocks; breaks rock up to one tier past the pickaxe. */
  radius: number;
  fuse: number;
  /** Throw speed (blocks a second). */
  speed: number;
  /** Hurts the player standing in it (monsters take far more). */
  damage: number;
  key: string;
}

export interface MineConfig {
  /** Block size (u). */
  block: number;
  chunk: number;
  /** Chunks loaded around the player. */
  view: number;
  /** 0: a new random mine each time it regenerates. */
  seed: number;
  regenMinutes: number;
  /** On the surface: the mine is a flat patch of rock at ground level (below it, rock forever). Off: a room in
   * endless rock all round. */
  surface: boolean;
  /** Surface: the patch's half size in blocks; its sides are the mine's edge down to `crust` blocks deep. */
  patch: number;
  crust: number;
  /** No surface: the base room around the Player start, half size in blocks (x, height, z). */
  base: [number, number, number];
  /** Pickaxe reach in blocks. */
  reach: number;
  backpack: number;
  /** Share of the backpack lost on death. */
  deathLoss: number;
  /** Per block from the base: rock gets harder, ores worth more, mobs tougher. */
  hardGrowth: number;
  valueGrowth: number;
  mobGrowth: number;
  mobHitGrowth: number;
  /** Light radius in blocks. */
  light: number;
  ambient: number;
  maxMobs: number;
  /** Caves are peopled by sector (`size` blocks a side): one monster per `per` open blocks, up to `max`. Killed ones stay dead until the mine regenerates. */
  caveMobs: { size: number; per: number; max: number };
  spawnEvery: number;
  caves: number;
  /** Share of 3 × 3 × 3 cells that hold an ore vein. */
  oreDensity: number;
  /** A scene object called “Sell”: the backpack sells within this many blocks of it. */
  sellRadius: number;
  pickaxeLevels: { price: number; growth: number; power: number };
  menuKey: string;
  twists: TwistDef[];
  dynamite: DynamiteDef;
  homeKey: string;
  sounds: { hit: string; break: string; ore: string; sell: string; buy: string; mobHit: string; mobDie: string; arrow: string; fuse: string; boom: string; parry: string; block: string; roar: string };
  materials: MaterialDef[];
  /** Structures: one may stand in each region (`region` blocks across and high), by `chance`. */
  structures: { region: [number, number]; chance: number; kinds: StructureDef[] };
  bosses: BossDef[];
  /** Holding block: damage taken (× `block`) and movement (× `slow`). Pressing it opens a parry `window` (s), no
   * more often than `cooldown`; a parried boss is open for `stagger` seconds. */
  guard: { window: number; cooldown: number; block: number; slow: number; stagger: number };
  zones: ZoneDef[];
  ores: OreDef[];
  pickaxes: PickaxeDef[];
  skills: SkillDef[];
  branches: { id: string; label: string; color: string }[];
  mobs: MobDef[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Lists merge by id (a game's entry replaces the built-in one of that id or adds one); the rest is laid over. */
function merge(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(over)) {
    if (!base.every((b) => isObj(b) && typeof b.id === 'string')) return over;
    const out = base.map((b) => ({ ...(b as object) })) as Record<string, unknown>[];
    for (const o of over) {
      if (!isObj(o)) continue;
      const i = out.findIndex((b) => b.id === o.id);
      if (i >= 0) out[i] = merge(out[i], o) as Record<string, unknown>;
      else out.push(o);
    }
    return out;
  }
  if (isObj(base) && isObj(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
    return out;
  }
  return over === undefined ? base : typeof over === typeof base ? over : base;
}

export function mineConfig(over?: unknown): MineConfig {
  const c = merge(structuredClone(defaults), over ?? {}) as MineConfig;
  c.zones = [...c.zones].sort((a, b) => a.from - b.from);
  c.structures.kinds = [...c.structures.kinds].sort((a, b) => a.from - b.from);
  return c;
}
