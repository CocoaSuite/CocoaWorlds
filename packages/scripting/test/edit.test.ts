import { describe, expect, it } from 'vitest';
import { editList, insertStatement, locate, moveStatement, newEvent, newExpr, newStatement, removeStatement, renameVariable, replaceBlock, type Script, type Statement } from '../src';

function sample() {
  const repeat = newStatement('repeat') as Extract<Statement, { kind: 'repeat' }>;
  const inner = newStatement('wait');
  repeat.body = [inner];
  const log = newStatement('log');
  const set = newStatement('set', { variable: 'score' });
  const s: Script = { version: 1, variables: [{ name: 'score', type: 'number', initial: 0 }], handlers: [{ id: 'h1', event: newEvent('start'), body: [log, repeat, set] }] };
  return { s, repeat, inner, log, set };
}

describe('editing scripts', () => {
  it('locates statements in nested lists', () => {
    const { s, repeat, inner, set } = sample();
    expect(locate(s, inner.id)).toEqual({ key: `${repeat.id}:body`, index: 0 });
    expect(locate(s, set.id)).toEqual({ key: 'h1', index: 2 });
  });

  it('inserts, removes and moves without touching the original', () => {
    const { s, repeat, log, set } = sample();
    const added = insertStatement(s, `${repeat.id}:body`, 1, newStatement('stop'));
    expect((added.handlers[0]!.body[1] as { body: Statement[] }).body.map((x) => x.kind)).toEqual(['wait', 'stop']);
    expect((s.handlers[0]!.body[1] as { body: Statement[] }).body).toHaveLength(1);
    expect(removeStatement(s, log.id).handlers[0]!.body.map((x) => x.kind)).toEqual(['repeat', 'set']);
    expect(moveStatement(s, set.id, -1).handlers[0]!.body.map((x) => x.kind)).toEqual(['log', 'set', 'repeat']);
    expect(moveStatement(s, log.id, -1)).toEqual(s);
  });

  it('replaces expressions deep inside statements', () => {
    const { s, repeat } = sample();
    const times = (repeat as { times: { id: string } }).times.id;
    const out = replaceBlock(s, times, () => newExpr('random'));
    expect((out.handlers[0]!.body[1] as { times: { kind: string } }).times.kind).toBe('random');
  });

  it('adds an otherwise branch through its list key', () => {
    const iff = newStatement('if');
    const s: Script = { version: 1, variables: [], handlers: [{ id: 'h', event: newEvent('start'), body: [iff] }] };
    const out = editList(s, `${iff.id}:otherwise`, (l) => [...l, newStatement('stop')]);
    expect((out.handlers[0]!.body[0] as { otherwise: Statement[] }).otherwise.map((x) => x.kind)).toEqual(['stop']);
  });

  it('renames a variable everywhere', () => {
    const { s } = sample();
    const out = renameVariable(s, 'score', 'points');
    expect(out.variables[0]!.name).toBe('points');
    expect(JSON.stringify(out)).not.toContain('"score"');
  });
});
