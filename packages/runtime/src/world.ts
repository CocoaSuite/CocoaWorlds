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
  composeTransform,
  decomposeMat4,
  pivotOf,
  readComponent,
  type ColliderData,
  type EntityData,
  type RigidBodyData,
  type SceneFile,
  type TriggerData,
  gameRules,
  type BreakableData,
  type ConveyorData,
  type SoundData,
  type GameRules,
  type ModelData,
  type UiSettings,
  uiOf,
  uiShown,
} from '@cocoaworlds/core';
import { EventBus } from './events';
import { DIRECTIONS, ScriptRunner, compileScript, type ActionName, type GameValueDef, type Problem, type Program, type SceneInfo, type Script, type Value } from '@cocoaworlds/scripting';
import { scriptTargets } from './script-targets';
import { PLAYER, Player, fallDamage, type PlayerInput } from './player';
import { bounds, brushToWorld, buildMesh, buildWorld, fromData, hullPoints, vertices, type Brush, type BrushData, type WorldBrush } from '@cocoaworlds/geometry';

/** Units per metre (an inch-based world). */
export const UNITS_PER_METRE = 39.37;

/**
 * Saved progress: the kept game values and, when the game keeps them, the player's items. The game saves it
 * (browser storage) and hands it back to the next session.
 */
export interface SavedProgress {
  values: Record<string, Value>;
  items?: [string, number][];
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
}
/** Physics runs at a fixed rate whatever the frame rate. */
export const STEP = 1 / 60;
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
type Quat = { x: number; y: number; z: number; w: number };

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
  /** Physics settings, when it has a Physics component. */
  rb?: RigidBodyData;
}

/** The player's state for the screen (health bar, score). */
export interface PlayerStatus {
  /** The project uses health (otherwise nothing hurts and no health bar shows). */
  showHealth: boolean;
  health: number;
  maxHealth: number;
  score: number;
  /** Whether any script uses the score (otherwise the screen doesn't show it). */
  showScore: boolean;
  /** Seconds since the player was last hurt (Infinity if never), for a red flash. */
  sinceHurt: number;
  deaths: number;
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
  /** The player, when the scene has a Player start. */
  readonly player: Player | null = null;
  private parentOf = new Map<string, string | null>();
  private useQueued = false;
  /** Below this the player has fallen out of the world and starts again. */
  private killY = -Infinity;
  private health: number = PLAYER.maxHealth;
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
  private removedIds: string[] = [];
  private copies = 0;
  /** Breakable objects' health. */
  private breakHealth = new Map<string, number>();
  /** Conveyor collider handle → belt velocity. */
  private belts = new Map<number, { x: number; z: number }>();

  /** Which built-in game systems are on (from the project settings). */
  readonly rules: GameRules;

  /** Build a world from a scene snapshot. Call `initPhysics()` first. */
  /** `models`: the triangles of the model files that objects collide by (Model component, Collision). */
  static create(
    scene: SceneFile,
    options: { rules?: Partial<GameRules>; values?: GameValueDef[]; models?: Map<string, ModelMesh>; saved?: SavedProgress | null; clock?: () => number } = {},
  ): GameWorld {
    const w = new GameWorld(scene, gameRules({ game: options.rules }), options.values ?? [], options.models ?? new Map());
    if (options.clock) w.clock = options.clock;
    if (options.saved) w.loadProgress(options.saved);
    return w;
  }

  /** The real time in seconds since 1970 (replaceable for tests). */
  private clock = () => Date.now() / 1000;

  /** Start from saved progress: kept values (of the right type) and, if the game keeps them, items. */
  private loadProgress(saved: SavedProgress): void {
    for (const d of this.valueDefs) {
      if (!d.saved || !(d.name in (saved.values ?? {}))) continue;
      const v = saved.values[d.name];
      if (typeof v === (d.type === 'boolean' ? 'boolean' : d.type === 'number' ? 'number' : 'string')) this.globals.set(d.name, v as Value);
    }
    if (this.rules.saveItems && Array.isArray(saved.items))
      for (const [name, n] of saved.items) if (typeof name === 'string' && typeof n === 'number' && n > 0) this.inventory.set(name, Math.round(n));
  }

  /** What is kept between sessions right now, or null when the game keeps nothing. */
  progress(): SavedProgress | null {
    const kept = this.valueDefs.filter((d) => d.saved);
    if (!kept.length && !this.rules.saveItems) return null;
    const out: SavedProgress = { values: Object.fromEntries(kept.map((d) => [d.name, this.globals.get(d.name) ?? d.initial])) };
    if (this.rules.saveItems) out.items = [...this.inventory];
    return out;
  }

  /** Start over: kept values back to their starting values, kept items emptied. */
  forgetProgress(): void {
    for (const d of this.valueDefs) if (d.saved) this.globals.set(d.name, d.initial);
    if (this.rules.saveItems) {
      this.inventory.clear();
      this.slot = 0;
    }
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

  /** Model triangles by file (see `create`). */
  private models: Map<string, ModelMesh>;

  private constructor(scene: SceneFile, rules: GameRules, values: GameValueDef[], models: Map<string, ModelMesh>) {
    this.models = models;
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
    const doc = new SceneDoc(structuredClone(scene));
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
    const info = { objects, rules, globals: values.map((v) => ({ name: v.name, type: v.type })), signs: new Set(this.signs.keys()) };
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

    // Objects scripts move or switch become "units": one body for the object and everything inside it.
    const own = (e: EntityData) => !!e.components.rigidBody || !!e.components.trigger;
    // (Breakable objects too: they disappear when they break.)
    const breakables = doc.entities.filter((e) => e.components.breakable && shown(e)).map((e) => e.id);
    for (const id of breakables) this.breakHealth.set(id, readComponent<BreakableData>('breakable', doc.get(id)!.components.breakable).health);
    const targets = [...new Set([...scriptTargets(scripts), ...breakables])].filter((id) => doc.get(id) && !own(doc.get(id)!));
    const unitRoots = targets.filter((id) => !targets.some((o) => o !== id && doc.isAncestor(o, id)));
    const unitOf = this.unitOf;
    for (const root of unitRoots) for (const e of doc.subtree(root)) if (!own(e) || e.id === root) unitOf.set(e.id, root);
    const unitBrushes = new Map<string, Brush[]>(unitRoots.map((r) => [r, []]));
    const scriptedZones = new Set(scriptTargets(scripts).filter((id) => doc.get(id)?.components.trigger));

    const level: WorldBrush[] = [];
    const conveyors = new Map<string, ConveyorData>();
    for (const e of doc.entities) {
      if (!shown(e)) continue;
      const brushData = e.components.brush as unknown as (BrushData & { role?: string }) | undefined;
      if (brushData?.faces) {
        const brush = brushToWorld(fromData({ faces: brushData.faces, mesh: brushData.mesh }), doc.worldMatrix(e.id));
        if (e.components.trigger) this.addTrigger(e, brush, scriptedZones.has(e.id));
        else if (e.components.rigidBody) this.addBrushBody(e, brush);
        else if (unitOf.has(e.id) && brushData.role !== 'subtract') unitBrushes.get(unitOf.get(e.id)!)!.push(brush);
        else level.push({ id: e.id, role: brushData.role === 'subtract' ? 'subtract' : 'solid', brush });
        if (e.components.conveyor && !unitOf.has(e.id)) conveyors.set(e.id, readComponent<ConveyorData>('conveyor', e.components.conveyor));
      } else if (e.components.rigidBody || e.components.collider || this.modelShape(e)) {
        // (A Collision shape or a colliding model without Physics stays put.)
        this.addPointBody(e, doc.worldMatrix(e.id));
      }
    }
    this.addLevel(level, conveyors);
    this.levelIds = new Set(level.map((b) => b.id));
    // A unit turns around its pivot (the centre of what it holds unless one was set).
    const boundsOf = (x: EntityData) => {
      const d = x.components.brush as unknown as BrushData | undefined;
      return d?.faces ? bounds(fromData({ faces: d.faces, mesh: d.mesh })) : null;
    };
    for (const root of unitRoots) this.addUnit(root, doc.worldMatrix(root), unitBrushes.get(root)!, pivotOf(doc, root, boundsOf));

    // The player: at the first visible Player start, facing the way it faces.
    const spawn = doc.entities.find((e) => e.components.playerSpawn && shown(e));
    if (spawn) {
      const m = doc.worldMatrix(spawn.id);
      const yaw = Math.atan2(m[8]!, m[10]!);
      const p = new Player(this.world, { x: m[12]!, y: m[13]!, z: m[14]! }, yaw, doc.settings.gravity ?? 800);
      this.owner.set(p.collider.handle, 'player');
      p.beltOf = (h) => this.belts.get(h) ?? null;
      p.surroundings = {
        // (Plain lookups only: this runs inside the physics engine's own query.)
        blocks: (c) => this.standInOf.has(c.handle) || (!this.triggers.has(c.handle) && !this.standIns.has(c.handle)),
        carry: (h, at) => this.carry(h, at),
      };
      this.player = p;
      let low = m[13]!;
      for (const b of level) for (const v of vertices(b.brush)) low = Math.min(low, v[1]!);
      this.killY = low - 2048;
    }

    this.runner = new ScriptRunner(programs, {
      now: () => this.time,
      random: Math.random,
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
        else this.heal(amount);
      },
      read: (name) => (name === 'health' ? this.health : this.score),
      getGlobal: (name) => this.globals.get(name) ?? null,
      setGlobal: (name, value) => void this.globals.set(name, value),
      say: (text, seconds, from) => this.say(text, seconds, from),
      playSound: (sound, place, volume, owner) => {
        const at = place === null ? null : this.placePoint(place);
        if (place !== null && !at) return;
        const follow = place && typeof place === 'object' && place.ref !== 'player' ? this.bodyOf(place.ref) : null;
        this.bus.emit({ type: 'sound', sound, at, follow, volume, loop: false, range: 2048, source: owner, time: this.time });
      },
      stopSound: (target) => this.bus.emit({ type: 'sound.stop', source: target, time: this.time }),
      playAnimation: (target, name, loop) => this.bus.emit({ type: 'anim', target, name, loop, time: this.time }),
      spawn: (template, place) => this.spawn(template, place),
      isInside: (zone, what) => this.isInside(zone, what),
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
      setUiText: (id, text) => void this.uiText.set(id, text),
      giveItem: (name, amount) => this.giveItem(name, amount),
      itemCount: (name) => this.inventory.get(name) ?? 0,
      selectedItem: () => this.selectedItem(),
      setText: (target, text) => {
        if (!this.signs.has(target) || this.signs.get(target) === text) return;
        this.signs.set(target, text);
        this.signVersion++;
      },
    });
    this.usesScore = rules.score && scripts.some(([, s]) => /"kind":"(score|addScore)"/.test(JSON.stringify(s.handlers)));
  }

  /** An object moved by scripts: a kinematic body at its place, carrying the hulls of every brush inside it. */
  private addUnit(id: string, world: number[], brushes: Brush[], pivot: [number, number, number]): void {
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
    }
    this.track(id, 'unit', 'kinematic', body, brushes);
  }

  /** The level: every plain solid brush (after live subtract) as one fixed body made of convex pieces. */
  private addLevel(brushes: WorldBrush[], conveyors: Map<string, ConveyorData> = new Map()): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const s of buildWorld(brushes).solids) {
      for (const piece of s.pieces) {
        // Edited meshes (G4) may have dents: collide with their actual triangles.
        const desc = piece.mesh ? trimesh(piece) : hull(hullPoints(piece));
        if (!desc) continue;
        desc.setFriction(0.6);
        const c = this.world.createCollider(desc, body);
        this.owner.set(c.handle, s.id);
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

  private material(desc: RAPIER.ColliderDesc, rb: RigidBodyData): RAPIER.ColliderDesc {
    // An object's own Bounce wins over the floor's, so the Inspector value means what it says.
    desc.setFriction(rb.friction).setRestitution(rb.bounciness).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    if (rb.motion === 'dynamic') desc.setMass(Math.max(0.01, rb.mass));
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
    this.track(e.id, 'brush', rb.motion, body, [brush]);
    this.bodies.get(e.id)!.rb = rb;
  }

  /** The model an object collides by: it has a Model with Collision set, no Collision shape, and the triangles. */
  private modelShape(e: EntityData): { data: ModelData; mesh: ModelMesh } | null {
    if (!e.components.model || e.components.collider) return null;
    const data = readComponent<ModelData>('model', e.components.model);
    const mesh = data.collision !== 'none' ? this.models.get(data.model) : undefined;
    return mesh && mesh.positions.length >= 9 ? { data, mesh } : null;
  }

  /**
   * A point object (empty, light, model …) with a collision shape: a Collision shape component, or its model's
   * shape. Without Physics it stays put.
   */
  private addPointBody(e: EntityData, world: number[]): void {
    const rb = e.components.rigidBody ? readComponent<RigidBodyData>('rigidBody', e.components.rigidBody) : { ...readComponent<RigidBodyData>('rigidBody', {}), motion: 'fixed' as const };
    const t = decomposeMat4(world);
    const scale = t.scale.map(Math.abs) as Q3;
    const model = this.modelShape(e);
    const shape = model ? null : readComponent<ColliderData>('collider', e.components.collider);
    const descs = model ? modelColliders(model.data, model.mesh, scale, rb.motion === 'dynamic') : [pointCollider(shape!, scale)];
    // Body placement: position and rotation only (scale went into the shape).
    const placement = composeTransform({ position: t.position, rotation: t.rotation, scale: [1, 1, 1] });
    const q = quatFromMatrix(placement);
    const body = this.world.createRigidBody(this.bodyDesc(rb).setTranslation(...t.position).setRotation(q));
    for (const desc of descs) {
      const col = this.world.createCollider(this.material(desc, rb), body);
      this.owner.set(col.handle, e.id);
    }
    this.track(e.id, 'point', rb.motion, body);
    const b = this.bodies.get(e.id)!;
    if (model) b.model = { ...model, matrix: world };
    else b.shape = { collider: shape!, matrix: world };
    b.rb = rb;
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
    });
    if (kind !== 'zone') this.stats.bodies++;
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
    if (this.disposed) return 0;
    this.accumulator = Math.min(this.accumulator + Math.max(0, dt), STEP * MAX_STEPS_PER_FRAME);
    let n = 0;
    if (!this.startedScripts) {
      // “When the game starts” runs on the first frame, and sounds that play from the start begin.
      this.startedScripts = true;
      for (const e of this.doc.entities) if (e.components.sound && this.isShown(e)) this.startSound(e.id, readComponent<SoundData>('sound', e.components.sound), null);
      this.runner.start();
    }
    while (this.accumulator >= STEP) {
      this.applyTweens(this.time + STEP);
      if (this.player) {
        this.player.step(STEP);
        if (this.player.landingSpeed) {
          const damage = fallDamage(this.player.landingSpeed);
          this.player.landingSpeed = 0;
          if (damage > 0) this.hurt(damage, 'a fall');
        }
        if (this.player.feetPosition.y < this.killY) {
          if (this.rules.health) this.die('falling out of the world');
          else this.player.respawn();
        }
        if (this.useQueued) this.doUse();
      }
      this.useQueued = false;
      this.carryOnBelts();
      this.syncStandIns();
      this.world.step(this.events);
      this.accumulator -= STEP;
      this.time += STEP;
      n++;
      this.events.drainCollisionEvents((h1, h2, started) => this.onContact(h1, h2, started));
      this.runner.tick(STEP);
    }
    return n;
  }

  private startedScripts = false;

  // ── The player ──

  /** What the player is pressing (from the keyboard and mouse). */
  setPlayerInput(input: Partial<PlayerInput>): void {
    if (this.player) Object.assign(this.player.input, input);
  }

  /**
   * What pressing Use would do right now: the prompt of what the player is looking at within reach ('' for
   * no word), or null when there's nothing to use.
   */
  usePrompt(): string | null {
    const hit = this.player?.aim();
    const id = hit ? this.owner.get(hit.handle) : undefined;
    if (!id || id === 'player') return null;
    const targets: string[] = [];
    for (let x: string | null | undefined = id; x; x = this.parentOf.get(x)) targets.push(x);
    return this.runner.usePrompt(targets);
  }

  /** The player pressed Use: on the next step, whatever they look at within reach gets “When the player uses this”. */
  use(): void {
    this.useQueued = true;
  }

  /** The camera for the player's view, smoothed between physics steps. */
  playerView(): { eye: [number, number, number]; yaw: number; pitch: number; thirdPerson: boolean; feet: [number, number, number] } | null {
    const p = this.player;
    if (!p) return null;
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
    const hit = this.player!.aim();
    const id = hit ? this.owner.get(hit.handle) : undefined;
    if (!id || id === 'player') return;
    const targets: string[] = [];
    for (let x: string | null | undefined = id; x; x = this.parentOf.get(x)) targets.push(x);
    this.runner.dispatch({ type: 'use', targets, by: 'player' });
    this.bus.emit({ type: 'use', target: id, by: 'player', time: this.time });
  }

  // ── Health and score ──

  /** Take health from the player (a negative amount heals). At 0 the player dies. */
  hurt(amount: number, cause = 'something'): void {
    if (!this.player || !this.rules.health || !Number.isFinite(amount)) return;
    if (amount < 0) return this.heal(-amount);
    if (amount === 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtAt = this.time;
    this.bus.emit({ type: 'player.hurt', amount, health: this.health, cause, time: this.time });
    if (this.health <= 0) this.die(cause);
  }

  /** Give health back, up to the maximum. */
  heal(amount: number): void {
    if (!this.player || !this.rules.health || !Number.isFinite(amount)) return;
    if (amount < 0) return this.hurt(-amount);
    this.health = Math.min(PLAYER.maxHealth, this.health + amount);
  }

  addScore(by: number): void {
    if (!this.rules.score || !Number.isFinite(by) || by === 0) return;
    this.score += by;
    this.usesScore = true;
    this.bus.emit({ type: 'score', score: this.score, by, time: this.time });
  }

  /** The player dies: “When the player dies” runs, and they start again at the Player start with full health. */
  private die(cause: string): void {
    if (!this.player) return;
    this.deaths++;
    this.health = PLAYER.maxHealth;
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
    return { showHealth: this.rules.health, health: this.health, maxHealth: PLAYER.maxHealth, score: this.score, showScore: this.usesScore, sinceHurt: this.time - this.hurtAt, deaths: this.deaths };
  }

  // ── What scripts can do ──

  private act(name: ActionName, target: string, args: Value[]): (() => boolean) | null {
    if (target === 'player') return this.actOnPlayer(name, args);
    const label = this.names.get(target) ?? 'That object';
    if (name === 'damage') return this.damage(target, typeof args[0] === 'number' ? args[0] : 0), null;
    const b = this.bodies.get(target) ?? this.bodies.get(this.unitOf.get(target) ?? '');
    if (!b) throw new Error(`${label} can't be moved or switched by scripts here.`);
    target = b.info.id;
    const n = (v: Value) => (typeof v === 'number' ? v : 0);
    const t = b.body.translation(), r = b.body.rotation();
    const now = { p: [t.x, t.y, t.z] as Q3, q: { x: r.x, y: r.y, z: r.z, w: r.w } };
    switch (name) {
      case 'move': {
        const [dist, dx, dy, dz, sec] = args.map(n) as [number, number, number, number, number];
        return this.tween(target, b, now, { p: [now.p[0] + dx * dist, now.p[1] + dy * dist, now.p[2] + dz * dist], q: now.q }, sec);
      }
      case 'turn':
      case 'turnTo': {
        const axis = args[0] === 'north' ? [0, 0, -1] : args[0] === 'east' ? [1, 0, 0] : [0, 1, 0];
        const deg = n(args[1] ?? 0), sec = n(args[2] ?? 0);
        const half = (deg * Math.PI) / 360;
        const rq = { x: axis[0]! * Math.sin(half), y: axis[1]! * Math.sin(half), z: axis[2]! * Math.sin(half), w: Math.cos(half) };
        // “Turn by” adds to where it is now; “turn to” is measured from how it started.
        return this.tween(target, b, now, { p: now.p, q: qmul(rq, name === 'turn' ? now.q : b.start.q) }, sec);
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
    }
  }

  /** Actions on the player: push and teleport. */
  private actOnPlayer(name: ActionName, args: Value[]): null {
    const p = this.player;
    if (!p) return null;
    const n = (v: Value) => (typeof v === 'number' ? v : 0);
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
    const root = this.doc.get(template);
    if (!root) throw new Error(`${this.names.get(template) ?? 'That object'} can't be copied: only objects placed in the scene can.`);
    const at = this.placePoint(place);
    if (!at) return null;
    const anchor = pivotOf(this.doc, template, boundsOfEntity);
    const offset: Q3 = [at[0] - anchor[0], at[1] - anchor[1], at[2] - anchor[2]];
    const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], offset[2], 1];
    const n = ++this.copies;
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
    const unitBrushes: Brush[] = [];
    for (const e of parts) {
      const id = ids.get(e.id)!;
      const copy: EntityData = { ...remap(e), id };
      this.names.set(id, e.name);
      this.parentOf.set(id, e.id === template ? null : (ids.get(e.parent ?? '') ?? null));
      const world = multiply(shift, this.doc.worldMatrix(e.id));
      const brushData = e.components.brush as unknown as (BrushData & { role?: string }) | undefined;
      if (brushData?.faces) {
        const brush = brushToWorld(fromData({ faces: brushData.faces, mesh: brushData.mesh }), world);
        if (e.components.trigger) this.addTrigger(copy, brush, false);
        else if (e.components.rigidBody) this.addBrushBody(copy, brush);
        else if (brushData.role !== 'subtract' && !rootHasBody) {
          unitBrushes.push(brush);
          this.unitOf.set(id, copyId);
        }
      } else if (e.components.rigidBody || e.components.collider || this.modelShape(e)) this.addPointBody(copy, world);
      if (e.components.breakable) this.breakHealth.set(id, readComponent<BreakableData>('breakable', e.components.breakable).health);
      if (e.components.sign) this.signs.set(id, String((e.components.sign as { text?: unknown }).text ?? ''));
      if (e.components.sound) sounds.push([id, readComponent<SoundData>('sound', e.components.sound), world]);
    }
    if (unitBrushes.length && !this.bodies.has(copyId)) this.addUnit(copyId, multiply(shift, this.doc.worldMatrix(template)), unitBrushes, [at[0], at[1], at[2]]);
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
    const info = { ...this.scriptInfo, objects, signs: new Set(this.signs.keys()) };
    for (const e of parts) {
      const script = e.components.script as unknown as Script | undefined;
      if (!script?.handlers) continue;
      const r = compileScript(ids.get(e.id)!, remap(script), info);
      this.runner.addProgram(r.program);
    }
    this.bus.emit({ type: 'spawn', template, copy: copyId, time: this.time });
    for (const [id, s, w] of sounds) this.startSound(id, s, this.bodyOf(id) ? null : [w[12]!, w[13]!, w[14]!]);
    return copyId;
  }

  /** Take an object (and everything inside it) out of the game. */
  remove(id: string): void {
    const gone = new Set<string>();
    for (const [x] of this.parentOf) {
      for (let y: string | null | undefined = x; y; y = this.parentOf.get(y)) if (y === id) gone.add(x);
    }
    gone.add(id);
    for (const x of gone) {
      const b = this.bodies.get(x);
      if (!b) continue;
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
    for (const x of gone) this.bus.emit({ type: 'sound.stop', source: x, time: this.time });
    this.runner.removeOwners(gone);
  }

  /** Copies made and objects removed since the last call (for drawing). */
  drainChanges(): { spawned: BodyInfo[]; removed: string[] } {
    const spawned = this.spawnedIds.map((id) => this.bodies.get(id)?.info).filter((b): b is BodyInfo => !!b);
    const removed = this.removedIds;
    this.spawnedIds = [];
    this.removedIds = [];
    return { spawned, removed };
  }

  /** A point object's collision shape and placement (for drawing it). */
  pointShape(id: string): { collider: ColliderData; matrix: number[] } | null {
    return this.bodies.get(id)?.shape ?? null;
  }

  // ── Sound ──

  /** A Sound component that plays from the start (or a copy's, as it appears). */
  private startSound(id: string, s: SoundData, at: Q3 | null): void {
    if (!s.sound || !s.playOnStart) return;
    const p = at ?? this.placePoint({ ref: id });
    this.bus.emit({ type: 'sound', sound: s.sound, at: p, follow: this.bodyOf(id), volume: s.volume, loop: s.loop, range: s.range, source: id, time: this.time });
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
    // About wood: 500 kg/m³ in an inch-based world.
    for (let i = 0; i < b.body.numColliders(); i++) b.body.collider(i).setDensity(500 / UNITS_PER_METRE ** 3);
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
    const make = (desc: RAPIER.ColliderDesc | null) => {
      if (!desc) return;
      if (b.rb) this.material(desc, b.rb);
      else desc.setFriction(0.6);
      const c = this.world.createCollider(desc.setCollisionGroups(groups), b.body);
      this.owner.set(c.handle, b.info.id);
    };
    if (b.shape) {
      make(pointCollider(b.shape.collider, decomposeMat4(b.shape.matrix).scale.map((x) => Math.abs(x) * k) as Q3));
    } else if (b.model) {
      const scale = decomposeMat4(b.model.matrix).scale.map((x) => Math.abs(x) * k) as Q3;
      for (const d of modelColliders(b.model.data, b.model.mesh, scale, b.body.isDynamic())) make(d);
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
    const seen = new Set<number>();
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
    return [...this.inventory.keys()][this.slot] ?? '';
  }

  /** Pick a hotbar slot (0-based; wraps around the hotbar's slots). */
  selectSlot(slot: number): void {
    const n = Math.max(1, ...this.ui.screens.flatMap((s) => s.elements.filter((e) => e.kind === 'hotbar').map((e) => e.slots)));
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
      const i = [...this.inventory.keys()].indexOf(row);
      if (i < 0) return;
      this.slot = i;
    } else if (!this.uiRows.get(list)?.includes(row)) return;
    this.runner.dispatch({ type: 'listPick', list, row });
  }

  /** The player pressed a key the game doesn't use itself (letters, Tab): “When the player presses” starts. */
  pressKey(code: string): void {
    this.runner.dispatch({ type: 'key', key: code });
  }

  /** The player clicked with the item in the picked hotbar slot. */
  useItem(): void {
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
      inventory: [...this.inventory].map(([item, count]) => ({ item, count })),
      slot: this.slot,
      freesMouse: this.ui.screens.some((sc) => sc.freesMouse && this.uiShown.has(sc.id)),
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
  const { x, y, z, w } = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    t.x, t.y, t.z, 1,
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

function transformPoint(m: number[], v: readonly number[]): [number, number, number] {
  return [
    m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
    m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
    m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
  ];
}

/** Rotate a vector by a unit quaternion. */
function qrot(q: Quat, v: [number, number, number]): [number, number, number] {
  const [x, y, z] = v;
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)];
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
function modelColliders(data: ModelData, mesh: ModelMesh, scale: Q3, moves: boolean): RAPIER.ColliderDesc[] {
  const k = data.units === 'units' ? 1 : UNITS_PER_METRE;
  const pts = new Float32Array(mesh.positions.length);
  for (let i = 0; i < pts.length; i++) pts[i] = mesh.positions[i]! * k * scale[i % 3]!;
  if (data.collision === 'box') {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, pts[i]!);
      max[i % 3] = Math.max(max[i % 3]!, pts[i]!);
    }
    const half = [0, 1, 2].map((a) => Math.max(0.25, (max[a]! - min[a]!) / 2));
    return [RAPIER.ColliderDesc.cuboid(half[0]!, half[1]!, half[2]!).setTranslation((min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2)];
  }
  if (data.collision === 'exact' && !moves && mesh.indices.length >= 3) return [RAPIER.ColliderDesc.trimesh(pts, mesh.indices)];
  const h = hull(pts);
  return h ? [h] : [];
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
