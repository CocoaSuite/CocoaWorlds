/**
 * Procedural objects (R1): a group with the Repeat component is built from its segment repeated to a length,
 * with optional caps. Only the parts are saved; `expandRepeats` makes the copies (as ordinary entities, tagged
 * `generated`) wherever a scene is shown or played: the editor's view, Play and exported games.
 *
 * The parts are authored as for one segment: the start cap and the segment where they are, the end cap just
 * past the segment. As the length grows the segment is copied along the axis and the end cap moves out.
 */
import { applyMat4, identityMat4, invertMat4, multiplyMat4 } from './matrix';
import type { BrushBounds } from './pivot';
import { readComponent } from './components';
import { SceneDoc } from './scene-doc';
import type { EntityData, SceneFile } from './schema';
import type { Vec3 } from './math';

export type RepeatData = {
  segment: string;
  startCap: string;
  endCap: string;
  axis: 'up' | 'north' | 'east';
  length: number;
  fit: 'whole' | 'stretch';
  gap: number;
  step: number;
};

export const REPEAT_AXES: Record<RepeatData['axis'], Vec3> = { up: [0, 1, 0], north: [0, 0, -1], east: [1, 0, 0] };
export const GENERATED_TAG = 'generated';

/** The id copies get: the group's id, the copy's number and the source part's id. */
export const copyId = (group: string, n: number, source: string) => `${group}~${n}~${source}`;
/** The group a generated copy belongs to (its own id otherwise). */
export const ownerOf = (id: string) => (id.includes('~') ? id.split('~')[0]! : id);

/** How many segments, how far apart, and how much each is stretched along the axis. */
export function repeatLayout(r: Pick<RepeatData, 'length' | 'fit' | 'gap'>, step: number): { count: number; spacing: number; scale: number } {
  const unit = Math.max(1e-3, step + r.gap);
  const count = Math.max(1, Math.round((Math.max(1, r.length) + r.gap) / unit));
  const scale = r.fit === 'stretch' ? Math.max(1, r.length) / Math.max(1e-3, count * step + (count - 1) * r.gap) : 1;
  return { count, spacing: (step + r.gap) * scale, scale };
}

/** The segment's size along the axis, in the group's own space (from its brushes). */
export function segmentStep(doc: SceneDoc, group: string, segment: string, axis: Vec3, boundsOf: BrushBounds): number {
  const inv = invertMat4(doc.worldMatrix(group)) ?? identityMat4();
  let lo = Infinity, hi = -Infinity;
  for (const x of doc.subtree(segment)) {
    const b = boundsOf(x);
    if (!b) continue;
    const m = multiplyMat4(inv, doc.worldMatrix(x.id));
    for (let i = 0; i < 8; i++) {
      const c = applyMat4(m, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
      const d = c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2];
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
  }
  return Number.isFinite(lo) && hi - lo > 1e-3 ? hi - lo : 64;
}

const rotated = (t: EntityData['transform']) => t.rotation.some((v) => Math.abs(v) > 1e-6);

/** The scene with every Repeat group's copies made (a new file; the input is left alone). */
export function expandRepeats(file: SceneFile, boundsOf: BrushBounds): SceneFile {
  if (!file.entities.some((e) => e.components.repeat)) return file;
  const doc = new SceneDoc(file);
  const out: EntityData[] = file.entities.map((e) => structuredClone(e));
  const byId = new Map(out.map((e) => [e.id, e]));
  for (const g of file.entities) {
    if (!g.components.repeat) continue;
    const r = readComponent<RepeatData>('repeat', g.components.repeat);
    const seg = doc.get(r.segment);
    if (!seg || seg.parent !== g.id) continue;
    const axis = REPEAT_AXES[r.axis] ?? REPEAT_AXES.up;
    const step = r.step > 0 ? r.step : segmentStep(doc, g.id, seg.id, axis, boundsOf);
    const { count, spacing, scale } = repeatLayout(r, step);
    // Stretching scales along the axis (only for parts that aren't turned, so the scale stays along it).
    const s = rotated(seg.transform) ? 1 : scale;
    const along = (t: EntityData['transform'], shift: number): EntityData['transform'] => {
      const p = t.position.map((v, k) => (axis[k] ? v * (1 + (s - 1) * Math.abs(axis[k]!)) : v) + axis[k]! * shift) as Vec3;
      const sc = t.scale.map((v, k) => (axis[k] ? v * s : v)) as Vec3;
      return { ...t, position: p, scale: sc };
    };
    byId.get(seg.id)!.transform = along(seg.transform, 0);
    for (let i = 1; i < count; i++) {
      const ids = new Map(doc.subtree(seg.id).map((x) => [x.id, copyId(g.id, i, x.id)]));
      for (const x of doc.subtree(seg.id)) {
        const c = structuredClone(x);
        c.id = ids.get(x.id)!;
        c.parent = x.id === seg.id ? g.id : (ids.get(x.parent!) ?? x.parent);
        c.tags = [...c.tags.filter((t) => t !== GENERATED_TAG), GENERATED_TAG];
        // (Copies have no scripts or repeats of their own; their source does.)
        delete c.components.script;
        delete c.components.repeat;
        if (x.id === seg.id) c.transform = along(x.transform, spacing * i);
        out.push(c);
      }
    }
    const cap = doc.get(r.endCap);
    if (cap && cap.parent === g.id && cap.id !== seg.id) {
      // Authored just past one segment: moved out by the extra length.
      const extra = count * step * s + (count - 1) * r.gap * s - step;
      const t = byId.get(cap.id)!.transform;
      byId.get(cap.id)!.transform = { ...t, position: t.position.map((v, k) => v + axis[k]! * extra) as Vec3 };
    }
  }
  return { ...file, entities: out };
}

/** Where a Repeat group's length handle sits, in the group's own space (the end of the repeated part). */
export function repeatEnd(doc: SceneDoc, group: string, boundsOf: BrushBounds): Vec3 | null {
  const g = doc.get(group);
  if (!g?.components.repeat) return null;
  const r = readComponent<RepeatData>('repeat', g.components.repeat);
  const seg = doc.get(r.segment);
  if (!seg || seg.parent !== g.id) return null;
  const axis = REPEAT_AXES[r.axis] ?? REPEAT_AXES.up;
  const step = r.step > 0 ? r.step : segmentStep(doc, g.id, seg.id, axis, boundsOf);
  const { count, scale } = repeatLayout(r, step);
  const base = seg.transform.position;
  const len = count * step * scale + (count - 1) * r.gap * scale;
  // (From the segment's start along the axis: its lowest point in the group's space.)
  const inv = invertMat4(doc.worldMatrix(group)) ?? identityMat4();
  let lo = Infinity;
  for (const x of doc.subtree(seg.id)) {
    const b = boundsOf(x);
    if (!b) continue;
    const m = multiplyMat4(inv, doc.worldMatrix(x.id));
    for (let i = 0; i < 8; i++) {
      const c = applyMat4(m, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
      lo = Math.min(lo, c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2]);
    }
  }
  const start = Number.isFinite(lo) ? lo : base[0] * axis[0] + base[1] * axis[1] + base[2] * axis[2];
  const across = base.map((v, k) => v * (1 - Math.abs(axis[k]!))) as Vec3;
  return across.map((v, k) => v + axis[k]! * (start + len)) as Vec3;
}

