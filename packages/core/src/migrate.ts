/**
 * Schema migrations. Each step upgrades a raw JSON object from version N to N+1.
 * Opening an older file runs every step in order; the editor keeps a backup of the original before saving.
 */
import { CURRENT_SCHEMA_VERSION } from './schema';
import { applyMat4, composeTransform, decomposeMat4, identityMat4, invertMat4, isIdentityMat4, multiplyMat4, type Mat4 } from './matrix';
import { identityTransform, type Transform, type Vec3 } from './math';

type Raw = Record<string, unknown>;
type Step = (data: Raw) => Raw;

/** Keyed by the version a step upgrades FROM. */
const projectSteps: Record<number, Step> = {
  // Format 2 changed scenes only.
  1: (d) => d,
};
const sceneSteps: Record<number, Step> = {
  1: nestTransforms,
};

interface RawEntity {
  id: string;
  parent: string | null;
  transform: Transform;
  components: Record<string, Record<string, unknown>>;
}

/**
 * 1 → 2: transforms become relative to the parent and brush faces move into the parent's space, without
 * moving anything in the world. In format 1 a group's own transform did nothing, so groups (and empty
 * entities holding children) get an identity transform; brushes keep an identity transform too.
 */
function nestTransforms(data: Raw): Raw {
  const list = (Array.isArray(data.entities) ? data.entities : []) as RawEntity[];
  const byId = new Map(list.map((e) => [e.id, e]));
  const hasKids = new Set(list.map((e) => e.parent).filter(Boolean) as string[]);
  const isGroup = (e: RawEntity) => !!e.components?.group || (Object.keys(e.components ?? {}).length === 0 && hasKids.has(e.id));
  const world = new Map<string, Mat4>();
  const worldOf = (id: string | null): Mat4 => {
    if (!id) return identityMat4();
    const done = world.get(id);
    if (done) return done;
    const e = byId.get(id);
    if (!e) return identityMat4();
    const parent = worldOf(e.parent);
    // Groups and brushes have identity transforms in format 2, so their space is their parent's.
    const m = isGroup(e) || e.components?.brush ? parent : composeTransform(e.transform ?? identityTransform());
    world.set(id, m);
    return m;
  };
  const q = (n: number) => Math.round(n * 1024) / 1024;
  const entities = list.map((e) => {
    const parentWorld = worldOf(e.parent);
    const inv = invertMat4(parentWorld) ?? identityMat4();
    const out: RawEntity = { ...e, components: { ...e.components } };
    if (isGroup(e) || e.components?.brush) {
      out.transform = identityTransform();
    } else if (!isIdentityMat4(parentWorld)) {
      out.transform = decomposeMat4(multiplyMat4(inv, composeTransform(e.transform)));
    }
    const brush = e.components?.brush as { faces?: { points: Vec3[] }[] } | undefined;
    if (brush?.faces && !isIdentityMat4(parentWorld)) {
      const flip = det3(inv) < 0;
      out.components.brush = {
        ...brush,
        faces: brush.faces.map((f) => {
          const pts = f.points.map((p) => applyMat4(inv, p).map(q) as Vec3);
          return { ...f, points: flip ? [pts[0]!, pts[2]!, pts[1]!] : pts };
        }),
      };
    }
    return out;
  });
  return { ...data, entities };
}

const det3 = (m: Mat4) => m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);

export class MigrationError extends Error {}

function run(kind: string, data: Raw, steps: Record<number, Step>): { data: Raw; migrated: boolean } {
  let v = typeof data.schemaVersion === 'number' ? data.schemaVersion : NaN;
  if (!Number.isInteger(v) || v < 1) throw new MigrationError(`This ${kind} file has no valid schema version.`);
  if (v > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `This ${kind} was saved by a newer CocoaWorlds (format ${v}). Update CocoaWorlds to open it; nothing was changed.`,
    );
  }
  let out = data;
  const start = v;
  while (v < CURRENT_SCHEMA_VERSION) {
    const step = steps[v];
    if (!step) throw new MigrationError(`No upgrade path for ${kind} format ${v}.`);
    out = { ...step(out), schemaVersion: v + 1 };
    v += 1;
  }
  return { data: out, migrated: v !== start };
}

export const migrateProject = (data: Raw) => run('project', data, projectSteps);
export const migrateScene = (data: Raw) => run('scene', data, sceneSteps);
