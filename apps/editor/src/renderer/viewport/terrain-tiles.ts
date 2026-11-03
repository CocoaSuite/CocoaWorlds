/**
 * Terrain tiles (T2): open-world ground made of terrains laid side by side on a grid. Terrains whose grids are the
 * same size, that sit one tile's width apart (sharing their edge points), at the same height and unturned, are
 * joined: each reads past its edges into its neighbours, so the ground runs on across the seam (no wall, no gap),
 * and a brush stroke over a seam shapes both. See docs/terrain-blend.md.
 */
import { readComponent, type SceneDoc, type TerrainData } from '@cocoaworlds/core';
import { TILE_STEP, stitchTiles, tileBeside, type TileSide, type V3, type VoxelBox, type VoxelField, type VoxelTile } from '@cocoaworlds/geometry';
import { isShown } from '../brush/brushes';
import { remeshTerrain, terrainField } from './terrains';

export interface TerrainTile extends VoxelTile {
  /** The terrain object. */
  id: string;
  file: string;
  /** Where its grid's corner is in the world. */
  origin: V3;
  /** Every tile of its set, by `i,j`. */
  set: Map<string, TerrainTile>;
}

/** The tiles, by terrain object. */
const tiles = new Map<string, TerrainTile>();
/** What each grid was last joined to (to mesh it again only when that changes). */
const joined = new Map<VoxelField, string>();

/** How far apart two neighbouring tiles of this grid are (u, along x and z). */
export const tileSpan = (f: VoxelField): [number, number] => [(f.n[0] - 1) * f.cell, (f.n[2] - 1) * f.cell];

/** This terrain's tile, if it is joined to others. */
export function tileOf(id: string): TerrainTile | null {
  const t = tiles.get(id);
  return t && t.set.size > 1 ? t : null;
}

/** Join the scene's terrains that lie side by side (call when the scene changes or a terrain has loaded). */
export function linkTerrainTiles(doc: SceneDoc | null): void {
  tiles.clear();
  // Candidates: shown, loaded, unturned terrains, each with its own grid.
  const byFile = new Map<string, number>();
  const found: { id: string; file: string; field: VoxelField; origin: V3 }[] = [];
  for (const e of doc?.entities ?? []) {
    if (!e.components.terrain || !doc) continue;
    const file = readComponent<TerrainData>('terrain', e.components.terrain).file;
    if (!file) continue;
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
    if (!isShown(doc, e)) continue;
    const field = terrainField(file);
    const m = doc.worldMatrix(e.id);
    const unturned = [0, 5, 10].every((k) => Math.abs(m[k]! - 1) < 1e-6) && [1, 2, 4, 6, 8, 9].every((k) => Math.abs(m[k]!) < 1e-6);
    if (field && unturned) found.push({ id: e.id, file, field, origin: [m[12]!, m[13]!, m[14]!] });
  }
  // (A grid used by two objects can't be in two places in a set.)
  const free = found.filter((c) => byFile.get(c.file) === 1);
  // Sets: tiles of the same grid size at the same height, a whole number of tiles apart from the first.
  while (free.length) {
    const first = free.shift()!;
    const [sx, sz] = tileSpan(first.field);
    const set = new Map<string, TerrainTile>();
    const add = (c: (typeof found)[number], i: number, j: number) => {
      const t: TerrainTile = { ...c, i, j, set };
      set.set(`${i},${j}`, t);
      tiles.set(c.id, t);
    };
    add(first, 0, 0);
    for (let k = free.length - 1; k >= 0; k--) {
      const c = free[k]!;
      const same = c.field.n.every((v, a) => v === first.field.n[a]) && c.field.cell === first.field.cell && Math.abs(c.origin[1] - first.origin[1]) < 0.01;
      const i = (c.origin[0] - first.origin[0]) / sx, j = (c.origin[2] - first.origin[2]) / sz;
      if (!same || Math.abs(i - Math.round(i)) > 1e-4 || Math.abs(j - Math.round(j)) > 1e-4 || set.has(`${Math.round(i)},${Math.round(j)}`)) continue;
      add(c, Math.round(i), Math.round(j));
      free.splice(k, 1);
    }
  }
  // Point each grid at its neighbours; mesh again those whose neighbours changed.
  const seen = new Set<VoxelField>();
  for (const t of tiles.values()) {
    seen.add(t.field);
    const near = (dx: number, dz: number) => t.set.get(`${t.i + dx},${t.j + dz}`) ?? null;
    const key = [-1, 0, 1]
      .flatMap((dx) => [-1, 0, 1].map((dz) => ((dx || dz) && near(dx, dz) ? `${dx},${dz}:${near(dx, dz)!.file}` : '')))
      .filter(Boolean)
      .join('|');
    if ((joined.get(t.field) ?? '') === key) continue;
    joined.set(t.field, key);
    t.field.neighbours = t.set.size > 1 ? (dx, dz) => (dx || dz ? (near(dx, dz)?.field ?? null) : null) : null;
    remeshTerrain(t.file, null);
  }
  // Grids no longer in the scene's sets stand alone again.
  for (const [f, key] of [...joined]) {
    if (seen.has(f)) continue;
    joined.delete(f);
    if (f.neighbours || key) {
      f.neighbours = null;
      for (const [file] of byFile) if (terrainField(file) === f) remeshTerrain(file, null);
    }
  }
}

/** Forget the joins (another project was opened). */
export function forgetTerrainTiles(): void {
  tiles.clear();
  joined.clear();
}

/** Where a tile beside this terrain's tile goes on `side`, and whether one is there already. */
export function besideTile(id: string, doc: SceneDoc, side: TileSide): { position: V3; taken: boolean } | null {
  const e = doc.get(id);
  const file = e?.components.terrain ? readComponent<TerrainData>('terrain', e.components.terrain).file : '';
  const f = file ? terrainField(file) : null;
  if (!e || !f) return null;
  const [sx, sz] = tileSpan(f);
  const [dx, dz] = TILE_STEP[side];
  const t = tiles.get(id);
  const taken = !!t?.set.has(`${t.i + dx},${t.j + dz}`);
  // (In its parent's space, as the object's own position is kept.)
  const p = e.transform.position;
  return { position: [p[0] + dx * sx, p[1], p[2] + dz * sz], taken };
}

/** The grid of a new tile beside this one on `side`. */
export function newTileBeside(f: VoxelField, side: TileSide): VoxelField {
  return tileBeside(f, side);
}

/**
 * One brush touch on a set of tiles (or a lone terrain): `edit` shapes one grid around a point in its own space
 * and returns what it changed. Each tile the brush reaches is shaped, the seams made to agree, and every tile
 * whose drawing depends on what changed is meshed again. Returns each tile's changed range (for undo).
 */
export function editTiles(parts: { tile: VoxelTile; origin: V3; file: string }[], at: V3, edit: (f: VoxelField, local: V3) => VoxelBox | null, onChange: (file: string, f: VoxelField, box: VoxelBox) => void): Map<VoxelTile, VoxelBox> {
  const edited = new Map<VoxelTile, VoxelBox>();
  for (const p of parts) {
    const box = edit(p.tile.field, [at[0] - p.origin[0], at[1] - p.origin[1], at[2] - p.origin[2]]);
    if (box) edited.set(p.tile, box);
  }
  const changedBoxes = stitchTiles(parts.map((p) => p.tile), edited);
  for (const p of parts) {
    const own = changedBoxes.get(p.tile);
    if (own) onChange(p.file, p.tile.field, own);
    // A tile also draws a cell's width of its neighbours' points by its edges: changes there are meshed again too.
    for (const [o, box] of changedBoxes) {
      if (o === p.tile) continue;
      const shift = [(o.i - p.tile.i) * (o.field.n[0] - 1), 0, (o.j - p.tile.j) * (o.field.n[2] - 1)];
      const n = p.tile.field.n;
      const min = box.min.map((v, k) => Math.max(0, v + shift[k]! - 1)) as V3;
      const max = box.max.map((v, k) => Math.min(n[k]! - 1, v + shift[k]! + 1)) as V3;
      if (min.every((v, k) => v <= max[k]!)) remeshTerrain(p.file, p.tile.field.chunksIn({ min, max }));
    }
  }
  return changedBoxes;
}
