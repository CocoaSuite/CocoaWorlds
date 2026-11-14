/** Cave monsters: they walk the blocks themselves (block space), find their way to the player, hit and shoot. */
import type { MobDef } from './defs';

export interface MobWorld {
  /** Blocks monsters can't pass (rock, and the base). */
  solid(x: number, y: number, z: number): boolean;
  /** The player's feet (block space), height and radius in blocks. */
  player(): { x: number; y: number; z: number; h: number; r: number } | null;
  hurt(amount: number, cause: string): void;
  sees(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  shoot(from: [number, number, number], vel: [number, number, number], damage: number, by: string): void;
  gravity: number;
  random(): number;
}

export type MobState = 'idle' | 'walk' | 'attack' | 'die';

let ids = 0;

export class Mob {
  readonly id = `mob${++ids}`;
  /** The patch of cave it lives in (its sector). */
  sector = '';
  pos: [number, number, number];
  vel: [number, number, number] = [0, 0, 0];
  yaw = 0;
  hp: number;
  readonly maxHp: number;
  state: MobState = 'idle';
  readonly w: number;
  readonly h: number;
  private readonly speed: number;
  diedAt = -1;
  grounded = false;
  private blocked = false;
  private path: [number, number, number][] = [];
  private repathAt = 0;
  private attackAt = 0;
  private shootAt = 0;
  private attackUntil = 0;
  private wander: [number, number] = [0, 0];
  private wanderAt = 0;

  constructor(
    readonly def: MobDef,
    at: [number, number, number],
    block: number,
    readonly damage: number,
    readonly reward: number,
    hp: number,
  ) {
    this.pos = [...at];
    this.w = def.size[0] / block;
    this.h = def.size[1] / block;
    this.speed = def.speed / block;
    this.hp = this.maxHp = hp;
  }

  get dead(): boolean {
    return this.diedAt >= 0;
  }

  private hits(world: MobWorld): boolean {
    const hw = this.w / 2 - 1e-3, [x, y, z] = this.pos;
    for (let by = Math.floor(y + 1e-3); by <= Math.floor(y + this.h - 1e-3); by++)
      for (let bz = Math.floor(z - hw); bz <= Math.floor(z + hw); bz++)
        for (let bx = Math.floor(x - hw); bx <= Math.floor(x + hw); bx++) if (world.solid(bx, by, bz)) return true;
    return false;
  }

  /** Move along one axis; true if something stopped it. */
  private move(world: MobWorld, axis: 0 | 1 | 2, d: number): boolean {
    if (!d) return false;
    const before = this.pos[axis];
    this.pos[axis] += d;
    if (!this.hits(world)) return false;
    if (axis === 1) this.pos[1] = d < 0 ? Math.floor(this.pos[1]) + 1 : Math.floor(this.pos[1] + this.h) - this.h - 1e-4;
    else {
      const hw = this.w / 2;
      this.pos[axis] = d > 0 ? Math.floor(this.pos[axis] + hw) - hw - 1e-4 : Math.floor(this.pos[axis] - hw) + 1 + hw + 1e-4;
    }
    if (this.hits(world)) this.pos[axis] = before;
    return true;
  }

  hit(damage: number, push: [number, number], time: number): void {
    if (this.dead) return;
    this.hp -= damage;
    this.vel[0] += push[0];
    this.vel[2] += push[1];
    if (this.grounded) this.vel[1] = Math.max(this.vel[1], 3);
    if (this.hp <= 0) {
      this.diedAt = time;
      this.state = 'die';
    }
  }

  step(dt: number, world: MobWorld, time: number): void {
    if (this.dead) {
      this.vel[0] *= 0.8;
      this.vel[2] *= 0.8;
      this.physics(dt, world, false);
      return;
    }
    const p = world.player();
    let want: [number, number] = [0, 0];
    const speed = this.speed;
    let climb = false;
    if (p) {
      const dx = p.x - this.pos[0], dy = p.y - this.pos[1], dz = p.z - this.pos[2];
      const flat = Math.hypot(dx, dz), dist = Math.hypot(dx, dy, dz);
      const eye = this.pos[1] + this.h * 0.85;
      const aggro = dist < 24 && (dist < 6 || world.sees(this.pos[0], eye, this.pos[2], p.x, p.y + p.h * 0.85, p.z));
      if (aggro) {
        const archer = this.def.kind === 'archer';
        const inRange = archer && dist < this.def.range && world.sees(this.pos[0], eye, this.pos[2], p.x, p.y + p.h * 0.6, p.z);
        if (inRange) {
          this.face(dx, dz);
          if (time >= this.shootAt) {
            this.shootAt = time + 2;
            this.attackUntil = time + 0.5;
            const tx = p.x, ty = p.y + p.h * 0.6, tz = p.z, from: [number, number, number] = [this.pos[0], eye, this.pos[2]];
            const vx = tx - from[0], vy = ty - from[1], vz = tz - from[2], l = Math.hypot(vx, vy, vz) || 1, s = 22;
            const t = l / s;
            world.shoot(from, [(vx / l) * s, (vy / l) * s + world.gravity * 0.35 * t * 0.5, (vz / l) * s], this.damage, this.def.label.toLowerCase());
          }
        } else if (this.def.kind === 'climber') want = flat > 0.01 ? [dx / flat, dz / flat] : [0, 0];
        else want = this.follow(world, p, time);
        const reach = this.w / 2 + p.r + 0.4;
        if (!archer && flat < reach && dy > -this.h && dy < p.h) {
          want = [0, 0];
          this.face(dx, dz);
          if (time >= this.attackAt) {
            this.attackAt = time + 1;
            this.attackUntil = time + 0.4;
            world.hurt(this.damage, `a ${this.def.label.toLowerCase()}`);
          }
        }
      } else {
        if (time >= this.wanderAt) {
          this.wanderAt = time + 2 + world.random() * 3;
          const a = world.random() * Math.PI * 2;
          this.wander = world.random() < 0.5 ? [0, 0] : [Math.cos(a) * 0.4, Math.sin(a) * 0.4];
        }
        want = this.wander;
      }
      climb = this.def.kind === 'climber' && aggro && this.blocked;
    }
    // (Knockback fades; walking sets the rest.)
    const k = this.grounded ? 0.75 : 0.95;
    this.vel[0] = this.vel[0] * k + want[0] * speed * (1 - k);
    this.vel[2] = this.vel[2] * k + want[1] * speed * (1 - k);
    if (want[0] || want[1]) this.face(want[0], want[1]);
    if (this.blocked && this.grounded && this.def.kind !== 'climber' && (want[0] || want[1])) this.vel[1] = Math.sqrt(2 * world.gravity * 1.3);
    this.physics(dt, world, climb);
    if (climb) this.vel[1] = speed * 0.8;
    this.state = time < this.attackUntil ? 'attack' : Math.hypot(want[0], want[1]) > 0.05 ? 'walk' : 'idle';
  }

  private physics(dt: number, world: MobWorld, climb: boolean): void {
    if (!climb) this.vel[1] = Math.max(-20, this.vel[1] - world.gravity * dt);
    const bx = this.move(world, 0, this.vel[0] * dt), bz = this.move(world, 2, this.vel[2] * dt);
    this.blocked = bx || bz;
    const fell = this.vel[1] * dt;
    const hitY = this.move(world, 1, fell);
    this.grounded = hitY && fell < 0;
    if (hitY) this.vel[1] = 0;
  }

  private face(dx: number, dz: number): void {
    if (dx || dz) this.yaw = Math.atan2(-dx, -dz);
  }

  private follow(world: MobWorld, p: { x: number; y: number; z: number }, time: number): [number, number] {
    if (time >= this.repathAt) {
      this.repathAt = time + 0.6 + world.random() * 0.3;
      const tall = Math.ceil(this.h - 0.05);
      this.path = findPath(world, [Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.01), Math.floor(this.pos[2])], [Math.floor(p.x), Math.floor(p.y + 0.01), Math.floor(p.z)], tall) ?? [];
    }
    while (this.path.length) {
      const [nx, , nz] = this.path[0]!;
      const dx = nx + 0.5 - this.pos[0], dz = nz + 0.5 - this.pos[2];
      if (Math.hypot(dx, dz) < 0.3) {
        this.path.shift();
        continue;
      }
      const l = Math.hypot(dx, dz);
      return [dx / l, dz / l];
    }
    const dx = p.x - this.pos[0], dz = p.z - this.pos[2], l = Math.hypot(dx, dz);
    return l > 0.01 ? [dx / l, dz / l] : [0, 0];
  }
}

/** A short walk over the blocks (A*), from feet block to feet block. Null when the start isn't on the ground. */
export function findPath(world: MobWorld, from: [number, number, number], to: [number, number, number], tall: number, budget = 600): [number, number, number][] | null {
  const free = (x: number, y: number, z: number) => {
    for (let i = 0; i < tall; i++) if (world.solid(x, y + i, z)) return false;
    return true;
  };
  const stands = (x: number, y: number, z: number) => free(x, y, z) && world.solid(x, y - 1, z);
  if (!stands(...from)) return null;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const h = (x: number, y: number, z: number) => Math.abs(x - to[0]) + Math.abs(y - to[1]) + Math.abs(z - to[2]);
  const open: { k: string; p: [number, number, number]; g: number; f: number }[] = [{ k: key(...from), p: from, g: 0, f: h(...from) }];
  const came = new Map<string, string | null>([[open[0]!.k, null]]);
  const at = new Map<string, [number, number, number]>([[open[0]!.k, from]]);
  const cost = new Map<string, number>([[open[0]!.k, 0]]);
  let best = open[0]!, n = 0;
  while (open.length && n++ < budget) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    if (h(...cur.p) < h(...best.p)) best = cur;
    if (cur.p[0] === to[0] && cur.p[2] === to[2] && Math.abs(cur.p[1] - to[1]) <= 1) {
      best = cur;
      break;
    }
    const [x, y, z] = cur.p;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (const dy of [0, 1, -1, -2, -3]) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (!stands(nx, ny, nz)) continue;
        if (dy > 0 && world.solid(x, y + tall, z)) continue;
        if (dy < 0 && !free(nx, y, nz)) continue;
        const k = key(nx, ny, nz), g = cur.g + 1 + (dy > 0 ? 0.5 : 0);
        if (g >= (cost.get(k) ?? Infinity)) continue;
        cost.set(k, g);
        came.set(k, cur.k);
        at.set(k, [nx, ny, nz]);
        open.push({ k, p: [nx, ny, nz], g, f: g + h(nx, ny, nz) });
        break;
      }
    }
  }
  const out: [number, number, number][] = [];
  for (let k: string | null | undefined = best.k; k; k = came.get(k)) out.unshift(at.get(k)!);
  out.shift();
  return out;
}

export interface Arrow {
  pos: [number, number, number];
  vel: [number, number, number];
  damage: number;
  by: string;
  until: number;
}

/** Arrows fly with a little drop; true while still flying. */
export function stepArrow(a: Arrow, dt: number, world: MobWorld, time: number): boolean {
  if (time > a.until) return false;
  a.vel[1] -= world.gravity * 0.35 * dt;
  a.pos = [a.pos[0] + a.vel[0] * dt, a.pos[1] + a.vel[1] * dt, a.pos[2] + a.vel[2] * dt];
  if (world.solid(Math.floor(a.pos[0]), Math.floor(a.pos[1]), Math.floor(a.pos[2]))) return false;
  const p = world.player();
  if (p && Math.hypot(a.pos[0] - p.x, a.pos[2] - p.z) < p.r + 0.15 && a.pos[1] > p.y && a.pos[1] < p.y + p.h) {
    world.hurt(a.damage, `a ${a.by}'s arrow`);
    return false;
  }
  return true;
}
