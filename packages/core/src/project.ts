/** Creating, parsing and serializing project and scene files. File-system access lives in the editor's main process. */
import { newId } from './ids';
import { migratePrefab, migrateProject, migrateScene } from './migrate';
import type { PrefabFile } from './prefab';
import {
  CURRENT_SCHEMA_VERSION,
  SCENES_DIR,
  SCENE_EXT,
  defaultProjectSettings,
  type ProjectFile,
  type SceneFile,
} from './schema';
import { newScene } from './scene-doc';
import { validatePrefab, validateProject, validateScene, type Problem } from './validate';

export const ENGINE_VERSION = '0.1.0';

export class ProjectFormatError extends Error {
  constructor(
    message: string,
    readonly problems: Problem[] = [],
  ) {
    super(message);
  }
}

/** Turns a display name into a safe file stem: "Level 01!" → "level_01". */
export function fileStem(name: string): string {
  const s = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'untitled';
}

export function newProject(name: string, firstSceneName = 'level_01'): { project: ProjectFile; scenes: Record<string, SceneFile> } {
  const scenePath = `${SCENES_DIR}/${fileStem(firstSceneName)}${SCENE_EXT}`;
  return {
    project: {
      format: 'cocoaworlds.project',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: newId(),
      name: name.trim(),
      startScene: scenePath,
      scenes: [scenePath],
      settings: defaultProjectSettings(),
      createdAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
    },
    scenes: { [scenePath]: newScene(firstSceneName) },
  };
}

/** Stable, readable JSON: two-space indent and a trailing newline, so files diff cleanly in git. */
export function stringify(data: ProjectFile | SceneFile | PrefabFile): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function parseJson(text: string, what: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProjectFormatError(`The ${what} file is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProjectFormatError(`The ${what} file does not contain an object.`);
  }
  return raw as Record<string, unknown>;
}

export function parseProject(text: string): { project: ProjectFile; migrated: boolean } {
  const { data, migrated } = migrateProject(parseJson(text, 'project'));
  const r = validateProject(data);
  if (!r.ok) throw new ProjectFormatError('The project file is damaged.', r.problems);
  return { project: r.value, migrated };
}

export function parseScene(text: string): { scene: SceneFile; migrated: boolean } {
  const { data, migrated } = migrateScene(parseJson(text, 'scene'));
  const r = validateScene(data);
  if (!r.ok) throw new ProjectFormatError('The scene file is damaged.', r.problems);
  return { scene: r.value, migrated };
}

export function parsePrefab(text: string): { prefab: PrefabFile; migrated: boolean } {
  const { data, migrated } = migratePrefab(parseJson(text, 'prefab'));
  const r = validatePrefab(data);
  if (!r.ok) throw new ProjectFormatError('The prefab file is damaged.', r.problems);
  return { prefab: r.value, migrated };
}
