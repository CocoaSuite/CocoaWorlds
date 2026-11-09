/**
 * Asset parks: a brush with the No Render component marks a zone of the level whose contents are templates
 * to copy from. When the scene is played, every object whose centre is inside such a zone is hidden (and the
 * zone itself), so it is never drawn and takes no part in the game: no physics, scripts, lights or sounds.
 * Copies made from a parked object come out whole and live, as copies of any hidden template do.
 * The editor's view is left alone, so the park can still be edited.
 */
import { applyMat4 } from './matrix';
import { worldBoundsOf, type BrushBounds } from './pivot';
import { SceneDoc } from './scene-doc';
import type { Vec3 } from './math';
import type { SceneFile } from './schema';

export const NO_RENDER = 'noRender';

type Box = { min: Vec3; max: Vec3 };
const inside = (p: Vec3, b: Box) => p.every((v, k) => v >= b.min[k]! && v <= b.max[k]!);

/** The scene as played: objects in No Render zones hidden (a new file; the input is left alone). */
export function parkAssets(file: SceneFile, boundsOf: BrushBounds): SceneFile {
  if (!file.entities.some((e) => e.components[NO_RENDER])) return file;
  const doc = new SceneDoc(file);
  const shown = (id: string) => {
    for (let x = doc.get(id); x; x = x.parent ? doc.get(x.parent) : undefined) if (!x.visible) return false;
    return true;
  };
  const zones: Box[] = [];
  const zoneIds = new Set<string>();
  for (const e of file.entities) {
    if (!e.components[NO_RENDER] || !e.components.brush || !shown(e.id)) continue;
    zoneIds.add(e.id);
    const b = worldBoundsOf(doc, e.id, (x) => (x.id === e.id ? boundsOf(x) : null));
    if (b) zones.push(b);
  }
  if (!zoneIds.size) return file;
  const centre = (id: string): Vec3 => {
    const b = worldBoundsOf(doc, id, boundsOf);
    if (b) return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    return applyMat4(doc.worldMatrix(id), [0, 0, 0]);
  };
  const parked = new Set<string>(zoneIds);
  const under = (id: string) => {
    for (let x = doc.get(id)?.parent; x; x = doc.get(x)?.parent ?? null) if (parked.has(x)) return true;
    return false;
  };
  // Outermost first: a parked group hides what's in it, and its parts stay shown inside it (so copies keep them).
  const depth = (id: string) => {
    let d = 0;
    for (let x = doc.get(id)?.parent; x; x = doc.get(x)?.parent ?? null) d++;
    return d;
  };
  const order = [...file.entities].sort((a, b) => depth(a.id) - depth(b.id));
  for (const e of order) {
    if (parked.has(e.id) || !e.visible || under(e.id) || e.components.playerSpawn) continue;
    // (Something holding a zone isn't in the park: the zone is inside it.)
    if (doc.subtree(e.id).some((x) => zoneIds.has(x.id))) continue;
    const c = centre(e.id);
    if (zones.some((z) => inside(c, z))) parked.add(e.id);
  }
  return { ...file, entities: file.entities.map((e) => (parked.has(e.id) ? { ...e, visible: false } : e)) };
}
