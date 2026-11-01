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
  readComponent,
  type ColliderData,
  type EntityData,
  type RigidBodyData,
  type SceneFile,
  type TriggerData,
} from '@cocoaworlds/core';
import { EventBus } from './events';
import { brushToWorld, buildWorld, fromData, hullPoints, vertices, type Brush, type BrushData, type WorldBrush } from '@cocoaworlds/geometry';

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
  /** 'brush' bodies are brushes that move; 'point' bodies are lights, empties etc. with a collision shape. */
  kind: 'brush' | 'point';
  motion: RigidBodyData['motion'];
}

interface Body {
  info: BodyInfo;
  body: RAPIER.RigidBody;
  /** Inverse of the body's starting placement, so motion can be reported as "start → now". */
  startInverse: number[];
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

  /** Build a world from a scene snapshot. Call `initPhysics()` first. */
  static create(scene: SceneFile): GameWorld {
    return new GameWorld(scene);
  }

  private constructor(scene: SceneFile) {
    const doc = new SceneDoc(structuredClone(scene));
    this.world = new RAPIER.World({ x: 0, y: -(doc.settings.gravity ?? 800), z: 0 });
    this.world.lengthUnit = UNITS_PER_METRE;
    this.world.timestep = STEP;

    const shown = (e: EntityData) => {
      for (let x: EntityData | undefined = e; x; x = x.parent ? doc.get(x.parent) : undefined) if (!x.visible) return false;
      return true;
    };
    const level: WorldBrush[] = [];
    for (const e of doc.entities) {
      if (!shown(e)) continue;
      const brushData = e.components.brush as unknown as (BrushData & { role?: string }) | undefined;
      if (brushData?.faces) {
        const brush = brushToWorld(fromData({ faces: brushData.faces }), doc.worldMatrix(e.id));
        if (e.components.trigger) this.addTrigger(e, brush);
        else if (e.components.rigidBody) this.addBrushBody(e, brush);
        else level.push({ id: e.id, role: brushData.role === 'subtract' ? 'subtract' : 'solid', brush });
      } else if (e.components.rigidBody) {
        this.addPointBody(e, doc.worldMatrix(e.id));
      }
    }
    this.addLevel(level);
  }

  /** The level: every plain solid brush (after live subtract) as one fixed body made of convex pieces. */
  private addLevel(brushes: WorldBrush[]): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const s of buildWorld(brushes).solids) {
      for (const piece of s.pieces) {
        const desc = RAPIER.ColliderDesc.convexHull(hullPoints(piece));
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
    this.track(e.id, 'brush', rb.motion, body);
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

  private track(id: string, kind: BodyInfo['kind'], motion: BodyInfo['motion'], body: RAPIER.RigidBody): void {
    this.bodies.set(id, { info: { id, kind, motion }, body, startInverse: invertRigid(poseMatrix(body)) });
    this.stats.bodies++;
  }

  /** A trigger zone: a sensor that reports what enters and leaves. */
  private addTrigger(e: EntityData, brush: Brush): void {
    const desc = RAPIER.ColliderDesc.convexHull(hullPoints(brush));
    if (!desc) return;
    desc.setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
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
    while (this.accumulator >= STEP) {
      this.world.step(this.events);
      this.accumulator -= STEP;
      this.time += STEP;
      n++;
      this.events.drainCollisionEvents((h1, h2, started) => this.onContact(h1, h2, started));
    }
    return n;
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
