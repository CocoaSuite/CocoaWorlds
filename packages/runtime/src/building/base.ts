/**
 * The base, blueprint style (as Lumber Tycoon 2): blueprints placed on the build grid, filled by props of their
 * material touching them, finished pieces that block and can be knocked down, doors that open. No physics and no
 * drawing: the game world is the `BaseHost` (items, the ground, blockers, props, events) and whoever draws reads
 * `parts()`.
 */
import type { GameEvent } from '../events';
import type { BaseConfig, PartDef, PieceDef } from './defs';
import { nearestSpot, parseSpot, spotKey, spotMiddle, spotToWorld, spotYaw, type Spot } from './grid';

type V3 = [number, number, number];

/** A fixed box turned about up: a finished piece's blocker, or the space a blueprint takes props in. */
export interface BlockerBox {
  center: V3;
  half: V3;
  yaw: number;
  /** The site it belongs to. */
  site: string;
}

export interface BaseHost {
  time(): number;
  itemCount(name: string): number;
  giveItem(name: string, n: number): void;
  selectedItem(): string;
  /** The ground's height under (x, z), looking down from `fromY`; finished pieces count as ground (null: nothing there). */
  groundAt(x: number, z: number, fromY: number): number | null;
  setBlocker(key: string, box: BlockerBox | null): void;
  /** Props (their ids) of material `tag` (named after it or tagged with it) that touch the box, loose or carried. */
  propsIn(box: BlockerBox, tag: string): string[];
  /** Take a prop out of the game: it went into a finished piece. */
  consume(id: string): void;
  emit(e: GameEvent): void;
  playSound(sound: string, at: V3, volume: number, range: number): void;
}

/** A piece on the grid: a blueprint being filled, or finished. */
export interface Site {
  id: string;
  def: PieceDef;
  spot: Spot;
  /** Ground height at the spot's middle. */
  y: number;
  /** Props in it now (def.count: finished). */
  filled: number;
  /** Finished: health left. */
  health: number;
  open: boolean;
}

export interface SiteSave {
  id: string;
  piece: string;
  spot: string;
  y: number;
  filled: number;
  health: number;
  open: boolean;
}
/** Saved base of one scene. */
export interface BaseSave {
  v: 2;
  sites: SiteSave[];
  next: number;
}

/** What the HUD shows for the piece aimed at (icon: flat vector, by name). */
export interface BuildPrompt {
  site: string;
  icon: string;
  /** The piece and how far along it is ('Wood wall · 50%'). */
  title: string;
  /** What E does ('' : nothing). */
  label: string;
  /** 0…1: a blueprint's completion, or a damaged piece's health (null: nothing to show). */
  progress: number | null;
  /** What's still needed ('' : nothing). */
  missing: string;
}

/** One drawn box of a piece. */
export interface DrawnPart {
  key: string;
  site: string;
  center: V3;
  size: V3;
  yaw: number;
  color: string;
  material: string;
  ghost: boolean;
}

/** Where E is pointed: a site, and how far. */
export interface BaseAim {
  site: string;
  distance: number;
}

export interface Placement {
  piece: string;
  spot: Spot;
  y: number;
  valid: boolean;
}

const deg = Math.PI / 180;
/** Pieces closer in height than this share a spot (u). */
const SAME_LEVEL = 8;

export class BaseSystem {
  private sites = new Map<string, Site>();
  private blockers = new Map<string, string[]>();
  private next = 1;
  private lookIn = 0;
  /** Props in a blueprint (not yet used up): prop → site. */
  private claims = new Map<string, string>();
  /** The blueprint E is held on, and for how long. */
  private removing: { site: string; t: number } | null = null;
  /** Goes up whenever something drawn changes (for whoever draws). */
  version = 0;
  /** The ghost a blueprint in hand would place, if aimed at the ground. */
  preview: Placement | null = null;

  constructor(
    readonly pieces: Map<string, PieceDef>,
    readonly config: BaseConfig,
    private host: BaseHost,
  ) {}

  // ── Sites ──

  site(id: string): Site | undefined {
    return this.sites.get(id);
  }

  allSites(): Site[] {
    return [...this.sites.values()];
  }

  built(s: Site): boolean {
    return s.filled >= s.def.count;
  }

  /** 0…1 of the way to finished. */
  fraction(s: Site): number {
    return Math.min(1, s.filled / s.def.count);
  }

  /** The piece a blueprint item places. */
  pieceForPlan(item: string): PieceDef | null {
    if (!item) return null;
    for (const d of this.pieces.values()) if (d.blueprint === item) return d;
    return null;
  }

  /** A site already on this spot at about this height. */
  private taken(spot: Spot, y: number): boolean {
    const key = spotKey(spot);
    for (const s of this.sites.values()) if (spotKey(s.spot) === key && Math.abs(s.y - y) < SAME_LEVEL) return true;
    return false;
  }

  /** Where the blueprint in hand would go, aiming at point `p` (null: no blueprint in hand or nothing aimed at). */
  aimPlacement(p: V3 | null): Placement | null {
    const def = this.pieceForPlan(this.host.selectedItem());
    const was = this.preview;
    if (!def || !p) this.preview = null;
    else {
      const g = this.config.grid;
      const spot = nearestSpot(def.snap, p[0], p[2], g);
      const [mx, mz] = spotMiddle(spot, g);
      const y = this.host.groundAt(mx, mz, p[1] + 16) ?? p[1];
      this.preview = { piece: def.id, spot, y, valid: !this.taken(spot, y) };
    }
    if (JSON.stringify(was) !== JSON.stringify(this.preview)) this.version++;
    return this.preview;
  }

  /** Place the previewed blueprint (its id, or null when it can't go there). */
  placePreview(): string | null {
    const p = this.preview;
    if (!p?.valid) return null;
    const def = this.pieces.get(p.piece)!;
    if (def.consumeBlueprint) {
      if (this.host.itemCount(def.blueprint) <= 0) return null;
      this.host.giveItem(def.blueprint, -1);
    }
    const id = this.add(def, p.spot, p.y);
    this.preview = null;
    this.host.emit({ type: 'base.placed', site: id, piece: def.id, time: this.host.time() });
    return id;
  }

  /** A new blueprint (`filled`: finished already, for scripts and loading). */
  add(def: PieceDef, spot: Spot, y: number, id = `site${this.next++}`, filled = 0): string {
    const s: Site = { id, def, spot, y, filled: Math.max(0, Math.min(def.count, filled)), health: def.health, open: false };
    this.sites.set(id, s);
    this.changed(s);
    return id;
  }

  /** Take a piece away (nothing is given back). */
  remove(id: string): void {
    const s = this.sites.get(id);
    if (!s) return;
    for (const k of this.blockers.get(id) ?? []) this.host.setBlocker(k, null);
    this.blockers.delete(id);
    this.sites.delete(id);
    if (this.removing?.site === id) this.removing = null;
    for (const [p, site] of this.claims) if (site === id) this.claims.delete(p);
    this.version++;
  }

  /**
   * A blueprint now holds `n` props. Short of its count they stay where they are (taken out again, it goes back
   * down); at its count they are all used up together and it is finished.
   */
  private setFilled(s: Site, props: string[]): void {
    const n = Math.min(props.length, s.def.count);
    if (n === s.filled) return;
    const t = this.host.time();
    if (n > s.filled && s.def.sounds.add) this.host.playSound(s.def.sounds.add, this.middle(s), 0.8, 600);
    s.filled = n;
    this.host.emit({ type: 'base.progress', site: s.id, piece: s.def.id, filled: n, count: s.def.count, time: t });
    if (this.built(s)) {
      for (const p of props) {
        this.host.consume(p);
        this.claims.delete(p);
      }
      s.health = s.def.health;
      this.host.emit({ type: 'base.built', site: s.id, piece: s.def.id, time: t });
      if (s.def.sounds.built) this.host.playSound(s.def.sounds.built, this.middle(s), 1, 900);
    }
    this.changed(s);
  }

  /** A hit on a finished piece (a crowbar, a bullet, a blast): at no health left it comes down and is gone. */
  damage(id: string, amount: number): void {
    const s = this.sites.get(id);
    if (!s || !this.built(s) || !(amount > 0)) return;
    s.health = Math.max(0, s.health - amount);
    this.version++;
    if (s.health > 0) return;
    const at = this.middle(s);
    this.remove(id);
    this.host.emit({ type: 'base.broken', site: id, piece: s.def.id, time: this.host.time() });
    if (s.def.sounds.broken) this.host.playSound(s.def.sounds.broken, at, 1, 900);
  }

  // ── Using ──

  /** The piece a ray from the eye meets first within reach (blueprints too: they don't block). */
  aim(eye: V3, dir: V3, reach: number): BaseAim | null {
    let best: BaseAim | null = null;
    for (const s of this.sites.values()) {
      for (const d of this.siteParts(s)) {
        const t = rayBox(eye, dir, d.center, d.size.map((v) => v / 2 + 2) as V3, d.yaw);
        if (t !== null && t <= reach && (!best || t < best.distance)) best = { site: s.id, distance: t };
      }
    }
    return best;
  }

  /** E tapped at a piece: a finished door opens or shuts (true: it did something). */
  press(aim: BaseAim): boolean {
    const s = this.sites.get(aim.site);
    if (!s || !this.built(s) || !s.def.opens) return false;
    s.open = !s.open;
    this.changed(s);
    this.host.emit({ type: 'base.door', site: s.id, open: s.open, time: this.host.time() });
    if (s.def.sounds.door) this.host.playSound(s.def.sounds.door, this.middle(s), 0.9, 700);
    return true;
  }

  /** Each step while E is (or isn't) held: held long enough on a blueprint, it is removed. */
  hold(aim: BaseAim | null, down: boolean, dt: number): void {
    const s = aim && down ? this.sites.get(aim.site) : undefined;
    if (!s || this.built(s)) {
      this.removing = null;
      return;
    }
    if (this.removing?.site !== s.id) this.removing = { site: s.id, t: 0 };
    this.removing.t += dt;
    if (this.removing.t < this.config.removeHold) return;
    this.remove(s.id);
    this.host.emit({ type: 'base.removed', site: s.id, piece: s.def.id, time: this.host.time() });
  }

  /** What the HUD shows for the piece aimed at. */
  prompt(aim: BaseAim | null): BuildPrompt | null {
    const s = aim ? this.sites.get(aim.site) : undefined;
    if (!s) return null;
    const d = s.def;
    if (!this.built(s)) {
      const r = this.removing?.site === s.id ? this.removing.t / this.config.removeHold : 0;
      return {
        site: s.id,
        icon: 'place',
        title: `${d.label} · ${Math.floor(this.fraction(s) * 100)}%`,
        label: r > 0 ? 'Removing…' : 'Hold to remove',
        progress: r > 0 ? Math.min(1, r) : this.fraction(s),
        missing: `${d.count - s.filled} more ${d.materialLabel.toLowerCase()}`,
      };
    }
    const hurt = s.health < d.health ? s.health / d.health : null;
    if (d.opens) return { site: s.id, icon: s.open ? 'close' : 'open', title: d.label, label: s.open ? 'Close' : 'Open', progress: hurt, missing: '' };
    return hurt === null ? null : { site: s.id, icon: 'hammer', title: d.label, label: '', progress: hurt, missing: '' };
  }

  /**
   * Every `every` seconds: which props are in which blueprint. A prop counts for one blueprint only: the one it
   * is already in while it still touches it, else the oldest one it touches that has room. Props past a
   * blueprint's count aren't its own, so the next blueprint they touch can have them.
   */
  tick(dt: number): void {
    this.lookIn -= dt;
    if (this.lookIn > 0) return;
    this.lookIn = this.config.every;
    const open = [...this.sites.values()].filter((s) => !this.built(s));
    const touching = new Map(open.map((s) => [s.id, this.host.propsIn(this.space(s), s.def.material)]));
    const claims = new Map<string, string>();
    const held = new Map<string, string[]>(open.map((s) => [s.id, []]));
    // (Kept: still touching the blueprint it was in.)
    for (const [prop, site] of this.claims)
      if (touching.get(site)?.includes(prop)) {
        claims.set(prop, site);
        held.get(site)!.push(prop);
      }
    for (const s of open) {
      const mine = held.get(s.id)!;
      for (const prop of touching.get(s.id)!) {
        if (mine.length >= s.def.count) break;
        if (claims.has(prop)) continue;
        claims.set(prop, s.id);
        mine.push(prop);
      }
    }
    this.claims = claims;
    for (const s of open) this.setFilled(s, held.get(s.id)!);
  }

  // ── Shapes ──

  private middle(s: Site): V3 {
    const [x, z] = spotMiddle(s.spot, this.config.grid);
    return [x, s.y + 48, z];
  }

  /** The space a blueprint takes props in: round all its boxes, a little bigger. */
  space(s: Site): BlockerBox {
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of s.def.mesh.parts)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p.at[k]! - p.size[k]! / 2);
        hi[k] = Math.max(hi[k]!, p.at[k]! + p.size[k]! / 2);
      }
    const e = this.config.touch;
    const [x, z] = spotToWorld(s.spot, this.config.grid, (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2);
    return { center: [x, s.y + (lo[1] + hi[1]) / 2, z], half: [(hi[0] - lo[0]) / 2 + e, (hi[1] - lo[1]) / 2 + e, (hi[2] - lo[2]) / 2 + e], yaw: spotYaw(s.spot), site: s.id };
  }

  private changed(s: Site): void {
    this.version++;
    this.syncBlockers(s);
  }

  /** Finished pieces block; blueprints don't (props go into them). */
  private syncBlockers(s: Site): void {
    const old = new Set(this.blockers.get(s.id) ?? []);
    const now: string[] = [];
    if (this.built(s))
      s.def.mesh.parts.forEach((p) => {
        if (!p.solid || (p.swing && s.open)) return;
        const d = this.pose(s, p, false);
        this.host.setBlocker(d.key, { center: d.center, half: [d.size[0] / 2, d.size[1] / 2, d.size[2] / 2], yaw: d.yaw, site: s.id });
        now.push(d.key);
        old.delete(d.key);
      });
    for (const k of old) this.host.setBlocker(k, null);
    this.blockers.set(s.id, now);
  }

  private pose(s: Site, p: PartDef, ghost: boolean): DrawnPart {
    const g = this.config.grid;
    let [lx, ly, lz] = p.at;
    let yaw = spotYaw(s.spot);
    if (p.swing && s.open) {
      const a = p.swing.angle * deg;
      const [hx, hz] = p.swing.hinge;
      const dx = lx - hx, dz = lz - hz;
      lx = hx + dx * Math.cos(a) + dz * Math.sin(a);
      lz = hz - dx * Math.sin(a) + dz * Math.cos(a);
      yaw += a;
    }
    const [x, z] = spotToWorld(s.spot, g, lx, lz);
    return { key: `${s.id}:${p.id}`, site: s.id, center: [x, s.y + ly, z], size: [...p.size], yaw, color: ghost ? this.config.ghost.color : p.color, material: ghost ? '' : p.material, ghost };
  }

  /** A site's boxes as drawn now: solid once finished, the blueprint look before. */
  private siteParts(s: Site): DrawnPart[] {
    const ghost = !this.built(s);
    return s.def.mesh.parts.map((p) => this.pose(s, p, ghost));
  }

  /** Everything to draw: every piece, and the placement preview. */
  parts(): DrawnPart[] {
    const out: DrawnPart[] = [];
    for (const s of this.sites.values()) out.push(...this.siteParts(s));
    const p = this.preview;
    const def = p && this.pieces.get(p.piece);
    if (p && def) {
      const ghost: Site = { id: 'preview', def, spot: p.spot, y: p.y, filled: 0, health: def.health, open: false };
      for (const d of this.siteParts(ghost)) out.push(p.valid ? d : { ...d, color: this.config.ghost.invalid });
    }
    return out;
  }

  // ── Saving ──

  save(): BaseSave {
    return {
      v: 2,
      next: this.next,
      sites: [...this.sites.values()].map((s) => ({ id: s.id, piece: s.def.id, spot: spotKey(s.spot), y: s.y, filled: s.filled, health: s.health, open: s.open })),
    };
  }

  load(save: unknown): void {
    const b = save as Partial<BaseSave> | null;
    // (Bases saved by the old build-site system are left behind.)
    if (!b || b.v !== 2 || !Array.isArray(b.sites)) return;
    for (const id of [...this.sites.keys()]) this.remove(id);
    for (const r of b.sites) {
      const def = this.pieces.get(String(r?.piece));
      const spot = parseSpot(String(r?.spot));
      const y = Number(r?.y) || 0;
      if (!def || !spot || spot.kind !== def.snap || this.taken(spot, y)) continue;
      // (Unfinished: empty until the props lying in it are found again.)
      const done = Math.round(Number(r.filled) || 0) >= def.count;
      const id = this.add(def, spot, y, String(r.id), done ? def.count : 0);
      const s = this.sites.get(id)!;
      s.health = Math.max(1, Math.min(def.health, Number(r.health) || def.health));
      s.open = r.open === true;
      this.changed(s);
    }
    this.next = Math.max(this.next, Math.round(Number(b.next) || 1));
    this.version++;
  }
}

/** Where a ray meets a box turned about up (null: it misses). */
function rayBox(o: V3, d: V3, c: V3, h: V3, yaw: number): number | null {
  // Into the box's own frame (undo its turn about up).
  const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
  const rx = o[0] - c[0], rz = o[2] - c[2];
  const ox = rx * cs + rz * sn, oz = -rx * sn + rz * cs, oy = o[1] - c[1];
  const dx = d[0] * cs + d[2] * sn, dz = -d[0] * sn + d[2] * cs, dy = d[1];
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, v, e] of [[ox, dx, h[0]], [oy, dy, h[1]], [oz, dz, h[2]]] as [number, number, number][]) {
    if (Math.abs(v) < 1e-9) {
      if (p < -e || p > e) return null;
      continue;
    }
    let a = (-e - p) / v, b = (e - p) / v;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t1 < 0 ? null : Math.max(0, t0);
}
