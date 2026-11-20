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
  stepHeight: 26,
  maxSlope: 45.6,
  useReach: 96,
  maxHealth: 100,
  /** Falls landing slower than this don't hurt; at the fatal speed the fall takes all 100 health (Half-Life 2's values). */
  safeFallSpeed: 526.5,
  fatalFallSpeed: 922.5,
  /** Swimming: Source's (80% of the running speed, water friction 4, sinking 60 u/s when idle). */
  swimFactor: 0.8,
  waterFriction: 4,
  sinkSpeed: 60,
  /** A jump from the water onto a ledge in front (Source's water jump). */
  waterJumpSpeed: 300,
  /** Letting go of a ladder by jumping: pushed back this fast. */
  ladderJumpSpeed: 200,
  /** Stamina (a game rule): Shift sprints this fast while there is some; sprinting and jumping use it up. */
  sprintSpeed: 290,
  maxStamina: 100,
  /** Per second of sprinting; per jump; got back per second after resting a moment; needed to sprint again once out. */
  sprintCost: 20,
  jumpCost: 12,
  staminaBack: 28,
  restBeforeBack: 0.8,
  staminaToSprint: 30,
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
  /** Use is held (chargers give while it is). */
  use?: boolean;
  /** The fire button is held (the weapon in hand fires). */
  fire?: boolean;
  /** The block button is held (mining: the pickaxe guards). */
  block?: boolean;
  /** View angles in radians: yaw turns left/right around Y (0 looks along −Z), pitch looks up/down. */
  yaw: number;
  pitch: number;
}

export const noInput = (): PlayerInput => ({ forward: 0, right: 0, jump: false, crouch: false, walk: false, yaw: 0, pitch: 0 });

type V = { x: number; y: number; z: number };

/** The ways scripts can let the player move (or not). */
export interface PlayerMoves {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
}
export const allMoves = (): PlayerMoves => ({ forward: true, back: true, left: true, right: true, jump: true, crouch: true });
/** Sizes scripts can set (a tenth to ten times normal). */
export const MIN_SIZE = 0.1;
export const MAX_SIZE = 10;
/** Moving faster than this starts “moving”; slower than STILL_SPEED for STILL_TIME stops it. */
export const MOVE_SPEED = 20;
export const STILL_SPEED = 8;
export const STILL_TIME = 0.1;

/** Query groups that skip hidden and switched-off objects (their collision groups are 0). */
const SOLID = 0xffffffff;

/** The player's shape, for “does it fit here” checks. */
const playerShape = (height: number, radius: number = PLAYER.radius) => new RAPIER.Cylinder(height / 2, radius);

/** What the world tells the player about moving things (lifts, doors, platforms). */
export interface PlayerSurroundings {
  /** Which colliders the movement may bump into (moving objects take part through stand-ins). */
  blocks(c: RAPIER.Collider): boolean;
  /** Where a point riding on what this collider belongs to will be after this step, or null if it isn't moving. */
  carry(collider: number, at: V): V | null;
  /** The water surface's height if the point is in water, else null. */
  waterTop?(at: V): number | null;
  /** The climbing speed of a ladder the shape (placed at `at`) touches, else null. */
  ladder?(shape: RAPIER.Shape, at: V): number | null;
}

export class Player {
  /**
   * The player's size (scripts: “Set the player's size”): 1 is normal, 0.5 half as tall and wide. The box, the eyes,
   * the step height and crouching scale with it; speed and jump have their own factors.
   */
  size = 1;
  private sizeTween: { from: number; to: number; t: number; seconds: number } | null = null;
  /** The size scripts asked for (it can lag behind while there is no room to grow). */
  sizeTarget = 1;
  /** Script factors on speed and jump height (1: normal). */
  scriptSpeed = 1;
  scriptJump = 1;
  /** Script factor on gravity (1: normal, 0.5 floaty, 0 none). */
  scriptGravity = 1;
  /** Which ways the player may move (scripts: “Let the player move”). */
  moves: PlayerMoves = allMoves();

  get standH() {
    return PLAYER.height * this.size;
  }
  get crouchH() {
    return PLAYER.crouchHeight * this.size;
  }
  get eyeH() {
    return PLAYER.eye * this.size;
  }
  get crouchEyeH() {
    return PLAYER.crouchEye * this.size;
  }
  get radius() {
    return PLAYER.radius * this.size;
  }
  get stepH() {
    return PLAYER.stepHeight * this.size;
  }
  /** The eye height now (standing or crouched). */
  get eyeHeight() {
    return this.crouched ? this.crouchEyeH : this.eyeH;
  }

  /** Grow or shrink to `to` times the normal size over `seconds` (0: at once, if there is room). */
  resize(to: number, seconds = 0): void {
    to = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Number.isFinite(to) ? to : 1));
    this.sizeTarget = to;
    // (Applied in the next step: room is checked against the world as physics last left it.)
    this.sizeTween = { from: this.size, to, t: 0, seconds: Math.max(0, seconds) };
  }

  /** Whether a resize is still under way (its time hasn't run out; growing may still wait for room after). */
  get resizing(): boolean {
    const tw = this.sizeTween;
    return !!tw && tw.t < tw.seconds;
  }

  /** Advance a resize; growing waits until there is room. */
  private stepSize(dt: number): void {
    const tw = this.sizeTween;
    if (!tw) return;
    tw.t = Math.min(tw.seconds, tw.t + dt);
    const k = tw.seconds > 0 ? tw.t / tw.seconds : 1;
    const e = k * k * (3 - 2 * k);
    const want = tw.from + (tw.to - tw.from) * e;
    if (!this.setSize(want) && want > this.size) {
      // No room to grow: get as big as fits (halving the gap), then keep trying.
      let lo = this.size, hi = want;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (this.setSize(mid)) lo = mid;
        else hi = mid;
      }
    }
    if (tw.t >= tw.seconds) this.sizeTween = Math.abs(this.size - tw.to) < 1e-4 ? null : { from: this.size, to: tw.to, t: 0, seconds: 0 };
  }

  /** Change the size now, feet staying put, if the new box fits (shrinking always does). */
  private setSize(size: number): boolean {
    if (Math.abs(size - this.size) < 1e-6) return true;
    const old = this.size;
    this.size = size;
    const h = this.height, r = this.radius;
    const t = this.body.translation();
    const feetY = t.y - ((this.crouched ? PLAYER.crouchHeight : PLAYER.height) * old) / 2;
    const at = { x: t.x, y: feetY + h / 2, z: t.z };
    // (Checked a unit up, so the floor under the feet doesn't count.)
    if (size > old && this.world.intersectionWithShape({ ...at, y: at.y + 1 }, { x: 0, y: 0, z: 0, w: 1 }, playerShape(h, r), RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider)) {
      this.size = old;
      return false;
    }
    this.collider.setHalfHeight(h / 2);
    this.collider.setRadius(r);
    this.body.setTranslation(at, true);
    this.collider.setTranslation(at);
    this.controller.enableAutostep(this.stepH, 4 * size, false);
    this.controller.enableSnapToGround(this.stepH / 2);
    // The view keeps its place for the eased eye height (smoothView) to follow.
    return true;
  }

  /** Back to normal: size, speed, jump and every way of moving. */
  resetBody(): void {
    this.resize(1);
    this.scriptSpeed = 1;
    this.scriptJump = 1;
    this.scriptGravity = 1;
    this.moves = allMoves();
  }

  private steps = 0;

  /** Is the player moving under their own steam (walking, running, swimming, climbing)? Set every step. */
  moving = false;
  private stillFor = 0;
  /** Set for one step: the player jumped (from the ground, in the air, off a ladder or out of water). */
  jumped = false;
  /** Set for one step: the feet touched the ground after being off it; how fast they were falling. */
  landed = false;
  landedSpeed = 0;
  /** Units walked (moved under their own steam), from the start. */
  walked = 0;
  /** How fast the player moves now (sideways speed, or climbing), units per second. */
  speedNow = 0;

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
  /** How deep the player is in water: 0 out, 1 feet, 2 waist (swimming), 3 head under. */
  waterLevel: 0 | 1 | 2 | 3 = 0;
  /** True while on a ladder. */
  onLadder = false;
  /** Steps until a ladder can be grabbed again (after jumping off one). */
  private ladderCooldown = 0;
  /** Whether a wall stopped the last step's movement (for jumping out of water onto a ledge). */
  private lastBlocked = false;
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
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y + this.standH / 2, feet.z));
    // An upright cylinder: a flat bottom (stands firmly on floors and edges and climbs steps like Source's box)
    // and round sides, so it slides around pillars, balls and corners instead of catching on their facets.
    this.collider = world.createCollider(RAPIER.ColliderDesc.cylinder(this.standH / 2, this.radius).setFriction(0), this.body);
    this.controller = world.createCharacterController(0.5);
    this.controller.enableAutostep(this.stepH, 4, false);
    this.controller.enableSnapToGround(this.stepH / 2);
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
    this.view = { y: this.feet.y, eye: this.crouched ? this.crouchEyeH : this.eyeH };
    this.prevView = { ...this.view };
  }

  private get height() {
    return this.crouched ? this.crouchH : this.standH;
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
  /** Put the feet exactly here (no looking for room), keeping speed and view (sitting down). */
  placeAt(feet: V): void {
    this.feet = { ...feet };
    this.prevFeet = { ...feet };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.body.setTranslation({ x: feet.x, y: feet.y + this.height / 2, z: feet.z }, true);
  }

  teleport(feet: V, yaw?: number): void {
    const shape = playerShape(this.height, this.radius);
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

  /** Whether the player would fit standing here (nothing solid in the way, other than sensors). */
  fitsAt(feet: V): boolean {
    const hit = this.world.intersectionWithShape({ x: feet.x, y: feet.y + 1 + this.height / 2, z: feet.z }, { x: 0, y: 0, z: 0, w: 1 }, playerShape(this.height, this.radius), RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
    return !hit;
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

  /** Movement speed multiplier (1: normal; badly hurt players with hidden health move slower). */
  speedScale = 1;
  /** Jump height factor (mining raises it so a block can be climbed). */
  jumpScale = 1;
  /** Jumps allowed in the air (a double-jump charm); used ones come back on landing. */
  airJumps = 0;
  private airJumped = 0;

  /** Stamina on (a game rule): Shift sprints rather than walks, and sprinting and jumping tire the player. */
  tires = false;
  stamina: number = PLAYER.maxStamina;
  /** Ran out: no sprinting until there is enough again. */
  private outOfBreath = false;
  private rested = 0;

  /** Whether the player is sprinting now. */
  get sprinting(): boolean {
    const i = this.input;
    return this.tires && i.walk && !this.crouched && !this.outOfBreath && this.stamina > 0 && (i.forward !== 0 || i.right !== 0);
  }

  private tire(cost: number): void {
    this.stamina = Math.max(0, this.stamina - cost);
    this.rested = 0;
    if (this.stamina <= 0) this.outOfBreath = true;
  }

  /** Dev console: fly through everything (look to aim, Space up, Ctrl down, Shift faster). */
  noclip = false;

  /** One fixed physics step. */
  step(dt: number): void {
    this.jumped = this.landed = false;
    if (this.noclip) return this.fly(dt);
    // (Not on the very first step: until physics has stepped once, its queries can't see anything.)
    if (this.steps++ > 0) this.stepSize(dt);
    const wasGround = this.onGround, vy = this.velocity.y, wasLadder = this.onLadder;
    const raw = this.input, m = this.moves;
    // Ways scripts have taken away are as if not pressed (the view still turns).
    const inp: PlayerInput =
      m.forward && m.back && m.left && m.right && m.jump && m.crouch
        ? raw
        : {
            ...raw,
            forward: (raw.forward > 0 && !m.forward) || (raw.forward < 0 && !m.back) ? 0 : raw.forward,
            right: (raw.right > 0 && !m.right) || (raw.right < 0 && !m.left) ? 0 : raw.right,
            jump: raw.jump && m.jump,
            crouch: raw.crouch && m.crouch,
          };
    this.stepBody(inp, dt);
    if (!wasGround && this.onGround && !wasLadder) {
      this.landed = true;
      this.landedSpeed = Math.max(0, -vy);
    }
    this.watchMoving(dt);
  }

  /** Track “moving”, how fast, and how far walked. */
  private watchMoving(dt: number): void {
    const v = this.velocity;
    const speed = this.onLadder ? Math.hypot(v.x, v.y, v.z) : this.waterLevel >= 2 ? Math.hypot(v.x, v.y, v.z) : Math.hypot(v.x, v.z);
    this.speedNow = speed;
    const own = this.input.forward !== 0 || this.input.right !== 0 || (this.waterLevel >= 2 && (this.input.jump || this.input.crouch));
    if (own && speed > MOVE_SPEED * Math.min(1, this.size)) {
      this.moving = true;
      this.stillFor = 0;
    } else if (this.moving && speed < STILL_SPEED * Math.min(1, this.size)) {
      if ((this.stillFor += dt) >= STILL_TIME) this.moving = false;
    } else if (this.moving && !own) {
      if ((this.stillFor += dt) >= STILL_TIME) this.moving = false;
    }
    if (this.moving) this.walked += speed * dt;
  }

  private stepBody(inp: PlayerInput, dt: number): void {
    this.setCrouch(inp.crouch);
    const sprint = this.sprinting;
    if (this.tires) {
      if (sprint) this.tire(PLAYER.sprintCost * dt);
      else if ((this.rested += dt) >= PLAYER.restBeforeBack) this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaBack * dt);
      if (this.outOfBreath && this.stamina >= PLAYER.staminaToSprint) this.outOfBreath = false;
    }

    // Wished direction on the ground plane from the view yaw.
    const fx = -Math.sin(inp.yaw), fz = -Math.cos(inp.yaw);
    const rx = Math.cos(inp.yaw), rz = -Math.sin(inp.yaw);
    let wx = fx * inp.forward + rx * inp.right, wz = fz * inp.forward + rz * inp.right;
    const len = Math.hypot(wx, wz);
    if (len > 1e-6) {
      wx /= len;
      wz /= len;
    }
    const maxSpeed = (this.crouched ? PLAYER.crouchSpeed : sprint ? PLAYER.sprintSpeed : inp.walk && !this.tires ? PLAYER.walkSpeed : PLAYER.runSpeed) * this.speedScale * this.scriptSpeed;
    const wishSpeed = len > 1e-6 ? maxSpeed : 0;
    const s = this.surroundings;
    this.sense(s);

    if (this.onLadder) this.ladderMove(inp, fx, fz, rx, rz);
    else if (this.waterLevel >= 2) this.waterMove(inp, rx, rz, maxSpeed, dt);
    else this.walkMove(inp, wx, wz, wishSpeed, dt);
    this.jumpHeld = inp.jump;

    const desired = { x: (this.velocity.x + this.belt.x) * dt, y: this.velocity.y * dt, z: (this.velocity.z + this.belt.z) * dt };
    this.moveBy(desired, dt);
  }

  private fly(dt: number): void {
    const inp = this.input;
    this.setCrouch(false);
    const d = this.lookDirection();
    const rx = Math.cos(inp.yaw), rz = -Math.sin(inp.yaw);
    const up = (inp.jump ? 1 : 0) - (inp.crouch ? 1 : 0);
    let x = d[0] * inp.forward + rx * inp.right, y = d[1] * inp.forward + up, z = d[2] * inp.forward + rz * inp.right;
    const len = Math.hypot(x, y, z);
    const speed = len > 1e-6 ? (PLAYER.runSpeed * 2 * (inp.walk ? 3 : 1) * this.speedScale * dt) / len : 0;
    x *= speed; y *= speed; z *= speed;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.onGround = false;
    this.landingSpeed = 0;
    this.prevFeet = this.feet;
    this.feet = { x: this.feet.x + x, y: this.feet.y + y, z: this.feet.z + z };
    this.body.setNextKinematicTranslation({ x: this.feet.x, y: this.feet.y + this.height / 2, z: this.feet.z });
    this.prevView = { ...this.view };
    this.view = { y: this.feet.y, eye: this.eyeH };
  }

  /** Where the player is: how deep in water, and whether on a ladder. */
  private sense(s: PlayerSurroundings | null): void {
    const t = this.body.translation();
    const feet = t.y - this.height / 2;
    this.waterLevel = 0;
    if (s?.waterTop) {
      const wet = (y: number) => s.waterTop!({ x: t.x, y, z: t.z }) !== null;
      if (wet(feet + 2)) {
        this.waterLevel = 1;
        if (wet(feet + this.height / 2)) {
          this.waterLevel = 2;
          if (wet(feet + (this.crouched ? this.crouchEyeH : this.eyeH))) this.waterLevel = 3;
        }
      }
    }
    if (this.ladderCooldown > 0) this.ladderCooldown--;
    const speed = s?.ladder && !this.ladderCooldown ? s.ladder(new RAPIER.Cylinder(this.height / 2, this.radius + 2), t) : null;
    this.ladderSpeed = speed ?? 0;
    this.onLadder = speed !== null;
  }

  private ladderSpeed = 0;

  /**
   * On a ladder (Half-Life's way): forward climbs while looking ahead or up and goes down while looking down,
   * back does the opposite; sideways moves along it; no gravity. Jump lets go, pushing off backwards.
   */
  private ladderMove(inp: PlayerInput, fx: number, fz: number, rx: number, rz: number): void {
    const v = this.velocity;
    if (inp.jump && !this.jumpHeld) {
      v.x = -fx * PLAYER.ladderJumpSpeed;
      v.z = -fz * PLAYER.ladderJumpSpeed;
      v.y = PLAYER.ladderJumpSpeed * 0.5;
      this.jumped = true;
      this.ladderCooldown = 20;
      this.onLadder = false;
      this.onGround = false;
      return;
    }
    const speed = this.ladderSpeed * this.scriptSpeed;
    const up = inp.pitch > -0.35 ? 1 : -1;
    v.y = inp.forward * speed * up;
    // Forward also presses into the ladder, so at the top the player steps off onto the floor.
    v.x = (fx * inp.forward + rx * inp.right) * speed * 0.5;
    v.z = (fz * inp.forward + rz * inp.right) * speed * 0.5;
    this.onGround = false;
  }

  /** Swimming (Source's water move): forward follows the view, Jump rises, Crouch dives, idle sinks slowly. */
  private waterMove(inp: PlayerInput, rx: number, rz: number, maxSpeed: number, dt: number): void {
    const v = this.velocity;
    // Out onto a ledge: at the surface, swimming forward against a wall, with Jump.
    if (this.waterLevel === 2 && inp.jump && inp.forward > 0 && this.lastBlocked) {
      if (v.y < PLAYER.waterJumpSpeed) this.jumped = true;
      v.y = Math.max(v.y, PLAYER.waterJumpSpeed);
      return;
    }
    const d = this.lookDirection();
    const run = this.crouched ? PLAYER.runSpeed * this.scriptSpeed : maxSpeed;
    const wish = { x: (d[0] * inp.forward + rx * inp.right) * run, y: d[1] * inp.forward * run, z: (d[2] * inp.forward + rz * inp.right) * run };
    if (inp.jump) wish.y += run;
    else if (inp.crouch) wish.y -= run;
    else if (!inp.forward && !inp.right) wish.y -= PLAYER.sinkSpeed * this.scriptGravity;
    let wishSpeed = Math.hypot(wish.x, wish.y, wish.z);
    const dir = wishSpeed > 1e-6 ? { x: wish.x / wishSpeed, y: wish.y / wishSpeed, z: wish.z / wishSpeed } : { x: 0, y: 0, z: 0 };
    wishSpeed = Math.min(wishSpeed, run) * PLAYER.swimFactor;
    // Water friction.
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > 1e-3) {
      const k = Math.max(0, speed - dt * speed * PLAYER.waterFriction) / speed;
      v.x *= k;
      v.y *= k;
      v.z *= k;
    }
    // Accelerate in 3D along the wished direction.
    if (wishSpeed > 0) {
      const add = wishSpeed - (v.x * dir.x + v.y * dir.y + v.z * dir.z);
      if (add > 0) {
        const gain = Math.min(add, PLAYER.accelerate * wishSpeed * dt);
        v.x += gain * dir.x;
        v.y += gain * dir.y;
        v.z += gain * dir.z;
      }
    }
    this.onGround = false;
  }

  /** On the ground or in the air. */
  private walkMove(inp: PlayerInput, wx: number, wz: number, wishSpeed: number, dt: number): void {
    if (this.onGround) this.airJumped = 0;
    else if (inp.jump && !this.jumpHeld && this.airJumped < this.airJumps) {
      this.airJumped++;
      this.velocity.y = this.jumpSpeed;
      this.jumped = true;
    }
    if (this.onGround) {
      // Jump (pressing again each time; holding doesn't repeat).
      if (inp.jump && !this.jumpHeld && !this.riding && (!this.tires || this.stamina >= PLAYER.jumpCost)) {
        if (this.tires) this.tire(PLAYER.jumpCost);
        this.velocity.y = this.jumpSpeed;
        this.onGround = false;
        this.jumped = true;
      } else {
        this.applyFriction(dt);
        this.accelerate(wx, wz, wishSpeed, PLAYER.accelerate, dt);
      }
    }
    if (!this.onGround) {
      this.accelerate(wx, wz, Math.min(wishSpeed, PLAYER.airCap), PLAYER.airAccelerate, dt, wishSpeed);
      this.velocity.y -= this.gravity * this.scriptGravity * dt;
    }
  }

  /**
   * Take-off speed. The script jump factor is how high (×2 is twice as high), and the height keeps that with any
   * gravity: speed = √(2 g h).
   */
  private get jumpSpeed(): number {
    return PLAYER.jumpSpeed * this.jumpScale * Math.sqrt(Math.max(0, this.scriptJump) * Math.max(0.05, this.scriptGravity));
  }

  /** Move by `desired` this step, sliding along what is hit, stepping up, riding what moves. */
  private moveBy(desired: V, dt: number): void {
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
    this.lastBlocked = blocked;
    // (Landing in water, or coming off a ladder, doesn't hurt.)
    if (grounded && !this.onGround && v.y < 0 && !this.waterLevel && !this.onLadder) this.landingSpeed = -v.y;
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
    const r = this.radius * 0.9;
    for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const from = { x: at.x + ox * r, y: footY + Math.min(this.stepH, this.height - 1), z: at.z + oz * r };
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
      const lag = this.stepH * 1.5;
      this.view.y = Math.min(y + lag, Math.max(y - lag, this.view.y));
    }
    const eye = this.crouched ? this.crouchEyeH : this.eyeH;
    this.view.eye += (eye - this.view.eye) * k;
  }

  /** Stand on the step ahead, if there is one and the box fits on it. */
  private stepUp(t: V, desired: V): V | null {
    const top = this.stepAhead(desired.x, desired.z);
    if (top === null) return null;
    const up = { x: t.x + desired.x, y: top + this.height / 2 + 0.5, z: t.z + desired.z };
    const shape = playerShape(this.height, this.radius);
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
      const reach = this.radius + ahead;
      const from = { x: t.x + (dx / len) * reach, y: feet + this.stepH + 1, z: t.z + (dz / len) * reach };
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(from, { x: 0, y: -1, z: 0 }), this.stepH + 1, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
      if (!hit) continue;
      const top = from.y - hit.timeOfImpact;
      if (top > feet + 0.25 && top <= feet + this.stepH + 0.5 && hit.normal.y > 0.7) return top;
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
      this.collider.setHalfHeight(this.crouchH / 2);
      // Keep the feet where they are.
      this.body.setTranslation({ x: t.x, y: t.y - (this.standH - this.crouchH) / 2, z: t.z }, true);
      this.collider.setTranslation(this.body.translation());
      return;
    }
    const lift = this.standH - this.crouchH;
    const shape = playerShape(this.standH, this.radius);
    const pos = { x: t.x, y: t.y + lift / 2, z: t.z };
    const blocked = this.world.intersectionWithShape(pos, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider);
    if (blocked) return;
    this.crouched = false;
    this.collider.setHalfHeight(this.standH / 2);
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

  /** What the player is pointing at within `reach` (skipping what `skip` says to), and how far away. */
  aimAt(reach: number, skip?: (c: RAPIER.Collider) => boolean, sensors = false): { collider: RAPIER.Collider; distance: number } | null {
    const [x, y, z] = this.eye();
    const d = this.lookDirection();
    const hit = this.world.castRay(new RAPIER.Ray({ x, y, z }, { x: d[0], y: d[1], z: d[2] }), reach, true, sensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SOLID, this.collider, undefined, skip ? (c) => !skip(c) : undefined);
    return hit ? { collider: hit.collider, distance: hit.timeOfImpact } : null;
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
  }
}
