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
  type GameRules,
} from '@cocoaworlds/core';
import { EventBus } from './events';
import { ScriptRunner, compileScript, type ActionName, type GameValueDef, type Problem, type Program, type Script, type Value } from '@cocoaworlds/scripting';
import { scriptTargets } from './script-targets';
import { PLAYER, Player, fallDamage, type PlayerInput } from './player';
import { bounds, brushToWorld, buildMesh, buildWorld, fromData, hullPoints, vertices, type Brush, type BrushData, type WorldBrush } from '@cocoaworlds/geometry';

/** Units per metre (an inch-based world). */
export const UNITS_PER_METRE = 39.37;
/** Physics runs at a fixed rate whatever the frame rate. */
export const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

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
  from: { p: Q3; q: Quat };
  to: { p: Q3; q: Quat };
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
  private events = new RAPIER.EventQueue(true);
  private bodies = new Map<string, Body>();
  /** Collider handle → entity id. */
  private owner = new Map<number, string>();
  private triggers = new Map<number, { id: string; data: TriggerData; fired: boolean; inside: Set<string> }>();
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

  /** Which built-in game systems are on (from the project settings). */
  readonly rules: GameRules;

  /** Build a world from a scene snapshot. Call `initPhysics()` first. */
  static create(scene: SceneFile, options: { rules?: Partial<GameRules>; values?: GameValueDef[] } = {}): GameWorld {
    return new GameWorld(scene, gameRules({ game: options.rules }), options.values ?? []);
  }

  private constructor(scene: SceneFile, rules: GameRules, values: GameValueDef[]) {
    this.rules = rules;
    this.valueDefs = values;
    for (const v of values) this.globals.set(v.name, v.initial);
    const doc = new SceneDoc(structuredClone(scene));
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
    const targets = scriptTargets(scripts).filter((id) => doc.get(id) && !own(doc.get(id)!));
    const unitRoots = targets.filter((id) => !targets.some((o) => o !== id && doc.isAncestor(o, id)));
    const unitOf = new Map<string, string>();
    for (const root of unitRoots) for (const e of doc.subtree(root)) if (!own(e) || e.id === root) unitOf.set(e.id, root);
    const unitBrushes = new Map<string, Brush[]>(unitRoots.map((r) => [r, []]));
    const scriptedZones = new Set(scriptTargets(scripts).filter((id) => doc.get(id)?.components.trigger));

    const level: WorldBrush[] = [];
    for (const e of doc.entities) {
      if (!shown(e)) continue;
      const brushData = e.components.brush as unknown as (BrushData & { role?: string }) | undefined;
      if (brushData?.faces) {
        const brush = brushToWorld(fromData({ faces: brushData.faces, mesh: brushData.mesh }), doc.worldMatrix(e.id));
        if (e.components.trigger) this.addTrigger(e, brush, scriptedZones.has(e.id));
        else if (e.components.rigidBody) this.addBrushBody(e, brush);
        else if (unitOf.has(e.id) && brushData.role !== 'subtract') unitBrushes.get(unitOf.get(e.id)!)!.push(brush);
        else level.push({ id: e.id, role: brushData.role === 'subtract' ? 'subtract' : 'solid', brush });
      } else if (e.components.rigidBody) {
        this.addPointBody(e, doc.worldMatrix(e.id));
      }
    }
    this.addLevel(level);
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
      const desc = RAPIER.ColliderDesc.convexHull(pts);
      if (!desc) continue;
      const c = this.world.createCollider(desc.setFriction(0.6), body);
      this.owner.set(c.handle, id);
    }
    this.track(id, 'unit', 'kinematic', body, brushes);
  }

  /** The level: every plain solid brush (after live subtract) as one fixed body made of convex pieces. */
  private addLevel(brushes: WorldBrush[]): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const s of buildWorld(brushes).solids) {
      for (const piece of s.pieces) {
        // Edited meshes (G4) may have dents: collide with their actual triangles.
        const desc = piece.mesh ? trimesh(piece) : RAPIER.ColliderDesc.convexHull(hullPoints(piece));
        if (!desc) continue;
        desc.setFriction(0.6);
        const c = this.world.createCollider(desc, body);
        this.owner.set(c.handle, s.id);
        this.stats.staticPieces++;
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
    const desc = RAPIER.ColliderDesc.convexHull(pts);
    if (!desc) return;
    const body = this.world.createRigidBody(this.bodyDesc(rb).setTranslation(c[0]!, c[1]!, c[2]!));
    const col = this.world.createCollider(this.material(desc, rb), body);
    this.owner.set(col.handle, e.id);
    this.track(e.id, 'brush', rb.motion, body, [brush]);
  }

  /** A point object (empty, light, …) with a collision shape. */
  private addPointBody(e: EntityData, world: number[]): void {
    const rb = readComponent<RigidBodyData>('rigidBody', e.components.rigidBody);
    const shape = readComponent<ColliderData>('collider', e.components.collider);
    const t = decomposeMat4(world);
    const s = t.scale.map(Math.abs);
    const size = [shape.size[0] * s[0]!, shape.size[1] * s[1]!, shape.size[2] * s[2]!];
    let desc: RAPIER.ColliderDesc;
    if (shape.shape === 'sphere') desc = RAPIER.ColliderDesc.ball(Math.max(0.5, size[0]! / 2));
    else if (shape.shape === 'capsule') {
      const r = Math.max(0.5, size[0]! / 2);
      desc = RAPIER.ColliderDesc.capsule(Math.max(0, size[1]! / 2 - r), r);
    } else desc = RAPIER.ColliderDesc.cuboid(Math.max(0.25, size[0]! / 2), Math.max(0.25, size[1]! / 2), Math.max(0.25, size[2]! / 2));
    desc.setTranslation(shape.offset[0] * s[0]!, shape.offset[1] * s[1]!, shape.offset[2] * s[2]!);
    // Body placement: position and rotation only (scale went into the shape).
    const placement = composeTransform({ position: t.position, rotation: t.rotation, scale: [1, 1, 1] });
    const q = quatFromMatrix(placement);
    const body = this.world.createRigidBody(this.bodyDesc(rb).setTranslation(...t.position).setRotation(q));
    const col = this.world.createCollider(this.material(desc, rb), body);
    this.owner.set(col.handle, e.id);
    this.track(e.id, 'point', rb.motion, body);
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
    this.triggers.set(c.handle, { id: e.id, data: readComponent<TriggerData>('trigger', e.components.trigger), fired: false, inside: new Set() });
    this.stats.triggers++;
  }

  /** Advance by `dt` seconds of real time, in fixed physics steps. Returns the number of steps taken. */
  step(dt: number): number {
    if (this.disposed) return 0;
    this.accumulator = Math.min(this.accumulator + Math.max(0, dt), STEP * MAX_STEPS_PER_FRAME);
    let n = 0;
    if (!this.startedScripts) {
      // “When the game starts” runs on the first frame.
      this.startedScripts = true;
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

  /** The player pressed Use: on the next step, whatever they look at within reach gets “When the player uses this”. */
  use(): void {
    this.useQueued = true;
  }

  /** The camera for the player's view, smoothed between physics steps. */
  playerView(): { eye: [number, number, number]; yaw: number; pitch: number } | null {
    const p = this.player;
    if (!p) return null;
    return { eye: p.eye(Math.min(1, this.accumulator / STEP)), yaw: p.input.yaw, pitch: p.input.pitch };
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
    const b = this.bodies.get(target);
    const label = this.names.get(target) ?? 'That object';
    if (!b) throw new Error(`${label} can't be moved or switched by scripts here.`);
    const n = (v: Value) => (typeof v === 'number' ? v : 0);
    const t = b.body.translation(), r = b.body.rotation();
    const now = { p: [t.x, t.y, t.z] as Q3, q: { x: r.x, y: r.y, z: r.z, w: r.w } };
    switch (name) {
      case 'move': {
        const [dist, dx, dy, dz, sec] = args.map(n) as [number, number, number, number, number];
        return this.tween(target, b, now, { p: [now.p[0] + dx * dist, now.p[1] + dy * dist, now.p[2] + dz * dist], q: now.q }, sec);
      }
      case 'turn': {
        const axis = args[0] === 'north' ? [0, 0, -1] : args[0] === 'east' ? [1, 0, 0] : [0, 1, 0];
        const deg = n(args[1] ?? 0), sec = n(args[2] ?? 0);
        const half = (deg * Math.PI) / 360;
        const rq = { x: axis[0]! * Math.sin(half), y: axis[1]! * Math.sin(half), z: axis[2]! * Math.sin(half), w: Math.cos(half) };
        return this.tween(target, b, now, { p: now.p, q: qmul(rq, now.q) }, sec);
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
    }
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
    return b ? multiply(poseMatrix(b.body), b.startInverse) : null;
  }

  /** World position of a body now (for tests and debugging). */
  positionOf(id: string): [number, number, number] | null {
    const t = this.bodies.get(id)?.body.translation();
    return t ? [t.x, t.y, t.z] : null;
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

function trimesh(b: Brush): RAPIER.ColliderDesc | null {
  const m = buildMesh([b]);
  return m.indices.length ? RAPIER.ColliderDesc.trimesh(m.positions, m.indices) : null;
}
