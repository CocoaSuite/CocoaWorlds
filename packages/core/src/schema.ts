/**
 * On-disk formats. Every file is JSON with a `format` tag and a `schemaVersion`.
 * Bump CURRENT_SCHEMA_VERSION and add a migration in migrate.ts whenever a format changes shape.
 */
import type { Transform } from './math';

/**
 * 1: first format (transforms and brush faces in world space).
 * 2: nested transforms (decision G3): transforms are relative to the parent; brush faces are in the parent's space.
 * 3: edited meshes (decision G4): brush data may carry `mesh` (explicit corners and polygons). Older files load unchanged.
 */
export const CURRENT_SCHEMA_VERSION = 3;

export const PROJECT_FILE = 'project.cwproj';
export const SCENE_EXT = '.cwscene';
export const SCENES_DIR = 'scenes';
export const ASSETS_DIR = 'assets';
export const SCRIPTS_DIR = 'scripts';
export const PREFABS_DIR = 'prefabs';
/** Caches, autosaves and recovery data. Safe to delete; ignored by version control. */
export const WORK_DIR = '.cocoaworlds';

export interface ProjectSettings {
  /** Grid step in units used by the editor when snapping. */
  gridSize: number;
  /** Units per metre, used to convert to physics space. */
  unitsPerMetre: number;
  /** Which built-in game systems the project uses (missing in older files: everything on). */
  game?: Partial<GameRules>;
  /** Game values shared by every script (Cash, Gems, Round …). */
  values?: GameValue[];
}

/** A value every script in the game shares, defined once for the project. */
export interface GameValue {
  name: string;
  type: 'number' | 'boolean' | 'text';
  initial: number | boolean | string;
  /** Shown on screen while playing. */
  show: boolean;
}

/** Built-in game systems a project can switch off (a building or farming game may want neither). */
export interface GameRules {
  /** The player has health: damage, falls, dying, the health bar. Off: nothing hurts and the player can't die. */
  health: boolean;
  /** The game keeps a score, shown once a script changes it. */
  score: boolean;
}

export const defaultGameRules = (): GameRules => ({ health: true, score: true });

/** A project's game rules with defaults filled in. */
export function gameRules(settings: Pick<ProjectSettings, 'game'> | undefined): GameRules {
  const g = settings?.game ?? {};
  const d = defaultGameRules();
  return { health: typeof g.health === 'boolean' ? g.health : d.health, score: typeof g.score === 'boolean' ? g.score : d.score };
}

export interface ProjectFile {
  format: 'cocoaworlds.project';
  schemaVersion: number;
  id: string;
  name: string;
  /** Relative path of the scene the game starts in, e.g. `scenes/level_01.cwscene`. */
  startScene: string;
  /** Relative paths of every scene, in build order. */
  scenes: string[];
  settings: ProjectSettings;
  createdAt: string;
  engineVersion: string;
}

/** Component data is plain JSON keyed by component type, e.g. `{ light: { kind: 'point', ... } }`. */
export type ComponentData = Record<string, unknown>;

export interface EntityData {
  id: string;
  name: string;
  /** Parent entity id, or null for scene roots. */
  parent: string | null;
  transform: Transform;
  tags: string[];
  layer: string;
  visible: boolean;
  locked: boolean;
  components: Record<string, ComponentData>;
}

export interface SceneSettings {
  ambientColor: string;
  ambientIntensity: number;
  backgroundColor: string;
  fog: { enabled: boolean; color: string; near: number; far: number };
  gravity: number;
}

export interface SceneFile {
  format: 'cocoaworlds.scene';
  schemaVersion: number;
  id: string;
  name: string;
  settings: SceneSettings;
  entities: EntityData[];
}

export const defaultProjectSettings = (): ProjectSettings => ({ gridSize: 16, unitsPerMetre: 39.37 });

export const defaultSceneSettings = (): SceneSettings => ({
  ambientColor: '#b8c2d0',
  ambientIntensity: 0.35,
  backgroundColor: '#1f1f1f',
  fog: { enabled: false, color: '#1f1f1f', near: 512, far: 4096 },
  gravity: 800,
});
