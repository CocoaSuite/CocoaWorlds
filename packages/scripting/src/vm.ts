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
import type { Ref } from './model';

export const STEP_BUDGET = 10_000;

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
  /** Make a copy of `template` at a place (an object, or 'aim'); returns the copy's id, or null if it couldn't. */
  spawn?(template: string, place: Value, owner: string): string | null;
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
}

export type RunnerEvent =
  | { type: 'enter' | 'leave'; zone: string; other: string }
  | { type: 'message'; message: string; to: string | null; from: string | null }
  /** The player used `targets` (the object looked at and everything it is inside). */
  | { type: 'use'; targets: string[]; by: string }
  /** The player's health reached 0. */
  | { type: 'die' }
  /** A breakable object's health reached 0. */
  | { type: 'breaks'; target: string };

export class ScriptRunner {
  private instances: Instance[];
  private threads: Thread[] = [];
  private running = new Set<string>();
  readonly errors: ScriptError[] = [];
  private started = false;

  constructor(
    programs: Program[],
    private host: ScriptHost,
  ) {
    this.instances = programs.map((program) => ({
      program,
      vars: program.variables.map((v) => v.initial),
      timers: new Map(program.handlers.filter((h) => h.event.kind === 'every').map((h) => [h.id, 0])),
    }));
  }

  /** Add an object's script while playing (a copy): its “When the game starts” stacks run straight away. */
  addProgram(program: Program): void {
    const inst: Instance = {
      program,
      vars: program.variables.map((v) => v.initial),
      timers: new Map(program.handlers.filter((h) => h.event.kind === 'every').map((h) => [h.id, 0])),
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
  usePrompt(targets: string[]): string | null {
    for (const id of targets)
      for (const inst of this.instances) {
        if (inst.program.owner !== id) continue;
        for (const h of inst.program.handlers) if (h.event.kind === 'use') return h.event.prompt;
      }
    return null;
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
    for (const inst of this.instances) {
      for (const h of inst.program.handlers) {
        const ev = h.event;
        if (e.type === 'breaks') {
          if (ev.kind === 'breaks' && inst.program.owner === e.target) this.spawn(inst, h, null);
        } else if (e.type === 'die') {
          if (ev.kind === 'die') this.spawn(inst, h, null);
        } else if (e.type === 'use') {
          if (ev.kind === 'use' && e.targets.includes(inst.program.owner)) this.spawn(inst, h, e.by);
        } else if (e.type === 'message') {
          if (ev.kind === 'message' && ev.message === e.message && (e.to === null || e.to === inst.program.owner)) this.spawn(inst, h, null);
        } else if ((ev.kind === 'enter' || ev.kind === 'leave') && ev.kind === e.type && ev.zone === e.zone) {
          this.spawn(inst, h, e.other);
        }
      }
    }
  }

  /** Advance time: fire "every" timers and run every thread that can run. */
  tick(dt: number): void {
    for (const inst of this.instances) {
      for (const h of inst.program.handlers) {
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

  private spawn(inst: Instance, handler: CompiledHandler, other: string | null): void {
    const k = this.key(inst, handler);
    if (this.running.has(k)) return;
    this.running.add(k);
    this.threads.push({ inst, handler, pc: 0, stack: [], temps: new Array(handler.temps).fill(0), other, waitUntil: 0, waitFor: null, loop: null, copy: null });
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
        case 'settext': {
          const txt = this.text(s.pop() ?? null);
          const target = s.pop();
          if (target && typeof target === 'object') this.host.setText?.(target.ref, txt);
          break;
        }
        case 'halt':
          return this.finish(t);
      }
    }
  }
}
