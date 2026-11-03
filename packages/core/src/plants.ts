/**
 * Plants made in the Plants workspace: grass clumps, leafy plants, budding stalks, trees. Each is a recipe the
 * editor and the game grow into a mesh (the same recipe and seed always give the same plant). Sizes in u.
 */
export interface PlantDef {
  id: string;
  name: string;
  /** A clump of blades and stalks from one root, or a tree (trunk and crown). */
  form: 'clump' | 'tree';
  // ── Clump ──
  /** How many blades or leaves rise from the root. */
  blades: number;
  bladeHeight: number;
  bladeWidth: number;
  /** Blade outline: thin grass, an even strap, or a broad leaf. */
  bladeShape: 'grass' | 'strap' | 'leaf';
  /** How far the blades lean out (degrees). */
  spread: number;
  /** How much the blades droop towards their tips (0…1). */
  bend: number;
  /** Thin stalks with small leaves along them and a bud at the top. */
  stalks: number;
  stalkHeight: number;
  /** Small leaves on each stalk. */
  buds: number;
  // ── Tree ──
  height: number;
  trunkWidth: number;
  /** Bare trunk below the crown (share of the height). */
  trunkClear: number;
  crown: 'round' | 'column' | 'cone' | 'poplar' | 'oval' | 'umbrella' | 'weeping';
  /** How much the crown's leaves hang down under their own weight, more towards its edge (0…1). */
  droop?: number;
  crownWidth: number;
  /** Leaves as flat cards, or as soft lumps (a cypress). */
  foliage: 'cards' | 'lumps';
  leaves: number;
  leafSize: number;
  /** Lumps: their shape, and how much they're stretched across, up and front to back. */
  lumpShape?: 'diamond' | 'round' | 'blob' | 'spiky';
  lumpX?: number;
  lumpY?: number;
  lumpZ?: number;
  // ── Colours ──
  colour: string;
  tipColour: string;
  trunkColour: string;
  /** How much sizes and colours vary from blade to blade (0…1). */
  variation: number;
  /** How strongly it sways in the wind (0 still … 1 normal … 3 gusty). */
  wind?: number;
  /** The preset it was made from (what Reset goes back to). */
  preset?: string;
  seed: number;
}

// (Sizes in u: the player is 72 u tall, about 1.8 m.)
const base: Omit<PlantDef, 'id' | 'name'> = {
  form: 'clump',
  blades: 14,
  bladeHeight: 14,
  bladeWidth: 1.6,
  bladeShape: 'grass',
  spread: 30,
  bend: 0.3,
  stalks: 0,
  stalkHeight: 26,
  buds: 4,
  height: 420,
  trunkWidth: 10,
  trunkClear: 0.2,
  crown: 'round',
  crownWidth: 160,
  foliage: 'cards',
  leaves: 400,
  leafSize: 12,
  colour: '#3f7a2c',
  tipColour: '#8cc35a',
  trunkColour: '#6b4f36',
  variation: 0.4,
  seed: 1,
};

/** Starting points for new plants. */
export const PLANT_PRESETS: { key: string; name: string; def: Omit<PlantDef, 'id' | 'name'> }[] = [
  { key: 'grass', name: 'Grass clump', def: { ...base } },
  { key: 'leafy', name: 'Leafy plant', def: { ...base, blades: 9, bladeHeight: 36, bladeWidth: 7, bladeShape: 'leaf', spread: 35, bend: 0.25, colour: '#3d7a35', tipColour: '#7fbf55' } },
  { key: 'stalks', name: 'Budding stalks', def: { ...base, blades: 8, bladeHeight: 28, bladeWidth: 4, bladeShape: 'strap', spread: 25, bend: 0.1, stalks: 6, stalkHeight: 50, buds: 4, colour: '#356b2a', tipColour: '#79b04e' } },
  { key: 'poplar', name: 'Poplar', def: { ...base, form: 'tree', height: 640, trunkWidth: 10, trunkClear: 0.15, crown: 'poplar', crownWidth: 150, foliage: 'cards', leaves: 700, leafSize: 14, colour: '#3e8a2f', tipColour: '#8fca5c' } },
  { key: 'cypress', name: 'Cypress', def: { ...base, form: 'tree', height: 560, trunkWidth: 9, trunkClear: 0.05, crown: 'cone', crownWidth: 150, foliage: 'lumps', leaves: 90, leafSize: 46, colour: '#5f9a35', tipColour: '#9ccc4e', variation: 0.3 } },
  { key: 'oak', name: 'Oak', def: { ...base, form: 'tree', height: 520, trunkWidth: 18, trunkClear: 0.3, crown: 'umbrella', crownWidth: 460, foliage: 'lumps', leaves: 120, leafSize: 70, lumpShape: 'blob', colour: '#3f7a2c', tipColour: '#86bd52', wind: 0.6 } },
  { key: 'willow', name: 'Willow', def: { ...base, form: 'tree', height: 480, trunkWidth: 14, trunkClear: 0.25, crown: 'weeping', crownWidth: 380, foliage: 'cards', leaves: 900, leafSize: 13, droop: 0.8, colour: '#5a8a35', tipColour: '#a6cf6a', wind: 1.4 } },
  { key: 'bush', name: 'Bush', def: { ...base, form: 'tree', height: 50, trunkWidth: 3, trunkClear: 0, crown: 'round', crownWidth: 80, foliage: 'lumps', leaves: 30, leafSize: 24, colour: '#4c8a33', tipColour: '#8bbf5a' } },
];

/** What a plant started from (its preset's values; the first preset for one made before presets were kept). */
export function plantDefaults(d: Pick<PlantDef, 'preset' | 'form'>, extra: { key: string; def: Omit<PlantDef, 'id' | 'name'> }[] = []): Omit<PlantDef, 'id' | 'name'> {
  const all = [...PLANT_PRESETS, ...extra];
  return (all.find((x) => x.key === d.preset) ?? all.find((x) => x.key === (d.form === 'tree' ? 'poplar' : 'grass'))!).def;
}

/** The project's plants (none in older files). */
export function plantsOf(settings: { plants?: PlantDef[] } | undefined): PlantDef[] {
  return settings?.plants ?? [];
}
