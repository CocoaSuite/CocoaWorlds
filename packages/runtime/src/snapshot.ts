/**
 * One compact picture of what is drawn this frame, read by what draws the game instead of asking the world about
 * each object: poses in typed arrays, one stable index per object (given the first time it is seen, never reused).
 * Filled in place by `GameWorld.snapshot()` (nothing new is made once the arrays are big enough), so it is also the
 * shape a game world in a worker would send each frame.
 */

/** `bodyFlags`: the body is still in the world (its pose is filled). */
export const BODY_PRESENT = 1;
/** `bodyFlags`: the body is shown (scripts can hide things). Set for an index whose body is gone, as `isVisible`. */
export const BODY_VISIBLE = 2;

/** Numbers per body in `bodyPose`: its drawn motion, a column-major 4×4 matrix (as `drawnMotionOf`). */
export const POSE = 16;
/** Numbers per body in `bodyAt`: where it is now, x, y, z (as `positionOf`). */
export const AT = 3;
/** Numbers per creature in `npcPose`: feet x, y, z, then yaw, drawn between steps (as `npcStates(true)`). */
export const NPC = 4;

/** `view` layout: eye x, y, z, yaw, pitch, feet x, y, z (as `playerView`). */
export const VIEW = 8;

export class FrameSnapshot {
  /** Bodies by index. */
  readonly bodyIds: string[] = [];
  bodyPose = new Float64Array(POSE * 8);
  bodyAt = new Float64Array(AT * 8);
  bodyFlags = new Uint8Array(8);

  /** Creatures by index. */
  readonly npcIds: string[] = [];
  npcPose = new Float64Array(NPC * 8);
  npcAlive = new Uint8Array(8);
  npcHealth = new Float64Array(8);
  readonly npcState: string[] = [];

  /** The player's view, when `hasView`. */
  readonly view = new Float64Array(VIEW);
  hasView = false;
  thirdPerson = false;
  crouched = false;
  /** The player is sprinting (the view widens). */
  sprinting = false;
  /** How fast the player falls (units/s, 0 when not falling; the view widens on long falls). */
  fallSpeed = 0;

  /** Counts fills (a reader can tell a fresh picture from the one it already used). */
  frame = 0;

  private bodyIndex = new Map<string, number>();
  private npcIndex = new Map<string, number>();
  private tracked = new Set<string>();

  /** The index of body `id` (-1: never seen; `GameWorld.drawn` adds a body that doesn't move). */
  body(id: string): number {
    return this.bodyIndex.get(id) ?? -1;
  }

  /** The index of creature `id` (-1: never seen). */
  npc(id: string): number {
    return this.npcIndex.get(id) ?? -1;
  }

  /**
   * Keep body `id` in the picture from the next fill on, even if it doesn't move (moving ones always are). Returns
   * its index.
   */
  track(id: string): number {
    this.tracked.add(id);
    return this.indexBody(id);
  }

  /** Bodies asked for with `track`. */
  get trackedIds(): ReadonlySet<string> {
    return this.tracked;
  }

  get bodyCount(): number {
    return this.bodyIds.length;
  }

  get npcCount(): number {
    return this.npcIds.length;
  }

  /** Whether body index `i` is shown (an unknown index is, as `isVisible` says for an unknown id). */
  visible(i: number): boolean {
    return i < 0 || (this.bodyFlags[i]! & BODY_VISIBLE) !== 0;
  }

  /** Whether body index `i` is still in the world (its pose is filled). */
  present(i: number): boolean {
    return i >= 0 && (this.bodyFlags[i]! & BODY_PRESENT) !== 0;
  }

  // ── Filling (GameWorld) ──

  /** Start a fill: every body is gone and shown until it is written again. */
  begin(): void {
    this.frame++;
    this.bodyFlags.fill(BODY_VISIBLE, 0, this.bodyIds.length);
  }

  indexBody(id: string): number {
    let i = this.bodyIndex.get(id);
    if (i !== undefined) return i;
    i = this.bodyIds.length;
    this.bodyIds.push(id);
    this.bodyIndex.set(id, i);
    if (i >= this.bodyFlags.length) {
      const n = this.bodyFlags.length * 2;
      this.bodyPose = grow(this.bodyPose, n * POSE);
      this.bodyAt = grow(this.bodyAt, n * AT);
      this.bodyFlags = grow(this.bodyFlags, n);
    }
    this.bodyFlags[i] = BODY_VISIBLE;
    return i;
  }

  /** Write body index `i`: its drawn motion (16 numbers), where it is, whether shown. */
  setBody(i: number, motion: ArrayLike<number>, x: number, y: number, z: number, visible: boolean): void {
    this.bodyPose.set(motion, i * POSE);
    const a = i * AT;
    this.bodyAt[a] = x;
    this.bodyAt[a + 1] = y;
    this.bodyAt[a + 2] = z;
    this.bodyFlags[i] = BODY_PRESENT | (visible ? BODY_VISIBLE : 0);
  }

  indexNpc(id: string): number {
    let i = this.npcIndex.get(id);
    if (i !== undefined) return i;
    i = this.npcIds.length;
    this.npcIds.push(id);
    this.npcIndex.set(id, i);
    this.npcState.push('');
    if (i >= this.npcAlive.length) {
      const n = this.npcAlive.length * 2;
      this.npcPose = grow(this.npcPose, n * NPC);
      this.npcAlive = grow(this.npcAlive, n);
      this.npcHealth = grow(this.npcHealth, n);
    }
    return i;
  }

  setNpc(i: number, x: number, y: number, z: number, yaw: number, alive: boolean, state: string, health: number): void {
    const k = i * NPC;
    this.npcPose[k] = x;
    this.npcPose[k + 1] = y;
    this.npcPose[k + 2] = z;
    this.npcPose[k + 3] = yaw;
    this.npcAlive[i] = alive ? 1 : 0;
    this.npcHealth[i] = health;
    this.npcState[i] = state;
  }

  setView(v: { eye: ArrayLike<number>; yaw: number; pitch: number; thirdPerson: boolean; feet: ArrayLike<number> } | null, crouched: boolean): void {
    this.hasView = !!v;
    if (!v) return;
    const o = this.view;
    o[0] = v.eye[0]!;
    o[1] = v.eye[1]!;
    o[2] = v.eye[2]!;
    o[3] = v.yaw;
    o[4] = v.pitch;
    o[5] = v.feet[0]!;
    o[6] = v.feet[1]!;
    o[7] = v.feet[2]!;
    this.thirdPerson = v.thirdPerson;
    this.crouched = crouched;
  }

  /** What the view's field-of-view effects follow. */
  setMotion(sprinting: boolean, fallSpeed: number): void {
    this.sprinting = sprinting;
    this.fallSpeed = fallSpeed;
  }
}

function grow<T extends Float64Array | Uint8Array>(a: T, n: number): T {
  const b = new (a.constructor as new (n: number) => T)(n);
  b.set(a);
  return b;
}
