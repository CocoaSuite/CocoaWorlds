/**
 * Creatures (A1): characters that move on their own with the same kind of character controller as the player.
 *
 * - Enemies notice the player within sight (in front of them, with nothing in the way, or anywhere once
 *   hurt), chase them and attack up close or by shooting; they give up some seconds after losing sight.
 * - Friends follow the player once used (E), keeping a little way off; used again, they stay.
 * - Neutral ones stand about until hurt, then fight back.
 *
 * Scripts can walk any of them to a place (a scripted scene); while walking, a creature does nothing else.
 * They go straight towards where they're heading, sliding along walls and climbing steps; finding a way round
 * obstacles (navigation meshes) comes in A2.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { NpcData } from '@cocoaworlds/core';

type V = { x: number; y: number; z: number };

export const NPC_SIZE = { radius: 16, height: 72, eye: 64 };

export type NpcState = 'idle' | 'chase' | 'attack' | 'walk' | 'follow' | 'dead';

/** What a creature can ask the world. */
export interface NpcWorld {
  readonly world: RAPIER.World;
  time(): number;
  gravity: number;
  /** The player's feet and eyes, or null when there's no player. */
  player(): { feet: V; eye: V; collider: number } | null;
  /** Colliders a creature moves through (zones, water, ladders). */
  passes(c: RAPIER.Collider): boolean;
  /** Hurt the player (an attack up close). */
  hurtPlayer(amount: number, by: string): void;
  /** Fire a shot from `from` along `dir`. */
  shoot(from: V, dir: V, npc: Npc): void;
  /** Play one of the creature's animations (by role: idle, walk, attack, die). */
  animate(npc: Npc, role: 'idle' | 'walk' | 'attack' | 'die', loop: boolean): void;
}

export class Npc {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  state: NpcState = 'idle';
  health: number;
  yaw: number;
  /** Feet position. */
  feet: V;
  private vy = 0;
  private nextAttack = 0;
  /** When the player was last seen, and where. */
  private seenAt = -Infinity;
  private lastSeen: V | null = null;
  /** Neutral creatures turn on the player once hurt. */
  angry = false;
  /** Where a script is walking it (null: not walking). */
  goal: V | null = null;
  private anim = '';

  constructor(
    private w: NpcWorld,
    readonly id: string,
    readonly data: NpcData,
    feet: V,
    yaw: number,
  ) {
    this.health = data.health;
    this.yaw = yaw;
    this.feet = { ...feet, y: feet.y + 1 };
    // A fixed body moved by hand each step: the player (and other creatures) bump into it like a wall.
    this.body = w.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.feet.x, this.feet.y + NPC_SIZE.height / 2, this.feet.z));
    this.collider = w.world.createCollider(RAPIER.ColliderDesc.capsule(NPC_SIZE.height / 2 - NPC_SIZE.radius, NPC_SIZE.radius).setFriction(0), this.body);
    this.controller = w.world.createCharacterController(0.5);
    this.controller.enableAutostep(18, 4, false);
    this.controller.enableSnapToGround(9);
    this.controller.setMaxSlopeClimbAngle((46 * Math.PI) / 180);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get hostile(): boolean {
    return this.data.side === 'hostile' || (this.data.side === 'neutral' && this.angry);
  }

  eye(): V {
    return { x: this.feet.x, y: this.feet.y + NPC_SIZE.eye, z: this.feet.z };
  }

  /** Hurt by a shot, a swing or a blast. Returns true if this killed it. */
  hurt(amount: number): boolean {
    if (!this.alive || !(amount > 0)) return false;
    this.health = Math.max(0, this.health - amount);
    this.angry = this.angry || this.data.side === 'neutral';
    // Hurt: it knows where the player is.
    const p = this.w.player();
    if (p && this.hostile) {
      this.seenAt = this.w.time();
      this.lastSeen = { ...p.feet };
    }
    if (this.health > 0) return false;
    this.state = 'dead';
    this.goal = null;
    this.collider.setEnabled(false);
    this.play('die', false);
    return true;
  }

  /** Used by the player: friends start or stop following. */
  use(): void {
    if (!this.alive || this.data.side !== 'friendly' || this.goal) return;
    this.state = this.state === 'follow' ? 'idle' : 'follow';
  }

  /** A script walks it somewhere; true once there. */
  walkTo(to: V): () => boolean {
    this.goal = { ...to };
    this.state = 'walk';
    return () => !this.goal || !this.alive;
  }

  step(dt: number): void {
    if (!this.alive) {
      this.fall(dt, 0, 0);
      return;
    }
    const now = this.w.time();
    const p = this.w.player();
    let move: V | null = null;
    let face: V | null = null;
    let speed = this.data.speed;

    if (this.goal) {
      // A scripted walk: nothing else until there.
      if (this.flatDistance(this.goal) < 3) this.goal = null;
      else move = this.goal;
    } else if (p && this.hostile) {
      const sees = this.sees(p);
      if (sees) {
        this.seenAt = now;
        this.lastSeen = { ...p.feet };
      }
      const dist = this.flatDistance(p.feet);
      const melee = this.data.attack === 'melee';
      const inReach = melee ? dist <= this.data.reach + NPC_SIZE.radius * 2 && Math.abs(p.feet.y - this.feet.y) < 64 : sees && dist <= this.data.sight;
      if (this.data.attack !== 'none' && inReach && sees) {
        this.state = 'attack';
        face = p.feet;
        // Shooters keep their distance; biters close right in.
        if (melee && dist > this.data.reach) move = p.feet;
        if (now >= this.nextAttack) {
          this.nextAttack = now + 1 / Math.max(0.1, this.data.rate);
          this.attack(p);
        }
      } else if (now - this.seenAt < 5 && this.lastSeen) {
        this.state = 'chase';
        // Shooters stop once they see the player; others go after them.
        if (!(sees && this.data.attack === 'shoot')) move = sees ? p.feet : this.lastSeen;
        if (!sees && this.flatDistance(this.lastSeen) < 16) this.lastSeen = null;
      } else this.state = 'idle';
    } else if (p && this.state === 'follow') {
      // A friend keeps 80–160 u away.
      const dist = this.flatDistance(p.feet);
      if (dist > 160) move = p.feet;
      else if (dist > 80) {
        move = p.feet;
        speed *= 0.5;
      }
      face = p.feet;
    } else if (this.state !== 'follow') this.state = 'idle';

    let dx = 0, dz = 0;
    if (move) {
      const d = { x: move.x - this.feet.x, z: move.z - this.feet.z };
      const len = Math.hypot(d.x, d.z);
      if (len > 1) {
        dx = (d.x / len) * speed;
        dz = (d.z / len) * speed;
        face ??= move;
      }
    }
    if (face) {
      const fx = face.x - this.feet.x, fz = face.z - this.feet.z;
      if (Math.hypot(fx, fz) > 1) this.turnTowards(Math.atan2(-fx, -fz), dt);
    }
    // (Attacking in place, the attack itself plays its animation.)
    if (this.state !== 'attack' || dx || dz) this.play(dx || dz ? 'walk' : 'idle', true);
    this.fall(dt, dx, dz);
  }

  /** Move by the wished speed this step (with gravity), sliding along walls and climbing steps. */
  private fall(dt: number, dx: number, dz: number): void {
    this.vy -= this.w.gravity * dt;
    const desired = { x: dx * dt, y: this.vy * dt, z: dz * dt };
    if (!this.collider.isEnabled()) {
      // Dead: settles onto the floor below.
      const hit = this.w.world.castRay(new RAPIER.Ray({ x: this.feet.x, y: this.feet.y + 8, z: this.feet.z }, { x: 0, y: -1, z: 0 }), 4096, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, undefined, (c) => !this.w.passes(c));
      const floor = hit ? this.feet.y + 8 - hit.timeOfImpact : -Infinity;
      this.feet.y = Math.max(floor, this.feet.y + desired.y);
      if (this.feet.y <= floor) this.vy = 0;
      return;
    }
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (c) => !this.w.passes(c));
    const m = this.controller.computedMovement();
    if (this.controller.computedGrounded() && this.vy < 0) this.vy = 0;
    this.feet = { x: this.feet.x + m.x, y: this.feet.y + m.y, z: this.feet.z + m.z };
    this.body.setTranslation({ x: this.feet.x, y: this.feet.y + NPC_SIZE.height / 2, z: this.feet.z }, true);
  }

  private attack(p: { feet: V; eye: V }): void {
    this.play('attack', false);
    if (this.data.attack === 'melee') return this.w.hurtPlayer(this.data.damage, this.id);
    const from = this.eye();
    const d = { x: p.eye.x - from.x, y: p.eye.y - 8 - from.y, z: p.eye.z - from.z };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    this.w.shoot(from, { x: d.x / len, y: d.y / len, z: d.z / len }, this);
  }

  /** Whether it can see the player: within sight, in front (or anywhere once hurt), nothing in the way. */
  private sees(p: { eye: V; collider: number }): boolean {
    const from = this.eye();
    const d = { x: p.eye.x - from.x, y: p.eye.y - from.y, z: p.eye.z - from.z };
    const dist = Math.hypot(d.x, d.y, d.z);
    if (dist > this.data.sight || dist < 1) return dist < 1;
    // In front: within 70° of where it faces (unless it has seen them recently).
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const flat = Math.hypot(d.x, d.z) || 1;
    if ((d.x * fx + d.z * fz) / flat < Math.cos((70 * Math.PI) / 180) && this.w.time() - this.seenAt > 2) return false;
    const hit = this.w.world.castRay(new RAPIER.Ray(from, { x: d.x / dist, y: d.y / dist, z: d.z / dist }), dist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, undefined, (c) => !this.w.passes(c) && c.handle !== p.collider);
    return !hit;
  }

  private turnTowards(yaw: number, dt: number): void {
    let d = yaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const max = 8 * dt;
    this.yaw += Math.max(-max, Math.min(max, d));
  }

  private flatDistance(to: V): number {
    return Math.hypot(to.x - this.feet.x, to.z - this.feet.z);
  }

  private play(role: 'idle' | 'walk' | 'attack' | 'die', loop: boolean): void {
    const key = `${role}/${loop}`;
    // (Attacks restart each time; the rest only when they change.)
    if (key === this.anim && role !== 'attack') return;
    this.anim = key;
    this.w.animate(this, role, loop);
  }

  dispose(): void {
    this.w.world.removeCharacterController(this.controller);
  }
}
