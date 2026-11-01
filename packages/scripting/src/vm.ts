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
import type { ActionName, CompiledHandler, Op, Program, Value } from './compile';

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
}

export type RunnerEvent =
  | { type: 'enter' | 'leave'; zone: string; other: string }
  | { type: 'message'; message: string; to: string | null; from: string | null };

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
        if (e.type === 'message') {
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
    this.threads.push({ inst, handler, pc: 0, stack: [], temps: new Array(handler.temps).fill(0), other, waitUntil: 0, waitFor: null, loop: null });
  }

  private runAll(): void {
    const now = this.host.now();
    for (const t of [...this.threads]) {
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

  private resolve(t: Thread, ref: { self: true } | { entity: string } | { other: true }): Value {
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
        case 'halt':
          return this.finish(t);
      }
    }
  }
}
