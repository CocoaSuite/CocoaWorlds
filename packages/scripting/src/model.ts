/**
 * The script model: plain JSON, saved in an object's `script` component (decision S1). The block editor and
 * the optional graph view (V3) are two views of this one model; the compiler turns it into IR for the VM (D6).
 *
 * Every block has a stable `id` so problems and the running block can be pointed at.
 */

export type ValueType = 'number' | 'boolean' | 'text' | 'object';

/** A reference to an object in the scene (or the player). */
export type Ref = { self: true } | { entity: string } | { other: true } | { player: true };

/** A place in the world: where an object (or the player) is, or the spot the player is looking at. */
export type Place = Ref | { aim: true };

/** Statement and event fields that hold a value block (for walking and editing scripts). */
export const EXPR_KEYS = ['distance', 'seconds', 'degrees', 'text', 'value', 'by', 'condition', 'times', 'amount', 'factor', 'strength', 'gap', 'volume'] as const;

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
  | { id: string; kind: 'score' }
  /** The copy made last by “Make a copy” in this stack. */
  | { id: string; kind: 'copy' }
  /** Another object's variable (read only). */
  | { id: string; kind: 'varOf'; variable: string; of: Ref }
  /** Whether something (the player, an object) is inside a trigger zone right now. */
  | { id: string; kind: 'inside'; what: Ref; zone: Ref }
  /** How many of an item the player carries. */
  | { id: string; kind: 'itemCount'; item: string }
  /** The item in the hotbar slot the player has picked ('' when that slot is empty). */
  | { id: string; kind: 'selectedItem' }
  /** The row the player picked in a list (in “When the player picks a row”). */
  | { id: string; kind: 'pickedRow' }
  /** The real time now, in seconds since 1970 (for things that grow while the game is closed). */
  | { id: string; kind: 'clock' };

export type Direction = 'up' | 'down' | 'north' | 'south' | 'east' | 'west';
export type Axis = 'up' | 'north' | 'east';

export type Statement =
  | { id: string; kind: 'move'; target: Ref; direction: Direction; distance: Expr; seconds: Expr }
  | { id: string; kind: 'turn'; target: Ref; axis: Axis; degrees: Expr; seconds: Expr }
  /** Turn to an angle measured from how it started (a door: 90 open, 0 shut), however far it has turned. */
  | { id: string; kind: 'turnTo'; target: Ref; axis: Axis; degrees: Expr; seconds: Expr }
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
  /** Run the blocks inside again and again while the condition holds (once per frame at most). */
  | { id: string; kind: 'while'; condition: Expr; body: Statement[] }
  | { id: string; kind: 'stop' }
  /** Hurt or heal the player; change the game's score (all by an amount, which may be negative). */
  | { id: string; kind: 'hurt'; amount: Expr }
  | { id: string; kind: 'heal'; amount: Expr }
  | { id: string; kind: 'addScore'; amount: Expr }
  /** Show text in the middle of the screen for a while (doesn't wait). */
  | { id: string; kind: 'say'; text: Expr; seconds: Expr }
  /** Change what a text sign says. */
  | { id: string; kind: 'setText'; target: Ref; text: Expr }
  /** Make a copy of an object (and everything inside it) at a place; it runs its own scripts. */
  | { id: string; kind: 'spawn'; template: Ref; at: Place }
  /** Take an object out of the game. */
  | { id: string; kind: 'remove'; target: Ref }
  /** Grow or shrink to `factor` times its starting size, around its pivot. */
  | { id: string; kind: 'scale'; target: Ref; factor: Expr; seconds: Expr }
  /** Let it fall and tumble: physics takes over (unanchor). */
  | { id: string; kind: 'physical'; target: Ref }
  /** Give it (or the player) a push: a change of speed in units per second. */
  | { id: string; kind: 'push'; target: Ref; direction: Direction; strength: Expr }
  /** Glide to a place, stopping `gap` units short of it. */
  | { id: string; kind: 'moveTo'; target: Ref; to: Place; seconds: Expr; gap: Expr }
  /** Put the player at a place (facing the way that object faces). */
  | { id: string; kind: 'teleport'; to: Place }
  /** Take health from a breakable object; at 0 it breaks. */
  | { id: string; kind: 'damage'; target: Ref; amount: Expr }
  /** Play a sound file (`assets/sounds/…`) once, at a place (heard in 3D) or everywhere (null). */
  | { id: string; kind: 'playSound'; sound: string; at: Place | null; volume: Expr }
  /** Stop the sounds an object is making (its Sound component and what its scripts played). */
  | { id: string; kind: 'stopSound'; target: Ref }
  /** Play one of a model's animations by name, looping or once. */
  | { id: string; kind: 'playAnim'; target: Ref; name: string; loop: boolean }
  /** Show or hide a whole screen of the screen UI (by id). */
  | { id: string; kind: 'showScreen' | 'hideScreen' | 'toggleScreen'; screen: string }
  /** Add a row to a list, remove the first row with that text, or empty it. */
  | { id: string; kind: 'addRow' | 'removeRow'; list: string; text: Expr }
  | { id: string; kind: 'clearList'; list: string }
  /** Start over: kept game values go back to their starting values (and kept items are emptied). */
  | { id: string; kind: 'forgetProgress' }
  /** Show or hide one element of a screen (by id). */
  | { id: string; kind: 'showUi' | 'hideUi'; element: string }
  /** Change what a text or button says. */
  | { id: string; kind: 'setUiText'; element: string; text: Expr }
  /** Give the player some of an item, or take some away (never below 0). */
  | { id: string; kind: 'giveItem' | 'takeItem'; item: string; amount: Expr };

export type EventBlock =
  | { id: string; kind: 'start' }
  | { id: string; kind: 'enter'; zone: Ref }
  | { id: string; kind: 'leave'; zone: Ref }
  /**
   * A message arrived. A message sent again and again without a break (from a “while” loop) counts as one:
   * this starts when it begins, and `messageStop` starts when it stops coming.
   */
  | { id: string; kind: 'message'; message: string }
  | { id: string; kind: 'messageStop'; message: string }
  /**
   * The player pressed Use (E) while looking at this object (or anything inside it). `prompt` is the word shown
   * under the crosshair when the player looks at it (“E  Open”); empty shows “Use”.
   */
  | { id: string; kind: 'use'; prompt?: string }
  | { id: string; kind: 'every'; seconds: Expr }
  /** The player's health reached 0 (they start again at the Player start). */
  | { id: string; kind: 'die' }
  /** This breakable object's health reached 0 (it is removed after this starts). */
  | { id: string; kind: 'breaks' }
  /** The player clicked a button of the screen UI (by id). */
  | { id: string; kind: 'uiClick'; element: string }
  /** The player used (clicked with) an item from the hotbar; '' for any item. */
  | { id: string; kind: 'useItem'; item: string }
  /** The player picked a row of a list on screen (“the picked row” says which). */
  | { id: string; kind: 'listPick'; list: string }
  /** The player pressed a key (a KeyboardEvent code: 'KeyI', 'Tab', 'KeyQ' …). */
  | { id: string; kind: 'key'; key: string };

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
  /** Kept between sessions (saved progress). */
  saved?: boolean;
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
      for (const k of EXPR_KEYS) {
        const sub = (s as Record<string, unknown>)[k] as Expr | undefined;
        if (sub && typeof sub === 'object' && 'kind' in sub) yield* expr(sub);
      }
      for (const [, list] of innerLists(s)) yield* stmts(list);
    }
  }
  for (const h of script.handlers) {
    yield { id: h.id, kind: 'handler' };
    yield h.event;
    if (h.event.kind === 'every') yield* expr(h.event.seconds);
    yield* stmts(h.body);
  }
}

/** The statement lists inside a statement, with their list-key suffix (`then`, `otherwise`, `body`). */
export function innerLists(s: Statement): [string, Statement[]][] {
  if (s.kind === 'if') return s.otherwise ? [['then', s.then], ['otherwise', s.otherwise]] : [['then', s.then]];
  if (s.kind === 'repeat' || s.kind === 'forever' || s.kind === 'while') return [['body', s.body]];
  return [];
}

/** A copy of blocks with new ids everywhere (for pasting). */
export function freshIds<T>(blocks: T): T {
  return JSON.parse(JSON.stringify(blocks), (k, v) => (k === 'id' && typeof v === 'string' ? blockId() : v)) as T;
}
