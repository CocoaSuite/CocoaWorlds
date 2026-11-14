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
  spawnEvery: number;
  caves: number;
  /** Share of 3 × 3 × 3 cells that hold an ore vein. */
  oreDensity: number;
  /** A scene object called “Sell”: the backpack sells within this many blocks of it. */
  sellRadius: number;
  pickaxeLevels: { price: number; growth: number; power: number };
  menuKey: string;
  homeKey: string;
  sounds: { hit: string; break: string; ore: string; sell: string; buy: string; mobHit: string; mobDie: string; arrow: string };
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
  return c;
}
