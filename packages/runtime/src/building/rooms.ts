/**
 * The build grid and room detection. Pure functions over plain data (no physics, no world): safe to run in a
 * worker if bases ever get big. Today it is a flood fill over the few hundred cells round the pieces, done only
 * when an edge changes, well under a millisecond, so it runs in place.
 *
 * Edges: axis `x` runs along +X from (x, z) to (x+1, z) in cells, between cells (x, z-1) and (x, z);
 * axis `z` runs along +Z from (x, z) to (x, z+1), between cells (x-1, z) and (x, z).
 */

export type Axis = 'x' | 'z';
export interface Edge {
  axis: Axis;
  x: number;
  z: number;
}

export const edgeKey = (e: Edge): string => `${e.axis}:${e.x}:${e.z}`;
export function parseEdge(key: string): Edge | null {
  const m = /^([xz]):(-?\d+):(-?\d+)$/.exec(key);
  return m ? { axis: m[1] as Axis, x: Number(m[2]), z: Number(m[3]) } : null;
}
export const cellKey = (x: number, z: number): string => `${x},${z}`;

/** The edge nearest a point on the ground (world x, z). */
export function nearestEdge(px: number, pz: number, grid: number): Edge {
  const fx = px / grid, fz = pz / grid;
  const dx = Math.abs(fx - Math.round(fx)), dz = Math.abs(fz - Math.round(fz));
  return dz <= dx ? { axis: 'x', x: Math.floor(fx), z: Math.round(fz) } : { axis: 'z', x: Math.round(fx), z: Math.floor(fz) };
}

/** Edge space → world: its start, and its turn about up (edge x is along the edge, edge z across it). */
export function edgeFrame(e: Edge, grid: number): { x: number; z: number; yaw: number } {
  return { x: e.x * grid, z: e.z * grid, yaw: e.axis === 'x' ? 0 : -Math.PI / 2 };
}

/** A point in edge space (x along, z across) to world x, z. */
export function edgeToWorld(e: Edge, grid: number, lx: number, lz: number): [number, number] {
  const f = edgeFrame(e, grid);
  return e.axis === 'x' ? [f.x + lx, f.z + lz] : [f.x - lz, f.z + lx];
}

/** The cells either side of an edge. */
export function edgeCells(e: Edge): [[number, number], [number, number]] {
  return e.axis === 'x'
    ? [[e.x, e.z - 1], [e.x, e.z]]
    : [[e.x - 1, e.z], [e.x, e.z]];
}

export interface EdgeState extends Edge {
  /** The build site on it. */
  site: string;
  /** Closed for sealing (built; door shut; shutters fitted and shut). */
  closed: boolean;
}

export interface Room {
  /** Stable while the room keeps its first cell. */
  id: string;
  cells: [number, number][];
  /** Build sites round it. */
  sites: string[];
  /** Build sites round it that are not closed (unfinished, open doors, open or missing shutters). */
  openings: string[];
  sealed: boolean;
}

/** Cells to search past the pieces at most (a base scattered across the whole map is not searched cell by cell). */
const MAX_SPAN = 256;

/**
 * Enclosed rooms: areas of cells that can't reach outside the pieces' bounds without crossing an edge with a
 * piece on it (any piece, finished or not: an unfinished one is an opening of the room, not a way out of it).
 */
export function findRooms(edges: EdgeState[]): Room[] {
  if (!edges.length) return [];
  const byKey = new Map<string, EdgeState>();
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const e of edges) {
    byKey.set(edgeKey(e), e);
    for (const [cx, cz] of edgeCells(e)) {
      x0 = Math.min(x0, cx);
      z0 = Math.min(z0, cz);
      x1 = Math.max(x1, cx);
      z1 = Math.max(z1, cz);
    }
  }
  // One cell of margin: anything that reaches it is outside.
  x0--;
  z0--;
  x1++;
  z1++;
  if (x1 - x0 > MAX_SPAN || z1 - z0 > MAX_SPAN) {
    // (Pieces far apart: search each cluster's own box instead of the whole span.)
    return clusters(edges).flatMap((c) => (c.length === edges.length ? [] : findRooms(c)));
  }
  const w = x1 - x0 + 1, h = z1 - z0 + 1;
  const seen = new Uint8Array(w * h);
  const idx = (x: number, z: number) => (z - z0) * w + (x - x0);
  const rooms: Room[] = [];
  const queue: number[] = [];
  for (let sz = z0; sz <= z1; sz++)
    for (let sx = x0; sx <= x1; sx++) {
      if (seen[idx(sx, sz)]) continue;
      const cells: [number, number][] = [];
      const sites = new Set<string>();
      let outside = false;
      seen[idx(sx, sz)] = 1;
      queue.length = 0;
      queue.push(sx, sz);
      for (let q = 0; q < queue.length; q += 2) {
        const cx = queue[q]!, cz = queue[q + 1]!;
        cells.push([cx, cz]);
        if (cx === x0 || cx === x1 || cz === z0 || cz === z1) outside = true;
        // Right, left, forward, back: the edge crossed, and the cell beyond.
        const steps: [string, number, number][] = [
          [`z:${cx + 1}:${cz}`, cx + 1, cz],
          [`z:${cx}:${cz}`, cx - 1, cz],
          [`x:${cx}:${cz + 1}`, cx, cz + 1],
          [`x:${cx}:${cz}`, cx, cz - 1],
        ];
        for (const [k, nx, nz] of steps) {
          const e = byKey.get(k);
          if (e) {
            sites.add(e.site);
            continue;
          }
          if (nx < x0 || nx > x1 || nz < z0 || nz > z1 || seen[idx(nx, nz)]) continue;
          seen[idx(nx, nz)] = 1;
          queue.push(nx, nz);
        }
      }
      if (outside) continue;
      const list = [...sites];
      const closed = new Map(edges.map((e) => [e.site, e.closed]));
      const openings = list.filter((s) => !closed.get(s));
      rooms.push({ id: `room:${cellKey(sx, sz)}`, cells, sites: list, openings, sealed: openings.length === 0 });
    }
  return rooms;
}

/** Edges grouped by touching (sharing a cell). */
function clusters(edges: EdgeState[]): EdgeState[][] {
  const parent = edges.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const byCell = new Map<string, number>();
  edges.forEach((e, i) => {
    for (const [cx, cz] of edgeCells(e)) {
      const k = cellKey(cx, cz);
      const j = byCell.get(k);
      if (j === undefined) byCell.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, EdgeState[]>();
  edges.forEach((e, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), e]);
  });
  return [...groups.values()];
}
