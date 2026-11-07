/**
 * The built-in build pieces and base settings (JSON in `data/`). A game adds or replaces pieces with JSON alone:
 * the scene's `settings.building.pieces` (same shape) and `settings.building.base` (merged over base.json).
 */
import base from './data/base.json';
import concreteWall from './data/concrete-wall.json';
import door from './data/door.json';
import windowPiece from './data/window.json';
import woodWall from './data/wood-wall.json';
import { readBaseConfig, readPieceDef, type BaseConfig, type PieceDef } from './defs';

export const BUILT_IN_PIECES: unknown[] = [woodWall, concreteWall, door, windowPiece];
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
