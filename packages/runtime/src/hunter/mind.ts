/**
 * The Hunter mind: a priority behaviour tree over what the creature has seen and heard.
 *
 *   ROOT (priority)
 *   1. ENGAGE      while it sees the player: snap round, then attack in reach or chase
 *      CAPTURE     a hiding spot it saw the player get into: open it up
 *   2. INVESTIGATE news worth following: react, go there (or near it), look around, listen, start a search
 *   3. SEARCH      until its time runs out: hiding spots by suspicion, else points round the area, wider each time
 *   4. WANDER      walk somewhere near, stop, now and then an idle move, wait
 *
 * It decides; the creature's body (Npc) walks, turns, attacks and plays animations, one plan per step, so only
 * one task ever drives it. Sight and spot checks run a few times a second, not every step.
 */
import type { NpcData } from '@cocoaworlds/core';
import { endSearch, newBlackboard, type Blackboard } from './blackboard';
import { stepsFor, type Step } from './interactions';
import { Personality, type Beat } from './personality';
import { hunterSettings, type HunterSettings } from './settings';
import { SpotMemory, react, suspicion, type SpotInfo } from './spots';
import { ageBand, better, spreadOf, type Stimulus, type V } from './stimuli';
import { Act, Guard, Priority, Restart, Sequence, Task, type Node, type Status } from './tree';

export interface PlayerSeen {
  feet: V;
  eye: V;
  collider: number;
  hidden?: string | null;
  entering?: boolean;
}

/** The creature's body, as the mind uses it. */
export interface HunterBody {
  readonly id: string;
  readonly data: NpcData;
  readonly radius: number;
  feet: V;
  yaw: number;
  eye(): V;
  /** Sees the player now (sight range, in front, nothing in the way). */
  canSee(p: PlayerSeen): boolean;
  /** Nothing solid between two points. */
  clear(from: V, to: V): boolean;
}

/** What the mind can ask of the world. */
export interface HunterWorld {
  time(): number;
  random(): number;
  player(): PlayerSeen | null;
  route?(from: V, to: V): V[] | null;
  around?(at: V, min: number, max: number): V | null;
  spots?(): SpotInfo[];
  /** Opens a spot up: true if the player was inside (they are pulled out). */
  reveal?(spot: string): boolean;
  /** It makes a move (for scripts: “When a creature …”), at a spot or not. */
  did?(moment: string, spot: string | null): void;
}

/** What the body does this step. */
export interface Plan {
  state: string;
  move: V | null;
  face: V | null;
  /** Of its speed. */
  speed: number;
  run: boolean;
  /** A move to play (a new key restarts it). */
  moment: { name: string; key: number } | null;
  attack: boolean;
}

const flat = (a: V, b: V) => Math.hypot(a.x - b.x, a.z - b.z);

export class Hunter {
  readonly bb: Blackboard = newBlackboard();
  readonly cfg: HunterSettings;
  readonly spots = new SpotMemory();
  readonly look: Personality;
  plan!: Plan;
  now = 0;
  player: PlayerSeen | null = null;
  /** The player's place while seen (the mind's only exact knowledge of it). */
  seenFeet: V | null = null;
  private nextSense = 0;
  private nextSpotScan = 0;
  private justSpotted = false;
  private momentKey = 0;
  private lastIdle = '';
  private root: Node<Hunter>;

  constructor(readonly body: HunterBody, readonly w: HunterWorld) {
    this.cfg = hunterSettings(body.data);
    this.look = new Personality(this.cfg.moves, () => w.random());
    this.root = this.build();
  }

  // ── Senses ──

  /** News from hearing or from the Director: followed up if it matters more than what it is on now. */
  offer(s: Stimulus): void {
    if (this.bb.hasVisual) return;
    const now = this.w.time();
    if (!better(s, this.bb.investigation, now, this.cfg)) return;
    const moved = !this.bb.investigation || flat(this.bb.investigation.at, s.at) > 128;
    this.bb.investigation = { ...s, at: { ...s.at } };
    this.bb.lastStimulusTime = s.time;
    this.bb.stimulusKind = s.kind;
    this.bb.shouldInvestigate = true;
    if (moved || !this.bb.searching) this.bb.investigationKey++;
  }

  /** A sound: heard if close enough (half as far through walls), placed roughly. */
  hear(at: V, range: number, spot: string | null): void {
    const ear = this.body.eye();
    const reach = range * this.cfg.hearing * (this.body.clear(ear, { ...at, y: at.y + 16 }) ? 1 : 0.5);
    const d = Math.hypot(at.x - ear.x, at.z - ear.z);
    if (!(reach > 0) || d > reach) return;
    const now = this.w.time();
    if (spot) this.spots.heard.set(spot, now);
    // (The spot it is checking: its listening takes care of that.)
    if (spot && spot === this.bb.currentSpot) return;
    const off = (d / reach) * 96, a = this.w.random() * Math.PI * 2;
    this.offer({ at: { x: at.x + Math.cos(a) * off, y: at.y, z: at.z + Math.sin(a) * off }, confidence: Math.max(0.2, 1 - d / reach), time: now, kind: 'sound' });
  }

  private sense(): void {
    const p = this.player;
    const bb = this.bb;
    if (this.now >= this.nextSense) {
      this.nextSense = this.now + 0.1;
      const close = !!p && !p.hidden && flat(p.feet, this.body.feet) <= this.cfg.feel + this.body.radius && Math.abs(p.feet.y - this.body.feet.y) < 96;
      const sees = !!p && !p.hidden && (close || this.body.canSee(p));
      if (p?.hidden && p.entering && this.body.canSee(p)) this.spots.witnessed = p.hidden;
      if (sees) {
        if (!bb.hasVisual) this.justSpotted = true;
        bb.target = 'player';
        bb.lastKnown = { ...p.feet };
        bb.lastSeenAt = this.now;
        this.seenFeet = { ...p.feet };
      }
    }
    const visual = this.now - bb.lastSeenAt <= this.cfg.sightMemory;
    if (bb.hasVisual && !visual && bb.lastKnown) {
      // Lost them: where it last saw them is the freshest news it has.
      bb.hasVisual = false;
      bb.target = null;
      this.seenFeet = null;
      this.offer({ at: bb.lastKnown, confidence: 1, time: bb.lastSeenAt, kind: 'sighting' });
    }
    if (visual && !bb.hasVisual) {
      bb.hasVisual = true;
      endSearch(bb);
    }
    if (this.now >= this.nextSpotScan && this.w.spots) {
      this.nextSpotScan = this.now + 0.25;
      const eye = this.body.eye();
      for (const s of this.w.spots()) if (s.open && flat(s.at, eye) <= this.body.data.sight && this.inFront(s.at) && this.body.clear(eye, s.at)) this.spots.seenUsed.set(s.id, this.now);
    }
  }

  private inFront(to: V): boolean {
    const fx = -Math.sin(this.body.yaw), fz = -Math.cos(this.body.yaw);
    const dx = to.x - this.body.feet.x, dz = to.z - this.body.feet.z;
    return (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) >= Math.cos((70 * Math.PI) / 180);
  }

  // ── Each step ──

  think(now: number, p: PlayerSeen | null): Plan {
    this.now = now;
    this.player = p;
    this.plan = { state: this.bb.state, move: null, face: null, speed: 1, run: false, moment: null, attack: false };
    this.sense();
    this.root.tick(this);
    this.bb.state = this.plan.state;
    return this.plan;
  }

  /** Plays a move now (each call a fresh start). */
  startMoment(name: string, spot: string | null = null): number {
    this.w.did?.(name, spot);
    return ++this.momentKey;
  }

  rand(min: number, max: number): number {
    return min + this.w.random() * (max - min);
  }

  // ── The tree ──

  private build(): Node<Hunter> {
    const engage = new Guard<Hunter>(
      (c) => c.bb.hasVisual,
      new Sequence([
        new MomentTask((c) => (c.justSpotted ? ((c.justSpotted = false), { name: c.look.pick('spotted'), face: c.seenFeet }) : null), 'chase'),
        new Priority<Hunter>([new Guard((c) => c.inReach(), new AttackTask()), new ChaseTask()]),
      ]),
    );
    const capture = new Guard<Hunter>(
      (c) => !!c.spots.witnessed && !!c.spotById(c.spots.witnessed),
      new InspectTask((c) => c.spotById(c.spots.witnessed!), 'high', true),
    );
    const investigate = new Guard<Hunter>(
      (c) => c.bb.shouldInvestigate && !!c.bb.investigation,
      new Restart(
        (c) => c.bb.investigationKey,
        new Sequence([
          new MomentTask((c) => (c.bb.investigation!.kind === 'sighting' ? null : { name: c.look.pick('hear'), face: c.bb.investigation!.at }), 'investigate'),
          new MoveTo((c) => c.investigationDest(), 'investigate', (c) => c.cfg.slow * (flat(c.body.feet, c.bb.investigation!.at) < 200 ? 0.6 : 1)),
          new MomentTask((c) => (c.band() === 'stale' ? null : { name: c.look.pick('arrive') }), 'investigate'),
          new MomentTask((c) => (c.band() === 'stale' ? null : { name: 'listen', seconds: c.cfg.listen }), 'investigate'),
          new Act<Hunter>({ start: (c) => (c.beginSearch(), 'success') }),
        ]),
      ),
    );
    const search = new Guard<Hunter>((c) => c.bb.searching, new SearchTask());
    const wander = new Sequence<Hunter>([
      new MoveTo((c) => c.wanderPoint(), 'wander', () => 0.5),
      new MomentTask((c) => (c.w.random() < c.cfg.idleChance ? { name: (c.lastIdle = c.look.pick('idle', c.lastIdle)) } : null), 'idle'),
      new WaitTask((c) => c.rand(c.cfg.waitMin, c.cfg.waitMax)),
    ]);
    return new Priority([engage, capture, investigate, search, wander]);
  }

  inReach(): boolean {
    const p = this.player;
    if (!p || !this.seenFeet) return false;
    const d = flat(p.feet, this.body.feet);
    if (this.body.data.attack === 'none') return false;
    if (this.body.data.attack === 'shoot') return d <= this.body.data.sight;
    return d <= this.body.data.reach + this.body.radius + 16 && Math.abs(p.feet.y - this.body.feet.y) < 64;
  }

  band(): 'fresh' | 'old' | 'stale' {
    return this.bb.investigation ? ageBand(this.bb.investigation, this.now, this.cfg) : 'stale';
  }

  /** Fresh news: the very place; older: somewhere around it; stale: nowhere in particular (the search does it). */
  investigationDest(): V | null | 'skip' {
    const s = this.bb.investigation!;
    const band = this.band();
    if (band === 'fresh') return s.at;
    if (band === 'stale') return 'skip';
    return this.w.around?.(s.at, 0, spreadOf(s, this.now, this.cfg)) ?? s.at;
  }

  beginSearch(): void {
    const s = this.bb.investigation;
    const bb = this.bb;
    bb.shouldInvestigate = false;
    bb.searching = true;
    bb.searchCenter = s ? { ...s.at } : { ...this.body.feet };
    bb.searchRadius = Math.max(this.cfg.searchRadius, s ? spreadOf(s, this.now, this.cfg) : 0);
    bb.searchUntil = this.now + this.rand(this.cfg.searchMin, this.cfg.searchMax);
    this.spots.passed.clear();
  }

  wanderPoint(): V | 'skip' {
    const p = this.w.around?.(this.body.feet, Math.min(96, this.cfg.wanderRadius / 2), this.cfg.wanderRadius) ?? null;
    this.bb.patrolPoint = p;
    return p ?? 'skip';
  }

  spotById(id: string): SpotInfo | null {
    return this.w.spots?.().find((s) => s.id === id) ?? null;
  }

  /** The spot most worth a look near the search, and how to look at it; null: none worth it. */
  nextSpot(): { spot: SpotInfo; level: 'glance' | 'medium' | 'high'; suspicion: number } | null {
    const all = this.w.spots?.() ?? [];
    const bb = this.bb;
    const hint = bb.investigation ? { at: bb.investigation.at, confidence: bb.investigation.confidence } : null;
    let best: { spot: SpotInfo; level: 'glance' | 'medium' | 'high'; suspicion: number } | null = null;
    for (const s of all) {
      if (this.spots.passed.has(s.id)) continue;
      if (this.now - (this.spots.checked.get(s.id) ?? -Infinity) < this.cfg.spotCooldown) continue;
      const near = Math.min(flat(s.at, this.body.feet), bb.searchCenter ? flat(s.at, bb.searchCenter) : Infinity);
      if (near > this.cfg.spotRange) continue;
      const level = suspicion(s, this.spots, this.now, this.cfg, hint, flat(s.at, this.body.feet) < 300);
      const r = react(level, this.cfg, this.w.random());
      if (r === 'ignore') {
        this.spots.passed.add(s.id);
        continue;
      }
      if (!best || level > best.suspicion) best = { spot: s, level: r, suspicion: level };
    }
    return best;
  }

  /** A point to search: round the centre, within the area (which grows each time). */
  searchPoint(): V | null {
    const bb = this.bb;
    const p = this.w.around?.(bb.searchCenter ?? this.body.feet, 0, bb.searchRadius) ?? null;
    bb.searchRadius = Math.min(this.cfg.searchLimit, bb.searchRadius + this.cfg.searchGrow);
    return p;
  }
}

// ── Tasks ──

/** Walk to a place (null: nowhere to go, it fails; 'skip': nothing to do). Fails if there's no way or it gets stuck. */
class MoveTo extends Task<Hunter> {
  private to: V | null = null;
  private best = Infinity;
  private bestAt = 0;
  constructor(private dest: (c: Hunter) => V | null | 'skip', private state: string, private speed: (c: Hunter) => number = () => 1, private tolerance = 16) {
    super();
  }
  protected override start(c: Hunter): Status | void {
    const d = this.dest(c);
    if (d === 'skip') return 'success';
    if (!d) return 'failure';
    if (c.w.route && flat(d, c.body.feet) > 48 && !c.w.route(c.body.feet, d)) return 'failure';
    this.to = { ...d };
    this.best = Infinity;
    this.bestAt = c.now;
  }
  protected update(c: Hunter): Status {
    const to = this.to!;
    const d = flat(to, c.body.feet);
    if (d <= this.tolerance) return 'success';
    if (d < this.best - 8) {
      this.best = d;
      this.bestAt = c.now;
    } else if (c.now - this.bestAt > 3) return 'failure';
    c.plan.state = this.state;
    c.plan.move = to;
    c.plan.speed = this.speed(c);
    return 'running';
  }
}

/** Stand and make a move for its time (null: nothing to do). */
class MomentTask extends Task<Hunter> {
  private until = 0;
  private key = 0;
  private name = '';
  private face: V | null = null;
  constructor(private pick: (c: Hunter) => { name: string; face?: V | null; seconds?: number; spot?: string } | null, private state: string) {
    super();
  }
  protected override start(c: Hunter): Status | void {
    const m = this.pick(c);
    if (!m) return 'success';
    this.name = m.name;
    this.face = m.face ? { ...m.face } : null;
    this.until = c.now + (m.seconds ?? c.look.seconds(m.name));
    this.key = c.startMoment(m.name, m.spot ?? null);
  }
  protected update(c: Hunter): Status {
    if (c.now >= this.until) return 'success';
    c.plan.state = this.state;
    c.plan.face = this.face;
    c.plan.moment = { name: this.name, key: this.key };
    return 'running';
  }
}

class WaitTask extends Task<Hunter> {
  private until = 0;
  constructor(private seconds: (c: Hunter) => number) {
    super();
  }
  protected override start(c: Hunter): void {
    this.until = c.now + this.seconds(c);
  }
  protected update(c: Hunter): Status {
    c.plan.state = 'idle';
    return c.now >= this.until ? 'success' : 'running';
  }
}

class ChaseTask extends Task<Hunter> {
  protected update(c: Hunter): Status {
    c.plan.state = 'chase';
    c.plan.move = c.seenFeet ?? c.bb.lastKnown;
    c.plan.run = true;
    if (c.body.data.attack === 'shoot' && c.seenFeet) {
      c.plan.move = null;
      c.plan.face = c.seenFeet;
    }
    return 'running';
  }
}

class AttackTask extends Task<Hunter> {
  protected update(c: Hunter): Status {
    const p = c.player!;
    c.plan.state = 'attack';
    c.plan.face = p.feet;
    c.plan.attack = true;
    if (c.body.data.attack === 'melee' && flat(p.feet, c.body.feet) > c.body.data.reach) c.plan.move = p.feet;
    return 'running';
  }
}

/**
 * Searching until its time is up: the hiding spot most worth checking, else the next point round the area.
 * Time up: it gives up (its losing move) and goes back to wandering.
 */
class SearchTask extends Task<Hunter> {
  private doing: Node<Hunter> | null = null;
  private giving: MomentTask | null = null;
  protected update(c: Hunter): Status {
    if (c.now >= c.bb.searchUntil) {
      this.doing?.abort(c);
      this.doing = null;
      this.giving ??= new MomentTask((h) => ({ name: h.look.pick('lost') }), 'search');
      if (this.giving.tick(c) === 'running') return 'running';
      this.giving = null;
      endSearch(c.bb);
      return 'success';
    }
    for (let tries = 0; tries < 2; tries++) {
      this.doing ??= this.next(c);
      const s = this.doing.tick(c);
      if (s === 'running') return 'running';
      this.doing = null;
    }
    c.plan.state = 'search';
    return 'running';
  }
  private next(c: Hunter): Node<Hunter> {
    const spot = c.nextSpot();
    if (spot) {
      c.bb.suspicion = spot.suspicion;
      return new InspectTask(() => spot.spot, spot.level, false);
    }
    const p = c.searchPoint();
    return new Sequence<Hunter>([new MoveTo(() => p ?? 'skip', 'search', (h) => h.cfg.slow), new MomentTask((h) => ({ name: h.look.pick('searchPoint') }), 'search')]);
  }
  protected override stop(c: Hunter): void {
    this.doing?.abort(c);
    this.doing = null;
    this.giving = null;
  }
}

/**
 * Checking a hiding spot (the interaction system decides the moves): a glance from where it stands, or walk up
 * to it and knock and listen, or open it up. Noise from it while listening makes it open up; opening it with the
 * player inside pulls them out; opening it empty, it stares. Either way the spot is left alone for a while.
 */
class InspectTask extends Task<Hunter> {
  private spot: SpotInfo | null = null;
  private steps: Step[] = [];
  private at = 0;
  private walk: MoveTo | null = null;
  private move: MomentTask | null = null;
  private since = 0;
  private opened = false;
  constructor(private which: (c: Hunter) => SpotInfo | null, private level: 'glance' | 'medium' | 'high', private witnessed: boolean) {
    super();
  }
  protected override start(c: Hunter): Status | void {
    this.spot = this.which(c);
    if (!this.spot) return 'failure';
    this.steps = [...stepsFor(this.spot.kind, this.level, c.w.random())];
    this.at = 0;
    this.opened = false;
    this.since = c.now;
    const spot = this.spot;
    this.walk = this.level === 'glance' ? null : new MoveTo(() => spot.front, 'inspect', (h) => (this.witnessed ? 1 : h.cfg.slow), 24);
    this.move = null;
    c.bb.currentSpot = spot.id;
    c.bb.interacting = true;
  }
  protected update(c: Hunter): Status {
    const spot = this.spot!;
    if (this.walk) {
      const s = this.walk.tick(c);
      if (s === 'running') return 'running';
      this.walk = null;
      if (s === 'failure') return 'failure';
    }
    while (this.at < this.steps.length) {
      const step = this.steps[this.at]!;
      this.move ??= new MomentTask((h) => ({ name: step.moment, face: spot.at, seconds: step.listen ? h.cfg.listen : undefined, spot: spot.id }), 'inspect');
      if (this.move.tick(c) === 'running') return 'running';
      this.move = null;
      this.at++;
      if (step.reveal) {
        this.opened = true;
        if (c.w.reveal?.(spot.id)) return 'success';
      }
      if (step.listen && (c.spots.heard.get(spot.id) ?? -Infinity) >= this.since && this.level !== 'high') {
        this.level = 'high';
        this.steps.push(...stepsFor(spot.kind, 'high', c.w.random()));
      }
      if (this.at === this.steps.length && this.opened && this.steps[this.steps.length - 1]!.moment !== 'empty') this.steps.push({ moment: c.look.pick('empty') });
    }
    return 'success';
  }
  protected override stop(c: Hunter): void {
    if (this.spot) {
      c.spots.checked.set(this.spot.id, c.now);
      if (this.opened) c.spots.forget(this.spot.id);
      if (this.witnessed || c.spots.witnessed === this.spot.id) c.spots.witnessed = null;
    }
    this.walk?.abort(c);
    this.move?.abort(c);
    this.walk = this.move = null;
    c.bb.currentSpot = null;
    c.bb.interacting = false;
  }
}
