/**
 * The player: a first-person character with Source-style movement (D4: Rapier underneath, our own controller
 * on top). Ground friction and acceleration, air acceleration with a small air speed cap (so strafing in the
 * air works), jumping, crouching, walking, stepping up stairs, and pushing physics objects.
 *
 * Units are game units (1 u ≈ 1 inch); the numbers follow Source's defaults so levels built for that scale
 * feel right (speeds are Half-Life 2's, calmer than Counter-Strike's): the player is a 32 × 72 × 32 box (like Source's hull; boxes step and slide cleanly), standing 72 u tall, eyes at 64 u, running 190 u/s, gravity 800 u/s².
 */
import RAPIER from '@dimforge/rapier3d-compat';

export const PLAYER = {
  /** Half the width of the player's box. */
  radius: 16,
  height: 72,
  crouchHeight: 36,
  eye: 64,
  crouchEye: 28,
  /** Half-Life 2's normal speed (Source's 320 is a sprint, too fast for most levels). */
  runSpeed: 190,
  walkSpeed: 100,
  crouchSpeed: 64,
  /**
   * Grip: firmer than Source's (accelerate 10, friction 4), which felt slippery. From a run the player stops in
   * about 0.2 s and 17 u (Source: 0.4 s and 35 u) and reaches full speed in about 0.1 s. (Friction × stop speed
   * must stay below acceleration × crouch speed, or crouch-walking can't get going.)
   */
  accelerate: 14,
  airAccelerate: 10,
  /** Air acceleration only adds speed up to this much along the wished direction (Source's is 30). */
  airCap: 60,
  friction: 8,
  stopSpeed: 100,
  /** How quickly the view follows steps and crouching (per second; higher is quicker). */
  viewSmoothing: 16,
  jumpSpeed: 268,
  stepHeight: 18,
  maxSlope: 45.6,
  useReach: 96,
  maxHealth: 100,
  /** Falls landing slower than this don't hurt; at the fatal speed the fall takes all 100 health (Half-Life 2's values). */
  safeFallSpeed: 526.5,
  fatalFallSpeed: 922.5,
};

/** Damage from landing at `speed` (units per second, downwards). */
export function fallDamage(speed: number): number {
  if (speed <= PLAYER.safeFallSpeed) return 0;
  return Math.round(((speed - PLAYER.safeFallSpeed) * PLAYER.maxHealth) / (PLAYER.fatalFallSpeed - PLAYER.safeFallSpeed));
}

export interface PlayerInput {
  /** -1…1: back/forward and left/right. */
  forward: number;
  right: number;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  /** View angles in radians: yaw turns left/right around Y (0 looks along −Z), pitch looks up/down. */
  yaw: number;
  pitch: number;
}

export const noInput = (): PlayerInput => ({ forward: 0, right: 0, jump: false, crouch: false, walk: false, yaw: 0, pitch: 0 });

type V = { x: number; y: number; z: number };

/** Query groups that skip hidden and switched-off objects (their collision groups are 0). */
const SOLID = 0xffffffff;

/** The player's shape, for “does it fit here” checks. */
const playerShape = (height: number) => new RAPIER.Cylinder(height / 2, PLAYER.radius);

/** What the world tells the player about moving things (lifts, doors, platforms). */
export interface PlayerSurroundings {
  /** Which colliders the movement may bump into (moving objects take part through stand-ins). */
  blocks(c: RAPIER.Collider): boolean;
  /** Where a point riding on what this collider belongs to will be after this step, or null if it isn't moving. */
  carry(collider: number, at: V): V | null;
}

export class Player {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  velocity: V = { x: 0, y: 0, z: 0 };
  onGround = false;
  crouched = false;
  private jumpHeld = false;
  input: PlayerInput = noInput();
  /** How fast the player was falling when they last landed (set on landing, cleared by whoever reads it). */
  landingSpeed = 0;
  /** What the floor under the player moves at (a conveyor), given a collider handle; set by the world. */
  beltOf: ((collider: number) => { x: number; z: number } | null) | null = null;
  /** Moving things (set by the world). */
  surroundings: PlayerSurroundings | null = null;
  /** Physics steps since the feet were last on the ground. */
  private sinceGround = 0;
  /** True while standing on something that moves (a lift): no jumping, and the feet stay on it. */
  riding = false;
  /** The conveyor speed under the player at the last step. */
  private belt = { x: 0, z: 0 };
  /** Feet position at the previous and current physics step (for smooth drawing between steps). */
  private prevFeet: V;
  private feet: V;
  /**
   * The view's height: the feet height smoothed over steps, stairs and bumps while walking (not while jumping or
   * falling), plus the eye height easing between standing and crouching. Previous and current step.
   */
  private view = { y: 0, eye: PLAYER.eye as number };
  private prevView = { y: 0, eye: PLAYER.eye as number };
  readonly spawn: { feet: V; yaw: number };

  constructor(
    private world: RAPIER.World,
    feet: V,
    yaw: number,
    private gravity: number,
  ) {
    feet = { x: feet.x, y: feet.y + 1, z: feet.z };
    this.spawn = { feet: { ...feet }, yaw };
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y + PLAYER.height / 2, feet.z));
    // An upright cylinder: a flat bottom (stands firmly on floors and edges and climbs steps like Source's box)
    // and round sides, so it slides around pillars, balls and corners instead of catching on their facets.
    this.collider = world.createCollider(RAPIER.ColliderDesc.cylinder(PLAYER.height / 2, PLAYER.radius).setFriction(0), this.body);
    this.controller = world.createCharacterController(0.5);
    this.controller.enableAutostep(PLAYER.stepHeight, 4, false);
    this.controller.enableSnapToGround(PLAYER.stepHeight / 2);
    this.controller.setMaxSlopeClimbAngle((PLAYER.maxSlope * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle(((PLAYER.maxSlope + 5) * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.feet = { ...feet };
    this.prevFeet = { ...feet };
    this.resetView();
    this.input.yaw = yaw;
  }

  private resetView(): void {
    this.view = { y: this.feet.y, eye: this.crouched ? PLAYER.crouchEye : PLAYER.eye };
    this.prevView = { ...this.view };
  }

  private get height() {
    return this.crouched ? PLAYER.crouchHeight : PLAYER.height;
  }

  /** Eye position between the last two physics steps (`alpha` 0…1). */
  eye(alpha = 1): [number, number, number] {
    const p = this.prevFeet, c = this.feet;
    const pv = this.prevView, v = this.view;
    const y = pv.y + (v.y - pv.y) * alpha + pv.eye + (v.eye - pv.eye) * alpha;
    return [p.x + (c.x - p.x) * alpha, y, p.z + (c.z - p.z) * alpha];
  }

  get feetPosition(): V {
    return { ...this.feet };
  }

  /** Where the player is looking (unit vector). */
  lookDirection(): [number, number, number] {
    const { yaw, pitch } = this.input;
    return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  }

  /** A sudden change of speed (a jump pad, a blast, wind). Upward pushes lift the player off the ground. */
  push(dx: number, dy: number, dz: number): void {
    this.velocity.x += dx;
    this.velocity.y += dy;
    this.velocity.z += dz;
    if (dy > 0) this.onGround = false;
  }

  /**
   * Put the player's feet at a place, lifted until they fit (so a pad's middle or the inside of a floor works),
   * optionally facing a new way.
   */
  teleport(feet: V, yaw?: number): void {
    const shape = playerShape(this.height);
    let y = feet.y + 1;
    for (let i = 0; i < 64; i++, y += 8) {
      const hit = this.world.intersectionWithShape({ x: feet.x, y: y + this.height / 2, z: feet.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
      if (!hit) break;
    }
    this.feet = { x: feet.x, y, z: feet.z };
    this.prevFeet = { ...this.feet };
    this.resetView();
    this.velocity = { x: 0, y: 0, z: 0 };
    this.landingSpeed = 0;
    if (yaw !== undefined) {
      this.input.yaw = yaw;
      this.input.pitch = 0;
    }
    this.body.setTranslation({ x: feet.x, y: y + this.height / 2, z: feet.z }, true);
  }

  /** What the player is looking at up to `reach` away: the point and the collider. */
  look(reach: number): { point: [number, number, number]; collider: RAPIER.Collider } | null {
    const [x, y, z] = this.eye();
    const d = this.lookDirection();
    const hit = this.world.castRay(new RAPIER.Ray({ x, y, z }, { x: d[0], y: d[1], z: d[2] }), reach, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
    if (!hit) return null;
    return { point: [x + d[0] * hit.timeOfImpact, y + d[1] * hit.timeOfImpact, z + d[2] * hit.timeOfImpact], collider: hit.collider };
  }

  respawn(): void {
    this.feet = { ...this.spawn.feet };
    this.prevFeet = { ...this.spawn.feet };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.landingSpeed = 0;
    this.resetView();
    this.input.yaw = this.spawn.yaw;
    this.input.pitch = 0;
    this.body.setTranslation({ x: this.feet.x, y: this.feet.y + this.height / 2, z: this.feet.z }, true);
  }

  /** One fixed physics step. */
  step(dt: number): void {
    const inp = this.input;
    this.setCrouch(inp.crouch);

    // Wished direction on the ground plane from the view yaw.
    const fx = -Math.sin(inp.yaw), fz = -Math.cos(inp.yaw);
    const rx = Math.cos(inp.yaw), rz = -Math.sin(inp.yaw);
    let wx = fx * inp.forward + rx * inp.right, wz = fz * inp.forward + rz * inp.right;
    const len = Math.hypot(wx, wz);
    if (len > 1e-6) {
      wx /= len;
      wz /= len;
    }
    const maxSpeed = this.crouched ? PLAYER.crouchSpeed : inp.walk ? PLAYER.walkSpeed : PLAYER.runSpeed;
    const wishSpeed = len > 1e-6 ? maxSpeed : 0;

    if (this.onGround) {
      // Jump (pressing again each time; holding doesn't repeat).
      if (inp.jump && !this.jumpHeld && !this.riding) {
        this.velocity.y = PLAYER.jumpSpeed;
        this.onGround = false;
      } else {
        this.applyFriction(dt);
        this.accelerate(wx, wz, wishSpeed, PLAYER.accelerate, dt);
      }
    }
    if (!this.onGround) {
      this.accelerate(wx, wz, Math.min(wishSpeed, PLAYER.airCap), PLAYER.airAccelerate, dt, wishSpeed);
      this.velocity.y -= this.gravity * dt;
    }
    this.jumpHeld = inp.jump;

    const desired = { x: (this.velocity.x + this.belt.x) * dt, y: this.velocity.y * dt, z: (this.velocity.z + this.belt.z) * dt };
    // (Walking down slopes and steps: the controller's snap-to-ground keeps the player on the floor.)
    const s = this.surroundings;
    if (s) this.controller.computeColliderMovement(this.collider, desired, undefined, SOLID, (c) => s.blocks(c));
    else this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID);
    const moved = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();

    // Lose the part of the velocity that runs into what we hit (Source's clip velocity): slide along walls,
    // stop rising at a ceiling. Floors are handled by `grounded`.
    const v = this.velocity;
    // When the move went (nearly) all the way, e.g. up a step, nothing really blocked it.
    const blocked = Math.hypot(moved.x, moved.z) < 0.9 * Math.hypot(desired.x, desired.z);
    for (let i = 0, n = blocked ? this.controller.numComputedCollisions() : 0; i < n; i++) {
      const c = this.controller.computedCollision(i);
      if (!c) continue;
      const nrm = c.normal1;
      if (nrm.y > 0.7) continue;
      // A stair riser isn't a wall: keep the speed and let the step-up carry the player over it.
      if (this.stepAhead(-nrm.x, -nrm.z) !== null) continue;
      const into = v.x * nrm.x + v.y * nrm.y + v.z * nrm.z;
      if (into >= 0) continue;
      v.x -= nrm.x * into;
      v.z -= nrm.z * into;
    }
    // Standing on a conveyor: it carries the player next step. (Standing still, the controller touches
    // nothing, so look straight down for the floor.)
    this.belt = { x: 0, z: 0 };
    if (grounded && this.beltOf) {
      const t = this.body.translation();
      const footY = t.y + moved.y - this.height / 2;
      const hit = this.world.castRay(new RAPIER.Ray({ x: t.x + moved.x, y: footY + 2, z: t.z + moved.z }, { x: 0, y: -1, z: 0 }), 8, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
      const b = hit ? this.beltOf(hit.collider.handle) : null;
      if (b) this.belt = b;
    }
    if (grounded && !this.onGround && v.y < 0) this.landingSpeed = -v.y;
    if (grounded && v.y <= 0) v.y = 0;
    if (v.y > 0 && moved.y < desired.y - 1e-3) v.y = 0; // bumped the ceiling
    this.onGround = grounded && this.velocity.y <= 0;

    const t = this.body.translation();
    let next = { x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z };
    // Source-style step-up when the physics engine's own didn't happen: stand on the step if the box fits.
    // (Also just after leaving the ground, not rising: between steps on tight stairs the feet are briefly off
    // them, and the next riser mustn't stop the player.)
    if (this.onGround) this.sinceGround = 0;
    else this.sinceGround++;
    if (blocked && (this.onGround || (this.sinceGround <= 6 && this.velocity.y <= 0))) {
      const up = this.stepUp(t, desired);
      if (up) {
        next = up;
        this.onGround = true;
        this.sinceGround = 0;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
    }
    // Standing on something that moves (a lift, a turning platform): go with it, crouched or not, feet on it.
    // (Everything is still where it was this step: what is under the feet now is what carries them.)
    const under = this.onGround || this.riding ? this.groundUnder(next) : null;
    const carried = under ? (s?.carry(under.handle, { ...next, y: Math.max(next.y, under.top + this.height / 2 + 0.5) }) ?? null) : null;
    this.riding = !!carried;
    if (carried) {
      next = carried;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
    }
    this.body.setNextKinematicTranslation(next);
    this.prevFeet = this.feet;
    this.feet = { x: next.x, y: next.y - this.height / 2, z: next.z };
    this.smoothView(dt);
  }

  /** The collider just under the feet at a position (what the player stands on) and the top of it, or null. */
  private groundUnder(at: V): { handle: number; top: number } | null {
    const s = this.surroundings;
    if (!s) return null;
    const footY = at.y - this.height / 2;
    // The middle and the edge of the feet (standing at the edge of a lift still counts). From a step above
    // the feet (still inside the player), in case they have sunk into it.
    const r = PLAYER.radius * 0.9;
    for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const from = { x: at.x + ox * r, y: footY + Math.min(PLAYER.stepHeight, this.height - 1), z: at.z + oz * r };
      const hit = this.world.castRay(new RAPIER.Ray(from, { x: 0, y: -1, z: 0 }), from.y - footY + 4, false, undefined, SOLID, this.collider, undefined, (c) => s.blocks(c));
      if (hit) return { handle: hit.collider.handle, top: from.y - hit.timeOfImpact };
    }
    return null;
  }

  /** Ease the view over steps and bumps while on the ground, and between standing and crouching. */
  private smoothView(dt: number): void {
    this.prevView = { ...this.view };
    const k = 1 - Math.exp(-PLAYER.viewSmoothing * dt);
    const y = this.feet.y;
    // Jumping or falling, the view follows exactly (that must feel immediate). Otherwise (walking, including the
    // moment of a step-up) it eases, never lagging more than a step and a half behind.
    const flying = !this.onGround && Math.abs(this.velocity.y) > 60;
    if (flying) this.view.y = y;
    else {
      this.view.y += (y - this.view.y) * k;
      const lag = PLAYER.stepHeight * 1.5;
      this.view.y = Math.min(y + lag, Math.max(y - lag, this.view.y));
    }
    const eye = this.crouched ? PLAYER.crouchEye : PLAYER.eye;
    this.view.eye += (eye - this.view.eye) * k;
  }

  /** Stand on the step ahead, if there is one and the box fits on it. */
  private stepUp(t: V, desired: V): V | null {
    const top = this.stepAhead(desired.x, desired.z);
    if (top === null) return null;
    const up = { x: t.x + desired.x, y: top + this.height / 2 + 0.5, z: t.z + desired.z };
    const shape = playerShape(this.height);
    return this.world.intersectionWithShape(up, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider) ? null : up;
  }

  /** The top of a step (a floor no higher than a step) just ahead in direction (dx, dz), or null. */
  private stepAhead(dx: number, dz: number): number | null {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    const t = this.body.translation();
    const feet = t.y - this.height / 2;
    // A few distances past the front of the player's box (the riser may not be touching yet).
    for (const ahead of [1, 4, 8]) {
      const reach = PLAYER.radius + ahead;
      const from = { x: t.x + (dx / len) * reach, y: feet + PLAYER.stepHeight + 1, z: t.z + (dz / len) * reach };
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(from, { x: 0, y: -1, z: 0 }), PLAYER.stepHeight + 1, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
      if (!hit) continue;
      const top = from.y - hit.timeOfImpact;
      if (top > feet + 0.25 && top <= feet + PLAYER.stepHeight + 0.5 && hit.normal.y > 0.7) return top;
    }
    return null;
  }

  private applyFriction(dt: number): void {
    const v = this.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.1) {
      v.x = v.z = 0;
      return;
    }
    const control = Math.max(speed, PLAYER.stopSpeed);
    const drop = control * PLAYER.friction * dt;
    const k = Math.max(0, speed - drop) / speed;
    v.x *= k;
    v.z *= k;
  }

  /** Source's accelerate: only add speed along the wished direction, up to wishSpeed. */
  private accelerate(wx: number, wz: number, wishSpeed: number, accel: number, dt: number, fullSpeed = wishSpeed): void {
    if (wishSpeed <= 0) return;
    const current = this.velocity.x * wx + this.velocity.z * wz;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const gain = Math.min(add, accel * fullSpeed * dt);
    this.velocity.x += gain * wx;
    this.velocity.z += gain * wz;
  }

  /** Crouch at once; stand only when there's room overhead. */
  private setCrouch(want: boolean): void {
    if (want === this.crouched) return;
    const t = this.body.translation();
    if (want) {
      this.crouched = true;
      this.collider.setHalfHeight(PLAYER.crouchHeight / 2);
      // Keep the feet where they are.
      this.body.setTranslation({ x: t.x, y: t.y - (PLAYER.height - PLAYER.crouchHeight) / 2, z: t.z }, true);
      this.collider.setTranslation(this.body.translation());
      return;
    }
    const lift = PLAYER.height - PLAYER.crouchHeight;
    const shape = playerShape(PLAYER.height);
    const pos = { x: t.x, y: t.y + lift / 2, z: t.z };
    const blocked = this.world.intersectionWithShape(pos, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
    if (blocked) return;
    this.crouched = false;
    this.collider.setHalfHeight(PLAYER.height / 2);
    this.body.setTranslation(pos, true);
    this.collider.setTranslation(pos);
  }

  /** What the player is pointing at within reach (the collider), for “use”. */
  aim(): RAPIER.Collider | null {
    const [x, y, z] = this.eye();
    const d = this.lookDirection();
    const hit = this.world.castRay(new RAPIER.Ray({ x, y, z }, { x: d[0], y: d[1], z: d[2] }), PLAYER.useReach, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
    return hit?.collider ?? null;
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
  }
}
