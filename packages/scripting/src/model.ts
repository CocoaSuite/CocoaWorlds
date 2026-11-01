/**
 * The script model: plain JSON, saved in an object's `script` component (decision S1). The block editor and
 * the optional graph view (V3) are two views of this one model; the compiler turns it into IR for the VM (D6).
 *
 * Every block has a stable `id` so problems and the running block can be pointed at.
 */

export type ValueType = 'number' | 'boolean' | 'text' | 'object';

/** A reference to an object in the scene. */
export type Ref = { self: true } | { entity: string } | { other: true };

export type Expr =
  | { id: string; kind: 'number'; value: number }
  | { id: string; kind: 'boolean'; value: boolean }
  | { id: string; kind: 'text'; value: string }
  | { id: string; kind: 'variable'; name: string }
  | { id: string; kind: 'maths'; op: '+' | '-' | '×' | '÷' | 'mod'; a: Expr; b: Expr }
  | { id: string; kind: 'compare'; op: '=' | '≠' | '<' | '>' | '≤' | '≥'; a: Expr; b: Expr }
  | { id: string; kind: 'logic'; op: 'and' | 'or'; a: Expr; b: Expr }
  | { id: string; kind: 'not'; a: Expr }
  | { id: string; kind: 'random'; min: Expr; max: Expr }
  | { id: string; kind: 'join'; a: Expr; b: Expr }
  | { id: string; kind: 'object'; ref: Ref }
  | { id: string; kind: 'time' }
  /** The player's health (0–100) and the game's score. */
  | { id: string; kind: 'health' }
  | { id: string; kind: 'score' };

export type Direction = 'up' | 'down' | 'north' | 'south' | 'east' | 'west';
export type Axis = 'up' | 'north' | 'east';

export type Statement =
  | { id: string; kind: 'move'; target: Ref; direction: Direction; distance: Expr; seconds: Expr }
  | { id: string; kind: 'turn'; target: Ref; axis: Axis; degrees: Expr; seconds: Expr }
  | { id: string; kind: 'return'; target: Ref; seconds: Expr }
  | { id: string; kind: 'show'; target: Ref }
  | { id: string; kind: 'hide'; target: Ref }
  | { id: string; kind: 'turnOn'; target: Ref }
  | { id: string; kind: 'turnOff'; target: Ref }
  | { id: string; kind: 'wait'; seconds: Expr }
  | { id: string; kind: 'send'; message: string; to: Ref | null }
  | { id: string; kind: 'log'; text: Expr }
  | { id: string; kind: 'set'; variable: string; value: Expr }
  | { id: string; kind: 'change'; variable: string; by: Expr }
  | { id: string; kind: 'if'; condition: Expr; then: Statement[]; otherwise: Statement[] | null }
  | { id: string; kind: 'repeat'; times: Expr; body: Statement[] }
  | { id: string; kind: 'forever'; body: Statement[] }
  | { id: string; kind: 'stop' }
  /** Hurt or heal the player; change the game's score (all by an amount, which may be negative). */
  | { id: string; kind: 'hurt'; amount: Expr }
  | { id: string; kind: 'heal'; amount: Expr }
  | { id: string; kind: 'addScore'; amount: Expr }
  /** Show text in the middle of the screen for a while (doesn't wait). */
  | { id: string; kind: 'say'; text: Expr; seconds: Expr }
  /** Change what a text sign says. */
  | { id: string; kind: 'setText'; target: Ref; text: Expr };

export type EventBlock =
  | { id: string; kind: 'start' }
  | { id: string; kind: 'enter'; zone: Ref }
  | { id: string; kind: 'leave'; zone: Ref }
  | { id: string; kind: 'message'; message: string }
  /** The player pressed Use (E) while looking at this object (or anything inside it). */
  | { id: string; kind: 'use' }
  | { id: string; kind: 'every'; seconds: Expr }
  /** The player's health reached 0 (they start again at the Player start). */
  | { id: string; kind: 'die' };

export interface Handler {
  id: string;
  event: EventBlock;
  body: Statement[];
}

/**
 * A game value: like a variable, but shared by every script in the game (Cash, Gems, Round). Defined once for
 * the whole project; a script's own variable with the same name hides it.
 */
export interface GameValueDef {
  name: string;
  type: Exclude<ValueType, 'object'>;
  initial: number | boolean | string;
  /** Show it on screen while playing (with its name). */
  show: boolean;
}

export interface VariableDef {
  name: string;
  type: Exclude<ValueType, 'object'>;
  initial: number | boolean | string;
}

export interface Script {
  version: 1;
  variables: VariableDef[];
  handlers: Handler[];
}

export const emptyScript = (): Script => ({ version: 1, variables: [], handlers: [] });

/** A short random id for blocks (unique within a script is all that's needed). */
export function blockId(): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/** Every block in a script, depth first: handlers, their events, statements, and expressions. */
export function* walk(script: Script): Generator<{ id: string; kind: string }> {
  function* expr(e: Expr): Generator<{ id: string; kind: string }> {
    yield e;
    for (const k of ['a', 'b', 'min', 'max'] as const) {
      const sub = (e as Record<string, unknown>)[k] as Expr | undefined;
      if (sub && typeof sub === 'object' && 'kind' in sub) yield* expr(sub);
    }
  }
  function* stmts(list: Statement[]): Generator<{ id: string; kind: string }> {
    for (const s of list) {
      yield s;
      for (const k of ['distance', 'seconds', 'degrees', 'text', 'value', 'by', 'condition', 'times', 'amount'] as const) {
        const sub = (s as Record<string, unknown>)[k] as Expr | undefined;
        if (sub && typeof sub === 'object' && 'kind' in sub) yield* expr(sub);
      }
      if (s.kind === 'if') {
        yield* stmts(s.then);
        if (s.otherwise) yield* stmts(s.otherwise);
      }
      if (s.kind === 'repeat' || s.kind === 'forever') yield* stmts(s.body);
    }
  }
  for (const h of script.handlers) {
    yield { id: h.id, kind: 'handler' };
    yield h.event;
    if (h.event.kind === 'every') yield* expr(h.event.seconds);
    yield* stmts(h.body);
  }
}
