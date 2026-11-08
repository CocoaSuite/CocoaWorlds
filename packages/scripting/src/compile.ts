/**
 * Checking and compiling scripts (D6). The checker reports problems in plain language, pointing at the block;
 * the compiler turns each handler into a flat list of instructions for the VM. A handler with an error is
 * reported and left out, so one broken script never stops the rest of the game.
 */
import type { Direction, Expr, LightProp, Handler, Place, Ref, Script, Statement, ValueType } from './model';

/** What the checker needs to know about the scene. */
export interface SceneInfo {
  /** Every object id with its name and whether it is a trigger zone. */
  objects: Map<string, { name: string; isZone: boolean }>;
  /** Which built-in game systems the project uses (missing: all on). */
  rules?: { health: boolean; score: boolean };
  /** Game values shared by every script (Cash, Round …). */
  globals?: { name: string; type: Exclude<ValueType, 'object'> }[];
  /** Objects that are text signs (for “Set the text of”). */
  signs?: Set<string>;
  /** Objects that are lights (for the light blocks). */
  lights?: Set<string>;
  /** The screen UI: screens and their elements by id (missing: not checked). */
  ui?: { screens: Map<string, string>; elements: Map<string, { name: string; kind: string }> };
  /** The items the player can carry (missing: not checked). */
  items?: Set<string>;
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
   * Arguments: move [distance, dx, dy, dz, seconds] · turn, turnTo [axis, degrees, seconds] · return [seconds] ·
   * scale [factor, seconds] · push [dx, dy, dz, strength] · moveTo [place, seconds, gap] · teleport [place] ·
   * damage [amount] · others none.
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
  /** Read or write a game value (shared by all scripts). */
  | { op: 'gvar'; name: string }
  | { op: 'setgvar'; name: string }
  /** Pops seconds, then text: show a message on screen. */
  | { op: 'say' }
  /** Pops text, then the target: change a sign's text. */
  | { op: 'settext' }
  /** Pops the place, then the template: make a copy; the stack remembers it as “the new copy”. */
  | { op: 'spawn' }
  /** Pushes the new copy (or nothing). */
  | { op: 'copy' }
  /** Pops an object; pushes its variable called `name` (nothing if it has none). */
  | { op: 'varof'; name: string }
  /** Pops loudness, volume, then the place (null: everywhere): play `sound`. */
  | { op: 'sound'; sound: string }
  /** Pops loudness, then the place: a noise. */
  | { op: 'noise' }
  | { op: 'explode' }
  /** Pops sureness, spread, then the place: a hint for hunting creatures. */
  | { op: 'hint'; as: 'sound' | 'sighting' | 'event' }
  /** Pops an object: stop its sounds. */
  | { op: 'stopsound' }
  /** Pops an object: play its model's animation. */
  | { op: 'anim'; name: string; loop: boolean }
  /** Pops the zone, then the thing: pushes whether it is inside the zone now. */
  | { op: 'inside' }
  /** Pops two places (objects or the player): pushes how far apart they are. */
  | { op: 'dist' }
  /** Show or hide a screen or one element of the screen UI. */
  | { op: 'ui'; what: 'screen' | 'element'; id: string; show: boolean | 'toggle' }
  /** Pops text: add it to a list, or remove the first row with it. */
  | { op: 'row'; id: string; add: boolean }
  | { op: 'clearlist'; id: string }
  /** Pushes the row picked in “When the player picks a row”. */
  | { op: 'picked' }
  /** Pushes the real time in seconds since 1970. */
  | { op: 'clock' }
  /** Kept values and items back to the start. */
  | { op: 'forget' }
  | { op: 'savegame' }
  | { op: 'saveblock'; on: boolean }
  | { op: 'scene'; scene: string; landmark: string }
  /** Pops text: change what an element says. */
  | { op: 'uitext'; id: string }
  /** Pops an amount: give (or with a minus, take) some of an item. */
  | { op: 'item'; name: string; sign: 1 | -1 }
  /** Pushes how many of an item the player has. */
  | { op: 'count'; name: string }
  /** Pushes the item in the picked hotbar slot. */
  | { op: 'selitem' }
  /** Pops an object (or yes: anything); pushes whether the player holds it (or a copy of it). */
  | { op: 'holds' }
  /** Pushes whether the player is hiding. */
  | { op: 'hiding' }
  /** Pops seconds, a value and a light: change one of its settings. */
  | { op: 'light'; prop: LightProp }
  /** Pops seconds, a strength and an object: how bright its model glows. */
  | { op: 'glow' }
  /** Pops hours: the time of day. Pushes the time of day. */
  | { op: 'settime' }
  | { op: 'gettime' }
  /** Pops a day number: the day count. Pushes the day count. */
  | { op: 'setday' }
  | { op: 'getday' }
  /** Pops a day number; pushes whether today is that day. */
  | { op: 'isday' }
  /** Pops a light; pushes whether it is on. */
  | { op: 'lit' }
  | { op: 'halt' };

/** How far (units) “When the player uses this” reaches unless it says otherwise. */
export const USE_REACH = 96;

export type GameAction = 'hurt' | 'heal' | 'addScore' | 'giveArmour';
export type GameValue = 'health' | 'score' | 'armour';

export type ActionName = 'move' | 'turn' | 'turnTo' | 'return' | 'show' | 'hide' | 'turnOn' | 'turnOff' | 'startTrain' | 'stopTrain' | 'walkTo' | 'runAway' | 'wander' | 'setSide' | 'freeze' | 'unfreeze' | 'viewFrom' | 'remove' | 'scale' | 'physical' | 'push' | 'moveTo' | 'teleport' | 'damage' | 'place' | 'pickUp' | 'drop' | 'unhide' | 'silence' | 'unsilence';

export type CompiledEvent =
  | { kind: 'start' }
  | { kind: 'enter' | 'leave'; zone: string }
  | { kind: 'message' | 'messageStop'; message: string }
  | { kind: 'use'; prompt: string; reach: number }
  | { kind: 'useHolding'; item: string | null; reach: number }
  | { kind: 'die' }
  | { kind: 'breaks' }
  | { kind: 'hit' }
  | { kind: 'dies' }
  | { kind: 'hides' | 'unhides' | 'found' | 'sits' | 'stands' }
  | { kind: 'every'; seconds: number }
  | { kind: 'newDay' }
  | { kind: 'dayStarts'; day: number }
  | { kind: 'atHour'; hour: number }
  | { kind: 'near' | 'far'; distance: number }
  | { kind: 'uiClick'; element: string }
  | { kind: 'useItem'; item: string }
  | { kind: 'listPick'; list: string }
  | { kind: 'key'; key: string }
  | { kind: 'press'; key: string; prompt: string; reach: number }
  | { kind: 'does'; what: string };

export interface CompiledHandler {
  id: string;
  event: CompiledEvent;
  code: Op[];
  /** For each instruction, the statement block it belongs to (for highlighting the running block). */
  blocks: string[];
  temps: number;
  /** Runs only once ever, or once a day. */
  limit?: 'once' | 'day';
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

  /** A variable by name: the script's own first, then a game value. */
  private lookup(name: string): { slot: number; type: Kind } | { global: string; type: Kind } | undefined {
    const own = this.vars.get(name);
    if (own) return own;
    const g = this.scene.globals?.find((v) => v.name === name);
    return g ? { global: g.name, type: g.type } : undefined;
  }

  private load(v: { slot: number } | { global: string }): void {
    this.emit('global' in v ? { op: 'gvar', name: v.global } : { op: 'var', slot: v.slot });
  }

  private store(v: { slot: number } | { global: string }): void {
    this.emit('global' in v ? { op: 'setgvar', name: v.global } : { op: 'setvar', slot: v.slot });
  }

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
    else if (ev.kind === 'use') {
      const reach = ev.reach ? this.reachOf(ev.reach) : USE_REACH;
      if (reach !== null) event = { kind: 'use', prompt: (ev.prompt ?? '').trim(), reach };
    } else if (ev.kind === 'useHolding') {
      const reach = this.reachOf(ev.reach);
      const item = ev.item ? this.resolveRef(ev.item, ev.id) : null;
      if (item === 'player' || item === 'other' || item === 'held') this.problem(ev.id, 'Pick an object the player could hold (or “anything”).');
      else if (reach !== null && (!ev.item || item)) event = { kind: 'useHolding', item: item === 'self' ? this.owner : item, reach };
    }
    else if (ev.kind === 'breaks') event = { kind: 'breaks' };
    else if (ev.kind === 'hit') event = { kind: 'hit' };
    else if (ev.kind === 'dies') event = { kind: 'dies' };
    else if (ev.kind === 'hides' || ev.kind === 'unhides' || ev.kind === 'found' || ev.kind === 'sits' || ev.kind === 'stands') event = { kind: ev.kind };
    else if (ev.kind === 'die') {
      event = { kind: 'die' };
      this.ruleOff('health', ev.id);
    }
    else if (ev.kind === 'enter' || ev.kind === 'leave') {
      const zone = this.resolveRef(ev.zone, ev.id, true);
      if (zone) event = { kind: ev.kind, zone };
    } else if (ev.kind === 'message' || ev.kind === 'messageStop') {
      if (!ev.message.trim()) this.problem(ev.id, 'Give the message a name.');
      else event = { kind: ev.kind, message: ev.message.trim() };
    } else if (ev.kind === 'uiClick') {
      if (this.checkElement(ev.element, ev.id, 'button')) event = { kind: 'uiClick', element: ev.element };
    } else if (ev.kind === 'listPick') {
      if (this.checkElement(ev.list, ev.id, 'list')) event = { kind: 'listPick', list: ev.list };
    } else if (ev.kind === 'does') event = { kind: 'does', what: ev.what ?? '' };
    else if (ev.kind === 'key') {
      if (!/^(Key[A-Z]|Tab|Digit0)$/.test(ev.key)) this.problem(ev.id, 'Pick a key.');
      else event = { kind: 'key', key: ev.key };
    } else if (ev.kind === 'press') {
      const reach = ev.reach ? this.reachOf(ev.reach) : USE_REACH;
      if (!/^(Key[A-Z]|Tab|Digit0)$/.test(ev.key)) this.problem(ev.id, 'Pick a key.');
      else if (reach !== null) event = { kind: 'press', key: ev.key, prompt: (ev.prompt ?? '').trim(), reach };
    } else if (ev.kind === 'useItem') {
      if (!ev.item || this.checkItem(ev.item, ev.id)) event = { kind: 'useItem', item: ev.item };
    } else if (ev.kind === 'every') {
      if (ev.seconds.kind !== 'number' || !(ev.seconds.value > 0)) this.problem(ev.seconds.id, '“Every” needs a number of seconds above 0.');
      else event = { kind: 'every', seconds: Math.max(0.05, ev.seconds.value) };
    } else if (ev.kind === 'newDay') event = { kind: 'newDay' };
    else if (ev.kind === 'dayStarts') {
      if (ev.day.kind !== 'number' || !(ev.day.value >= 0)) this.problem(ev.day.id, 'The day needs to be a number from 0 up.');
      else event = { kind: 'dayStarts', day: Math.round(ev.day.value) };
    }
    else if (ev.kind === 'atHour') {
      if (ev.hour.kind !== 'number' || !(ev.hour.value >= 0 && ev.hour.value <= 24)) this.problem(ev.hour.id, 'The hour needs to be a number from 0 to 24.');
      else event = { kind: 'atHour', hour: ev.hour.value % 24 };
    } else if (ev.kind === 'near' || ev.kind === 'far') {
      if (ev.distance.kind !== 'number' || !(ev.distance.value > 0)) this.problem(ev.distance.id, 'The distance needs to be a number above 0.');
      else event = { kind: ev.kind, distance: ev.distance.value };
    }
    this.statements(this.h.body);
    this.emit({ op: 'halt' });
    if (!event) return null;
    // (“Only once” on Use stacks was saved as `once` before every event had a limit.)
    const old = this.h.event as { kind: string; limit?: 'once' | 'day'; once?: boolean };
    const limit = old.limit ?? (old.kind === 'use' && old.once ? 'once' : undefined);
    return { id: this.h.id, event, code: this.code, blocks: this.blocks, temps: this.temps, ...(limit ? { limit } : {}) };
  }

  /** Object refs: `self` is the script's owner; `other` is the thing that entered or left. */
  private resolveRef(ref: Ref, block: string, mustBeZone = false): string | null {
    if ('player' in ref) {
      if (mustBeZone) {
        this.problem(block, 'Pick a trigger zone here.');
        return null;
      }
      return 'player';
    }
    if ('self' in ref) {
      if (mustBeZone && !this.scene.objects.get(this.owner)?.isZone) {
        this.problem(block, 'This object is not a trigger zone. Pick a zone, or add a Trigger zone to this object.');
        return null;
      }
      return this.owner;
    }
    if ('held' in ref) {
      if (mustBeZone) {
        this.problem(block, 'Pick a trigger zone here.');
        return null;
      }
      return 'held';
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

  /** A screen picked in a block: it must exist. */
  private checkScreen(id: string, block: string): boolean {
    if (!id) return this.problem(block, 'Pick a screen (make screens in the Screens workspace).'), false;
    if (this.scene.ui && !this.scene.ui.screens.has(id)) return this.problem(block, 'The screen this block points at no longer exists. Pick another one.'), false;
    return true;
  }

  /** An element picked in a block: it must exist (and be a button, for clicks). */
  private checkElement(id: string, block: string, kind?: string): boolean {
    if (!id)
      return this.problem(block, kind === 'button' ? 'Pick a button (make them in the Screens workspace).' : kind === 'list' ? 'Pick a list (make them in the Screens workspace).' : 'Pick something on a screen (make it in the Screens workspace).'), false;
    const e = this.scene.ui?.elements.get(id);
    if (this.scene.ui && !e) return this.problem(block, 'The screen element this block points at no longer exists. Pick another one.'), false;
    if (e && kind && e.kind !== kind) return this.problem(block, `${e.name} is not a ${kind === 'list' ? 'list' : 'button'}.`), false;
    return true;
  }

  /** An item named in a block: it must be one of the scene's items. */
  private checkItem(name: string, block: string): boolean {
    if (!name) return this.problem(block, 'Pick an item (make items in the Screens workspace).'), false;
    if (this.scene.items && !this.scene.items.has(name)) return this.problem(block, `There is no item called “${name}”.`), false;
    return true;
  }

  /** A block for a game system the project has switched off still compiles, with a warning. */
  private ruleOff(rule: 'health' | 'score', block: string): void {
    if (this.scene.rules && !this.scene.rules[rule])
      this.problem(
        block,
        rule === 'health'
          ? 'Health is off for this project (Project settings), so this block does nothing.'
          : 'The score is off for this project (Project settings), so this block does nothing.',
        'warning',
      );
  }

  private otherAllowed(): boolean {
    return this.h.event.kind === 'enter' || this.h.event.kind === 'leave' || this.h.event.kind === 'use' || this.h.event.kind === 'useHolding';
  }

  /** A reach (units): a plain number above 0. */
  private reachOf(e: Expr): number | null {
    if (e.kind !== 'number' || !(e.value > 0)) {
      this.problem(e.id, 'The reach needs to be a number above 0.');
      return null;
    }
    return e.value;
  }

  private pushRef(ref: Ref, block: string): void {
    const r = this.resolveRef(ref, block);
    this.emit(r === null ? { op: 'push', v: null } : { op: 'ref', ref });
  }

  /** A place: an object's position, or “aim” for where the player is looking. */
  private pushPlace(place: Place, block: string): void {
    if ('aim' in place) this.emit({ op: 'push', v: 'aim' });
    else this.pushRef(place, block);
  }

  /** The target of an object action; the player can only be pushed. */
  private actTarget(ref: Ref, block: string, playerOk = false): void {
    if ('player' in ref && !playerOk) this.problem(block, 'This block works on objects, not on the player.');
    this.pushRef(ref, block);
  }

  private lightTarget(ref: Ref, block: string): void {
    const r = 'player' in ref ? null : this.resolveRef(ref, block);
    if ('player' in ref || (r && r !== 'other' && r !== 'held' && this.scene.lights && !this.scene.lights.has(r)))
      this.problem(block, `${(r && this.scene.objects.get(r)?.name) ?? 'This'} is not a light. Pick a light, or add a Light to it.`);
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
      case 'turnTo':
      case 'return': {
        this.actTarget(s.target, s.id);
        let argc = 1;
        if (s.kind === 'move') {
          const d = DIRECTIONS[s.direction];
          if (!d) this.problem(s.id, 'Pick a direction.');
          this.expect(s.distance, 'number', 'The distance must be a number.');
          for (const c of d ?? [0, 0, 0]) this.emit({ op: 'push', v: c });
          argc = 4;
        } else if (s.kind === 'turn' || s.kind === 'turnTo') {
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
      case 'startTrain':
      case 'stopTrain':
        this.actTarget(s.target, s.id);
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
        const v = this.lookup(s.variable);
        if (!v) {
          this.problem(s.id, s.variable ? `There is no variable called “${s.variable}”.` : 'Pick a variable.');
          break;
        }
        this.expect(s.value, v.type, `${s.variable} holds ${article(v.type)}.`);
        this.store(v);
        break;
      }
      case 'change': {
        const v = this.lookup(s.variable);
        if (!v) {
          this.problem(s.id, s.variable ? `There is no variable called “${s.variable}”.` : 'Pick a variable.');
          break;
        }
        if (v.type !== 'number') this.problem(s.id, `Only number variables can be changed by an amount; ${s.variable} holds ${article(v.type)}.`);
        this.load(v);
        this.expect(s.by, 'number', 'Change by needs a number.');
        this.emit({ op: 'maths', f: '+' });
        this.store(v);
        break;
      }
      case 'say':
        this.value(s.text);
        this.expect(s.seconds, 'number', 'Show for a number of seconds.');
        this.emit({ op: 'say' });
        break;
      case 'setText': {
        const r = this.resolveRef(s.target, s.id);
        if (r && r !== 'other' && this.scene.signs && !this.scene.signs.has(r))
          this.problem(s.id, `${this.scene.objects.get(r)?.name ?? 'This object'} is not a text sign. Add a Text sign to it, or pick a sign.`);
        this.emit(r === null ? { op: 'push', v: null } : { op: 'ref', ref: s.target });
        this.value(s.text);
        this.emit({ op: 'settext' });
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
      case 'oneOf': {
        const n = s.options.length;
        if (!n) {
          this.problem(s.id, 'Add at least one choice.');
          break;
        }
        const slot = this.temps++;
        this.emit({ op: 'push', v: 0 });
        this.emit({ op: 'push', v: n - 1 });
        this.emit({ op: 'random' });
        this.emit({ op: 'settemp', slot });
        const ends: number[] = [];
        s.options.forEach((list, i) => {
          let jf = -1;
          if (i < n - 1) {
            this.emit({ op: 'temp', slot });
            this.emit({ op: 'push', v: i });
            this.emit({ op: 'compare', f: '=' });
            jf = this.emit({ op: 'jmpf', to: -1 });
          }
          this.statements(list);
          this.stmt = s.id;
          if (i < n - 1) {
            ends.push(this.emit({ op: 'jmp', to: -1 }));
            (this.code[jf] as { to: number }).to = this.code.length;
          }
        });
        for (const j of ends) (this.code[j] as { to: number }).to = this.code.length;
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
      case 'while': {
        // Checks the condition, runs the blocks, then waits for the next frame: it can never freeze the game.
        const top = this.code.length;
        this.expect(s.condition, 'boolean', 'The condition must be yes-or-no (a comparison, “is inside”, “and”, “or”, “not”).');
        const jf = this.emit({ op: 'jmpf', to: -1 });
        this.statements(s.body);
        this.stmt = s.id;
        this.emit({ op: 'push', v: 0 });
        this.emit({ op: 'wait' });
        this.emit({ op: 'jmp', to: top });
        (this.code[jf] as { to: number }).to = this.code.length;
        this.waits = true;
        break;
      }
      case 'stop':
        this.emit({ op: 'halt' });
        break;
      case 'showScreen':
      case 'hideScreen':
      case 'toggleScreen':
        if (this.checkScreen(s.screen, s.id)) this.emit({ op: 'ui', what: 'screen', id: s.screen, show: s.kind === 'toggleScreen' ? 'toggle' : s.kind === 'showScreen' });
        break;
      case 'addRow':
      case 'removeRow':
        this.checkElement(s.list, s.id, 'list');
        this.value(s.text);
        this.emit({ op: 'row', id: s.list, add: s.kind === 'addRow' });
        break;
      case 'clearList':
        if (this.checkElement(s.list, s.id, 'list')) this.emit({ op: 'clearlist', id: s.list });
        break;
      case 'forgetProgress':
        this.emit({ op: 'forget' });
        break;
      case 'saveGame':
        this.emit({ op: 'savegame' });
        break;
      case 'blockSaving':
      case 'allowSaving':
        this.emit({ op: 'saveblock', on: s.kind === 'blockSaving' });
        break;
      case 'changeScene':
        if (!s.scene.trim()) this.problem(s.id, 'Pick the scene to go to.');
        this.emit({ op: 'scene', scene: s.scene.trim(), landmark: s.landmark.trim() });
        break;
      case 'showUi':
      case 'hideUi':
        if (this.checkElement(s.element, s.id)) this.emit({ op: 'ui', what: 'element', id: s.element, show: s.kind === 'showUi' });
        break;
      case 'setUiText': {
        // (A problem here is an error, so the stack is left out of the game.)
        this.checkElement(s.element, s.id);
        const e = this.scene.ui?.elements.get(s.element);
        if (e && e.kind !== 'text' && e.kind !== 'button') this.problem(s.id, `${e.name} has no text: pick a text or a button.`);
        this.value(s.text);
        this.emit({ op: 'uitext', id: s.element });
        break;
      }
      case 'giveItem':
      case 'takeItem':
        this.checkItem(s.item, s.id);
        this.expect(s.amount, 'number', 'How many must be a number.');
        this.emit({ op: 'item', name: s.item, sign: s.kind === 'giveItem' ? 1 : -1 });
        break;
      case 'spawn':
        if ('player' in s.template) this.problem(s.id, 'Pick an object to copy.');
        this.pushRef(s.template, s.id);
        this.pushPlace(s.at, s.id);
        this.emit({ op: 'spawn' });
        break;
      case 'remove':
      case 'physical':
        this.actTarget(s.target, s.id);
        this.emit({ op: 'act', name: s.kind, argc: 0 });
        break;
      case 'scale':
        this.actTarget(s.target, s.id);
        this.expect(s.factor, 'number', 'The size must be a number (1 is its starting size).');
        this.expect(s.seconds, 'number', 'The time must be a number of seconds.');
        this.emit({ op: 'act', name: 'scale', argc: 2 });
        this.waits = true;
        break;
      case 'push': {
        this.actTarget(s.target, s.id, true);
        const d = DIRECTIONS[s.direction];
        if (!d) this.problem(s.id, 'Pick a direction.');
        for (const c of d ?? [0, 0, 0]) this.emit({ op: 'push', v: c });
        this.expect(s.strength, 'number', 'The strength must be a number (units per second).');
        this.emit({ op: 'act', name: 'push', argc: 4 });
        break;
      }
      case 'moveTo':
        this.actTarget(s.target, s.id);
        this.pushPlace(s.to, s.id);
        this.expect(s.seconds, 'number', 'The time must be a number of seconds.');
        this.expect(s.gap, 'number', 'The distance to stop short must be a number.');
        this.emit({ op: 'act', name: 'moveTo', argc: 3 });
        this.waits = true;
        break;
      case 'place':
        this.actTarget(s.target, s.id);
        this.pushRef(s.spot, s.id);
        this.emit({ op: 'push', v: s.still });
        this.emit({ op: 'act', name: 'place', argc: 2 });
        break;
      case 'pickUp':
        this.actTarget(s.target, s.id);
        this.emit({ op: 'act', name: 'pickUp', argc: 0 });
        break;
      case 'drop':
        this.emit({ op: 'ref', ref: { player: true } });
        this.emit({ op: 'act', name: 'drop', argc: 0 });
        break;
      case 'unhide':
        this.emit({ op: 'ref', ref: { player: true } });
        this.emit({ op: 'act', name: 'unhide', argc: 0 });
        break;
      case 'silence':
      case 'unsilence':
        this.emit({ op: 'ref', ref: { player: true } });
        this.emit({ op: 'act', name: s.kind, argc: 0 });
        break;
      case 'freezePlayer':
      case 'unfreezePlayer':
        this.emit({ op: 'ref', ref: { player: true } });
        this.emit({ op: 'act', name: s.kind === 'freezePlayer' ? 'freeze' : 'unfreeze', argc: 0 });
        break;
      case 'viewFrom':
        this.actTarget(s.target, s.id);
        this.expect(s.seconds, 'number', 'The time must be a number of seconds.');
        this.emit({ op: 'act', name: 'viewFrom', argc: 1 });
        this.waits = true;
        break;
      case 'setSide':
        this.actTarget(s.target, s.id);
        this.emit({ op: 'push', v: s.side });
        this.emit({ op: 'act', name: 'setSide', argc: 1 });
        break;
      case 'walkTo':
        this.actTarget(s.target, s.id);
        this.pushPlace(s.to, s.id);
        this.emit({ op: 'act', name: 'walkTo', argc: 1 });
        this.waits = true;
        break;
      case 'runAway':
        this.actTarget(s.target, s.id);
        this.expect(s.seconds, 'number', 'The time must be a number of seconds.');
        this.emit({ op: 'act', name: 'runAway', argc: 1 });
        this.waits = true;
        break;
      case 'wander':
        this.actTarget(s.target, s.id);
        this.emit({ op: 'push', v: s.on });
        this.emit({ op: 'act', name: 'wander', argc: 1 });
        break;
      case 'teleport':
        this.emit({ op: 'ref', ref: { player: true } });
        this.pushPlace(s.to, s.id);
        this.emit({ op: 'act', name: 'teleport', argc: 1 });
        break;
      case 'damage':
        this.actTarget(s.target, s.id);
        this.expect(s.amount, 'number', 'Damage must be a number.');
        this.emit({ op: 'act', name: 'damage', argc: 1 });
        break;
      case 'playSound':
        if (!s.sound) this.problem(s.id, 'Pick a sound (import sounds in the Assets tab).');
        if (s.at) this.pushPlace(s.at, s.id);
        else this.emit({ op: 'push', v: null });
        this.expect(s.volume, 'number', 'The volume must be a number (1 is normal).');
        if (s.loudness) this.expect(s.loudness, 'number', 'How loud it is for creatures must be a number (0: they don’t hear it).');
        else this.emit({ op: 'push', v: 0 });
        this.emit({ op: 'sound', sound: s.sound });
        break;
      case 'explode':
        this.pushPlace(s.at, s.id);
        this.expect(s.radius, 'number', 'The size must be a number of units.');
        this.expect(s.amount, 'number', 'Damage must be a number.');
        this.emit({ op: 'explode' });
        break;
      case 'noise':
        this.pushPlace(s.at, s.id);
        this.expect(s.loudness, 'number', 'The loudness must be a number (1: heard as far as a creature hears).');
        this.emit({ op: 'noise' });
        break;
      case 'hint':
        this.pushPlace(s.at, s.id);
        this.expect(s.spread, 'number', '“Give or take” must be a number of units.');
        this.expect(s.sure, 'number', 'How sure must be a number from 0 to 1.');
        this.emit({ op: 'hint', as: s.as });
        break;
      case 'stopSound':
        this.actTarget(s.target, s.id);
        this.emit({ op: 'stopsound' });
        break;
      case 'setLight':
        this.lightTarget(s.target, s.id);
        this.expect(s.value, s.prop === 'color' ? 'text' : 'number', s.prop === 'color' ? 'The colour must be text like #ffcc88.' : 'This must be a number.');
        this.expect(s.seconds, 'number', 'The time must be a number of seconds.');
        this.emit({ op: 'light', prop: s.prop });
        break;
      case 'setTime':
        this.expect(s.value, 'number', 'The time of day is a number of hours (12 is noon).');
        this.emit({ op: 'settime' });
        break;
      case 'setDay':
        this.expect(s.value, 'number', 'The day is a number.');
        this.emit({ op: 'setday' });
        break;
      case 'setGlow':
        this.actTarget(s.target, s.id);
        this.expect(s.strength, 'number', 'The glow must be a number (0 is none).');
        this.expect(s.seconds, 'number', 'The time must be a number of seconds.');
        this.emit({ op: 'glow' });
        break;
      case 'playAnim':
        if (!s.name.trim()) this.problem(s.id, 'Type the name of the animation (as it is called in the model).');
        this.actTarget(s.target, s.id);
        this.emit({ op: 'anim', name: s.name.trim(), loop: s.loop });
        break;
      case 'hurt':
      case 'heal':
      case 'giveArmour':
      case 'addScore':
        this.expect(s.amount, 'number', s.kind === 'addScore' ? 'The score changes by a number.' : s.kind === 'giveArmour' ? 'Armour changes by a number.' : 'Health changes by a number.');
        this.ruleOff(s.kind === 'addScore' ? 'score' : 'health', s.id);
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
        const v = this.lookup(e.name);
        if (!v) {
          this.problem(e.id, e.name ? `There is no variable called “${e.name}”.` : 'Pick a variable.');
          this.emit({ op: 'push', v: null });
          return 'unknown';
        }
        this.load(v);
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
      case 'copy':
        this.emit({ op: 'copy' });
        return 'object';
      case 'varOf':
        if (!e.variable.trim()) this.problem(e.id, 'Type the name of the variable to read.');
        this.pushRef(e.of, e.id);
        this.emit({ op: 'varof', name: e.variable.trim() });
        return 'unknown';
      case 'inside': {
        if (!('player' in e.what)) this.pushRef(e.what, e.id);
        else this.emit({ op: 'ref', ref: e.what });
        const zone = this.resolveRef(e.zone, e.id, true);
        this.emit(zone === null ? { op: 'push', v: null } : { op: 'ref', ref: e.zone });
        this.emit({ op: 'inside' });
        return 'boolean';
      }
      case 'itemCount':
        this.checkItem(e.item, e.id);
        this.emit({ op: 'count', name: e.item });
        return 'number';
      case 'selectedItem':
        this.emit({ op: 'selitem' });
        return 'text';
      case 'clock':
        this.emit({ op: 'clock' });
        return 'number';
      case 'distance':
        for (const r of [e.from, e.to]) {
          if ('player' in r) this.emit({ op: 'ref', ref: r });
          else this.pushRef(r, e.id);
        }
        this.emit({ op: 'dist' });
        return 'number';
      case 'holds':
        if (e.what) this.pushRef(e.what, e.id);
        else this.emit({ op: 'push', v: true });
        this.emit({ op: 'holds' });
        return 'boolean';
      case 'pickedRow':
        if (this.h.event.kind !== 'listPick') this.problem(e.id, '“The picked row” only works inside “When the player picks a row”.');
        this.emit({ op: 'picked' });
        return 'text';
      case 'hiding':
        this.emit({ op: 'hiding' });
        return 'boolean';
      case 'timeOfDay':
        this.emit({ op: 'gettime' });
        return 'number';
      case 'day':
        this.emit({ op: 'getday' });
        return 'number';
      case 'isDay':
        this.expect(e.a, 'number', 'The day is a number.');
        this.emit({ op: 'isday' });
        return 'boolean';
      case 'lightOn':
        this.lightTarget(e.target, e.id);
        this.emit({ op: 'lit' });
        return 'boolean';
      case 'armour':
        this.ruleOff('health', e.id);
        this.emit({ op: 'read', name: 'armour' });
        return 'number';
      case 'health':
      case 'score':
        this.ruleOff(e.kind, e.id);
        this.emit({ op: 'read', name: e.kind });
        return 'number';
    }
  }
}

const article = (t: Kind) => (t === 'number' ? 'a number' : t === 'boolean' ? 'yes or no' : t === 'text' ? 'text' : t === 'object' ? 'an object' : 'a value');
