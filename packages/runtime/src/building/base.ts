/**
 * The base, blueprint style (as Lumber Tycoon 2): blueprints picked from a menu of the ones owned, placed on the
 * build grid (on the ground, on and beside other pieces, turned with R and T), filled by props of their material
 * lying in them, finished pieces that block and can be knocked down, doors that open. No physics and no drawing:
 * the game world is the `BaseHost` (items, rays, blockers, props, events) and whoever draws reads `parts()` and
 * `tags()`.
 */
import type { GameEvent } from '../events';
import type { BaseConfig, PartDef, PieceDef } from './defs';
import { normTurn, overlapShare, rayAabb, turn, turnedSize, type Turn } from './grid';

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
  /** The world (not blueprints) a ray from the eye meets first: how far, and the face's normal (null: nothing in reach). */
  castRay(from: V3, dir: V3, reach: number): { distance: number; normal: V3 } | null;
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
  /** Its box's lowest corner (world). */
  min: V3;
  turn: Turn;
  /** Props in it now (def.count: finished). */
  filled: number;
  /** Finished: health left. */
  health: number;
  open: boolean;
  /** How far its swinging parts are open (0 shut … 1 open), moving smoothly towards `open`. */
  swing: number;
}

export interface SiteSave {
  id: string;
  piece: string;
  min: V3;
  yaw: number;
  tilt: number;
  filled: number;
  health: number;
  open: boolean;
}
/** Saved base of one scene. */
export interface BaseSave {
  v: 3;
  sites: SiteSave[];
  next: number;
}

/** What the HUD shows for the piece aimed at (icon: flat vector, by name). */
export interface BuildPrompt {
  site: string;
  icon: string;
  /** The piece and how far along it is ('Wood wall · 50%'). */
  title: string;
  /** What E (or a click, placing) does ('' : nothing). */
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
  /** How see-through a ghost is (1: solid). */
  opacity: number;
}

/** The % over an unfinished blueprint. */
export interface BlueprintTag {
  site: string;
  at: V3;
  percent: number;
}

/** A blueprint the player owns, for the menu. */
export interface BlueprintCard {
  piece: string;
  label: string;
  category: string;
  icon: string;
  /** How many (for blueprints placing uses up; else at least 1). */
  count: number;
  material: string;
  needs: number;
  /** Its boxes, for drawing a card picture. */
  size: V3;
  parts: { at: V3; size: V3; color: string }[];
}

/** Where E is pointed: a site, and how far. */
export interface BaseAim {
  site: string;
  distance: number;
}

export interface Placement {
  piece: string;
  min: V3;
  turn: Turn;
  valid: boolean;
}

const deg = Math.PI / 180;
/** Pieces overlapping more than this share of the smaller can't both be there (walls meeting at a corner can). */
const OVERLAP = 0.2;

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
  /** The blueprint menu is open. */
  menuOpen = false;
  /** The piece being placed (picked from the menu), and how it is turned. */
  placing: string | null = null;
  placingTurn: Turn = { yaw: 0, tilt: 0 };
  /** Where the piece being placed would go, if aimed at something. */
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

  /** A site's box size (turned). */
  sizeOf(s: { def: PieceDef; turn: Turn }): V3 {
    return turnedSize(s.def.size, s.turn);
  }

  /** The piece a blueprint item stands for. */
  pieceForBlueprint(item: string): PieceDef | null {
    if (!item) return null;
    for (const d of this.pieces.values()) if (d.blueprint === item) return d;
    return null;
  }

  /** A piece's boxes (shut) as world boxes (min, size): what it really takes up, so a door fits in a frame's gap. */
  private boxes(def: PieceDef, min: V3, t: Turn): [V3, V3][] {
    const ghost: Site = { id: '', def, min, turn: t, filled: 0, health: 1, open: false, swing: 0 };
    return def.mesh.parts.map((p) => {
      const d = this.pose(ghost, p, 'solid');
      const odd = Math.round(d.yaw / (Math.PI / 2)) % 2 !== 0;
      const size: V3 = odd ? [d.size[2], d.size[1], d.size[0]] : [...d.size];
      return [[d.center[0] - size[0] / 2, d.center[1] - size[1] / 2, d.center[2] - size[2] / 2], size];
    });
  }

  /** Whether something already takes up (most of) the space a piece would. */
  private blocked(def: PieceDef, min: V3, t: Turn): boolean {
    const mine = this.boxes(def, min, t);
    const vol = (bs: [V3, V3][]) => bs.reduce((a, [, z]) => a + z[0] * z[1] * z[2], 0);
    const size = turnedSize(def.size, t);
    for (const s of this.sites.values()) {
      if (!overlapShare(min, size, s.min, this.sizeOf(s))) continue;
      const theirs = this.boxes(s.def, s.min, s.turn);
      let both = 0;
      for (const [am, as] of mine) for (const [bm, bs] of theirs) both += overlapShare(am, as, bm, bs) * Math.min(as[0] * as[1] * as[2], bs[0] * bs[1] * bs[2]);
      if (both > OVERLAP * Math.max(1e-6, Math.min(vol(mine), vol(theirs)))) return true;
    }
    return false;
  }

  /** Where a piece goes in a free socket of the site aimed at (null: none for it). */
  private socketFor(def: PieceDef, on: Site): { min: V3; turn: Turn } | null {
    if (!def.fits) return null;
    for (const k of on.def.sockets) {
      if (k.fits !== def.fits) continue;
      const t = { ...on.turn };
      const c = this.middle(on), z0 = on.def.size;
      const off = turn([k.at[0] + def.size[0] / 2 - z0[0] / 2, k.at[1] + def.size[1] / 2 - z0[1] / 2, k.at[2] + def.size[2] / 2 - z0[2] / 2], t);
      const z = turnedSize(def.size, t);
      const min: V3 = [c[0] + off[0] - z[0] / 2, c[1] + off[1] - z[1] / 2, c[2] + off[2] - z[2] / 2];
      if (!this.blocked(def, min, t)) return { min, turn: t };
    }
    return null;
  }

  /** A new blueprint (`filled`: finished already, for scripts and loading). */
  add(def: PieceDef, min: V3, t: Partial<Turn> = {}, id = `site${this.next++}`, filled = 0): string {
    const s: Site = { id, def, min: [...min], turn: normTurn(t), filled: Math.max(0, Math.min(def.count, filled)), health: def.health, open: false, swing: 0 };
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

  // ── The menu and placing ──

  /** The blueprints the player owns. */
  owned(): BlueprintCard[] {
    const out: BlueprintCard[] = [];
    for (const d of this.pieces.values()) {
      const n = this.host.itemCount(d.blueprint);
      if (n <= 0) continue;
      out.push({ piece: d.id, label: d.label, category: d.category, icon: d.icon, count: n, material: d.materialLabel, needs: d.count, size: [...d.size], parts: d.mesh.parts.map((p) => ({ at: [...p.at], size: [...p.size], color: p.color })) });
    }
    return out;
  }

  setMenu(open: boolean): void {
    if (this.menuOpen === open) return;
    this.menuOpen = open;
    this.version++;
  }

  /** Start placing an owned blueprint (false: not owned). */
  startPlacing(piece: string): boolean {
    const d = this.pieces.get(piece);
    if (!d || this.host.itemCount(d.blueprint) <= 0) return false;
    if (this.placing !== piece) this.placingTurn = { yaw: 0, tilt: 0 };
    this.placing = piece;
    this.setMenu(false);
    this.version++;
    return true;
  }

  stopPlacing(): void {
    if (!this.placing) return;
    this.placing = null;
    this.preview = null;
    this.version++;
  }

  /** R: a quarter turn about up. */
  rotate(): void {
    if (!this.placing) return;
    this.placingTurn = { ...this.placingTurn, yaw: (this.placingTurn.yaw + 1) % 4 };
    this.version++;
  }

  /** T: tip it over a quarter (pieces that turn). */
  tip(): void {
    const d = this.placing ? this.pieces.get(this.placing) : null;
    if (!d?.turns) return;
    this.placingTurn = { ...this.placingTurn, tilt: (this.placingTurn.tilt + 1) % 4 };
    this.version++;
  }

  /**
   * Where the piece being placed goes, aimed from the eye: against the face aimed at (the ground, a wall, a
   * blueprint's top or side), lined up on the grid along that face, flush with it across.
   */
  aimPlacement(eye: V3 | null, dir: V3 | null): Placement | null {
    const def = this.placing ? this.pieces.get(this.placing) : null;
    const was = JSON.stringify(this.preview);
    this.preview = null;
    if (def && eye && dir) {
      const reach = this.config.placeReach;
      let hit = this.host.castRay(eye, dir, reach);
      let on: Site | null = null;
      for (const s of this.sites.values()) {
        const h = rayAabb(eye, dir, s.min, this.sizeOf(s));
        if (h && h.distance <= reach && (!hit || h.distance <= hit.distance + 0.5)) {
          hit = h;
          on = s;
        }
      }
      const socket = on ? this.socketFor(def, on) : null;
      if (socket) this.preview = { piece: def.id, min: socket.min, turn: socket.turn, valid: true };
      else if (hit) {
        const p: V3 = [eye[0] + dir[0] * hit.distance, eye[1] + dir[1] * hit.distance, eye[2] + dir[2] * hit.distance];
        const t = this.placingTurn;
        const size = turnedSize(def.size, t);
        const n = hit.normal;
        const k = [0, 1, 2].reduce((a, b) => (Math.abs(n[b]!) > Math.abs(n[a]!) ? b : a), 0);
        const g = this.config.grid;
        const min: V3 = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
          if (i === k) min[i] = n[i]! > 0 ? p[i]! : p[i]! - size[i]!;
          // (Up and down beside a piece: on its levels; elsewhere on the world grid.)
          else if (i === 1) {
            const base = on ? on.min[1] : 0;
            min[i] = base + Math.round((p[1] - size[1] / 2 - base) / g) * g;
          } else min[i] = Math.round((p[i]! - size[i]! / 2) / g) * g;
        }
        this.preview = { piece: def.id, min, turn: { ...t }, valid: !this.blocked(def, min, t) };
      }
    }
    if (was !== JSON.stringify(this.preview)) this.version++;
    return this.preview;
  }

  /** Place the previewed blueprint (its id, or null when it can't go there). Placing goes on until stopped. */
  placePreview(): string | null {
    const p = this.preview;
    if (!p?.valid) return null;
    const def = this.pieces.get(p.piece)!;
    if (this.host.itemCount(def.blueprint) <= 0) {
      this.stopPlacing();
      return null;
    }
    if (def.consumeBlueprint) this.host.giveItem(def.blueprint, -1);
    const id = this.add(def, p.min, p.turn);
    this.preview = { ...p, valid: false };
    this.host.emit({ type: 'base.placed', site: id, piece: def.id, time: this.host.time() });
    if (this.host.itemCount(def.blueprint) <= 0) this.stopPlacing();
    return id;
  }

  // ── Filling ──

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

  /**
   * Every `every` seconds: which props are in which blueprint. A prop counts for one blueprint only: the one it
   * is already in while it still touches it, else the oldest one it touches that has room. Props past a
   * blueprint's count aren't its own, so the next blueprint they touch can have them.
   */
  tick(dt: number): void {
    // Doors swing smoothly; a door blocks only while shut.
    for (const s of this.sites.values()) {
      const to = s.open ? 1 : 0;
      if (s.swing === to) continue;
      const was = s.swing;
      const step = s.def.openTime > 0 ? dt / s.def.openTime : 1;
      s.swing = to > s.swing ? Math.min(1, s.swing + step) : Math.max(0, s.swing - step);
      this.version++;
      if (was === 0 || s.swing === 0) this.syncBlockers(s);
    }
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
    this.version++;
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

  /** What the HUD shows for the piece aimed at, or the one being placed. */
  prompt(aim: BaseAim | null): BuildPrompt | null {
    const pv = this.placing ? this.pieces.get(this.placing) : null;
    if (pv) {
      const ok = this.preview?.valid !== false;
      return { site: '', icon: 'place', title: pv.label, label: ok ? 'Place' : 'Something is in the way', progress: null, missing: `${pv.count} ${pv.materialLabel.toLowerCase()}` };
    }
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

  // ── Shapes ──

  private middle(s: { def: PieceDef; turn: Turn; min: V3 }): V3 {
    const z = this.sizeOf(s);
    return [s.min[0] + z[0] / 2, s.min[1] + z[1] / 2, s.min[2] + z[2] / 2];
  }

  /** The space a blueprint takes props in: its box, a little bigger. */
  space(s: Site): BlockerBox {
    const z = this.sizeOf(s), e = this.config.touch;
    return { center: this.middle(s), half: [z[0] / 2 + e, z[1] / 2 + e, z[2] / 2 + e], yaw: 0, site: s.id };
  }

  /** The % over each unfinished blueprint. */
  tags(): BlueprintTag[] {
    const out: BlueprintTag[] = [];
    for (const s of this.sites.values()) {
      if (this.built(s)) continue;
      const m = this.middle(s);
      out.push({ site: s.id, at: [m[0], s.min[1] + this.sizeOf(s)[1] + 8, m[2]], percent: Math.floor(this.fraction(s) * 100) });
    }
    return out;
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
        if (!p.solid || (p.swing && s.swing > 0)) return;
        const d = this.pose(s, p, 'solid');
        this.host.setBlocker(d.key, { center: d.center, half: [d.size[0] / 2, d.size[1] / 2, d.size[2] / 2], yaw: d.yaw, site: s.id });
        now.push(d.key);
        old.delete(d.key);
      });
    for (const k of old) this.host.setBlocker(k, null);
    this.blockers.set(s.id, now);
  }

  /** A part where it is now, turned with its piece (and swung open). Untipped, a part keeps its size and turns by yaw; tipped, it is a box along the world axes. */
  private pose(s: Site, p: PartDef, look: 'solid' | 'blueprint' | 'placing' | 'invalid'): DrawnPart {
    const size0 = s.def.size;
    let [lx, ly, lz] = p.at;
    let swing = 0;
    if (p.swing && s.swing > 0 && s.turn.tilt === 0) {
      // (Eased: starts and stops gently.)
      const e = s.swing * s.swing * (3 - 2 * s.swing);
      swing = p.swing.angle * deg * e;
      const [hx, hz] = p.swing.hinge;
      const dx = lx - hx, dz = lz - hz;
      lx = hx + dx * Math.cos(swing) + dz * Math.sin(swing);
      lz = hz - dx * Math.sin(swing) + dz * Math.cos(swing);
    }
    const c = this.middle(s);
    const off = turn([lx - size0[0] / 2, ly - size0[1] / 2, lz - size0[2] / 2], s.turn);
    const flat = s.turn.tilt === 0;
    const g = this.config.ghost;
    const color = look === 'solid' ? p.color : look === 'blueprint' ? g.color : look === 'placing' ? g.placing : g.invalid;
    return {
      key: `${s.id}:${p.id}`,
      site: s.id,
      center: [c[0] + off[0], c[1] + off[1], c[2] + off[2]],
      size: flat ? [...p.size] : turnedSize(p.size, s.turn),
      yaw: flat ? s.turn.yaw * (Math.PI / 2) + swing : 0,
      color,
      material: look === 'solid' ? p.material : '',
      ghost: look !== 'solid',
      opacity: look === 'solid' ? 1 : look === 'blueprint' ? g.opacity : g.placingOpacity,
    };
  }

  /** A site's boxes as drawn now: solid once finished, the blueprint look before. */
  private siteParts(s: Site): DrawnPart[] {
    const look = this.built(s) ? 'solid' : 'blueprint';
    return s.def.mesh.parts.map((p) => this.pose(s, p, look));
  }

  /** Everything to draw: every piece, and the ghost being placed. */
  parts(): DrawnPart[] {
    const out: DrawnPart[] = [];
    for (const s of this.sites.values()) out.push(...this.siteParts(s));
    const p = this.preview;
    const def = p && this.pieces.get(p.piece);
    if (p && def) {
      const ghost: Site = { id: 'preview', def, min: p.min, turn: p.turn, filled: 0, health: def.health, open: false, swing: 0 };
      for (const part of def.mesh.parts) out.push(this.pose(ghost, part, p.valid ? 'placing' : 'invalid'));
    }
    return out;
  }

  // ── Saving ──

  save(): BaseSave {
    return {
      v: 3,
      next: this.next,
      sites: [...this.sites.values()].map((s) => ({ id: s.id, piece: s.def.id, min: [...s.min], yaw: s.turn.yaw, tilt: s.turn.tilt, filled: s.filled, health: s.health, open: s.open })),
    };
  }

  load(save: unknown): void {
    const b = save as Partial<BaseSave> | null;
    // (Bases saved by older build systems are left behind.)
    if (!b || b.v !== 3 || !Array.isArray(b.sites)) return;
    for (const id of [...this.sites.keys()]) this.remove(id);
    for (const r of b.sites) {
      const def = this.pieces.get(String(r?.piece));
      const min = Array.isArray(r?.min) && r.min.length === 3 ? (r.min.map((v) => Number(v) || 0) as V3) : null;
      if (!def || !min) continue;
      const t = normTurn({ yaw: r.yaw, tilt: r.tilt });
      if (this.blocked(def, min, t)) continue;
      // (Unfinished: empty until the props lying in it are found again.)
      const done = Math.round(Number(r.filled) || 0) >= def.count;
      const id = this.add(def, min, t, String(r.id), done ? def.count : 0);
      const s = this.sites.get(id)!;
      s.health = Math.max(1, Math.min(def.health, Number(r.health) || def.health));
      s.open = r.open === true;
      s.swing = s.open ? 1 : 0;
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
