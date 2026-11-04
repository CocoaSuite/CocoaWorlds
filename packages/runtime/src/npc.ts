/**
 * Creatures (A1): characters that move on their own with the same kind of character controller as the player.
 *
 * - Enemies notice the player within sight (in front of them, with nothing in the way, or anywhere once
 *   hurt), chase them and attack up close or by shooting; they give up some seconds after losing sight.
 * - Friends follow the player once used (E), keeping a little way off; used again, they stay.
 * - Neutral ones stand about until hurt, then fight back.
 *
 * Any of them can also wander about (stopping to peck or sniff at the ground), run away (when hurt, or when
 * the player comes near) and be clumsy (stumbling now and then, weaving as it goes): the chicken is all three.
 *
 * Scripts can walk any of them to a place (a scripted scene); while walking, a creature does nothing else.
 * They go straight towards where they're heading, sliding along walls and climbing steps; finding a way round
 * obstacles (navigation meshes) comes in A2.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { NpcData } from '@cocoaworlds/core';

type V = { x: number; y: number; z: number };

export const NPC_SIZE = { radius: 16, height: 72, eye: 64 };

export type NpcState = 'idle' | 'wander' | 'busy' | 'flee' | 'chase' | 'attack' | 'walk' | 'follow' | 'pull' | 'dead';

/** What an animation is for; the Creature component names the model's animation for each. */
export type AnimRole = 'idle' | 'walk' | 'attack' | 'die' | 'run' | 'busy' | 'hurt' | 'pull';
export const ANIM_ROLES: AnimRole[] = ['idle', 'walk', 'attack', 'die', 'run', 'busy', 'hurt', 'pull'];

/** What a creature can ask the world. */
export interface NpcWorld {
  readonly world: RAPIER.World;
  time(): number;
  gravity: number;
  /**
   * The player's feet and eyes, or null when there's no player. `hidden`: the hiding spot they are in (their feet
   * stay where they got in); `entering` while they are still getting in, when they can be seen doing it.
   */
  player(): { feet: V; eye: V; collider: number; hidden?: string | null; entering?: boolean } | null;
  /** It reached a hiding spot it saw the player get into: they are pulled out. */
  pullOut?(npc: Npc, spot: string): void;
  /** Colliders a creature moves through (zones, water, ladders). */
  passes(c: RAPIER.Collider): boolean;
  /** Hurt the player (an attack up close). */
  hurtPlayer(amount: number, by: string): void;
  /** Fire a shot from `from` along `dir`. */
  shoot(from: V, dir: V, npc: Npc): void;
  /** Play one of the creature's animations (by role). */
  animate(npc: Npc, role: AnimRole, loop: boolean): void;
  /** 0…1 (replaceable in tests). */
  random(): number;
  /** A walkable way there (corners to head for, ending at `to`), or null when there's no navigation or no way. */
  route?(from: V, to: V): V[] | null;
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
  /** The hiding spot it saw the player get into. */
  private found: string | null = null;
  private pullUntil = 0;
  /** Neutral creatures turn on the player once hurt. */
  angry = false;
  /** Where a script is walking it (null: not walking). */
  goal: V | null = null;
  private anim = '';
  /** Its size (a capsule this tall and this thick), from the component. */
  readonly height: number;
  readonly radius: number;
  /** Where it started: wandering stays near it. */
  private home: V;
  private wanderTo: V | null = null;
  private nextWander = 0;
  private busyUntil = 0;
  private fleeUntil = 0;
  private stumbleUntil = 0;
  private nextStumble = 0;
  /** Its own beat for weaving, so a flock doesn't weave in step. */
  private phase: number;
  /** Whether it has been lifted clear of whatever it was placed inside (done on its first step). */
  private placed = false;
  /** Steering round things: the side it last went round (+1 left, −1 right), and how stuck it is. */
  private side = 1;
  private stuckFor = 0;
  /** While set, it keeps going round on `side` (after getting stuck). */
  private detourUntil = 0;
  /** The way being followed (navigation), where it leads and when it was worked out. */
  private route: V[] | null = null;
  private routeTo: V | null = null;
  private routeAt = -Infinity;

  constructor(
    private w: NpcWorld,
    readonly id: string,
    readonly data: NpcData,
    feet: V,
    yaw: number,
  ) {
    this.health = data.health;
    this.yaw = yaw;
    this.height = Math.max(8, Number(data.height) || NPC_SIZE.height);
    this.radius = Math.min(this.height / 2, Math.max(2, Number(data.radius) || NPC_SIZE.radius));
    this.feet = { ...feet, y: feet.y + 1 };
    this.home = { ...this.feet };
    this.phase = w.random() * 10;
    this.nextWander = w.time() + 0.5 + w.random() * 2;
    this.nextStumble = w.time() + 2 + w.random() * 4;
    // A fixed body moved by hand each step: the player (and other creatures) bump into it like a wall.
    this.body = w.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.feet.x, this.feet.y + this.height / 2, this.feet.z));
    this.collider = w.world.createCollider(RAPIER.ColliderDesc.capsule(this.height / 2 - this.radius, this.radius).setFriction(0), this.body);
    this.controller = w.world.createCharacterController(0.5);
    this.controller.enableAutostep(26, 4, false);
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
    return { x: this.feet.x, y: this.feet.y + Math.max(this.height * 0.5, this.height - 8), z: this.feet.z };
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
    if (this.health > 0) {
      // Startled: a flap, and away if it's the running kind.
      this.play('hurt', false, true);
      if (this.data.flee === 'hurt' || this.data.flee === 'near') this.fleeUntil = this.w.time() + 3;
      this.busyUntil = 0;
      return false;
    }
    this.state = 'dead';
    this.goal = null;
    this.collider.setEnabled(false);
    this.play('die', false);
    return true;
  }

  /** Change sides (a script's “Make a creature …”): a new enemy notices the player at once if it can see them. */
  setSide(side: NpcData['side']): void {
    this.data.side = side;
    this.angry = false;
    if (this.state === 'follow' && side !== 'friendly') this.state = 'idle';
    if (side === 'hostile') this.seenAt = Math.max(this.seenAt, this.w.time() - 2.5);
  }

  /** A script makes it run away from the player for a while; true once it has stopped (or died). */
  runAway(seconds: number): () => boolean {
    const until = this.w.time() + Math.max(0, seconds);
    this.fleeUntil = Math.max(this.fleeUntil, until);
    this.busyUntil = 0;
    return () => !this.alive || this.w.time() >= until;
  }

  /** A script lets it potter about, or keeps it where it is. */
  setWander(on: boolean): void {
    this.data.wander = on;
    if (!on) {
      this.wanderTo = null;
      this.busyUntil = 0;
    }
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

  /**
   * Placed inside a floor (or anything else), it rises until it fits, as the player does, so a creature put at
   * height 0 on a raised floor stands on it instead of being stuck in it up to its middle.
   */
  private standClear(): void {
    this.placed = true;
    const shape = new RAPIER.Capsule(this.height / 2 - this.radius, this.radius);
    let y = this.feet.y;
    for (let i = 0; i < 64; i++, y += 4) {
      const hit = this.w.world.intersectionWithShape({ x: this.feet.x, y: y + this.height / 2, z: this.feet.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, undefined, (c) => !this.w.passes(c));
      if (!hit) break;
    }
    if (y === this.feet.y) return;
    this.feet.y = y;
    this.home.y = y;
    this.body.setTranslation({ x: this.feet.x, y: y + this.height / 2, z: this.feet.z }, true);
  }

  step(dt: number): void {
    if (!this.placed) this.standClear();
    if (!this.alive) {
      this.fall(dt, 0, 0);
      return;
    }
    const now = this.w.time();
    const p = this.w.player();
    let move: V | null = null;
    let face: V | null = null;
    let speed = this.data.speed;
    let running = false;
    // Running away when the player comes near (the shy kind).
    if (p && this.data.flee === 'near' && this.state !== 'follow' && this.flatDistance(p.feet) < Math.min(192, this.data.sight)) this.fleeUntil = Math.max(this.fleeUntil, now + 1);

    if (!p?.hidden) this.found = null;
    if (this.goal) {
      // A scripted walk: nothing else until there.
      if (this.flatDistance(this.goal) < 3) this.goal = null;
      else move = this.goal;
    } else if (p && now < this.fleeUntil) {
      // Away from the player, as fast as it can.
      this.state = 'flee';
      const away = { x: this.feet.x - p.feet.x, z: this.feet.z - p.feet.z };
      const len = Math.hypot(away.x, away.z) || 1;
      move = { x: this.feet.x + (away.x / len) * 200, y: this.feet.y, z: this.feet.z + (away.z / len) * 200 };
      speed *= 1.6;
      running = true;
    } else if (p && this.hostile && now < this.pullUntil) {
      this.state = 'pull';
      face = p.feet;
    } else if (p && this.hostile && p.hidden && (this.found === p.hidden || (p.entering && this.sees(p)))) {
      // Saw them get in: to the spot, and out they come.
      this.found = p.hidden;
      this.state = 'chase';
      if (this.flatDistance(p.feet) > Math.max(this.data.reach, 16) + this.radius + 16) move = p.feet;
      else {
        face = p.feet;
        this.found = null;
        this.state = 'pull';
        this.seenAt = now;
        this.lastSeen = { ...p.feet };
        const pull = Math.max(0, Number(this.data.pull ?? 0.8) || 0);
        this.pullUntil = now + pull;
        this.nextAttack = now + pull;
        this.play('pull', false, true);
        this.w.pullOut?.(this, p.hidden);
      }
    } else if (p && this.hostile) {
      const sees = !p.hidden && this.sees(p);
      if (sees) {
        this.seenAt = now;
        this.lastSeen = { ...p.feet };
      }
      const dist = this.flatDistance(p.feet);
      const melee = this.data.attack === 'melee';
      const inReach = melee ? dist <= this.data.reach + this.radius + 16 && Math.abs(p.feet.y - this.feet.y) < 64 : sees && dist <= this.data.sight;
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
    } else if (this.state !== 'follow' && this.data.wander) {
      // Pottering about near home: walk somewhere close, stop, peck at the ground, go on.
      if (now < this.busyUntil) this.state = 'busy';
      else if (this.wanderTo) {
        this.state = 'wander';
        if (this.flatDistance(this.wanderTo) < 6) {
          this.wanderTo = null;
          this.busyUntil = now + 0.7 * (1 + Math.floor(this.w.random() * 3));
          this.nextWander = this.busyUntil + 0.3 + this.w.random() * 1.5;
        } else {
          move = this.wanderTo;
          speed *= 0.5;
        }
      } else {
        this.state = 'idle';
        if (now >= this.nextWander) {
          const a = this.w.random() * Math.PI * 2, r = 48 + this.w.random() * 144;
          this.wanderTo = { x: this.home.x + Math.cos(a) * r, y: this.home.y, z: this.home.z + Math.sin(a) * r };
        }
      }
    } else if (this.state !== 'follow') this.state = 'idle';

    // Clumsy: now and then it stumbles (nearly stops, flapping), and it weaves as it goes.
    let clumsyTurn = 0;
    if (this.data.clumsy && move) {
      if (now >= this.nextStumble) {
        this.stumbleUntil = now + 0.45;
        this.nextStumble = now + 2.5 + this.w.random() * 4;
        this.play('hurt', false, true);
      }
      if (now < this.stumbleUntil) speed *= 0.25;
      // (A slow drift off the line rather than a zig-zag: quick weaving reads as a wobble, not a walk.)
      clumsyTurn = 0.1 * Math.sin(now * 1.3 + this.phase) + 0.03 * Math.sin(now * 3.1 + this.phase * 2);
    }

    let dx = 0, dz = 0;
    if (move) move = this.waypoint(move, now);
    else this.route = null;
    if (move) {
      const d = { x: move.x - this.feet.x, z: move.z - this.feet.z };
      const len = Math.hypot(d.x, d.z);
      if (len > 1) {
        const c = Math.cos(clumsyTurn), s = Math.sin(clumsyTurn);
        // Round whatever is in the way (a crate, a pillar, another creature); not past the target itself.
        const dir = this.steer((d.x * c - d.z * s) / len, (d.x * s + d.z * c) / len, Math.min(len, 48), p?.collider ?? null, now);
        dx = dir.x * speed;
        dz = dir.z * speed;
        face ??= { x: this.feet.x + dx, y: this.feet.y, z: this.feet.z + dz };
      }
    }
    if (face) {
      const fx = face.x - this.feet.x, fz = face.z - this.feet.z;
      if (Math.hypot(fx, fz) > 1) this.turnTowards(Math.atan2(-fx, -fz), dt);
    }
    // (Attacking in place, the attack itself plays its animation; a stumble plays out.)
    if (now >= this.stumbleUntil && this.state !== 'pull' && (this.state !== 'attack' || dx || dz))
      this.play(this.state === 'busy' ? 'busy' : dx || dz ? (running ? 'run' : 'walk') : 'idle', true);
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
    // Stuck: hardly getting anywhere while trying to move.
    const wanted = Math.hypot(desired.x, desired.z);
    if (wanted > 1e-3 && Math.hypot(m.x, m.z) < wanted * 0.25) this.stuckFor += dt;
    else this.stuckFor = Math.max(0, this.stuckFor - dt);
    this.feet = { x: this.feet.x + m.x, y: this.feet.y + m.y, z: this.feet.z + m.z };
    this.body.setTranslation({ x: this.feet.x, y: this.feet.y + this.height / 2, z: this.feet.z }, true);
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

  /**
   * The way to go towards (x, z) (a unit vector): straight on if nothing is in the way within `ahead`, else the
   * nearest clear way turning to one side, then the other (keeping to the side it chose last, so it doesn't
   * dither). Steps and slopes it can climb don't count. Stuck for a while, it gives up on a wander spot, or goes
   * round the other way.
   */
  private steer(x: number, z: number, ahead: number, ignore: number | null, now: number): { x: number; z: number } {
    if (this.stuckFor > 0.6) {
      this.stuckFor = 0;
      if (this.state === 'wander') {
        this.wanderTo = null;
        this.nextWander = now + 0.3;
      } else {
        this.side = -this.side;
        this.detourUntil = now + 0.8;
      }
    }
    const step = 18;
    const half = Math.max(1, (this.height - step - 2) / 2 - this.radius);
    const shape = new RAPIER.Capsule(half, this.radius * 0.9);
    const from = { x: this.feet.x, y: this.feet.y + step + 1 + half + this.radius, z: this.feet.z };
    const clear = (a: number) => {
      const c = Math.cos(a), s = Math.sin(a);
      const v = { x: x * c - z * s, y: 0, z: x * s + z * c };
      const hit = this.w.world.castShape(from, { x: 0, y: 0, z: 0, w: 1 }, v, shape, 0, ahead, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, undefined, (col) => !this.w.passes(col) && col.handle !== ignore);
      return hit ? null : { x: v.x, z: v.z };
    };
    const deg = Math.PI / 180;
    if (now >= this.detourUntil) {
      const straight = clear(0);
      if (straight) return straight;
    }
    // Round on the side it chose (every angle on that side first), only then the other way.
    for (const sgn of [this.side, -this.side]) {
      for (const t of [35, 60, 90, 120, 150]) {
        const way = clear(t * deg * sgn);
        if (!way) continue;
        this.side = sgn;
        return way;
      }
    }
    // Boxed in: push on (sliding along whatever it is).
    return { x, z };
  }

  /**
   * Where to head for on the way to `to`: the next corner of a walkable way round walls and through doors, worked
   * out again when the target moves or every second and a half. Close by, or with no way found, straight there.
   */
  private waypoint(to: V, now: number): V {
    if (!this.w.route || (this.flatDistance(to) < 48 && Math.abs(to.y - this.feet.y) < 24)) {
      this.route = null;
      return to;
    }
    // (Again when the target has moved a good part of the way off: a quarter of the distance, at least 48 u.)
    const moved = !this.routeTo || Math.hypot(to.x - this.routeTo.x, to.z - this.routeTo.z) > Math.max(48, this.flatDistance(to) / 4);
    if (moved || now - this.routeAt > 1.5) {
      this.route = this.w.route(this.feet, to);
      this.routeTo = { ...to };
      this.routeAt = now;
    }
    const r = this.route;
    if (!r?.length) return to;
    while (r.length > 1 && this.flatDistance(r[0]!) < 12) r.shift();
    return r[0]!;
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

  /** The animation playing now (its role), for tests and the editor. */
  get animation(): string {
    return this.anim.split('/')[0]!;
  }

  private play(role: AnimRole, loop: boolean, again = false): void {
    const key = `${role}/${loop}`;
    // (Attacks, flaps and anything asked again restart; the rest only when they change.)
    if (key === this.anim && role !== 'attack' && !again) return;
    this.anim = key;
    this.w.animate(this, role, loop);
  }

  dispose(): void {
    this.w.world.removeCharacterController(this.controller);
  }
}
