/**
 * The built-in build pieces and base settings (JSON in `data/`). A game adds or replaces pieces with JSON alone:
 * the scene's `settings.building.pieces` (same shape) and `settings.building.base` (merged over base.json).
 */
import base from './data/base.json';
import concreteFloor from './data/concrete-floor.json';
import concreteWall from './data/concrete-wall.json';
import woodDoor from './data/wood-door.json';
import woodFloor from './data/wood-floor.json';
import woodWall from './data/wood-wall.json';
import woodWindow from './data/wood-window.json';
import { readBaseConfig, readPieceDef, type BaseConfig, type PieceDef } from './defs';

export const BUILT_IN_PIECES: unknown[] = [woodWall, woodFloor, woodDoor, woodWindow, concreteWall, concreteFloor];
export const BUILT_IN_BASE: unknown = base;

/** Every piece (built-in, then the game's, which replace built-ins of the same id) and the base settings. */
export function buildingCatalog(extra?: { pieces?: unknown[]; base?: unknown }): { pieces: Map<string, PieceDef>; config: BaseConfig; problems: string[] } {
  const pieces = new Map<string, PieceDef>();
  const problems: string[] = [];
  for (const raw of [...BUILT_IN_PIECES, ...(Array.isArray(extra?.pieces) ? extra.pieces : [])]) {
    try {
      const d = readPieceDef(raw);
      pieces.set(d.id, d);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return { pieces, config: readBaseConfig(BUILT_IN_BASE, extra?.base), problems };
}
