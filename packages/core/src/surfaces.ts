/**
 * What a surface sounds like: footsteps on it and things hitting it. A material says it (or it is guessed from
 * the material's name); a Physics object can say it for itself. The project gives each kind its sound files.
 */
export const SURFACES = ['generic', 'wood', 'metal', 'stone', 'concrete', 'tile', 'dirt', 'grass', 'gravel', 'sand', 'snow', 'mud', 'water', 'glass', 'carpet', 'plastic', 'cardboard', 'leaves', 'flesh'] as const;
export type Surface = (typeof SURFACES)[number];

export const SURFACE_LABELS: Record<Surface, [string, string]> = {
  generic: ['Generic', 'Обычное'],
  wood: ['Wood', 'Дерево'],
  metal: ['Metal', 'Металл'],
  stone: ['Stone', 'Камень'],
  concrete: ['Concrete', 'Бетон'],
  tile: ['Tile', 'Плитка'],
  dirt: ['Dirt', 'Земля'],
  grass: ['Grass', 'Трава'],
  gravel: ['Gravel', 'Гравий'],
  sand: ['Sand', 'Песок'],
  snow: ['Snow', 'Снег'],
  mud: ['Mud', 'Грязь'],
  water: ['Water', 'Вода'],
  glass: ['Glass', 'Стекло'],
  carpet: ['Carpet', 'Ковёр'],
  plastic: ['Plastic', 'Пластик'],
  cardboard: ['Cardboard', 'Картон'],
  leaves: ['Leaves', 'Листья'],
  flesh: ['Flesh', 'Плоть'],
};

/** Soft ground: what lands on it is quieter. */
export const SOFT_SURFACES: readonly Surface[] = ['dirt', 'grass', 'sand', 'snow', 'mud', 'water', 'carpet', 'leaves', 'flesh'];

const WORDS: [Surface, RegExp][] = [
  ['wood', /wood|plank|timber|oak|pine|birch|log|crate|parquet|bark|дерев|доск/i],
  ['metal', /metal|steel|iron|rust|alumin|copper|brass|chrome|tin|grate|grille|pipe|металл|сталь|желез/i],
  ['glass', /glass|window|mirror|стекл/i],
  ['tile', /tile|ceramic|porcelain|marble|плитк|кафел|мрамор/i],
  ['concrete', /concrete|cement|asphalt|plaster|bet|бетон|асфальт|штукатур/i],
  ['stone', /stone|rock|brick|cobble|granite|slate|cliff|камен|кирпич|скал/i],
  ['gravel', /gravel|pebble|гравий|щебень/i],
  ['sand', /sand|песок|песч/i],
  ['snow', /snow|ice|снег|лёд|лед/i],
  ['mud', /mud|swamp|грязь|болот/i],
  ['grass', /grass|lawn|moss|трав|газон|мох/i],
  ['leaves', /lea(f|ves)|foliage|листь|листв/i],
  ['dirt', /dirt|soil|earth|ground|path|trail|земл|почв|тропа/i],
  ['water', /water|river|lake|sea|ocean|вода|рек|озер|мор/i],
  ['carpet', /carpet|rug|fabric|cloth|cushion|ковер|ковёр|ткан/i],
  ['cardboard', /cardboard|paper|box|картон|бумаг|коробк/i],
  ['plastic', /plastic|rubber|vinyl|пластик|резин/i],
  ['flesh', /flesh|meat|skin|body|плоть|мяс|кож/i],
];

/** A surface from a name ("Old oak planks" → wood); generic when nothing matches. */
export function guessSurface(name: string): Surface {
  for (const [s, re] of WORDS) if (re.test(name)) return s;
  return 'generic';
}

export const isSurface = (v: unknown): v is Surface => typeof v === 'string' && (SURFACES as readonly string[]).includes(v);

/** A surface kind's sound files: footsteps, soft and hard hits (one is picked at random each time). */
export interface SurfaceSoundSet {
  steps?: string[];
  soft?: string[];
  hard?: string[];
  /** 0–2 (missing: 1). */
  volume?: number;
}

export type SurfaceSounds = Partial<Record<Surface, SurfaceSoundSet>>;
