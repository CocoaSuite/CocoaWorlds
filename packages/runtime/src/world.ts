/**
 * The game world for one scene: physics built from the level, stepped at a fixed rate, and the events it
 * produces. Plain data in (a SceneFile), plain data out (body motion as matrices, trigger events), so the
 * editor's Play mode and the standalone runtime drive it the same way.
 *
 * Units: game units (1 u ≈ 1 inch; a standing player is 72 u). Rapier's tolerances are told the scale
 * through `lengthUnit`, so nothing is converted.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import {
  SceneDoc,
  applyMat4,
  dayOf,
  composeTransform,
  decomposeMat4,
  pivotOf,
  readComponent,
  type ColliderData,
  type EntityData,
  type Surface,
  type TerrainData,
  guessSurface,
  isSurface,
  SOFT_SURFACES,
  type RigidBodyData,
  type SceneFile,
  type TriggerData,
  type ChargerData,
  type NpcData,
  type HidingSpotData,
  type LevelChangeData,
  type PathPointData,
  type TrainData,
  type LadderData,
  type WaterData,
  gameRules,
  type BreakableData,
  type ConveyorData,
  type SoundData,
  type SoundAreaData,
  type SoundEffect,
  backgroundSoundOf,
  type GameRules,
  type ModelData,
  type PosterData,
  type StakeData,
  type JunkData,
  type PowerSourceData,
  type OutletData,
  type ExtenderData,
  type StringLightsData,
  type ShelfData,
  type PrinterData,
  worldBoundsOf,
  posterScrollRadius,
  posterOf,
  type UiSettings,
  type WeaponDef,
  weaponOf,
  uiOf,
  UI_SCRIPT_OWNER,
  expandRepeats,
  parkAssets,
  uiShown,
} from '@cocoaworlds/core';
import { EventBus } from './events';
import { DIRECTIONS, ScriptRunner, compileScript, type ScriptSave, type ActionName, type GameValueDef, type Problem, type Program, type SceneInfo, type Script, type Value } from '@cocoaworlds/scripting';
import { scriptTargets } from './script-targets';
import { PLAYER, Player, fallDamage, type PlayerInput } from './player';
import { Weapons, type V3 } from './weapons';
import { ANIM_ROLES, Npc, type AnimRole } from './npc';
import { NavGrid, openNavJob, type NavBuilder, type NavJob } from './navgrid';
import { Acoustics } from './acoustics';
import { FrameSnapshot } from './snapshot';
import { PowerGrid, bulbPoints, dist3, dropOf, rayNearLine, wirePoints, type P3 } from './power';
import { MineSystem, type MineHud, type MineMenu } from './mining/mine';
import { BaseSystem, type BaseAim, type BlockerBox, type BlueprintCard, type BlueprintTag, type BuildPrompt } from './building/base';
import type { BaseConfig } from './building/defs';
import { buildingCatalog } from './building/catalog';
import { momentAnimation } from './hunter/personality';
import type { SpotInfo } from './hunter/spots';
import type { StimulusKind } from './hunter/stimuli';
import { COLLIDER_MATERIAL, signedDist, type Plane, bounds, brushToWorld, isNoGrassBrush, buildMesh, buildWorld, fromData, hullPoints, vertices, type Brush, type BrushData, type WorldBrush } from '@cocoaworlds/geometry';

/** How far away a click can hang an end of string lights (u). */
const HANG_REACH = 144;
/** How long Use is held on a mounted shelf to take it down (s). */
const SHELF_HOLD = 0.6;
/** A plug: how far its body runs back from the base of its prongs, and how far it is from its middle to its side (u). */
const PLUG_BACK = 3.9;
const PLUG_RADIUS = 3.6;

/**
 * What the player hears through, at one point: the area's effect (and how much of it), the background sound
 * that should be playing, and whether that's because they're under water. See `GameWorld.hearing`.
 */
export interface Hearing {
  /** The Sound area the ears are in (the smallest, where they overlap), or null. */
  area: string | null;
  effect: SoundEffect;
  /** 0…1: how much of the effect. */
  mix: number;
  /** The background sound to play now (the area's, else the scene's), or null for silence. */
  background: { sound: string; volume: number } | null;
  /** Under water: muffled whatever area it is. */
  underwater: boolean;
}

/** Owner ids of build pieces' colliders: this, then the site's id. */
const BASE_OWNER = '@base:';
/** Owner id of the mine's colliders. */
const MINE_OWNER = '@mine';

/** Units per metre (an inch-based world). */
export const UNITS_PER_METRE = 39.37;

/**
 * Saved progress: the kept game values and, when the game keeps them, the player's items. The game saves it
 * (browser storage) and hands it back to the next session.
 */
export interface SavedProgress {
  values: Record<string, Value>;
  items?: [string, number][];
  /** Base building (when the game has it): each scene's build sites, by scene name. */
  base?: Record<string, unknown>;
  /** Mining (when the game has it): money, pickaxe, skills, backpack and the mine as dug. */
  mine?: unknown;
  /** The world (when the game keeps it, `saveWorld`): where everything is in each scene played, by scene name. */
  world?: Record<string, SavedScene>;
  /** The scene the player was in (a game starts there again). */
  scene?: string;
  /** When it was saved by asking (the save menu, “Save the game”), in ms since 1970. */
  at?: number;
  /** The day count. */
  day?: number;
}

/**
 * One scene's world as it was saved: everything that moved or changed since the scene started, copies made while
 * playing, what was taken away, creatures and the player. Places are in world units, turns as quaternions.
 */
export interface SavedScene {
  v: 1;
  /** Objects that moved or changed, by id (copies' parts too). */
  bodies: Record<string, SavedBody>;
  /** Copies made while playing that are still there: the object copied, the copy's number (its id is `template#n`) and where it was made. */
  copies: [template: string, n: number, at: [number, number, number]][];
  /** Objects taken out of the game. */
  removed: string[];
  /** Creatures: where they stand, which way they face, their health (0: dead). */
  npcs: Record<string, { at: [number, number, number]; yaw: number; health: number }>;
  /** The player (left out when the scene was only passed through). */
  player?: { at: [number, number, number]; yaw: number; pitch: number; health: number; armour: number; score: number; slot?: number };
  /** Lights switched on or off, broken objects' health, signs' texts (only what changed). */
  lights?: Record<string, boolean>;
  broken?: Record<string, number>;
  signs?: Record<string, string>;
  /** Posters and paintings hung on a wall (true) or loose (false), when not as they started. */
  posters?: Record<string, boolean>;
  /** Shelves mounted (true) or taken down (false), where that changed from the start. */
  shelves?: Record<string, boolean>;
  /** Props stuck in the ground. */
  stakes?: string[];
  /** Power: sources switched from how they started, what each plug is in, string lights hung (their two ends). */
  power?: { on?: Record<string, boolean>; plugs?: Record<string, string>; hung?: Record<string, [P3, P3] | [P3, P3, P3]> };
  /** 3D printers: the print under way (what of, the copy's number, seconds printed) and the prints waiting. */
  printers?: Record<string, { job?: [template: string, n: number, t: number] }>;
  /** The time of day (hours). */
  hour?: number;
  /** Scripts, by object: variables that changed, and limited stacks that have had their run. */
  scripts?: Record<string, ScriptSave>;
  /** (Saves from before `scripts`: limited stacks only.) */
  spent?: Record<string, Record<string, number>>;
  /** Lights' brightness, range, cone and colour that scripts set; models' glow scripts set. */
  lightSet?: Record<string, { intensity?: number[]; range?: number[]; angle?: number[]; color?: number[] }>;
  glows?: Record<string, number>;
  /** Creatures that changed sides. */
  sides?: Record<string, NpcData['side']>;
  /** Screens shown, elements hidden, texts and list rows scripts set. */
  ui?: { shown: string[]; hidden: string[]; text: Record<string, string>; rows: Record<string, string[]> };
  /** Trains: where they are, their last and next stop, moving or not. */
  trains?: Record<string, { p: [number, number, number]; q: [number, number, number, number]; at: string | null; to: string | null; moving: boolean }>;
  /** Sound components scripts stopped. */
  stoppedSounds?: string[];
  /** The world silenced; the save menu blocked by scripts. */
  silent?: boolean;
  noSaving?: boolean;
}

/** An object's saved state: place, turn, and only what differs from how it started. */
export interface SavedBody {
  p: [number, number, number];
  q: [number, number, number, number];
  motion?: BodyInfo['motion'];
  hidden?: true;
  off?: true;
  scale?: number;
}

/** What the screen UI shows at a moment (see GameWorld.uiState). */
export interface UiState {
  /** Ids of the screens shown, and of the elements hidden. */
  shown: string[];
  hidden: string[];
  /** Texts changed by scripts, by element id. */
  texts: Record<string, string>;
  /** The rows of lists with their own rows, by element id. */
  lists: Record<string, string[]>;
  /** What the player carries, in hotbar order. */
  inventory: { item: string; count: number }[];
  /** The picked hotbar slot. */
  slot: number;
  /** A shown screen frees the mouse (for its buttons). */
  freesMouse: boolean;
}

/** A model's triangles as the editor read them from its file (in the file's own units), for collisions. */
export interface ModelMesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** The file's collision meshes (Auto collision), model space. */
  parts?: ModelPart[];
  /** Terrains: four layer weights (0–1) per corner, for what the ground sounds like where it is stood on. */
  weights?: Float32Array;
}
/** One collision mesh: `exact` collides by its triangles; `moves` follows the model's animation. */
export interface ModelPart {
  positions: Float32Array;
  indices: Uint32Array;
  exact: boolean;
  moves: boolean;
}
/** Physics runs at a fixed rate whatever the frame rate. */
export const STEP = 1 / 60;
/** How loud the player's noises are for creatures that listen (Hunters): 1 carries as far as their Hears you up to. */
const LOUD_REPEAT = 2;
export const NOISE = { footsteps: 0.35, landing: 0.5, shot: 1.6, hiding: 0.2 };
/** Most armour the player can carry (Half-Life's suit holds 100). */
export const MAX_ARMOUR = 100;
/** Low health with hidden health: weakness starts below `from`, is full at `full`; full weakness moves `slow` slower. */
export const WEAK = { from: 40, full: 10, slow: 0.4 };
const MAX_STEPS_PER_FRAME = 5;
/** How far behind the player the third-person camera sits. */
const THIRD_PERSON_DISTANCE = 160;

let ready: Promise<void> | null = null;
/** Load the physics engine (WebAssembly). Safe to call many times. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export interface TriggerEvent {
  kind: 'enter' | 'exit';
  /** The trigger zone's entity id. */
  trigger: string;
  /** What entered or left. */
  other: string;
  /** Seconds since the world started. */
  time: number;
}

export interface BodyInfo {
  id: string;
  /** Made while playing (“Make a copy”). */
  copy?: boolean;
  /**
   * 'brush': a brush with Physics. 'point': a point object with a collision shape. 'unit': an object a script
   * moves, with everything inside it (a door group moves as one). 'zone': a trigger zone.
   */
  kind: 'brush' | 'point' | 'unit' | 'zone';
  motion: RigidBodyData['motion'];
}

export interface ScriptLog {
  text: string;
  owner: string;
  block: string;
  time: number;
}

interface Tween {
  from: { p: Q3; q: Quat; s?: number };
  to: { p: Q3; q: Quat; s?: number };
  t0: number;
  t1: number;
  done: boolean;
}

type Q3 = [number, number, number];
type LightData = { color: string; intensity: number; range: number; angle: number; on?: boolean };
/** A value going from one setting to another between two times (from null: from how it was made). */
type Fade = { from: number[] | null; to: number[]; t0: number; t1: number };
interface LiveLight {
  on: boolean;
  intensity: Fade;
  range: Fade;
  angle: Fade;
  color: Fade;
}
const fadeK = (f: Fade, t: number) => (t >= f.t1 ? 1 : Math.max(0, (t - f.t0) / (f.t1 - f.t0)));
const fadeAt = (f: Fade, t: number): number[] => {
  const k = fadeK(f, t);
  return f.to.map((v, i) => (f.from ? f.from[i]! + (v - f.from[i]!) * k : v));
};
const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c.trim());
const rgbOf = (c: string): number[] => {
  const n = parseInt(c.trim().slice(1), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
};
type Quat = { x: number; y: number; z: number; w: number };

/** The heaviest thing the player can pick up (kg). */
const MAX_CARRY = 50;
/** How close and how far something carried can be brought or pushed with the wheel (u, from the eyes). */
const HOLD_NEAR = 40;
const HOLD_FAR = 150;
/** How sharply something must be stopped to make a sound (u/s; about 0.6 m/s: set down gently, a soft tap). */
const HIT_SPEED = 24;
/** A hit this sharp is as loud as it gets (u/s; about 10 m/s: thrown hard, or a long fall). */
const HIT_FULL = 420;
/** “Make an explosion”: a blast with no weapon behind it (size, damage and push filled in). */
const BLAST: WeaponDef = { kind: 'projectile', damage: 0, rate: 1, automatic: false, range: 0, spread: 0, pellets: 1, ammo: '', speed: 0, arc: false, blast: 0, push: 0, sound: '' };
/** Radians a held object turns per pixel of mouse movement. */
const HELD_TURN = 0.006;
/** How far (u) what's held may be pushed from its place before it's dropped. */
const CARRY_SLIP = 128;
/** The fastest (u/s) what's held moves to its place. */
const CARRY_SPEED = 1500;

/** A model or Collision shape that collides as part of a unit: the object, the id it goes by, where it is. */
type UnitPoint = { e: EntityData; id: string; world: number[] };

interface Body {
  info: BodyInfo;
  body: RAPIER.RigidBody;
  /** Where it started (for “return to start”). */
  start: { p: Q3; q: Quat };
  /** The brushes drawn with this body, in world space at the start. */
  brushes: Brush[];
  visible: boolean;
  /** Inverse of the body's starting placement, so motion can be reported as "start → now". */
  startInverse: number[];
  /** Size compared with the start (“Scale”), around the body's origin (its pivot). */
  scale: number;
  /** Point objects: their collision shape and where they were placed (for drawing and rescaling). */
  shape?: { collider: ColliderData; matrix: number[] };
  /** Point objects that collide by their model's shape. */
  model?: { data: ModelData; mesh: ModelMesh; matrix: number[] };
  /** Collision meshes the model's animation moves: their colliders and resting place on the body. */
  parts?: Map<number, MovingPart>;
  /** Posters and paintings: their data and where they were placed (without scale). */
  poster?: { data: PosterData; matrix: number[] };
  /** Physics settings, when it has a Physics component. */
  rb?: RigidBodyData;
  /** Velocity before the physics step (dynamic bodies awake), for hearing hits. */
  v0?: Float64Array;
  /** Copies made while playing: models carried by this unit, and where they were placed. */
  riders?: { id: string; matrix: number[] }[];
  /** Where it was before the last physics step (x, y, z, then the rotation x, y, z, w), for drawing in between. */
  prev?: Float64Array;
  /** How it moved when the world started (scripts and picking up can change `info.motion`). */
  startMotion: BodyInfo['motion'];
}

/** A body that moved further than this in one step was put there (teleported): drawn there at once (u). */
const SNAP = 128;

/**
 * The model animation a creature plays for a role, from its list (“idle, walk, attack, die, run, busy, hurt”).
 * Roles left out fall back: running to walking, busy to standing; a missing hurt plays nothing.
 */
export function npcAnimation(list: string, role: AnimRole): string {
  const names = String(list ?? '').split(',').map((x) => x.trim());
  const of = (r: AnimRole) => names[ANIM_ROLES.indexOf(r)] ?? '';
  return of(role) || (role === 'run' ? of('walk') : role === 'busy' ? of('idle') : role === 'pull' ? of('attack') : '');
}

/**
 * A level change: where the player goes and what they take along. The world that ends makes it; the next world
 * starts from it (`GameWorld.create(…, { arrive })`).
 */
export interface Travel {
  /** The scene to go to (its name), and the landmark to arrive by ('' for the Player start). */
  scene: string;
  landmark: string;
  /** Where the feet were relative to the landmark (null: it wasn't found in the scene left). */
  offset: [number, number, number] | null;
  yaw: number;
  pitch: number;
  velocity: [number, number, number];
  health: number;
  armour: number;
  score: number;
  usesScore: boolean;
  inventory: [string, number][];
  slot: number;
  values: Record<string, Value>;
  /** The worlds of scenes played this session, as they were left (games that keep the world). */
  worlds?: Record<string, SavedScene>;
  day?: number;
}

/** The player's state for the screen (health bar, score). */
export interface PlayerStatus {
  /** The health bar shows (the project uses health and doesn't hide it). */
  showHealth: boolean;
  /** The player has health (shown or hidden). */
  hasHealth: boolean;
  health: number;
  maxHealth: number;
  /** Armour (0–100); shown once the player has some. */
  armour: number;
  /** The weapon in hand: its name and how much of its ammo is carried (null: it needs none). */
  weapon: { name: string; ammo: number | null; ammoName: string } | null;
  score: number;
  /** Whether any script uses the score (otherwise the screen doesn't show it). */
  showScore: boolean;
  /** The day count, when the scene shows it on screen (else null). */
  day: number | null;
  /** The time of day in hours, when the scene shows the clock (else null). */
  clock: number | null;
  /** Seconds since the player was last hurt (Infinity if never), for a red flash. */
  sinceHurt: number;
  deaths: number;
  /** Stamina 0–100, or null when the game has none. */
  stamina: number | null;
  /** Frames per second shown while playing. */
  showFps: boolean;
  /** How badly hurt the player is when health is hidden, 0–1 (0: fine or health shown). */
  weak: number;
}

export interface WorldStats {
  staticPieces: number;
  bodies: number;
  triggers: number;
}

export class GameWorld {
  private world: RAPIER.World;
  /**
   * Stand-ins for the player: a fixed copy of every collider of a moving (kinematic) object, by the real
   * collider's handle. The physics engine's character movement sticks on kinematic bodies, so the player moves
   * against these copies instead (the real ones still push physics objects).
   */
  private standIns = new Map<number, RAPIER.Collider>();
  /** Stand-in handle → the real collider. */
  private standInOf = new Map<number, RAPIER.Collider>();
  private standInBody!: RAPIER.RigidBody;
  private events = new RAPIER.EventQueue(true);
  private bodies = new Map<string, Body>();
  /** Collider handle → entity id. */
  private owner = new Map<number, string>();
  /** Zones by collider: `inside` is what scripts were told entered; `present` is everything in it now. */
  private triggers = new Map<number, { id: string; data: TriggerData; fired: boolean; inside: Set<string>; present: Set<string> }>();
  private pending: TriggerEvent[] = [];
  private accumulator = 0;
  private disposed = false;
  time = 0;
  /** What happens in the game, for scripts and the editor console. */
  readonly bus = new EventBus();
  readonly stats: WorldStats = { staticPieces: 0, bodies: 0, triggers: 0 };
  /** Script problems found when the world was built (stacks with errors are left out). */
  readonly scriptProblems: Problem[] = [];
  private runner: ScriptRunner;
  private tweens = new Map<string, Tween>();
  private logs: ScriptLog[] = [];
  private reportedErrors = 0;
  private names = new Map<string, string>();
  /** Brushes that are part of the still level (not moved by physics or scripts). */
  levelIds = new Set<string>();
  /** Where the level is (world bounds of every brush and fixed object), for measuring navigation. */
  private extent: { min: [number, number, number]; max: [number, number, number] } | null = null;
  private nav: NavGrid | null | undefined;
  /** The player, when the scene has a Player start. */
  readonly player: Player | null = null;
  private parentOf = new Map<string, string | null>();
  /** Copies made while playing → what they were copied from. */
  private copyOf = new Map<string, string>();
  private useQueued = false;
  /** Below this the player has fallen out of the world and starts again. */
  private killY = -Infinity;
  private health: number = PLAYER.maxHealth;
  private armour = 0;
  /** Chargers on the walls: what each has left to give, and fractions given but not yet whole. */
  private chargers = new Map<string, { data: ChargerData; left: number }>();
  private score = 0;
  private usesScore = false;
  private hurtAt = -Infinity;
  private deaths = 0;
  private valueDefs: GameValueDef[];
  private globals = new Map<string, Value>();
  private messages: { text: string; until: number; from: string }[] = [];
  /** What each text sign says now (changed by blocks). */
  private signs = new Map<string, string>();
  /** Goes up whenever a sign's text changes, so the screen knows to redraw. */
  signVersion = 0;
  private doc!: SceneDoc;
  private scriptInfo!: SceneInfo;
  /** Object → the unit (moving body) it is part of. */
  private unitOf = new Map<string, string>();
  private spawnedIds: string[] = [];
  /** Signs in copies made since the last `drainChanges`, and where they stand. */
  private spawnedSigns: { id: string; matrix: number[] }[] = [];
  private removedIds: string[] = [];
  private copies = 0;
  /** Breakable objects' health. */
  private breakHealth = new Map<string, number>();
  /** Conveyor collider handle → belt velocity. */
  private belts = new Map<number, { x: number; z: number }>();
  /** Water and ladders: zones that change how the player (and floating things) move. */
  private waters: { id: string; collider: RAPIER.Collider; top: number; data: WaterData }[] = [];
  private ladders: { id: string; collider: RAPIER.Collider; data: LadderData }[] = [];
  private volumes = new Set<number>();
  /** Sound areas: the brush's planes (inside is behind all of them), its size (smallest wins) and settings. */
  private soundAreas: { id: string; planes: Plane[]; size: number; data: SoundAreaData }[] = [];
  /** Seconds the player's head has been under water (for drowning), and when it last hurt. */
  private underwaterFor = 0;
  private drownedAt = 0;

  /** Which built-in game systems are on (from the project settings). */
  readonly rules: GameRules;

  /** Build a world from a scene snapshot. Call `initPhysics()` first. */
  /** `models`: the triangles of the model files that objects collide by (Model component, Collision). */
  static create(
    scene: SceneFile,
    options: {
      rules?: Partial<GameRules>;
      values?: GameValueDef[];
      models?: Map<string, ModelMesh>;
      /** Each terrain's surface (terrain space), by object: it collides as fixed ground. */
      terrains?: Map<string, ModelMesh[]>;
      /** Trees' trunks, by plant object: width and height (u); each collides as a fixed box. */
      trunks?: Map<string, { width: number; height: number }>;
      saved?: SavedProgress | null;
      clock?: () => number;
      /** What each material sounds like (by id); missing ones are guessed from their names. */
      surfaces?: Map<string, Surface>;
      arrive?: Travel | null;
      /** Base building: extra pieces and settings (JSON, as `settings.building` of the scene). */
      building?: { pieces?: unknown[]; base?: unknown };
      /**
       * Measures where creatures can walk off this thread (workers), so a large level doesn't hold up the start.
       * Wait for `navReady` before the first step. Without it the level is measured here, as the world is made.
       */
      navBuilder?: NavBuilder;
    } = {},
  ): GameWorld {
    const w = new GameWorld(scene, gameRules({ game: options.rules }), options.values ?? [], options.models ?? new Map(), options.terrains ?? new Map(), options.trunks ?? new Map(), options.navBuilder);
    if (options.clock) w.clock = options.clock;
    if (options.surfaces) w.surfaces = options.surfaces;
    w.sceneName = scene.name;
    if (w.rules.building) w.initBase(options.building ?? (scene.settings as { building?: { pieces?: unknown[]; base?: unknown } }).building);
    if (w.rules.mining) w.initMine((scene.settings as { mining?: unknown }).mining);
    if (options.saved || options.arrive?.worlds) w.loadProgress(options.saved ?? { values: {} }, options.arrive ?? null);
    if (w.savesWhenAsked) w.checkpoint = options.saved ?? null;
    if (options.arrive) w.arrive(options.arrive);
    return w;
  }

  // ── Level changes ──

  /** A level change that has begun (the game stops; whoever runs it starts the next scene from it). */
  travel: Travel | null = null;
  private levelZones: { id: string; collider: RAPIER.Collider; data: LevelChangeData }[] = [];
  /** Level-change zones work only once the player has been outside all of them (not on arrival inside one). */
  private zonesArmed = false;

  /** Leave for another scene, by a landmark (or to its Player start). */
  changeScene(scene: string, landmark = ''): void {
    const p = this.player;
    if (this.travel || !p || !scene) return;
    const feet = p.feetPosition;
    const lm = landmark ? this.landmarkAt(landmark) : null;
    this.travel = {
      scene,
      landmark: lm ? landmark : '',
      offset: lm ? [feet.x - lm[0], feet.y - lm[1], feet.z - lm[2]] : null,
      yaw: p.input.yaw,
      pitch: p.input.pitch,
      velocity: [p.velocity.x, p.velocity.y, p.velocity.z],
      health: this.health,
      armour: this.armour,
      score: this.score,
      usesScore: this.usesScore,
      inventory: [...this.inventory],
      slot: this.slot,
      values: Object.fromEntries(this.globals),
      day: this.day,
    };
    if (this.keepsWorld) this.travel.worlds = { ...this.otherWorlds, [this.sceneName]: this.saveScene(false) };
    this.bus.emit({ type: 'travel', scene, landmark, time: this.time });
  }

  /** Where the landmark called `name` is in this scene (an object with the Landmark component), or null. */
  private landmarkAt(name: string): [number, number, number] | null {
    const e = this.doc.entities.find((x) => x.components.landmark && x.name === name);
    if (!e) return null;
    const m = this.doc.worldMatrix(e.id);
    return [m[12]!, m[13]!, m[14]!];
  }

  /** Arrive from another scene: what the player carried, and where they stood by the landmark. */
  private arrive(t: Travel): void {
    this.health = t.health;
    this.armour = t.armour;
    this.score = t.score;
    this.usesScore = t.usesScore;
    this.inventory = new Map(t.inventory);
    this.slot = t.slot;
    for (const [k, v] of Object.entries(t.values)) if (this.globals.has(k)) this.globals.set(k, v);
    if (typeof t.day === 'number') {
      this.day = t.day;
      this.dayFresh = false;
    }
    const p = this.player;
    if (!p) return;
    const lm = t.landmark ? this.landmarkAt(t.landmark) : null;
    if (lm && t.offset) p.teleport({ x: lm[0] + t.offset[0], y: lm[1] + t.offset[1], z: lm[2] + t.offset[2] }, t.yaw);
    else p.teleport(p.spawn.feet, t.yaw);
    p.input.pitch = t.pitch;
    p.velocity = { x: t.velocity[0], y: t.velocity[1], z: t.velocity[2] };
  }

  /** Walking into a level-change zone (after having been outside them all) begins the change. */
  private checkLevelZones(): void {
    const p = this.player;
    if (!p || !this.levelZones.length || this.travel) return;
    const shape = new RAPIER.Cylinder((p.crouched ? PLAYER.crouchHeight : PLAYER.height) / 2, PLAYER.radius);
    const at = p.body.translation();
    const zone = this.levelZones.find((z) => z.collider.intersectsShape(shape, at, { x: 0, y: 0, z: 0, w: 1 }));
    if (!zone) this.zonesArmed = true;
    else if (this.zonesArmed && zone.data.scene) this.changeScene(zone.data.scene, zone.data.landmark.trim());
  }

  /** 0…1 for scripts' random numbers and creatures' whims (replaceable for tests). */
  random: () => number = Math.random;

  /** The real time in seconds since 1970 (replaceable for tests). */
  private clock = () => Date.now() / 1000;

  /** Start from saved progress: kept values (of the right type), if the game keeps them items, and the world. */
  private loadProgress(saved: SavedProgress, arrive: Travel | null): void {
    for (const d of this.valueDefs) {
      if (!d.saved || !(d.name in (saved.values ?? {}))) continue;
      const v = saved.values[d.name];
      if (typeof v === (d.type === 'boolean' ? 'boolean' : d.type === 'number' ? 'number' : 'string')) this.globals.set(d.name, v as Value);
    }
    if (this.rules.saveItems && Array.isArray(saved.items))
      for (const [name, n] of saved.items) if (typeof name === 'string' && typeof n === 'number' && n > 0) this.inventory.set(name, Math.round(n));
    if (this.rules.saveWorld) {
      // (Scenes left this session, as they were left, over what was last saved.)
      const worlds = { ...(saved.world && typeof saved.world === 'object' ? saved.world : {}), ...(arrive?.worlds ?? {}) };
      this.otherWorlds = worlds;
      const mine = worlds[this.sceneName];
      // (The player is put back only when the game is resumed here, not when arriving from another scene.)
      if (mine) this.loadScene(mine, !arrive && saved.scene === this.sceneName);
    }
    if (typeof saved.day === 'number' && Number.isFinite(saved.day)) {
      this.day = Math.max(0, Math.round(saved.day));
      this.dayFresh = false;
    }
    if (this.mine && saved.mine) {
      this.mine.load(saved.mine);
      this.syncMineColliders(true);
    }
    if (saved.base && typeof saved.base === 'object') {
      this.otherBases = { ...saved.base };
      if (this.base && this.sceneName in saved.base) this.base.load(saved.base[this.sceneName]);
    }
  }

  /** What is kept between sessions right now, or null when the game keeps nothing. */
  progress(): SavedProgress | null {
    // (A game with “Save the game” blocks: what was kept at the last of them.)
    if (this.savesWhenAsked) return this.checkpoint;
    return this.liveProgress();
  }

  /** What would be kept if it were saved right now. */
  private liveProgress(): SavedProgress | null {
    const kept = this.valueDefs.filter((d) => d.saved);
    if (!kept.length && !this.rules.saveItems && !this.base && !this.mine && !this.rules.saveWorld) return null;
    const out: SavedProgress = { values: Object.fromEntries(kept.map((d) => [d.name, this.globals.get(d.name) ?? d.initial])) };
    if (this.dayOn || this.day !== this.firstDay) out.day = this.day;
    if (this.rules.saveItems) out.items = [...this.inventory];
    if (this.base) out.base = { ...this.otherBases, [this.sceneName]: this.base.save() };
    if (this.mine) out.mine = this.mine.save();
    if (this.keepsWorld) {
      out.world = { ...this.otherWorlds, [this.sceneName]: this.saveScene(true) };
      out.scene = this.sceneName;
    }
    return out;
  }

  /** Save the game now (a game that saves only when asked keeps this until the next save). */
  saveNow(): void {
    const p = this.liveProgress();
    this.checkpoint = p && { ...p, at: Math.round(this.clock() * 1000) };
  }

  /** Start over: kept values back to their starting values, kept items emptied, the world no longer kept. */
  forgetProgress(): void {
    this.otherWorlds = {};
    this.worldForgotten = true;
    this.day = this.firstDay;
    for (const d of this.valueDefs) if (d.saved) this.globals.set(d.name, d.initial);
    if (this.rules.saveItems) {
      this.inventory.clear();
      this.slot = 0;
    }
  }

  // ── Keeping the world (saveWorld) ──

  /** Other scenes' saved worlds (kept as they were, or as they were left this session). */
  private otherWorlds: Record<string, SavedScene> = {};
  /** “Forget saved progress” ran: the world isn't kept again this session. */
  private worldForgotten = false;
  /** Copies made while playing, by copy id: what of, its number, where, and whether the start blocks made it. */
  private made = new Map<string, { template: string; n: number; at: Q3; atStart: boolean; parts: string[] }>();
  /** The highest copy number a saved copy came back with (later copies are numbered past it). */
  private restoredCopies = 0;
  /** Everything taken out of the game (and what was inside it). */
  private gone = new Set<string>();
  /** “When the game starts” has run. */
  private started = false;
  /** Sound components scripts stopped (they don't start again when a save is loaded). */
  private stoppedSounds = new Set<string>();
  /** The game saves only when asked: the save menu, or “Save the game” blocks. */
  private savesWhenAsked = false;
  /** Scripts blocked the save menu: the player can neither save nor load. */
  savingBlocked = false;
  /** Saved states and removals waiting for the start blocks (which make their copies again). */
  private waiting: { bodies: Record<string, SavedBody>; removed: string[] } | null = null;

  private get keepsWorld(): boolean {
    return this.rules.saveWorld && !this.worldForgotten;
  }

  /** This scene's world now (`withPlayer`: where the player is too). */
  private saveScene(withPlayer: boolean): SavedScene {
    const r = (x: number, k = 1000) => Math.round(x * k) / k;
    const out: SavedScene = { v: 1, bodies: {}, copies: [], removed: [], npcs: {}, hour: r(this.dayHour) };
    const trains = new Set(this.trains.map((t) => t.id));
    for (const [id, b] of this.bodies) {
      if (b.info.kind === 'zone' || trains.has(id)) continue;
      // (Halfway through a scripted move: where it is headed.)
      const t = b.body.translation(), q = b.body.rotation();
      const goal = this.goalOf(id, { p: [t.x, t.y, t.z], q: { x: q.x, y: q.y, z: q.z, w: q.w } });
      const s = b.start;
      const moved = Math.abs(goal.p[0] - s.p[0]) + Math.abs(goal.p[1] - s.p[1]) + Math.abs(goal.p[2] - s.p[2]) > 0.01 || Math.abs(goal.q.x * s.q.x + goal.q.y * s.q.y + goal.q.z * s.q.z + goal.q.w * s.q.w) < 1 - 1e-7;
      const tw = this.tweens.get(id);
      const scale = tw?.to.s ?? b.scale;
      const off = this.switched.get(id) === false;
      if (!moved && b.visible && !off && scale === 1 && b.info.motion === b.startMotion && !b.info.copy) continue;
      const sb: SavedBody = { p: [r(goal.p[0]), r(goal.p[1]), r(goal.p[2])], q: [r(goal.q.x, 1e6), r(goal.q.y, 1e6), r(goal.q.z, 1e6), r(goal.q.w, 1e6)] };
      if (b.info.motion !== b.startMotion) sb.motion = b.info.motion;
      if (!b.visible) sb.hidden = true;
      if (off) sb.off = true;
      if (scale !== 1) sb.scale = r(scale);
      out.bodies[id] = sb;
    }
    // (A print under way is saved with its printer and printed again from there.)
    const printingCopies = new Set([...this.printers.values()].map((p) => p.job?.copy).filter((x): x is string => !!x));
    for (const [id, c] of this.made) if (!c.atStart && !this.gone.has(id) && !printingCopies.has(id)) out.copies.push([c.template, c.n, c.at.map((x) => r(x)) as Q3]);
    for (const id of this.printing.keys()) delete out.bodies[id];
    const printers: NonNullable<SavedScene['printers']> = {};
    for (const [id, p] of this.printers) {
      const job = p.job && !p.job.atStart ? ([p.job.template, p.job.n, r(p.job.t)] as [string, number, number]) : undefined;
      if (job) printers[id] = { job };
    }
    if (Object.keys(printers).length) out.printers = printers;
    // (Parts of copies the start blocks make again count; other copies taken away are simply not made again.)
    const again = new Set<string>();
    for (const c of this.made.values()) if (c.atStart) for (const x of c.parts) again.add(x);
    for (const id of this.gone) if (!this.copyOf.has(id) || again.has(id)) out.removed.push(id);
    for (const n of this.npcs.values()) out.npcs[n.id] = { at: [r(n.feet.x), r(n.feet.y), r(n.feet.z)], yaw: r(n.yaw, 1e4), health: n.alive ? n.health : 0 };
    const p = this.player;
    if (withPlayer && p) {
      const f = p.feetPosition;
      out.player = { at: [r(f.x), r(f.y), r(f.z)], yaw: r(p.input.yaw, 1e4), pitch: r(p.input.pitch, 1e4), health: this.health, armour: this.armour, score: this.score, slot: this.slot };
    }
    const lights: Record<string, boolean> = {};
    for (const [id, l] of this.lights) {
      const e = this.doc.get(this.copyOf.get(id) ?? id);
      if (e && l.on !== (readComponent<LightData>('light', e.components.light).on !== false)) lights[id] = l.on;
    }
    if (Object.keys(lights).length) out.lights = lights;
    const broken: Record<string, number> = {};
    for (const [id, h] of this.breakHealth) {
      const e = this.doc.get(this.copyOf.get(id) ?? id);
      if (e && h !== readComponent<BreakableData>('breakable', e.components.breakable).health) broken[id] = h;
    }
    if (Object.keys(broken).length) out.broken = broken;
    const signs: Record<string, string> = {};
    for (const [id, text] of this.signs) {
      const e = this.doc.get(this.copyOf.get(id) ?? id);
      if (e && text !== String((e.components.sign as { text?: unknown } | undefined)?.text ?? '')) signs[id] = text;
    }
    if (Object.keys(signs).length) out.signs = signs;
    const posters: Record<string, boolean> = {};
    for (const [id, p] of this.posters) if (!this.gone.has(id) && p.hung !== p.data.hungAtStart) posters[id] = p.hung;
    if (Object.keys(posters).length) out.posters = posters;
    const stakes = [...this.stakes].filter(([id, k]) => k.stuck && !this.gone.has(id)).map(([id]) => id);
    if (stakes.length) out.stakes = stakes;
    const power = this.savePower();
    if (power) out.power = power;
    const shelves: Record<string, boolean> = {};
    for (const [id, sh] of this.shelves) if (!this.gone.has(id) && sh.mounted !== sh.atStart) shelves[id] = sh.mounted;
    if (Object.keys(shelves).length) out.shelves = shelves;
    const scripts = this.runner.saveState();
    if (Object.keys(scripts).length) out.scripts = scripts;
    // (What scripts set lands where it was going: a fade halfway is saved finished.)
    const lightSet: NonNullable<SavedScene['lightSet']> = {};
    for (const [id, l] of this.lights) {
      const set: NonNullable<SavedScene['lightSet']>[string] = {};
      for (const k of ['intensity', 'range', 'angle', 'color'] as const) if (l[k].from !== null) set[k] = l[k].to.map((x) => r(x));
      if (Object.keys(set).length) lightSet[id] = set;
    }
    if (Object.keys(lightSet).length) out.lightSet = lightSet;
    const glows: Record<string, number> = {};
    for (const [id, g] of this.glows) glows[id] = r(g.to[0] ?? 0);
    if (Object.keys(glows).length) out.glows = glows;
    const sides: Record<string, NpcData['side']> = {};
    for (const n of this.npcs.values()) {
      const e = this.doc.get(this.copyOf.get(n.id) ?? n.id);
      if (e && n.data.side !== readComponent<NpcData>('npc', e.components.npc).side) sides[n.id] = n.data.side;
    }
    if (Object.keys(sides).length) out.sides = sides;
    out.ui = { shown: [...this.uiShown], hidden: [...this.uiHidden], text: Object.fromEntries(this.uiText), rows: Object.fromEntries(this.uiRows) };
    const trainsAt: NonNullable<SavedScene['trains']> = {};
    for (const t of this.trains) {
      const b = this.bodies.get(t.id);
      if (!b) continue;
      const p = b.body.translation(), q = b.body.rotation();
      trainsAt[t.id] = { p: [r(p.x), r(p.y), r(p.z)], q: [r(q.x, 1e6), r(q.y, 1e6), r(q.z, 1e6), r(q.w, 1e6)], at: t.at, to: t.to, moving: t.moving };
    }
    if (Object.keys(trainsAt).length) out.trains = trainsAt;
    if (this.stoppedSounds.size) out.stoppedSounds = [...this.stoppedSounds];
    if (this.silent) out.silent = true;
    if (this.savingBlocked) out.noSaving = true;
    return out;
  }

  /** Put a saved scene back: copies made again, everything where it was, and (`withPlayer`) the player. */
  private loadScene(save: SavedScene, withPlayer: boolean): void {
    if (!save || save.v !== 1) return;
    const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
    const v3 = (a: unknown): Q3 | null => (Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (a as Q3) : null);
    for (const c of Array.isArray(save.copies) ? save.copies : []) {
      const [template, n, at] = Array.isArray(c) ? c : [];
      const p = v3(at);
      if (typeof template !== 'string' || !this.doc.get(template) || !p || !Number.isInteger(n) || n! < 1 || this.names.has(`${template}#${n}`)) continue;
      const id = this.makeCopy(template, p, n);
      this.made.get(id)!.atStart = false;
      this.restoredCopies = Math.max(this.restoredCopies, n!);
    }
    // (The start blocks number their copies from 1 again, as they did when the game was saved.)
    this.copies = 0;
    // (Changes to what the start blocks make wait for them; the rest are put back now.)
    const bodies = save.bodies && typeof save.bodies === 'object' ? save.bodies : {};
    const later: Record<string, SavedBody> = {};
    for (const [id, sb] of Object.entries(bodies)) if (!this.restoreBody(id, sb)) later[id] = sb;
    // (Junk and carpets that were moved settle again where they were put: loose until they lie still.)
    for (const id of this.junky) if (bodies[id]) this.bodies.get(id)?.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.waiting = { bodies: later, removed: Array.isArray(save.removed) ? save.removed.filter((x): x is string => typeof x === 'string') : [] };
    for (const [id, st] of Object.entries(save.npcs ?? {})) {
      const n = this.npcs.get(id), at = v3(st?.at);
      if (n && at) n.restore({ x: at[0], y: at[1], z: at[2] }, num(st.yaw, n.yaw), num(st.health, n.health));
    }
    for (const [id, on] of Object.entries(save.lights ?? {})) {
      const l = this.lights.get(id);
      if (l && typeof on === 'boolean') l.on = on;
    }
    for (const [id, h] of Object.entries(save.broken ?? {})) if (this.breakHealth.has(id) && typeof h === 'number') this.breakHealth.set(id, Math.max(0, h));
    for (const [id, text] of Object.entries(save.signs ?? {}))
      if (this.signs.has(id) && typeof text === 'string') {
        this.signs.set(id, text);
        this.signVersion++;
      }
    for (const [id, hung] of Object.entries(save.posters ?? {})) if (typeof hung === 'boolean') this.setPosterHung(id, hung);
    for (const [id, s] of Object.entries(save.printers && typeof save.printers === 'object' ? save.printers : {})) {
      const p = this.printers.get(id);
      if (!p || !s || typeof s !== 'object') continue;
      const [template, n, t] = Array.isArray(s.job) ? s.job : [];
      if (typeof template === 'string' && this.doc.get(template) && Number.isInteger(n) && n! >= 1 && !this.names.has(`${template}#${n}`)) {
        this.startPrint(id, template, n, num(t));
        this.made.get(p.job!.copy)!.atStart = false;
        p.job!.atStart = false;
        this.restoredCopies = Math.max(this.restoredCopies, n!);
      }
    }
    if (save.power && typeof save.power === 'object') this.loadPower(save.power);
    for (const [id, m] of Object.entries(save.shelves ?? {})) if (typeof m === 'boolean') this.setShelfMounted(id, m);
    for (const id of Array.isArray(save.stakes) ? save.stakes : []) {
      const k = this.stakes.get(id), b = this.bodies.get(id);
      if (!k || !b || k.stuck) continue;
      k.stuck = true;
      b.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    }
    if (save.spent && typeof save.spent === 'object') this.runner.loadState(Object.fromEntries(Object.entries(save.spent).map(([o, spent]) => [o, { spent }])));
    if (save.scripts && typeof save.scripts === 'object') this.runner.loadState(save.scripts);
    const nums = (a: unknown) => (Array.isArray(a) && a.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (a as number[]) : null);
    for (const [id, set] of Object.entries(save.lightSet ?? {})) {
      const l = this.lights.get(id);
      if (!l || !set) continue;
      for (const k of ['intensity', 'range', 'angle', 'color'] as const) {
        const to = nums(set[k]);
        if (to && to.length === l[k].to.length) l[k] = { from: [...to], to, t0: 0, t1: 0 };
      }
    }
    for (const [id, g] of Object.entries(save.glows ?? {})) if (typeof g === 'number') this.glows.set(id, { from: [g], to: [g], t0: 0, t1: 0 });
    for (const [id, side] of Object.entries(save.sides ?? {})) if (side === 'hostile' || side === 'friendly' || side === 'neutral') this.npcs.get(id)?.setSide(side);
    if (save.ui && typeof save.ui === 'object') {
      const strs = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
      this.uiShown = new Set(strs(save.ui.shown));
      this.uiHidden = new Set(strs(save.ui.hidden));
      this.uiText = new Map(Object.entries(save.ui.text ?? {}).filter(([, v]) => typeof v === 'string'));
      this.uiRows = new Map(Object.entries(save.ui.rows ?? {}).map(([k, v]) => [k, strs(v)]));
    }
    for (const [id, st] of Object.entries(save.trains ?? {})) {
      const t = this.trains.find((x) => x.id === id), b = this.bodies.get(id), p = v3(st?.p), q = nums(st?.q);
      if (!t || !b || !p || !q || q.length !== 4) continue;
      b.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
      b.body.setRotation({ x: q[0]!, y: q[1]!, z: q[2]!, w: q[3]! }, true);
      const stop = (s: unknown) => (typeof s === 'string' && this.pathPoints.has(s) ? s : null);
      [t.at, t.to, t.moving] = [stop(st.at), stop(st.to), !!st.moving && stop(st.to) !== null];
    }
    this.stoppedSounds = new Set(Array.isArray(save.stoppedSounds) ? save.stoppedSounds.filter((x): x is string => typeof x === 'string') : []);
    this.silent = save.silent === true;
    this.savingBlocked = save.noSaving === true;
    if (typeof save.hour === 'number' && Number.isFinite(save.hour)) this.dayHour = ((save.hour % 24) + 24) % 24;
    const pl = save.player, p = this.player, at = v3(pl?.at);
    if (withPlayer && p && pl && at) {
      p.teleport({ x: at[0], y: at[1], z: at[2] }, num(pl.yaw, p.input.yaw));
      p.input.pitch = num(pl.pitch);
      this.health = Math.max(1, Math.min(PLAYER.maxHealth, num(pl.health, this.health)));
      this.armour = Math.max(0, Math.min(MAX_ARMOUR, num(pl.armour)));
      this.score = num(pl.score, this.score);
      if (typeof pl.slot === 'number') this.slot = Math.max(0, Math.round(pl.slot));
    }
  }

  /** Put one object back as it was saved (false: there is no such object yet). */
  private restoreBody(id: string, sb: SavedBody): boolean {
    const b = this.bodies.get(id);
    if (!b || b.info.kind === 'zone') return false;
    const p = Array.isArray(sb?.p) && sb.p.length === 3 && sb.p.every(Number.isFinite) ? sb.p : null;
    const q0 = Array.isArray(sb?.q) && sb.q.length === 4 && sb.q.every(Number.isFinite) ? sb.q : null;
    const motion = sb?.motion;
    if (motion && motion !== b.info.motion) {
      if (motion === 'dynamic') {
        if (b.rb) {
          b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          b.info.motion = 'dynamic';
        } else this.makePhysical(b);
      } else if (motion === 'kinematic' || motion === 'fixed') {
        b.body.setBodyType(motion === 'kinematic' ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Fixed, true);
        b.info.motion = motion;
      }
    }
    // (Moved, but it started as still: it is drawn as something that moves.)
    if (p && b.info.motion === 'fixed' && b.startMotion === 'fixed') {
      const s = b.start.p;
      if (Math.abs(p[0] - s[0]) + Math.abs(p[1] - s[1]) + Math.abs(p[2] - s[2]) > 0.01) {
        b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        b.info.motion = 'kinematic';
      }
    }
    if (p && q0) {
      const len = Math.hypot(...q0) || 1;
      const q = { x: q0[0] / len, y: q0[1] / len, z: q0[2] / len, w: q0[3] / len };
      const t = { x: p[0], y: p[1], z: p[2] };
      b.body.setTranslation(t, true);
      b.body.setRotation(q, true);
      if (b.body.isKinematic()) {
        b.body.setNextKinematicTranslation(t);
        b.body.setNextKinematicRotation(q);
      }
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (typeof sb?.scale === 'number' && Number.isFinite(sb.scale) && sb.scale > 0 && sb.scale !== 1) {
      b.scale = sb.scale;
      this.rebuildColliders(b);
    }
    if (sb?.hidden) b.visible = false;
    if (sb?.off) this.switched.set(id, false);
    if (sb?.hidden || sb?.off) this.setColliders(b, false);
    return true;
  }

  /** After the start blocks: what they made again goes back as it was saved, and what was taken away goes. */
  private restoreAfterStart(): void {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    this.copies = Math.max(this.copies, this.restoredCopies);
    for (const [id, sb] of Object.entries(w.bodies)) this.restoreBody(id, sb);
    for (const id of w.removed) if (this.parentOf.has(id) && !this.gone.has(id)) this.remove(id);
  }

  // ── Screen UI and the inventory (B5) ──
  private ui!: UiSettings;
  /** Screens shown now, elements hidden now, and texts scripts changed. */
  private uiShown = new Set<string>();
  private uiHidden = new Set<string>();
  private uiText = new Map<string, string>();
  /** The rows of every list that has its own rows (scripts add and remove them). */
  private uiRows = new Map<string, string[]>();
  /** What the player carries, in the order it was first picked up (the hotbar's order). */
  private inventory = new Map<string, number>();
  /** The hotbar slot the player has picked. */
  private slot = 0;
  /** Weapons and their projectiles; when the weapon in hand can fire again; whether fire was held last step. */
  readonly weapons: Weapons;
  private nextShotAt = 0;
  private fireHeld = false;
  private fireQueued = false;
  /** Lights while playing: on or off, and their settings (scripts change them, maybe over some seconds). */
  private lights = new Map<string, LiveLight>();
  /** The time of day (hours) and how many hours pass each second (0: it stands still). */
  dayHour = 12;
  private hoursPerSecond = 0;
  /** The day count (up by one each midnight) and the one the game starts on. */
  day = 1;
  private firstDay = 1;
  private dayOn = false;
  private showDay = false;
  private showClock = false;
  /** The game starts on its first day (not a saved or carried one): “When day n starts” runs for it. */
  private dayFresh = true;
  /** Models' glow set by scripts (from null: from how the model was made). */
  private glows = new Map<string, Fade>();
  /** Objects scripts turned on (true) or off (false), by body. */
  private switched = new Map<string, boolean>();
  private pathPoints = new Map<string, { p: [number, number, number]; data: PathPointData }>();
  /** Creatures, by object id. */
  private npcs = new Map<string, Npc>();
  private npcEntities: EntityData[] = [];
  private trains: { id: string; data: TrainData; at: string | null; to: string | null; speed: number; moving: boolean; waitUntil: number }[] = [];

  /** Model triangles by file (see `create`). */
  private models: Map<string, ModelMesh>;
  private terrains: Map<string, ModelMesh[]>;
  private trunks: Map<string, { width: number; height: number }>;

  private constructor(scene: SceneFile, rules: GameRules, values: GameValueDef[], models: Map<string, ModelMesh>, terrains: Map<string, ModelMesh[]>, trunks: Map<string, { width: number; height: number }>, navBuilder?: NavBuilder) {
    this.models = models;
    this.terrains = terrains;
    this.trunks = trunks;
    this.ui = uiOf(scene.settings);
    for (const sc of this.ui.screens) {
      if (sc.shownAtStart) this.uiShown.add(sc.id);
      for (const e of sc.elements) {
        if (!e.visible) this.uiHidden.add(e.id);
        if (e.kind === 'list' && e.source === 'rows') this.uiRows.set(e.id, [...e.rows]);
      }
    }
    this.rules = rules;
    this.valueDefs = values;
    for (const v of values) this.globals.set(v.name, v.initial);
    // Repeat groups (ladders, railings …) built out into their copies first.
    const doc = new SceneDoc(parkAssets(expandRepeats(structuredClone(scene), boundsOfEntity), boundsOfEntity));
    this.doc = doc;
    this.world = new RAPIER.World({ x: 0, y: -(doc.settings.gravity ?? 800), z: 0 });
    this.world.lengthUnit = UNITS_PER_METRE;
    this.world.timestep = STEP;

    const shown = (e: EntityData) => {
      for (let x: EntityData | undefined = e; x; x = x.parent ? doc.get(x.parent) : undefined) if (!x.visible) return false;
      return true;
    };
    for (const e of doc.entities) {
      this.names.set(e.id, e.name);
      this.parentOf.set(e.id, e.parent);
    }
    this.names.set('player', 'The player');

    // Scripts (decision S1): every visible object with a Script component.
    const objects = new Map(doc.entities.map((e) => [e.id, { name: e.name, isZone: !!e.components.trigger }]));
    for (const e of doc.entities) if (e.components.sign) this.signs.set(e.id, String((e.components.sign as { text?: unknown }).text ?? ''));
    for (const e of doc.entities) {
      if (!e.components.light || !shown(e)) continue;
      const l = readComponent<LightData>('light', e.components.light);
      const still = (v: number[]): Fade => ({ from: v, to: v, t0: 0, t1: 0 });
      this.lights.set(e.id, { on: l.on !== false, intensity: still([l.intensity]), range: still([l.range]), angle: still([l.angle]), color: still(rgbOf(l.color)) });
    }
    const day = dayOf(doc.settings);
    this.dayHour = (((day.startHour % 24) + 24) % 24);
    this.hoursPerSecond = day.enabled && day.minutes > 0 ? 24 / (day.minutes * 60) : 0;
    this.day = this.firstDay = Math.max(0, Math.round(day.startDay));
    this.dayOn = day.enabled;
    this.showDay = day.showDay;
    this.showClock = !!day.showClock;
    for (const e of doc.entities) {
      if (!e.components.printer || !shown(e)) continue;
      const data = readComponent<PrinterData>('printer', e.components.printer);
      this.printers.set(e.id, { data, job: null });
    }
    const info = { objects, rules, globals: values.map((v) => ({ name: v.name, type: v.type })), signs: new Set(this.signs.keys()), lights: new Set(this.lights.keys()), printers: new Set(this.printers.keys()) };
    this.scriptInfo = info;
    const programs: Program[] = [];
    const scripts: [string, Script][] = [];
    for (const e of doc.entities) {
      const script = e.components.script as unknown as Script | undefined;
      if (!script?.handlers || !shown(e)) continue;
      const r = compileScript(e.id, script, info);
      programs.push(r.program);
      scripts.push([e.id, script]);
      this.scriptProblems.push(...r.problems);
    }
    // The screens' own script (edited in the Screens workspace).
    const uiScript = uiOf(doc.settings).script as Script | undefined;
    if (uiScript?.handlers?.length) {
      const r = compileScript(UI_SCRIPT_OWNER, uiScript, info);
      programs.push(r.program);
      scripts.push([UI_SCRIPT_OWNER, uiScript]);
      this.scriptProblems.push(...r.problems);
      this.names.set(UI_SCRIPT_OWNER, 'Screens');
    }

    // Objects scripts move or switch become "units": one body for the object and everything inside it.
    // (Water and ladders stay where they are: they are zones, not something that moves.)
    const own = (e: EntityData) => !!e.components.rigidBody || !!e.components.trigger || !!e.components.water || !!e.components.ladder || !!e.components.levelChange || !!e.components.npc || !!e.components.soundArea;
    // (Breakable objects too: they disappear when they break.)
    const breakables = doc.entities.filter((e) => e.components.breakable && shown(e)).map((e) => e.id);
    for (const e of doc.entities) {
      if (!e.components.charger || !shown(e)) continue;
      const data = readComponent<ChargerData>('charger', e.components.charger);
      this.chargers.set(e.id, { data, left: data.capacity });
    }
    for (const id of breakables) this.breakHealth.set(id, readComponent<BreakableData>('breakable', doc.get(id)!.components.breakable).health);
    // (Trains too: they move as one along their path.)
    const trainIds = doc.entities.filter((e) => e.components.train && shown(e)).map((e) => e.id);
    // (A light inside a physics object rides with it rather than becoming a unit of its own.)
    const inBody = (id: string) => {
      for (let p = doc.get(id)?.parent; p; p = doc.get(p)?.parent ?? null) if (doc.get(p)?.components.rigidBody) return true;
      return false;
    };
    const targets = [...new Set([...scriptTargets(scripts), ...breakables, ...trainIds])].filter((id) => doc.get(id) && !own(doc.get(id)!) && !(doc.get(id)!.components.light && inBody(id)));
    const unitRoots = targets.filter((id) => !targets.some((o) => o !== id && doc.isAncestor(o, id)));
    const unitOf = this.unitOf;
    for (const root of unitRoots) for (const e of doc.subtree(root)) if (!own(e) || e.id === root) unitOf.set(e.id, root);
    const unitBrushes = new Map<string, Brush[]>(unitRoots.map((r) => [r, []]));
    const unitPoints = new Map<string, UnitPoint[]>(unitRoots.map((r) => [r, []]));
    const scriptedZones = new Set(scriptTargets(scripts).filter((id) => doc.get(id)?.components.trigger));

    const level: WorldBrush[] = [];
    const conveyors = new Map<string, ConveyorData>();
    // COL brushes that stay put (convex, no Physics, not moved by scripts): what lies wholly inside one of them
    // collides as the COL only (no collider of its own).
    this.colVolumes = [];
    for (const e of doc.entities) {
      const d = e.components.brush as unknown as BrushData | undefined;
      if (!shown(e) || !d?.faces || d.mesh || e.components.rigidBody || unitOf.has(e.id) || e.components.trigger || e.components.water || e.components.ladder || e.components.levelChange || e.components.soundArea) continue;
      const b = brushToWorld(fromData({ faces: d.faces }), doc.worldMatrix(e.id));
      if (b.faces.length && b.faces.every((f) => f.surface.material === COLLIDER_MATERIAL)) this.colVolumes.push(b.faces.map((f) => f.plane));
    }
    this.covered = new Set();
    for (const e of doc.entities) {
      if (!shown(e)) continue;
      const brushData = e.components.brush as unknown as (BrushData & { role?: string }) | undefined;
      if (brushData?.faces) {
        const brush = brushToWorld(fromData({ faces: brushData.faces, mesh: brushData.mesh }), doc.worldMatrix(e.id));
        // (A Sound area is heard, not touched: also a trigger zone when it has one, never part of the level.)
        if (e.components.soundArea) this.addSoundArea(e, brush);
        if (e.components.soundArea && !e.components.trigger) continue;
        if (e.components.levelChange) this.addLevelZone(e, brush);
        else if (e.components.ladder || e.components.water) this.addVolume(e, brush);
        else if (e.components.trigger) this.addTrigger(e, brush, scriptedZones.has(e.id));
        else if (e.components.rigidBody) this.addBrushBody(e, brush);
        else if (unitOf.has(e.id) && brushData.role !== 'subtract') unitBrushes.get(unitOf.get(e.id)!)!.push(brush);
        // (NOGRASS brushes only clear grass: nothing to collide with.)
        else if (!isNoGrassBrush(brush)) {
          if (brushData.role !== 'subtract' && !brush.faces.every((f) => f.surface.material === COLLIDER_MATERIAL) && this.insideCol(vertices(brush))) this.covered.add(e.id);
          const only = (e.components.cuts as { only?: string } | undefined)?.only;
          level.push({ id: e.id, role: brushData.role === 'subtract' ? 'subtract' : 'solid', brush, ...(only !== undefined ? { cuts: only ? only.split(',') : [] } : {}) });
        }
        if (e.components.conveyor && !unitOf.has(e.id)) conveyors.set(e.id, readComponent<ConveyorData>('conveyor', e.components.conveyor));
      } else if (e.components.terrain) {
        this.addTerrain(e.id, doc.worldMatrix(e.id));
      } else if (e.components.plant && this.trunks.has(e.id)) {
        // A tree's trunk: a fixed box from the ground up (the crown is walked under, not into).
        const t = this.trunks.get(e.id)!, m = doc.worldMatrix(e.id);
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(m[12]!, m[13]! + t.height / 2, m[14]!));
        const c = this.world.createCollider(RAPIER.ColliderDesc.cuboid(t.width / 2, t.height / 2, t.width / 2).setFriction(0.6), body);
        this.owner.set(c.handle, e.id);
        this.grow({ min: [m[12]! - t.width, m[13]!, m[14]! - t.width], max: [m[12]! + t.width, m[13]! + t.height, m[14]! + t.width] });
      } else if (e.components.npc) {
        this.npcEntities.push(e);
      } else if (e.components.poster) {
        this.addPoster(e, doc.worldMatrix(e.id));
      } else if (unitOf.has(e.id)) {
        // (A model or Collision shape moved by scripts collides as part of its unit.)
        if (e.components.model || e.components.collider) unitPoints.get(unitOf.get(e.id)!)!.push({ e, id: e.id, world: doc.worldMatrix(e.id) });
      } else if (e.components.rigidBody || e.components.collider || this.modelShape(e)) {
        // (A Collision shape or a colliding model without Physics stays put.)
        this.addPointBody(e, doc.worldMatrix(e.id));
      }
    }
    this.addLevel(level, conveyors);
    for (const e of doc.entities) {
      if (e.components.powerSource) this.grid.sources.set(e.id, readComponent<PowerSourceData>('powerSource', e.components.powerSource).on);
      if (e.components.outlet) {
        const o = readComponent<OutletData>('outlet', e.components.outlet);
        this.grid.outlets.set(e.id, o.source);
        this.socketsOf.set(e.id, { pts: validPoints(o.sockets), normal: [0, 0, 1], up: [0, 1, 0] });
      }
    }
    this.sourcesAtStart = new Map(this.grid.sources);
    // Point objects inside a physics object (a light, a model, an emitter) ride with it.
    for (const e of doc.entities) {
      if (unitOf.has(e.id) || this.bodies.has(e.id) || own(e) || e.components.brush) continue;
      for (let p = e.parent; p; p = doc.get(p)?.parent ?? null) {
        const b = this.bodies.get(p);
        if (!b) continue;
        if (b.info.kind === 'point' || b.info.kind === 'brush') unitOf.set(e.id, p);
        break;
      }
    }
    for (const b of level) {
      const bb = bounds(b.brush);
      if (bb) this.grow(bb);
    }
    this.levelIds = new Set(level.map((b) => b.id));
    // A unit turns around its pivot (the centre of what it holds unless one was set).
    const boundsOf = (x: EntityData) => {
      const d = x.components.brush as unknown as BrushData | undefined;
      return d?.faces ? bounds(fromData({ faces: d.faces, mesh: d.mesh })) : null;
    };
    for (const root of unitRoots) this.addUnit(root, doc.worldMatrix(root), unitBrushes.get(root)!, pivotOf(doc, root, boundsOf), unitPoints.get(root)!);

    // Paths and the trains on them, at their first points.
    for (const e of doc.entities) {
      if (!e.components.pathPoint) continue;
      const m = doc.worldMatrix(e.id);
      this.pathPoints.set(e.id, { p: [m[12]!, m[13]!, m[14]!], data: readComponent<PathPointData>('pathPoint', e.components.pathPoint) });
    }
    for (const id of trainIds) this.addTrain(id, readComponent<TrainData>('train', doc.get(id)!.components.train));

    // Creatures, where they stand, facing the way they face.
    for (const e of this.npcEntities) {
      const m = doc.worldMatrix(e.id);
      const npc = new Npc(this.npcWorld(), e.id, readComponent<NpcData>('npc', e.components.npc), { x: m[12]!, y: m[13]!, z: m[14]! }, Math.atan2(m[8]!, m[10]!));
      this.owner.set(npc.collider.handle, e.id);
      this.npcs.set(e.id, npc);
    }
    for (const e of doc.entities) if (e.components.hidingSpot) this.spots.set(e.id, readComponent<HidingSpotData>('hidingSpot', e.components.hidingSpot));
    // Seats work like hiding spots that don't hide.
    for (const e of doc.entities)
      if (e.components.seat && !e.components.hidingSpot) {
        this.spots.set(e.id, { ...readComponent<HidingSpotData>('seat', e.components.seat), kind: 'other' });
        this.seats.add(e.id);
      }
    for (const id of this.spots.keys()) this.spotReach = Math.max(this.spotReach, this.reachOf(id));
    // Measured now (while loading) rather than on the first creature's first walk.
    if (this.npcs.size) {
      if (navBuilder) this.navigationElsewhere(navBuilder);
      else this.navigation();
    }

    // The player: at the first visible Player start, facing the way it faces.
    const spawn = doc.entities.find((e) => e.components.playerSpawn && shown(e));
    if (spawn) {
      const m = doc.worldMatrix(spawn.id);
      const yaw = Math.atan2(m[8]!, m[10]!);
      const p = new Player(this.world, { x: m[12]!, y: m[13]!, z: m[14]! }, yaw, doc.settings.gravity ?? 800);
      p.tires = rules.stamina;
      this.owner.set(p.collider.handle, 'player');
      p.beltOf = (h) => this.belts.get(h) ?? null;
      p.surroundings = {
        // (Plain lookups only: this runs inside the physics engine's own query.)
        // (What's in the player's hands never blocks them.)
        blocks: (c) => !this.isHeld(this.standInOf.get(c.handle) ?? c) && (this.standInOf.has(c.handle) || (!this.triggers.has(c.handle) && !this.standIns.has(c.handle) && !this.volumes.has(c.handle))),
        carry: (h, at) => this.carry(h, at),
        waterTop: (at) => this.waterAt(at)?.top ?? null,
        ladder: (shape, at) => this.ladderAt(shape, at),
      };
      this.player = p;
      let low = m[13]!;
      for (const b of level) for (const v of vertices(b.brush)) low = Math.min(low, v[1]!);
      this.killY = low - 2048;
    }

    this.weapons = new Weapons({
      world: this.world,
      time: () => this.time,
      ownerOf: (h) => this.owner.get(h),
      passes: (c) => this.triggers.has(c.handle) || this.volumes.has(c.handle) || this.standInOf.has(c.handle),
      damage: (target, amount, by, cause) => this.weaponDamage(target, amount, by, cause),
      pushPlayer: (dx, dy, dz) => this.player?.push(dx, dy, dz),
      playerCentre: () => {
        const p = this.player;
        if (!p) return null;
        const t = p.body.translation();
        return [t.x, t.y, t.z];
      },
      announce: (e) => this.bus.emit({ ...e, time: this.time }),
    });
    this.runner = new ScriptRunner(programs, {
      now: () => this.time,
      random: () => this.random(),
      nameOf: (id) => this.names.get(id) ?? id,
      act: (name, target, args) => this.act(name, target, args),
      send: (message, to, from) => {
        this.bus.emit({ type: 'message', name: message, from, time: this.time });
        this.runner.dispatch({ type: 'message', message, to, from });
      },
      log: (text, owner, block) => void this.logs.push({ text, owner, block, time: this.time }),
      game: (name, amount, owner) => {
        if (name === 'addScore') this.addScore(amount);
        else if (name === 'hurt') this.hurt(amount, this.names.get(owner) ?? owner);
        else if (name === 'giveArmour') this.giveArmour(amount);
        else this.heal(amount);
      },
      read: (name) => (name === 'health' ? this.health : name === 'armour' ? this.armour : this.score),
      getGlobal: (name) => this.globals.get(name) ?? null,
      setGlobal: (name, value) => void this.globals.set(name, value),
      say: (text, seconds, from) => this.say(text, seconds, from),
      playSound: (sound, place, volume, owner, loudness = 0) => {
        const at = place === null ? null : this.placePoint(place);
        if (place !== null && !at) return;
        if (at && loudness > 0) this.noise(this.v3(at), loudness, place && typeof place === 'object' && this.spots.has(place.ref as string) ? (place.ref as string) : null);
        const follow = place && typeof place === 'object' && place.ref !== 'player' ? this.bodyOf(place.ref) : null;
        this.bus.emit({ type: 'sound', sound, at, follow, volume, loop: false, range: 2048, source: owner, time: this.time });
      },
      playEffect: (effect, place, follow) => {
        const at = this.placePoint(place);
        if (!at) return;
        const ref = place && typeof place === 'object' ? (place.ref as string) : null;
        const along = !follow || !ref ? null : ref === 'player' ? 'player' : this.bodyOf(ref);
        this.bus.emit({ type: 'vfx', effect, at: [at[0], at[1], at[2]], follow: along, time: this.time });
      },
      print: (template, printer) => this.print(template, printer),
      explode: (place, radius, damage, owner) => {
        const at = this.placePoint(place);
        if (at && radius > 0) this.weapons.explode([at[0], at[1], at[2]], { ...BLAST, blast: radius, damage, push: Math.max(400, radius * 3) }, owner, 'an explosion');
      },
      damageNear: (place, radius, damage, owner) => {
        const at = this.placePoint(place);
        const ref = place && typeof place === 'object' ? (place.ref as string) : null;
        if (at && radius > 0 && damage > 0) this.weapons.hurtNear([at[0], at[1], at[2]], radius, damage, owner, ref ?? undefined);
      },
      noise: (place, loudness, owner) => {
        const at = this.placePoint(place);
        const ref = place && typeof place === 'object' ? place.ref : null;
        if (at) this.noise(this.v3(at), loudness, ref && ref !== 'player' ? ref : this.spots.has(owner) ? owner : null);
      },
      hint: (place, spread, sure, as) => {
        const at = this.placePoint(place);
        if (at) this.hint(this.v3(at), spread, sure, as);
      },
      stopSound: (target) => {
        if (this.doc.get(this.copyOf.get(target) ?? target)?.components.sound) this.stoppedSounds.add(target);
        this.loudSounds.delete(target);
        this.bus.emit({ type: 'sound.stop', source: target, time: this.time });
      },
      playAnimation: (target, name, loop) => this.bus.emit({ type: 'anim', target, name, loop, time: this.time }),
      spawn: (template, place) => this.spawn(template, place),
      held: () => this.held?.id ?? null,
      hiding: () => this.hidingIn !== null && !this.seats.has(this.hidingIn),
      holds: (what) => !!this.held && (what === null || this.heldIds().includes(what)),
      isInside: (zone, what) => this.isInside(zone, what),
      distance: (a, b) => {
        const p = this.placePoint({ ref: a }), q = this.placePoint({ ref: b });
        return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) : null;
      },
      showUi: (what, id, show) => {
        if (what === 'screen') {
          const on = show === 'toggle' ? !this.uiShown.has(id) : show;
          if (on) this.uiShown.add(id);
          else this.uiShown.delete(id);
        } else if (show === 'toggle' ? this.uiHidden.has(id) : show) this.uiHidden.delete(id);
        else this.uiHidden.add(id);
      },
      listRow: (id, text, add) => {
        const rows = this.uiRows.get(id);
        if (!rows) return;
        if (add) rows.push(text);
        else {
          const i = rows.indexOf(text);
          if (i >= 0) rows.splice(i, 1);
        }
      },
      clearList: (id) => void this.uiRows.get(id)?.splice(0),
      clock: () => this.clock(),
      forgetProgress: () => this.forgetProgress(),
      saveGame: () => this.saveNow(),
      blockSaving: (on) => void (this.savingBlocked = on),
      changeScene: (scene, landmark) => this.changeScene(scene, landmark),
      setUiText: (id, text) => void this.uiText.set(id, text),
      giveItem: (name, amount) => this.giveItem(name, amount),
      itemCount: (name) => this.inventory.get(name) ?? 0,
      selectedItem: () => this.selectedItem(),
      setLight: (target, prop, value, seconds) => {
        const l = this.lights.get(target);
        if (!l) return;
        const to = prop === 'color' ? (isHex(String(value)) ? rgbOf(String(value)) : null) : [Math.max(0, Number(value) || 0)];
        if (to) l[prop] = { from: fadeAt(l[prop], this.time), to, t0: this.time, t1: this.time + seconds };
      },
      setGlow: (target, strength, seconds) => {
        const g = this.glows.get(target);
        this.glows.set(target, { from: g ? (g.from === null && this.time < g.t1 ? null : fadeAt(g, this.time)) : null, to: [strength], t0: this.time, t1: this.time + seconds });
      },
      lightOn: (target) => this.lights.get(target)?.on ?? false,
      timeOfDay: () => this.dayHour,
      setTimeOfDay: (h) => this.setHour(h),
      day: () => this.day,
      setDay: (d) => this.setDay(d),
      setText: (target, text) => {
        if (!this.signs.has(target) || this.signs.get(target) === text) return;
        this.signs.set(target, text);
        this.signVersion++;
      },
    });
    this.usesScore = rules.score && scripts.some(([, s]) => /"kind":"(score|addScore)"/.test(JSON.stringify(s.handlers)));
    this.savesWhenAsked = rules.saveMenu || scripts.some(([, s]) => JSON.stringify(s.handlers).includes('"kind":"saveGame"'));
  }

  /** An object moved by scripts: a kinematic body at its place, carrying the hulls of every brush inside it. */
  private addUnit(id: string, world: number[], brushes: Brush[], pivot: [number, number, number], points: UnitPoint[] = [], named = true): void {
    const t = decomposeMat4(world);
    const placement = composeTransform({ position: pivot, rotation: t.rotation, scale: [1, 1, 1] });
    const toLocal = invertRigid(placement);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...pivot).setRotation(quatFromMatrix(placement)));
    for (const b of brushes) {
      const pts = new Float32Array(vertices(b).flatMap((v) => transformPoint(toLocal, v)));
      const desc = hull(pts);
      if (!desc) continue;
      const c = this.world.createCollider(desc.setFriction(0.6), body);
      this.owner.set(c.handle, id);
      this.noteFaces(c, b, body);
    }
    // Models and Collision shapes inside: their shapes, placed on the unit's body. A model with no collision of
    // its own gets a box when it is what scripts name, so it can still be knocked about once it falls and tumbles.
    for (const { e, id: owner, world: m } of points) {
      const p = decomposeMat4(m);
      const scale = p.scale.map(Math.abs) as Q3;
      const rel = multiply(toLocal, composeTransform({ position: p.position, rotation: p.rotation, scale: [1, 1, 1] }));
      const rq = quatFromMatrix(rel);
      const model = this.modelShape(e);
      let descs: RAPIER.ColliderDesc[];
      if (model) descs = modelColliders(model.data, model.mesh, scale, true).map((d) => d.desc);
      else if (e.components.collider) descs = [pointCollider(readComponent<ColliderData>('collider', e.components.collider), scale)];
      else if (named && owner === id) {
        const data = readComponent<ModelData>('model', e.components.model);
        const mesh = data.collision !== 'none' ? this.models.get(data.model) : undefined;
        descs = mesh && mesh.positions.length >= 9 ? modelColliders({ ...data, collision: 'box' }, { ...mesh, parts: undefined }, scale, true).map((d) => d.desc) : [];
      } else descs = [];
      for (const desc of descs) {
        const t = desc.translation, r = desc.rotation;
        desc.setTranslation(...transformPoint(rel, [t.x, t.y, t.z]));
        desc.setRotation(quatMul(rq, r));
        const c = this.world.createCollider(desc.setFriction(0.6), body);
        this.owner.set(c.handle, owner);
      }
    }
    this.track(id, 'unit', 'kinematic', body, brushes);
  }

  /** The level: every plain solid brush (after live subtract) as one fixed body made of convex pieces. */
  private addLevel(brushes: WorldBrush[], conveyors: Map<string, ConveyorData> = new Map()): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const s of buildWorld(brushes).solids) {
      // (Inside a COL brush: the COL does its colliding.)
      if (this.covered.has(s.id)) continue;
      for (const piece of s.pieces) {
        // Edited meshes (G4) may have dents: collide with their actual triangles.
        const desc = piece.mesh ? trimesh(piece) : hull(hullPoints(piece));
        if (!desc) continue;
        desc.setFriction(0.6);
        const c = this.world.createCollider(desc, body);
        this.owner.set(c.handle, s.id);
        this.faceInfo.set(c.handle, { faces: piece.faces, body: null });
        this.stats.staticPieces++;
        const belt = conveyors.get(s.id);
        if (belt) {
          const d = DIRECTIONS[belt.direction] ?? [0, 0, -1];
          this.belts.set(c.handle, { x: d[0] * belt.speed, z: d[2] * belt.speed });
          c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
        }
      }
    }
  }

  private bodyDesc(rb: RigidBodyData): RAPIER.RigidBodyDesc {
    const d = rb.motion === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : rb.motion === 'kinematic' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic();
    if (rb.motion === 'dynamic') {
      d.setGravityScale(rb.gravityScale);
      d.setCcdEnabled(true);
      if (rb.lockRotation) d.lockRotations();
    }
    return d;
  }

  /** `share`: how many colliders the body has (they split its mass). */
  private material(desc: RAPIER.ColliderDesc, rb: RigidBodyData, share = 1): RAPIER.ColliderDesc {
    // An object's own Bounce wins over the floor's, so the Inspector value means what it says.
    desc.setFriction(rb.friction).setRestitution(rb.bounciness).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    if (rb.motion === 'dynamic') desc.setMass(Math.max(0.01, rb.mass) / share);
    return desc;
  }

  /** A brush that moves: its body sits at the brush's centre, the collider is its convex hull. */
  private addBrushBody(e: EntityData, brush: Brush): void {
    const rb = readComponent<RigidBodyData>('rigidBody', e.components.rigidBody);
    const vs = vertices(brush);
    if (vs.length < 4) return;
    const c = [0, 0, 0];
    for (const v of vs) for (let i = 0; i < 3; i++) c[i]! += v[i]! / vs.length;
    const pts = new Float32Array(vs.flatMap((v) => [v[0] - c[0]!, v[1] - c[1]!, v[2] - c[2]!]));
    const desc = hull(pts);
    if (!desc) return;
    const body = this.world.createRigidBody(this.bodyDesc(rb).setTranslation(c[0]!, c[1]!, c[2]!));
    const col = this.world.createCollider(this.material(desc, rb), body);
    this.owner.set(col.handle, e.id);
    this.noteFaces(col, brush, body);
    this.track(e.id, 'brush', rb.motion, body, [brush]);
    this.bodies.get(e.id)!.rb = rb;
  }

  /** The model an object collides by: it has a Model with Collision set, no Collision shape, and the triangles. */
  private modelShape(e: EntityData): { data: ModelData; mesh: ModelMesh } | null {
    if (!e.components.model || e.components.collider) return null;
    const data = readComponent<ModelData>('model', e.components.model);
    // (Junk always collides by its shape: a pile, or the bundle it is packed into.)
    if (e.components.junk && (data.collision === 'auto' || data.collision === 'none')) data.collision = 'hull';
    const mesh = data.collision !== 'none' ? this.models.get(data.model) : undefined;
    if (mesh?.parts?.length) return { data, mesh };
    if (data.collision === 'auto') return null;
    return mesh && mesh.positions.length >= 9 ? { data, mesh } : null;
  }

  /**
   * A collision mesh that its model's animation carries along: `d` is how its node moved from where the file
   * has it (model space, file units; column-major 4×4).
   */
  movePart(id: string, part: number, d: ArrayLike<number>): void {
    const p = this.bodies.get(id)?.parts?.get(part);
    if (!p) return;
    const n = (i: number) => Math.hypot(d[i]!, d[i + 1]!, d[i + 2]!) || 1;
    const a = n(0), b = n(4), c = n(8);
    const q = quatFromMatrix([d[0]! / a, d[1]! / a, d[2]! / a, 0, d[4]! / b, d[5]! / b, d[6]! / b, 0, d[8]! / c, d[9]! / c, d[10]! / c, 0, 0, 0, 0, 1]);
    const r = qrot(q, p.t);
    p.collider.setTranslationWrtParent({ x: r[0] + d[12]! * p.s[0], y: r[1] + d[13]! * p.s[1], z: r[2] + d[14]! * p.s[2] });
    p.collider.setRotationWrtParent(qmul(q, p.q));
  }

  /**
   * A point object (empty, light, model …) with a collision shape: a Collision shape component, or its model's
   * shape. Without Physics it stays put.
   */
  /** A terrain: fixed ground, its surface as triangles (one collider per chunk). */
  private addTerrain(id: string, m: number[]): void {
    const parts = this.terrains.get(id);
    if (!parts?.length) return;
    const t = decomposeMat4(m);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(t.position[0], t.position[1], t.position[2])
        .setRotation(quatFromMatrix(composeTransform({ position: [0, 0, 0], rotation: t.rotation, scale: [1, 1, 1] }))),
    );
    const td = readComponent<TerrainData>('terrain', this.doc.get(id)?.components.terrain);
    const layers = ([0, 1, 2, 3] as const).map((i) => {
      const tex = String(td[`texture${i}`] ?? '');
      return tex ? this.materialSurface(tex) : (['grass', 'dirt', 'stone', 'sand'] as const)[i];
    });
    for (const p of parts) {
      if (p.indices.length < 3) continue;
      const c = this.world.createCollider(RAPIER.ColliderDesc.trimesh(p.positions, p.indices).setFriction(0.8), body);
      this.owner.set(c.handle, id);
      if (p.weights) this.groundInfo.set(c.handle, { indices: p.indices, weights: p.weights, layers });
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.positions.length; i += 3) {
        const w = applyMat4(m, [p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!]);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, w[k]!);
          max[k] = Math.max(max[k]!, w[k]!);
        }
      }
      this.grow({ min, max });
    }
    this.levelIds.add(id);
  }

  private grow(b: { min: number[]; max: number[] }): void {
    const x = (this.extent ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    for (let k = 0; k < 3; k++) {
      x.min[k] = Math.min(x.min[k]!, b.min[k]!);
      x.max[k] = Math.max(x.max[k]!, b.max[k]!);
    }
  }

  /**
   * Where creatures can walk (A2), measured from the level the first time it's asked for (null for an empty
   * level). Fixed pieces count as ground and walls; zones, doors, crates and creatures don't.
   */
  navigation(): NavGrid | null {
    if (this.nav !== undefined) return this.nav;
    // (Being measured elsewhere, and wanted now: measured here instead, from the same picture of the level.)
    if (this.navJob) {
      const job = this.navJob;
      this.navJob = null;
      const level = openNavJob(job);
      try {
        return (this.nav = NavGrid.fromRows([level.rows(0, level.nz)], job.min, job.max, job.opts));
      } finally {
        level.free();
      }
    }
    const x = this.extent;
    if (!x) return (this.nav = null);
    // (Queries only see colliders once the physics has stepped: a step of no time, collecting no events.)
    const dt = this.world.timestep;
    this.world.timestep = 0;
    this.world.step();
    this.world.timestep = dt;
    this.nav = NavGrid.build({ world: this.world, solid: (c) => this.navSolid(c) }, [x.min[0] - 32, x.min[1] - 32, x.min[2] - 32], [x.max[0] + 32, x.max[1] + 32, x.max[2] + 32]);
    return this.nav;
  }

  private navSolid(c: RAPIER.Collider): boolean {
    return !!c.parent()?.isFixed() && !this.triggers.has(c.handle) && !this.volumes.has(c.handle) && !this.standIns.has(c.handle) && !this.standInOf.has(c.handle) && !this.npcs.has(this.owner.get(c.handle) ?? '');
  }

  /** The level as it stands, being measured elsewhere (until the grid is in, or is asked for and measured here). */
  private navJob: NavJob | null = null;
  /**
   * Settles once where creatures can walk is known. A world made with a `navBuilder` must not be stepped before
   * (nothing breaks if it is: the first creature to look for a way has the level measured there and then).
   */
  navReady: Promise<void> = Promise.resolve();

  /**
   * The same grid `navigation()` measures, measured by `builder` (off this thread) from a snapshot of the physics
   * as it stands now. Should that fail, it's measured here when first asked for.
   */
  private navigationElsewhere(builder: NavBuilder): void {
    const x = this.extent;
    if (!x) return void (this.nav = null);
    // (The step of no time `navigation()` takes, taken here all the same: the physics goes on from the same state.)
    const dt = this.world.timestep;
    this.world.timestep = 0;
    this.world.step();
    this.world.timestep = dt;
    const solid: number[] = [];
    this.world.forEachCollider((c) => {
      if (this.navSolid(c)) solid.push(c.handle);
    });
    const job: NavJob = { snapshot: this.world.takeSnapshot(), solid: Float64Array.from(solid), min: [x.min[0] - 32, x.min[1] - 32, x.min[2] - 32], max: [x.max[0] + 32, x.max[1] + 32, x.max[2] + 32] };
    this.navJob = job;
    this.navReady = builder(job).then(
      (bands) => {
        if (this.navJob !== job) return;
        this.navJob = null;
        this.nav = NavGrid.fromRows(bands, job.min, job.max, job.opts);
      },
      () => {},
    );
  }

  private sound: Acoustics | null = null;

  /**
   * How sounds reach the ears through this level (walls, materials, ways round, the room's echo): made the
   * first time it's asked for. Walls, floors, doors and props that stay put stop sound; zones, water, physics
   * objects, creatures and the player don't.
   */
  get acoustics(): Acoustics {
    return (this.sound ??= new Acoustics({
      world: this.world,
      solid: (c) => {
        const b = c.parent();
        if (!b || b.isDynamic()) return false;
        const h = c.handle;
        return !this.triggers.has(h) && !this.volumes.has(h) && !this.standInOf.has(h) && !this.npcs.has(this.owner.get(h) ?? '') && c.handle !== this.player?.collider.handle;
      },
      exclude: () => this.player?.collider,
      surfaceAt: (h, at) => this.surfaceAt(h, at),
      extent: () => this.extent,
    }));
  }

  /** Convex COL brushes that stay put (their planes, in world space). */
  private colVolumes: Plane[][] = [];
  /** Brushes inside one of them: no colliders of their own. */
  private covered = new Set<string>();

  /** Whether every one of these points is inside one and the same COL brush. */
  private insideCol(points: readonly (readonly number[])[]): boolean {
    if (!points.length || !this.colVolumes.length) return false;
    return this.colVolumes.some((planes) => points.every((p) => planes.every((pl) => signedDist(pl, p as [number, number, number]) <= 0.5)));
  }

  private addPointBody(e: EntityData, world: number[]): void {
    const rb = e.components.rigidBody ? readComponent<RigidBodyData>('rigidBody', e.components.rigidBody) : { ...readComponent<RigidBodyData>('rigidBody', {}), motion: 'fixed' as const };
    const t = decomposeMat4(world);
    const scale = t.scale.map(Math.abs) as Q3;
    const model = this.modelShape(e);
    if (rb.motion === 'fixed') {
      const r = model ? 256 * Math.max(...scale) : 64;
      this.grow({ min: [world[12]! - r, world[13]! - r, world[14]! - r], max: [world[12]! + r, world[13]! + r, world[14]! + r] });
    }
    const shape = model ? null : readComponent<ColliderData>('collider', e.components.collider);
    // A model that stays put wholly inside a COL brush: the COL does its colliding.
    const covered = !!model && !e.components.rigidBody && !e.components.collider && this.insideCol(sampled(model.mesh.positions, world));
    const descs = covered ? [] : model ? modelColliders(model.data, model.mesh, scale, rb.motion === 'dynamic') : [{ desc: pointCollider(shape!, scale) }];
    // Body placement: position and rotation only (scale went into the shape).
    const placement = composeTransform({ position: t.position, rotation: t.rotation, scale: [1, 1, 1] });
    const q = quatFromMatrix(placement);
    const body = this.world.createRigidBody(this.bodyDesc(rb).setTranslation(...t.position).setRotation(q));
    const parts = new Map<number, MovingPart>();
    for (const { desc, part } of descs) {
      const col = this.world.createCollider(this.material(desc, rb, descs.length), body);
      this.owner.set(col.handle, e.id);
      if (part !== undefined && model!.mesh.parts![part]!.moves) parts.set(part, movingPart(col, desc, model!.data, scale));
    }
    this.track(e.id, 'point', rb.motion, body);
    const b = this.bodies.get(e.id)!;
    if (parts.size) b.parts = parts;
    if (model) b.model = { ...model, matrix: world };
    else b.shape = { collider: shape!, matrix: world };
    b.rb = rb;
    if (e.components.stake && rb.motion === 'dynamic') this.stakes.set(e.id, { data: readComponent<StakeData>('stake', e.components.stake), stuck: false, free: 0 });
    if (e.components.junk && model && rb.motion === 'dynamic') {
      const packedPath = readComponent<JunkData>('junk', e.components.junk).packed;
      const mesh = packedPath ? this.models.get(packedPath) : undefined;
      if (mesh && mesh.positions.length >= 9) this.junks.set(e.id, { pile: model, packed: { data: { ...model.data, model: packedPath }, mesh }, isPacked: false });
    }
    if (rb.motion === 'dynamic' && e.components.extender) {
      const x = readComponent<ExtenderData>('extender', e.components.extender);
      this.grid.plugs.set(e.id, { cable: x.cable, into: null });
      this.grid.cords.add(e.id);
      this.socketsOf.set(e.id, { pts: validPoints(x.sockets), normal: [0, 1, 0], up: [0, 0, 1] });
      if (x.cableAt && validPoints([x.cableAt]).length) this.cableAt.set(e.id, x.cableAt);
    }
    if (rb.motion === 'dynamic' && e.components.stringLights) {
      const data = readComponent<StringLightsData>('stringLights', e.components.stringLights);
      this.grid.plugs.set(e.id, { cable: data.cable, into: null });
      this.strings.set(e.id, { data, hung: null, half: null, version: 0, out: [0, -1, 0], halfOut: [0, -1, 0] });
    }
    if (rb.motion === 'dynamic' && e.components.shelf) {
      const data = readComponent<ShelfData>('shelf', e.components.shelf);
      this.shelves.set(e.id, { mounted: false, atStart: data.mountedAtStart, back: this.backOf(e, model), normal: [0, 0, 1], clear: true, wallAt: [0, 0, 0] });
      if (data.mountedAtStart) this.setShelfMounted(e.id, true, body);
    }
    // (Junk lying on the floor stays put: nothing pushes it; picking it up frees it.)
    if (e.components.junk && model && rb.motion === 'dynamic') this.junky.add(e.id);
    if (e.components.junk && model && rb.motion === 'dynamic') body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
  }

  // ── Posters and paintings ──

  /** Posters and paintings: whether each is hung on a wall now, its one collider, and the wall's outward normal. */
  private posters = new Map<string, { data: PosterData; rb: RigidBodyData; hung: boolean; collider: RAPIER.Collider; normal: Q3; wallAt: Q3; clear: boolean }>();

  /** A poster or painting: a light physics object, a scroll (rolls) or a flat sheet; hung at start, fixed in place. */
  private addPoster(e: EntityData, world: number[]): void {
    const data = posterOf(e.components);
    const t = decomposeMat4(world);
    const placement = composeTransform({ position: t.position, rotation: t.rotation, scale: [1, 1, 1] });
    const rb: RigidBodyData = { ...readComponent<RigidBodyData>('rigidBody', {}), motion: 'dynamic', mass: Math.min(MAX_CARRY, Math.max(0.01, data.mass)), friction: 0.8, pickUp: true };
    const body = this.world.createRigidBody(this.bodyDesc(rb).setTranslation(...t.position).setRotation(quatFromMatrix(placement)));
    const flat = data.hungAtStart || !data.rolls;
    const col = this.world.createCollider(this.material(posterCollider(data, flat, this.models.get(data.scrollModel)), rb), body);
    this.owner.set(col.handle, e.id);
    // (Always tracked as moving, so it is drawn where it is after it is taken down or hung.)
    this.track(e.id, 'point', 'dynamic', body);
    const b = this.bodies.get(e.id)!;
    b.rb = rb;
    b.poster = { data, matrix: placement };
    const z = applyMat4(placement, [0, 0, 1]);
    const normal: Q3 = [z[0] - t.position[0], z[1] - t.position[1], z[2] - t.position[2]];
    this.posters.set(e.id, { data, rb, hung: false, collider: col, normal, wallAt: t.position, clear: true });
    if (data.hungAtStart) {
      body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
      this.posters.get(e.id)!.hung = true;
    }
  }

  /** Its one collider swapped for the scroll's or the flat sheet's (keeping whether it collides). */
  private posterShape(id: string, flat: boolean): void {
    const p = this.posters.get(id), b = this.bodies.get(id);
    if (!p || !b) return;
    const groups = p.collider.collisionGroups();
    this.owner.delete(p.collider.handle);
    this.world.removeCollider(p.collider, false);
    p.collider = this.world.createCollider(this.material(posterCollider(p.data, flat, this.models.get(p.data.scrollModel)), p.rb).setCollisionGroups(groups), b.body);
    this.owner.set(p.collider.handle, id);
  }

  private isPoster(c: RAPIER.Collider): boolean {
    const id = this.owner.get(c.handle);
    return !!id && this.posters.get(id)?.collider.handle === c.handle;
  }

  /** Whether a poster or painting is hung on a wall now (null: it isn't one). */
  posterHung(id: string): boolean | null {
    return this.posters.get(id)?.hung ?? null;
  }

  /** A poster's or painting's data and where it was placed (for drawing it). */
  posterOf(id: string): { data: PosterData; matrix: number[] } | null {
    return this.bodies.get(id)?.poster ?? null;
  }

  /** Flat against a wall: fixed, the picture (+Z) facing out along `normal`, upright, its back on the wall at `at`. */
  private hangPoster(id: string, at: Q3, normal: Q3): void {
    const p = this.posters.get(id), b = this.bodies.get(id);
    if (!p || !b || p.hung) return;
    if (this.held?.id === id) this.dropHeld();
    const yaw = Math.atan2(normal[0], normal[2]);
    const off = Math.max(0.25, p.data.thickness / 2) + 0.05;
    b.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    b.body.setTranslation({ x: at[0] + normal[0] * off, y: at[1], z: at[2] + normal[2] * off }, false);
    b.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, false);
    if (p.data.rolls) this.posterShape(id, true);
    p.hung = true;
    p.normal = normal;
    p.wallAt = at;
    this.bus.emit({ type: 'poster.hang', target: id, time: this.time });
  }

  /** Hung or loose where it is now (loading a save): no moving, no events; the wall is behind its back (−Z). */
  private setPosterHung(id: string, hung: boolean): void {
    const p = this.posters.get(id), b = this.bodies.get(id);
    if (!p || !b || p.hung === hung) return;
    if (this.held?.id === id) this.dropHeld();
    p.hung = hung;
    if (hung) {
      const q = b.body.rotation(), t = b.body.translation();
      const n = qrot({ x: q.x, y: q.y, z: q.z, w: q.w }, [0, 0, 1]);
      p.normal = [n[0], n[1], n[2]];
      p.wallAt = [t.x, t.y, t.z];
      b.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    } else b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    if (p.data.rolls) this.posterShape(id, hung);
  }

  /** Off the wall: loose again (a poster rolls back up, a little out from the wall so it doesn't catch). */
  private takeDownPoster(id: string): void {
    const p = this.posters.get(id), b = this.bodies.get(id);
    if (!p || !b || !p.hung) return;
    const n = p.normal, t = b.body.translation();
    const out = p.data.rolls ? posterScrollRadius(p.data) + 1 : 1;
    b.body.setTranslation({ x: t.x + n[0] * out, y: t.y + n[1] * out, z: t.z + n[2] * out }, false);
    b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    if (p.data.rolls) this.posterShape(id, false);
    p.hung = false;
    // (Not stuck straight back: first it has to leave the wall.)
    p.clear = false;
    this.bus.emit({ type: 'poster.takeDown', target: id, time: this.time });
  }

  /**
   * After each step: a held poster or painting touching a wall (something fixed, standing up) while the player
   * looks at that wall sticks to it.
   */
  private stickHeld(): void {
    const h = this.held;
    const p = h ? this.posters.get(h.id) : undefined;
    if (!h || !p || p.hung || !this.player) return;
    const look = this.player.lookDirection();
    const c = h.body.translation();
    if (!p.clear) {
      // (Just taken down: it sticks again once it has been pulled away from that wall, or the player looks away.)
      const n = p.normal, w = p.wallAt;
      const away = (c.x - w[0]) * n[0] + (c.y - w[1]) * n[1] + (c.z - w[2]) * n[2];
      if (away < 16 && look[0] * n[0] + look[1] * n[1] + look[2] * n[2] < -0.3) return;
      p.clear = true;
    }
    let wall: { at: Q3; normal: Q3 } | null = null;
    this.world.contactPairsWith(p.collider, (other) => {
      if (wall || other.isSensor() || !other.parent()?.isFixed() || this.triggers.has(other.handle) || this.volumes.has(other.handle)) return;
      let n: { x: number; y: number; z: number } | null = null;
      this.world.contactPair(p.collider, other, (m) => {
        if (!n && m.numContacts() > 0) n = m.normal();
      });
      if (!n) return;
      const nn = n as { x: number; y: number; z: number };
      // (Which way the normal points depends on the pair's order: try both, along the ray that reaches the wall.)
      for (const s of [1, -1]) {
        const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(c, { x: nn.x * s, y: nn.y * s, z: nn.z * s }), 96, true, undefined, undefined, undefined, undefined, (x) => x.handle === other.handle);
        if (!hit) continue;
        const o = hit.normal;
        // A wall (not a floor or a ceiling), and the player is looking at it.
        if (Math.abs(o.y) > 0.5 || look[0] * o.x + look[1] * o.y + look[2] * o.z > -0.3) return;
        const len = Math.hypot(o.x, o.z) || 1;
        const at = { x: c.x + nn.x * s * hit.timeOfImpact, y: c.y + nn.y * s * hit.timeOfImpact, z: c.z + nn.z * s * hit.timeOfImpact };
        wall = { at: [at.x, at.y, at.z], normal: [o.x / len, 0, o.z / len] };
        return;
      }
    });
    if (wall) this.hangPoster(h.id, (wall as { at: Q3 }).at, (wall as { normal: Q3 }).normal);
  }

  // ── Props that stick into the ground ──

  private stakes = new Map<string, { data: StakeData; stuck: boolean; free: number }>();

  /** Whether a prop is stuck in the ground now (null: it can't stick). */
  stakeStuck(id: string): boolean | null {
    return this.stakes.get(id)?.stuck ?? null;
  }

  /** After each step: a prop that hit the ground tip first, fast enough, sticks in. */
  private stickStakes(): void {
    for (const [id, k] of this.stakes) {
      const b = this.bodies.get(id);
      const v0 = b?.v0;
      if (!b || !v0 || k.stuck || !b.body.isDynamic() || this.time < k.free) continue;
      const c = b.body.translation(), r = b.body.rotation();
      const tip = qrot({ x: r.x, y: r.y, z: r.z, w: r.w }, STAKE_TIP[k.data.tip] ?? [0, -1, 0]);
      let ground: { at: Q3; n: Q3; reach: number } | null = null;
      for (let i = 0; i < b.body.numColliders() && !ground; i++) {
        const mine = b.body.collider(i);
        this.world.contactPairsWith(mine, (other) => {
          if (ground || other.isSensor() || !other.parent()?.isFixed() || this.triggers.has(other.handle) || this.volumes.has(other.handle)) return;
          let touching = false;
          this.world.contactPair(mine, other, (m) => {
            if (m.numContacts() > 0) touching = true;
          });
          if (!touching) return;
          const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(c, { x: tip[0], y: tip[1], z: tip[2] }), 512, true, undefined, undefined, undefined, undefined, (x) => x.handle === other.handle);
          if (!hit || hit.normal.y < 0.5) return;
          const n = hit.normal;
          const into = -(v0[0]! * n.x + v0[1]! * n.y + v0[2]! * n.z), lead = -(tip[0] * n.x + tip[1] * n.y + tip[2] * n.z);
          if (into < k.data.speed || lead < 0.6) return;
          const d = hit.timeOfImpact;
          ground = { at: [c.x + tip[0] * d, c.y + tip[1] * d, c.z + tip[2] * d], n: [n.x, n.y, n.z], reach: d };
        });
      }
      if (ground) this.stickStake(id, tip, ground);
    }
  }

  /** In the ground at `at`: tip turned into it, then leaned a little in a random direction. */
  private stickStake(id: string, tip: Q3, g: { at: Q3; n: Q3; reach: number }): void {
    const k = this.stakes.get(id), b = this.bodies.get(id);
    if (!k || !b) return;
    if (this.held?.id === id) this.dropHeld();
    const n = g.n;
    const side = norm3(cross3(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const other = cross3(n, side);
    const turn = Math.random() * Math.PI * 2, lean = ((Math.random() * Math.max(0, k.data.tilt)) * Math.PI) / 180;
    const axis = norm3([side[0] * Math.cos(turn) + other[0] * Math.sin(turn), side[1] * Math.cos(turn) + other[1] * Math.sin(turn), side[2] * Math.cos(turn) + other[2] * Math.sin(turn)]);
    const down: Q3 = [-n[0], -n[1], -n[2]];
    const r = b.body.rotation(), turnBy = qmul(axisAngle(axis, lean), fromTo(tip, down));
    const q = qmul(turnBy, { x: r.x, y: r.y, z: r.z, w: r.w });
    const dir = qrot(turnBy, tip);
    const out = Math.max(0, g.reach - Math.min(k.data.depth, g.reach * 0.9));
    b.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    b.body.setTranslation({ x: g.at[0] - dir[0] * out, y: g.at[1] - dir[1] * out, z: g.at[2] - dir[2] * out }, false);
    b.body.setRotation(q, false);
    k.stuck = true;
    this.bus.emit({ type: 'stake.stick', target: id, time: this.time });
  }

  /** Out of the ground: loose again, lifted clear, and it won't stick again for a moment. */
  private pullStake(id: string): void {
    const k = this.stakes.get(id), b = this.bodies.get(id);
    if (!k || !b || !k.stuck) return;
    const r = b.body.rotation(), c = b.body.translation();
    const tip = qrot({ x: r.x, y: r.y, z: r.z, w: r.w }, STAKE_TIP[k.data.tip] ?? [0, -1, 0]);
    const up = k.data.depth + 1;
    b.body.setTranslation({ x: c.x - tip[0] * up, y: c.y - tip[1] * up, z: c.z - tip[2] * up }, false);
    b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    k.stuck = false;
    k.free = this.time + 0.5;
    this.bus.emit({ type: 'stake.pull', target: id, time: this.time });
  }

  // ── Power: sources, outlets, extension cords and string lights ──

  private grid = new PowerGrid();
  private sourcesAtStart = new Map<string, boolean>();
  /** String lights: their settings, their two ends once hung, the first end while being hung; `version` counts changes. */
  private strings = new Map<string, { data: StringLightsData; hung: [P3, P3] | null; half: P3 | null; version: number; out: P3; halfOut: P3 }>();
  /** Cable shapes, kept while their ends stay put (each frame would mean a dozen rays a cable). */
  private cableShapes = new Map<string, { key: string; points: P3[] }>();

  /** Where an object is now (its body, or where it was placed). */
  private placeOf(id: string): P3 | null {
    const b = this.bodies.get(id);
    if (b) {
      const t = b.body.translation();
      return [t.x, t.y, t.z];
    }
    if (!this.doc.get(id)) return null;
    const m = this.doc.worldMatrix(id);
    return [m[12]!, m[13]!, m[14]!];
  }

  /** Where a plug's cable starts: hung string lights from the end placed last (while hanging: the coil in hand); a cord from where its cable leaves it. */
  private plugAt(id: string): P3 | null {
    const hung = this.strings.get(id)?.hung?.[1];
    if (hung) return hung;
    const at = this.cableAt.get(id);
    return at ? (this.poseOf(id)?.point(at) ?? this.placeOf(id)) : this.placeOf(id);
  }

  /** Sockets: where plugs go on each (its own space), which way they face and which way is up. */
  private socketsOf = new Map<string, { pts: P3[]; normal: P3; up: P3 }>();
  /** Where a cord's cable leaves it (its own space). */
  private cableAt = new Map<string, P3>();

  /** An object as it is now: a point and a direction of its own, in the world. */
  private poseOf(id: string): { point(p: P3): P3; dir(d: P3): P3 } | null {
    const base = id.split('#')[0]!;
    const m = this.doc.get(base) ? this.doc.worldMatrix(base) : null;
    const b = this.bodies.get(id);
    if (b && !b.body.isFixed()) {
      const t = b.body.translation(), r = b.body.rotation();
      const q = { x: r.x, y: r.y, z: r.z, w: r.w };
      const sc = (m ? decomposeMat4(m).scale.map(Math.abs) : [1, 1, 1]).map((v) => v * b.scale);
      return {
        point: (p) => {
          const v = qrot(q, [p[0] * sc[0]!, p[1] * sc[1]!, p[2] * sc[2]!]);
          return [t.x + v[0], t.y + v[1], t.z + v[2]];
        },
        dir: (d) => qrot(q, d),
      };
    }
    if (!m) return null;
    return {
      point: (p) => transformPoint(m, p),
      dir: (d) => {
        const v: P3 = [m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2], m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2], m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2]];
        const l = Math.hypot(...v) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      },
    };
  }

  /** Where a plug sits in its socket: the base of its prongs, the way the socket faces, and up. */
  private socketSpot(socket: string, plug: string): { at: P3; normal: P3; up: P3 } | null {
    const s = this.socketsOf.get(socket), pose = this.poseOf(socket);
    if (!pose) return null;
    if (!s) return { at: pose.point([0, 0, 0]), normal: pose.dir([0, 0, 1]), up: pose.dir([0, 1, 0]) };
    const i = Math.max(0, this.grid.pluggedInto(socket).indexOf(plug));
    return { at: pose.point(s.pts[i % s.pts.length]!), normal: pose.dir(s.normal), up: pose.dir(s.up) };
  }

  /** Where the cable of a plug in a socket ends: the back of the plug. */
  private socketEnd(socket: string, plug: string): P3 | null {
    const s = this.socketSpot(socket, plug);
    return s ? [s.at[0] + s.normal[0] * PLUG_BACK, s.at[1] + s.normal[1] * PLUG_BACK, s.at[2] + s.normal[2] * PLUG_BACK] : null;
  }

  /** Whether a power source is on (null: it isn't one). */
  powerOn(id: string): boolean | null {
    return this.grid.sources.get(id) ?? null;
  }

  /** Whether a socket (an outlet or a cord) is live, or a plug is in a live socket (null: neither). */
  powered(id: string): boolean | null {
    if (this.grid.isSocket(id) && !this.grid.plugs.has(id)) return this.grid.live(id);
    const p = this.grid.plugs.get(id);
    return p ? this.grid.live(p.into) : null;
  }

  /** The socket a plug is in (null: none, or it isn't a plug). */
  pluggedInto(id: string): string | null {
    return this.grid.plugs.get(id)?.into ?? null;
  }

  private switchPower(id: string, on: boolean): void {
    if (!this.grid.sources.has(id) || this.grid.sources.get(id) === on) return;
    this.grid.sources.set(id, on);
    this.bus.emit({ type: 'power.switch', target: id, on, time: this.time });
  }

  private plug(id: string, socket: string): void {
    const p = this.grid.plugs.get(id);
    if (!p || p.into === socket) return;
    if (p.into) this.unplug(id, false);
    p.into = socket;
    this.bus.emit({ type: 'power.plug', target: id, socket, time: this.time });
  }

  private unplug(id: string, pulled: boolean): void {
    const p = this.grid.plugs.get(id);
    if (!p?.into) return;
    const socket = p.into;
    p.into = null;
    this.bus.emit({ type: 'power.unplug', target: id, socket, pulled, time: this.time });
  }

  /** After each step: a plug pulled further than its cable (or whose socket is gone) comes out. */
  private checkCables(): void {
    if (this.plugHand) {
      const st = this.strings.get(this.plugHand), hand = this.handAt(), cable = this.grid.plugs.get(this.plugHand)?.cable ?? 0;
      if (!st?.hung || !hand || this.gone.has(this.plugHand) || dist3(st.hung[1], hand) > cable + 8) this.plugHand = null;
    }
    for (const [id, p] of this.grid.plugs) {
      if (!p.into) continue;
      const a = this.plugAt(id), b = this.placeOf(p.into);
      if (!a || !b || this.gone.has(p.into) || this.gone.has(id) || dist3(a, b) > p.cable + 8) this.unplug(id, true);
    }
  }

  /** The eye, the look direction, and the first solid thing looked at within reach (past what's held). */
  private lookHit(reach: number): { eye: P3; dir: P3; at: P3 | null; n: P3; distance: number; id: string | null } | null {
    const p = this.player;
    if (!p) return null;
    const eye = p.eye() as P3, dir = p.lookDirection() as P3;
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray({ x: eye[0], y: eye[1], z: eye[2] }, { x: dir[0], y: dir[1], z: dir[2] }), reach, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, 0xffffffff, p.collider, undefined, (c) => !this.isHeld(c));
    if (!hit) return { eye, dir, at: null, n: [0, 1, 0], distance: reach, id: null };
    const d = hit.timeOfImpact;
    return { eye, dir, at: [eye[0] + dir[0] * d, eye[1] + dir[1] * d, eye[2] + dir[2] * d], n: [hit.normal.x, hit.normal.y, hit.normal.z], distance: d, id: this.owner.get(hit.collider.handle) ?? null };
  }

  /** The object and what it is part of. */
  private withParents(id: string): string[] {
    const out: string[] = [];
    for (let x: string | null | undefined = id; x; x = this.parentOf.get(x)) out.push(x);
    return out;
  }

  /** Use while holding an extension cord: into a socket looked at (or out of it). The prompt (do: false), or what was done; null: nothing to do with power. */
  private powerHeldUse(act: boolean): string | null {
    const id = this.held!.id;
    if (!this.grid.cords.has(id)) return null;
    return this.plugUse(id, act);
  }

  /** Into the socket looked at (or out of it); null: no socket looked at. */
  private plugUse(id: string, act: boolean): string | null {
    const plug = this.grid.plugs.get(id);
    const look = this.lookHit(PLAYER.useReach);
    if (!plug || !look) return null;
    const socket = look.id ? this.withParents(look.id).find((t) => this.grid.isSocket(t) && t !== id) : undefined;
    if (!socket) return null;
    if (plug.into === socket) {
      if (act) this.unplug(id, false);
      return 'Unplug';
    }
    if (!this.grid.canPlug(id, socket)) return null;
    const from = this.plugAt(id), to = this.placeOf(socket);
    if (!from || !to || dist3(from, to) > plug.cable) return 'Cable too short';
    if (act) this.plug(id, socket);
    return 'Plug in';
  }

  // String lights in hand (F picks a coil up into the hands, or puts it down; the click plugs in and hangs).

  /** The string lights in the player's hands. */
  private equipped: string | null = null;

  /** Which string lights are in the player's hands (null: none). */
  get inHands(): string | null {
    return this.equipped;
  }

  /** F: string lights into the hands (a coil looked at) or put down. The prompt (do: false); null: F does nothing here. */
  private equipKey(act: boolean): string | null {
    if (!this.player || this.hiding || this.frozen) return null;
    if (this.plugHand) {
      if (act) this.plugHand = null;
      return 'Drop plug';
    }
    if (this.equipped) {
      if (act) this.unequip();
      return 'Put down';
    }
    if (this.held && this.strings.has(this.held.id) && !this.strings.get(this.held.id)!.hung) {
      if (act) this.equip(this.held.id);
      return 'Take in hand';
    }
    if (this.held) return null;
    // Hung lights looked at: their plug into the hand (out of its socket).
    const hungAt = this.hungLooked();
    if (hungAt) {
      if (act) {
        this.unplug(hungAt, false);
        this.plugHand = hungAt;
      }
      return 'Take plug';
    }
    const hit = this.useAim();
    const id = hit && hit.distance <= PLAYER.useReach ? hit.targets.find((t) => this.strings.has(t) && !this.strings.get(t)!.hung && !this.gone.has(t)) : undefined;
    if (!id) return null;
    if (act) this.equip(id);
    return 'Pick up';
  }

  private equip(id: string): void {
    const b = this.bodies.get(id);
    if (!b) return;
    if (this.held?.id === id) this.dropHeld();
    if (this.equipped) this.unequip();
    this.equipped = id;
    b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    b.visible = true;
    this.setColliders(b, false);
    this.carryEquipped(true);
    this.bus.emit({ type: 'pickup', target: id, by: 'player', time: this.time });
  }

  /** Down in front of the player (a hanging begun is let go). */
  private unequip(): void {
    const id = this.equipped, b = id ? this.bodies.get(id) : undefined, p = this.player;
    this.equipped = null;
    if (!id || !b) return;
    const st = this.strings.get(id);
    if (st?.half) {
      st.half = null;
      st.version++;
    }
    if (p) {
      const eye = p.eye(), d = p.lookDirection();
      const flat = Math.hypot(d[0], d[2]) || 1;
      const dir = { x: d[0] / flat, y: 0, z: d[2] / flat };
      const wall = this.world.castRay(new RAPIER.Ray({ x: eye[0], y: eye[1] - 24, z: eye[2] }, dir), 32, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, 0xffffffff, p.collider);
      const k = Math.max(4, (wall ? wall.timeOfImpact : 32) - 10);
      b.body.setTranslation({ x: eye[0] + dir.x * k, y: eye[1] - 24, z: eye[2] + dir.z * k }, true);
    }
    b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.setColliders(b, true);
    this.bus.emit({ type: 'drop', target: id, by: 'player', time: this.time });
  }

  /** The coil in hand: low and to the right of the view, turned with it. */
  private carryEquipped(now = false): void {
    const id = this.equipped, b = id ? this.bodies.get(id) : undefined, p = this.player;
    if (!id || !b || !p || this.gone.has(id)) {
      this.equipped = null;
      return;
    }
    const eye = p.eye(), d = p.lookDirection();
    const yaw = Math.atan2(d[0], d[2]);
    const right: P3 = [-Math.cos(yaw), 0, Math.sin(yaw)];
    const at = { x: eye[0] + d[0] * 30 + right[0] * 14, y: eye[1] + d[1] * 30 - 16, z: eye[2] + d[2] * 30 + right[2] * 14 };
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    if (now) {
      b.body.setTranslation(at, true);
      b.body.setRotation(q, true);
    } else {
      b.body.setNextKinematicTranslation(at);
      b.body.setNextKinematicRotation(q);
    }
  }

  /** A click with string lights in hand: into a socket (or out), else one end on a wall or ceiling, then the other. */
  private lightsClick(act: boolean): string | null {
    const id = this.equipped!;
    const st = this.strings.get(id);
    if (!st) return null;
    // (A longer reach than Use's: lights go up high.)
    const look = this.lookHit(HANG_REACH);
    if (!look?.at) return null;
    // Only on something that stays put (a wall, a ceiling, a beam).
    const body = look.id ? this.bodies.get(look.id) : undefined;
    if (body && !body.body.isFixed()) return null;
    const at: P3 = [look.at[0] + look.n[0], look.at[1] + look.n[1], look.at[2] + look.n[2]];
    if (!st.half) {
      if (act) {
        st.half = at;
        st.halfOut = look.n;
        st.version++;
      }
      return 'Hang one end';
    }
    const span = dist3(st.half, at);
    if (span < 8) return null;
    if (span > st.data.length) return 'Too far to reach';
    if (act) {
      const o: P3 = [st.halfOut[0] + look.n[0], st.halfOut[1] + look.n[1], st.halfOut[2] + look.n[2]];
      const l = Math.hypot(...o);
      this.hangLights(id, st.half, at, false, l > 0.2 ? [o[0] / l, o[1] / l, o[2] / l] : look.n);
      // Up: now the plug, its cable running from this end, is in hand to take to a socket.
      this.unplug(id, false);
      this.plugHand = id;
    }
    return 'Hang the other end';
  }

  /** Use with nothing held: switch a power source, or take down string lights looked at. */
  private powerUse(act: boolean): string | null {
    const look = this.lookHit(PLAYER.useReach);
    if (!look) return null;
    const near = this.equipped || this.plugHand ? null : this.hungLooked();
    if (near) {
      if (act) this.takeDownLights(near);
      return 'Take down';
    }
    const src = look.id ? this.withParents(look.id).find((t) => this.grid.sources.has(t)) : undefined;
    if (!src || this.runner.usePrompt([src]) !== null) return null;
    const on = this.grid.sources.get(src)!;
    if (act) this.switchPower(src, !on);
    return on ? 'Turn off' : 'Turn on';
  }

  /** Hung string lights looked at (within reach, nearer than what is behind them), or null. */
  private hungLooked(): string | null {
    const look = this.lookHit(HANG_REACH);
    if (!look) return null;
    let near: { id: string; t: number } | null = null;
    for (const [id, st] of this.strings) {
      if (!st.hung || this.gone.has(id)) continue;
      const [a, b] = st.hung;
      const r = rayNearLine(look.eye, look.dir, wirePoints(a, b, dropOf(a, b, st.data.sag), 12), HANG_REACH);
      if (r && r.d < 4 && r.t <= look.distance + 1 && (!near || r.t < near.t)) near = { id, t: r.t };
    }
    return near?.id ?? null;
  }

  /** String lights whose plug is in the player's hand (hung, not yet plugged in). */
  private plugHand: string | null = null;

  /** Which string lights' plug the player is holding (null: none). */
  get plugInHand(): string | null {
    return this.plugHand;
  }

  /** Where the plug in hand is: low and to the right of the view. */
  private handAt(): P3 | null {
    const p = this.player;
    if (!p) return null;
    const eye = p.eye(), d = p.lookDirection();
    const yaw = Math.atan2(d[0], d[2]);
    return [eye[0] + d[0] * 24 - Math.cos(yaw) * 10, eye[1] + d[1] * 24 - 12, eye[2] + d[2] * 24 + Math.sin(yaw) * 10];
  }

  /** A click with the plug in hand: into the socket looked at, if the cable reaches from the lights' last end. */
  private plugClick(act: boolean): string | null {
    const id = this.plugHand!;
    const st = this.strings.get(id), plug = this.grid.plugs.get(id);
    const look = this.lookHit(PLAYER.useReach);
    if (!st?.hung || !plug || !look) return null;
    const socket = look.id ? this.withParents(look.id).find((t) => this.grid.isSocket(t)) : undefined;
    if (!socket || !this.grid.canPlug(id, socket)) return null;
    const to = this.placeOf(socket);
    if (!to || dist3(st.hung[1], to) > plug.cable) return 'Cable too short';
    if (act) {
      this.plug(id, socket);
      this.plugHand = null;
    }
    return 'Plug in';
  }

  /** Up between two points: the coil itself is put away (still, hidden, not colliding) halfway between them. */
  private hangLights(id: string, a: P3, b: P3, quiet = false, out: P3 = [0, -1, 0]): void {
    const st = this.strings.get(id), body = this.bodies.get(id);
    if (!st || !body) return;
    if (this.held?.id === id) this.dropHeld();
    if (this.equipped === id) this.equipped = null;
    st.hung = [a, b];
    st.out = out;
    st.half = null;
    st.version++;
    body.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    body.body.setTranslation({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2 }, false);
    body.visible = false;
    this.setColliders(body, false);
    if (!quiet) this.bus.emit({ type: 'lights.hang', target: id, time: this.time });
  }

  /** Down into the player's hands as a coil again (still plugged in, if the cable reaches). */
  private takeDownLights(id: string): void {
    const st = this.strings.get(id), body = this.bodies.get(id), p = this.player;
    if (!st?.hung || !body || !p) return;
    if (this.plugHand === id) this.plugHand = null;
    st.hung = null;
    st.version++;
    this.bus.emit({ type: 'lights.takeDown', target: id, time: this.time });
    this.equip(id);
  }

  /** What to draw: string lights (hung, or one end up while being hung) and cables from plugs to sockets. */
  powerView(): { strings: { id: string; ends: [P3, P3] | null; out: P3; lit: boolean; version: number; data: StringLightsData }[]; cables: { id: string; points: P3[] }[]; plugs: { id: string; at: P3; dir: P3; up: P3 }[] } {
    const strings: { id: string; ends: [P3, P3] | null; out: P3; lit: boolean; version: number; data: StringLightsData }[] = [];
    for (const [id, st] of this.strings) {
      if (this.gone.has(id)) continue;
      const coil = st.half ? this.placeOf(id) : null;
      strings.push({ id, ends: st.hung ?? (st.half && coil ? [st.half, coil] : null), out: st.hung ? st.out : st.halfOut, lit: this.grid.live(this.grid.plugs.get(id)?.into ?? null), version: st.version + (st.half ? 0.5 : 0), data: st.data });
    }
    const cables: { id: string; points: P3[] }[] = [];
    const plugs: { id: string; at: P3; dir: P3; up: P3 }[] = [];
    for (const [id, p] of this.grid.plugs) {
      if (!p.into || this.gone.has(id)) continue;
      const from = this.plugAt(id), to = this.socketEnd(p.into, id), spot = this.socketSpot(p.into, id);
      if (from && to) cables.push({ id, points: this.cableShape(id, from, to, p.cable) });
      if (spot) plugs.push({ id, at: spot.at, dir: [-spot.normal[0], -spot.normal[1], -spot.normal[2]], up: spot.up });
    }
    const inHand = this.plugHand ? this.strings.get(this.plugHand) : undefined, hand = this.handAt();
    if (this.plugHand && inHand?.hung && hand && this.player) {
      const d = this.player.lookDirection() as P3;
      cables.push({ id: this.plugHand, points: this.cableShape(this.plugHand, inHand.hung[1], [hand[0] - d[0] * PLUG_BACK, hand[1] - d[1] * PLUG_BACK, hand[2] - d[2] * PLUG_BACK], this.grid.plugs.get(this.plugHand)!.cable) });
      plugs.push({ id: this.plugHand, at: hand, dir: d, up: [0, 1, 0] });
    }
    // Plugs not in anything: cords' and hung lights', lying on the floor at the end of a short length of cable.
    for (const [id, p] of this.grid.plugs) {
      if (p.into || this.gone.has(id) || id === this.plugHand) continue;
      const st = this.strings.get(id);
      if (st && !st.hung) continue;
      const from = this.plugAt(id);
      if (!from) continue;
      let d: P3 = st ? st.out : (this.poseOf(id)?.dir([0, 0, -1]) ?? [1, 0, 0]);
      const flat = Math.hypot(d[0], d[2]);
      d = flat > 0.1 ? [d[0] / flat, 0, d[2] / flat] : [1, 0, 0];
      const loose = this.looseEnd(id, from, d, st ? 10 : 24);
      cables.push({ id, points: loose.points });
      plugs.push({ id, at: loose.plug, dir: d, up: [0, 1, 0] });
    }
    return { strings, cables, plugs };
  }

  /** A loose plug's cable: from where it leaves, out a little way and down onto whatever is below; the plug at its end. */
  private looseEnd(id: string, from: P3, d: P3, out: number): { points: P3[]; plug: P3 } {
    const r = (v: P3) => v.map((x) => Math.round(x * 2)).join(',');
    const key = `loose|${r(from)}|${r(d)}`;
    const kept = this.looseShapes.get(id);
    if (kept?.key === key) return kept;
    const x = from[0] + d[0] * out, z = from[2] + d[2] * out;
    const hit = this.world.castRay(new RAPIER.Ray({ x, y: from[1], z }, { x: 0, y: -1, z: 0 }), 4096, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, 0xffffffff, this.player?.collider, undefined, (c) => !this.isHeld(c));
    const y = (hit ? from[1] - hit.timeOfImpact : from[1] - 64) + PLUG_RADIUS;
    const end: P3 = [x, y, z];
    const points = this.cableShape(id, from, end, dist3(from, end) * 1.2);
    const plug: P3 = [x + d[0] * PLUG_BACK, y, z + d[2] * PLUG_BACK];
    const shape = { key, points, plug };
    this.looseShapes.set(id, shape);
    return shape;
  }
  private looseShapes = new Map<string, { key: string; points: P3[]; plug: P3 }>();

  /**
   * A cable from a plug to its socket: hanging a little with the slack it has, but lying along the floor (or
   * whatever is under it) rather than through it.
   */
  private cableShape(id: string, from: P3, to: P3, cable: number): P3[] {
    const r = (v: P3) => v.map((x) => Math.round(x * 2)).join(',');
    const key = `${r(from)}|${r(to)}`;
    const kept = this.cableShapes.get(id);
    if (kept?.key === key) return kept.points;
    const span = dist3(from, to);
    const drop = Math.min(Math.max(0, cable - span) * 0.25, Math.hypot(to[0] - from[0], to[2] - from[2]) * 0.2 + 2);
    const n = 16;
    const points: P3[] = [];
    const skip = new Set([this.player?.collider.handle]);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const line: P3 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
      const y = line[1] - drop * 4 * t * (1 - t);
      // (The ends stay where they are plugged; between them, nothing under the cable is passed through.)
      let low = y;
      if (i > 0 && i < n) {
        const top = Math.max(line[1], y) + 2;
        const hit = this.world.castRay(new RAPIER.Ray({ x: line[0], y: top, z: line[2] }, { x: 0, y: -1, z: 0 }), top - y + 1, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, 0xffffffff, undefined, undefined, (c) => !skip.has(c.handle) && !this.isHeld(c));
        if (hit) low = Math.max(y, top - hit.timeOfImpact + 0.8);
      }
      points.push([line[0], low, line[2]]);
    }
    this.cableShapes.set(id, { key, points });
    return points;
  }

  /** Bulb positions of hung string lights (for tests and drawing). */
  bulbsOf(id: string): P3[] {
    const st = this.strings.get(id);
    return st?.hung ? bulbPoints(st.hung[0], st.hung[1], st.data) : [];
  }

  private savePower(): SavedScene['power'] | null {
    const on: Record<string, boolean> = {}, plugs: Record<string, string> = {}, hung: Record<string, [P3, P3, P3]> = {};
    for (const [id, v] of this.grid.sources) if (this.sourcesAtStart.get(id) !== v) on[id] = v;
    for (const [id, p] of this.grid.plugs) if (p.into && !this.gone.has(id)) plugs[id] = p.into;
    for (const [id, st] of this.strings) if (st.hung && !this.gone.has(id)) hung[id] = [...st.hung, st.out];
    const out: NonNullable<SavedScene['power']> = {};
    if (Object.keys(on).length) out.on = on;
    if (Object.keys(plugs).length) out.plugs = plugs;
    if (Object.keys(hung).length) out.hung = hung;
    return Object.keys(out).length ? out : null;
  }

  private loadPower(save: NonNullable<SavedScene['power']>): void {
    const p3 = (v: unknown): P3 | null => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as P3) : null);
    for (const [id, on] of Object.entries(save.on ?? {})) if (this.grid.sources.has(id) && typeof on === 'boolean') this.grid.sources.set(id, on);
    for (const [id, ends] of Object.entries(save.hung ?? {})) {
      const a = p3(Array.isArray(ends) ? ends[0] : null), b = p3(Array.isArray(ends) ? ends[1] : null);
      const o = p3(Array.isArray(ends) ? ends[2] : null);
      if (a && b) this.hangLights(id, a, b, true, o ?? [0, -1, 0]);
    }
    for (const [id, socket] of Object.entries(save.plugs ?? {})) {
      const p = this.grid.plugs.get(id);
      if (p && typeof socket === 'string' && this.grid.canPlug(id, socket)) p.into = socket;
    }
  }

  // ── Shelves: mounted on a wall by their back (−Z); a held Use takes one down ──

  private shelves = new Map<string, { mounted: boolean; atStart: boolean; back: number; normal: P3; clear: boolean; wallAt: P3 }>();
  /** The held Use on a mounted shelf: which, and for how long (−1: let go of Use first). */
  private shelfHold = { id: '', time: 0 };

  /** Whether a shelf is on a wall now (null: it isn't a shelf). */
  shelfMounted(id: string): boolean | null {
    return this.shelves.get(id)?.mounted ?? null;
  }

  /** How far behind its origin a shelf's back is (u, its own −Z): from its model, else its collider. */
  private backOf(e: EntityData, model: { data: ModelData; mesh: ModelMesh } | null): number {
    const sc = Math.abs(decomposeMat4(this.doc.worldMatrix(e.id)).scale[2]!);
    if (model) {
      const p = model.mesh.positions;
      let low = Infinity;
      for (let i = 2; i < p.length; i += 3) low = Math.min(low, p[i]!);
      return Number.isFinite(low) ? Math.max(0, -low * unitsOf(model.data) * sc) : 0;
    }
    const c = e.components.collider ? readComponent<ColliderData>('collider', e.components.collider) : null;
    return c ? Math.max(0, (c.size[2] / 2 - c.offset[2]) * sc) : 0;
  }

  /** On the wall where it is (or off it), with no moving and no events (starting, loading a save). */
  private setShelfMounted(id: string, mounted: boolean, body?: RAPIER.RigidBody): void {
    const sh = this.shelves.get(id), rb = body ?? this.bodies.get(id)?.body;
    if (!sh || !rb) return;
    if (this.held?.id === id) this.dropHeld();
    sh.mounted = mounted;
    if (mounted) {
      const r = rb.rotation();
      const n = qrot({ x: r.x, y: r.y, z: r.z, w: r.w }, [0, 0, 1]);
      sh.normal = [n[0], n[1], n[2]];
    }
    rb.setBodyType(mounted ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
  }

  /** A mounted shelf looked at within reach (with nothing held), or null. */
  private shelfLooked(): string | null {
    if (this.held || !this.player || this.hiding || this.frozen) return null;
    const hit = this.useAim();
    if (!hit || hit.distance > PLAYER.useReach) return null;
    return hit.targets.find((t) => this.shelves.get(t)?.mounted) ?? null;
  }

  /**
   * Each step: a held shelf brought back first against a wall (something fixed, standing up) that the player is
   * looking at sticks to it, upright, facing out, as posters do. Only by its back: turned another way, it won't.
   */
  private stickShelf(): void {
    const id = this.held?.id, sh = id ? this.shelves.get(id) : undefined, b = id ? this.bodies.get(id) : undefined;
    if (!id || !sh || !b || sh.mounted || !this.player) return;
    const look = this.player.lookDirection();
    const c = b.body.translation(), r = b.body.rotation();
    if (!sh.clear) {
      // (Just taken down: it sticks again once pulled away from that wall, or the player looks away from it.)
      const n = sh.normal, w = sh.wallAt;
      const away = (c.x - w[0]) * n[0] + (c.z - w[2]) * n[2];
      if (away < 16 && look[0] * n[0] + look[2] * n[2] < -0.3) return;
      sh.clear = true;
    }
    const back = qrot({ x: r.x, y: r.y, z: r.z, w: r.w }, [0, 0, -1]);
    const bl = Math.hypot(back[0], back[2]);
    if (bl < 0.7) return;
    const dir = { x: back[0] / bl, y: 0, z: back[2] / bl };
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(c, dir), sh.back + 3, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, 0xffffffff, this.player.collider, b.body, (x) => !!x.parent()?.isFixed() && !this.triggers.has(x.handle) && !this.volumes.has(x.handle));
    if (!hit || Math.abs(hit.normal.y) > 0.5) return;
    const nl = Math.hypot(hit.normal.x, hit.normal.z) || 1;
    const n: P3 = [hit.normal.x / nl, 0, hit.normal.z / nl];
    // Its back square to the wall, and the player looking at that wall.
    if (dir.x * -n[0] + dir.z * -n[2] < 0.7 || look[0] * n[0] + look[2] * n[2] > -0.3) return;
    const at: P3 = [c.x + dir.x * hit.timeOfImpact, c.y, c.z + dir.z * hit.timeOfImpact];
    this.dropHeld();
    const yaw = Math.atan2(n[0], n[2]), out = sh.back + 0.05;
    b.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    b.body.setTranslation({ x: at[0] + n[0] * out, y: at[1], z: at[2] + n[2] * out }, false);
    b.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, false);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    sh.mounted = true;
    sh.normal = n;
    sh.wallAt = at;
    this.bus.emit({ type: 'shelf.mount', target: id, time: this.time });
  }

  /** Each step: Use held on a mounted shelf long enough takes it down into the hands (what was on it falls). */
  private holdOnShelf(): void {
    const h = this.shelfHold;
    if (!this.player?.input.use) {
      h.id = '';
      h.time = 0;
      return;
    }
    if (h.time < 0) return;
    const id = this.shelfLooked();
    if (!id) {
      h.time = 0;
      return;
    }
    if (h.id !== id) {
      h.id = id;
      h.time = 0;
    }
    h.time += STEP;
    if (h.time < SHELF_HOLD) return;
    // (Then Use has to be let go of before it does anything more.)
    h.time = -1;
    this.unmountShelf(id);
  }

  private unmountShelf(id: string): void {
    const sh = this.shelves.get(id), b = this.bodies.get(id);
    if (!sh?.mounted || !b) return;
    // (What rests on it wakes, to fall when it goes.)
    for (let i = 0; i < b.body.numColliders(); i++) this.world.contactPairsWith(b.body.collider(i), (other) => other.parent()?.wakeUp());
    const t = b.body.translation(), n = sh.normal;
    sh.wallAt = [t.x - n[0] * sh.back, t.y, t.z - n[2] * sh.back];
    b.body.setTranslation({ x: t.x + n[0] * 2, y: t.y, z: t.z + n[2] * 2 }, false);
    b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    sh.mounted = false;
    // (Not stuck straight back: first it has to leave the wall.)
    sh.clear = false;
    this.bus.emit({ type: 'shelf.unmount', target: id, time: this.time });
    this.hold(id, b.body);
  }

  // ── Junk: a pile on the ground, a bundle in the hands ──

  /** Junk and carpets (with or without a packed model): fixed while down, loose while carried or falling. */
  private junky = new Set<string>();
  private junks = new Map<string, { pile: { data: ModelData; mesh: ModelMesh }; packed: { data: ModelData; mesh: ModelMesh }; isPacked: boolean }>();

  /** Whether junk is packed up now (null: it isn't junk). */
  junkPacked(id: string): boolean | null {
    return this.junks.get(id)?.isPacked ?? null;
  }

  /** The packed-up model of a piece of junk (for drawing it), or null. */
  junkModel(id: string): ModelData | null {
    return this.junks.get(id)?.packed.data ?? null;
  }

  /** Packed into its bundle, or spread into its pile: its look and collider swapped (keeping its weight). */
  private packJunk(id: string, packed: boolean): void {
    const b = this.bodies.get(id);
    // Picked up: loose; down as a pile: fixed in place.
    if (b && this.junky.has(id)) b.body.setBodyType(packed ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.Fixed, packed);
    const j = this.junks.get(id);
    if (!j || !b?.model || j.isPacked === packed) return;
    j.isPacked = packed;
    b.model = { ...(packed ? j.packed : j.pile), matrix: b.model.matrix };
    this.rebuildColliders(b);
    this.bus.emit({ type: packed ? 'junk.pack' : 'junk.unpack', target: id, time: this.time });
  }

  /** The lowest height of a model's points, turned by `q` (world units, from the body's origin). */
  private junkFloor(m: { data: ModelData; mesh: ModelMesh }, matrix: number[], q: Quat): number {
    const k = unitsOf(m.data);
    const sc = decomposeMat4(matrix).scale.map(Math.abs);
    const p = m.mesh.positions;
    let low = Infinity;
    for (let i = 0; i + 2 < p.length; i += 3) low = Math.min(low, qrot(q, [p[i]! * k * sc[0]!, p[i + 1]! * k * sc[1]!, p[i + 2]! * k * sc[2]!])[1]);
    return Number.isFinite(low) ? low : 0;
  }

  /** After each step: packed junk that isn't held and has landed on something spreads into a pile, upright, there. */
  private settleJunk(): void {
    for (const id of this.junky) {
      const b = this.bodies.get(id);
      if (!b?.model || this.held?.id === id || !b.body.isDynamic()) continue;
      const j = this.junks.get(id);
      // On something below it (not just brushing a wall); without a bundle to spread from, once it has settled.
      let landed = b.body.isSleeping();
      for (let i = 0; i < b.body.numColliders() && !landed; i++) {
        const mine = b.body.collider(i);
        this.world.contactPairsWith(mine, (other) => {
          if (landed || other.isSensor() || other.handle === this.player?.collider.handle || this.triggers.has(other.handle) || this.volumes.has(other.handle)) return;
          this.world.contactPair(mine, other, (m) => {
            if (m.numContacts() > 0 && Math.abs(m.normal().y) > 0.5) landed = true;
          });
        });
      }
      if (landed && !j?.isPacked) {
        const v = b.body.linvel(), w = b.body.angvel();
        if (!b.body.isSleeping() && (Math.hypot(v.x, v.y, v.z) > 8 || Math.hypot(w.x, w.y, w.z) > 0.5)) continue;
        this.packJunk(id, false);
        continue;
      }
      if (!landed || !j) continue;
      const r = b.body.rotation(), c = b.body.translation();
      const was = { x: r.x, y: r.y, z: r.z, w: r.w };
      // Upright, facing the way the bundle faced, its lowest point where the bundle's was.
      const f = qrot(was, [0, 0, 1]);
      const yaw = Math.hypot(f[0], f[2]) > 1e-3 ? Math.atan2(f[0], f[2]) : 0;
      const up = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      const y = c.y + this.junkFloor(j.packed, b.model.matrix, was) - this.junkFloor(j.pile, b.model.matrix, up) + 0.5;
      b.body.setTranslation({ x: c.x, y, z: c.z }, false);
      b.body.setRotation(up, false);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      this.packJunk(id, false);
    }
  }


  private track(id: string, kind: BodyInfo['kind'], motion: BodyInfo['motion'], body: RAPIER.RigidBody, brushes: Brush[] = []): void {
    const t = body.translation(), r = body.rotation();
    this.bodies.set(id, {
      info: { id, kind, motion },
      body,
      startInverse: invertRigid(poseMatrix(body)),
      start: { p: [t.x, t.y, t.z], q: { x: r.x, y: r.y, z: r.z, w: r.w } },
      brushes,
      visible: true,
      scale: 1,
      startMotion: motion,
    });
    if (kind !== 'zone') this.stats.bodies++;
  }

  /** A level-change zone: a sensor the player walks into. */
  private addLevelZone(e: EntityData, brush: Brush): void {
    const desc = RAPIER.ColliderDesc.convexHull(hullPoints(brush));
    if (!desc) return;
    const c = this.world.createCollider(desc.setSensor(true), this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
    this.volumes.add(c.handle);
    this.levelZones.push({ id: e.id, collider: c, data: readComponent<LevelChangeData>('levelChange', e.components.levelChange) });
  }

  /** Water or a ladder: a sensor zone the player (and, for water, floating things) moves differently in. */
  private addVolume(e: EntityData, brush: Brush): void {
    const desc = RAPIER.ColliderDesc.convexHull(hullPoints(brush));
    if (!desc) return;
    desc.setSensor(true);
    const c = this.world.createCollider(desc, this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
    this.volumes.add(c.handle);
    this.owner.set(c.handle, e.id);
    if (e.components.water) this.waters.push({ id: e.id, collider: c, top: bounds(brush)?.max[1] ?? 0, data: readComponent<WaterData>('water', e.components.water) });
    else this.ladders.push({ id: e.id, collider: c, data: readComponent<LadderData>('ladder', e.components.ladder) });
  }

  /** A Sound area: the space inside the brush's faces. */
  private addSoundArea(e: EntityData, brush: Brush): void {
    const b = bounds(brush);
    if (!b || !brush.faces.length) return;
    const size = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
    this.soundAreas.push({ id: e.id, planes: brush.faces.map((f) => f.plane), size, data: readComponent<SoundAreaData>('soundArea', e.components.soundArea) });
  }

  /**
   * How things sound to ears at `p`: the smallest Sound area round it sets the effect and may swap the
   * background sound; under water everything is muffled, area or not.
   */
  hearing(p: { x: number; y: number; z: number }): Hearing {
    const at: [number, number, number] = [p.x, p.y, p.z];
    let area: (typeof this.soundAreas)[number] | null = null;
    for (const a of this.soundAreas) if ((!area || a.size < area.size) && a.planes.every((pl) => signedDist(pl, at) <= 0)) area = a;
    const scene = backgroundSoundOf(this.doc.settings);
    const bg = area?.data.sound ? { sound: area.data.sound, volume: area.data.volume } : scene.sound ? { sound: scene.sound, volume: scene.volume } : null;
    const underwater = !!this.waterAt(p);
    const mix = Math.max(0, Math.min(1, area?.data.mix ?? 1));
    return { area: area?.id ?? null, effect: underwater ? 'underwater' : (area?.data.effect ?? 'none'), mix: underwater ? 1 : mix, background: bg, underwater };
  }

  /** The water a point is in (its id, surface height and look under water), or null. */
  waterAt(p: { x: number; y: number; z: number }): { id: string; top: number; tint: string; clearness: number } | null {
    for (const w of this.waters) if (w.collider.containsPoint(p)) return { id: w.id, top: w.top, tint: w.data.tint, clearness: w.data.clearness };
    return null;
  }

  /** The climbing speed of a ladder the player's shape touches at `at`, or null. */
  private ladderAt(shape: RAPIER.Shape, at: { x: number; y: number; z: number }): number | null {
    for (const l of this.ladders) if (l.collider.intersectsShape(shape, at, { x: 0, y: 0, z: 0, w: 1 })) return l.data.speed;
    return null;
  }

  /** Floating: physics objects in water are lifted (they settle with their middle a little under the surface) and slowed. */
  private floatBodies(): void {
    if (!this.waters.length) return;
    const g = Math.abs(this.world.gravity.y);
    this.world.forEachRigidBody((b) => {
      if (!b.isDynamic()) return;
      const p = b.translation();
      const w = this.waterAt(p);
      if (!w) return;
      // Fully under 24 u down; half at the surface: a body floats with its middle about 8 u under.
      const k = Math.max(0, Math.min(1, (w.top - p.y) / 24 + 0.5));
      const m = b.mass();
      b.applyImpulse({ x: 0, y: m * g * b.gravityScale() * 1.5 * k * STEP, z: 0 }, true);
      const v = b.linvel(), a = b.angvel();
      const damp = Math.max(0, 1 - 2.5 * STEP);
      b.setLinvel({ x: v.x * damp, y: v.y * damp, z: v.z * damp }, true);
      b.setAngvel({ x: a.x * damp, y: a.y * damp, z: a.z * damp }, true);
    });
  }

  /** Drowning: after 12 s with the head under water (in water that drowns), 10 health a second. */
  private breathe(): void {
    const p = this.player;
    if (!p) return;
    const [x, y, z] = p.eye();
    const w = this.waters.find((w) => w.collider.containsPoint({ x, y, z }));
    if (!w || !w.data.drowns) {
      this.underwaterFor = 0;
      return;
    }
    this.underwaterFor += STEP;
    if (this.underwaterFor >= 12 && this.time - this.drownedAt >= 1) {
      this.drownedAt = this.time;
      this.hurt(10, 'drowning', true);
    }
  }

  /** Seconds the player's head has been under water (0 when out). */
  get breathHeld(): number {
    return this.underwaterFor;
  }

  /** A trigger zone: a sensor that reports what enters and leaves. */
  private addTrigger(e: EntityData, brush: Brush, scripted = false): void {
    const desc = RAPIER.ColliderDesc.convexHull(hullPoints(brush));
    if (!desc) return;
    desc.setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
    // Zones that scripts move or switch get a body scripts can drive.
    const body = this.world.createRigidBody(scripted ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed());
    if (scripted) this.track(e.id, 'zone', 'kinematic', body);
    const c = this.world.createCollider(desc, body);
    this.owner.set(c.handle, e.id);
    this.triggers.set(c.handle, { id: e.id, data: readComponent<TriggerData>('trigger', e.components.trigger), fired: false, inside: new Set(), present: new Set() });
    this.stats.triggers++;
  }

  /** Advance by `dt` seconds of real time, in fixed physics steps. Returns the number of steps taken. */
  step(dt: number): number {
    // (Once a level change has begun, this scene is over.)
    if (this.disposed || this.travel) return 0;
    this.accumulator = Math.min(this.accumulator + Math.max(0, dt), STEP * MAX_STEPS_PER_FRAME);
    let n = 0;
    if (!this.startedScripts) {
      // “When the game starts” runs on the first frame, and sounds that play from the start begin.
      this.startedScripts = true;
      for (const e of this.doc.entities) if (e.components.sound && this.isShown(e)) this.startSound(e.id, readComponent<SoundData>('sound', e.components.sound), null);
      if (this.dayFresh) this.runner.dispatch({ type: 'newDay', day: this.day, first: true });
      this.runner.start();
      this.started = true;
      this.restoreAfterStart();
    }
    while (this.accumulator >= STEP) {
      this.rememberPoses();
      this.applyTweens(this.time + STEP);
      this.moveTrains();
      if (this.player && this.hiding) {
        this.stayHidden();
        if (this.useQueued) this.doUse();
      } else if (this.player) {
        if (this.frozen) Object.assign(this.player.input, { forward: 0, right: 0, jump: false, crouch: false, fire: false, use: false });
        this.player.speedScale = (1 - WEAK.slow * this.weakness()) * (1 + (this.mine?.stat('moveSpeed') ?? 0));
        this.player.step(STEP);
        this.playerNoise();
        if (this.player.landingSpeed) {
          const damage = fallDamage(this.player.landingSpeed);
          this.player.landingSpeed = 0;
          if (damage > 0) this.hurt(damage, 'a fall', true);
        }
        if (this.player.feetPosition.y < this.killY) {
          if (this.rules.health) this.die('falling out of the world');
          else this.player.respawn();
        }
        if (this.useQueued) this.doUse();
        if (this.base) this.stepBase();
        if (this.mine) this.stepMine();
        this.carryHeld();
        if (this.equipped) this.carryEquipped();
        this.watchSeats();
        this.checkLevelZones();
        if (this.player.input.use) this.charge();
        this.fireWeapon();
        this.breathe();
      }
      this.useQueued = false;
      // (Not on the very first step: until physics has stepped once, its queries can't see anything.)
      if (this.time > 0) for (const n of this.npcs.values()) n.step(STEP);
      this.weapons.step(STEP, Math.abs(this.world.gravity.y));
      this.floatBodies();
      this.carryOnBelts();
      this.syncStandIns();
      this.noteVelocities();
      this.world.step(this.events);
      this.listenForHits();
      if (this.held) this.stickHeld();
      if (this.stakes.size) this.stickStakes();
      if (this.junky.size) this.settleJunk();
      if (this.shelves.size) {
        this.holdOnShelf();
        this.stickShelf();
      }
      if (this.grid.plugs.size) this.checkCables();
      this.accumulator -= STEP;
      this.time += STEP;
      this.base?.tick(STEP);
      if (this.printing.size) this.stepPrinters(STEP);
      if (this.hoursPerSecond) this.passHours(this.hoursPerSecond * STEP);
      n++;
      this.events.drainCollisionEvents((h1, h2, started) => this.onContact(h1, h2, started));
      this.runner.tick(STEP);
      if (this.loudSounds.size) this.callAgain();
    }
    return n;
  }

  private startedScripts = false;

  /** Creatures' feet and facing before the last step (x, y, z, yaw), for drawing in between. */
  private npcPrev = new Map<string, Float64Array>();

  /** Keep where everything that moves is, before a physics step moves it (see `drawnMotionOf`). */
  private rememberPoses(): void {
    for (const b of this.bodies.values()) {
      if (b.info.motion === 'fixed' || b.info.kind === 'zone') continue;
      const t = b.body.translation(), q = b.body.rotation();
      const p = (b.prev ??= new Float64Array(7));
      p[0] = t.x;
      p[1] = t.y;
      p[2] = t.z;
      p[3] = q.x;
      p[4] = q.y;
      p[5] = q.z;
      p[6] = q.w;
    }
    for (const n of this.npcs.values()) {
      let p = this.npcPrev.get(n.id);
      if (!p) this.npcPrev.set(n.id, (p = new Float64Array(4)));
      p[0] = n.feet.x;
      p[1] = n.feet.y;
      p[2] = n.feet.z;
      p[3] = n.yaw;
    }
  }

  /** How far the time now is between the last two physics steps (0…1): what is drawn sits that far along. */
  private get alpha(): number {
    return Math.max(0, Math.min(1, this.accumulator / STEP));
  }

  // ── The player ──

  /** What the player is pressing (from the keyboard and mouse). */
  setPlayerInput(input: Partial<PlayerInput>): void {
    // (A click can press and let go between two steps: the press still fires once.)
    if (input.fire && !this.hiding) this.fireQueued = true;
    if (this.player) Object.assign(this.player.input, input);
    if (this.hiding) this.limitLook();
  }

  // ── Hiding spots ──

  private spots = new Map<string, HidingSpotData>();
  /** Spots that are seats: the player sits in plain view. */
  private seats = new Set<string>();
  /** When each physics seat last moved (sitting waits until it has rested a moment). */
  private seatMoved = new Map<string, number>();
  private watchSeats(): void {
    for (const id of this.seats) {
      const b = this.bodies.get(this.bodyOf(id) ?? '')?.body;
      if (!b?.isDynamic()) continue;
      const v = b.linvel(), w = b.angvel();
      if (Math.hypot(v.x, v.y, v.z) > 12 || Math.hypot(w.x, w.y, w.z) > 1) this.seatMoved.set(id, this.time);
    }
  }

  /** A seat can be sat on: not flying or tumbling (rested a moment), and upright. */
  private seatReady(id: string): boolean {
    const b = this.bodies.get(this.bodyOf(id) ?? '')?.body;
    if (!b?.isDynamic()) return true;
    if (this.time - (this.seatMoved.get(id) ?? -Infinity) < 0.3) return false;
    const q = b.rotation();
    // (Its up axis, turned: the y of the rotated (0, 1, 0).)
    return 1 - 2 * (q.x * q.x + q.z * q.z) > 0.7;
  }

  /** A physics seat held still while sat on. */
  private stilled: RAPIER.RigidBody | null = null;
  private unstill(): void {
    if (this.stilled && this.world.getRigidBody(this.stilled.handle)) this.stilled.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.stilled = null;
  }
  /** The furthest any hiding spot can be used from. */
  private spotReach = 0;

  private reachOf(spot: string): number {
    const r = Number(this.spots.get(spot)?.reach);
    return r > 0 ? r : PLAYER.useReach;
  }
  /**
   * The spot the player hides in: where they stood and looked when they got in, the spot's view, when they got
   * in, and when they started getting out (null: still in). `heldUntil`: pulled out, held still until then.
   */
  private hiding: {
    id: string;
    data: HidingSpotData;
    feet: { x: number; y: number; z: number };
    from: { eye: [number, number, number]; yaw: number; pitch: number };
    view: { eye: [number, number, number]; yaw: number; pitch: number };
    at: number;
    out: number | null;
    heldUntil: number;
  } | null = null;

  /** The hiding spot the player is in (null: not hiding, or getting out). */
  get hidingIn(): string | null {
    return this.hiding && this.hiding.out === null ? this.hiding.id : null;
  }

  /** Where the eyes go in a spot and the way they face (−Z of its Look from object, or of the spot). */
  private spotView(id: string, data: HidingSpotData): { eye: [number, number, number]; yaw: number; pitch: number } {
    const at = data.view && this.doc.get(data.view) ? data.view : id;
    let m = this.doc.worldMatrix(at);
    let base = pivotOf(this.doc, at, boundsOfEntity);
    // (Where it is now, if it has moved: a chair that was carried somewhere.)
    const body = this.bodyOf(at);
    const mo = body ? this.motionOf(body) : null;
    if (mo) {
      m = multiply(mo, m);
      base = transformPoint(mo, base);
    }
    const o = Array.isArray(data.offset) ? data.offset.map((v) => Number(v) || 0) : [0, 0, 0];
    const eye: [number, number, number] = [0, 1, 2].map((k) => base[k]! + m[k]! * o[0]! + m[4 + k]! * o[1]! + m[8 + k]! * o[2]!) as never;
    const f = [-m[8]!, -m[9]!, -m[10]!];
    const len = Math.hypot(f[0]!, f[1]!, f[2]!) || 1;
    return { eye, yaw: Math.atan2(-f[0]! / len, -f[2]! / len), pitch: Math.asin(Math.max(-1, Math.min(1, f[1]! / len))) };
  }

  private enterHiding(id: string): void {
    const p = this.player!;
    const data = this.spots.get(id)!;
    this.dropHeld();
    const view = this.spotView(id, data);
    this.hiding = { id, data, feet: p.feetPosition, from: { eye: p.eye(), yaw: p.input.yaw, pitch: p.input.pitch }, view, at: this.time, out: null, heldUntil: 0 };
    Object.assign(p.input, { forward: 0, right: 0, jump: false, crouch: false, fire: false, use: false, yaw: view.yaw, pitch: view.pitch });
    if (this.seats.has(id)) {
      // (Sitting: the body goes under the eyes and can still be hit.)
      p.placeAt({ x: view.eye[0], y: view.eye[1] - PLAYER.eye, z: view.eye[2] });
      // (A physics seat holds still under the player.)
      const b = this.bodies.get(this.bodyOf(id) ?? '');
      if (b?.body.isDynamic()) {
        b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        this.stilled = b.body;
      }
      this.runner.dispatch({ type: 'sits', targets: [id, ...this.ancestorsOf(id)] });
    } else {
      p.collider.setEnabled(false);
      this.spotUsed.set(id, this.time);
      this.noise(this.v3(this.spotView(id, data).eye), NOISE.hiding, id);
      this.runner.dispatch({ type: 'hides', targets: [id, ...this.ancestorsOf(id)] });
    }
    this.bus.emit({ type: 'use', target: id, by: 'player', time: this.time });
  }

  /**
   * Out of the spot, back where they got in, looking the way they did. Pulled out by a creature (`by`): held still
   * this long, facing it, in front of it if it stands where they got in.
   */
  private leaveHiding(held = 0, by: Npc | null = null): void {
    const h = this.hiding;
    if (!h || h.out !== null) return;
    const p = this.player!;
    h.from = { eye: this.hiddenView().eye, yaw: p.input.yaw, pitch: p.input.pitch };
    h.out = this.time;
    h.heldUntil = this.time + held;
    p.collider.setEnabled(true);
    let feet = h.feet, yaw = h.from.yaw;
    if (by) {
      // (Where they got in, unless the creature stands there: beside it, else behind it.)
      const n = by.feet;
      const dx = h.view.eye[0] - n.x, dz = h.view.eye[2] - n.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len, gap = by.radius + PLAYER.radius + 8;
      const tries = [feet, ...[[-uz, ux], [uz, -ux], [-ux, -uz]].map(([x, z]) => ({ x: n.x + x! * gap, y: n.y, z: n.z + z! * gap }))];
      feet = tries.find((f) => Math.hypot(f.x - n.x, f.z - n.z) >= gap - 1 && p.fitsAt(f)) ?? feet;
      yaw = Math.atan2(n.x - feet.x, n.z - feet.z) + Math.PI;
    }
    p.teleport(feet, yaw);
    p.input.pitch = 0;
    if (this.seats.has(h.id)) {
      this.unstill();
      return this.runner.dispatch({ type: 'stands', targets: [h.id, ...this.ancestorsOf(h.id)] });
    }
    this.spotUsed.set(h.id, this.time);
    this.noise(this.v3(h.view.eye), NOISE.hiding, h.id);
    this.runner.dispatch({ type: 'unhides', targets: [h.id, ...this.ancestorsOf(h.id)] });
  }

  /** Where each spot is and where to stand to check it (worked out once). */
  private spotPlaces = new Map<string, { at: V3; front: V3 }>();
  /** When each spot was last used and last made a noise. */
  private spotUsed = new Map<string, number>();
  private spotNoise = new Map<string, number>();

  /** Hiding spots as creatures can observe them (never who is inside). */
  private spotInfo(): SpotInfo[] {
    const out: SpotInfo[] = [];
    for (const [id, data] of this.spots) {
      if (!this.doc.get(id) || !this.isVisible(id) || this.seats.has(id)) continue;
      let place = this.spotPlaces.get(id);
      if (!place) {
        const v = this.spotView(id, data);
        const base = pivotOf(this.doc, id, boundsOfEntity);
        const front: V3 = [v.eye[0] - Math.sin(v.yaw) * 56, base[1], v.eye[2] - Math.cos(v.yaw) * 56];
        place = { at: [base[0], base[1], base[2]], front };
        this.spotPlaces.set(id, place);
      }
      const used = this.spotUsed.get(id) ?? -Infinity;
      const v3 = (p: V3) => ({ x: p[0], y: p[1], z: p[2] });
      out.push({ id, kind: data.kind ?? 'locker', at: v3(place.at), front: v3(place.front), open: this.time - used <= Math.max(0.6, this.moveTimeOf(data)), usedAt: used, noiseAt: this.spotNoise.get(id) ?? -Infinity });
    }
    return out;
  }

  private moveTimeOf(data: HidingSpotData): number {
    return Math.max(0, Math.min(2, Number(data.time) || 0));
  }

  /**
   * A noise of some loudness: creatures that hear it (within Hears you up to × loudness; half as far through walls)
   * may come to look. `source`: the hiding spot it came from, if any.
   */
  noise(at: { x: number; y: number; z: number }, loudness: number, source: string | null = null): void {
    if (!(loudness > 0)) return;
    const spot = source && this.spots.has(source) ? source : null;
    if (spot) this.spotNoise.set(spot, this.time);
    for (const n of this.npcs.values()) if (n.alive && n.hostile) n.mind?.hear(at, loudness, spot);
  }

  /**
   * The Director's hint: the player is roughly here (give or take `spread` u), this sure, as this kind of news.
   * Each creature gets its own guess within `spread` (at least 64 u), so a hint never gives away the exact place.
   */
  hint(at: { x: number; y: number; z: number }, spread: number, confidence: number, kind: StimulusKind): void {
    for (const n of this.npcs.values()) {
      if (!n.alive || !n.mind || n.mind.bb.hasVisual) continue;
      const r = Math.max(64, spread) * Math.sqrt(this.random()), a = this.random() * Math.PI * 2;
      n.mind.offer({ at: { x: at.x + Math.cos(a) * r, y: at.y, z: at.z + Math.sin(a) * r }, confidence: Math.max(0, Math.min(1, confidence)), time: this.time, kind });
    }
  }

  /** Out at once, with no move (dying, being put somewhere by a script). */
  private stopHiding(): void {
    if (!this.hiding) return;
    const out = this.hiding.out === null;
    this.unstill();
    if (out) this.runner.dispatch({ type: this.seats.has(this.hiding.id) ? 'stands' : 'unhides', targets: [this.hiding.id, ...this.ancestorsOf(this.hiding.id)] });
    this.hiding = null;
    this.player?.collider.setEnabled(true);
  }

  /** Each step while hiding: held still; once out (and let go), back to normal. */
  private stayHidden(): void {
    const h = this.hiding!;
    const p = this.player!;
    Object.assign(p.input, { forward: 0, right: 0, jump: false, crouch: false, fire: false, use: false });
    this.fireQueued = false;
    if (h.out !== null && this.time >= Math.max(h.out + this.moveTime(), h.heldUntil)) this.hiding = null;
  }

  private moveTime(): number {
    return this.hiding ? this.moveTimeOf(this.hiding.data) : 0;
  }

  private v3(p: readonly number[]): { x: number; y: number; z: number } {
    return { x: p[0]!, y: p[1]!, z: p[2]! };
  }

  private nextStep = 0;

  /** The player's own noises: footsteps (not crouching or walking slowly), landing hard. */
  private playerNoise(): void {
    const p = this.player!;
    const v = p.velocity;
    this.footsteps();
    if (p.landingSpeed > 300) this.noise(p.feetPosition, NOISE.landing);
    if (!p.onGround || p.crouched || p.input.walk || Math.hypot(v.x, v.z) < 100 || this.time < this.nextStep) return;
    this.nextStep = this.time + 0.35;
    this.noise(p.feetPosition, NOISE.footsteps);
  }

  /** Inside, the view turns only as far as the spot lets it. */
  private limitLook(): void {
    const h = this.hiding!;
    const p = this.player!;
    if (h.out !== null) {
      p.input.yaw = h.from.yaw;
      p.input.pitch = 0;
      return;
    }
    const deg = Math.PI / 180;
    const side = Math.max(0, Number(h.data.side) || 0) * deg, upDown = Math.max(0, Number(h.data.upDown) || 0) * deg;
    p.input.yaw = h.view.yaw + Math.max(-side, Math.min(side, turnOf(p.input.yaw - h.view.yaw)));
    p.input.pitch = Math.max(h.view.pitch - upDown, Math.min(h.view.pitch + upDown, p.input.pitch));
  }

  /** The camera while hiding: a quick move between the player's eyes and the spot's, then the spot's view. */
  private hiddenView(): { eye: [number, number, number]; yaw: number; pitch: number } {
    const h = this.hiding!;
    const p = this.player!;
    const inside = { eye: h.view.eye, yaw: p.input.yaw, pitch: p.input.pitch };
    const t = this.moveTime() > 0 ? Math.min(1, (this.time + this.accumulator - (h.out ?? h.at)) / this.moveTime()) : 1;
    const to = h.out === null ? inside : { eye: p.eye(), yaw: p.input.yaw, pitch: p.input.pitch };
    if (t >= 1) return to;
    const k = t * t * (3 - 2 * t);
    const from = h.from;
    return {
      eye: [0, 1, 2].map((i) => from.eye[i]! + (to.eye[i]! - from.eye[i]!) * k) as never,
      yaw: from.yaw + turnOf(to.yaw - from.yaw) * k,
      pitch: from.pitch + (to.pitch - from.pitch) * k,
    };
  }

  /** A scripted scene holds the player still (no moving, jumping, firing or using; they can look around). */
  private frozen = false;
  /** A scripted scene looks through an object until a time. */
  private cameraView: { id: string; until: number } | null = null;

  /** Whether a scripted scene holds the player still. */
  get playerFrozen(): boolean {
    return this.frozen;
  }

  /** The view through an object a script chose, if one is on: its place and the way it faces (−Z). */
  private cameraEye(): { eye: [number, number, number]; yaw: number; pitch: number } | null {
    const c = this.cameraView;
    if (!c) return null;
    if (this.time >= c.until) {
      this.cameraView = null;
      return null;
    }
    const e = this.doc.get(c.id);
    if (!e) return null;
    const start = this.doc.worldMatrix(c.id);
    // (Drawn: where the object is between the last two steps, as the player's own view is.)
    const motion = this.drawnMotionOf(c.id) ?? this.drawnMotionOf(this.unitOf.get(c.id) ?? '');
    const m = motion ? multiply(motion, start) : start;
    // Forward is −Z.
    const f = [-m[8]!, -m[9]!, -m[10]!];
    const len = Math.hypot(f[0]!, f[1]!, f[2]!) || 1;
    return { eye: [m[12]!, m[13]!, m[14]!], yaw: Math.atan2(-f[0]! / len, -f[2]! / len), pitch: Math.asin(Math.max(-1, Math.min(1, f[1]! / len))) };
  }

  /**
   * What pressing Use would do right now: the prompt of what the player is looking at within reach ('' for
   * no word), or null when there's nothing to use.
   */
  usePrompt(): string | null {
    if (this.hiding) return null;
    if (this.base && this.base.prompt(this.baseAim())) return null;
    const power = this.held ? this.powerHeldUse(false) : this.powerUse(false);
    if (power !== null) return power;
    if (!this.held && this.shelfLooked()) return this.shelfHold.time > 0 ? `Taking down… ${Math.round((this.shelfHold.time / SHELF_HOLD) * 100)}%` : 'Hold to take down';
    const hit = this.useAim();
    if (!hit) return null;
    const { id, targets, distance } = hit;
    if (this.held) return this.runner.usesHolding(targets, this.heldIds(), distance) ? '' : null;
    const spot = targets.find((t) => this.spots.has(t) && this.keyOf(t) === 'KeyE' && this.seatReady(t));
    if (spot && distance <= this.reachOf(spot)) return String(this.spots.get(spot)!.prompt ?? '');
    const prompt = this.runner.usePrompt(targets, distance);
    if (prompt !== null) return prompt;
    if (distance > PLAYER.useReach) return null;
    if (targets.some((t) => this.npcs.get(t)?.alive && this.npcs.get(t)!.data.side === 'friendly')) return '';
    if (targets.some((t) => (this.chargers.get(t)?.left ?? 0) > 0)) return '';
    return this.carryable(id) ? '' : null;
  }

  /**
   * What Use would reach: the object looked at (past what's held), what it's inside, and how far away, within the
   * player's reach or the furthest a “When the player uses” stack reaches.
   */
  private useAim(): { id: string; targets: string[]; distance: number } | null {
    const hit = this.player?.aimAt(Math.max(PLAYER.useReach, this.runner.useReach(), this.spotReach), (c) => this.isHeld(c) || (c.isSensor() && !this.isPoster(c)), true);
    const id = hit ? this.owner.get(hit.collider.handle) : undefined;
    if (!hit || !id || id === 'player') return null;
    const targets: string[] = [];
    for (let x: string | null | undefined = id; x; x = this.parentOf.get(x)) targets.push(x);
    return { id, targets, distance: hit.distance };
  }

  /** What's held and the objects it is a copy of (it first). */
  private heldIds(): string[] {
    const out: string[] = [];
    for (let x: string | undefined = this.held?.id; x && !out.includes(x); x = this.copyOf.get(x)) out.push(x);
    return out;
  }

  /** Use or Fire while holding something: a “While holding” stack of what's looked at takes it (true), if any. */
  private useHolding(): boolean {
    const hit = this.useAim();
    if (!hit || !this.held) return false;
    const held = this.heldIds();
    if (!this.runner.usesHolding(hit.targets, held, hit.distance)) return false;
    this.runner.dispatch({ type: 'useHolding', targets: hit.targets, held, distance: hit.distance });
    this.bus.emit({ type: 'use', target: hit.id, by: 'player', time: this.time });
    return true;
  }

  /** The weapon in hand (its item's name and settings), or null. */
  weaponInHand(): { name: string; weapon: WeaponDef } | null {
    const name = this.selectedItem();
    const weapon = weaponOf(this.ui.items.find((i) => i.name === name)?.weapon);
    return name && weapon ? { name, weapon } : null;
  }

  private weaponStatus(): PlayerStatus['weapon'] {
    const w = this.weaponInHand();
    if (!w) return null;
    return { name: w.name, ammo: w.weapon.ammo ? (this.inventory.get(w.weapon.ammo) ?? 0) : null, ammoName: w.weapon.ammo };
  }

  /** Fire the weapon in hand while the button is held (once per click unless it is automatic), using up ammo. */
  private fireWeapon(): void {
    const p = this.player!;
    const queued = this.fireQueued;
    this.fireQueued = false;
    const held = !!p.input.fire || queued;
    const fresh = (held && !this.fireHeld) || (queued && !p.input.fire);
    this.fireHeld = !!p.input.fire;
    // (String lights in hand: the click is theirs.)
    if ((this.equipped || this.plugHand) && !this.held) return;
    // (Something in the hands: Fire throws it instead.)
    if (this.held) {
      if (fresh && !this.useHolding()) this.throwHeld();
      return;
    }
    const w = this.weaponInHand();
    if (!w || !held || (!w.weapon.automatic && !fresh) || this.time < this.nextShotAt) return;
    const { weapon, name } = w;
    if (weapon.ammo) {
      if ((this.inventory.get(weapon.ammo) ?? 0) <= 0) return;
      this.giveItem(weapon.ammo, -1);
    }
    this.nextShotAt = this.time + 1 / weapon.rate;
    if (weapon.sound) this.bus.emit({ type: 'sound', sound: weapon.sound, at: null, follow: null, volume: 1, loop: false, range: 2048, source: 'player', time: this.time });
    this.weapons.fire(weapon, name, p.eye(), p.lookDirection(), 'player', p.collider.handle);
    this.noise(p.feetPosition, NOISE.shot);
  }

  /** What creatures can ask of the world. */
  private npcWorld(): import('./npc').NpcWorld {
    const self = this;
    return {
      world: this.world,
      time: () => this.time,
      get gravity() {
        return Math.abs(self.world.gravity.y);
      },
      player: () => {
        const p = this.player;
        if (!p) return null;
        const [x, y, z] = p.eye();
        const h = this.hiding;
        const hidden = h && h.out === null && !this.seats.has(h.id) ? h.id : null;
        return { feet: hidden ? { ...h!.feet } : p.feetPosition, eye: { x, y, z }, collider: p.collider.handle, hidden, entering: !!hidden && this.time - h!.at <= Math.max(this.moveTime(), STEP) };
      },
      pullOut: (npc, spot) => {
        if (this.hidingIn !== spot) return;
        this.leaveHiding(Math.max(0, Number(npc.data.pull ?? 0.8) || 0), npc);
        this.runner.dispatch({ type: 'found', targets: [spot, ...this.ancestorsOf(spot)] });
      },
      passes: (c) => this.triggers.has(c.handle) || this.volumes.has(c.handle) || this.standInOf.has(c.handle),
      hurtPlayer: (amount, by) => this.hurt(amount, this.names.get(by) ?? 'a creature'),
      shoot: (from, dir, npc) =>
        this.weapons.fire(
          { kind: 'bullet', damage: npc.data.damage, rate: npc.data.rate, automatic: false, range: npc.data.sight * 1.5, spread: npc.data.spread, pellets: 1, ammo: '', speed: 0, arc: false, blast: 0, push: 100, sound: '' },
          this.names.get(npc.id) ?? 'a creature',
          [from.x, from.y, from.z],
          [dir.x, dir.y, dir.z],
          npc.id,
          npc.collider.handle,
        ),
      animate: (npc, role, loop) => {
        const byRole = (r: string) => npcAnimation(npc.data.anims, r as AnimRole);
        const name = (ANIM_ROLES as string[]).includes(role) ? byRole(role) : momentAnimation(String(npc.data.moves ?? ''), role, byRole);
        if (name) this.bus.emit({ type: 'anim', target: npc.id, name, loop, time: this.time });
      },
      random: () => this.random(),
      route: (from, to) => this.navigation()?.path(from, to) ?? null,
      around: (at, min, max) => this.navigation()?.spotAround(at, min, max, () => this.random()) ?? null,
      spots: () => this.spotInfo(),
      reveal: (npc, spot) => {
        if (this.hidingIn !== spot) return false;
        this.leaveHiding(Math.max(0, Number(npc.data.pull ?? 0.8) || 0), npc);
        this.runner.dispatch({ type: 'found', targets: [spot, ...this.ancestorsOf(spot)] });
        npc.startPull();
        return true;
      },
      did: (npc, what, spot) => this.runner.dispatch({ type: 'does', what, targets: [npc.id, ...(spot ? [spot, ...this.ancestorsOf(spot)] : [])] }),
    };
  }

  private ancestorsOf(id: string): string[] {
    const out: string[] = [];
    for (let x = this.parentOf.get(id); x; x = this.parentOf.get(x)) out.push(x);
    return out;
  }

  /** Creatures now, for drawing: where their feet are, which way they face, whether alive. */
  npcStates(drawn = false): { id: string; feet: V3; yaw: number; alive: boolean; state: string; health: number }[] {
    return [...this.npcs.values()].map((n) => {
      const { feet, yaw } = drawn ? this.drawnNpc(n) : { feet: [n.feet.x, n.feet.y, n.feet.z] as V3, yaw: n.yaw };
      return { id: n.id, feet, yaw, alive: n.alive, state: n.state, health: n.health };
    });
  }

  /** A creature's feet and facing as drawn: between the last two steps, unless it was put somewhere else. */
  private drawnNpc(n: Npc): { feet: V3; yaw: number } {
    const a = this.alpha;
    const p = this.npcPrev.get(n.id);
    let feet: V3 = [n.feet.x, n.feet.y, n.feet.z], yaw = n.yaw;
    if (p && a < 1 && Math.abs(feet[0] - p[0]!) + Math.abs(feet[1] - p[1]!) + Math.abs(feet[2] - p[2]!) < SNAP) {
      feet = [p[0]! + (feet[0] - p[0]!) * a, p[1]! + (feet[1] - p[1]!) * a, p[2]! + (feet[2] - p[2]!) * a];
      let d = yaw - p[3]!;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yaw = p[3]! + d * a;
    }
    return { feet, yaw };
  }

  /** A hit by a weapon or a blast: “When this is hit” runs on it and what it is inside; breakables lose health. */
  private weaponDamage(target: string, amount: number, by: string, cause: string): void {
    if (!(amount > 0)) return;
    if (target === 'player') return this.hurt(amount, by === 'player' ? `your own ${cause}` : cause);
    // (A finished build piece: crowbars, bullets and blasts knock it down.)
    if (target.startsWith(BASE_OWNER)) return this.base?.damage(target.slice(BASE_OWNER.length), amount);
    if (target === MINE_OWNER) return;
    const npc = this.npcs.get(target);
    if (npc) {
      if (!npc.alive) return;
      this.runner.dispatch({ type: 'hit', targets: [target, ...this.ancestorsOf(target)] });
      if (npc.hurt(amount)) {
        this.bus.emit({ type: 'npc.die', target, time: this.time });
        this.runner.dispatch({ type: 'dies', target });
      }
      return;
    }
    const targets: string[] = [];
    for (let x: string | null | undefined = target; x; x = this.parentOf.get(x)) targets.push(x);
    this.runner.dispatch({ type: 'hit', targets });
    const breakable = targets.find((t) => this.breakHealth.has(t));
    if (breakable) this.damage(breakable, amount);
  }

  /** Projectiles in flight, for drawing. */
  projectilesNow(): { id: number; at: V3; arc: boolean }[] {
    return this.weapons.projectiles.map((p) => ({ id: p.id, at: [...p.at] as V3, arc: p.weapon.arc }));
  }

  // ── Paths and trains ──

  private addTrain(id: string, data: TrainData): void {
    const b = this.bodies.get(id);
    const first = this.pathPoints.get(data.start);
    if (!b || !first) return;
    // Starts at its first point, heading for the next.
    b.body.setTranslation({ x: first.p[0], y: first.p[1], z: first.p[2] }, true);
    const next = this.pathPoints.has(first.data.next) ? first.data.next : null;
    this.trains.push({ id, data, at: data.start, to: next, speed: first.data.speed > 0 ? first.data.speed : data.speed, moving: data.moving && next !== null, waitUntil: this.time + first.data.wait });
  }

  /** Trains move along their paths by one step: on to the next point, waiting, changing speed, sending messages. */
  private moveTrains(): void {
    for (const t of this.trains) {
      if (!t.moving || t.to === null || this.time < t.waitUntil) continue;
      const b = this.bodies.get(t.id);
      if (!b) continue;
      const cur = b.body.translation();
      let pos: [number, number, number] = [cur.x, cur.y, cur.z];
      let left = t.speed * STEP;
      for (let guard = 0; guard < 16 && left > 1e-6 && t.moving && t.to !== null && this.time >= t.waitUntil; guard++) {
        const target = this.pathPoints.get(t.to)!.p;
        const d = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
        const dist = Math.hypot(d[0]!, d[1]!, d[2]!);
        if (dist <= left) {
          pos = [...target];
          left -= dist;
          this.trainArrives(t);
        } else {
          pos = [pos[0] + (d[0]! / dist) * left, pos[1] + (d[1]! / dist) * left, pos[2] + (d[2]! / dist) * left];
          left = 0;
        }
      }
      b.body.setNextKinematicTranslation({ x: pos[0], y: pos[1], z: pos[2] });
      // Facing its way (turning about the vertical only).
      const dx = pos[0] - cur.x, dz = pos[2] - cur.z;
      if (t.data.turns && Math.hypot(dx, dz) > 1e-4) {
        const yaw = Math.atan2(-dx, -dz);
        b.body.setNextKinematicRotation(qmul({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, b.start.q));
      }
    }
  }

  /** A train reached its next point. */
  private trainArrives(t: GameWorld['trains'][number]): void {
    const point = this.pathPoints.get(t.to!)!;
    t.at = t.to;
    if (point.data.speed > 0) t.speed = point.data.speed;
    if (point.data.wait > 0) t.waitUntil = this.time + point.data.wait;
    const msg = point.data.message.trim();
    if (msg) {
      this.bus.emit({ type: 'message', name: msg, from: t.at, time: this.time });
      this.runner.dispatch({ type: 'message', message: msg, to: null, from: t.at });
    }
    t.to = this.pathPoints.has(point.data.next) ? point.data.next : null;
    if (t.to === null) t.moving = false;
  }

  /** Where a train is: the point it last reached, the one it is heading for, and whether it is moving. */
  trainState(id: string): { at: string | null; to: string | null; moving: boolean } | null {
    const t = this.trains.find((x) => x.id === id);
    return t ? { at: t.at, to: t.to, moving: t.moving } : null;
  }

  /** Holding Use on a charger: it gives health or armour, a little each step, until it is empty or the player is full. */
  private charge(): void {
    const hit = this.player!.aim();
    let id = hit ? this.owner.get(hit.handle) : undefined;
    let c: { data: ChargerData; left: number } | undefined;
    for (; id && id !== 'player' && !c; id = this.parentOf.get(id) ?? undefined) c = this.chargers.get(id);
    if (!c || c.left <= 0 || !this.rules.health) return;
    const armour = c.data.gives === 'armour';
    const room = armour ? MAX_ARMOUR - this.armour : this.maxHealth - this.health;
    const give = Math.min(c.data.rate * STEP, c.left, room);
    if (give <= 0) return;
    c.left -= give;
    if (armour) this.giveArmour(give);
    else this.heal(give);
  }

  /** What a charger has left to give (for tests and the inspector), or undefined. */
  chargerLeft(id: string): number | undefined {
    return this.chargers.get(id)?.left;
  }

  /** The player pressed Use: on the next step, whatever they look at within reach gets “When the player uses this”. */
  use(): void {
    if (!this.frozen) this.useQueued = true;
  }

  /** The camera for the player's view, smoothed between physics steps. */
  playerView(): { eye: [number, number, number]; yaw: number; pitch: number; thirdPerson: boolean; feet: [number, number, number] } | null {
    const p = this.player;
    if (!p) return null;
    const cam = this.cameraEye() ?? (this.hiding ? this.hiddenView() : null);
    if (cam) {
      const f = p.feetPosition;
      return { ...cam, thirdPerson: false, feet: [f.x, f.y, f.z] };
    }
    const alpha = Math.min(1, this.accumulator / STEP);
    const eye = p.eye(alpha);
    const feet: [number, number, number] = [eye[0], eye[1] - (p.crouched ? PLAYER.crouchEye : PLAYER.eye), eye[2]];
    if (!this.rules.thirdPerson) return { eye, yaw: p.input.yaw, pitch: p.input.pitch, thirdPerson: false, feet };
    // Behind and a little above the head, pulled in when a wall is in the way.
    const d = p.lookDirection();
    const from = { x: eye[0], y: eye[1] + 40, z: eye[2] };
    const back = { x: -d[0], y: -d[1], z: -d[2] };
    const hit = this.world.castRay(new RAPIER.Ray(from, back), THIRD_PERSON_DISTANCE, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, 0xffffffff, p.collider);
    const dist = hit ? Math.max(8, hit.timeOfImpact - 8) : THIRD_PERSON_DISTANCE;
    return { eye: [from.x + back.x * dist, from.y + back.y * dist, from.z + back.z * dist], yaw: p.input.yaw, pitch: p.input.pitch, thirdPerson: true, feet };
  }

  private doUse(): void {
    if (this.hiding) {
      if (this.hiding.out === null && !this.frozen) this.leaveHiding();
      return;
    }
    if (this.base && this.useBase()) return;
    if (this.held) {
      if (this.powerHeldUse(true) === null && !this.useHolding()) this.dropHeld();
      return;
    }
    if (this.powerUse(true) !== null) return;
    // (A shelf on a wall comes down only for a held Use.)
    if (this.shelfLooked()) return;
    const hit = this.useAim();
    if (!hit) return;
    const { id, targets, distance } = hit;
    const spot = targets.find((t) => this.spots.has(t) && this.keyOf(t) === 'KeyE' && this.seatReady(t));
    if (spot && distance <= this.reachOf(spot)) return this.enterHiding(spot);
    if (distance <= PLAYER.useReach) {
      if (this.grab(id)) return;
      // Friends follow (or stay) when used.
      this.npcs.get(id)?.use();
    } else if (this.runner.usePrompt(targets, distance) === null) return;
    this.runner.dispatch({ type: 'use', targets, by: 'player', distance });
    this.bus.emit({ type: 'use', target: id, by: 'player', time: this.time });
  }

  // ── Carrying ──

  /** What the player holds: its body, and how far in front of their eyes it's held. */
  /** `turn`: how it is turned relative to the way the player faces (it turns with them; R and the mouse turn it). */
  private held: { id: string; body: RAPIER.RigidBody; distance: number; stuck: number; turn: Quat } | null = null;

  /** What the player holds (its object id), or null. */
  get holding(): string | null {
    return this.held?.id ?? null;
  }

  private isHeld(c: RAPIER.Collider): boolean {
    return !!this.held && c.parent()?.handle === this.held.body.handle;
  }

  /** What could be picked up from this object (it, or what it's part of), when Use has nothing else to do. */
  private carryable(id: string): string | null {
    const targets: string[] = [];
    for (let x: string | null | undefined = id; x; x = this.parentOf.get(x)) targets.push(x);
    // (A Use script, a friend or a charger comes first.)
    if (this.runner.usePrompt(targets) !== null || targets.some((t) => this.npcs.has(t) || this.chargers.has(t))) return null;
    for (const t of targets) {
      const b = this.bodies.get(t);
      if (!b) continue;
      if (this.printing.has(t)) return null;
      if (b.info.motion !== 'dynamic' || b.rb?.pickUp === false || (!this.posters.has(t) && b.body.mass() > MAX_CARRY)) return null;
      return t;
    }
    return null;
  }

  /** Pick an object up (true if it was). */
  private grab(id: string): boolean {
    const t = this.carryable(id);
    if (!t) return false;
    if (this.posters.get(t)?.hung) this.takeDownPoster(t);
    if (this.stakes.get(t)?.stuck) this.pullStake(t);
    if (this.junky.has(t)) this.packJunk(t, true);
    this.hold(t, this.bodies.get(t)!.body);
    return true;
  }

  /**
   * The wheel while carrying: the thing comes closer or goes further (by `by` u, kept HOLD_NEAR–HOLD_FAR).
   * False when nothing is carried (the wheel does its usual job).
   */
  moveHeld(by: number): boolean {
    if (!this.held) return false;
    this.held.distance = Math.max(HOLD_NEAR, Math.min(HOLD_FAR, this.held.distance + by));
    return true;
  }

  /** Into the player's hands, as far in front of their eyes as it is now (56–96 u). */
  private hold(id: string, body: RAPIER.RigidBody): void {
    const [x, y, z] = this.player!.eye();
    const at = body.translation();
    const r = body.rotation();
    const turn = qmul(qconj(this.facing()), { x: r.x, y: r.y, z: r.z, w: r.w });
    this.held = { id, body, distance: Math.max(56, Math.min(96, Math.hypot(at.x - x, at.y - y, at.z - z))), stuck: 0, turn };
    body.wakeUp();
    this.bus.emit({ type: 'pickup', target: id, by: 'player', time: this.time });
  }

  /** The way the player faces (turned about up only). */
  private facing(): Quat {
    const yaw = this.player?.input.yaw ?? 0;
    return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  }

  /** Turn what's held by a mouse movement (pixels): sideways spins it, up and down tips it. */
  rotateHeld(dx: number, dy: number): void {
    const h = this.held;
    if (!h) return;
    const a = -dx * HELD_TURN, b = dy * HELD_TURN;
    const spin = { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
    const tip = { x: Math.sin(b / 2), y: 0, z: 0, w: Math.cos(b / 2) };
    const q = qmul(spin, qmul(tip, h.turn));
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    h.turn = { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
  }

  /** Let go of what's held (it keeps the speed it has). */
  dropHeld(): void {
    if (!this.held) return;
    const id = this.held.id;
    this.held = null;
    const st = this.strings.get(id);
    if (st?.half) {
      st.half = null;
      st.version++;
    }
    this.bus.emit({ type: 'drop', target: id, by: 'player', time: this.time });
  }

  /** Throw what's held where the player looks: lighter things fly faster. */
  private throwHeld(): void {
    const h = this.held;
    if (!h) return;
    const d = this.player!.lookDirection();
    const speed = Math.min(1000, 2400 / Math.sqrt(Math.max(1, h.body.mass())));
    h.body.setLinvel({ x: d[0] * speed, y: d[1] * speed, z: d[2] * speed }, true);
    this.dropHeld();
  }

  /** Each step: steer what's held to its place in front of the player; it's dropped if it stays stuck far off. */
  private carryHeld(): void {
    const h = this.held;
    if (!h) return;
    const p = this.player!;
    if (!this.world.getRigidBody(h.body.handle) || !h.body.isDynamic() || !h.body.isEnabled() || this.frozen) return this.dropHeld();
    const [x, y, z] = p.eye();
    const d = p.lookDirection();
    const at = h.body.translation();
    const off = { x: x + d[0] * h.distance - at.x, y: y + d[1] * h.distance - at.y, z: z + d[2] * h.distance - at.z };
    const far = Math.hypot(off.x, off.y, off.z);
    // (Kept far off for a while: it's caught on something.)
    h.stuck = far > CARRY_SLIP ? h.stuck + STEP : 0;
    if (h.stuck > 0.4) return this.dropHeld();
    // Speed to get there in a tenth of a second (capped), so it bumps into walls rather than going through.
    const k = Math.min(10, CARRY_SPEED / Math.max(1e-3, far));
    h.body.setLinvel({ x: off.x * k, y: off.y * k, z: off.z * k }, true);
    // Turned toward its place too (spun the short way, in about a tenth of a second).
    const r = h.body.rotation();
    let dq = qmul(qmul(this.facing(), h.turn), qconj({ x: r.x, y: r.y, z: r.z, w: r.w }));
    if (dq.w < 0) dq = { x: -dq.x, y: -dq.y, z: -dq.z, w: -dq.w };
    const s = Math.hypot(dq.x, dq.y, dq.z);
    const angle = 2 * Math.atan2(s, dq.w);
    const rate = s > 1e-6 ? Math.min(30, angle * 10) / s : 0;
    h.body.setAngvel({ x: dq.x * rate, y: dq.y * rate, z: dq.z * rate }, true);
  }

  // ── Health and score ──

  /**
   * Take health from the player (a negative amount heals). At 0 the player dies. Armour takes 80% of the
   * damage, spending one point for every two it stops, as in Half-Life; falls and drowning go past it.
   */
  hurt(amount: number, cause = 'something', pastArmour = false): void {
    if (!this.player || !this.rules.health || !Number.isFinite(amount)) return;
    if (amount < 0) return this.heal(-amount);
    if (amount === 0) return;
    let toHealth = amount;
    if (this.armour > 0 && !pastArmour) {
      toHealth = amount * 0.2;
      let cost = (amount - toHealth) * 0.5;
      if (cost > this.armour) {
        // Not enough armour: it stops what it can.
        toHealth = amount - this.armour * 2;
        cost = this.armour;
      }
      this.armour = Math.max(0, this.armour - cost);
    }
    this.health = Math.max(0, this.health - toHealth);
    this.hurtAt = this.time;
    this.bus.emit({ type: 'player.hurt', amount, health: this.health, cause, time: this.time });
    if (this.health <= 0) this.die(cause);
  }

  /** Give the player armour, up to 100. */
  giveArmour(amount: number): void {
    if (!this.player || !this.rules.health || !Number.isFinite(amount)) return;
    this.armour = Math.max(0, Math.min(MAX_ARMOUR, this.armour + amount));
  }

  /** Give health back, up to the maximum. */
  heal(amount: number): void {
    if (!this.player || !this.rules.health || !Number.isFinite(amount)) return;
    if (amount < 0) return this.hurt(-amount);
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** Most health the player can have (mining skills add to it). */
  get maxHealth(): number {
    return PLAYER.maxHealth + (this.mine?.stat('maxHealth') ?? 0);
  }

  addScore(by: number): void {
    if (!this.rules.score || !Number.isFinite(by) || by === 0) return;
    this.score += by;
    this.usesScore = true;
    this.bus.emit({ type: 'score', score: this.score, by, time: this.time });
  }

  /** The player dies: “When the player dies” runs, and they start again at the Player start with full health. */
  private die(cause: string): void {
    this.dropHeld();
    if (!this.player) return;
    this.deaths++;
    this.mine?.died();
    this.health = this.maxHealth;
    this.armour = 0;
    this.stopHiding();
    this.player.respawn();
    this.bus.emit({ type: 'player.die', cause, time: this.time });
    this.runner.dispatch({ type: 'die' });
  }

  // ── Game values, messages and signs ──

  /** Show a message on screen (the newest is shown; each lasts its own time). */
  say(text: string, seconds: number, from = ''): void {
    this.messages.push({ text, until: this.time + seconds, from });
    if (this.messages.length > 8) this.messages.shift();
  }

  /** The messages on screen now, oldest first. */
  screenMessages(): string[] {
    this.messages = this.messages.filter((m) => m.until > this.time);
    return this.messages.map((m) => m.text);
  }

  /** Every game value with its current value, and whether it's shown on screen. */
  gameValues(): { name: string; value: Value; show: boolean }[] {
    return this.valueDefs.map((d) => ({ name: d.name, value: this.globals.get(d.name) ?? null, show: d.show }));
  }

  /** What a text sign says now (undefined if the object isn't a sign). */
  signText(id: string): string | undefined {
    return this.signs.get(id);
  }

  playerStatus(): PlayerStatus | null {
    if (!this.player) return null;
    return { showHealth: this.rules.health && !this.rules.hideHealth, hasHealth: this.rules.health, health: this.health, maxHealth: this.maxHealth, armour: this.armour, weapon: this.weaponStatus(), score: this.score, showScore: this.usesScore, day: this.showDay ? this.day : null, clock: this.showClock ? this.dayHour : null, sinceHurt: this.time - this.hurtAt, deaths: this.deaths, stamina: this.rules.stamina ? this.player!.stamina : null, showFps: this.rules.showFps, weak: this.weakness() };
  }

  /**
   * How badly hurt the player is, 0–1, when health is kept but hidden: nothing above 40 health, all of it at 10
   * and below (0 when health is shown or off).
   */
  weakness(): number {
    if (!this.rules.health || !this.rules.hideHealth || this.health <= 0) return 0;
    return Math.min(1, Math.max(0, (WEAK.from - this.health) / (WEAK.from - WEAK.full)));
  }

  // ── What scripts can do ──

  private act(name: ActionName, target: string, args: Value[]): (() => boolean) | null {
    if (target === 'player') return this.actOnPlayer(name, args);
    const label = this.names.get(target) ?? 'That object';
    const npc = this.npcs.get(target);
    if (name === 'setSide') {
      if (!npc) throw new Error(`${label} isn't a creature. Add the Creature component to it.`);
      npc.setSide(args[0] === 'friendly' || args[0] === 'neutral' ? args[0] : 'hostile');
      return null;
    }
    if (name === 'walkTo') {
      if (!npc) throw new Error(`${label} isn't a creature. Add the Creature component to it.`);
      const to = this.placePoint(args[0] ?? null);
      return to ? npc.walkTo({ x: to[0], y: to[1], z: to[2] }) : null;
    }
    if (name === 'runAway' || name === 'wander') {
      if (!npc) throw new Error(`${label} isn't a creature. Add the Creature component to it.`);
      if (name === 'wander') return npc.setWander(args[0] !== false), null;
      return npc.runAway(typeof args[0] === 'number' ? args[0] : 0);
    }
    if (name === 'viewFrom') {
      const seconds = typeof args[0] === 'number' ? Math.max(0, args[0]) : 0;
      const until = this.time + seconds;
      this.cameraView = { id: target, until };
      return () => this.time >= until || this.cameraView?.id !== target;
    }
    if (npc && name === 'damage') return this.weaponDamage(target, typeof args[0] === 'number' ? args[0] : 0, 'script', 'a script'), null;
    if (name === 'startTrain' || name === 'stopTrain') {
      const t = this.trains.find((x) => x.id === target || x.id === this.unitOf.get(target));
      if (!t) throw new Error(`${label} isn't a train. Add the Train component to it.`);
      t.moving = name === 'startTrain' && t.to !== null;
      return null;
    }
    if (name === 'damage') return this.damage(target, typeof args[0] === 'number' ? args[0] : 0), null;
    const light = this.lights.get(target);
    if (light && (name === 'turnOn' || name === 'turnOff' || name === 'show' || name === 'hide')) {
      const on = name === 'turnOn' || name === 'show';
      if (light.on !== on) this.bus.emit({ type: 'light', target, on, time: this.time });
      light.on = on;
      return null;
    }
    if (this.grid.sources.has(target) && (name === 'turnOn' || name === 'turnOff')) {
      this.switchPower(target, name === 'turnOn');
      if (!this.bodies.has(target)) return null;
    }
    const b = this.bodies.get(target) ?? this.bodies.get(this.unitOf.get(target) ?? '');
    if (!b) throw new Error(`${label} can't be moved or switched by scripts here.`);
    target = b.info.id;
    const n = (v: Value) => (typeof v === 'number' ? v : 0);
    const t = b.body.translation(), r = b.body.rotation();
    const now = { p: [t.x, t.y, t.z] as Q3, q: { x: r.x, y: r.y, z: r.z, w: r.w } };
    switch (name) {
      case 'move': {
        const [dist, dx, dy, dz, sec] = args.map(n) as [number, number, number, number, number];
        const goal = this.goalOf(target, now);
        return this.tween(target, b, now, { p: [goal.p[0] + dx * dist, goal.p[1] + dy * dist, goal.p[2] + dz * dist], q: goal.q }, sec);
      }
      case 'turn':
      case 'turnTo': {
        const axis = args[0] === 'north' ? [0, 0, -1] : args[0] === 'east' ? [1, 0, 0] : [0, 1, 0];
        const deg = n(args[1] ?? 0), sec = n(args[2] ?? 0);
        const half = (deg * Math.PI) / 360;
        const rq = { x: axis[0]! * Math.sin(half), y: axis[1]! * Math.sin(half), z: axis[2]! * Math.sin(half), w: Math.cos(half) };
        // “Turn by” adds to where it was turning to; “turn to” is measured from how it started.
        const goal = this.goalOf(target, now);
        return this.tween(target, b, now, { p: goal.p, q: qmul(rq, name === 'turn' ? goal.q : b.start.q) }, sec);
      }
      case 'return':
        return this.tween(target, b, now, b.start, n(args[0] ?? 0));
      case 'show':
      case 'hide':
        b.visible = name === 'show';
        this.setColliders(b, b.visible);
        return null;
      case 'turnOn':
      case 'turnOff':
        this.setColliders(b, name === 'turnOn');
        this.switched.set(b.info.id, name === 'turnOn');
        return null;
      case 'remove':
        this.remove(target);
        return null;
      case 'scale': {
        const factor = Math.max(0.01, n(args[0] ?? 1)), sec = n(args[1] ?? 0);
        return this.tween(target, b, { ...now, s: b.scale }, { ...now, s: factor }, sec);
      }
      case 'physical':
        this.makePhysical(b);
        return null;
      case 'place': {
        const spot = args[0] ?? null;
        const at = this.placePoint(spot);
        if (!at || !spot || typeof spot !== 'object') throw new Error('Pick a spot (an object) to put it at.');
        if (spot.ref === target) return null;
        if (this.held?.id === target) this.dropHeld();
        this.tweens.delete(target);
        // Turned as the spot is turned (an unturned spot: as it was placed in the editor).
        const sb = this.bodies.get(spot.ref);
        const sq = sb && sb.info.id === spot.ref ? sb.body.rotation() : this.doc.get(spot.ref) ? quatFromMatrix(this.doc.worldMatrix(spot.ref)) : { x: 0, y: 0, z: 0, w: 1 };
        const ql = Math.hypot(sq.x, sq.y, sq.z, sq.w) || 1;
        const q = qmul({ x: sq.x / ql, y: sq.y / ql, z: sq.z / ql, w: sq.w / ql }, b.start.q);
        const still = args[1] !== false;
        b.body.setBodyType(still ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
        b.info.motion = still ? 'kinematic' : 'dynamic';
        b.body.setTranslation({ x: at[0], y: at[1], z: at[2] }, true);
        b.body.setRotation(q, true);
        if (still) {
          b.body.setNextKinematicTranslation({ x: at[0], y: at[1], z: at[2] });
          b.body.setNextKinematicRotation(q);
        } else {
          b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        return null;
      }
      case 'pickUp': {
        if (this.held?.id === target || !this.player) return null;
        this.dropHeld();
        this.tweens.delete(target);
        if (!b.body.isDynamic()) {
          if (b.rb) {
            b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            b.info.motion = 'dynamic';
          } else this.makePhysical(b);
        }
        this.hold(target, b.body);
        return null;
      }
      case 'push': {
        const [dx, dy, dz, strength] = args.map(n) as [number, number, number, number];
        if (!b.body.isDynamic()) throw new Error(`${label} doesn't move by physics, so it can't be pushed. Use “Make it fall” first, or give it Physics.`);
        const v = b.body.linvel();
        b.body.setLinvel({ x: v.x + dx * strength, y: v.y + dy * strength, z: v.z + dz * strength }, true);
        return null;
      }
      case 'moveTo': {
        const to = this.placePoint(args[0] ?? null);
        if (!to) return null;
        const gap = Math.max(0, n(args[2] ?? 0));
        const d = [to[0] - now.p[0], to[1] - now.p[1], to[2] - now.p[2]];
        const len = Math.hypot(d[0]!, d[1]!, d[2]!);
        // Already close enough: stay put, but still take the time (so a loop of these waits).
        const k = len > gap ? (len - gap) / len : 0;
        return this.tween(target, b, now, { p: [now.p[0] + d[0]! * k, now.p[1] + d[1]! * k, now.p[2] + d[2]! * k], q: now.q }, n(args[1] ?? 0));
      }
      case 'teleport':
        return null;
      default:
        // (Handled above: trains, creatures, cameras, the player.)
        return null;
    }
  }

  /** Actions on the player: push and teleport. */
  private actOnPlayer(name: ActionName, args: Value[]): null {
    const p = this.player;
    if (!p) return null;
    const n = (v: Value) => (typeof v === 'number' ? v : 0);
    if (name === 'freeze' || name === 'unfreeze') {
      this.frozen = name === 'freeze';
      return null;
    }
    if (name === 'silence' || name === 'unsilence') {
      this.silent = name === 'silence';
      return null;
    }
    if (name === 'drop') return this.dropHeld(), null;
    if (name === 'unhide') return this.leaveHiding(), null;
    if (name === 'teleport') this.stopHiding();
    if (name === 'push') {
      const [dx, dy, dz, strength] = args.map(n) as [number, number, number, number];
      p.push(dx * strength, dy * strength, dz * strength);
    } else if (name === 'teleport') {
      const place = args[0] ?? null;
      const to = this.placePoint(place);
      if (!to) return null;
      // Facing the way the object faces (−Z), when it's an object.
      let yaw: number | undefined;
      if (place && typeof place === 'object' && place.ref !== 'player') {
        const m = this.motionOf(place.ref) ?? null;
        const e = this.doc.get(place.ref);
        const w = e ? this.doc.worldMatrix(e.id) : null;
        const fwd = w ? (m ? multiply(m, w) : w) : null;
        if (fwd) yaw = Math.atan2(fwd[8]!, fwd[10]!);
      }
      p.teleport({ x: to[0], y: to[1], z: to[2] }, yaw);
    } else throw new Error('That block works on objects, not on the player.');
    return null;
  }

  /** Where a place is: an object's pivot (where it is now), the player's feet, or the spot the player looks at. */
  private placePoint(place: Value): Q3 | null {
    if (place === 'aim') {
      const hit = this.player?.look(1024);
      return hit ? hit.point : null;
    }
    if (!place || typeof place !== 'object') return null;
    if (place.ref === 'player') {
      const f = this.player?.feetPosition;
      return f ? [f.x, f.y, f.z] : null;
    }
    // A creature: where it has walked to (its feet).
    const npc = this.npcs.get(place.ref);
    if (npc) return [npc.feet.x, npc.feet.y, npc.feet.z];
    const b = this.bodies.get(place.ref) ?? this.bodies.get(this.unitOf.get(place.ref) ?? '');
    if (b && b.info.id === place.ref) {
      const t = b.body.translation();
      return [t.x, t.y, t.z];
    }
    if (!this.doc.get(place.ref)) return null;
    const p = pivotOf(this.doc, place.ref, boundsOfEntity);
    // Inside a moving unit: where it has moved to.
    const m = b ? this.motionOf(b.info.id) : null;
    return m ? transformPoint(m, p) : p;
  }

  // ── Copies ──

  /**
   * Make a copy of an object and everything inside it at a place (its pivot lands there). The copy is a body
   * of its own (physics if the original has Physics, otherwise one scripts can move), and runs its scripts,
   * with references inside the copy pointing at the copy. The original can be hidden: a template.
   */
  spawn(template: string, place: Value): string | null {
    if (!this.doc.get(template)) throw new Error(`${this.names.get(template) ?? 'That object'} can't be copied: only objects placed in the scene can.`);
    const at = this.placePoint(place);
    return at ? this.makeCopy(template, at) : null;
  }

  /** A copy of `template` with its pivot at `at`: copy number `n` (a saved copy coming back), else the next free one. */
  private makeCopy(template: string, at: Q3, n?: number): string {
    const root = this.doc.get(template)!;
    const anchor = pivotOf(this.doc, template, boundsOfEntity);
    const offset: Q3 = [at[0] - anchor[0], at[1] - anchor[1], at[2] - anchor[2]];
    const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], offset[2], 1];
    // (Never a number a copy already has: saved copies come back with theirs.)
    if (n === undefined) {
      n = ++this.copies;
      while (this.names.has(`${template}#${n}`)) n = ++this.copies;
    } else this.copies = Math.max(this.copies, n);
    const ids = new Map<string, string>();
    // Everything inside that is shown (the original itself may be hidden).
    const shownIn = (e: EntityData) => {
      for (let x: EntityData | undefined = e; x && x.id !== template; x = x.parent ? this.doc.get(x.parent) : undefined) if (!x.visible) return false;
      return true;
    };
    const parts = this.doc.subtree(template).filter(shownIn);
    for (const e of parts) ids.set(e.id, `${e.id}#${n}`);
    const copyId = ids.get(template)!;
    const remap = <T>(v: T): T => {
      let json = JSON.stringify(v);
      for (const [a, b] of ids) json = json.split(`"${a}"`).join(`"${b}"`);
      return JSON.parse(json) as T;
    };
    const rootHasBody = !!root.components.rigidBody;
    const sounds: [string, SoundData, number[]][] = [];
    // The copy is one unit, except parts its own scripts move by themselves (a lid that falls off): units of their own.
    const inCopy = new Set(parts.map((e) => e.id));
    const ownBody = (e: EntityData) => !!e.components.rigidBody || !!e.components.trigger || !!e.components.water || !!e.components.ladder || !!e.components.levelChange || !!e.components.npc || !!e.components.soundArea;
    const named = rootHasBody ? [] : scriptTargets(parts.filter((e) => e.components.script).map((e) => [e.id, e.components.script as unknown as Script])).filter((t) => t !== template && inCopy.has(t) && !ownBody(this.doc.get(t)!));
    const subRoots = named.filter((t) => !named.some((o) => o !== t && this.doc.isAncestor(o, t)));
    const unitOfPart = (e: EntityData): string => {
      for (let x: EntityData | undefined = e; x && x.id !== template; x = x.parent ? this.doc.get(x.parent) : undefined) if (subRoots.includes(x.id)) return x.id;
      return template;
    };
    const units = new Map<string, { brushes: Brush[]; points: UnitPoint[]; riders: { id: string; matrix: number[] }[] }>();
    const unitFor = (e: EntityData) => {
      const u = unitOfPart(e);
      if (!units.has(u)) units.set(u, { brushes: [], points: [], riders: [] });
      this.unitOf.set(ids.get(e.id)!, ids.get(u)!);
      return units.get(u)!;
    };
    for (const e of parts) {
      const id = ids.get(e.id)!;
      const copy: EntityData = { ...remap(e), id };
      this.names.set(id, e.name);
      this.parentOf.set(id, e.id === template ? null : (ids.get(e.parent ?? '') ?? null));
      const world = multiply(shift, this.doc.worldMatrix(e.id));
      const brushData = e.components.brush as unknown as (BrushData & { role?: string }) | undefined;
      // Inside a part of the copy that has a body of its own (a prop with Physics): carried by it, drawn with it.
      let carrier: string | null = null;
      if (e.id !== template && !e.components.rigidBody && !ownBody(e) && !e.components.poster)
        for (let p = e.parent; p && ids.has(p) && !carrier; p = this.doc.get(p)?.parent ?? null) {
          const b = this.bodies.get(ids.get(p)!);
          if (b && (b.info.kind === 'brush' || b.info.kind === 'point')) carrier = ids.get(p)!;
        }
      if (carrier) {
        const b = this.bodies.get(carrier)!;
        this.unitOf.set(id, carrier);
        if (brushData?.faces) {
          if (brushData.role !== 'subtract') this.carryBrush(carrier, id, brushToWorld(fromData({ faces: brushData.faces, mesh: brushData.mesh }), world));
        } else if (e.components.model) (b.riders ??= []).push({ id, matrix: world });
      } else if (brushData?.faces) {
        const brush = brushToWorld(fromData({ faces: brushData.faces, mesh: brushData.mesh }), world);
        if (e.components.trigger) this.addTrigger(copy, brush, false);
        else if (e.components.rigidBody) this.addBrushBody(copy, brush);
        else if (brushData.role !== 'subtract' && !rootHasBody) unitFor(e).brushes.push(brush);
      } else if (e.components.poster) this.addPoster(copy, world);
      else if (!rootHasBody && !e.components.rigidBody && (e.components.model || e.components.collider)) {
        const u = unitFor(e);
        u.points.push({ e, id, world });
        if (e.components.model) u.riders.push({ id, matrix: world });
      } else if (e.components.rigidBody || e.components.collider || this.modelShape(e)) this.addPointBody(copy, world);
      if (e.components.breakable) this.breakHealth.set(id, readComponent<BreakableData>('breakable', e.components.breakable).health);
      if (e.components.sign) {
        this.signs.set(id, String((e.components.sign as { text?: unknown }).text ?? ''));
        this.spawnedSigns.push({ id, matrix: world });
      }
      if (e.components.sound) sounds.push([id, readComponent<SoundData>('sound', e.components.sound), world]);
      if (e.components.light) {
        // A light in the copy: as set up on the original (switched off at start stays off), carried by what it is in.
        const l = readComponent<LightData>('light', e.components.light);
        const still = (v: number[]): Fade => ({ from: v, to: v, t0: 0, t1: 0 });
        this.lights.set(id, { on: l.on !== false, intensity: still([l.intensity]), range: still([l.range]), angle: still([l.angle]), color: still(rgbOf(l.color)) });
        this.copyLightAt.set(id, world);
      }
    }
    for (const [u, { brushes, points, riders }] of units) {
      const id = ids.get(u)!;
      if (this.bodies.has(id) || (!brushes.length && !points.length && !riders.length)) continue;
      const p = u === template ? at : pivotOf(this.doc, u, boundsOfEntity);
      const pivot: [number, number, number] = u === template ? [p[0], p[1], p[2]] : [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
      this.addUnit(id, multiply(shift, this.doc.worldMatrix(u)), brushes, pivot, points, u !== template);
      if (riders.length) this.bodies.get(id)!.riders = riders;
    }
    // Point objects without a body of their own ride the nearest body they are inside (a timer on a thrown bomb).
    for (const e of parts) {
      const id = ids.get(e.id)!;
      if (this.bodies.has(id) || this.unitOf.has(id)) continue;
      for (let p = e.parent; p && ids.has(p); p = this.doc.get(p)?.parent ?? null) {
        const pid = ids.get(p)!;
        const body = this.bodies.has(pid) ? pid : this.unitOf.get(pid);
        if (body) {
          this.unitOf.set(id, body);
          break;
        }
      }
    }
    for (const id of ids.values()) {
      const b = this.bodies.get(id);
      if (b && b.info.kind !== 'zone') {
        b.info.copy = true;
        this.spawnedIds.push(id);
      }
    }
    // Scripts of the copy.
    const objects = new Map(this.scriptInfo.objects);
    for (const e of parts) objects.set(ids.get(e.id)!, { name: e.name, isZone: !!e.components.trigger });
    const info = { ...this.scriptInfo, objects, signs: new Set(this.signs.keys()), lights: new Set(this.lights.keys()) };
    for (const e of parts) {
      const script = e.components.script as unknown as Script | undefined;
      if (!script?.handlers) continue;
      const r = compileScript(ids.get(e.id)!, remap(script), info);
      this.runner.addProgram(r.program);
    }
    for (const [from, to] of ids) this.copyOf.set(to, from);
    // (Copies made when the game starts are made again by the same blocks when a saved game starts.)
    this.made.set(copyId, { template, n, at: [at[0], at[1], at[2]], atStart: !this.started, parts: [...ids.values()] });
    this.bus.emit({ type: 'spawn', template, copy: copyId, time: this.time });
    for (const [id, s, w] of sounds) this.startSound(id, s, this.bodyOf(id) ? null : [w[12]!, w[13]!, w[14]!]);
    return copyId;
  }

  // ── 3D printers ──

  /** Printers: their settings and the print under way. */
  private printers = new Map<string, { data: PrinterData; job: PrintJob | null }>();
  /** Bodies of prints under way (they don't move, collide or get picked up), with their body type to go back to. */
  private printing = new Map<string, RAPIER.RigidBodyType>();

  /**
   * Print a copy of `template` on `printer`: the copy, or null when the printer ignores it (it is printing, or
   * something is in its print space: a finished print, a prop, the player).
   */
  print(template: string, printer: string): string | null {
    if (!this.doc.get(template)) throw new Error(`${this.names.get(template) ?? 'That object'} can't be printed: only objects placed in the scene can.`);
    const p = this.printers.get(printer);
    if (!p) throw new Error(`${this.names.get(printer) ?? 'That object'} is not a 3D printer.`);
    if (p.job || this.printSpaceTaken(printer, p.data)) return null;
    return this.startPrint(printer, template);
  }

  /** Whether a printer can't start: printing, or anything but the printer itself in its print space. */
  printerBusy(id: string): boolean | undefined {
    const p = this.printers.get(id);
    return p ? !!p.job || this.printSpaceTaken(id, p.data) : undefined;
  }

  /** Anything (a body, the player) in the print space above the plate, other than the printer and its parts. */
  private printSpaceTaken(id: string, data: PrinterData): boolean {
    const m = this.doc.worldMatrix(id);
    const t = decomposeMat4(m);
    const k = t.scale.map(Math.abs);
    // (From a little above the plate, so the plate itself isn't counted.)
    const lift = 0.5, h = Math.max(1, data.size[1] - lift);
    const c = applyMat4(m, [data.bed[0], data.bed[1] + lift + h / 2, data.bed[2]]);
    const q = quatFromMatrix(composeTransform({ position: t.position, rotation: t.rotation, scale: [1, 1, 1] }));
    const box = new RAPIER.Cuboid(Math.max(0.1, (data.size[0] * k[0]!) / 2 - 0.1), Math.max(0.1, (h * k[1]!) / 2 - 0.1), Math.max(0.1, (data.size[2] * k[2]!) / 2 - 0.1));
    let taken = false;
    this.world.intersectionsWithShape({ x: c[0], y: c[1], z: c[2] }, q, box, (col) => {
      if (col.isSensor() || !col.isEnabled() || col.parent()?.handle === this.standInBody.handle) return true;
      for (let x: string | null | undefined = this.owner.get(col.handle); x; x = this.parentOf.get(x)) if (x === id) return true;
      taken = true;
      return false;
    });
    return taken;
  }

  /** Prints under way, for drawing: the printer, the copy and its parts, how far along (0–1). */
  prints(): { printer: string; copy: string; parts: string[]; done: number }[] {
    const out: { printer: string; copy: string; parts: string[]; done: number }[] = [];
    for (const [id, p] of this.printers) if (p.job) out.push({ printer: id, copy: p.job.copy, parts: this.made.get(p.job.copy)?.parts ?? [p.job.copy], done: Math.min(1, p.job.t / p.job.seconds) });
    return out;
  }

  /** Start printing: the copy stands on the plate, still and untouchable until done (`t`: seconds already printed). */
  private startPrint(id: string, template: string, n?: number, t = 0): string {
    const p = this.printers.get(id)!;
    const m = this.doc.worldMatrix(id);
    const bed = applyMat4(m, p.data.bed);
    const b = this.templateBounds(template);
    const pivot = pivotOf(this.doc, template, boundsOfEntity);
    // (Its bottom on the plate, the middle of it over the plate's middle.)
    const at: Q3 = b ? [bed[0] + pivot[0] - (b.min[0] + b.max[0]) / 2, bed[1] + pivot[1] - b.min[1], bed[2] + pivot[2] - (b.min[2] + b.max[2]) / 2] : [bed[0], bed[1], bed[2]];
    const copy = this.makeCopy(template, at, n);
    const height = b ? Math.max(p.data.layerHeight, b.max[1] - b.min[1]) : p.data.size[1];
    const layers = Math.max(1, Math.ceil(height / Math.max(0.01, p.data.layerHeight)));
    p.job = { template, copy, n: this.made.get(copy)!.n, t, seconds: layers * Math.max(0.01, p.data.layerSeconds), atStart: !this.started };
    for (const part of this.made.get(copy)!.parts) {
      const body = this.bodies.get(part);
      if (!body) continue;
      this.printing.set(part, body.body.bodyType());
      if (body.info.kind !== 'zone') body.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
      for (let i = 0; i < body.body.numColliders(); i++) body.body.collider(i).setEnabled(false);
    }
    if (p.data.sound) this.bus.emit({ type: 'sound', sound: p.data.sound, at: [bed[0], bed[1], bed[2]], follow: null, volume: p.data.volume, loop: true, range: 768, source: `${id}:print`, time: this.time });
    this.bus.emit({ type: 'print.start', printer: id, copy, template, time: this.time });
    return copy;
  }

  /** Prints go on; a finished one is let go (it falls and can be picked up). */
  private stepPrinters(dt: number): void {
    for (const [id, p] of this.printers) {
      const job = p.job;
      if (!job) continue;
      job.t += dt;
      const gone = this.gone.has(job.copy);
      if (!gone && job.t < job.seconds) continue;
      for (const part of this.made.get(job.copy)?.parts ?? []) {
        const was = this.printing.get(part);
        this.printing.delete(part);
        const body = this.bodies.get(part);
        if (was === undefined || !body) continue;
        for (let i = 0; i < body.body.numColliders(); i++) body.body.collider(i).setEnabled(true);
        body.body.setBodyType(was, true);
      }
      p.job = null;
      if (p.data.sound) this.bus.emit({ type: 'sound.stop', source: `${id}:print`, time: this.time });
      if (!gone) {
        this.bus.emit({ type: 'print.done', printer: id, copy: job.copy, time: this.time });
        this.runner.dispatch({ type: 'printed', target: id, copy: job.copy });
      }
    }
  }

  /** Where an object (and everything in it) is now, as the scene has it: brushes, models and collision shapes. */
  private templateBounds(id: string): { min: [number, number, number]; max: [number, number, number] } | null {
    return worldBoundsOf(this.doc, id, (x) => {
      const brush = boundsOfEntity(x);
      if (brush) return brush;
      if (x.components.collider) {
        const c = readComponent<ColliderData>('collider', x.components.collider);
        return { min: [c.offset[0] - c.size[0] / 2, c.offset[1] - c.size[1] / 2, c.offset[2] - c.size[2] / 2], max: [c.offset[0] + c.size[0] / 2, c.offset[1] + c.size[1] / 2, c.offset[2] + c.size[2] / 2] };
      }
      const data = x.components.model ? readComponent<ModelData>('model', x.components.model) : null;
      const mesh = data ? this.models.get(data.model) : undefined;
      if (!data || !mesh || mesh.positions.length < 3) return null;
      const k = unitsOf(data), pos = mesh.positions;
      const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i++) {
        const a = i % 3, v = pos[i]! * k;
        if (v < min[a]!) min[a] = v;
        if (v > max[a]!) max[a] = v;
      }
      return { min, max };
    });
  }

  /** Lights in copies made while playing, and where each was placed (world matrix). */
  private copyLightAt = new Map<string, number[]>();

  /** Lights in copies that are still in the game (for drawing): each one's id and where it was placed. */
  copiedLights(): { id: string; matrix: number[] }[] {
    const out: { id: string; matrix: number[] }[] = [];
    for (const [id, matrix] of this.copyLightAt) if (!this.gone.has(id)) out.push({ id, matrix });
    return out;
  }

  /** A brush carried by a body (inside a copied prop with Physics): it collides and is drawn with it. */
  private carryBrush(carrier: string, id: string, brush: Brush): void {
    const b = this.bodies.get(carrier)!;
    const vs = vertices(brush);
    if (vs.length >= 4) {
      const pts = new Float32Array(vs.flatMap((v) => applyMat4(b.startInverse, v)));
      const desc = hull(pts);
      if (desc) this.owner.set(this.world.createCollider(this.material(desc, b.rb ?? readComponent<RigidBodyData>('rigidBody', {})), b.body).handle, id);
    }
    b.brushes.push(brush);
  }

  /** Take an object (and everything inside it) out of the game. */
  remove(id: string): void {
    const gone = new Set<string>();
    for (const [x] of this.parentOf) {
      for (let y: string | null | undefined = x; y; y = this.parentOf.get(y)) if (y === id) gone.add(x);
    }
    gone.add(id);
    for (const x of gone) this.gone.add(x);
    for (const x of gone) {
      const b = this.bodies.get(x);
      if (!b) {
        if (this.signs.has(x)) this.removedIds.push(x);
        continue;
      }
      for (let i = 0; i < b.body.numColliders(); i++) {
        const h = b.body.collider(i).handle;
        this.owner.delete(h);
        if (this.triggers.delete(h)) this.stats.triggers--;
      }
      this.world.removeRigidBody(b.body);
      this.bodies.delete(x);
      this.tweens.delete(x);
      if (b.info.kind !== 'zone') this.stats.bodies--;
      this.removedIds.push(x);
    }
    for (const z of this.triggers.values())
      for (const x of gone) {
        z.inside.delete(x);
        z.present.delete(x);
      }
    for (const x of gone) {
      this.loudSounds.delete(x);
      this.bus.emit({ type: 'sound.stop', source: x, time: this.time });
    }
    this.runner.removeOwners(gone);
  }

  /** Copies made and objects removed since the last call (for drawing). */
  /** Models a copy's unit carries (to draw them with it). */
  riders(id: string): { id: string; matrix: number[] }[] {
    return this.bodies.get(id)?.riders ?? [];
  }

  drainChanges(): { spawned: BodyInfo[]; removed: string[]; signs: { id: string; matrix: number[] }[] } {
    const spawned = this.spawnedIds.map((id) => this.bodies.get(id)?.info).filter((b): b is BodyInfo => !!b);
    const removed = this.removedIds;
    const signs = this.spawnedSigns;
    this.spawnedIds = [];
    this.removedIds = [];
    this.spawnedSigns = [];
    return { spawned, removed, signs };
  }

  /** A point object's collision shape and placement (for drawing it). */
  pointShape(id: string): { collider: ColliderData; matrix: number[] } | null {
    return this.bodies.get(id)?.shape ?? null;
  }

  /** Where a point body started (its world matrix): a collision shape's or a model's. */
  pointMatrix(id: string): number[] | null {
    const b = this.bodies.get(id);
    return b?.shape?.matrix ?? b?.model?.matrix ?? null;
  }

  // ── Sound ──

  /** A Sound component that plays from the start (or a copy's, as it appears). */
  private startSound(id: string, s: SoundData, at: Q3 | null): void {
    if (!s.sound || !s.playOnStart || this.stoppedSounds.has(id)) return;
    const p = at ?? this.placePoint({ ref: id });
    this.bus.emit({ type: 'sound', sound: s.sound, at: p, follow: this.bodyOf(id), volume: s.volume, loop: s.loop, range: s.range, source: id, areaEffects: s.areaEffects !== false, ambient: true, time: this.time });
    const loud = Number(s.loudness) || 0;
    if (loud > 0) {
      if (p) this.noise(this.v3(p), loud, this.spots.has(id) ? id : null);
      if (s.loop) this.loudSounds.set(id, { loudness: loud, next: this.time + LOUD_REPEAT });
    }
  }

  /** Looping sounds creatures can hear: they call again every few seconds while they play. */
  private loudSounds = new Map<string, { loudness: number; next: number }>();

  private callAgain(): void {
    for (const [id, s] of this.loudSounds) {
      if (this.time < s.next) continue;
      s.next = this.time + LOUD_REPEAT;
      const p = this.placePoint({ ref: id });
      if (p) this.noise(this.v3(p), s.loudness, this.spots.has(id) ? id : null);
    }
  }

  // ── What things sound like: footsteps, hits ──

  /** The world is silent (a block): the background and Sound components fall quiet; footsteps and hits stay. */
  silent = false;
  /** What each material sounds like, by id (set by whoever starts the game). */
  surfaces = new Map<string, Surface>();
  /** Brush colliders: their faces (world space when made) and the body that moves them, if any. */
  private faceInfo = new Map<number, { faces: { plane: Plane; surface: { material: string } }[]; body: { body: RAPIER.RigidBody; t: RAPIER.Vector; q: RAPIER.Rotation } | null }>();
  /** Terrain colliders: each corner's layer weights and what each layer sounds like. */
  private groundInfo = new Map<number, { indices: Uint32Array; weights: Float32Array; layers: Surface[] }>();
  private surfaceCache = new Map<string, Surface>();

  private noteFaces(c: RAPIER.Collider, brush: Brush, body: RAPIER.RigidBody): void {
    this.faceInfo.set(c.handle, { faces: brush.faces, body: { body, t: { ...body.translation() }, q: { ...body.rotation() } } });
  }

  private materialSurface(material: string): Surface {
    return this.surfaces.get(material) ?? guessSurface(material.split('/').pop() ?? material);
  }

  /** What an object sounds like as a whole: its Physics setting, its faces' commonest material, its model, its name. */
  surfaceOf(id: string): Surface {
    const cached = this.surfaceCache.get(id);
    if (cached) return cached;
    const base = id.split('#')[0]!;
    const e = this.doc.get(base);
    const rb = e?.components.rigidBody as { surface?: unknown } | undefined;
    let s: Surface = 'generic';
    if (isSurface(rb?.surface)) s = rb.surface;
    else if (e?.components.npc) s = 'flesh';
    else {
      const count = new Map<string, number>();
      const b = this.bodies.get(id)?.body;
      for (let i = 0; b && i < b.numColliders(); i++) for (const f of this.faceInfo.get(b.collider(i).handle)?.faces ?? []) count.set(f.surface.material, (count.get(f.surface.material) ?? 0) + 1);
      const top = [...count].sort((a, z) => z[1] - a[1])[0]?.[0];
      if (top) s = this.materialSurface(top);
      if (s === 'generic' && e?.components.model) {
        const m = readComponent<ModelData>('model', e.components.model);
        const mat = Object.values(m.materials ?? {})[0];
        s = mat ? this.materialSurface(mat) : guessSurface(m.model.split('/').pop() ?? '');
      }
      if (s === 'generic' && e) s = guessSurface(e.name);
    }
    this.surfaceCache.set(id, s);
    return s;
  }

  /** What is under a point of a collider: the face of a brush there, the painted ground of a terrain, or the object. */
  surfaceAt(handle: number, at: { x: number; y: number; z: number }, feature?: number): Surface {
    const id = this.owner.get(handle);
    const rb = id ? (this.doc.get(id.split('#')[0]!)?.components.rigidBody as { surface?: unknown } | undefined) : undefined;
    if (isSurface(rb?.surface)) return rb.surface;
    const f = this.faceInfo.get(handle);
    if (f?.faces.length) {
      let p = at;
      if (f.body) {
        // (Back to where the body was when its faces were noted.)
        const t = f.body.body.translation(), q = f.body.body.rotation();
        const local = rotate(conj(q), { x: at.x - t.x, y: at.y - t.y, z: at.z - t.z });
        const w = rotate(f.body.q, local);
        p = { x: w.x + f.body.t.x, y: w.y + f.body.t.y, z: w.z + f.body.t.z };
      }
      let best = f.faces[0]!, gap = Infinity;
      for (const face of f.faces) {
        const d = Math.abs(face.plane.n[0] * p.x + face.plane.n[1] * p.y + face.plane.n[2] * p.z - face.plane.d);
        if (d < gap) [best, gap] = [face, d];
      }
      return this.materialSurface(best.surface.material);
    }
    const g = this.groundInfo.get(handle);
    if (g && feature !== undefined && feature * 3 + 2 < g.indices.length) {
      const w = [0, 0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const v = g.indices[feature * 3 + k]!;
        for (let l = 0; l < 4; l++) w[l]! += g.weights[v * 4 + l] ?? 0;
      }
      return g.layers[w.indexOf(Math.max(...w))] ?? 'dirt';
    }
    if (g) return g.layers[0] ?? 'dirt';
    return id ? this.surfaceOf(id) : 'generic';
  }

  private stepLeft = 0;
  private wasOnGround = true;

  /** The player's footsteps: one every stride on the ground, a thump on landing, a scuff on jumping. */
  private footsteps(): void {
    const p = this.player!;
    const v = p.velocity;
    const feet = p.feetPosition;
    const under = (): Surface => {
      if (p.waterLevel >= 1) return 'water';
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray({ x: feet.x, y: feet.y + 4, z: feet.z }, { x: 0, y: -1, z: 0 }), 20, true, undefined, undefined, p.collider);
      if (!hit) return 'generic';
      return this.surfaceAt(hit.collider.handle, { x: feet.x, y: feet.y + 4 - hit.timeOfImpact, z: feet.z }, hit.featureId);
    };
    const step = (kind: 'step' | 'land' | 'jump', volume: number) => this.bus.emit({ type: 'step', kind, surface: under(), at: [feet.x, feet.y, feet.z], volume, time: this.time });
    if (p.landingSpeed > 120) step('land', Math.min(0.6, 0.15 + p.landingSpeed / 1500));
    else if (this.wasOnGround && !p.onGround && v.y > 100 && !p.onLadder) step('jump', 0.15);
    this.wasOnGround = p.onGround;
    const speed = Math.hypot(v.x, v.z);
    if (!p.onGround || p.waterLevel >= 2 || speed < 20) {
      this.stepLeft = Math.min(this.stepLeft, 12);
      return;
    }
    // (Longer strides the faster the player goes; quieter crouching and walking.)
    const sprint = speed > 250, walk = p.crouched || speed < 130;
    this.stepLeft -= speed * STEP;
    if (this.stepLeft > 0) return;
    this.stepLeft += p.crouched ? 95 : walk ? 122 : sprint ? 198 : 160;
    step('step', p.crouched ? 0.03 : walk ? 0.06 : sprint ? 0.15 : 0.1);
  }

  /** Velocities just before a physics step: what the step changes beyond gravity is what things hit. */
  private noteVelocities(): void {
    for (const b of this.bodies.values()) {
      if (b.info.motion !== 'dynamic' || b.info.kind === 'zone' || b.body.isSleeping() || !b.body.isDynamic()) {
        b.v0 = undefined;
        continue;
      }
      const v = b.body.linvel();
      (b.v0 ??= new Float64Array(3)).set([v.x, v.y, v.z]);
    }
  }

  private hits = new Map<string, { last: number; since: number; count: number; quietUntil: number }>();
  private heldTouching = false;

  /**
   * Hits: a body the step slowed sharply (its velocity changed against the way it was going). No sound for
   * small knocks, nothing more often than every 0.09 s per object, and an object chattering (resting badly,
   * squeezed in a pile) is quiet for a second after five hits in one: no Source-style buzzing piles.
   */
  private listenForHits(): void {
    const g = this.world.gravity;
    let left = 4;
    for (const b of this.bodies.values()) {
      const v0 = b.v0;
      if (!v0 || !b.body.isDynamic()) continue;
      const held = b.info.id === this.held?.id;
      const v = b.body.linvel(), k = b.body.gravityScale() * STEP;
      const dx = v.x - v0[0]! - g.x * k, dy = v.y - v0[1]! - g.y * k, dz = v.z - v0[2]! - g.z * k;
      const dv = Math.hypot(dx, dy, dz), was = Math.hypot(v0[0]!, v0[1]!, v0[2]!);
      // (Something carried sounds only as it first touches, not while it is pressed against things.)
      if (held) {
        const now = this.touching(b.body) !== null;
        const fresh = now && !this.heldTouching;
        this.heldTouching = now;
        if (!fresh) continue;
      }
      if (dv < HIT_SPEED || was < HIT_SPEED * 0.5 || dx * v0[0]! + dy * v0[1]! + dz * v0[2]! > -0.3 * dv * was) continue;
      const id = b.info.id;
      const h = this.hits.get(id) ?? { last: -1, since: -1, count: 0, quietUntil: 0 };
      this.hits.set(id, h);
      if (this.time < h.quietUntil || this.time - h.last < 0.09) continue;
      if (this.time - h.since > 1) [h.since, h.count] = [this.time, 0];
      if (++h.count > 5) {
        h.quietUntil = this.time + 1;
        continue;
      }
      h.last = this.time;
      const t = b.body.translation();
      // Set down gently: barely heard; thrown: full. (Curved, so soft hits stay soft.)
      let volume = 0.04 + 0.96 * Math.min(1, (dv - HIT_SPEED) / (HIT_FULL - HIT_SPEED)) ** 1.2;
      // (Landing on something soft is quieter.)
      const touched = this.touching(b.body);
      if (touched !== null && SOFT_SURFACES.includes(this.surfaceAt(touched, t))) volume *= 0.6;
      this.bus.emit({ type: 'hit', source: id, surface: this.surfaceOf(id), at: [t.x, t.y, t.z], volume, hard: dv > 260, time: this.time });
      if (--left <= 0) break;
    }
  }

  /** A collider the body is touching (not its own), if any. */
  private touching(body: RAPIER.RigidBody): number | null {
    let found: number | null = null;
    for (let i = 0; i < body.numColliders() && found === null; i++)
      this.world.contactPairsWith(body.collider(i), (o) => {
        if (found === null && o.parent()?.handle !== body.handle) found = o.handle;
      });
    return found;
  }

  /** The moving body an object belongs to (itself, or the unit it is part of), if any. */
  bodyOf(id: string): string | null {
    const b = this.bodies.get(id) ?? this.bodies.get(this.unitOf.get(id) ?? '');
    return b && b.info.kind !== 'zone' ? b.info.id : null;
  }

  private isShown(e: EntityData): boolean {
    for (let x: EntityData | undefined = e; x; x = x.parent ? this.doc.get(x.parent) : undefined) if (!x.visible) return false;
    return true;
  }

  // ── Breaking, physics, conveyors ──

  private damage(id: string, amount: number): void {
    const label = this.names.get(id) ?? 'That object';
    const health = this.breakHealth.get(id);
    if (health === undefined) throw new Error(`${label} isn't breakable. Add the Breakable component to it.`);
    if (health <= 0 || !(amount > 0)) return;
    const left = Math.max(0, health - amount);
    this.breakHealth.set(id, left);
    if (left > 0) return;
    // Broken: it disappears and stops colliding; “When this breaks” runs.
    const b = this.bodies.get(id) ?? this.bodies.get(this.unitOf.get(id) ?? '');
    if (b) {
      b.visible = false;
      this.setColliders(b, false);
    }
    this.bus.emit({ type: 'break', target: id, time: this.time });
    this.runner.dispatch({ type: 'breaks', target: id });
  }

  /** How much health a breakable object has left (undefined if it isn't breakable). */
  healthOf(id: string): number | undefined {
    return this.breakHealth.get(id);
  }

  /** Let physics take over a body: it falls and tumbles. */
  private makePhysical(b: Body): void {
    if (b.body.isDynamic()) return;
    this.tweens.delete(b.info.id);
    b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    // Its Physics mass when it has one, else about wood: 500 kg/m³ in an inch-based world.
    const k = b.body.numColliders();
    for (let i = 0; i < k; i++) {
      if (b.rb) b.body.collider(i).setMass(Math.max(0.01, b.rb.mass) / k);
      else b.body.collider(i).setDensity(500 / UNITS_PER_METRE ** 3);
    }
    if (b.rb) {
      b.body.setGravityScale(b.rb.gravityScale, true);
      if (b.rb.lockRotation) b.body.lockRotations(true, true);
    }
    b.body.enableCcd(true);
    b.info.motion = 'dynamic';
  }

  /** Physics objects resting on a conveyor are carried along it. */
  private carryOnBelts(): void {
    for (const [handle, belt] of this.belts) {
      const c = this.world.getCollider(handle);
      if (!c) continue;
      this.world.contactPairsWith(c, (other) => {
        const body = other.parent();
        if (!body || !body.isDynamic()) return;
        const v = body.linvel();
        body.setLinvel({ x: v.x + (belt.x - v.x) * 0.25, y: v.y, z: v.z + (belt.z - v.z) * 0.25 }, true);
      });
    }
  }

  /** After scaling: collision shapes that match the new size. */
  private rebuildColliders(b: Body): void {
    const k = b.scale;
    const old: RAPIER.Collider[] = [];
    for (let i = 0; i < b.body.numColliders(); i++) old.push(b.body.collider(i));
    const groups = old[0]?.collisionGroups() ?? 0xffffffff;
    const make = (desc: RAPIER.ColliderDesc | null, share = 1) => {
      if (!desc) return;
      if (b.rb) this.material(desc, b.rb, share);
      else desc.setFriction(0.6);
      const c = this.world.createCollider(desc.setCollisionGroups(groups), b.body);
      this.owner.set(c.handle, b.info.id);
      return c;
    };
    if (b.poster) {
      const p = this.posters.get(b.info.id);
      make(posterCollider(b.poster.data, !!p && (p.hung || !b.poster.data.rolls), this.models.get(b.poster.data.scrollModel)));
    } else if (b.shape) {
      make(pointCollider(b.shape.collider, decomposeMat4(b.shape.matrix).scale.map((x) => Math.abs(x) * k) as Q3));
    } else if (b.model) {
      const scale = decomposeMat4(b.model.matrix).scale.map((x) => Math.abs(x) * k) as Q3;
      const parts = new Map<number, MovingPart>();
      const descs = modelColliders(b.model.data, b.model.mesh, scale, b.body.isDynamic());
      for (const { desc, part } of descs) {
        const c = make(desc, descs.length)!;
        if (part !== undefined && b.model.mesh.parts![part]!.moves) parts.set(part, movingPart(c, desc, b.model.data, scale));
      }
      b.parts = parts.size ? parts : undefined;
    } else {
      for (const br of b.brushes) {
        const pts = new Float32Array(vertices(br).flatMap((v) => transformPoint(b.startInverse, v).map((x) => x * k)));
        make(hull(pts));
      }
    }
    for (const c of old) {
      this.owner.delete(c.handle);
      this.world.removeCollider(c, false);
    }
    const p = this.posters.get(b.info.id);
    if (p) p.collider = b.body.collider(0);
    b.body.wakeUp();
  }

  /**
   * Switch collisions on or off. Collision groups are used rather than disabling colliders, so a hidden
   * physics object keeps its weight (and keeps falling).
   */
  private setColliders(b: Body, on: boolean): void {
    for (let i = 0; i < b.body.numColliders(); i++) b.body.collider(i).setCollisionGroups(on ? 0xffffffff : 0);
    b.body.wakeUp();
  }

  /**
   * Where an object is headed: the end of the move or turn it is in the middle of, or where it is. “Move by” and
   * “turn by” add to this, so a move cut short by the next one isn't lost: “down 6” then “up 6” always comes
   * back to the same place, however quickly they follow each other.
   */
  private goalOf(id: string, now: { p: Q3; q: Quat }): { p: Q3; q: Quat } {
    const tw = this.tweens.get(id);
    return tw && !tw.done && tw.t1 > this.time ? { p: tw.to.p, q: tw.to.q } : now;
  }

  private tween(id: string, b: Body, from: Tween['from'], to: Tween['to'], seconds: number): () => boolean {
    if (b.body.isFixed()) b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    // A scale keeps going with whatever move follows, and the other way round.
    const prevS = this.tweens.get(id);
    if (to.s === undefined && prevS?.to.s !== undefined) b.scale = prevS.to.s;
    const tw: Tween = { from, to, t0: this.time, t1: this.time + Math.max(0, seconds), done: false };
    const prev = this.tweens.get(id);
    if (prev) prev.done = true; // a new move replaces the old one
    this.tweens.set(id, tw);
    if (seconds <= 0) this.applyTweens(this.time);
    return () => tw.done;
  }

  private applyTweens(at: number): void {
    for (const [id, tw] of this.tweens) {
      const b = this.bodies.get(id);
      if (!b) continue;
      const k = tw.t1 <= tw.t0 ? 1 : Math.min(1, Math.max(0, (at - tw.t0) / (tw.t1 - tw.t0)));
      const e = k * k * (3 - 2 * k); // ease in and out
      const p = { x: tw.from.p[0] + (tw.to.p[0] - tw.from.p[0]) * e, y: tw.from.p[1] + (tw.to.p[1] - tw.from.p[1]) * e, z: tw.from.p[2] + (tw.to.p[2] - tw.from.p[2]) * e };
      const q = slerp(tw.from.q, tw.to.q, e);
      if (tw.to.s !== undefined) b.scale = (tw.from.s ?? 1) + (tw.to.s - (tw.from.s ?? 1)) * e;
      if (b.body.isKinematic()) {
        b.body.setNextKinematicTranslation(p);
        b.body.setNextKinematicRotation(q);
      } else {
        b.body.setTranslation(p, true);
        b.body.setRotation(q, true);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      if (k >= 1) {
        tw.done = true;
        this.tweens.delete(id);
        if (tw.to.s !== undefined) this.rebuildColliders(b);
      }
    }
  }

  /** What scripts logged since the last call (for the console). */
  drainLogs(): ScriptLog[] {
    const out = this.logs;
    this.logs = [];
    return out;
  }

  /** Script errors since the last call (a stopped loop, a division by zero …). */
  drainScriptErrors() {
    const out = this.runner.errors.slice(this.reportedErrors);
    this.reportedErrors = this.runner.errors.length;
    return out;
  }

  /** The blocks each script is running right now. */
  activeBlocks(): Map<string, string[]> {
    return this.runner.activeBlocks();
  }

  scriptVariables(owner: string) {
    return this.runner.variables(owner);
  }

  /** A light as it is now (null: not a light in this game). */
  lightOf(id: string): { on: boolean; intensity: number; range: number; angle: number; color: number[] } | null {
    const l = this.lights.get(id);
    if (!l) return null;
    const t = this.time;
    return { on: l.on, intensity: fadeAt(l.intensity, t)[0]!, range: fadeAt(l.range, t)[0]!, angle: fadeAt(l.angle, t)[0]!, color: fadeAt(l.color, t) };
  }

  /** Models whose glow scripts set: the glow from (null: as made), to, and how far along (0–1). */
  glowing(): [id: string, from: number | null, to: number, k: number][] {
    return [...this.glows].map(([id, g]) => [id, g.from?.[0] ?? null, g.to[0]!, fadeK(g, this.time)]);
  }

  /** Whether a script last turned an object (its body) on or off; undefined if none has. */
  switchedOn(id: string): boolean | undefined {
    return this.switched.get(id);
  }

  /** Whether a body is shown (scripts can hide things). */
  isVisible(id: string): boolean {
    return this.bodies.get(id)?.visible ?? true;
  }

  /** The brushes drawn with a body (world space at the start). */
  bodyBrushes(id: string): Brush[] {
    return this.bodies.get(id)?.brushes ?? [];
  }

  private onContact(h1: number, h2: number, started: boolean): void {
    const zone = this.triggers.get(h1) ?? this.triggers.get(h2);
    if (!zone) return;
    const otherHandle = this.triggers.has(h1) ? h2 : h1;
    const other = this.owner.get(otherHandle);
    if (!other || this.triggers.has(otherHandle)) return;
    const motion = this.bodies.get(other)?.info.motion;
    const isPlayer = other === 'player';
    const moving = !!motion && motion !== 'fixed';
    const ok = zone.data.detects === 'anything' ? moving || isPlayer : zone.data.detects === 'physics' ? motion === 'dynamic' : isPlayer;
    if (!ok) return;
    if (started) zone.present.add(other);
    else zone.present.delete(other);
    if (started) {
      if (zone.data.once && zone.fired) return;
      zone.fired = true;
      zone.inside.add(other);
    } else {
      // Report an exit only for something whose entry was reported (matters for once-only zones).
      if (!zone.inside.delete(other)) return;
    }
    this.pending.push({ kind: started ? 'enter' : 'exit', trigger: zone.id, other, time: this.time });
    this.runner.dispatch({ type: started ? 'enter' : 'leave', zone: zone.id, other });
    this.bus.emit({ type: started ? 'trigger.enter' : 'trigger.exit', trigger: zone.id, other, time: this.time });
  }

  /** Put every moving object's stand-ins where it will be after this step (see `standIns`). */
  private syncStandIns(): void {
    this.standInBody ??= this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const seen = this.standInSeen;
    seen.clear();
    for (const b of this.bodies.values()) {
      const body = b.body;
      if (b.info.kind === 'zone' || !body.isKinematic()) continue;
      const t = body.nextTranslation(), q = body.nextRotation();
      for (let i = 0; i < body.numColliders(); i++) {
        const real = body.collider(i);
        if (real.isSensor()) continue;
        seen.add(real.handle);
        let twin = this.standIns.get(real.handle);
        if (!twin) {
          twin = this.world.createCollider(new RAPIER.ColliderDesc(real.shape).setSensor(true), this.standInBody);
          this.standIns.set(real.handle, twin);
          this.standInOf.set(twin.handle, real);
        }
        // Where the real collider sits on its body, carried to the body's next place.
        const lt = real.translationWrtParent() ?? { x: 0, y: 0, z: 0 };
        const lq = real.rotationWrtParent() ?? { x: 0, y: 0, z: 0, w: 1 };
        const off = qrot(q, [lt.x, lt.y, lt.z]);
        twin.setTranslationWrtParent({ x: t.x + off[0], y: t.y + off[1], z: t.z + off[2] });
        twin.setRotationWrtParent(qmul(q, lq));
        // Shown or hidden (hiding switches the collision groups off), switched on or off.
        if (twin.collisionGroups() !== real.collisionGroups()) twin.setCollisionGroups(real.collisionGroups());
        if (twin.isEnabled() !== real.isEnabled()) twin.setEnabled(real.isEnabled());
      }
    }
    for (const [h, twin] of this.standIns) {
      if (seen.has(h)) continue;
      this.standInOf.delete(twin.handle);
      this.world.removeCollider(twin, false);
      this.standIns.delete(h);
    }
  }

  private standInSeen = new Set<number>();

  /** Where a point riding on the object of collider `h` (a stand-in) will be after this step; null if it stays put. */
  private carry(h: number, at: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null {
    const body = this.standInOf.get(h)?.parent();
    if (!body || !body.isKinematic()) return null;
    const t0 = body.translation(), q0 = body.rotation(), t1 = body.nextTranslation(), q1 = body.nextRotation();
    const moved = Math.abs(t1.x - t0.x) + Math.abs(t1.y - t0.y) + Math.abs(t1.z - t0.z) > 1e-5 || Math.abs(q1.x * q0.x + q1.y * q0.y + q1.z * q0.z + q1.w * q0.w) < 1 - 1e-9;
    if (!moved) return null;
    // Into the body's own space at its place now, then back out at its next place.
    const local = qrot({ x: -q0.x, y: -q0.y, z: -q0.z, w: q0.w }, [at.x - t0.x, at.y - t0.y, at.z - t0.z]);
    const w = qrot(q1, local);
    return { x: t1.x + w[0], y: t1.y + w[1], z: t1.z + w[2] };
  }

  /** Give the player some of an item (a minus takes some away; at 0 it leaves the hotbar). */
  giveItem(name: string, amount: number): void {
    if (!name || !Number.isFinite(amount)) return;
    const n = Math.max(0, Math.round((this.inventory.get(name) ?? 0) + amount));
    if (n > 0) this.inventory.set(name, n);
    else this.inventory.delete(name);
  }

  /** The item in the picked hotbar slot ('' when that slot is empty). */
  selectedItem(): string {
    return this.slotItems()[this.slot] ?? '';
  }

  /** The items in hotbar slots: everything carried but blueprints (those are in the blueprint menu). */
  private slotItems(): string[] {
    const items = [...this.inventory.keys()];
    return this.base ? items.filter((i) => !this.base!.pieceForBlueprint(i)) : items;
  }

  /** Pick a hotbar slot (0-based; wraps around the hotbar's slots, or the items carried when there is no hotbar). */
  selectSlot(slot: number): void {
    const bars = this.ui.screens.flatMap((s) => s.elements.filter((e) => e.kind === 'hotbar').map((e) => e.slots));
    const n = Math.max(1, ...(bars.length ? bars : [this.slotItems().length]));
    this.slot = ((Math.round(slot) % n) + n) % n;
  }

  /** An element as the player sees it now: on a shown screen, and neither it nor what it is inside hidden. */
  private uiVisible(element: string): { kind: string; source: string } | null {
    for (const sc of this.ui.screens) {
      const e = sc.elements.find((x) => x.id === element);
      if (e && this.uiShown.has(sc.id) && uiShown(e, sc.elements, (id) => this.uiHidden.has(id))) return e;
    }
    return null;
  }

  /** The player clicked a button on screen: its “When the player clicks” stacks start (if it is shown). */
  clickUi(element: string): void {
    if (this.uiVisible(element)?.kind === 'button') this.runner.dispatch({ type: 'uiClick', element });
  }

  /**
   * The player picked a row of a list on screen. In a list of the inventory the row is an item: it is also
   * taken in hand (its hotbar slot is picked).
   */
  pickRow(list: string, row: string): void {
    const e = this.uiVisible(list);
    if (e?.kind !== 'list') return;
    if (e.source === 'inventory') {
      const i = this.slotItems().indexOf(row);
      if (i < 0) return;
      this.slot = i;
    } else if (!this.uiRows.get(list)?.includes(row)) return;
    this.runner.dispatch({ type: 'listPick', list, row });
  }

  /** The player pressed a key the game doesn't use itself (letters, Tab): “When the player presses” starts. */
  pressKey(code: string): void {
    if (code === 'KeyF' && this.equipKey(true) !== null) return;
    this.runner.dispatch({ type: 'key', key: code });
    // Seats sat on with their own key (E is Use's): the same key gets up again.
    const h = this.hiding;
    if (h && h.out === null && !this.frozen && this.keyOf(h.id) === code) return this.leaveHiding();
    const seat = this.seatAt(code);
    if (seat) return this.enterHiding(seat);
    for (const { targets, distance } of this.pressAims()) this.runner.dispatch({ type: 'press', key: code, targets, distance });
  }

  /** What a key pressed “at this” reaches: what's held (and what it's a copy of), then what's looked at. */
  private pressAims(): { targets: string[]; distance: number }[] {
    if (!this.player || this.hiding || this.frozen) return [];
    const out: { targets: string[]; distance: number }[] = [];
    if (this.held) out.push({ targets: this.heldIds(), distance: 0 });
    const hit = this.useAim();
    if (hit) out.push(hit);
    return out;
  }

  /** Keys that do something at what the player holds or looks at, with their prompts (held first, one per key). */
  keyPrompts(): { key: string; prompt: string }[] {
    const out: { key: string; prompt: string }[] = [];
    const f = this.equipKey(false);
    if (f !== null) out.push({ key: 'KeyF', prompt: f });
    const click = this.held ? null : this.plugHand ? this.plugClick(false) : this.equipped ? this.lightsClick(false) : null;
    if (click !== null) out.push({ key: 'Click', prompt: click });
    const hit = !this.hiding && !this.held && !this.frozen ? this.useAim() : null;
    const seat = hit?.targets.find((t) => this.seats.has(t) && this.keyOf(t) !== 'KeyE' && hit.distance <= this.reachOf(t) && this.seatReady(t));
    if (seat) out.push({ key: this.keyOf(seat), prompt: String(this.spots.get(seat)!.prompt ?? '') });
    for (const { targets, distance } of this.pressAims())
      for (const p of this.runner.keyPrompts(targets, distance)) if (!out.some((x) => x.key === p.key)) out.push(p);
    return out;
  }

  /** The key that gets into a spot (hiding spots: E). */
  private keyOf(spot: string): string {
    return this.seats.has(spot) ? String(this.spots.get(spot)?.key || 'KeyE') : 'KeyE';
  }

  /** A seat looked at within reach that this key sits on (never while holding something). */
  private seatAt(code: string): string | null {
    if (!this.player || this.hiding || this.held || this.frozen || code === 'KeyE') return null;
    const hit = this.useAim();
    return hit?.targets.find((t) => this.seats.has(t) && this.keyOf(t) === code && hit.distance <= this.reachOf(t) && this.seatReady(t)) ?? null;
  }

  /** The player clicked with the item in the picked hotbar slot. */
  useItem(): void {
    // (String lights in hand: the click plugs them in, or hangs an end.)
    if (this.plugHand && !this.held) {
      this.plugClick(true);
      return;
    }
    if (this.equipped && !this.held) {
      this.lightsClick(true);
      return;
    }
    // (Placing a blueprint: the click places it.)
    if (this.base?.placing && !this.held) {
      this.base.placePreview();
      return;
    }
    const item = this.selectedItem();
    if (item) this.runner.dispatch({ type: 'useItem', item });
  }

  /** What the screen UI shows now (for drawing it). */
  uiState(): UiState {
    const texts: Record<string, string> = {};
    for (const [k, v] of this.uiText) texts[k] = v;
    const lists: Record<string, string[]> = {};
    for (const [k, v] of this.uiRows) lists[k] = [...v];
    return {
      shown: [...this.uiShown],
      hidden: [...this.uiHidden],
      texts,
      lists,
      inventory: this.slotItems().map((item) => ({ item, count: this.inventory.get(item) ?? 0 })),
      slot: this.slot,
      freesMouse: !!this.base?.menuOpen || !!this.mine?.menuOpen || this.ui.screens.some((sc) => sc.freesMouse && this.uiShown.has(sc.id)),
    };
  }

  /** Whether `what` (an object id or 'player') is in the trigger zone `zone` now. */
  isInside(zone: string, what: string): boolean {
    for (const z of this.triggers.values()) if (z.id === zone) return z.present.has(what);
    return false;
  }

  /** Trigger events since the last call. */
  drainEvents(): TriggerEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Whether any weapon of the game makes blasts (they light their surroundings for a moment). */
  get hasBlasts(): boolean {
    return this.ui.items.some((i) => (weaponOf(i.weapon)?.blast ?? 0) > 0) || this.doc.entities.some((e) => !!e.components.script && JSON.stringify(e.components.script).includes('"kind":"explode"'));
  }

  /** Every object that physics can move. */
  movingBodies(): BodyInfo[] {
    return [...this.bodies.values()].filter((b) => b.info.motion !== 'fixed').map((b) => b.info);
  }

  /**
   * How a body has moved since the world started, as a column-major matrix: apply it to anything placed at
   * the body's start (its brush, its marker) to draw it where it is now.
   */
  motionOf(id: string): number[] | null {
    const b = this.bodies.get(id);
    if (!b) return null;
    const pose = poseMatrix(b.body);
    if (b.scale === 1) return multiply(pose, b.startInverse);
    const k = b.scale;
    return multiply(multiply(pose, [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]), b.startInverse);
  }

  /**
   * `motionOf` for drawing: where the body is between the last two physics steps (as far along as the time now
   * is), so moving things glide on screens faster than the physics (60 steps a second) and never judder against
   * the player's view, which is drawn the same way.
   */
  drawnMotionOf(id: string): number[] | null {
    const b = this.bodies.get(id);
    if (!b) return null;
    const p = b.prev, a = this.alpha;
    if (!p || a >= 1) return this.motionOf(id);
    const t = b.body.translation(), q = b.body.rotation();
    if (Math.abs(t.x - p[0]!) + Math.abs(t.y - p[1]!) + Math.abs(t.z - p[2]!) > SNAP) return this.motionOf(id);
    // (The shorter way round between the two turns, normalised.)
    const s = p[3]! * q.x + p[4]! * q.y + p[5]! * q.z + p[6]! * q.w < 0 ? -1 : 1;
    let qx = p[3]! * s + (q.x - p[3]! * s) * a, qy = p[4]! * s + (q.y - p[4]! * s) * a, qz = p[5]! * s + (q.z - p[5]! * s) * a, qw = p[6]! * s + (q.w - p[6]! * s) * a;
    const len = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= len;
    qy /= len;
    qz /= len;
    qw /= len;
    const pose = poseFrom(p[0]! + (t.x - p[0]!) * a, p[1]! + (t.y - p[1]!) * a, p[2]! + (t.z - p[2]!) * a, qx, qy, qz, qw);
    if (b.scale === 1) return multiply(pose, b.startInverse);
    const k = b.scale;
    return multiply(multiply(pose, [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]), b.startInverse);
  }

  private frameSnapshot = new FrameSnapshot();

  /**
   * What is drawn this frame, in one picture (see `FrameSnapshot`): every moving body's drawn motion, place and
   * whether it is shown (and those of bodies asked for with `drawn`), each creature as drawn, and the player's view.
   * The same values `drawnMotionOf`, `positionOf`, `isVisible`, `npcStates(true)` and `playerView` give; take it
   * once a frame, after `step` (the view through a scripted camera ends here when its time is up, as in
   * `playerView`). The same object each time, filled again.
   */
  snapshot(): FrameSnapshot {
    const s = this.frameSnapshot;
    s.begin();
    const tracked = s.trackedIds;
    for (const [id, b] of this.bodies) {
      if (b.info.motion === 'fixed' && !tracked.has(id)) continue;
      const i = s.indexBody(id);
      const t = b.body.translation();
      s.setBody(i, this.drawnMotionOf(id)!, t.x, t.y, t.z, b.visible);
    }
    for (const n of this.npcs.values()) {
      const { feet, yaw } = this.drawnNpc(n);
      s.setNpc(s.indexNpc(n.id), feet[0], feet[1], feet[2], yaw, n.alive, n.state, n.health);
    }
    s.setView(this.playerView(), this.player?.crouched ?? false);
    const pl = this.player;
    s.setMotion(pl?.sprinting ?? false, pl && !pl.onGround ? Math.max(0, -pl.velocity.y) : 0, pl ? this.weakness() : 0);
    return s;
  }

  /**
   * Keep body `id` in `snapshot()` (where it is drawn) even if it doesn't move, and write it into the current picture now (so it can be
   * read this frame). Returns its index there.
   */
  drawn(id: string): number {
    const s = this.frameSnapshot;
    const i = s.track(id);
    const b = this.bodies.get(id);
    if (b) {
      const t = b.body.translation();
      s.setBody(i, this.drawnMotionOf(id)!, t.x, t.y, t.z, b.visible);
    }
    return i;
  }

  /** World position of a body now (for tests and debugging). */
  positionOf(id: string): [number, number, number] | null {
    const t = this.bodies.get(id)?.body.translation();
    return t ? [t.x, t.y, t.z] : null;
  }

  /** How far a body has turned about the up axis since the start, in degrees (for tests). */
  yawOf(id: string): number | null {
    const b = this.bodies.get(id);
    if (!b) return null;
    const q = b.body.rotation(), s = b.start.q;
    // relative = q * conj(start)
    const w = q.w * s.w + q.x * s.x + q.y * s.y + q.z * s.z;
    const y = -q.w * s.y + q.y * s.w - q.z * s.x + q.x * s.z;
    return (Math.atan2(y, w) * 360) / Math.PI;
  }

  /** Move a kinematic body (scripts use this in Phase 5). */
  moveKinematic(id: string, to: [number, number, number]): void {
    const b = this.bodies.get(id);
    if (b?.info.motion === 'kinematic') b.body.setNextKinematicTranslation({ x: to[0], y: to[1], z: to[2] });
  }


  // ── Mining (an endless block mine; see mining/) ──

  /** Mining, when the game has it. */
  mine: MineSystem | null = null;
  private mineBody: RAPIER.RigidBody | null = null;
  private mineColliders = new Map<string, { version: number; colliders: RAPIER.Collider[] }>();

  private initMine(settings: unknown): void {
    const self = this;
    this.mine = new MineSystem(settings, {
      time: () => this.time,
      now: () => this.clock() * 1000,
      player: () => {
        const p = self.player;
        if (!p) return null;
        const f = p.feetPosition, d = p.lookDirection();
        return { feet: [f.x, f.y, f.z], eye: p.eye(), dir: [d[0], d[1], d[2]] };
      },
      hurt: (n, cause) => this.hurt(n, cause),
      heal: (n) => {
        if (this.health > 0 && this.health < this.maxHealth) this.heal(n);
      },
      say: (text, secs) => this.say(text, secs),
      sound: (file, at) => this.bus.emit({ type: 'sound', sound: file, at, follow: null, volume: 1, loop: false, range: 1024, source: '@mine', time: this.time }),
      home: () => {
        const p = this.player;
        if (p) p.teleport(p.spawn.feet, p.spawn.yaw);
      },
      random: () => this.random(),
    });
    const p = this.player;
    if (p) this.mine.origin = [p.spawn.feet.x, p.spawn.feet.y, p.spawn.feet.z];
    this.mineBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.syncMineColliders(true);
  }

  private stepMine(): void {
    const m = this.mine!, p = this.player!;
    const free = !this.held && !this.equipped && !this.plugHand && !this.weaponInHand() && !this.hiding && !this.frozen;
    m.tick(STEP, free && !!p.input.fire);
    this.syncMineColliders(false);
  }

  /** The chunks around the player collide (as few boxes as their rock makes); far ones stop. */
  private syncMineColliders(all: boolean): void {
    const m = this.mine, p = this.player, body = this.mineBody;
    if (!m || !p || !body) return;
    if (all) {
      for (const c of this.mineColliders.values()) for (const col of c.colliders) this.dropMineCollider(col);
      this.mineColliders.clear();
    }
    const f = p.feetPosition;
    const b = m.toBlock([f.x, f.y, f.z]);
    const [cx, cy, cz] = m.blocks.chunkOf(Math.floor(b[0]), Math.floor(b[1]), Math.floor(b[2]));
    const near = new Set<string>();
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++)
        for (let x = -1; x <= 1; x++) {
          const c = m.blocks.chunk(cx + x, cy + y, cz + z);
          const k = `${c.cx},${c.cy},${c.cz}`;
          near.add(k);
          const had = this.mineColliders.get(k);
          if (had && had.version === c.version) continue;
          if (had) for (const col of had.colliders) this.dropMineCollider(col);
          const B = m.B, colliders: RAPIER.Collider[] = [];
          for (const [x0, y0, z0, x1, y1, z1] of m.blocks.boxes(c)) {
            const lo = m.toWorld(x0!, y0!, z0!), hi = m.toWorld(x1!, y1!, z1!);
            const desc = RAPIER.ColliderDesc.cuboid(((x1! - x0!) * B) / 2, ((y1! - y0!) * B) / 2, ((z1! - z0!) * B) / 2).setTranslation((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
            const col = this.world.createCollider(desc, body);
            this.owner.set(col.handle, MINE_OWNER);
            colliders.push(col);
          }
          this.mineColliders.set(k, { version: c.version, colliders });
        }
    for (const [k, c] of this.mineColliders) {
      if (near.has(k)) continue;
      for (const col of c.colliders) this.dropMineCollider(col);
      this.mineColliders.delete(k);
    }
  }

  private dropMineCollider(col: RAPIER.Collider): void {
    this.owner.delete(col.handle);
    this.world.removeCollider(col, false);
  }

  /** Tab opens the mine menu, H goes home. True: the mine took the key. */
  private mineKey(code: string): boolean {
    const m = this.mine!;
    if (code === m.config.menuKey) m.action('menu');
    else if (code === m.config.homeKey) m.action('home');
    else if (code === 'Escape' && m.menuOpen) m.action('menu', 'close');
    else return false;
    return true;
  }

  /** The mine's corner display (null: no mine). */
  mineHud(): MineHud | null {
    return this.mine?.hud() ?? null;
  }

  /** The mine menu (null: shut). */
  mineMenu(): MineMenu | null {
    return this.mine?.menu() ?? null;
  }

  /** A mine menu button: `menu` (open/close), `home`, `pickaxe`, `skill` (id). */
  mineAction(name: string, arg = ''): void {
    this.mine?.action(name, arg);
  }

  // ── Base building (blueprints filled with props; see building/) ──

  /** The base: blueprints and finished pieces (null: the game doesn't have base building). */
  base: BaseSystem | null = null;
  /** Problems in the build pieces' JSON (shown in the console). */
  readonly buildingProblems: string[] = [];
  private sceneName = '';
  /** Other scenes' saved bases (kept as they were). */
  private otherBases: Record<string, unknown> = {};
  /** Saved by the last “Save the game” (a game that saves only when asked hands this out as its progress). */
  private checkpoint: SavedProgress | null = null;
  private baseBody: RAPIER.RigidBody | null = null;
  private baseColliders = new Map<string, RAPIER.Collider>();
  private baseHandles = new Set<number>();

  private initBase(extra: { pieces?: unknown[]; base?: unknown; looks?: unknown } | undefined): void {
    const { pieces, config, problems } = buildingCatalog(extra);
    this.buildingProblems.push(...problems);
    this.base = new BaseSystem(pieces, config, {
      time: () => this.time,
      itemCount: (name) => this.inventory.get(name) ?? 0,
      giveItem: (name, n) => this.giveItem(name, n),
      castRay: (from, dir, reach) => {
        const hit = this.world.castRayAndGetNormal(new RAPIER.Ray({ x: from[0], y: from[1], z: from[2] }, { x: dir[0], y: dir[1], z: dir[2] }), reach, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, 0xffffffff, this.player?.collider, undefined, (c) => !this.isHeld(c) && !this.standIns.has(c.handle));
        return hit ? { distance: hit.timeOfImpact, normal: [hit.normal.x, hit.normal.y, hit.normal.z] } : null;
      },
      setBlocker: (key, box) => this.setBaseBlocker(key, box),
      propsIn: (box, tag) => this.propsIn(box, tag),
      consume: (id) => {
        if (this.held?.id === id) this.dropHeld();
        this.remove(id);
      },
      emit: (e) => this.bus.emit(e),
      playSound: (sound, at, volume, range) => this.bus.emit({ type: 'sound', sound, at, follow: null, volume, loop: false, range, source: 'base', time: this.time }),
    });
  }

  private setBaseBlocker(key: string, box: BlockerBox | null): void {
    const old = this.baseColliders.get(key);
    if (old) {
      if (this.sound) {
        const t = old.translation(), h = old.halfExtents() ?? { x: 64, y: 64, z: 64 }, r = Math.hypot(h.x, h.y, h.z);
        this.sound.changed({ x: t.x - r, y: t.y - r, z: t.z - r }, { x: t.x + r, y: t.y + r, z: t.z + r });
      }
      this.baseHandles.delete(old.handle);
      this.owner.delete(old.handle);
      this.world.removeCollider(old, false);
      this.baseColliders.delete(key);
    }
    if (!box) return;
    this.baseBody ??= this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const q = { x: 0, y: Math.sin(box.yaw / 2), z: 0, w: Math.cos(box.yaw / 2) };
    const desc = RAPIER.ColliderDesc.cuboid(Math.max(0.5, box.half[0]), Math.max(0.5, box.half[1]), Math.max(0.5, box.half[2])).setTranslation(...box.center).setRotation(q).setFriction(0.6);
    const c = this.world.createCollider(desc, this.baseBody);
    this.baseColliders.set(key, c);
    this.baseHandles.add(c.handle);
    // (So hits find the piece: weapons and blasts damage what owns the collider.)
    this.owner.set(c.handle, BASE_OWNER + box.site);
    if (this.sound) {
      const r = Math.hypot(...box.half);
      this.sound.changed({ x: box.center[0] - r, y: box.center[1] - r, z: box.center[2] - r }, { x: box.center[0] + r, y: box.center[1] + r, z: box.center[2] + r });
    }
  }

  /** Whether an object is of a building material: named after it (“Plank”, “Plank 2”, “concrete powder bag”) or tagged with it. */
  private isMaterial(id: string, want: string): boolean {
    // (A copy made while playing is its original's.)
    const e = this.doc.get(id) ?? this.doc.get(id.split('#')[0]!);
    if (!e) return false;
    return e.name.trim().toLowerCase().startsWith(want) || e.tags.some((t) => t.trim().toLowerCase() === want);
  }

  /** Props of material `tag` (or inside something that is) touching a box: the loose physics objects to take away. */
  private propsIn(box: BlockerBox, tag: string): string[] {
    const want = tag.trim().toLowerCase();
    const q = { x: 0, y: Math.sin(box.yaw / 2), z: 0, w: Math.cos(box.yaw / 2) };
    const shape = new RAPIER.Cuboid(Math.max(0.5, box.half[0]), Math.max(0.5, box.half[1]), Math.max(0.5, box.half[2]));
    const out: string[] = [];
    const found: number[] = [];
    this.world.intersectionsWithShape({ x: box.center[0], y: box.center[1], z: box.center[2] }, q, shape, (c) => {
      if (!c.isSensor() && c.parent()?.isDynamic()) found.push(c.handle);
      return true;
    });
    for (const h of found) {
      const id = this.owner.get(h);
      if (!id || id === 'player' || this.gone.has(id)) continue;
      let prop: string | null = null, tagged = false;
      for (let x: string | null | undefined = id; x; x = this.parentOf.get(x)) {
        const b = this.bodies.get(x);
        if (!prop && b?.info.motion === 'dynamic' && !this.printing.has(x)) prop = x;
        if (this.isMaterial(x, want)) tagged = true;
      }
      if (prop && tagged && !out.includes(prop) && !this.npcs.has(prop)) out.push(prop);
    }
    return out;
  }

  /** The build piece E would reach now (null when something else is in the way). */
  private baseAim(): BaseAim | null {
    const p = this.player;
    if (!p || !this.base || this.hiding || this.frozen) return null;
    const eye = p.eye();
    const d = p.lookDirection();
    const a = this.base.aim([eye[0], eye[1], eye[2]], [d[0], d[1], d[2]], this.base.config.reach);
    if (!a) return null;
    const hit = p.aimAt(a.distance, (c) => this.baseHandles.has(c.handle) || this.isHeld(c));
    return hit && hit.distance < a.distance - 4 ? null : a;
  }

  /** E at a build piece: a door opens or shuts (true: the base took it). */
  private useBase(): boolean {
    // (Holding something: E drops it, as ever.)
    if (this.held) return false;
    const aim = this.baseAim();
    if (!aim || !this.base || !this.base.press(aim)) return false;
    this.bus.emit({ type: 'use', target: aim.site, by: 'player', time: this.time });
    return true;
  }

  /** Each step: E held on a blueprint (to remove it), and where the blueprint being placed would go. */
  private stepBase(): void {
    const b = this.base!, p = this.player!;
    const aim = this.held || b.placing ? null : this.baseAim();
    b.hold(aim, !!p.input.use && !this.frozen, STEP);
    if (b.placing && !this.held && !this.hiding && !this.frozen && !b.menuOpen) {
      const e = p.eye(), d = p.lookDirection();
      b.aimPlacement([e[0], e[1], e[2]], [d[0], d[1], d[2]]);
    } else b.aimPlacement(null, null);
  }

  /** What the HUD shows at the base now: the blueprint being placed, or the piece aimed at. */
  buildPrompt(): BuildPrompt | null {
    const b = this.base;
    if (!b || !this.player || this.hiding || b.menuOpen) return null;
    return b.prompt(this.held || b.placing ? null : this.baseAim());
  }

  /** The blueprint menu (B): open or shut it (placing stops while it is open). */
  toggleBlueprints(open = !this.base?.menuOpen): void {
    const b = this.base;
    if (!b) return;
    if (open) b.stopPlacing();
    b.setMenu(open);
  }

  /** A blueprint picked in the menu: placing it starts (the menu shuts). */
  pickBlueprint(piece: string): void {
    this.base?.startPlacing(piece);
  }

  /** Keys while placing: R turns, T tips, Q (or a right click) stops placing. True: the base took the key. */
  baseKey(code: string): boolean {
    if (this.mine && this.mineKey(code)) return true;
    const b = this.base;
    if (!b) return false;
    if (code === b.config.menuKey) {
      this.toggleBlueprints();
      return true;
    }
    if (!b.placing) return false;
    if (code === 'KeyR') b.rotate();
    else if (code === 'KeyT') b.tip();
    else if (code === 'KeyQ') b.stopPlacing();
    else return false;
    return true;
  }

  /** The blueprint menu for the HUD (null: shut, or no base building). */
  blueprintMenu(): { cards: BlueprintCard[]; ui: BaseConfig['ui'] } | null {
    const b = this.base;
    return b?.menuOpen ? { cards: b.owned(), ui: b.config.ui } : null;
  }

  /** The % tags over blueprints and how they look (for drawing). */
  blueprintTags(): { tags: BlueprintTag[]; color: string; text: string; image: string } | null {
    const b = this.base;
    return b ? { tags: b.tags(), color: b.config.tag.color, text: b.config.tag.text, image: b.config.ui.tag } : null;
  }

  /** A block set the day: a different one starts. */
  setDay(d: number): void {
    if (!Number.isFinite(d) || Math.max(0, Math.round(d)) === this.day) return;
    this.day = Math.max(0, Math.round(d));
    this.runner.dispatch({ type: 'newDay', day: this.day });
  }

  /** A block set the clock: an earlier hour is tomorrow, so the day goes up. */
  setHour(h: number): void {
    if (!Number.isFinite(h)) return;
    const to = ((h % 24) + 24) % 24;
    const past = to < this.dayHour;
    this.dayHour = to;
    if (past) {
      this.day++;
      this.runner.dispatch({ type: 'newDay', day: this.day });
    }
  }

  /** The clock goes forward: past midnight the day count goes up, and “When the clock reaches” stacks start. */
  passHours(hours: number): void {
    if (!(hours > 0)) return;
    const from = this.dayHour, to = from + hours;
    this.dayHour = to % 24;
    for (let d = Math.floor(to / 24); d > 0; d--) {
      this.day++;
      this.runner.dispatch({ type: 'newDay', day: this.day });
    }
    this.runner.dispatch({ type: 'hours', from, to });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.player?.dispose();
    this.bus.clear();
    this.events.free();
    this.world.free();
  }
}

function poseMatrix(b: RAPIER.RigidBody): number[] {
  const t = b.translation(), q = b.rotation();
  return poseFrom(t.x, t.y, t.z, q.x, q.y, q.z, q.w);
}

/** A rotation (unit quaternion x, y, z, w) and then a move to (tx, ty, tz), as a column-major matrix. */
function poseFrom(tx: number, ty: number, tz: number, x: number, y: number, z: number, w: number): number[] {
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    tx, ty, tz, 1,
  ];
}

/** Inverse of a rotation + translation matrix. */
function invertRigid(m: number[]): number[] {
  const r = [m[0]!, m[4]!, m[8]!, 0, m[1]!, m[5]!, m[9]!, 0, m[2]!, m[6]!, m[10]!, 0, 0, 0, 0, 1];
  const t = [m[12]!, m[13]!, m[14]!];
  r[12] = -(r[0]! * t[0]! + r[4]! * t[1]! + r[8]! * t[2]!);
  r[13] = -(r[1]! * t[0]! + r[5]! * t[1]! + r[9]! * t[2]!);
  r[14] = -(r[2]! * t[0]! + r[6]! * t[1]! + r[10]! * t[2]!);
  return r;
}

function multiply(a: number[], b: number[]): number[] {
  const o = new Array<number>(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row]! * b[col * 4 + k]!;
      o[col * 4 + row] = s;
    }
  return o;
}

function quatMul(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function quatFromMatrix(m: number[]): { x: number; y: number; z: number; w: number } {
  const m11 = m[0]!, m12 = m[4]!, m13 = m[8]!, m21 = m[1]!, m22 = m[5]!, m23 = m[9]!, m31 = m[2]!, m32 = m[6]!, m33 = m[10]!;
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return { w: 0.25 / s, x: (m32 - m23) * s, y: (m13 - m31) * s, z: (m21 - m12) * s };
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return { w: (m32 - m23) / s, x: 0.25 * s, y: (m12 + m21) / s, z: (m13 + m31) / s };
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return { w: (m13 - m31) / s, x: (m12 + m21) / s, y: 0.25 * s, z: (m23 + m32) / s };
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return { w: (m21 - m12) / s, x: (m13 + m31) / s, y: (m23 + m32) / s, z: 0.25 * s };
}

/** Points given in a component (anything else dropped); none: one at the origin. */
function validPoints(v: unknown): P3[] {
  const out = Array.isArray(v) ? (v.filter((p) => Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === 'number' && Number.isFinite(x))) as P3[]) : [];
  return out.length ? out : [[0, 0, 0]];
}

function transformPoint(m: number[], v: readonly number[]): [number, number, number] {
  return [
    m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
    m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
    m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
  ];
}

const STAKE_TIP: Record<string, Q3> = { bottom: [0, -1, 0], top: [0, 1, 0], front: [0, 0, 1], back: [0, 0, -1] };

function cross3(a: Q3, b: Q3): Q3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm3(v: Q3): Q3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function axisAngle(a: Q3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return { x: a[0] * s, y: a[1] * s, z: a[2] * s, w: Math.cos(angle / 2) };
}

/** The shortest turn from one unit vector to another. */
function fromTo(a: Q3, b: Q3): Quat {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.9999) {
    const p = norm3(cross3(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    return { x: p[0], y: p[1], z: p[2], w: 0 };
  }
  const c = cross3(a, b), w = 1 + d, l = Math.hypot(c[0], c[1], c[2], w);
  return { x: c[0] / l, y: c[1] / l, z: c[2] / l, w: w / l };
}

/** Rotate a vector by a unit quaternion. */
function qrot(q: Quat, v: [number, number, number]): [number, number, number] {
  const [x, y, z] = v;
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)];
}

function qconj(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function qmul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function slerp(a: Quat, b0: Quat, t: number): Quat {
  let b = b0;
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  if (cos < 0) {
    b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    cos = -cos;
  }
  if (cos > 0.9995) {
    const r = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, w: a.w + (b.w - a.w) * t };
    const l = Math.hypot(r.x, r.y, r.z, r.w);
    return { x: r.x / l, y: r.y / l, z: r.z / l, w: r.w / l };
  }
  const th = Math.acos(cos), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return { x: a.x * ka + b.x * kb, y: a.y * ka + b.y * kb, z: a.z * ka + b.z * kb, w: a.w * ka + b.w * kb };
}

/** A poster's collider: a scroll lying along its width (X), or a flat sheet facing +Z. */
function posterCollider(p: PosterData, flat: boolean, mesh?: ModelMesh): RAPIER.ColliderDesc {
  // (An unrolled poster is a sheet: nothing bumps into it, but it can still be looked at and used.)
  if (flat) return RAPIER.ColliderDesc.cuboid(p.width / 2, p.height / 2, Math.max(0.25, p.thickness / 2)).setSensor(p.rolls);
  if (p.scrollCollision !== 'cylinder' && p.scrollModel && mesh && mesh.positions.length >= 9) {
    // The scroll model as drawn: at its units and scale, centred on its box.
    const k = (p.scrollUnits === 'units' ? 1 : UNITS_PER_METRE) * (p.scrollScale > 0 ? p.scrollScale : 1);
    const pts = new Float32Array(mesh.positions.length);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i++) {
      pts[i] = mesh.positions[i]! * k;
      min[i % 3] = Math.min(min[i % 3]!, pts[i]!);
      max[i % 3] = Math.max(max[i % 3]!, pts[i]!);
    }
    const mid = [0, 1, 2].map((a) => (min[a]! + max[a]!) / 2);
    if (p.scrollCollision === 'box') return RAPIER.ColliderDesc.cuboid(...([0, 1, 2].map((a) => Math.max(0.25, (max[a]! - min[a]!) / 2)) as Q3));
    for (let i = 0; i < pts.length; i++) pts[i] = pts[i]! - mid[i % 3]!;
    const h = hull(pts);
    if (h) return h;
  }
  const r = posterScrollRadius(p);
  return RAPIER.ColliderDesc.capsule(Math.max(0, p.width / 2 - r), r).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });
}

/** A Collision shape component's collider, at an object's scale. */
function pointCollider(shape: ColliderData, s: Q3): RAPIER.ColliderDesc {
  const size = [shape.size[0] * s[0], shape.size[1] * s[1], shape.size[2] * s[2]];
  let desc: RAPIER.ColliderDesc;
  if (shape.shape === 'sphere') desc = RAPIER.ColliderDesc.ball(Math.max(0.5, size[0]! / 2));
  else if (shape.shape === 'capsule') {
    const r = Math.max(0.5, size[0]! / 2);
    desc = RAPIER.ColliderDesc.capsule(Math.max(0, size[1]! / 2 - r), r);
  } else desc = RAPIER.ColliderDesc.cuboid(Math.max(0.25, size[0]! / 2), Math.max(0.25, size[1]! / 2), Math.max(0.25, size[2]! / 2));
  return desc.setTranslation(shape.offset[0] * s[0], shape.offset[1] * s[1], shape.offset[2] * s[2]);
}

/**
 * A model's colliders at an object's scale (and the model's units): its bounding box, its convex hull, or its
 * triangles. Things that move use the hull instead of the triangles (moving triangle meshes collide badly).
 */
function modelColliders(data: ModelData, mesh: ModelMesh, scale: Q3, moves: boolean): { desc: RAPIER.ColliderDesc; part?: number }[] {
  const k = unitsOf(data);
  const sized = (src: Float32Array) => {
    const pts = new Float32Array(src.length);
    for (let i = 0; i < pts.length; i++) pts[i] = src[i]! * k * scale[i % 3]!;
    return pts;
  };
  if (mesh.parts?.length) {
    const out: { desc: RAPIER.ColliderDesc; part: number }[] = [];
    mesh.parts.forEach((p, part) => {
      const pts = sized(p.positions);
      const desc = p.exact && !moves && p.indices.length >= 3 ? RAPIER.ColliderDesc.trimesh(pts, p.indices) : (boxOf(pts) ?? hull(pts));
      if (desc) out.push({ desc, part });
    });
    return out;
  }
  if (data.collision === 'auto') return [];
  const pts = sized(mesh.positions);
  if (data.collision === 'box') {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, pts[i]!);
      max[i % 3] = Math.max(max[i % 3]!, pts[i]!);
    }
    const half = [0, 1, 2].map((a) => Math.max(0.25, (max[a]! - min[a]!) / 2));
    return [{ desc: RAPIER.ColliderDesc.cuboid(half[0]!, half[1]!, half[2]!).setTranslation((min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2) }];
  }
  if (data.collision === 'exact' && !moves && mesh.indices.length >= 3) return [{ desc: RAPIER.ColliderDesc.trimesh(pts, mesh.indices) }];
  const h = hull(pts);
  return h ? [{ desc: h }] : [];
}

/** A print under way: what of, its copy (and number), seconds printed of how many, made by the start blocks. */
interface PrintJob {
  template: string;
  copy: string;
  n: number;
  t: number;
  seconds: number;
  atStart: boolean;
}

const unitsOf = (data: ModelData) => (data.units === 'units' ? 1 : UNITS_PER_METRE);

/** A collision mesh that the model's animation moves: `s` turns the file's units into the body's. */
interface MovingPart {
  collider: RAPIER.Collider;
  t: Q3;
  q: Quat;
  s: Q3;
}

function movingPart(collider: RAPIER.Collider, desc: RAPIER.ColliderDesc, data: ModelData, scale: Q3): MovingPart {
  const k = unitsOf(data);
  const { x, y, z } = desc.translation;
  const r = desc.rotation;
  return { collider, t: [x, y, z], q: { x: r.x, y: r.y, z: r.z, w: r.w }, s: [scale[0] * k, scale[1] * k, scale[2] * k] };
}

/** A collision mesh that is a box (8 corners, square sides): a box collider, cheaper and steadier than a hull. */
function boxOf(pts: Float32Array): RAPIER.ColliderDesc | null {
  const corners: Q3[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    const p: Q3 = [pts[i]!, pts[i + 1]!, pts[i + 2]!];
    if (corners.some((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2 < 1e-4)) continue;
    corners.push(p);
    if (corners.length > 8) return null;
  }
  if (corners.length !== 8) return null;
  const o = corners[0]!;
  const sub = (p: Q3): Q3 => [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const dot = (a: Q3, b: Q3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const square = (a: Q3, b: Q3) => Math.abs(dot(a, b)) <= 1e-3 * Math.sqrt(dot(a, a) * dot(b, b));
  const edges = corners.slice(1).map(sub).sort((a, b) => dot(a, a) - dot(b, b));
  const a = edges[0]!, b = edges[1]!;
  const c = edges.find((e) => square(e, a) && square(e, b));
  if (!c || !square(a, b) || dot(a, a) < 1e-4) return null;
  const axes = [a, b, c];
  for (const p of corners) {
    const d = sub(p);
    const f = axes.map((e) => dot(d, e) / dot(e, e));
    if (f.some((x) => Math.abs(x) > 1e-3 && Math.abs(x - 1) > 1e-3)) return null;
    const back = axes.reduce((acc, e, i) => acc.map((v, k) => v + e[k]! * f[i]!) as Q3, [0, 0, 0] as Q3);
    if (dot([back[0] - d[0], back[1] - d[1], back[2] - d[2]], [back[0] - d[0], back[1] - d[1], back[2] - d[2]]) > 1e-4) return null;
  }
  const len = axes.map((e) => Math.sqrt(dot(e, e)));
  const u = axes.map((e, i) => e.map((v) => v / len[i]!) as Q3);
  // (A right-handed turn: the third axis is the cross of the first two.)
  const w: Q3 = [u[0]![1] * u[1]![2] - u[0]![2] * u[1]![1], u[0]![2] * u[1]![0] - u[0]![0] * u[1]![2], u[0]![0] * u[1]![1] - u[0]![1] * u[1]![0]];
  const q = quatFromMatrix([...u[0]!, 0, ...u[1]!, 0, ...w, 0, 0, 0, 0, 1]);
  const centre = [0, 1, 2].map((k) => o[k]! + (a[k]! + b[k]! + c[k]!) / 2);
  return RAPIER.ColliderDesc.cuboid(Math.max(0.25, len[0]! / 2), Math.max(0.25, len[1]! / 2), Math.max(0.25, len[2]! / 2))
    .setTranslation(centre[0]!, centre[1]!, centre[2]!)
    .setRotation(q);
}

/**
 * Where a hull's own origin sits, off every grid. The physics engine's shape casts go wrong when the player is
 * exactly above a hull's origin (they pass through it): with origins at the level's 0,0,0 or an object's middle,
 * that's exactly where people put Player starts. Nobody stands at a spot like this one by chance.
 */
const HULL_ORIGIN = [0.3183, 0.1414, 0.2718] as const;

/** A convex hull collider whose own origin is HULL_ORIGIN (the points stay where they are). */
function hull(pts: Float32Array): RAPIER.ColliderDesc | null {
  const shifted = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i++) shifted[i] = pts[i]! - HULL_ORIGIN[i % 3]!;
  const desc = RAPIER.ColliderDesc.convexHull(shifted);
  return desc ? desc.setTranslation(...HULL_ORIGIN) : null;
}

function trimesh(b: Brush): RAPIER.ColliderDesc | null {
  const m = buildMesh([b]);
  return m.indices.length ? RAPIER.ColliderDesc.trimesh(m.positions, m.indices) : null;
}

/** A brush entity's bounds (for pivots). */
function boundsOfEntity(x: EntityData) {
  const d = x.components.brush as unknown as BrushData | undefined;
  return d?.faces ? bounds(fromData({ faces: d.faces, mesh: d.mesh })) : null;
}

/** Up to ~500 of a model's corners, placed in the world. */
function sampled(positions: ArrayLike<number>, m: number[]): number[][] {
  const out: number[][] = [];
  const n = positions.length / 3, step = Math.max(1, Math.floor(n / 500));
  for (let i = 0; i < n; i += step) out.push(applyMat4(m, [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!]));
  return out;
}

/** An angle as a turn between −π and π. */
function turnOf(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

const conj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
/** A vector turned by a quaternion. */
function rotate(q: Quat, v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty, y: v.y + q.w * ty + q.z * tx - q.x * tz, z: v.z + q.w * tz + q.x * ty - q.y * tx };
}
