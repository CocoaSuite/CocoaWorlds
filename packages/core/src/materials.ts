/**
 * Project materials (the Materials workspace): a named look for faces — a colour, an optional image and
 * surface map, how shiny, metallic, glowing or see-through it is, and an optional scroll (water, lava,
 * conveyors). Kept in the project file, so every scene shares them. Faces refer to a material by its id
 * (`mat/…`), which never changes, so a material can be renamed freely.
 */
import { newId } from './ids';

export const MATERIAL_PREFIX = 'mat/';

export interface MaterialDef {
  /** What faces store: `mat/` and a 16-character id. */
  id: string;
  name: string;
  /** `#rrggbb`: the colour, or the tint of the image. */
  color: string;
  /** Project image (`assets/textures/…`) drawn on the faces. */
  map?: string;
  /** Project image giving the surface its bumps (a normal map). */
  normalMap?: string;
  /** How strong the bumps are (0–2, normally 1). */
  normalStrength?: number;
  /** 0 = mirror-smooth, 1 = matte. */
  roughness: number;
  /** 0 = plastic, wood, stone; 1 = metal. */
  metalness: number;
  /** `#rrggbb`: the colour it glows with (lit in the dark). */
  emissive?: string;
  /** How bright the glow is (0–10). */
  emissiveStrength?: number;
  /** 1 = solid; less is see-through (glass, water). */
  opacity?: number;
  /** Pixels of the image under half opacity are cut out (fences, grilles, leaves). On unless switched off. */
  cutout?: boolean;
  /** Seen from both sides (thin things: leaves, flags). */
  doubleSided?: boolean;
  /** The image's size in the world, times this (2 = the image covers twice as much). */
  scale?: number;
  /** The image moves across the faces, in units a second ([across, up]). */
  scroll?: [number, number];
  /** Images for the other maps (white where rough / metal / unshaded / glowing / solid; height white = high). */
  roughnessMap?: string;
  metalnessMap?: string;
  occlusionMap?: string;
  glowMap?: string;
  heightMap?: string;
  opacityMap?: string;
  /**
   * A graph material (Cocoa Materials): its graph file (`materials/….cwmat`). Its maps are baked from the graph
   * into `assets/textures/generated/`, and the map fields above point at them.
   */
  graph?: string;
  /** How big the baked images are, in pixels (256–2048). */
  bakeSize?: number;
  /** How many units of the world one repeat of the images covers (graph and triplanar materials; 128 when unset). */
  tile?: number;
  /**
   * Where the images come from: each face's own alignment (face, the default), or projected from the world or
   * from the object (triplanar: no seams, and no texture coordinates needed).
   */
  mapping?: 'face' | 'world' | 'object';
}

/** The map fields, by the output of a graph that makes them. */
export const MAP_FIELDS = {
  color: 'map',
  normal: 'normalMap',
  roughness: 'roughnessMap',
  metalness: 'metalnessMap',
  occlusion: 'occlusionMap',
  glow: 'glowMap',
  height: 'heightMap',
  opacity: 'opacityMap',
} as const satisfies Record<string, keyof MaterialDef>;

export const BAKE_SIZES = [256, 512, 1024, 2048] as const;

export const isMaterialId = (s: string): boolean => s.startsWith(MATERIAL_PREFIX);

export function newMaterial(name: string, patch: Partial<MaterialDef> = {}): MaterialDef {
  return { id: `${MATERIAL_PREFIX}${newId()}`, name, color: '#b4b4b4', roughness: 0.8, metalness: 0, ...patch };
}

/** The project's materials (none in older files). */
export function materialsOf(settings: { materials?: MaterialDef[] } | undefined): MaterialDef[] {
  return settings?.materials ?? [];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isColor = (v: unknown): boolean => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isTexturePath = (v: unknown): boolean => typeof v === 'string' && v.startsWith('assets/textures/');
const inRange = (v: unknown, lo: number, hi: number) => v === undefined || (isNum(v) && v >= lo && v <= hi);

/** What's wrong with a list of materials, or null when it is fine. */
export function validateMaterials(list: unknown): string | null {
  if (list === undefined) return null;
  if (!Array.isArray(list)) return 'Materials must be a list.';
  const ids = new Set<string>();
  for (const m of list) {
    if (!isObj(m)) return 'A material is not an object.';
    const label = typeof m.name === 'string' && m.name ? `Material “${m.name}”` : 'A material';
    if (typeof m.id !== 'string' || !/^mat\/[0-9a-z]{16}$/.test(m.id)) return `${label} has no valid id.`;
    if (ids.has(m.id)) return 'Two materials have the same id.';
    ids.add(m.id);
    if (typeof m.name !== 'string' || !m.name.trim()) return 'A material needs a name.';
    if (!isColor(m.color)) return `${label} needs a colour like #a0b0c0.`;
    if (m.map !== undefined && !isTexturePath(m.map)) return `${label}: its image must be a project texture.`;
    if (m.normalMap !== undefined && !isTexturePath(m.normalMap)) return `${label}: its surface map must be a project texture.`;
    for (const k of ['roughnessMap', 'metalnessMap', 'occlusionMap', 'glowMap', 'heightMap', 'opacityMap'] as const)
      if (m[k] !== undefined && !isTexturePath(m[k])) return `${label}: its ${k.replace('Map', '')} map must be a project texture.`;
    if (m.graph !== undefined && !(typeof m.graph === 'string' && /^materials\/[\w-]+\.cwmat$/.test(m.graph))) return `${label}: its graph must be a file in the materials folder.`;
    if (m.bakeSize !== undefined && !(BAKE_SIZES as readonly unknown[]).includes(m.bakeSize)) return `${label}: the baked size must be 256, 512, 1024 or 2048.`;
    if (m.tile !== undefined && !(isNum(m.tile) && m.tile > 0)) return `${label}: the size in the world must be above 0.`;
    if (m.mapping !== undefined && !['face', 'world', 'object'].includes(m.mapping as string)) return `${label}: mapping must be face, world or object.`;
    if (!isNum(m.roughness) || m.roughness < 0 || m.roughness > 1) return `${label}: roughness must be between 0 and 1.`;
    if (!isNum(m.metalness) || m.metalness < 0 || m.metalness > 1) return `${label}: metalness must be between 0 and 1.`;
    if (m.emissive !== undefined && !isColor(m.emissive)) return `${label}: the glow colour must be like #a0b0c0.`;
    if (!inRange(m.emissiveStrength, 0, 10)) return `${label}: glow strength must be between 0 and 10.`;
    if (!inRange(m.normalStrength, 0, 2)) return `${label}: bump strength must be between 0 and 2.`;
    if (!inRange(m.opacity, 0, 1)) return `${label}: opacity must be between 0 and 1.`;
    if (m.scale !== undefined && !(isNum(m.scale) && m.scale > 0)) return `${label}: the image scale must be above 0.`;
    if (m.cutout !== undefined && typeof m.cutout !== 'boolean') return `${label}: cut-out must be on or off.`;
    if (m.doubleSided !== undefined && typeof m.doubleSided !== 'boolean') return `${label}: two-sided must be on or off.`;
    if (m.scroll !== undefined && !(Array.isArray(m.scroll) && m.scroll.length === 2 && m.scroll.every(isNum))) return `${label}: scroll must be two numbers.`;
  }
  return null;
}
