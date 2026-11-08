/**
 * The build grid. Pieces snap either to an edge between two cells (walls, doors, windows) or to a cell (floors,
 * foundations). Pure functions over plain data.
 *
 * Edges: axis `x` runs along +X from (x, z) to (x+1, z) in cells; axis `z` runs along +Z from (x, z) to (x, z+1).
 * Edge space: x along the edge (0…grid), z across it. Cell space: x and z across the cell (0…grid), from its corner.
 */

export type Axis = 'x' | 'z';
export interface Edge {
  axis: Axis;
  x: number;
  z: number;
}

/** Where a piece snaps: an edge, or a cell. */
export type Spot = ({ kind: 'edge' } & Edge) | { kind: 'cell'; x: number; z: number };
export type SnapKind = Spot['kind'];

export const edgeKey = (e: Edge): string => `${e.axis}:${e.x}:${e.z}`;
export const spotKey = (s: Spot): string => (s.kind === 'edge' ? edgeKey(s) : `c:${s.x}:${s.z}`);

export function parseSpot(key: string): Spot | null {
  const m = /^([xzc]):(-?\d+):(-?\d+)$/.exec(key);
  if (!m) return null;
  const x = Number(m[2]), z = Number(m[3]);
  return m[1] === 'c' ? { kind: 'cell', x, z } : { kind: 'edge', axis: m[1] as Axis, x, z };
}

/** The edge nearest a point on the ground (world x, z). */
export function nearestEdge(px: number, pz: number, grid: number): Edge {
  const fx = px / grid, fz = pz / grid;
  const dx = Math.abs(fx - Math.round(fx)), dz = Math.abs(fz - Math.round(fz));
  return dz <= dx ? { axis: 'x', x: Math.floor(fx), z: Math.round(fz) } : { axis: 'z', x: Math.round(fx), z: Math.floor(fz) };
}

/** The spot of this kind nearest a point on the ground. */
export function nearestSpot(kind: SnapKind, px: number, pz: number, grid: number): Spot {
  return kind === 'edge' ? { kind: 'edge', ...nearestEdge(px, pz, grid) } : { kind: 'cell', x: Math.floor(px / grid), z: Math.floor(pz / grid) };
}

/** A spot's turn about up (local x is along an edge; cells aren't turned). */
export const spotYaw = (s: Spot): number => (s.kind === 'edge' && s.axis === 'z' ? -Math.PI / 2 : 0);

/** A point in the spot's own space (x along, z across) to world x, z. */
export function spotToWorld(s: Spot, grid: number, lx: number, lz: number): [number, number] {
  const ox = s.x * grid, oz = s.z * grid;
  return s.kind === 'edge' && s.axis === 'z' ? [ox - lz, oz + lx] : [ox + lx, oz + lz];
}

/** The middle of a spot on the ground (world x, z). */
export const spotMiddle = (s: Spot, grid: number): [number, number] => spotToWorld(s, grid, grid / 2, s.kind === 'cell' ? grid / 2 : 0);
