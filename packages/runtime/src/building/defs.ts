/**
 * Base building, blueprint style: what a build piece is, as plain JSON.
 *
 * Blueprints the player owns are picked from the blueprint menu (B); a ghost follows the aim on the build grid
 * (R and T turn it a quarter) and a click places it as a see-through blueprint at 0%.
 * Props of the piece's material (a plank, a bag of concrete powder) put into it count one each; once `count` of
 * them are in at once they are used up together and it is finished and solid. Finished pieces have health: hits and blasts
 * knock them down. New materials and pieces are new JSON files: nothing here knows about wood or concrete.
 */

/** One box of a piece's look, in the piece's own space: from its box's corner, x along, y up, z across. */
export interface PartDef {
  id: string;
  /** The box's middle. */
  at: [number, number, number];
  size: [number, number, number];
  color: string;
  /** A project material by name ('' : the flat colour). */
  material: string;
  /** Swings open about a hinge (x, z in the piece's space) by `angle` degrees when the piece is open (a door leaf). */
  swing: { hinge: [number, number]; angle: number } | null;
  /** Blocks the player and props once finished (and, for a swinging part, shut). */
  solid: boolean;
}

export interface PieceDef {
  id: string;
  label: string;
  /** The section of the blueprint menu it is in ('Wood', 'Concrete'). */
  category: string;
  /** The item that makes it show in the blueprint menu (bought, given or found; not a hotbar slot). */
  blueprint: string;
  /** Its card picture in the menu (a project image; '' : drawn from its boxes). */
  icon: string;
  /** Whether placing uses the blueprint item up (missing: no, it places as many as wanted). */
  consumeBlueprint: boolean;
  /** Its box (x along, y up, z across): what it takes up on the grid; parts sit in it. */
  size: [number, number, number];
  /** T tips it over (missing: yes; doors: no). */
  turns: boolean;
  /** The tag a prop needs to count towards it (`plank`, `concrete powder`). */
  material: string;
  /** How the material is called in the HUD, plural ('Planks'). */
  materialLabel: string;
  /** How many props finish it. */
  count: number;
  /** Damage it takes to knock the finished piece down. */
  health: number;
  /** E opens and shuts the finished piece (its `swing` parts turn smoothly, over `openTime` seconds). */
  opens: boolean;
  openTime: number;
  /** What kind of socket it fits ('door': a door fits a door frame; '' : none). Aimed at a free socket of its kind, it goes in it. */
  fits: string;
  /** Places in it that a piece fits: the kind, and the fitting piece's corner in this piece's space. */
  sockets: { fits: string; at: [number, number, number] }[];
  mesh: { parts: PartDef[] };
  /** Sounds (project paths; '' none): a prop used up, finished, knocked down, a door. */
  sounds: { add: string; built: string; broken: string; door: string };
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const v3 = (v: unknown, d: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? (v as [number, number, number]) : d;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function readPart(raw: unknown, i: number): PartDef {
  const p = obj(raw);
  const swing = p.swing ? obj(p.swing) : null;
  const hinge = swing && Array.isArray(swing.hinge) && swing.hinge.length === 2 && swing.hinge.every((x) => typeof x === 'number') ? (swing.hinge as [number, number]) : [0, 0] as [number, number];
  return {
    id: str(p.id, `part${i}`),
    at: v3(p.at, [0, 0, 0]),
    size: v3(p.size, [8, 8, 8]),
    color: str(p.color, '#8a8a8a'),
    material: str(p.material),
    swing: swing ? { hinge, angle: num(swing.angle, 90) } : null,
    solid: p.solid !== false,
  };
}

/** The box round all parts, from the origin (for a piece with no `size`). */
function bounds(parts: PartDef[]): [number, number, number] {
  const hi: [number, number, number] = [1, 1, 1];
  for (const p of parts) for (let k = 0; k < 3; k++) hi[k] = Math.max(hi[k]!, p.at[k]! + p.size[k]! / 2);
  return hi;
}

/** A piece from its JSON, with defaults filled in. Throws on what can't work (no id, no parts, no material). */
export function readPieceDef(raw: unknown): PieceDef {
  const d = obj(raw);
  const id = str(d.id);
  if (!id) throw new Error('A build piece needs an "id".');
  const material = str(d.material).trim();
  if (!material) throw new Error(`Build piece "${id}" needs a "material" (the tag of the props that build it).`);
  const mesh = obj(d.mesh);
  const parts = (Array.isArray(mesh.parts) ? mesh.parts : []).map(readPart);
  if (!parts.length) throw new Error(`Build piece "${id}" has no parts to draw.`);
  const label = str(d.label, id);
  const sounds = obj(d.sounds);
  return {
    id,
    label,
    category: str(d.category, 'Other'),
    blueprint: str(d.blueprint, `${label} blueprint`),
    icon: str(d.icon),
    consumeBlueprint: d.consumeBlueprint === true,
    size: v3(d.size, bounds(parts)),
    turns: d.turns !== false && d.opens !== true,
    material,
    materialLabel: str(d.materialLabel, material),
    count: Math.max(1, Math.round(num(d.count, 1))),
    health: Math.max(1, num(d.health, 50)),
    opens: d.opens === true,
    openTime: Math.max(0, num(d.openTime, 0.4)),
    fits: str(d.fits),
    sockets: (Array.isArray(d.sockets) ? d.sockets : []).map((r) => obj(r)).filter((r) => str(r.fits)).map((r) => ({ fits: str(r.fits), at: v3(r.at, [0, 0, 0]) })),
    mesh: { parts },
    sounds: { add: str(sounds.add), built: str(sounds.built), broken: str(sounds.broken), door: str(sounds.door) },
  };
}

/** Base-wide settings, from `base.json`. */
export interface BaseConfig {
  /** Grid cell size (u). */
  grid: number;
  /** How far E reaches a piece, and how far a blueprint is placed. */
  reach: number;
  placeReach: number;
  /** Seconds E is held on an unfinished blueprint to remove it (the props in it stay where they are). */
  removeHold: number;
  /** How often blueprints look for props touching them (s). */
  every: number;
  /** How far round a blueprint's boxes a prop counts as touching it (u). */
  touch: number;
  /** The looks: placed blueprints (dark, see-through), the ghost being placed (light; red where it can't go). */
  ghost: { color: string; opacity: number; placing: string; placingOpacity: number; invalid: string };
  /** The % tag over each blueprint. */
  tag: { color: string; text: string };
  /** Pictures for the blueprint menu and tags (project images; '' : flat colours). */
  ui: { panel: string; rolls: string; card: string; tag: string };
  /** The key that opens the blueprint menu. */
  menuKey: string;
}

export function readBaseConfig(raw: unknown, over: unknown = {}): BaseConfig {
  const merge = (a: unknown, b: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...obj(a) };
    for (const [k, v] of Object.entries(obj(b))) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v) : v;
    return out;
  };
  const c = merge(raw, over);
  const ghost = obj(c.ghost);
  const tag = obj(c.tag);
  const ui = obj(c.ui);
  return {
    grid: Math.max(8, num(c.grid, 48)),
    reach: num(c.reach, 140),
    placeReach: num(c.placeReach, 320),
    removeHold: Math.max(0.1, num(c.removeHold, 1)),
    every: Math.max(1 / 60, num(c.every, 0.1)),
    touch: Math.max(0, num(c.touch, 4)),
    ghost: {
      color: str(ghost.color, '#1d1a2e'),
      opacity: num(ghost.opacity, 0.45),
      placing: str(ghost.placing, '#ffffff'),
      placingOpacity: num(ghost.placingOpacity, 0.3),
      invalid: str(ghost.invalid, '#c0392b'),
    },
    tag: { color: str(tag.color, '#1f2a7a'), text: str(tag.text, '#e8eaff') },
    ui: { panel: str(ui.panel), rolls: str(ui.rolls), card: str(ui.card), tag: str(ui.tag) },
    menuKey: str(c.menuKey, 'KeyB'),
  };
}
