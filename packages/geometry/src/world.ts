/**
 * World building: turns the level's brushes into the final solid pieces, applying live subtract brushes.
 *
 * Solid brushes are kept as authored. Every subtract brush that overlaps a solid cuts it at build time,
 * so moving a doorway re-cuts the wall without touching the saved wall brush. `bakeSubtract` makes a cut
 * permanent by replacing the affected solids with their pieces.
 */
import { box } from './primitives';
import { bounds, type Brush, type FaceSurface } from './brush';
import { carveDetailed } from './ops';
import type { V3 } from './vec';

export type BrushRole = 'solid' | 'subtract';

export interface WorldBrush {
  id: string;
  role: BrushRole;
  brush: Brush;
}

export interface BuiltSolid {
  /** The solid brush these pieces came from. */
  id: string;
  pieces: Brush[];
  /** Subtract brushes that cut this solid. */
  cutBy: string[];
}

export interface BuiltWorld {
  solids: BuiltSolid[];
  droppedSlivers: number;
}

interface Box3 {
  min: V3;
  max: V3;
}

const boxesTouch = (a: Box3, b: Box3) =>
  a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1] && a.min[2] < b.max[2] && a.max[2] > b.min[2];

export function buildWorld(brushes: WorldBrush[]): BuiltWorld {
  const subtracts = brushes.filter((b) => b.role === 'subtract').map((b) => ({ ...b, bb: bounds(b.brush) }));
  let droppedSlivers = 0;
  const solids: BuiltSolid[] = [];
  for (const s of brushes) {
    if (s.role !== 'solid') continue;
    const sb = bounds(s.brush);
    let pieces: Brush[] = [s.brush];
    const cutBy: string[] = [];
    for (const c of subtracts) {
      if (!sb || !c.bb || !boxesTouch(sb, c.bb)) continue;
      const next: Brush[] = [];
      let cut = false;
      for (const p of pieces) {
        const r = carveDetailed(p, c.brush);
        if (r.pieces.length !== 1 || r.pieces[0] !== p) cut = true;
        droppedSlivers += r.droppedSlivers;
        next.push(...r.pieces);
      }
      if (cut) cutBy.push(c.id);
      pieces = next;
    }
    solids.push({ id: s.id, pieces, cutBy });
  }
  return { solids, droppedSlivers };
}

/**
 * Make subtract brushes permanent: returns, for each solid they cut, the pieces that replace it.
 * Callers swap the solid for its pieces and delete the subtract brushes, as one undoable step.
 */
export function bakeSubtract(brushes: WorldBrush[], subtractIds: string[]): { replace: Map<string, Brush[]> } {
  const chosen = new Set(subtractIds);
  const world = buildWorld(brushes.filter((b) => b.role === 'solid' || chosen.has(b.id)));
  const replace = new Map<string, Brush[]>();
  for (const s of world.solids) if (s.cutBy.length) replace.set(s.id, s.pieces);
  return { replace };
}

/** Hollow a box-shaped solid into walls of the given thickness (Hammer's "Make Hollow"). */
export function hollowBox(min: V3, max: V3, thickness: number, surface?: FaceSurface): Brush[] {
  const t = Math.abs(thickness);
  const lo: V3 = [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])];
  const hi: V3 = [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])];
  if (hi.some((h, i) => h - lo[i]! <= 2 * t)) throw new Error('The walls would be thicker than the room.');
  const s = surface;
  // Floor and ceiling span the full footprint; the four walls sit between them, two long and two short.
  return [
    box([lo[0], lo[1], lo[2]], [hi[0], lo[1] + t, hi[2]], s),
    box([lo[0], hi[1] - t, lo[2]], [hi[0], hi[1], hi[2]], s),
    box([lo[0], lo[1] + t, lo[2]], [lo[0] + t, hi[1] - t, hi[2]], s),
    box([hi[0] - t, lo[1] + t, lo[2]], [hi[0], hi[1] - t, hi[2]], s),
    box([lo[0] + t, lo[1] + t, lo[2]], [hi[0] - t, hi[1] - t, lo[2] + t], s),
    box([lo[0] + t, lo[1] + t, hi[2] - t], [hi[0] - t, hi[1] - t, hi[2]], s),
  ];
}
