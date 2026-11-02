/**
 * Weapons (A1): bullets that hit at once along a line, projectiles that fly (straight or in an arc), melee
 * swings, and blasts. Shared by the player and, later, by creatures: a shot comes from a point, in a
 * direction, by someone (whose own body it never hits).
 *
 * The weapons know nothing of objects' meaning: the world tells them, through `WeaponHost`, who owns a
 * collider, how to hurt it and what to announce. Damage goes to breakable objects (and what they are inside),
 * to the player, and to anything else that listens; hits push physics objects.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { WeaponDef } from '@cocoaworlds/core';

export type V3 = [number, number, number];

export interface WeaponHost {
  readonly world: RAPIER.World;
  time(): number;
  /** Which object a collider belongs to ('player' for the player), or undefined. */
  ownerOf(handle: number): string | undefined;
  /** Colliders shots pass through (zones, water, ladders, stand-ins of moving things). */
  passes(c: RAPIER.Collider): boolean;
  /** Something was hit for `amount` damage at `point` by `by` (a weapon, a blast). */
  damage(target: string, amount: number, by: string, cause: string): void;
  /** Push the player (a blast). */
  pushPlayer(dx: number, dy: number, dz: number): void;
  /** Where the player's middle is (for blasts), or null. */
  playerCentre(): V3 | null;
  /** Announce what happened, for whoever draws it (tracers, holes, flashes) and plays sounds. */
  announce(e: WeaponEvent): void;
}

export type WeaponEvent =
  /** A shot (bullet, swing) from a point, ending where it hit (or at its range). */
  | { type: 'shot'; from: V3; to: V3; by: string; weapon: string }
  /** A bullet or a swing hit a surface (`target` is its object, if any). */
  | { type: 'impact'; at: V3; normal: V3; target: string | null; melee: boolean }
  /** A blast went off. */
  | { type: 'explosion'; at: V3; radius: number };

export interface Projectile {
  id: number;
  at: V3;
  velocity: V3;
  weapon: WeaponDef;
  name: string;
  by: string;
  exclude: number | null;
  /** Seconds left before it goes off by itself (grenades) or vanishes. */
  life: number;
}

/** A random direction within `degrees` of `d` (a unit vector). */
export function scatter(d: V3, degrees: number, random: () => number): V3 {
  if (degrees <= 0) return d;
  // Two directions across `d`.
  const up: V3 = Math.abs(d[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const a = norm(cross(d, up));
  const b = cross(a, d);
  // Uniform in a disc (like Source's spread cone).
  const r = Math.tan((degrees * Math.PI) / 180) * Math.sqrt(random());
  const t = random() * Math.PI * 2;
  return norm([d[0] + (a[0] * Math.cos(t) + b[0] * Math.sin(t)) * r, d[1] + (a[1] * Math.cos(t) + b[1] * Math.sin(t)) * r, d[2] + (a[2] * Math.cos(t) + b[2] * Math.sin(t)) * r]);
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export class Weapons {
  readonly projectiles: Projectile[] = [];
  private nextId = 1;

  constructor(
    private host: WeaponHost,
    private random: () => number = Math.random,
  ) {}

  /**
   * Fire `weapon` (called `name`) from `from` towards `dir` (a unit vector) by `by`, never hitting the collider
   * `exclude` (the shooter's own).
   */
  fire(weapon: WeaponDef, name: string, from: V3, dir: V3, by: string, exclude: number | null): void {
    if (weapon.kind === 'projectile') {
      // From a little in front of the shooter.
      const at: V3 = [from[0] + dir[0] * 24, from[1] + dir[1] * 24, from[2] + dir[2] * 24];
      this.projectiles.push({ id: this.nextId++, at, velocity: [dir[0] * weapon.speed, dir[1] * weapon.speed, dir[2] * weapon.speed], weapon, name, by, exclude, life: weapon.arc ? 2.5 : 10 });
      return;
    }
    const melee = weapon.kind === 'melee';
    for (let i = 0; i < (melee ? 1 : weapon.pellets); i++) {
      const d = melee ? dir : scatter(dir, weapon.spread, this.random);
      const hit = this.cast(from, d, weapon.range, exclude);
      const end: V3 = hit ? hit.point : [from[0] + d[0] * weapon.range, from[1] + d[1] * weapon.range, from[2] + d[2] * weapon.range];
      if (!melee) this.host.announce({ type: 'shot', from, to: end, by, weapon: name });
      if (!hit) continue;
      const target = this.host.ownerOf(hit.collider.handle) ?? null;
      this.host.announce({ type: 'impact', at: hit.point, normal: hit.normal, target, melee });
      this.push(hit.collider, hit.point, [d[0] * weapon.push, d[1] * weapon.push, d[2] * weapon.push]);
      if (target) this.host.damage(target, weapon.damage, by, name);
      if (weapon.blast > 0) this.explode(hit.point, weapon, by, name);
    }
  }

  /** Move projectiles by one step; those that hit something (or run out of time) go off. */
  step(dt: number, gravity: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (p.weapon.arc) p.velocity[1] -= gravity * dt;
      const v = p.velocity;
      const len = Math.hypot(v[0], v[1], v[2]) * dt;
      p.life -= dt;
      const d: V3 = len > 0 ? [(v[0] * dt) / len, (v[1] * dt) / len, (v[2] * dt) / len] : [0, -1, 0];
      const hit = len > 0 ? this.cast(p.at, d, len, p.exclude) : null;
      if (hit && !p.weapon.arc) {
        // Rockets go off on what they hit (and hurt it directly too, as the blast's middle).
        this.projectiles.splice(i, 1);
        const target = this.host.ownerOf(hit.collider.handle) ?? null;
        if (p.weapon.blast > 0) this.explode(hit.point, p.weapon, p.by, p.name, hit.normal);
        else if (target) this.host.damage(target, p.weapon.damage, p.by, p.name);
        continue;
      }
      if (hit) {
        // Grenades bounce, losing most of their speed.
        const n = hit.normal;
        const into = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
        p.at = [hit.point[0] + n[0] * 2, hit.point[1] + n[1] * 2, hit.point[2] + n[2] * 2];
        p.velocity = [(v[0] - 2 * into * n[0]) * 0.45, (v[1] - 2 * into * n[1]) * 0.45, (v[2] - 2 * into * n[2]) * 0.45];
        // (A grenade lying still stops bouncing.)
        if (Math.hypot(...p.velocity) < 20) p.velocity = [0, 0, 0];
        p.exclude = null;
      } else p.at = [p.at[0] + v[0] * dt, p.at[1] + v[1] * dt, p.at[2] + v[2] * dt];
      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        if (p.weapon.blast > 0) this.explode(p.at, p.weapon, p.by, p.name);
      }
    }
  }

  /**
   * A blast at `at`: damage and push fall off with distance to nothing at its edge, and stop at walls. The
   * player's own blasts hurt them too (rocket jumps).
   */
  explode(at: V3, weapon: WeaponDef, by: string, name: string, normal?: V3): void {
    // (Lifted off the surface, so the wall it hit doesn't hide everything.)
    const c: V3 = normal ? [at[0] + normal[0] * 2, at[1] + normal[1] * 2, at[2] + normal[2] * 2] : at;
    const r = weapon.blast;
    this.host.announce({ type: 'explosion', at: c, radius: r });
    const hurt = new Set<string>();
    const w = this.host.world;
    const pushed = new Set<number>();
    // (Collected first: bodies can't be changed from inside the physics engine's own query.)
    const found: RAPIER.Collider[] = [];
    w.intersectionsWithShape({ x: c[0], y: c[1], z: c[2] }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(r), (col) => {
      found.push(col);
      return true;
    });
    for (const col of found) {
      if (this.host.passes(col)) continue;
      const id = this.host.ownerOf(col.handle);
      // Where the blast reaches it: its body's middle, or the nearest point of a fixed piece.
      const body = col.parent();
      const target = body && !body.isFixed() ? body.translation() : (w.projectPoint({ x: c[0], y: c[1], z: c[2] }, true, undefined, undefined, undefined, undefined, (x) => x.handle === col.handle)?.point ?? null);
      if (!target) continue;
      const to: V3 = [target.x - c[0], target.y - c[1], target.z - c[2]];
      const dist = Math.hypot(to[0], to[1], to[2]);
      if (dist > r || !this.reaches(c, to, dist, col.handle)) continue;
      const k = 1 - dist / r;
      if (id && id !== 'player' && !hurt.has(id)) {
        hurt.add(id);
        this.host.damage(id, weapon.damage * k, by, name);
      }
      if (body?.isDynamic() && !pushed.has(body.handle)) {
        pushed.add(body.handle);
        const d = dist > 1e-3 ? to.map((x) => x / dist) : [0, 1, 0];
        // (Impulse: a 10 kg crate is thrown at about the weapon's push, a heavier one less.)
        const f = weapon.push * k * 10;
        body.applyImpulse({ x: d[0]! * f, y: (d[1]! + 0.3) * f, z: d[2]! * f }, true);
      }
    }
    // The player (their body is a character, not a physics object): hurt and thrown.
    const p = this.host.playerCentre();
    if (p) {
      const to: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      const dist = Math.hypot(to[0], to[1], to[2]);
      if (dist < r && this.reaches(c, to, dist, null, true)) {
        const k = 1 - dist / r;
        this.host.damage('player', weapon.damage * k, by, name);
        const d = dist > 1e-3 ? to.map((x) => x / dist) : [0, 1, 0];
        const s = weapon.push * k;
        this.host.pushPlayer(d[0]! * s, (d[1]! + 0.4) * s, d[2]! * s);
      }
    }
  }

  /** Whether a blast at `c` reaches `to` away without a wall between (the target's own collider doesn't count). */
  private reaches(c: V3, to: V3, dist: number, own: number | null, player = false): boolean {
    if (dist < 1) return true;
    const d = { x: to[0] / dist, y: to[1] / dist, z: to[2] / dist };
    const hit = this.host.world.castRay(new RAPIER.Ray({ x: c[0], y: c[1], z: c[2] }, d), dist - 1, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (x) => {
      if (this.host.passes(x) || x.handle === own) return false;
      // Movable things don't shelter what is behind them.
      const b = x.parent();
      if (b && !b.isFixed() && !b.isKinematic()) return false;
      return player ? this.host.ownerOf(x.handle) !== 'player' : true;
    });
    return !hit;
  }

  private cast(from: V3, d: V3, range: number, exclude: number | null): { point: V3; normal: V3; collider: RAPIER.Collider } | null {
    const hit = this.host.world.castRayAndGetNormal(new RAPIER.Ray({ x: from[0], y: from[1], z: from[2] }, { x: d[0], y: d[1], z: d[2] }), range, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (x) => x.handle !== exclude && !this.host.passes(x));
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return { point: [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t], normal: [hit.normal.x, hit.normal.y, hit.normal.z], collider: hit.collider };
  }

  private push(c: RAPIER.Collider, at: V3, impulse: V3): void {
    const b = c.parent();
    if (!b?.isDynamic()) return;
    // (As for blasts: a 10 kg crate takes on about the weapon's push in speed.)
    b.applyImpulseAtPoint({ x: impulse[0] * 10, y: impulse[1] * 10, z: impulse[2] * 10 }, { x: at[0], y: at[1], z: at[2] }, true);
  }
}
