/**
 * Bosses guard the heart of each structure. Every attack winds up first (and glows), then lands: a swing or a charge
 * can be parried, which leaves the boss open; a slam can only be blocked or dodged; shots parried fly back.
 */
import type { BossAttack, BossDef } from './defs';
import type { MobWorld } from './mobs';

export type BossState = 'sleep' | 'idle' | 'windup' | 'strike' | 'recover' | 'stagger' | 'dead';

export interface BossWorld extends MobWorld {
  /** An attack lands now; what the player did about it. */
  strike(boss: Boss, kind: BossAttack, damage: number, reach: number): 'parry' | 'block' | 'hit' | 'miss';
  volley(boss: Boss, from: [number, number, number], vel: [number, number, number][]): void;
  summon(boss: Boss, n: number): void;
  roar(boss: Boss): void;
}

/** How long each attack winds up (s). */
const WINDUP: Record<BossAttack, number> = { swing: 0.75, slam: 1.1, charge: 0.7, volley: 0.8, summon: 1.1 };

let ids = 0;

export class Boss {
  readonly id = `boss${++ids}`;
  pos: [number, number, number];
  vel: [number, number, number] = [0, 0, 0];
  yaw = 0;
  hp: number;
  state: BossState = 'sleep';
  attack: BossAttack = 'swing';
  /** When the state began and when it ends. */
  since = 0;
  until = 0;
  phase = 1;
  diedAt = -1;
  hitAt = -99;
  readonly w: number;
  readonly h: number;
  private grounded = false;
  private blocked = false;
  private dash: [number, number] = [0, 0];
  private landed = false;
  private last: BossAttack | null = null;

  constructor(
    readonly def: BossDef,
    /** The structure it guards. */
    readonly key: string,
    readonly home: [number, number, number],
    readonly maxHp: number,
    readonly damage: number,
    readonly reward: number,
  ) {
    this.pos = [home[0] + 0.5, home[1], home[2] + 0.5];
    this.hp = maxHp;
    [this.w, this.h] = def.size;
  }

  get dead(): boolean {
    return this.diedAt >= 0;
  }

  private set(state: BossState, time: number, secs: number): void {
    this.state = state;
    this.since = time;
    this.until = time + secs;
  }

  wake(world: BossWorld, time: number): void {
    if (this.state !== 'sleep') return;
    this.set('idle', time, 1.2);
    world.roar(this);
  }

  /** Hit by the pickaxe (or its own shot): twice as hard while staggered. */
  hit(damage: number, push: [number, number], time: number, world: BossWorld): void {
    if (this.dead) return;
    if (this.state === 'sleep') this.wake(world, time);
    const open = this.state === 'stagger';
    this.hp -= damage * (open ? 2 : 1);
    this.hitAt = time;
    if (!open) {
      this.vel[0] += push[0] * 0.3;
      this.vel[2] += push[1] * 0.3;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.diedAt = time;
      this.state = 'dead';
    }
  }

  stagger(time: number, secs: number): void {
    if (!this.dead) this.set('stagger', time, secs);
  }

  /** 0…1 through the current windup (for the glow). */
  charge(time: number): number {
    return this.state === 'windup' ? Math.min(1, (time - this.since) / Math.max(0.01, this.until - this.since)) : 0;
  }

  step(dt: number, world: BossWorld, time: number): void {
    const p = world.player();
    if (this.dead || this.state === 'sleep' || !p) {
      this.vel[0] *= 0.8;
      this.vel[2] *= 0.8;
      this.physics(dt, world);
      if (p && this.state === 'sleep') {
        const d = Math.hypot(p.x - this.pos[0], p.y - this.pos[1], p.z - this.pos[2]);
        if (d < 6 || (d < 16 && world.sees(this.pos[0], this.pos[1] + this.h * 0.8, this.pos[2], p.x, p.y + p.h * 0.8, p.z))) this.wake(world, time);
      }
      return;
    }
    if (this.phase === 1 && this.hp < this.maxHp / 2) this.phase = 2;
    const fast = this.phase === 2 ? 0.72 : 1;
    const dx = p.x - this.pos[0], dz = p.z - this.pos[2], flat = Math.hypot(dx, dz) || 1;
    const gap = flat - this.w / 2 - p.r;
    let want: [number, number] = [0, 0], speed = this.def.speed;
    // (It keeps to its hall: past that, it walks home.)
    const hx = this.home[0] + 0.5 - this.pos[0], hz = this.home[2] + 0.5 - this.pos[2], away = Math.hypot(hx, hz);
    const roam = away < 24 || Math.hypot(p.x - this.home[0], p.z - this.home[2]) < 24;
    switch (this.state) {
      case 'idle':
        this.face(dx, dz);
        if (!roam) want = [hx / away, hz / away];
        else if (gap > 1) want = [dx / flat, dz / flat];
        if (time >= this.until && roam) {
          this.attack = this.choose(gap, world);
          this.set('windup', time, WINDUP[this.attack] * fast);
        }
        break;
      case 'windup':
        this.face(dx, dz);
        if (this.attack === 'swing' && gap > 0.8) want = [dx / flat, dz / flat];
        speed *= 0.5;
        if (time >= this.until) this.release(world, time, p, fast);
        break;
      case 'strike':
        if (this.attack === 'charge') {
          want = this.dash;
          speed *= 3.4;
          if (!this.landed && gap < 0.5) {
            this.landed = true;
            const r = world.strike(this, 'charge', this.damage * 1.2, this.w / 2 + 1);
            if (r === 'parry') this.stagger(time, 3);
            else this.set('recover', time, 0.9 * fast);
          } else if (this.blocked && time - this.since > 0.15) this.stagger(time, 1.6);
        }
        if (this.state === 'strike' && time >= this.until) this.set('recover', time, 0.9 * fast);
        break;
      case 'recover':
        if (gap > 2) want = [dx / flat, dz / flat];
        speed *= 0.6;
        if (time >= this.until) this.set('idle', time, 0.5 * fast);
        break;
      case 'stagger':
        if (time >= this.until) this.set('recover', time, 0.4);
        break;
    }
    const k = this.grounded ? 0.7 : 0.95;
    this.vel[0] = this.vel[0] * k + want[0] * speed * (1 - k);
    this.vel[2] = this.vel[2] * k + want[1] * speed * (1 - k);
    if (this.blocked && this.grounded && (want[0] || want[1]) && this.state !== 'strike') this.vel[1] = Math.sqrt(2 * world.gravity * 1.3);
    this.physics(dt, world);
  }

  /** Near: swing or slam; far: charge, shoot or call for help. Not the same twice running if there's a choice. */
  private choose(gap: number, world: BossWorld): BossAttack {
    const has = this.def.attacks;
    const near = has.filter((a) => a === 'swing' || a === 'slam'), far = has.filter((a) => a !== 'swing' && a !== 'slam');
    let list: BossAttack[] = gap < 2.2 ? near : far;
    if (!list.length) list = has;
    const fresh = list.filter((a) => a !== this.last);
    if (fresh.length) list = fresh;
    const a = list[Math.floor(world.random() * list.length)] ?? 'swing';
    this.last = a;
    return a;
  }

  private release(world: BossWorld, time: number, p: { x: number; y: number; z: number; h: number; r: number }, fast: number): void {
    const dx = p.x - this.pos[0], dz = p.z - this.pos[2], l = Math.hypot(dx, dz) || 1;
    this.landed = false;
    this.set('strike', time, 0.3);
    if (this.attack === 'swing') {
      if (world.strike(this, 'swing', this.damage, this.w / 2 + 1.7) === 'parry') this.stagger(time, 2.2);
    } else if (this.attack === 'slam') {
      world.strike(this, 'slam', this.damage * 1.5, this.w / 2 + 3.2);
    } else if (this.attack === 'charge') {
      this.dash = [dx / l, dz / l];
      this.set('strike', time, 1.1);
    } else if (this.attack === 'volley') {
      const n = this.phase === 2 ? 5 : 3, from: [number, number, number] = [this.pos[0], this.pos[1] + this.h * 0.7, this.pos[2]];
      const ty = p.y + p.h * 0.5 - from[1], base = Math.atan2(dz, dx), s = 11 / fast;
      const vel: [number, number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.16;
        vel.push([Math.cos(a) * s, (ty / l) * s, Math.sin(a) * s]);
      }
      world.volley(this, from, vel);
    } else world.summon(this, this.phase === 2 ? 3 : 2);
  }

  private hits(world: MobWorld): boolean {
    const hw = this.w / 2 - 1e-3, [x, y, z] = this.pos;
    for (let by = Math.floor(y + 1e-3); by <= Math.floor(y + this.h - 1e-3); by++)
      for (let bz = Math.floor(z - hw); bz <= Math.floor(z + hw); bz++)
        for (let bx = Math.floor(x - hw); bx <= Math.floor(x + hw); bx++) if (world.solid(bx, by, bz)) return true;
    return false;
  }

  private move(world: MobWorld, axis: 0 | 1 | 2, d: number): boolean {
    if (!d) return false;
    const before = this.pos[axis];
    this.pos[axis] += d;
    if (!this.hits(world)) return false;
    if (axis === 1) this.pos[1] = d < 0 ? Math.floor(this.pos[1]) + 1 : Math.floor(this.pos[1] + this.h) - this.h - 1e-4;
    if (axis !== 1 || this.hits(world)) this.pos[axis] = before;
    return true;
  }

  private physics(dt: number, world: MobWorld): void {
    this.vel[1] = Math.max(-20, this.vel[1] - world.gravity * dt);
    const bx = this.move(world, 0, this.vel[0] * dt), bz = this.move(world, 2, this.vel[2] * dt);
    this.blocked = bx || bz;
    const fell = this.vel[1] * dt, hitY = this.move(world, 1, fell);
    this.grounded = hitY && fell < 0;
    if (hitY) this.vel[1] = 0;
  }

  private face(dx: number, dz: number): void {
    if (dx || dz) this.yaw = Math.atan2(-dx, -dz);
  }
}

/** A boss's shot (block space); parried, it flies back at the boss. */
export interface Shot {
  pos: [number, number, number];
  vel: [number, number, number];
  damage: number;
  boss: Boss;
  until: number;
  back: boolean;
}
