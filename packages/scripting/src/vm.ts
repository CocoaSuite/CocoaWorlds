/**
 * The script VM (D6). Each "When …" stack runs as a thread that can pause ("Wait 2 seconds", "Move … over
 * 1 second") and resume later, so scripts never deal with callbacks.
 *
 * Rules that keep games safe and predictable:
 *  - A stack doesn't start again while it is still running (a door can't be opened twice at once).
 *  - A thread may run at most STEP_BUDGET instructions per frame; a loop that never waits is stopped and
 *    reported, and the game keeps running.
 *  - A failing action or a division by zero stops only that thread, with a message pointing at the block.
 */
import type { ActionName, CompiledHandler, GameAction, GameValue, Op, Program, Value } from './compile';
import type { LightProp, Ref } from './model';

export const STEP_BUDGET = 10_000;

/**
 * A message that comes again within this many seconds counts as still coming (a “while” loop sends it every
 * frame): “When I get” doesn't start again, and “When it stops coming” waits for a longer break.
 */
export const MESSAGE_HOLD = 0.1;

/** What scripts can do to the game. The runtime provides it; tests use a fake. */
export interface ScriptHost {
  /** Seconds since the game started. */
  now(): number;
  random(): number;
  /** Start an action. Returns null when it's done at once, or a function that says when it has finished. */
  act(name: ActionName, target: string, args: Value[], owner: string): (() => boolean) | null;
  send(message: string, to: string | null, from: string): void;
  log(text: string, from: string, block: string): void;
  /** A readable name for an object (for logging and joining text). */
  nameOf(id: string): string;
  /** Hurt or heal the player, or change the score (games without a player ignore health). */
  game?(name: GameAction, amount: number, owner: string): void;
  /** The player's health or the score. */
  read?(name: GameValue): number;
  /** Game values shared by all scripts. */
  getGlobal?(name: string): Value;
  setGlobal?(name: string, value: Value): void;
  /** Show a message on screen for `seconds`. */
  say?(text: string, seconds: number, owner: string): void;
  /** Change what a text sign says. */
  setText?(target: string, text: string): void;
  /** Change a light's setting (a number, or a colour as text) over some seconds. */
  setLight?(target: string, prop: LightProp, value: number | string, seconds: number): void;
  /** How bright an object's model glows, over some seconds. */
  setGlow?(target: string, strength: number, seconds: number): void;
  /** Whether a light is on. */
  lightOn?(target: string): boolean;
  /** The time of day in hours, and setting it. */
  timeOfDay?(): number;
  setTimeOfDay?(hours: number): void;
  /** Play a sound at a place (an object, the player, 'aim') or everywhere (null). */
  playSound?(sound: string, place: Value, volume: number, owner: string, loudness?: number): void;
  /** A noise at a place, this loud for hunting creatures. */
  noise?(place: Value, loudness: number, owner: string): void;
  /** The Director's hint to hunting creatures. */
  hint?(place: Value, spread: number, sure: number, as: 'sound' | 'sighting' | 'event'): void;
  /** Stop the sounds an object is making. */
  stopSound?(target: string): void;
  /** Play an animation of an object's model. */
  playAnimation?(target: string, name: string, loop: boolean): void;
  /** Show or hide a screen, or one element of a screen. */
  showUi?(what: 'screen' | 'element', id: string, show: boolean | 'toggle'): void;
  /** The real time in seconds since 1970. */
  clock?(): number;
  /** Kept game values and items back to the start. */
  forgetProgress?(): void;
  /** Save the game now (it then saves only at these blocks, and at sleep). */
  saveGame?(): void;
  /** Block (or allow again) the player's save menu: no saving or loading. */
  blockSaving?(on: boolean): void;
  /** Go to another scene (a level change). */
  changeScene?(scene: string, landmark: string): void;
  /** Add a row to a list, or remove the first row with this text; empty a list. */
  listRow?(id: string, text: string, add: boolean): void;
  clearList?(id: string): void;
  /** Change what a text or button says. */
  setUiText?(id: string, text: string): void;
  /** Give (or with a minus, take) some of an item. */
  giveItem?(name: string, amount: number): void;
  itemCount?(name: string): number;
  /** The item in the picked hotbar slot ('' for none). */
  selectedItem?(): string;
  /** How far apart two things are (object ids or 'player'); null when either isn't in the game. */
  distance?(a: string, b: string): number | null;
  /** Whether `what` (an object or 'player') is inside the trigger zone `zone` right now. */
  isInside?(zone: string, what: string): boolean;
  /** Make a copy of `template` at a place (an object, or 'aim'); returns the copy's id, or null if it couldn't. */
  spawn?(template: string, place: Value, owner: string): string | null;
  /** What the player holds (an object id), or null. */
  held?(): string | null;
  /** Whether the player holds `what` or a copy of it (null: anything). */
  holds?(what: string | null): boolean;
  /** Whether the player is in a hiding spot. */
  hiding?(): boolean;
}

export interface ScriptError {
  owner: string;
  handler: string;
  block: string;
  message: string;
  time: number;
}

interface Instance {
  program: Program;
  vars: Value[];
  /** Handlers by id, with "every" timers. */
  timers: Map<string, number>;
  /** “When the player comes near / goes away” handlers by id: whether the player was within the distance. */
  near: Map<string, boolean>;
}

interface Thread {
  inst: Instance;
  handler: CompiledHandler;
  pc: number;
  stack: Value[];
  temps: Value[];
  /** The object that entered or left (zone events). */
  other: string | null;
  waitUntil: number;
  waitFor: (() => boolean) | null;
  /** The loop block it last jumped back through (a runaway loop is reported there). */
  loop: string | null;
  /** The copy this stack made last (“the new copy”). */
  copy: string | null;
  /** The row picked (in “When the player picks a row”). */
  pick: string;
}

export type RunnerEvent =
  | { type: 'enter' | 'leave'; zone: string; other: string }
  | { type: 'message'; message: string; to: string | null; from: string | null }
  /** The player used `targets` (the object looked at and everything it is inside). */
  | { type: 'use'; targets: string[]; by: string; distance?: number }
  /**
   * The player used `targets` while holding something: `held` is it and the objects it is a copy of (it first);
   * `distance` is how far away the object looked at is.
   */
  | { type: 'useHolding'; targets: string[]; held: string[]; distance: number }
  /** The player's health reached 0. */
  | { type: 'die' }
  /** A breakable object's health reached 0. */
  | { type: 'breaks'; target: string }
  /** A shot, swing or blast hit `targets` (what was hit and everything it is inside). */
  | { type: 'hit'; targets: string[] }
  /** A creature died. */
  | { type: 'dies'; target: string }
  /** The player got into a hiding spot, came out, or was found in it (`targets`: the spot and what it is inside). */
  | { type: 'hides' | 'unhides' | 'found' | 'sits' | 'stands'; targets: string[] }
  /** The player clicked a button on screen. */
  | { type: 'uiClick'; element: string }
  /** The player used an item from the hotbar. */
  | { type: 'useItem'; item: string }
  /** The player picked a row of a list on screen. */
  | { type: 'listPick'; list: string; row: string }
  /** The player pressed a key. */
  | { type: 'key'; key: string }
  | { type: 'press'; key: string; targets: string[]; distance: number }
  /** A hunting creature made a move (`targets`: it, and the hiding spot it is at with what that is inside). */
  | { type: 'does'; what: string; targets: string[] };

export class ScriptRunner {
  private instances: Instance[];
  private threads: Thread[] = [];
  private running = new Set<string>();
  readonly errors: ScriptError[] = [];
  private started = false;
  /** Messages that are coming in, by `${owner}\n${message}`: when each arrived last. */
  private held = new Map<string, { inst: Instance; message: string; last: number }>();

  constructor(
    programs: Program[],
    private host: ScriptHost,
  ) {
    this.instances = programs.map((program) => ({
      program,
      vars: program.variables.map((v) => v.initial),
      timers: new Map(program.handlers.filter((h) => h.event.kind === 'every').map((h) => [h.id, 0])),
      near: new Map(),
    }));
  }

  /** Add an object's script while playing (a copy): its “When the game starts” stacks run straight away. */
  addProgram(program: Program): void {
    const inst: Instance = {
      program,
      vars: program.variables.map((v) => v.initial),
      timers: new Map(program.handlers.filter((h) => h.event.kind === 'every').map((h) => [h.id, 0])),
      near: new Map(),
    };
    this.instances.push(inst);
    if (!this.started) return;
    for (const h of program.handlers) if (h.event.kind === 'start') this.spawn(inst, h, null);
  }

  /** Objects removed from the game: their scripts stop. */
  removeOwners(ids: Set<string>): void {
    for (const t of this.threads.filter((t) => ids.has(t.inst.program.owner))) this.finish(t);
    this.instances = this.instances.filter((i) => !ids.has(i.program.owner));
  }

  /**
   * What the player would do by pressing Use at `targets` (the object looked at and what it is inside): the
   * first “When the player uses this” prompt found, '' for one without a word, or null if nothing listens.
   */
  usePrompt(targets: string[], distance = 0): string | null {
    for (const id of targets)
      for (const inst of this.instances) {
        if (inst.program.owner !== id) continue;
        for (const h of inst.program.handlers) if (h.event.kind === 'use' && distance <= h.event.reach) return h.event.prompt;
      }
    return null;
  }

  /** The keys that do something at `targets` from this far (“When the player presses … at this”), with their prompts, nearest object first. */
  keyPrompts(targets: string[], distance: number): { key: string; prompt: string }[] {
    const out: { key: string; prompt: string }[] = [];
    for (const id of targets)
      for (const inst of this.instances) {
        if (inst.program.owner !== id) continue;
        for (const h of inst.program.handlers)
          if (h.event.kind === 'press' && distance <= h.event.reach && !out.some((x) => x.key === (h.event as { key: string }).key)) out.push({ key: h.event.key, prompt: h.event.prompt });
      }
    return out;
  }

  /** The furthest any “When the player uses” stack reaches (0 when there are none). */
  useReach(): number {
    let r = 0;
    for (const inst of this.instances) for (const h of inst.program.handlers) if (h.event.kind === 'use' || h.event.kind === 'useHolding' || h.event.kind === 'press') r = Math.max(r, h.event.reach);
    return r;
  }

  /** Whether some “When the player uses this while holding” stack listens for this (see the `useHolding` event). */
  usesHolding(targets: string[], held: string[], distance: number): boolean {
    for (const inst of this.instances) {
      if (!targets.includes(inst.program.owner)) continue;
      for (const h of inst.program.handlers) if (this.holdingMatch(h.event, held, distance)) return true;
    }
    return false;
  }

  private holdingMatch(ev: CompiledHandler['event'], held: string[], distance: number): boolean {
    return ev.kind === 'useHolding' && distance <= ev.reach && (ev.item === null || held.includes(ev.item));
  }

  /** Run every "When the game starts" stack. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const inst of this.instances) for (const h of inst.program.handlers) if (h.event.kind === 'start') this.spawn(inst, h, null);
    this.runAll();
  }

  /** Something happened in the game: start the stacks that listen for it (they run on the next tick). */
  dispatch(e: RunnerEvent): void {
    if (e.type === 'message') return this.deliver(e.message, e.to);
    for (const inst of this.instances) {
      for (const h of inst.program.handlers) {
        const ev = h.event;
        if (e.type === 'uiClick') {
          if (ev.kind === 'uiClick' && ev.element === e.element) this.spawn(inst, h, null);
        } else if (e.type === 'useItem') {
          if (ev.kind === 'useItem' && (!ev.item || ev.item === e.item)) this.spawn(inst, h, null);
        } else if (e.type === 'listPick') {
          if (ev.kind === 'listPick' && ev.list === e.list) this.spawn(inst, h, null, e.row);
        } else if (e.type === 'key') {
          if (ev.kind === 'key' && ev.key === e.key) this.spawn(inst, h, null);
        } else if (e.type === 'press') {
          if (ev.kind === 'press' && ev.key === e.key && e.targets.includes(inst.program.owner) && e.distance <= ev.reach) this.spawn(inst, h, null);
        } else if (e.type === 'breaks') {
          if (ev.kind === 'breaks' && inst.program.owner === e.target) this.spawn(inst, h, null);
        } else if (e.type === 'dies') {
          if (ev.kind === 'dies' && inst.program.owner === e.target) this.spawn(inst, h, null);
        } else if (e.type === 'does') {
          if (ev.kind === 'does' && (!ev.what || ev.what === e.what) && e.targets.includes(inst.program.owner)) this.spawn(inst, h, null);
        } else if (e.type === 'hides' || e.type === 'unhides' || e.type === 'found' || e.type === 'sits' || e.type === 'stands') {
          if (ev.kind === e.type && e.targets.includes(inst.program.owner)) this.spawn(inst, h, null);
        } else if (e.type === 'hit') {
          if (ev.kind === 'hit' && e.targets.includes(inst.program.owner)) this.spawn(inst, h, null);
        } else if (e.type === 'die') {
          if (ev.kind === 'die') this.spawn(inst, h, null);
        } else if (e.type === 'use') {
          if (ev.kind === 'use' && e.targets.includes(inst.program.owner) && (e.distance ?? 0) <= ev.reach) this.spawn(inst, h, e.by);
        } else if (e.type === 'useHolding') {
          if (e.targets.includes(inst.program.owner) && this.holdingMatch(ev, e.held, e.distance)) this.spawn(inst, h, e.held[0] ?? null);
        } else if ((ev.kind === 'enter' || ev.kind === 'leave') && ev.kind === e.type && ev.zone === e.zone) {
          this.spawn(inst, h, e.other);
        }
      }
    }
  }

  /** A message arrived for every object that listens for it (or the one it was sent to). */
  private deliver(message: string, to: string | null): void {
    const now = this.host.now();
    for (const inst of this.instances) {
      if (to !== null && to !== inst.program.owner) continue;
      const hs = inst.program.handlers.filter((h) => (h.event.kind === 'message' || h.event.kind === 'messageStop') && h.event.message === message);
      if (!hs.length) continue;
      const key = `${inst.program.owner}\n${message}`;
      const prev = this.held.get(key);
      this.held.set(key, { inst, message, last: now });
      if (prev && now - prev.last <= MESSAGE_HOLD + 1e-6) continue;
      for (const h of hs) if (h.event.kind === 'message') this.spawn(inst, h, null);
    }
  }

  /** Advance time: fire "every" timers and run every thread that can run. */
  tick(dt: number): void {
    const now = this.host.now();
    for (const [key, m] of this.held) {
      if (now - m.last <= MESSAGE_HOLD + 1e-6) continue;
      this.held.delete(key);
      if (!this.instances.includes(m.inst)) continue;
      for (const h of m.inst.program.handlers) if (h.event.kind === 'messageStop' && h.event.message === m.message) this.spawn(m.inst, h, null);
    }
    for (const inst of this.instances) {
      for (const h of inst.program.handlers) {
        const ev = h.event;
        if (ev.kind === 'near' || ev.kind === 'far') {
          // (Starts on crossing the distance; the player starting close counts as coming near.)
          const d = this.host.distance?.(inst.program.owner, 'player');
          if (d === null || d === undefined) continue;
          const within = d <= ev.distance;
          const was = inst.near.get(h.id);
          inst.near.set(h.id, within);
          if (ev.kind === 'near' ? within && was !== true : !within && was === true) this.spawn(inst, h, null);
          continue;
        }
        if (h.event.kind !== 'every') continue;
        const t = (inst.timers.get(h.id) ?? 0) + dt;
        if (t >= h.event.seconds - 1e-6) {
          // (tolerance: ten steps of 0.1 s add up to 0.9999…)
          inst.timers.set(h.id, Math.max(0, t - h.event.seconds));
          this.spawn(inst, h, null);
        } else inst.timers.set(h.id, t);
      }
    }
    this.runAll();
  }

  /** The statement blocks each object's script is on right now (for highlighting while playing). */
  activeBlocks(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const t of this.threads) {
      const b = t.handler.blocks[Math.max(0, Math.min(t.pc, t.handler.blocks.length - 1))];
      if (!b) continue;
      out.set(t.inst.program.owner, [...(out.get(t.inst.program.owner) ?? []), b]);
    }
    return out;
  }

  /** Current values of an object's variables. */
  variables(owner: string): Record<string, Value> {
    const inst = this.instances.find((i) => i.program.owner === owner);
    if (!inst) return {};
    return Object.fromEntries(inst.program.variables.map((v, i) => [v.name, inst.vars[i]!]));
  }

  get threadCount(): number {
    return this.threads.length;
  }

  private key(inst: Instance, h: CompiledHandler) {
    return `${inst.program.owner}:${h.id}`;
  }

  private spawn(inst: Instance, handler: CompiledHandler, other: string | null, pick = ''): void {
    const k = this.key(inst, handler);
    if (this.running.has(k)) return;
    this.running.add(k);
    this.threads.push({ inst, handler, pc: 0, stack: [], temps: new Array(handler.temps).fill(0), other, waitUntil: 0, waitFor: null, loop: null, copy: null, pick });
  }

  private runAll(): void {
    const now = this.host.now();
    for (const t of [...this.threads]) {
      // (A stack can be stopped by another one this frame, when its object is removed.)
      if (!this.threads.includes(t)) continue;
      if (t.waitUntil > now) continue;
      if (t.waitFor) {
        if (!t.waitFor()) continue;
        t.waitFor = null;
      }
      this.run(t);
    }
  }

  private finish(t: Thread): void {
    this.threads = this.threads.filter((x) => x !== t);
    this.running.delete(this.key(t.inst, t.handler));
  }

  private fail(t: Thread, message: string, block?: string): void {
    this.errors.push({
      owner: t.inst.program.owner,
      handler: t.handler.id,
      block: block ?? t.handler.blocks[Math.max(0, t.pc - 1)] ?? '',
      message,
      time: this.host.now(),
    });
    this.finish(t);
  }

  private resolve(t: Thread, ref: Ref): Value {
    if ('player' in ref) return { ref: 'player' };
    if ('self' in ref) return { ref: t.inst.program.owner };
    if ('other' in ref) return t.other ? { ref: t.other } : null;
    if ('held' in ref) {
      const h = this.host.held?.() ?? null;
      return h ? { ref: h } : null;
    }
    return { ref: ref.entity };
  }

  private text(v: Value): string {
    if (v === null) return 'nothing';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    if (typeof v === 'object') return this.host.nameOf(v.ref);
    return v;
  }

  private run(t: Thread): void {
    const { code } = t.handler;
    const s = t.stack;
    const num = (v: Value) => (typeof v === 'number' ? v : Number(v) || 0);
    for (let steps = 0; ; steps++) {
      if (steps >= STEP_BUDGET) {
        this.fail(t, `This ran ${STEP_BUDGET.toLocaleString('en')} steps in one frame without waiting, so it was stopped. Add a Wait inside the loop.`, t.loop ?? undefined);
        return;
      }
      const op: Op | undefined = code[t.pc++];
      if (!op) return this.finish(t);
      switch (op.op) {
        case 'push':
          s.push(op.v);
          break;
        case 'ref':
          s.push(this.resolve(t, op.ref));
          break;
        case 'var':
          s.push(t.inst.vars[op.slot] ?? null);
          break;
        case 'setvar':
          t.inst.vars[op.slot] = s.pop() ?? null;
          break;
        case 'temp':
          s.push(t.temps[op.slot] ?? null);
          break;
        case 'settemp':
          t.temps[op.slot] = s.pop() ?? null;
          break;
        case 'maths': {
          const b = num(s.pop()!), a = num(s.pop()!);
          if ((op.f === '÷' || op.f === 'mod') && b === 0) return this.fail(t, 'Division by zero.');
          s.push(op.f === '+' ? a + b : op.f === '-' ? a - b : op.f === '×' ? a * b : op.f === '÷' ? a / b : ((a % b) + b) % b);
          break;
        }
        case 'join': {
          const b = s.pop()!, a = s.pop()!;
          s.push(this.text(a) + this.text(b));
          break;
        }
        case 'compare': {
          const b = s.pop()!, a = s.pop()!;
          const eq = JSON.stringify(a) === JSON.stringify(b);
          s.push(
            op.f === '=' ? eq : op.f === '≠' ? !eq : op.f === '<' ? num(a) < num(b) : op.f === '>' ? num(a) > num(b) : op.f === '≤' ? num(a) <= num(b) : num(a) >= num(b),
          );
          break;
        }
        case 'logic': {
          const b = !!s.pop(), a = !!s.pop();
          s.push(op.f === 'and' ? a && b : a || b);
          break;
        }
        case 'not':
          s.push(!s.pop());
          break;
        case 'random': {
          const hi = num(s.pop()!), lo = num(s.pop()!);
          const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
          // Whole numbers give whole results (dice); otherwise anything in between.
          s.push(Number.isInteger(a) && Number.isInteger(b) ? a + Math.floor(this.host.random() * (b - a + 1)) : a + this.host.random() * (b - a));
          break;
        }
        case 'time':
          s.push(this.host.now());
          break;
        case 'jmp':
          if (op.to < t.pc) t.loop = t.handler.blocks[t.pc - 1] ?? null;
          t.pc = op.to;
          break;
        case 'jmpf':
          if (!s.pop()) t.pc = op.to;
          break;
        case 'act': {
          const args = s.splice(s.length - op.argc, op.argc);
          const target = s.pop();
          if (!target || typeof target !== 'object') {
            // “The thing that entered” can be missing (it left the game); nothing to do.
            break;
          }
          let wait: (() => boolean) | null;
          try {
            wait = this.host.act(op.name, target.ref, args, t.inst.program.owner);
          } catch (e) {
            return this.fail(t, (e as Error).message);
          }
          // Its own object was removed (or broke): this stack ends here.
          if (!this.threads.includes(t)) return;
          if (wait && !wait()) {
            t.waitFor = wait;
            return;
          }
          break;
        }
        case 'wait': {
          const sec = Math.max(0, num(s.pop()!));
          t.waitUntil = this.host.now() + sec;
          return; // even “Wait 0” lets the frame finish
        }
        case 'send': {
          const to = s.pop();
          this.host.send(op.message, to && typeof to === 'object' ? to.ref : null, t.inst.program.owner);
          break;
        }
        case 'log':
          this.host.log(this.text(s.pop() ?? null), t.inst.program.owner, t.handler.blocks[t.pc - 1] ?? '');
          break;
        case 'game':
          this.host.game?.(op.name, num(s.pop() ?? 0), t.inst.program.owner);
          break;
        case 'read':
          s.push(this.host.read?.(op.name) ?? 0);
          break;
        case 'gvar':
          s.push(this.host.getGlobal?.(op.name) ?? null);
          break;
        case 'setgvar':
          this.host.setGlobal?.(op.name, s.pop() ?? null);
          break;
        case 'say': {
          const sec = num(s.pop() ?? 0);
          this.host.say?.(this.text(s.pop() ?? null), Math.max(0, sec), t.inst.program.owner);
          break;
        }
        case 'spawn': {
          const place = s.pop() ?? null;
          const template = s.pop();
          t.copy = null;
          if (!template || typeof template !== 'object' || place === null) break;
          try {
            t.copy = this.host.spawn?.(template.ref, place, t.inst.program.owner) ?? null;
          } catch (e) {
            return this.fail(t, (e as Error).message);
          }
          break;
        }
        case 'copy':
          s.push(t.copy ? { ref: t.copy } : null);
          break;
        case 'varof': {
          const of = s.pop();
          const inst = of && typeof of === 'object' ? this.instances.find((i) => i.program.owner === of.ref) : undefined;
          const slot = inst ? inst.program.variables.findIndex((v) => v.name === op.name) : -1;
          s.push(inst && slot >= 0 ? (inst.vars[slot] ?? null) : null);
          break;
        }
        case 'noise': {
          const loudness = Math.max(0, num(s.pop() ?? 0));
          const place = s.pop() ?? null;
          this.host.noise?.(place, loudness, t.inst.program.owner);
          break;
        }
        case 'hint': {
          const sure = num(s.pop() ?? 0);
          const spread = Math.max(0, num(s.pop() ?? 0));
          const place = s.pop() ?? null;
          this.host.hint?.(place, spread, sure, op.as);
          break;
        }
        case 'sound': {
          const loudness = Math.max(0, num(s.pop() ?? 0));
          const volume = Math.max(0, num(s.pop() ?? 1));
          const place = s.pop() ?? null;
          if (op.sound) this.host.playSound?.(op.sound, place, volume, t.inst.program.owner, loudness);
          break;
        }
        case 'anim': {
          const target = s.pop();
          if (target && typeof target === 'object') this.host.playAnimation?.(target.ref, op.name, op.loop);
          break;
        }
        case 'stopsound': {
          const target = s.pop();
          if (target && typeof target === 'object') this.host.stopSound?.(target.ref);
          break;
        }
        case 'settext': {
          const txt = this.text(s.pop() ?? null);
          const target = s.pop();
          if (target && typeof target === 'object') this.host.setText?.(target.ref, txt);
          break;
        }
        case 'light': {
          const sec = Math.max(0, num(s.pop() ?? 0));
          const v = s.pop() ?? null;
          const target = s.pop();
          if (target && typeof target === 'object') this.host.setLight?.(target.ref, op.prop, op.prop === 'color' ? this.text(v) : num(v), sec);
          break;
        }
        case 'glow': {
          const sec = Math.max(0, num(s.pop() ?? 0));
          const v = Math.max(0, num(s.pop() ?? 0));
          const target = s.pop();
          if (target && typeof target === 'object') this.host.setGlow?.(target.ref, v, sec);
          break;
        }
        case 'settime':
          this.host.setTimeOfDay?.(num(s.pop() ?? 0));
          break;
        case 'gettime':
          s.push(this.host.timeOfDay?.() ?? 12);
          break;
        case 'lit': {
          const target = s.pop();
          s.push(!!(target && typeof target === 'object' && this.host.lightOn?.(target.ref)));
          break;
        }
        case 'dist': {
          const b = s.pop(), a = s.pop();
          const d = a && typeof a === 'object' && b && typeof b === 'object' ? this.host.distance?.(a.ref, b.ref) : null;
          if (d === null || d === undefined) return this.fail(t, 'Can’t measure the distance: one of the two isn’t in the game.');
          s.push(d);
          break;
        }
        case 'inside': {
          const zone = s.pop(), what = s.pop();
          s.push(!!(zone && typeof zone === 'object' && what && typeof what === 'object' && this.host.isInside?.(zone.ref, what.ref)));
          break;
        }
        case 'ui':
          this.host.showUi?.(op.what, op.id, op.show);
          break;
        case 'uitext':
          this.host.setUiText?.(op.id, this.text(s.pop() ?? null));
          break;
        case 'item':
          this.host.giveItem?.(op.name, op.sign * num(s.pop() ?? 0));
          break;
        case 'count':
          s.push(this.host.itemCount?.(op.name) ?? 0);
          break;
        case 'hiding':
          s.push(!!this.host.hiding?.());
          break;
        case 'holds': {
          const v = s.pop() ?? null;
          s.push(v === true ? !!this.host.holds?.(null) : v && typeof v === 'object' ? !!this.host.holds?.(v.ref) : false);
          break;
        }
        case 'selitem':
          s.push(this.host.selectedItem?.() ?? '');
          break;
        case 'row':
          this.host.listRow?.(op.id, this.text(s.pop() ?? null), op.add);
          break;
        case 'clearlist':
          this.host.clearList?.(op.id);
          break;
        case 'picked':
          s.push(t.pick);
          break;
        case 'clock':
          s.push(this.host.clock?.() ?? Date.now() / 1000);
          break;
        case 'forget':
          this.host.forgetProgress?.();
          break;
        case 'savegame':
          this.host.saveGame?.();
          break;
        case 'saveblock':
          this.host.blockSaving?.(op.on);
          break;
        case 'scene':
          this.host.changeScene?.(op.scene, op.landmark);
          break;
        case 'halt':
          return this.finish(t);
      }
    }
  }
}
