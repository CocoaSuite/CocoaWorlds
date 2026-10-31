import { describe, expect, it } from 'vitest';
import { History, type Command } from '../src/history';

function counter() {
  const state = { v: 0 };
  const set = (to: number, mergeKey?: string): Command => {
    let prev = 0;
    return {
      label: `set ${to}`,
      mergeKey,
      apply: () => {
        prev = state.v;
        state.v = to;
      },
      revert: () => {
        state.v = prev;
      },
    };
  };
  return { state, set };
}

describe('History', () => {
  it('undoes and redoes single commands', () => {
    const { state, set } = counter();
    const h = new History();
    h.execute(set(1));
    h.execute(set(2));
    expect(state.v).toBe(2);
    h.undo();
    expect(state.v).toBe(1);
    h.undo();
    expect(state.v).toBe(0);
    expect(h.canUndo).toBe(false);
    h.redo();
    h.redo();
    expect(state.v).toBe(2);
  });

  it('a new command clears the redo stack', () => {
    const { state, set } = counter();
    const h = new History();
    h.execute(set(1));
    h.undo();
    h.execute(set(5));
    expect(h.canRedo).toBe(false);
    expect(state.v).toBe(5);
  });

  it('collapses a drag into one entry and undoes to the original value', () => {
    const { state, set } = counter();
    const h = new History();
    h.begin('Drag');
    for (let i = 1; i <= 30; i++) h.execute(set(i, 'drag'));
    h.commit();
    expect(state.v).toBe(30);
    h.undo();
    expect(state.v).toBe(0);
    expect(h.canUndo).toBe(false);
    h.redo();
    expect(state.v).toBe(30);
  });

  it('cancel rolls back an open transaction', () => {
    const { state, set } = counter();
    const h = new History();
    h.begin('Drag');
    h.execute(set(3, 'd'));
    h.execute(set(4, 'd'));
    h.cancel();
    expect(state.v).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it('caps history at the limit', () => {
    const { set } = counter();
    const h = new History(3);
    for (let i = 1; i <= 5; i++) h.execute(set(i));
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(3);
  });

  it('tracks dirty state against the last save', () => {
    const { set } = counter();
    const h = new History();
    expect(h.isDirty).toBe(false);
    h.execute(set(1));
    expect(h.isDirty).toBe(true);
    h.markSaved();
    expect(h.isDirty).toBe(false);
    h.execute(set(2));
    h.undo();
    expect(h.isDirty).toBe(false);
    h.undo();
    expect(h.isDirty).toBe(true);
  });
});
