/**
 * Editing scripts without mutating them: every function returns a new Script. Statement lists are named by a
 * list key: a handler id for its body, or `${statementId}:then`, `:otherwise`, `:body` for nested lists.
 */
import type { EventBlock, Expr, Handler, Script, Statement } from './model';

type Node = Statement | Expr | EventBlock;

/** Replace any block (statement, expression or event) found by id. */
export function replaceBlock(script: Script, id: string, fn: (b: Node) => Node): Script {
  const ex = (e: Expr): Expr => {
    if (e.id === id) return fn(e) as Expr;
    const c = { ...e } as Record<string, unknown>;
    for (const k of ['a', 'b', 'min', 'max']) if (c[k] && typeof c[k] === 'object') c[k] = ex(c[k] as Expr);
    return c as Expr;
  };
  const st = (s: Statement): Statement => {
    if (s.id === id) return fn(s) as Statement;
    const c = { ...s } as Record<string, unknown>;
    for (const k of ['distance', 'seconds', 'degrees', 'text', 'value', 'by', 'condition', 'times', 'amount']) if (c[k] && typeof c[k] === 'object') c[k] = ex(c[k] as Expr);
    if (s.kind === 'if') {
      c.then = s.then.map(st);
      c.otherwise = s.otherwise ? s.otherwise.map(st) : null;
    }
    if (s.kind === 'repeat' || s.kind === 'forever') c.body = s.body.map(st);
    return c as Statement;
  };
  return {
    ...script,
    handlers: script.handlers.map((h) => {
      let event = h.event.id === id ? (fn(h.event) as EventBlock) : h.event;
      if (event.kind === 'every' && event.seconds) event = { ...event, seconds: ex(event.seconds) };
      return { ...h, event, body: h.body.map(st) };
    }),
  };
}

/** Change one statement list (by list key). */
export function editList(script: Script, key: string, fn: (list: Statement[]) => Statement[]): Script {
  const [owner, branch] = key.split(':') as [string, string | undefined];
  if (!branch) return { ...script, handlers: script.handlers.map((h) => (h.id === owner ? { ...h, body: fn(h.body) } : h)) };
  return replaceBlock(script, owner, (b) => {
    const s = b as Statement;
    if (s.kind === 'if' && branch === 'then') return { ...s, then: fn(s.then) };
    if (s.kind === 'if' && branch === 'otherwise') return { ...s, otherwise: fn(s.otherwise ?? []) };
    if ((s.kind === 'repeat' || s.kind === 'forever') && branch === 'body') return { ...s, body: fn(s.body) };
    return s;
  });
}

/** Where a statement lives: its list key and index. */
export function locate(script: Script, id: string): { key: string; index: number } | null {
  const search = (key: string, list: Statement[]): { key: string; index: number } | null => {
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      if (s.id === id) return { key, index: i };
      const sub =
        s.kind === 'if'
          ? (search(`${s.id}:then`, s.then) ?? (s.otherwise ? search(`${s.id}:otherwise`, s.otherwise) : null))
          : s.kind === 'repeat' || s.kind === 'forever'
            ? search(`${s.id}:body`, s.body)
            : null;
      if (sub) return sub;
    }
    return null;
  };
  for (const h of script.handlers) {
    const r = search(h.id, h.body);
    if (r) return r;
  }
  return null;
}

export function insertStatement(script: Script, key: string, index: number, s: Statement): Script {
  return editList(script, key, (list) => [...list.slice(0, index), s, ...list.slice(index)]);
}

export function removeStatement(script: Script, id: string): Script {
  const at = locate(script, id);
  return at ? editList(script, at.key, (list) => list.filter((s) => s.id !== id)) : script;
}

/** Move a statement up (-1) or down (+1) within its list. */
export function moveStatement(script: Script, id: string, by: -1 | 1): Script {
  const at = locate(script, id);
  if (!at) return script;
  return editList(script, at.key, (list) => {
    const j = at.index + by;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[at.index], next[j]] = [next[j]!, next[at.index]!];
    return next;
  });
}

export function addHandler(script: Script, h: Handler): Script {
  return { ...script, handlers: [...script.handlers, h] };
}

export function removeHandler(script: Script, id: string): Script {
  return { ...script, handlers: script.handlers.filter((h) => h.id !== id) };
}

/** Rename a variable everywhere it is used. */
export function renameVariable(script: Script, from: string, to: string): Script {
  const json = JSON.stringify(script.handlers, (k, v) => ((k === 'name' || k === 'variable') && v === from ? to : v));
  return { ...script, variables: script.variables.map((v) => (v.name === from ? { ...v, name: to } : v)), handlers: JSON.parse(json) };
}
