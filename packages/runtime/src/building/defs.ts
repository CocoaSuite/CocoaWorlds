/**
 * Base building, blueprint style: what a build piece is, as plain JSON.
 *
 * A blueprint item in hand shows a ghost on the build grid; a click places it as a see-through blueprint at 0%.
 * Props tagged with the piece's material (a plank, a bag of concrete powder) are used up when they touch it, one
 * each, until it has `count` of them; then it is finished and solid. Finished pieces have health: hits and blasts
 * knock them down. New materials and pieces are new JSON files: nothing here knows about wood or concrete.
 */
import type { SnapKind } from './grid';

/** One box of a piece's look, in the spot's space: x along (0…grid), y up from the ground, z across. */
export interface PartDef {
  id: string;
  /** The box's middle. */
  at: [number, number, number];
  size: [number, number, number];
  color: string;
  /** A project material by name ('' : the flat colour). */
  material: string;
  /** Swings open about a hinge (x, z in spot space) by `angle` degrees when the piece is open (a door leaf). */
  swing: { hinge: [number, number]; angle: number } | null;
  /** Blocks the player and props once finished (and, for a swinging part, shut). */
  solid: boolean;
}

export interface PieceDef {
  id: string;
  label: string;
  /** The hotbar item that places it (bought, given or found). */
  blueprint: string;
  /** Whether placing uses the blueprint item up (missing: no, it places as many as wanted). */
  consumeBlueprint: boolean;
  /** On a grid edge (walls, doors) or a cell (floors, foundations). */
  snap: SnapKind;
  /** The tag a prop needs to count towards it (`plank`, `concrete powder`). */
  material: string;
  /** How the material is called in the HUD, plural ('Planks'). */
  materialLabel: string;
  /** How many props finish it. */
  count: number;
  /** Damage it takes to knock the finished piece down. */
  health: number;
  /** E opens and shuts the finished piece (its `swing` parts move). */
  opens: boolean;
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
    blueprint: str(d.blueprint, `${label} blueprint`),
    consumeBlueprint: d.consumeBlueprint === true,
    snap: d.snap === 'cell' ? 'cell' : 'edge',
    material,
    materialLabel: str(d.materialLabel, material),
    count: Math.max(1, Math.round(num(d.count, 1))),
    health: Math.max(1, num(d.health, 50)),
    opens: d.opens === true,
    mesh: { parts },
    sounds: { add: str(sounds.add), built: str(sounds.built), broken: str(sounds.broken), door: str(sounds.door) },
  };
}

/** Base-wide settings, from `base.json`. */
export interface BaseConfig {
  /** Grid cell size (u). */
  grid: number;
  /** How far E reaches a piece, and how far a blueprint item places one. */
  reach: number;
  placeReach: number;
  /** Seconds E is held on an unfinished blueprint to remove it (what was put in is lost). */
  removeHold: number;
  /** How often blueprints look for props touching them (s). */
  every: number;
  /** How far round a blueprint's boxes a prop counts as touching it (u). */
  touch: number;
  /** The see-through blueprint look: flat colour (and red where it can't go). */
  ghost: { color: string; invalid: string };
}

export function readBaseConfig(raw: unknown, over: unknown = {}): BaseConfig {
  const merge = (a: unknown, b: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...obj(a) };
    for (const [k, v] of Object.entries(obj(b))) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v) : v;
    return out;
  };
  const c = merge(raw, over);
  const ghost = obj(c.ghost);
  return {
    grid: Math.max(8, num(c.grid, 96)),
    reach: num(c.reach, 140),
    placeReach: num(c.placeReach, 320),
    removeHold: Math.max(0.1, num(c.removeHold, 1)),
    every: Math.max(1 / 60, num(c.every, 0.1)),
    touch: Math.max(0, num(c.touch, 4)),
    ghost: { color: str(ghost.color, '#4aa3df'), invalid: str(ghost.invalid, '#c0392b') },
  };
}
