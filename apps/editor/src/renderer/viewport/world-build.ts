/**
 * The level build step shared by the main thread and the background worker: live subtract, then one mesh
 * for all solid pieces with hidden faces removed. Plain data in and out (no Three.js), so it can be posted.
 */
import { buildMesh, buildWorld, type Brush, type BrushMesh, type WorldBrush } from '@cocoaworlds/geometry';

/** How wide each face's wear ring is (units): the widest wear a material can have. */
export const WEAR_RING = 32;

export interface WorldJob {
  seq: number;
  brushes: WorldBrush[];
}

export interface WorldResult {
  seq: number;
  /** Null when there are no solid pieces. */
  mesh: BrushMesh | null;
  /** For each mesh triangle, the id of the solid brush it came from. */
  triangleOwner: string[];
  /** Pieces of each solid after live subtract (for face highlighting and "cut by"). */
  pieces: [string, Brush[]][];
  stats: { solids: number; pieces: number; subtracts: number; droppedSlivers: number };
  ms: number;
}

export function buildLevel(job: WorldJob): WorldResult {
  const t0 = performance.now();
  const world = buildWorld(job.brushes);
  const pieces: Brush[] = [];
  const owners: string[] = [];
  const byId: [string, Brush[]][] = [];
  for (const s of world.solids) {
    byId.push([s.id, s.pieces]);
    for (const p of s.pieces) {
      pieces.push(p);
      owners.push(s.id);
    }
  }
  // Smooth shading by solid (its pieces after live subtract shade as one).
  const smoothOf = new Map(job.brushes.filter((b) => (b.smooth ?? 0) > 0).map((b) => [b.id, b.smooth!]));
  const smooth = smoothOf.size ? (i: number) => (smoothOf.has(owners[i]!) ? { group: owners[i]!, angle: smoothOf.get(owners[i]!)! } : null) : undefined;
  const mesh = pieces.length ? buildMesh(pieces, { cullTouchingFaces: true, wearRing: WEAR_RING, smooth }) : null;
  return {
    seq: job.seq,
    mesh,
    triangleOwner: mesh ? Array.from(mesh.triangleBrushes, (bi) => owners[bi]!) : [],
    pieces: byId,
    stats: {
      solids: world.solids.length,
      pieces: pieces.length,
      subtracts: job.brushes.filter((b) => b.role === 'subtract').length,
      droppedSlivers: world.droppedSlivers,
    },
    ms: performance.now() - t0,
  };
}
