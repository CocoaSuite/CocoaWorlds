/** New blocks with sensible defaults, for the editor's palette and for tests. */
import { blockId, type Direction, type EventBlock, type Expr, type Ref, type Statement } from './model';

const id = blockId;

export const num = (value: number): Expr => ({ id: id(), kind: 'number', value });
export const bool = (value: boolean): Expr => ({ id: id(), kind: 'boolean', value });
export const text = (value: string): Expr => ({ id: id(), kind: 'text', value });
export const variable = (name: string): Expr => ({ id: id(), kind: 'variable', name });
export const self: Ref = { self: true };
export const other: Ref = { other: true };
export const entity = (e: string): Ref => ({ entity: e });

export type StatementKind = Statement['kind'];
export type EventKind = EventBlock['kind'];
export type ExprKind = Expr['kind'];

export function newEvent(kind: EventKind, zone: Ref = self): EventBlock {
  switch (kind) {
    case 'start':
      return { id: id(), kind };
    case 'enter':
    case 'leave':
      return { id: id(), kind, zone };
    case 'message':
      return { id: id(), kind, message: 'open' };
    case 'every':
      return { id: id(), kind, seconds: num(1) };
  }
}

export function newStatement(kind: StatementKind, opts: { target?: Ref; variable?: string } = {}): Statement {
  const target = opts.target ?? self;
  switch (kind) {
    case 'move':
      return { id: id(), kind, target, direction: 'up' as Direction, distance: num(128), seconds: num(1) };
    case 'turn':
      return { id: id(), kind, target, axis: 'up', degrees: num(90), seconds: num(1) };
    case 'return':
      return { id: id(), kind, target, seconds: num(1) };
    case 'show':
    case 'hide':
    case 'turnOn':
    case 'turnOff':
      return { id: id(), kind, target };
    case 'wait':
      return { id: id(), kind, seconds: num(1) };
    case 'send':
      return { id: id(), kind, message: 'open', to: null };
    case 'log':
      return { id: id(), kind, text: text('Hello') };
    case 'set':
      return { id: id(), kind, variable: opts.variable ?? '', value: num(0) };
    case 'change':
      return { id: id(), kind, variable: opts.variable ?? '', by: num(1) };
    case 'if':
      return { id: id(), kind, condition: newExpr('compare'), then: [], otherwise: null };
    case 'repeat':
      return { id: id(), kind, times: num(3), body: [] };
    case 'forever':
      return { id: id(), kind, body: [] };
    case 'stop':
      return { id: id(), kind };
  }
}

export function newExpr(kind: ExprKind, opts: { variable?: string } = {}): Expr {
  switch (kind) {
    case 'number':
      return num(0);
    case 'boolean':
      return bool(true);
    case 'text':
      return text('');
    case 'variable':
      return variable(opts.variable ?? '');
    case 'maths':
      return { id: id(), kind, op: '+', a: num(1), b: num(1) };
    case 'compare':
      return { id: id(), kind, op: '=', a: num(1), b: num(1) };
    case 'logic':
      return { id: id(), kind, op: 'and', a: bool(true), b: bool(true) };
    case 'not':
      return { id: id(), kind, a: bool(true) };
    case 'random':
      return { id: id(), kind, min: num(1), max: num(6) };
    case 'join':
      return { id: id(), kind, a: text('Score: '), b: num(0) };
    case 'object':
      return { id: id(), kind, ref: self };
    case 'time':
      return { id: id(), kind };
  }
}
