/**
 * On-disk formats. Every file is JSON with a `format` tag and a `schemaVersion`.
 * Bump CURRENT_SCHEMA_VERSION and add a migration in migrate.ts whenever a format changes shape.
 */
import type { MaterialDef } from './materials';
import type { Transform } from './math';
import type { UiSettings } from './ui';

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
  /** Materials made in the Materials workspace, shared by every scene. */
  materials?: MaterialDef[];
}

/** A value every script in the game shares, defined once for the project. */
export interface GameValue {
  name: string;
  type: 'number' | 'boolean' | 'text';
  initial: number | boolean | string;
  /** Shown on screen while playing. */
  show: boolean;
  /** Kept between sessions: the game starts with its last value (saved progress). */
  saved?: boolean;
}

/** Built-in game systems a project can switch off (a building or farming game may want neither). */
export interface GameRules {
  /** The player has health: damage, falls, dying, the health bar. Off: nothing hurts and the player can't die. */
  health: boolean;
  /** The game keeps a score, shown once a script changes it. */
  score: boolean;
  /** The camera follows behind the player (Roblox-style) instead of looking through their eyes. */
  thirdPerson: boolean;
  /** The player's items are kept between sessions (saved progress). */
  saveItems: boolean;
}

export const defaultGameRules = (): GameRules => ({ health: true, score: true, thirdPerson: false, saveItems: false });

/** A project's game rules with defaults filled in. */
export function gameRules(settings: Pick<ProjectSettings, 'game'> | undefined): GameRules {
  const g = settings?.game ?? {};
  const d = defaultGameRules();
  const pick = (k: keyof GameRules) => (typeof g[k] === 'boolean' ? (g[k] as boolean) : d[k]);
  return { health: pick('health'), score: pick('score'), thirdPerson: pick('thirdPerson'), saveItems: pick('saveItems') };
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
  /** A gradient sky behind the level (missing in older files: off, the plain background shows). */
  sky?: SkySettings;
  /** Screen UI and the items the player can carry (missing: none). */
  ui?: UiSettings;
}

export interface SkySettings {
  enabled: boolean;
  /** Straight up, at the horizon, and below the horizon. */
  top: string;
  horizon: string;
  ground: string;
}

export const defaultSky = (): SkySettings => ({ enabled: true, top: '#4a7fc1', horizon: '#c9dcef', ground: '#3b3a36' });

/** A scene's settings with everything filled in (older files lack the sky). */
export function sceneSettings(s: Partial<SceneSettings> | undefined): SceneSettings {
  const d = defaultSceneSettings();
  return {
    ...d,
    ...s,
    fog: { ...d.fog, ...(s?.fog ?? {}) },
    sky: { ...defaultSky(), enabled: false, ...(s?.sky ?? {}) },
  };
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
  sky: defaultSky(),
});
