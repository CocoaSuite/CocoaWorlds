/**
 * Checking and compiling scripts (D6). The checker reports problems in plain language, pointing at the block;
 * the compiler turns each handler into a flat list of instructions for the VM. A handler with an error is
 * reported and left out, so one broken script never stops the rest of the game.
 */
import type { Direction, Expr, Handler, Ref, Script, Statement, ValueType } from './model';

/** What the checker needs to know about the scene. */
export interface SceneInfo {
  /** Every object id with its name and whether it is a trigger zone. */
  objects: Map<string, { name: string; isZone: boolean }>;
}

export interface Problem {
  /** The object whose script has the problem. */
  owner: string;
  handler: string;
  block: string;
  severity: 'error' | 'warning';
  message: string;
}

export type Value = number | boolean | string | { ref: string } | null;

export type Op =
  | { op: 'push'; v: Value }
  | { op: 'ref'; ref: Ref }
  | { op: 'var'; slot: number }
  | { op: 'setvar'; slot: number }
  | { op: 'temp'; slot: number }
  | { op: 'settemp'; slot: number }
  | { op: 'maths'; f: '+' | '-' | '×' | '÷' | 'mod' }
  | { op: 'join' }
  | { op: 'compare'; f: '=' | '≠' | '<' | '>' | '≤' | '≥' }
  | { op: 'logic'; f: 'and' | 'or' }
  | { op: 'not' }
  | { op: 'random' }
  | { op: 'time' }
  | { op: 'jmp'; to: number }
  | { op: 'jmpf'; to: number }
  /**
   * Pops `argc` arguments then a target ref; asks the host to act; waits if the action takes time.
   * Arguments: move [distance, dx, dy, dz, seconds] · turn [axis, degrees, seconds] · return [seconds] · others none.
   */
  | { op: 'act'; name: ActionName; argc: number }
  | { op: 'wait' }
  /** Pops the target ref (or null for everyone). */
  | { op: 'send'; message: string }
  | { op: 'log' }
  /** Pops an amount: hurt or heal the player, or add to the score. */
  | { op: 'game'; name: GameAction }
  /** Pushes the player's health or the score. */
  | { op: 'read'; name: GameValue }
  | { op: 'halt' };

export type GameAction = 'hurt' | 'heal' | 'addScore';
export type GameValue = 'health' | 'score';

export type ActionName = 'move' | 'turn' | 'return' | 'show' | 'hide' | 'turnOn' | 'turnOff';

export type CompiledEvent =
  | { kind: 'start' }
  | { kind: 'enter' | 'leave'; zone: string }
  | { kind: 'message'; message: string }
  | { kind: 'use' }
  | { kind: 'die' }
  | { kind: 'every'; seconds: number };

export interface CompiledHandler {
  id: string;
  event: CompiledEvent;
  code: Op[];
  /** For each instruction, the statement block it belongs to (for highlighting the running block). */
  blocks: string[];
  temps: number;
}

export interface Program {
  owner: string;
  variables: { name: string; type: ValueType; initial: Value }[];
  handlers: CompiledHandler[];
}

export const DIRECTIONS: Record<Direction, [number, number, number]> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

type Kind = ValueType | 'unknown';

/** Check and compile one object's script. */
export function compileScript(owner: string, script: Script, scene: SceneInfo): { program: Program; problems: Problem[] } {
  const problems: Problem[] = [];
  const vars = new Map(script.variables.map((v, i) => [v.name, { slot: i, type: v.type as Kind }]));
  const program: Program = {
    owner,
    variables: script.variables.map((v) => ({ name: v.name, type: v.type, initial: v.initial as Value })),
    handlers: [],
  };
  const seen = new Set<string>();
  for (const v of script.variables) {
    if (seen.has(v.name)) problems.push({ owner, handler: '', block: '', severity: 'error', message: `Two variables are called “${v.name}”.` });
    seen.add(v.name);
  }
  for (const h of script.handlers) {
    const before = problems.length;
    const c = new HandlerCompiler(owner, h, vars, scene, problems);
    const compiled = c.compile();
    const failed = problems.slice(before).some((p) => p.severity === 'error');
    if (compiled && !failed) program.handlers.push(compiled);
  }
  return { program, problems };
}

class HandlerCompiler {
  private code: Op[] = [];
  private blocks: string[] = [];
  private temps = 0;
  private stmt = '';
  private waits = false;

  constructor(
    private owner: string,
    private h: Handler,
    private vars: Map<string, { slot: number; type: Kind }>,
    private scene: SceneInfo,
    private problems: Problem[],
  ) {}

  private problem(block: string, message: string, severity: 'error' | 'warning' = 'error') {
    this.problems.push({ owner: this.owner, handler: this.h.id, block, severity, message });
  }

  private emit(op: Op): number {
    this.code.push(op);
    this.blocks.push(this.stmt);
    return this.code.length - 1;
  }

  compile(): CompiledHandler | null {
    const ev = this.h.event;
    let event: CompiledEvent | null = null;
    this.stmt = ev.id;
    if (ev.kind === 'start') event = { kind: 'start' };
    else if (ev.kind === 'use') event = { kind: 'use' };
    else if (ev.kind === 'die') event = { kind: 'die' };
    else if (ev.kind === 'enter' || ev.kind === 'leave') {
      const zone = this.resolveRef(ev.zone, ev.id, true);
      if (zone) event = { kind: ev.kind, zone };
    } else if (ev.kind === 'message') {
      if (!ev.message.trim()) this.problem(ev.id, 'Give the message a name.');
      else event = { kind: 'message', message: ev.message.trim() };
    } else if (ev.kind === 'every') {
      if (ev.seconds.kind !== 'number' || !(ev.seconds.value > 0)) this.problem(ev.seconds.id, '“Every” needs a number of seconds above 0.');
      else event = { kind: 'every', seconds: Math.max(0.05, ev.seconds.value) };
    }
    this.statements(this.h.body);
    this.emit({ op: 'halt' });
    if (!event) return null;
    return { id: this.h.id, event, code: this.code, blocks: this.blocks, temps: this.temps };
  }

  /** Object refs: `self` is the script's owner; `other` is the thing that entered or left. */
  private resolveRef(ref: Ref, block: string, mustBeZone = false): string | null {
    if ('self' in ref) {
      if (mustBeZone && !this.scene.objects.get(this.owner)?.isZone) {
        this.problem(block, 'This object is not a trigger zone. Pick a zone, or add a Trigger zone to this object.');
        return null;
      }
      return this.owner;
    }
    if ('other' in ref) {
      if (mustBeZone) {
        this.problem(block, 'Pick a trigger zone here.');
        return null;
      }
      if (!this.otherAllowed()) {
        this.problem(block, '“The thing that entered” only works inside “When something enters or leaves” or “When the player uses this”.');
        return null;
      }
      return 'other';
    }
    const o = this.scene.objects.get(ref.entity);
    if (!o) {
      this.problem(block, 'The object this block points at no longer exists. Pick another one.');
      return null;
    }
    if (mustBeZone && !o.isZone) {
      this.problem(block, `${o.name} is not a trigger zone.`);
      return null;
    }
    return ref.entity;
  }

  private otherAllowed(): boolean {
    return this.h.event.kind === 'enter' || this.h.event.kind === 'leave' || this.h.event.kind === 'use';
  }

  private pushRef(ref: Ref, block: string): void {
    const r = this.resolveRef(ref, block);
    this.emit(r === null ? { op: 'push', v: null } : { op: 'ref', ref });
  }

  private statements(list: Statement[]): void {
    for (const s of list) this.statement(s);
  }

  private statement(s: Statement): void {
    const outer = this.stmt;
    this.stmt = s.id;
    switch (s.kind) {
      case 'move':
      case 'turn':
      case 'return': {
        this.pushRef(s.target, s.id);
        let argc = 1;
        if (s.kind === 'move') {
          const d = DIRECTIONS[s.direction];
          if (!d) this.problem(s.id, 'Pick a direction.');
          this.expect(s.distance, 'number', 'The distance must be a number.');
          for (const c of d ?? [0, 0, 0]) this.emit({ op: 'push', v: c });
          argc = 4;
        } else if (s.kind === 'turn') {
          this.emit({ op: 'push', v: s.axis });
          this.expect(s.degrees, 'number', 'The angle must be a number.');
          argc = 2;
        } else argc = 0;
        this.expect(s.seconds, 'number', 'The time must be a number of seconds.');
        this.emit({ op: 'act', name: s.kind, argc: argc + 1 });
        this.waits = true;
        break;
      }
      case 'show':
      case 'hide':
      case 'turnOn':
      case 'turnOff':
        this.pushRef(s.target, s.id);
        this.emit({ op: 'act', name: s.kind, argc: 0 });
        break;
      case 'wait':
        this.expect(s.seconds, 'number', 'Wait needs a number of seconds.');
        this.emit({ op: 'wait' });
        this.waits = true;
        break;
      case 'send':
        if (!s.message.trim()) this.problem(s.id, 'Give the message a name.');
        if (s.to) this.pushRef(s.to, s.id);
        else this.emit({ op: 'push', v: null });
        this.emit({ op: 'send', message: s.message.trim() });
        break;
      case 'log':
        this.value(s.text);
        this.emit({ op: 'log' });
        break;
      case 'set': {
        const v = this.vars.get(s.variable);
        if (!v) {
          this.problem(s.id, s.variable ? `There is no variable called “${s.variable}”.` : 'Pick a variable.');
          break;
        }
        this.expect(s.value, v.type, `${s.variable} holds ${article(v.type)}.`);
        this.emit({ op: 'setvar', slot: v.slot });
        break;
      }
      case 'change': {
        const v = this.vars.get(s.variable);
        if (!v) {
          this.problem(s.id, s.variable ? `There is no variable called “${s.variable}”.` : 'Pick a variable.');
          break;
        }
        if (v.type !== 'number') this.problem(s.id, `Only number variables can be changed by an amount; ${s.variable} holds ${article(v.type)}.`);
        this.emit({ op: 'var', slot: v.slot });
        this.expect(s.by, 'number', 'Change by needs a number.');
        this.emit({ op: 'maths', f: '+' });
        this.emit({ op: 'setvar', slot: v.slot });
        break;
      }
      case 'if': {
        this.expect(s.condition, 'boolean', 'The condition must be yes-or-no (a comparison, “and”, “or”, “not”).');
        const jf = this.emit({ op: 'jmpf', to: -1 });
        this.statements(s.then);
        if (s.otherwise) {
          this.stmt = s.id;
          const j = this.emit({ op: 'jmp', to: -1 });
          (this.code[jf] as { to: number }).to = this.code.length;
          this.statements(s.otherwise);
          (this.code[j] as { to: number }).to = this.code.length;
        } else {
          (this.code[jf] as { to: number }).to = this.code.length;
        }
        break;
      }
      case 'repeat': {
        const count = this.temps++, i = this.temps++;
        this.expect(s.times, 'number', 'Repeat needs a number of times.');
        this.emit({ op: 'settemp', slot: count });
        this.emit({ op: 'push', v: 0 });
        this.emit({ op: 'settemp', slot: i });
        const top = this.code.length;
        this.emit({ op: 'temp', slot: i });
        this.emit({ op: 'temp', slot: count });
        this.emit({ op: 'compare', f: '<' });
        const jf = this.emit({ op: 'jmpf', to: -1 });
        this.statements(s.body);
        this.stmt = s.id;
        this.emit({ op: 'temp', slot: i });
        this.emit({ op: 'push', v: 1 });
        this.emit({ op: 'maths', f: '+' });
        this.emit({ op: 'settemp', slot: i });
        this.emit({ op: 'jmp', to: top });
        (this.code[jf] as { to: number }).to = this.code.length;
        break;
      }
      case 'forever': {
        const before = this.waits;
        this.waits = false;
        const top = this.code.length;
        this.statements(s.body);
        if (!this.waits) this.problem(s.id, 'This loop never waits, so it would freeze the game. Add a Wait (or a Move or Turn) inside it.', 'warning');
        this.waits = this.waits || before;
        this.stmt = s.id;
        this.emit({ op: 'jmp', to: top });
        break;
      }
      case 'stop':
        this.emit({ op: 'halt' });
        break;
      case 'hurt':
      case 'heal':
      case 'addScore':
        this.expect(s.amount, 'number', s.kind === 'addScore' ? 'The score changes by a number.' : 'Health changes by a number.');
        this.emit({ op: 'game', name: s.kind });
        break;
    }
    this.stmt = outer;
  }

  private expect(e: Expr, type: Kind, message: string): void {
    const got = this.value(e);
    if (got !== 'unknown' && got !== type) this.problem(e.id, message);
  }

  /** Emit code that leaves the expression's value on the stack; returns its type. */
  private value(e: Expr): Kind {
    switch (e.kind) {
      case 'number':
        this.emit({ op: 'push', v: Number.isFinite(e.value) ? e.value : 0 });
        return 'number';
      case 'boolean':
        this.emit({ op: 'push', v: !!e.value });
        return 'boolean';
      case 'text':
        this.emit({ op: 'push', v: String(e.value) });
        return 'text';
      case 'variable': {
        const v = this.vars.get(e.name);
        if (!v) {
          this.problem(e.id, e.name ? `There is no variable called “${e.name}”.` : 'Pick a variable.');
          this.emit({ op: 'push', v: null });
          return 'unknown';
        }
        this.emit({ op: 'var', slot: v.slot });
        return v.type;
      }
      case 'maths':
        this.expect(e.a, 'number', 'Maths needs numbers on both sides.');
        this.expect(e.b, 'number', 'Maths needs numbers on both sides.');
        this.emit({ op: 'maths', f: e.op });
        return 'number';
      case 'compare': {
        const a = this.value(e.a), b = this.value(e.b);
        if (e.op === '=' || e.op === '≠') {
          if (a !== 'unknown' && b !== 'unknown' && a !== b) this.problem(e.id, 'These two things can never be equal: they are different kinds of value.', 'warning');
        } else if ((a !== 'unknown' && a !== 'number') || (b !== 'unknown' && b !== 'number')) {
          this.problem(e.id, 'Bigger and smaller only work with numbers.');
        }
        this.emit({ op: 'compare', f: e.op });
        return 'boolean';
      }
      case 'logic':
        this.expect(e.a, 'boolean', `“${e.op}” joins two yes-or-no conditions.`);
        this.expect(e.b, 'boolean', `“${e.op}” joins two yes-or-no conditions.`);
        this.emit({ op: 'logic', f: e.op });
        return 'boolean';
      case 'not':
        this.expect(e.a, 'boolean', '“not” needs a yes-or-no condition.');
        this.emit({ op: 'not' });
        return 'boolean';
      case 'random':
        this.expect(e.min, 'number', 'Random needs numbers.');
        this.expect(e.max, 'number', 'Random needs numbers.');
        this.emit({ op: 'random' });
        return 'number';
      case 'join':
        this.value(e.a);
        this.value(e.b);
        this.emit({ op: 'join' });
        return 'text';
      case 'object':
        this.pushRef(e.ref, e.id);
        return 'object';
      case 'time':
        this.emit({ op: 'time' });
        return 'number';
      case 'health':
      case 'score':
        this.emit({ op: 'read', name: e.kind });
        return 'number';
    }
  }
}

const article = (t: Kind) => (t === 'number' ? 'a number' : t === 'boolean' ? 'yes or no' : t === 'text' ? 'text' : t === 'object' ? 'an object' : 'a value');
