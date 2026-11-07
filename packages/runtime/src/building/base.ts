/**
 * The base: build sites and their stages, doors, bolts and shutters, the chair wedge, rooms and sealing, comfort,
 * sleep, and the horror hooks (events and a sample knock). No physics and no drawing: the game world is the
 * `BaseHost` (items, the ground, blockers, events) and whoever draws reads `parts()`.
 *
 * Nothing here has health or collapses, and nothing changes the terrain: posts stand on the ground and "sink"
 * only by moving their mesh down.
 */
import type { GameEvent } from '../events';
import type { BaseConfig, PartDef, PieceDef, StageDef } from './defs';
import { cellKey, edgeCells, edgeFrame, edgeKey, edgeToWorld, findRooms, nearestEdge, parseEdge, type Edge, type EdgeState, type Room } from './rooms';

type V3 = [number, number, number];

/** A fixed box that blocks the player, turned about up. */
export interface BlockerBox {
  center: V3;
  half: V3;
  yaw: number;
}

/** Something that makes a room homely: where it is now, its tags and components, and (lights) whether it's on. */
export interface ComfortSource {
  id: string;
  at: V3;
  tags: string[];
  components: string[];
  light: boolean | null;
}

export interface BaseHost {
  time(): number;
  random(): number;
  itemCount(name: string): number;
  giveItem(name: string, n: number): void;
  selectedItem(): string;
  /** The ground's height under (x, z), looking down from `fromY` (null: nothing there). */
  groundAt(x: number, z: number, fromY: number): number | null;
  setBlocker(key: string, box: BlockerBox | null): void;
  emit(e: GameEvent): void;
  say(text: string): void;
  playSound(sound: string, at: V3, volume: number, range: number): void;
  comfortSources(): ComfortSource[];
  /** Hold a chair still under a door handle (at: where, yaw: facing), or let it go (`nudge`: knocked over a bit). */
  pinChair(id: string, at: V3, yaw: number): void;
  releaseChair(id: string, nudge: boolean): void;
}

/** A build site as it is now. */
export interface Site {
  id: string;
  def: PieceDef;
  edge: Edge;
  /** Ground height at the edge's middle. */
  y: number;
  /** The current stage's index (stages.length: everything done). */
  stage: number;
  /** Steps of the current stage done, and seconds into the current hold/pour step. */
  steps: number;
  partial: number;
  /** A `wait` stage's seconds left. */
  waitLeft: number;
  features: Set<string>;
  open: boolean;
  locked: boolean;
  /** The chair wedged under it. */
  wedged: string | null;
  /** Per part: how far its own ground is from the site's (posts on a slope). */
  partGround: number[];
}

export interface SiteSave {
  id: string;
  piece: string;
  edge: string;
  y: number;
  stage: number;
  steps: number;
  partial: number;
  waitLeft: number;
  features: string[];
  open: boolean;
  locked: boolean;
  wedged: string | null;
}
/** Saved base of one scene. */
export interface BaseSave {
  v: 1;
  sites: SiteSave[];
  next: number;
}

/** What E would do at a build site, for the HUD (icon: flat vector, by name). */
export interface BuildPrompt {
  site: string;
  icon: string;
  label: string;
  /** 0…1 through the current stage (null: nothing to show). */
  progress: number | null;
  /** What's missing to do it ('' : it can be done now). */
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

/** Where E is pointed: a site, the part hit, and how far. */
export interface BaseAim {
  site: string;
  part: string | null;
  distance: number;
}

export interface Placement {
  piece: string;
  edge: Edge;
  y: number;
  valid: boolean;
}

export const ACTION_ICONS: Record<string, string> = { place: 'place', tap: 'hammer', hold: 'hand', pour: 'bucket', wait: 'clock' };

const deg = Math.PI / 180;

export class BaseSystem {
  private sites = new Map<string, Site>();
  private byEdge = new Map<string, string>();
  private blockers = new Map<string, string[]>();
  private next = 1;
  private rooms: Room[] = [];
  private roomOfCell = new Map<string, Room>();
  private roomY = new Map<string, number>();
  private roomsDirty = true;
  private sealedWas = new Map<string, boolean>();
  private comfort = new Map<string, number>();
  private comfortIn = 0;
  private knockIn: number;
  /** Goes up whenever something drawn changes (for whoever draws). */
  version = 0;
  /** The ghost a plan in hand would place, if aimed at the ground. */
  preview: Placement | null = null;

  constructor(
    readonly pieces: Map<string, PieceDef>,
    readonly config: BaseConfig,
    private host: BaseHost,
  ) {
    this.knockIn = config.knock.every;
  }

  // ── Sites ──

  site(id: string): Site | undefined {
    return this.sites.get(id);
  }

  allSites(): Site[] {
    return [...this.sites.values()];
  }

  /** The piece a plan item places. */
  pieceForPlan(item: string): PieceDef | null {
    if (!item) return null;
    for (const d of this.pieces.values()) if (d.blueprint === item) return d;
    return null;
  }

  /** Where the plan in hand would go, aiming at ground point `p` (null: no plan in hand or nothing aimed at). */
  aimPlacement(p: V3 | null): Placement | null {
    const def = this.pieceForPlan(this.host.selectedItem());
    const was = this.preview;
    if (!def || !p) this.preview = null;
    else {
      const edge = nearestEdge(p[0], p[2], this.config.grid);
      const [mx, mz] = edgeToWorld(edge, this.config.grid, this.config.grid / 2, 0);
      const y = this.host.groundAt(mx, mz, p[1] + 64) ?? p[1];
      this.preview = { piece: def.id, edge, y, valid: !this.byEdge.has(edgeKey(edge)) };
    }
    if (JSON.stringify(was) !== JSON.stringify(this.preview)) this.version++;
    return this.preview;
  }

  /** Place the previewed ghost (true if placed). */
  placePreview(): string | null {
    const p = this.preview;
    if (!p?.valid) return null;
    const def = this.pieces.get(p.piece)!;
    if (def.consumeBlueprint) {
      if (this.host.itemCount(def.blueprint) <= 0) return null;
      this.host.giveItem(def.blueprint, -1);
    }
    const id = this.add(def, p.edge, p.y);
    this.preview = null;
    this.host.emit({ type: 'base.placed', site: id, piece: def.id, time: this.host.time() });
    return id;
  }

  /** A new build site (for scripts and loading). */
  add(def: PieceDef, edge: Edge, y: number, id = `site${this.next++}`): string {
    const s: Site = { id, def, edge, y, stage: 0, steps: 0, partial: 0, waitLeft: 0, features: new Set(), open: false, locked: false, wedged: null, partGround: [] };
    this.measureGround(s);
    this.sites.set(id, s);
    this.byEdge.set(edgeKey(edge), id);
    this.enterStage(s);
    this.changed(s);
    return id;
  }

  /** Take a site away (nothing is given back). */
  remove(id: string): void {
    const s = this.sites.get(id);
    if (!s) return;
    if (s.wedged) this.host.releaseChair(s.wedged, false);
    for (const k of this.blockers.get(id) ?? []) this.host.setBlocker(k, null);
    this.blockers.delete(id);
    this.sites.delete(id);
    this.byEdge.delete(edgeKey(s.edge));
    this.roomsDirty = true;
    this.version++;
  }

  private measureGround(s: Site): void {
    const g = this.config.grid;
    s.partGround = s.def.mesh.parts.map((p) => {
      if (!p.ground) return 0;
      const [x, z] = edgeToWorld(s.edge, g, p.at[0], p.at[2]);
      const y = this.host.groundAt(x, z, s.y + 64);
      return y === null ? 0 : y - s.y;
    });
  }

  private stageIndex(s: Site, id: string): number {
    return s.def.stages.findIndex((x) => x.id === id);
  }

  /** The stage being worked on (null: all done). */
  current(s: Site): StageDef | null {
    return s.def.stages[s.stage] ?? null;
  }

  /** The required stages are done: it works (a wall stands, a door opens). */
  built(s: Site): boolean {
    const req = s.def.stages.findIndex((x) => x.optional);
    return s.stage >= (req < 0 ? s.def.stages.length : req);
  }

  /** 0…1 through stage `id` (1 once past it, 0 before it). */
  fraction(s: Site, id: string): number {
    const i = this.stageIndex(s, id);
    if (i < s.stage) return 1;
    if (i > s.stage) return 0;
    const st = s.def.stages[i]!;
    if (st.action === 'wait') return st.duration > 0 ? 1 - s.waitLeft / st.duration : 1;
    const part = (st.action === 'hold' || st.action === 'pour') && st.duration > 0 ? s.partial / st.duration : 0;
    return Math.min(1, (s.steps + part) / st.count);
  }

  private enterStage(s: Site): void {
    s.steps = 0;
    s.partial = 0;
    const st = this.current(s);
    s.waitLeft = st?.action === 'wait' ? st.duration : 0;
  }

  /** What a stage step needs that the player lacks ('' : nothing). */
  private lacking(st: StageDef): string {
    if (st.action === 'wait') return '';
    if (st.tool && this.host.selectedItem() !== st.tool) return `${st.tool} in hand`;
    if (st.item && st.use > 0 && this.host.itemCount(st.item) < st.use && !(st.or && this.host.itemCount(st.or.item) >= st.or.use))
      return st.or ? `${st.use} × ${st.item} or ${st.or.use} × ${st.or.item}` : `${st.use} × ${st.item}`;
    return '';
  }

  private useItems(st: StageDef): void {
    if (!st.item || st.use <= 0) return;
    if (this.host.itemCount(st.item) >= st.use) this.host.giveItem(st.item, -st.use);
    else if (st.or) this.host.giveItem(st.or.item, -st.or.use);
  }

  /** One step of the current stage done. */
  private step(s: Site, at: V3 | null): void {
    const st = this.current(s)!;
    this.useItems(st);
    s.steps++;
    s.partial = 0;
    if (st.sound) this.host.playSound(st.sound, at ?? this.middle(s), 1, 600);
    if (s.steps >= st.count) this.finishStage(s);
    this.changed(s);
  }

  private finishStage(s: Site): void {
    const st = this.current(s)!;
    for (const [item, n] of Object.entries(st.gives)) this.host.giveItem(item, n);
    if (st.adds) s.features.add(st.adds);
    const wasBuilt = this.built(s);
    s.stage++;
    this.enterStage(s);
    const t = this.host.time();
    this.host.emit({ type: 'base.stage', site: s.id, piece: s.def.id, stage: st.id, time: t });
    if (!wasBuilt && this.built(s)) this.host.emit({ type: 'base.built', site: s.id, piece: s.def.id, time: t });
  }

  /** Whether this edge closes a room off now. */
  closed(s: Site): boolean {
    if (!this.built(s)) return false;
    if (s.def.seal.needs.some((f) => !s.features.has(f))) return false;
    return !(s.def.seal.closed && s.open);
  }

  canOpen(s: Site): boolean {
    return !!s.def.opens && s.features.has(s.def.opens);
  }

  canLock(s: Site): boolean {
    return !!s.def.locks && s.features.has(s.def.locks);
  }

  // ── Using sites (E) ──

  /** The site a ray from the eye meets first, within `reach` (parts drawn now, or the ghost's outline). */
  aim(eye: V3, dir: V3, reach: number): BaseAim | null {
    let best: BaseAim | null = null;
    for (const s of this.sites.values()) {
      for (const d of this.siteParts(s, true)) {
        const t = rayBox(eye, dir, d.center, d.size.map((v) => v / 2 + 2) as V3, d.yaw);
        if (t !== null && t <= reach && (!best || t < best.distance)) best = { site: s.id, part: d.key.slice(s.id.length + 1), distance: t };
      }
    }
    return best;
  }

  /** The current stage can be worked on now (its tool is in hand and the items are there). */
  private workable(s: Site): boolean {
    const st = this.current(s);
    return !!st && st.action !== 'wait' && !this.lacking(st) && !(st.optional && this.canOpen(s) && s.open);
  }

  /**
   * E pressed at a site. `chair`: the chair the player holds, if it can be wedged. Returns what happened, for the
   * game world (a chair to drop or to pick back up).
   */
  press(aim: BaseAim, chair: string | null, from: V3): { took: string | null; wedged: boolean } | null {
    const s = this.sites.get(aim.site);
    if (!s) return null;
    const none = { took: null, wedged: false };
    const st = this.current(s);
    // Taps and placing happen on the press; holds and pours while E stays down (see `hold`).
    if (st && (st.action === 'place' || st.action === 'tap') && this.workable(s)) {
      this.step(s, null);
      return none;
    }
    if (st && (st.action === 'hold' || st.action === 'pour') && this.workable(s)) return none;
    if (!this.canOpen(s)) return st && st.action !== 'wait' ? (this.host.say(`Needs ${this.lacking(st)}`), none) : none;
    const t = this.host.time();
    if (chair && !s.open && !s.wedged && s.def.kind === 'door') {
      this.wedge(s, chair, from);
      return { took: null, wedged: true };
    }
    if (s.wedged) {
      const id = s.wedged;
      this.unwedge(s, false);
      return { took: id, wedged: false };
    }
    if (aim.part === 'bolt' && this.canLock(s) && !s.open) {
      s.locked = !s.locked;
      this.host.emit({ type: 'base.lock', site: s.id, locked: s.locked, time: t });
      this.changed(s);
      return none;
    }
    if (s.locked) {
      this.host.say('Bolted.');
      return none;
    }
    s.open = !s.open;
    this.host.emit({ type: 'base.door', site: s.id, open: s.open, time: t });
    this.changed(s);
    return none;
  }

  /** Each step: E held (or not) while aimed at a site; holds and pours move on only while held. */
  hold(aim: BaseAim | null, held: boolean, dt: number): void {
    if (!held || !aim) return;
    const s = this.sites.get(aim.site);
    const st = s && this.current(s);
    if (!s || !st || (st.action !== 'hold' && st.action !== 'pour') || !this.workable(s)) return;
    s.partial += dt;
    if (st.action === 'pour') this.version++;
    if (s.partial >= st.duration) this.step(s, null);
  }

  /** What E would do at the aimed site, for the HUD. */
  prompt(aim: BaseAim | null, chair: string | null): BuildPrompt | null {
    const s = aim && this.sites.get(aim.site);
    if (!s) return null;
    const st = this.current(s);
    const id = s.id;
    if (st && (this.workable(s) || !this.canOpen(s))) {
      const label = st.label || `${st.action} ${st.item || st.tool}`.trim();
      if (st.action === 'wait') return { site: id, icon: st.icon || 'clock', label, progress: this.fraction(s, st.id), missing: '' };
      return { site: id, icon: st.icon || ACTION_ICONS[st.action] || 'hand', label, progress: st.count > 1 || st.action === 'hold' || st.action === 'pour' ? this.fraction(s, st.id) : null, missing: this.lacking(st) };
    }
    if (!this.canOpen(s)) return null;
    if (chair && !s.open && !s.wedged && s.def.kind === 'door') return { site: id, icon: 'chair', label: this.config.wedge.prompt, progress: null, missing: '' };
    if (s.wedged) return { site: id, icon: 'chair', label: 'Pull the chair away', progress: null, missing: '' };
    if (aim.part === 'bolt' && this.canLock(s) && !s.open) return { site: id, icon: 'bolt', label: s.locked ? 'Slide the bolt back' : 'Slide the bolt', progress: null, missing: '' };
    if (s.locked) return { site: id, icon: 'bolt', label: 'Bolted', progress: null, missing: '' };
    return { site: id, icon: s.open ? 'close' : 'open', label: s.open ? 'Close' : 'Open', progress: null, missing: '' };
  }

  // ── The chair wedge ──

  private wedgeSpot(s: Site, from: V3): { at: V3; yaw: number } {
    const g = this.config.grid;
    const [mx, mz] = edgeToWorld(s.edge, g, g * 0.72, 0);
    // On the player's side of the door, a little in from the handle.
    const [nx, nz] = s.edge.axis === 'x' ? [0, 1] : [-1, 0];
    const side = Math.sign((from[0] - mx) * nx + (from[2] - mz) * nz) || 1;
    const at: V3 = [mx + nx * side * 18, s.y + 1, mz + nz * side * 18];
    return { at, yaw: Math.atan2(-nx * side, -nz * side) };
  }

  private wedge(s: Site, chair: string, from: V3): void {
    s.wedged = chair;
    const w = this.wedgeSpot(s, from);
    this.host.pinChair(chair, w.at, w.yaw);
    if (this.config.wedge.sound) this.host.playSound(this.config.wedge.sound, w.at, 0.8, 500);
    this.host.emit({ type: 'base.wedge', site: s.id, chair, time: this.host.time() });
    this.changed(s);
  }

  private unwedge(s: Site, nudge: boolean): void {
    const chair = s.wedged;
    if (!chair) return;
    s.wedged = null;
    this.host.releaseChair(chair, nudge);
    this.host.emit({ type: 'base.wedge', site: s.id, chair: null, time: this.host.time() });
    this.changed(s);
  }

  /** On waking: now and then a wedged chair has slipped out (the scare). Returns the doors it happened to. */
  wake(): string[] {
    const out: string[] = [];
    for (const s of this.sites.values()) {
      if (!s.wedged || this.host.random() >= this.config.wedge.unwedgeChance) continue;
      const chair = s.wedged;
      this.unwedge(s, true);
      this.host.emit({ type: 'base.unwedged', site: s.id, chair, time: this.host.time() });
      out.push(s.id);
    }
    return out;
  }

  // ── Rooms, sealing, comfort ──

  private changed(s: Site): void {
    this.version++;
    this.roomsDirty = true;
    this.syncBlockers(s);
  }

  private syncBlockers(s: Site): void {
    const old = new Set(this.blockers.get(s.id) ?? []);
    const now: string[] = [];
    s.def.mesh.parts.forEach((p, i) => {
      if (!p.solid || !this.shown(s, p)) return;
      if (p.swing && s.open) return;
      const d = this.pose(s, p, i, false);
      this.host.setBlocker(d.key, { center: d.center, half: [d.size[0] / 2, d.size[1] / 2, d.size[2] / 2], yaw: d.yaw });
      now.push(d.key);
      old.delete(d.key);
    });
    for (const k of old) this.host.setBlocker(k, null);
    this.blockers.set(s.id, now);
  }

  private updateRooms(): void {
    if (!this.roomsDirty) return;
    this.roomsDirty = false;
    const edges: EdgeState[] = [...this.sites.values()].map((s) => ({ ...s.edge, site: s.id, closed: this.closed(s) }));
    this.rooms = findRooms(edges);
    this.roomOfCell.clear();
    this.roomY.clear();
    for (const r of this.rooms) {
      for (const [x, z] of r.cells) this.roomOfCell.set(cellKey(x, z), r);
      this.roomY.set(r.id, Math.min(...r.sites.map((id) => this.sites.get(id)!.y)));
    }
    const t = this.host.time();
    const seen = new Set<string>();
    for (const r of this.rooms) {
      seen.add(r.id);
      if (this.sealedWas.get(r.id) !== r.sealed) this.host.emit({ type: 'base.sealed', room: r.id, sealed: r.sealed, time: t });
      this.sealedWas.set(r.id, r.sealed);
    }
    for (const id of [...this.sealedWas.keys()])
      if (!seen.has(id)) {
        if (this.sealedWas.get(id)) this.host.emit({ type: 'base.sealed', room: id, sealed: false, time: t });
        this.sealedWas.delete(id);
      }
    this.computeComfort();
  }

  /** Enclosed rooms now (sealed or not), with their openings. */
  roomList(): Room[] {
    this.updateRooms();
    return this.rooms;
  }

  /** The room a point is in (null: outside every room). */
  roomAt(p: { x: number; y: number; z: number } | V3): Room | null {
    this.updateRooms();
    const [x, y, z] = Array.isArray(p) ? p : [p.x, p.y, p.z];
    const g = this.config.grid;
    const r = this.roomOfCell.get(cellKey(Math.floor(x / g), Math.floor(z / g)));
    if (!r) return null;
    const floor = this.roomY.get(r.id) ?? y;
    return y >= floor - 48 && y <= floor + 240 ? r : null;
  }

  /** Openings of a room: its sites that are not closed (unfinished, open doors, open or missing shutters). */
  openings(room: string): { site: string; kind: string; reason: 'unbuilt' | 'open' | 'no-cover' }[] {
    const r = this.roomList().find((x) => x.id === room);
    if (!r) return [];
    return r.openings.map((id) => {
      const s = this.sites.get(id)!;
      const reason = !this.built(s) ? 'unbuilt' : s.def.seal.needs.some((f) => !s.features.has(f)) ? 'no-cover' : 'open';
      return { site: id, kind: s.def.kind, reason };
    });
  }

  /** Hidden comfort of a room, 0…1. */
  comfortOf(room: string): number {
    this.updateRooms();
    return this.comfort.get(room) ?? 0;
  }

  /** Comfort per room. */
  comfortByRoom(): Map<string, number> {
    this.updateRooms();
    return new Map(this.comfort);
  }

  private computeComfort(): void {
    const c = this.config.comfort;
    const score = new Map<string, number>();
    const lights = new Map<string, number>();
    for (const r of this.rooms) {
      let n = r.sealed ? c.sealed : 0;
      for (const id of r.sites) {
        const s = this.sites.get(id)!;
        if (s.wedged) n += c.wedged;
        if (s.locked) n += c.locked;
      }
      score.set(r.id, n);
    }
    for (const src of this.host.comfortSources()) {
      const r = this.roomAt(src.at);
      if (!r) continue;
      let n = 0;
      if (src.light) {
        const k = lights.get(r.id) ?? 0;
        if (k < c.maxLights) n += c.light;
        lights.set(r.id, k + 1);
      }
      for (const t of src.tags) n += c.tags[t] ?? 0;
      for (const k of src.components) n += c.components[k] ?? 0;
      score.set(r.id, (score.get(r.id) ?? 0) + n);
    }
    this.comfort.clear();
    for (const [id, n] of score) this.comfort.set(id, Math.max(0, Math.min(1, n / Math.max(1, c.max))));
  }

  /** Sleep is allowed here: in a room comfortable enough. */
  canSleep(at: V3): { ok: boolean; room: string | null; comfort: number } {
    const r = this.roomAt(at);
    const comfort = r ? this.comfortOf(r.id) : 0;
    return { ok: !!r && comfort * this.config.comfort.max >= this.config.comfort.sleep, room: r?.id ?? null, comfort };
  }

  // ── Time ──

  /** Each step: timers (curing), comfort again now and then, and the knock. */
  tick(dt: number): void {
    for (const s of this.sites.values()) {
      const st = this.current(s);
      if (st?.action !== 'wait') continue;
      s.waitLeft -= dt;
      if (s.waitLeft <= 0) {
        this.finishStage(s);
        this.changed(s);
      }
    }
    this.updateRooms();
    this.comfortIn -= dt;
    if (this.comfortIn <= 0) {
      this.comfortIn = this.config.comfort.every;
      this.computeComfort();
    }
    this.knockIn -= dt;
    if (this.knockIn <= 0) {
      this.knockIn = this.config.knock.every;
      if (this.host.random() < this.config.knock.chance) this.knock();
    }
  }

  // ── Horror hooks ──

  /**
   * A knock (example hook): on a door or window of a room, preferring rooms with an unlocked door or open shutters,
   * and that door or window. Returns the site knocked on, or null when no room has one.
   */
  knock(): string | null {
    const candidates: { room: Room; weight: number; sites: { id: string; weak: boolean }[] }[] = [];
    for (const r of this.roomList()) {
      const sites = r.sites
        .map((id) => this.sites.get(id)!)
        .filter((s) => s.def.kind === 'door' || s.def.kind === 'window')
        .map((s) => ({ id: s.id, weak: (s.def.kind === 'door' && this.built(s) && !s.locked) || (s.def.kind === 'window' && (!this.canOpen(s) || s.open)) }));
      if (!sites.length) continue;
      const doors = sites.filter((x) => x.weak && this.sites.get(x.id)!.def.kind === 'door').length;
      const windows = sites.filter((x) => x.weak && this.sites.get(x.id)!.def.kind === 'window').length;
      candidates.push({ room: r, weight: 1 + 3 * doors + 2 * windows, sites });
    }
    if (!candidates.length) return null;
    let pick = this.host.random() * candidates.reduce((a, c) => a + c.weight, 0);
    const c = candidates.find((x) => (pick -= x.weight) < 0) ?? candidates[candidates.length - 1]!;
    const weak = c.sites.filter((x) => x.weak);
    const from = weak.length ? weak : c.sites;
    const site = from[Math.floor(this.host.random() * from.length) % from.length]!.id;
    const s = this.sites.get(site)!;
    const at = this.outsideOf(s, c.room);
    const k = this.config.knock;
    if (k.sound) this.host.playSound(k.sound, at, k.volume, k.range);
    this.host.emit({ type: 'base.knock', site, room: c.room.id, at, time: this.host.time() });
    return site;
  }

  /** The middle of a site's edge, a little outside the room. */
  private outsideOf(s: Site, room: Room): V3 {
    const g = this.config.grid;
    const [mx, mz] = edgeToWorld(s.edge, g, g / 2, 0);
    const cells = new Set(room.cells.map(([x, z]) => cellKey(x, z)));
    const [a] = edgeCells(s.edge);
    const aInside = cells.has(cellKey(a[0], a[1]));
    // Cell a is on the edge's −Z (axis x) or −X (axis z) side.
    const [nx, nz] = s.edge.axis === 'x' ? [0, 1] : [1, 0];
    const out = aInside ? 1 : -1;
    return [mx + nx * out * 12, s.y + 48, mz + nz * out * 12];
  }

  private middle(s: Site): V3 {
    const g = this.config.grid;
    const [x, z] = edgeToWorld(s.edge, g, g / 2, 0);
    return [x, s.y + 48, z];
  }

  // ── Drawing ──

  private shown(s: Site, p: PartDef): boolean {
    if (p.feature && !s.features.has(p.feature)) return false;
    if (p.until && this.stageIndex(s, p.until) < s.stage) return false;
    if (!p.from) return true;
    const i = this.stageIndex(s, p.from);
    return i < s.stage || (i === s.stage && s.steps >= p.step);
  }

  private pose(s: Site, p: PartDef, i: number, ghost: boolean): DrawnPart {
    const g = this.config.grid;
    let [lx, ly, lz] = p.at;
    const size: V3 = [...p.size];
    ly += s.partGround[i] ?? 0;
    if (p.sink) ly -= p.sink.depth * this.fraction(s, p.sink.stage);
    if (p.fill && !ghost) {
      const f = Math.max(0.02, this.fraction(s, p.fill));
      ly = ly - size[1] / 2 + (size[1] * f) / 2;
      size[1] *= f;
    }
    if (p.slide && s.locked) lx += p.slide;
    let yaw = edgeFrame(s.edge, g).yaw;
    if (p.swing && s.open) {
      const a = p.swing.angle * deg;
      const [hx, hz] = p.swing.hinge;
      const dx = lx - hx, dz = lz - hz;
      lx = hx + dx * Math.cos(a) + dz * Math.sin(a);
      lz = hz - dx * Math.sin(a) + dz * Math.cos(a);
      yaw += a;
    }
    const [x, z] = edgeToWorld(s.edge, g, lx, lz);
    return { key: `${s.id}:${p.id}`, site: s.id, center: [x, s.y + ly, z], size, yaw, color: p.color, material: p.material, ghost };
  }

  /** A site's boxes as drawn now: built parts, and ghosts of what is still to build (`all`: ghosts too). */
  private siteParts(s: Site, all: boolean): DrawnPart[] {
    const out: DrawnPart[] = [];
    s.def.mesh.parts.forEach((p, i) => {
      if (this.shown(s, p)) out.push(this.pose(s, p, i, false));
      else if (all && p.ghost && (!p.feature || s.def.stages.some((st) => st.adds === p.feature && !st.optional)) && !(p.until && this.stageIndex(s, p.until) < s.stage)) out.push(this.pose(s, p, i, true));
    });
    return out;
  }

  /** Everything to draw: every site's parts and ghosts, and the placement preview. */
  parts(): DrawnPart[] {
    const out: DrawnPart[] = [];
    for (const s of this.sites.values()) out.push(...this.siteParts(s, true));
    const p = this.preview;
    const def = p && this.pieces.get(p.piece);
    if (p && def) {
      const ghost: Site = { id: 'preview', def, edge: p.edge, y: p.y, stage: def.stages.length, steps: 0, partial: 0, waitLeft: 0, features: new Set(def.stages.map((s) => s.adds).filter(Boolean)), open: false, locked: false, wedged: null, partGround: [] };
      this.measureGround(ghost);
      for (const d of this.siteParts(ghost, false)) out.push({ ...d, ghost: true, color: p.valid ? d.color : '#c0392b' });
    }
    return out;
  }

  // ── Saving ──

  save(): BaseSave {
    return {
      v: 1,
      next: this.next,
      sites: [...this.sites.values()].map((s) => ({
        id: s.id,
        piece: s.def.id,
        edge: edgeKey(s.edge),
        y: s.y,
        stage: s.stage,
        steps: s.steps,
        partial: s.partial,
        waitLeft: s.waitLeft,
        features: [...s.features],
        open: s.open,
        locked: s.locked,
        wedged: s.wedged,
      })),
    };
  }

  load(save: unknown): void {
    const b = save as Partial<BaseSave> | null;
    if (!b || b.v !== 1 || !Array.isArray(b.sites)) return;
    for (const id of [...this.sites.keys()]) this.remove(id);
    for (const r of b.sites) {
      const def = this.pieces.get(String(r?.piece));
      const edge = parseEdge(String(r?.edge));
      if (!def || !edge || this.byEdge.has(edgeKey(edge))) continue;
      const id = this.add(def, edge, Number(r.y) || 0, String(r.id));
      const s = this.sites.get(id)!;
      s.stage = Math.max(0, Math.min(def.stages.length, Math.round(Number(r.stage) || 0)));
      s.steps = Math.max(0, Math.round(Number(r.steps) || 0));
      s.partial = Math.max(0, Number(r.partial) || 0);
      const st = this.current(s);
      s.waitLeft = st?.action === 'wait' ? Math.max(0, Math.min(st.duration, Number(r.waitLeft) || 0)) : 0;
      s.features = new Set((r.features ?? []).filter((f): f is string => typeof f === 'string'));
      s.open = r.open === true;
      s.locked = r.locked === true;
      s.wedged = null;
      this.changed(s);
      if (typeof r.wedged === 'string' && r.wedged) {
        // (Back under the handle where it was: on the side the room is, or the edge's +side.)
        const room = this.roomList().find((x) => x.sites.includes(id));
        const from = room ? this.insideOf(s, room) : this.middle(s);
        s.wedged = r.wedged;
        const w = this.wedgeSpot(s, from);
        this.host.pinChair(r.wedged, w.at, w.yaw);
      }
    }
    this.next = Math.max(this.next, Math.round(Number(b.next) || 1));
    this.version++;
  }

  private insideOf(s: Site, room: Room): V3 {
    const o = this.outsideOf(s, room);
    const m = this.middle(s);
    return [2 * m[0] - o[0], m[1], 2 * m[2] - o[2]];
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
