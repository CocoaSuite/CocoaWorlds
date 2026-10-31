/** Structural validation for files read from disk. Returns readable problems instead of throwing deep inside the editor. */
import { isFiniteVec3 } from './math';
import type { EntityData, ProjectFile, SceneFile } from './schema';

export interface Problem {
  path: string;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; problems: Problem[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function need(problems: Problem[], ok: boolean, path: string, message: string): void {
  if (!ok) problems.push({ path, message });
}

export function validateProject(data: unknown): Result<ProjectFile> {
  const p: Problem[] = [];
  if (!isObj(data)) return { ok: false, problems: [{ path: '', message: 'Project file is not a JSON object.' }] };
  need(p, data.format === 'cocoaworlds.project', 'format', 'Not a CocoaWorlds project file.');
  need(p, isNum(data.schemaVersion), 'schemaVersion', 'Missing schema version.');
  need(p, isStr(data.id), 'id', 'Missing project id.');
  need(p, isStr(data.name) && data.name.trim().length > 0, 'name', 'Project needs a name.');
  need(p, isStr(data.startScene), 'startScene', 'Missing start scene.');
  need(p, Array.isArray(data.scenes) && data.scenes.every(isStr), 'scenes', 'Scene list must be a list of paths.');
  const s = data.settings;
  need(p, isObj(s) && isNum(s.gridSize) && s.gridSize > 0, 'settings.gridSize', 'Grid size must be a positive number.');
  need(p, isObj(s) && isNum(s.unitsPerMetre) && s.unitsPerMetre > 0, 'settings.unitsPerMetre', 'Units per metre must be positive.');
  if (Array.isArray(data.scenes) && isStr(data.startScene)) {
    need(p, data.scenes.includes(data.startScene), 'startScene', 'Start scene is not in the scene list.');
  }
  return p.length ? { ok: false, problems: p } : { ok: true, value: data as unknown as ProjectFile };
}

function validateEntity(e: unknown, path: string, p: Problem[]): void {
  if (!isObj(e)) return need(p, false, path, 'Entity is not an object.');
  need(p, isStr(e.id), `${path}.id`, 'Entity is missing an id.');
  need(p, isStr(e.name), `${path}.name`, 'Entity is missing a name.');
  need(p, e.parent === null || isStr(e.parent), `${path}.parent`, 'Parent must be an id or null.');
  const t = e.transform;
  need(p, isObj(t) && isFiniteVec3(t.position), `${path}.transform.position`, 'Position must be three numbers.');
  need(p, isObj(t) && isFiniteVec3(t.rotation), `${path}.transform.rotation`, 'Rotation must be three numbers.');
  need(p, isObj(t) && isFiniteVec3(t.scale), `${path}.transform.scale`, 'Scale must be three numbers.');
  need(p, Array.isArray(e.tags) && e.tags.every(isStr), `${path}.tags`, 'Tags must be a list of text.');
  need(p, isObj(e.components), `${path}.components`, 'Components must be an object.');
}

export function validateScene(data: unknown): Result<SceneFile> {
  const p: Problem[] = [];
  if (!isObj(data)) return { ok: false, problems: [{ path: '', message: 'Scene file is not a JSON object.' }] };
  need(p, data.format === 'cocoaworlds.scene', 'format', 'Not a CocoaWorlds scene file.');
  need(p, isNum(data.schemaVersion), 'schemaVersion', 'Missing schema version.');
  need(p, isStr(data.id), 'id', 'Missing scene id.');
  need(p, isStr(data.name), 'name', 'Missing scene name.');
  need(p, isObj(data.settings), 'settings', 'Missing scene settings.');
  if (!Array.isArray(data.entities)) {
    need(p, false, 'entities', 'Entities must be a list.');
  } else {
    data.entities.forEach((e, i) => validateEntity(e, `entities[${i}]`, p));
    const ents = data.entities.filter(isObj) as unknown as EntityData[];
    const ids = new Set<string>();
    for (const e of ents) {
      if (ids.has(e.id)) p.push({ path: 'entities', message: `Duplicate entity id ${e.id}.` });
      ids.add(e.id);
    }
    for (const e of ents) {
      if (e.parent !== null && typeof e.parent === 'string' && !ids.has(e.parent)) {
        p.push({ path: 'entities', message: `${e.name} has a parent that does not exist.` });
      }
    }
  }
  return p.length ? { ok: false, problems: p } : { ok: true, value: data as unknown as SceneFile };
}
