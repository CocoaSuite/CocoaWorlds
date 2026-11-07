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
  /** Plants made in the Plants workspace, shared by every scene. */
  plants?: import('./plants').PlantDef[];
  /** Materials starred in the pickers (ids; missing: none). */
  favouriteMaterials?: string[];
  /** Skies saved from the Sky workspace, for any scene (missing: none). */
  skies?: SavedSky[];
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
  /** Shift sprints; sprinting and jumping use up stamina, shown as a bar, which comes back when resting. */
  stamina: boolean;
  /** Frames per second in a corner while playing. */
  showFps: boolean;
  /** Base building: plans place build sites, rooms seal, comfort, sleeping to save (missing: off). */
  building: boolean;
  /** The world is kept between sessions: where every object is, copies, what was taken away, creatures, the player (missing: off). */
  saveWorld: boolean;
  /** Esc shows a menu to save and load (one save); the game then saves only from there or by blocks (missing: off). */
  saveMenu: boolean;
}

export const defaultGameRules = (): GameRules => ({ health: true, score: true, thirdPerson: false, saveItems: false, stamina: false, showFps: false, building: false, saveWorld: false, saveMenu: false });

/** A project's game rules with defaults filled in. */
export function gameRules(settings: Pick<ProjectSettings, 'game'> | undefined): GameRules {
  const g = settings?.game ?? {};
  const d = defaultGameRules();
  const pick = (k: keyof GameRules) => (typeof g[k] === 'boolean' ? (g[k] as boolean) : d[k]);
  return { health: pick('health'), score: pick('score'), thirdPerson: pick('thirdPerson'), saveItems: pick('saveItems'), stamina: pick('stamina'), showFps: pick('showFps'), building: pick('building'), saveWorld: pick('saveWorld'), saveMenu: pick('saveMenu') };
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
  /** True: grass grows under it (it doesn't clear Foliage it stands on). */
  keepsGrass?: boolean;
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
  /** Shiny and metal materials reflect the level around the camera (missing: on). */
  reflections?: boolean;
  /** Reflection probes for the rooms the level's brushes make (missing: on). Placed Reflection probes count either way. */
  autoProbes?: boolean;
  /** Ambient occlusion: corners, creases and the ground under things darken (missing: on, as default). */
  ao?: AoSettings;
  /** Glow around very bright things: lamps, glowing materials, the sun's glare (missing: on). */
  bloom?: BloomSettings;
  /** Day and night: the sun goes round, the sky and light change with it (missing: off). */
  day?: DayCycle;
  /** The map's background sound (wind, birds, a hum), looping and heard everywhere while playing (missing: none). */
  backgroundSound?: BackgroundSound;
  /** Base building: the game's own build pieces (JSON, as building/data/*.json) and base settings merged over base.json. */
  building?: { pieces?: unknown[]; base?: unknown };
}

export interface BackgroundSound {
  /** A project sound, by its path ('' for none). */
  sound: string;
  volume: number;
}
export const backgroundSoundOf = (s: { backgroundSound?: Partial<BackgroundSound> } | undefined): BackgroundSound => ({ sound: '', volume: 1, ...(s?.backgroundSound ?? {}) });

export interface AoSettings {
  enabled: boolean;
  /** 0–2: how dark. */
  strength: number;
  /** How far, in units, things darken each other (32 is half a grid square of 64). */
  radius: number;
}
export const DEFAULT_AO: AoSettings = { enabled: true, strength: 1, radius: 32 };
export interface BloomSettings {
  enabled: boolean;
  /** 0–3: how strong the glow is. */
  strength: number;
  /** How bright a pixel must be to glow (1: brighter than white; lower makes more things glow). */
  threshold: number;
  /** 0–1: how far the glow spreads. */
  radius: number;
}
export const DEFAULT_BLOOM: BloomSettings = { enabled: true, strength: 0.6, threshold: 1, radius: 0.4 };
export const bloomOf = (s: { bloom?: BloomSettings } | undefined): BloomSettings => ({ ...DEFAULT_BLOOM, ...(s?.bloom ?? {}) });
export interface DayCycle {
  enabled: boolean;
  /** Real minutes for a whole day (0: time stands still unless a block changes it). */
  minutes: number;
  /** The hour the game starts at (0–24; 12 is noon). */
  startHour: number;
  /** 0–1: how bright the moonlit night is. */
  night: number;
  /** The day the game starts on (the count goes up at midnight). */
  startDay: number;
  /** Show the day count on screen while playing. */
  showDay: boolean;
}
export const DEFAULT_DAY: DayCycle = { enabled: false, minutes: 12, startHour: 9, night: 0.25, startDay: 1, showDay: false };
export const dayOf = (s: { day?: DayCycle } | undefined): DayCycle => ({ ...DEFAULT_DAY, ...(s?.day ?? {}) });
export const aoOf = (s: { ao?: AoSettings } | undefined): AoSettings => ({ ...DEFAULT_AO, ...(s?.ao ?? {}) });

export interface SkySettings {
  enabled: boolean;
  /** Straight up, at the horizon, and below the horizon. */
  top: string;
  horizon: string;
  ground: string;
  // (The rest is missing in older files: filled in by skyOf.)
  /** 0…1: how high the horizon's colour reaches up the sky. */
  haze?: number;
  /** The sun's disc, across (degrees; 0: none) and the glow round it (0…1). It sits where the scene's Sun shines from. */
  sunSize?: number;
  sunGlow?: number;
  /** Clouds: how much of the sky they cover (0…1), how soft their edges are (0…1), how big (×) and how fast they drift. */
  clouds?: number;
  cloudSoftness?: number;
  cloudSize?: number;
  cloudSpeed?: number;
  /** Their lit side and their shaded side. */
  cloudColour?: string;
  cloudShade?: string;
  /** 0…1: stars, showing where the sky is dark. */
  stars?: number;
  /** The scene's ambient light (and fog) take their colours from the sky. */
  lightFromSky?: boolean;
}

export const defaultSky = (): SkySettings => ({ enabled: true, top: '#4a7fc1', horizon: '#c9dcef', ground: '#3b3a36' });

/** A sky with every setting filled in. */
export function skyOf(s: SkySettings | undefined): Required<SkySettings> {
  return {
    ...defaultSky(),
    haze: 0.4,
    sunSize: 1.6,
    sunGlow: 0.5,
    clouds: 0,
    cloudSoftness: 0.5,
    cloudSize: 1,
    cloudSpeed: 0.5,
    cloudColour: '#ffffff',
    cloudShade: '#9aa6b4',
    stars: 0,
    lightFromSky: false,
    ...(s ?? {}),
  } as Required<SkySettings>;
}

/** A sky saved in the project: its settings and where its sun stood (height, colour, brightness). */
export interface SavedSky {
  id: string;
  name: string;
  sky: Omit<SkySettings, 'enabled'>;
  sun?: { height: number; colour: string; intensity: number };
}

/** Ready-made skies, each with where its sun stands (degrees up, its colour and brightness). */
export const SKY_PRESETS: { key: string; name: { en: string; ru: string }; sky: Omit<SkySettings, 'enabled'>; sun: { height: number; colour: string; intensity: number } }[] = [
  { key: 'day', name: { en: 'Clear day', ru: 'Ясный день' }, sky: { top: '#3f78c9', horizon: '#cfe3f3', ground: '#4a4740', haze: 0.35, sunSize: 1.6, sunGlow: 0.55, clouds: 0.28, cloudSoftness: 0.5, cloudSize: 1, cloudSpeed: 0.5, cloudColour: '#ffffff', cloudShade: '#a3afbd', stars: 0, lightFromSky: true }, sun: { height: 55, colour: '#fff4e0', intensity: 2.2 } },
  { key: 'morning', name: { en: 'Morning', ru: 'Утро' }, sky: { top: '#6f9ad0', horizon: '#f3d7b8', ground: '#4a4238', haze: 0.6, sunSize: 2, sunGlow: 0.7, clouds: 0.3, cloudSoftness: 0.55, cloudSize: 1.2, cloudSpeed: 0.4, cloudColour: '#fff1e2', cloudShade: '#a99aa6', stars: 0, lightFromSky: true }, sun: { height: 14, colour: '#ffd9a8', intensity: 1.6 } },
  { key: 'sunset', name: { en: 'Sunset', ru: 'Закат' }, sky: { top: '#2f3f75', horizon: '#ff9a5c', ground: '#3a2c2a', haze: 0.8, sunSize: 2.6, sunGlow: 0.9, clouds: 0.45, cloudSoftness: 0.45, cloudSize: 1.3, cloudSpeed: 0.3, cloudColour: '#ffc9a0', cloudShade: '#6a4a6a', stars: 0.15, lightFromSky: true }, sun: { height: 4, colour: '#ffad6b', intensity: 1.3 } },
  { key: 'overcast', name: { en: 'Overcast', ru: 'Пасмурно' }, sky: { top: '#8d99a6', horizon: '#c3cad1', ground: '#4c4f52', haze: 0.9, sunSize: 0, sunGlow: 0.15, clouds: 0.88, cloudSoftness: 0.75, cloudSize: 1.4, cloudSpeed: 0.6, cloudColour: '#d9dde2', cloudShade: '#8a9098', stars: 0, lightFromSky: true }, sun: { height: 50, colour: '#e8eef5', intensity: 0.8 } },
  { key: 'storm', name: { en: 'Stormy', ru: 'Гроза' }, sky: { top: '#3b4450', horizon: '#7d858d', ground: '#2b2d30', haze: 0.7, sunSize: 0, sunGlow: 0.1, clouds: 0.72, cloudSoftness: 0.3, cloudSize: 0.7, cloudSpeed: 2, cloudColour: '#9aa2ab', cloudShade: '#3c434c', stars: 0, lightFromSky: true }, sun: { height: 30, colour: '#c9d2dc', intensity: 0.7 } },
  { key: 'night', name: { en: 'Night', ru: 'Ночь' }, sky: { top: '#050a1a', horizon: '#1b2440', ground: '#0a0b10', haze: 0.5, sunSize: 1.3, sunGlow: 0.25, clouds: 0.15, cloudSoftness: 0.6, cloudSize: 1, cloudSpeed: 0.3, cloudColour: '#3a4560', cloudShade: '#141a2a', stars: 0.9, lightFromSky: true }, sun: { height: 40, colour: '#9fb3d9', intensity: 0.35 } },
];

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
