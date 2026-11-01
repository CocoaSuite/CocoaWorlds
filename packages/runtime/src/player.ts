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
  accelerate: 10,
  airAccelerate: 10,
  /** Air acceleration only adds speed up to this much along the wished direction (Source's 30). */
  airCap: 30,
  friction: 4,
  stopSpeed: 100,
  jumpSpeed: 268,
  stepHeight: 18,
  maxSlope: 45.6,
  useReach: 96,
};

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

export class Player {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  velocity: V = { x: 0, y: 0, z: 0 };
  onGround = false;
  crouched = false;
  private jumpHeld = false;
  input: PlayerInput = noInput();
  /** Feet position at the previous and current physics step (for smooth drawing between steps). */
  private prevFeet: V;
  private feet: V;
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
    this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(PLAYER.radius, PLAYER.height / 2, PLAYER.radius).setFriction(0), this.body);
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
    this.input.yaw = yaw;
  }

  private get height() {
    return this.crouched ? PLAYER.crouchHeight : PLAYER.height;
  }

  /** Eye position between the last two physics steps (`alpha` 0…1). */
  eye(alpha = 1): [number, number, number] {
    const p = this.prevFeet, c = this.feet;
    const e = this.crouched ? PLAYER.crouchEye : PLAYER.eye;
    return [p.x + (c.x - p.x) * alpha, p.y + (c.y - p.y) * alpha + e, p.z + (c.z - p.z) * alpha];
  }

  get feetPosition(): V {
    return { ...this.feet };
  }

  /** Where the player is looking (unit vector). */
  lookDirection(): [number, number, number] {
    const { yaw, pitch } = this.input;
    return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  }

  respawn(): void {
    this.feet = { ...this.spawn.feet };
    this.prevFeet = { ...this.spawn.feet };
    this.velocity = { x: 0, y: 0, z: 0 };
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
      if (inp.jump && !this.jumpHeld) {
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

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    // (Walking down slopes and steps: the controller's snap-to-ground keeps the player on the floor.)
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID);
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
      const into = v.x * nrm.x + v.y * nrm.y + v.z * nrm.z;
      if (into >= 0) continue;
      v.x -= nrm.x * into;
      v.z -= nrm.z * into;
    }
    if (grounded && v.y <= 0) v.y = 0;
    if (v.y > 0 && moved.y < desired.y - 1e-3) v.y = 0; // bumped the ceiling
    this.onGround = grounded && this.velocity.y <= 0;

    const t = this.body.translation();
    const next = { x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z };
    this.body.setNextKinematicTranslation(next);
    this.prevFeet = this.feet;
    this.feet = { x: next.x, y: next.y - this.height / 2, z: next.z };
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
      this.collider.setHalfExtents({ x: PLAYER.radius, y: PLAYER.crouchHeight / 2, z: PLAYER.radius });
      // Keep the feet where they are.
      this.body.setTranslation({ x: t.x, y: t.y - (PLAYER.height - PLAYER.crouchHeight) / 2, z: t.z }, true);
      return;
    }
    const lift = PLAYER.height - PLAYER.crouchHeight;
    const shape = new RAPIER.Cuboid(PLAYER.radius, PLAYER.height / 2, PLAYER.radius);
    const pos = { x: t.x, y: t.y + lift / 2, z: t.z };
    const blocked = this.world.intersectionWithShape(pos, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
    if (blocked) return;
    this.crouched = false;
    this.collider.setHalfExtents({ x: PLAYER.radius, y: PLAYER.height / 2, z: PLAYER.radius });
    this.body.setTranslation(pos, true);
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
