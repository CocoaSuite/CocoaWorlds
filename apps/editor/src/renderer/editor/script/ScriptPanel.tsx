/**
 * The block editor (mockup 02): the selected object's script as plain-language stacks. Every slot is edited
 * in place; “+” adds a block after a row or at the end of a list; ▾ on a value turns it into another kind of
 * value (a variable, maths, a random number …). Problems show under the block they're about, and while the
 * game plays, the running blocks are highlighted.
 */
import {
  addHandler,
  compileScript,
  editList,
  insertStatement,
  locate,
  moveStatement,
  newEvent,
  newExpr,
  newStatement,
  removeHandler,
  removeStatement,
  renameVariable,
  replaceBlock,
  blockId,
  type EventBlock,
  type EventKind,
  type Expr,
  type ExprKind,
  type Problem,
  type Ref,
  type Script,
  type Statement,
  type StatementKind,
  type VariableDef,
} from '@cocoaworlds/scripting';
import { Button, ContextMenu, IconButton, type MenuEntry } from '@cocoaworlds/ui';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { useEditor } from '../../store';
import { STATEMENT_GROUPS, VALUES_FOR, axisLabel, directionLabel, eventName, groupTitle, statementName, valueName, w } from './words';

interface Ctx {
  owner: string;
  script: Script;
  update: (fn: (s: Script) => Script, label: string, mergeKey?: string) => void;
  problems: Map<string, Problem[]>;
  active: Set<string>;
  objects: { id: string; name: string; isZone: boolean }[];
  menu: (x: number, y: number, items: MenuEntry[]) => void;
  /** The handler being drawn (for “the thing that entered”). */
  otherAllowed: boolean;
}
const C = createContext<Ctx | null>(null);
const useC = () => useContext(C)!;

export function ScriptPanel() {
  useEditor((s) => s.rev);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const active = useEditor((s) => s.activeBlocks);
  const playing = useEditor((s) => !!s.playing);
  const st = useEditor.getState();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);

  const owner = selection.length === 1 ? doc?.get(selection[0]!) : undefined;
  const script = owner?.components.script as unknown as Script | undefined;
  const objects = useMemo(
    () => (doc ? doc.entities.map((e) => ({ id: e.id, name: e.name, isZone: !!e.components.trigger })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, useEditor.getState().rev],
  );
  const problems = useMemo(() => {
    const m = new Map<string, Problem[]>();
    if (!owner || !script) return m;
    const info = { objects: new Map(objects.map((o) => [o.id, { name: o.name, isZone: o.isZone }])) };
    for (const p of compileScript(owner.id, script, info).problems) m.set(p.block, [...(m.get(p.block) ?? []), p]);
    return m;
  }, [owner, script, objects]);

  if (!owner) return <div className="cw-muted cw-script-empty">{t('script.selectObject')}</div>;
  if (!script)
    return (
      <div className="cw-script-empty">
        <span className="cw-muted">{t('script.none').replace('{name}', owner.name)}</span>
        <Button variant="primary" onClick={() => st.addComponent(owner.id, 'script')}>
          {t('script.add')}
        </Button>
      </div>
    );

  const ctx: Ctx = {
    owner: owner.id,
    script,
    update: (fn, label, mergeKey) => st.updateScript(owner.id, fn, label, mergeKey),
    problems,
    active: new Set(active.get(owner.id) ?? []),
    objects,
    menu: (x, y, items) => setMenu({ x, y, items }),
    otherAllowed: false,
  };
  const addStack = (ev: { clientX: number; clientY: number }) =>
    ctx.menu(
      ev.clientX,
      ev.clientY,
      (['start', 'enter', 'leave', 'message', 'every'] as EventKind[]).map((k) => ({
        label: eventName(k),
        onSelect: () => {
          const zone: Ref = objects.find((o) => o.id === owner.id)?.isZone ? { self: true } : objects.find((o) => o.isZone) ? { entity: objects.find((o) => o.isZone)!.id } : { self: true };
          ctx.update((s) => addHandler(s, { id: blockId(), event: newEvent(k, zone), body: [] }), 'Add stack');
        },
      })),
    );

  return (
    <C.Provider value={ctx}>
      <div className={`cw-script${playing ? ' playing' : ''}`} aria-label={t('script.title').replace('{name}', owner.name)} role="region">
        <div className="cw-script-head">
          <span className="cw-script-owner">{t('script.title').replace('{name}', owner.name)}</span>
          <Variables />
          <span className="cw-sp" />
          <Button onClick={addStack}>{t('script.addStack')}</Button>
        </div>
        <div className="cw-stacks">
          {!script.handlers.length && <p className="cw-hint">{t('script.empty')}</p>}
          {script.handlers.map((h) => (
            <C.Provider key={h.id} value={{ ...ctx, otherAllowed: h.event.kind === 'enter' || h.event.kind === 'leave' }}>
              <div className="cw-stack" role="group" aria-label={eventName(h.event.kind)}>
                <EventRow ev={h.event} onRemove={() => ctx.update((s) => removeHandler(s, h.id), 'Remove stack')} />
                <List listKey={h.id} list={h.body} />
              </div>
            </C.Provider>
          ))}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </C.Provider>
  );
}

// ── Variables ──

function Variables() {
  const c = useC();
  const add = () => {
    let n = 1;
    while (c.script.variables.some((v) => v.name === `value${n}`)) n++;
    const name = c.script.variables.length ? `value${n}` : 'score';
    c.update((s) => ({ ...s, variables: [...s.variables, { name, type: 'number', initial: 0 }] }), 'Add variable');
  };
  const set = (i: number, next: VariableDef) =>
    c.update((s) => {
      const old = s.variables[i]!;
      let out = s;
      if (old.name !== next.name) out = renameVariable(out, old.name, next.name);
      return { ...out, variables: out.variables.map((v, j) => (j === i ? next : v)) };
    }, 'Edit variable');
  return (
    <div className="cw-vars" aria-label={t('script.variables')}>
      <span className="cw-muted">{t('script.variables')}</span>
      {c.script.variables.map((v, i) => (
        <span key={i} className="cw-var">
          <input
            className="cw-input cw-var-name"
            aria-label={t('script.varName')}
            defaultValue={v.name}
            key={v.name}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim();
              if (name && name !== v.name) set(i, { ...v, name });
            }}
          />
          <select
            className="cw-input cw-mini"
            aria-label={t('script.varType')}
            value={v.type}
            onChange={(e) => {
              const type = e.target.value as VariableDef['type'];
              set(i, { ...v, type, initial: type === 'number' ? 0 : type === 'boolean' ? false : '' });
            }}
          >
            <option value="number">{t('script.typeNumber')}</option>
            <option value="boolean">{t('script.typeBoolean')}</option>
            <option value="text">{t('script.typeText')}</option>
          </select>
          <span className="cw-muted">=</span>
          <InlineValue
            type={v.type}
            value={v.initial}
            label={`${v.name} ${t('script.startsAt')}`}
            onChange={(initial) => set(i, { ...v, initial })}
          />
          <IconButton icon="close" label={`${t('comp.remove')} ${v.name}`} className="cw-var-x" onClick={() => c.update((s) => ({ ...s, variables: s.variables.filter((_, j) => j !== i) }), 'Remove variable')} />
        </span>
      ))}
      <Button size="sm" onClick={add}>
        {t('script.addVariable')}
      </Button>
    </div>
  );
}

function InlineValue({ type, value, label, onChange }: { type: VariableDef['type']; value: unknown; label: string; onChange: (v: number | boolean | string) => void }) {
  if (type === 'boolean')
    return (
      <select className="cw-input cw-mini" aria-label={label} value={value ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === 'yes')}>
        <option value="yes">{w('yes')}</option>
        <option value="no">{w('no')}</option>
      </select>
    );
  return (
    <input
      className={`cw-input cw-slot ${type === 'number' ? 'num' : 'txt'}`}
      aria-label={label}
      defaultValue={String(value ?? '')}
      key={String(value ?? '')}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const raw = e.currentTarget.value;
        if (type === 'number') {
          const n = Number(raw.replace(',', '.'));
          if (Number.isFinite(n) && n !== value) onChange(n);
          else e.currentTarget.value = String(value);
        } else if (raw !== value) onChange(raw);
      }}
    />
  );
}

// ── Stacks and statements ──

function EventRow({ ev, onRemove }: { ev: EventBlock; onRemove: () => void }) {
  const c = useC();
  const set = (patch: Partial<EventBlock>) => c.update((s) => replaceBlock(s, ev.id, (b) => ({ ...b, ...patch }) as EventBlock), 'Edit block');
  let content: ReactNode;
  if (ev.kind === 'start') content = w('start');
  else if (ev.kind === 'enter' || ev.kind === 'leave')
    content = (
      <>
        {w(ev.kind)} <RefSlot value={ev.zone} zonesOnly onChange={(zone) => set({ zone } as Partial<EventBlock>)} label={w(ev.kind)} />
      </>
    );
  else if (ev.kind === 'message') content = (
    <>
      {w('message')} <TextSlot value={ev.message} label={w('message')} onChange={(message) => set({ message } as Partial<EventBlock>)} />
    </>
  );
  else content = (
    <>
      {w('every')} <ExprSlot expr={ev.seconds} type="number" label={w('every')} /> {w('seconds')}
    </>
  );
  return (
    <div className="cw-blk event" data-block={ev.id}>
      <div className="cw-blk-line">
        <span className="cw-blk-words">{content}</span>
        <span className="cw-blk-tools">
          <IconButton icon="close" label={t('script.removeStack')} onClick={onRemove} />
        </span>
      </div>
      <BlockProblems id={ev.id} />
    </div>
  );
}

function List({ listKey, list }: { listKey: string; list: Statement[] }) {
  const c = useC();
  return (
    <div className="cw-list">
      {list.map((s) => (
        <StatementRow key={s.id} s={s} listKey={listKey} />
      ))}
      <button
        type="button"
        className="cw-add-blk"
        onClick={(ev) => c.menu(ev.clientX, ev.clientY, paletteItems(c, (stmt) => c.update((sc) => insertStatement(sc, listKey, list.length, stmt), 'Add block')))}
      >
        + {t('script.addBlock')}
      </button>
    </div>
  );
}

function paletteItems(c: Ctx, add: (s: Statement) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  const firstVar = c.script.variables[0]?.name;
  const target: Ref = c.objects.some((o) => o.id === c.owner) ? { self: true } : { self: true };
  STATEMENT_GROUPS.forEach((g, i) => {
    if (i) out.push('separator');
    for (const k of g.kinds) out.push({ label: `${groupTitle(g.title)} › ${statementName(k)}`, onSelect: () => add(newStatement(k as StatementKind, { target, variable: firstVar })) });
  });
  return out;
}

function StatementRow({ s, listKey }: { s: Statement; listKey: string }) {
  const c = useC();
  const set = (patch: Record<string, unknown>, mergeKey?: string) => c.update((sc) => replaceBlock(sc, s.id, (b) => ({ ...b, ...patch }) as Statement), 'Edit block', mergeKey);
  const at = locate(c.script, s.id);
  const words = statementWords(s, set);
  const nested =
    s.kind === 'if' ? (
      <>
        <List listKey={`${s.id}:then`} list={s.then} />
        {s.otherwise ? (
          <>
            <div className="cw-blk-else">
              {w('otherwise')}
              <IconButton icon="close" label={t('script.removeOtherwise')} onClick={() => set({ otherwise: null })} />
            </div>
            <List listKey={`${s.id}:otherwise`} list={s.otherwise} />
          </>
        ) : (
          <button type="button" className="cw-add-blk" onClick={() => c.update((sc) => editList(sc, `${s.id}:otherwise`, () => []), 'Add otherwise')}>
            {w('addOtherwise')}
          </button>
        )}
      </>
    ) : s.kind === 'repeat' || s.kind === 'forever' ? (
      <List listKey={`${s.id}:body`} list={s.body} />
    ) : null;
  return (
    <div className={`cw-blk ${kindClass(s.kind)}${c.active.has(s.id) ? ' running' : ''}${c.problems.get(s.id)?.some((p) => p.severity === 'error') ? ' bad' : ''}`} data-block={s.id} role="group" aria-label={statementName(s.kind)}>
      <div className="cw-blk-line">
        <span className="cw-blk-words">{words}</span>
        <span className="cw-blk-tools">
          <IconButton icon="plus" label={t('script.addAfter')} onClick={(ev) => c.menu(ev.clientX, ev.clientY, paletteItems(c, (stmt) => at && c.update((sc) => insertStatement(sc, at.key, at.index + 1, stmt), 'Add block')))} />
          <IconButton icon="up" label={t('script.moveUp')} onClick={() => c.update((sc) => moveStatement(sc, s.id, -1), 'Move block')} />
          <IconButton icon="down" label={t('script.moveDown')} onClick={() => c.update((sc) => moveStatement(sc, s.id, 1), 'Move block')} />
          <IconButton icon="close" label={t('script.removeBlock')} onClick={() => c.update((sc) => removeStatement(sc, s.id), 'Remove block')} />
        </span>
      </div>
      <BlockProblems id={s.id} />
      {nested && <div className="cw-blk-body">{nested}</div>}
    </div>
  );
  void listKey;
}

const kindClass = (k: StatementKind) => (k === 'if' || k === 'repeat' || k === 'forever' || k === 'wait' || k === 'stop' ? 'control' : k === 'set' || k === 'change' ? 'data' : 'action');

function statementWords(s: Statement, set: (patch: Record<string, unknown>, mergeKey?: string) => void): ReactNode {
  switch (s.kind) {
    case 'move':
      return (
        <>
          {w('move')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('move')} />
          <select className="cw-input cw-mini" aria-label={w('direction')} value={s.direction} onChange={(e) => set({ direction: e.target.value })}>
            {(['up', 'down', 'north', 'south', 'east', 'west'] as const).map((d) => (
              <option key={d} value={d}>
                {directionLabel(d)}
              </option>
            ))}
          </select>
          {w('by')} <ExprSlot expr={s.distance} type="number" label={`${w('move')} ${w('by')}`} /> {w('over')} <ExprSlot expr={s.seconds} type="number" label={`${w('move')} ${w('over')}`} /> {w('seconds')}
        </>
      );
    case 'turn':
      return (
        <>
          {w('turn')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('turn')} /> {w('by')} <ExprSlot expr={s.degrees} type="number" label={`${w('turn')} ${w('by')}`} /> {w('around')}
          <select className="cw-input cw-mini" aria-label={w('around')} value={s.axis} onChange={(e) => set({ axis: e.target.value })}>
            {(['up', 'north', 'east'] as const).map((a) => (
              <option key={a} value={a}>
                {axisLabel(a)}
              </option>
            ))}
          </select>
          {w('over')} <ExprSlot expr={s.seconds} type="number" label={`${w('turn')} ${w('over')}`} /> {w('seconds')}
        </>
      );
    case 'return':
      return (
        <>
          {w('return')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('return')} /> {w('toStart')} <ExprSlot expr={s.seconds} type="number" label={w('toStart')} /> {w('seconds')}
        </>
      );
    case 'show':
    case 'hide':
    case 'turnOn':
    case 'turnOff':
      return (
        <>
          {w(s.kind)} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w(s.kind)} />
        </>
      );
    case 'wait':
      return (
        <>
          {w('wait')} <ExprSlot expr={s.seconds} type="number" label={w('wait')} /> {w('seconds')}
        </>
      );
    case 'send':
      return (
        <>
          {w('send')} <TextSlot value={s.message} label={w('send')} onChange={(message) => set({ message })} /> {w('to')}{' '}
          <RefSlot value={s.to} allowNone onChange={(to) => set({ to })} label={`${w('send')} ${w('to')}`} />
        </>
      );
    case 'log':
      return (
        <>
          {w('log')} <ExprSlot expr={s.text} type="text" label={w('log')} /> {w('inConsole')}
        </>
      );
    case 'set':
      return (
        <>
          {w('set')} <VariableSlot value={s.variable} onChange={(variable) => set({ variable })} label={w('set')} /> {w('setTo')} <ExprSlot expr={s.value} type="any" label={`${w('set')} ${w('setTo')}`} />
        </>
      );
    case 'change':
      return (
        <>
          {w('change')} <VariableSlot value={s.variable} onChange={(variable) => set({ variable })} label={w('change')} numbersOnly /> {w('by')}{' '}
          <ExprSlot expr={s.by} type="number" label={`${w('change')} ${w('by')}`} />
        </>
      );
    case 'if':
      return (
        <>
          {w('if')} <ExprSlot expr={s.condition} type="boolean" label={w('if')} />
        </>
      );
    case 'repeat':
      return (
        <>
          {w('repeat')} <ExprSlot expr={s.times} type="number" label={w('repeat')} /> {w('times')}
        </>
      );
    case 'forever':
      return w('forever');
    case 'stop':
      return w('stop');
  }
}

function BlockProblems({ id }: { id: string }) {
  const c = useC();
  const list = c.problems.get(id);
  if (!list?.length) return null;
  return (
    <div className="cw-blk-problems">
      {list.map((p, i) => (
        <div key={i} className={`cw-blk-problem ${p.severity}`}>
          {p.message}
        </div>
      ))}
    </div>
  );
}

// ── Slots ──

function RefSlot({ value, onChange, label, zonesOnly, allowNone }: { value: Ref | null; onChange: (r: Ref | null) => void; label: string; zonesOnly?: boolean; allowNone?: boolean }) {
  const c = useC();
  const enc = (r: Ref | null) => (r === null ? 'none' : 'self' in r ? 'self' : 'other' in r ? 'other' : `e:${r.entity}`);
  const dec = (v: string): Ref | null => (v === 'none' ? null : v === 'self' ? { self: true } : v === 'other' ? { other: true } : { entity: v.slice(2) });
  const objs = c.objects.filter((o) => o.id !== c.owner && (!zonesOnly || o.isZone));
  const current = enc(value);
  const missing = value && 'entity' in value && !c.objects.some((o) => o.id === value.entity);
  return (
    <select className="cw-input cw-ref" aria-label={label} value={current} onChange={(e) => onChange(dec(e.target.value))}>
      {allowNone && <option value="none">{w('everyone')}</option>}
      <option value="self">{w('self')}</option>
      {!zonesOnly && (c.otherAllowed || current === 'other') && <option value="other">{w('other')}</option>}
      {missing && <option value={current}>?</option>}
      {objs.map((o) => (
        <option key={o.id} value={`e:${o.id}`}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function TextSlot({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      className="cw-input cw-slot txt"
      aria-label={label}
      defaultValue={value}
      key={value}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={(e) => e.currentTarget.value !== value && onChange(e.currentTarget.value)}
    />
  );
}

function VariableSlot({ value, onChange, label, numbersOnly }: { value: string; onChange: (v: string) => void; label: string; numbersOnly?: boolean }) {
  const c = useC();
  const vars = c.script.variables.filter((v) => !numbersOnly || v.type === 'number');
  return (
    <select className="cw-input cw-var-slot" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {!vars.some((v) => v.name === value) && <option value={value}>{value || w('pickVariable')}</option>}
      {vars.map((v) => (
        <option key={v.name} value={v.name}>
          {v.name}
        </option>
      ))}
    </select>
  );
}

/** A value slot: edits the value in place; ▾ turns it into another kind of value. */
function ExprSlot({ expr, type, label }: { expr: Expr; type: 'number' | 'boolean' | 'text' | 'any'; label: string }) {
  const c = useC();
  const set = (patch: Record<string, unknown>) => c.update((s) => replaceBlock(s, expr.id, (b) => ({ ...b, ...patch }) as Expr), 'Edit value');
  const swap = (kind: ExprKind) => c.update((s) => replaceBlock(s, expr.id, () => ({ ...newExpr(kind, { variable: c.script.variables[0]?.name }), id: expr.id }) as Expr), 'Change value');
  const changer = (
    <button
      type="button"
      className="cw-slot-kind"
      aria-label={`${label}: ${t('script.changeValue')}`}
      onClick={(ev) => c.menu(ev.clientX, ev.clientY, VALUES_FOR[type].map((k) => ({ label: valueName(k), onSelect: () => swap(k) })))}
    >
      ▾
    </button>
  );
  const bad = c.problems.get(expr.id)?.some((p) => p.severity === 'error');
  let body: ReactNode;
  switch (expr.kind) {
    case 'number':
      body = <InlineValue type="number" value={expr.value} label={label} onChange={(v) => set({ value: v })} />;
      break;
    case 'text':
      body = <InlineValue type="text" value={expr.value} label={label} onChange={(v) => set({ value: v })} />;
      break;
    case 'boolean':
      body = <InlineValue type="boolean" value={expr.value} label={label} onChange={(v) => set({ value: v })} />;
      break;
    case 'variable':
      body = <VariableSlot value={expr.name} label={label} onChange={(name) => set({ name })} />;
      break;
    case 'time':
      body = <span className="cw-pill-text">{w('time')}</span>;
      break;
    case 'object':
      body = <RefSlot value={expr.ref} label={label} onChange={(ref) => ref && set({ ref })} />;
      break;
    case 'not':
      body = (
        <>
          {w('not')} <ExprSlot expr={expr.a} type="boolean" label={`${label} ${w('not')}`} />
        </>
      );
      break;
    case 'random':
      body = (
        <>
          {w('random')} <ExprSlot expr={expr.min} type="number" label={`${label} min`} /> {w('toWord')} <ExprSlot expr={expr.max} type="number" label={`${label} max`} />
        </>
      );
      break;
    case 'join':
      body = (
        <>
          {w('join')} <ExprSlot expr={expr.a} type="text" label={`${label} 1`} /> <ExprSlot expr={expr.b} type="text" label={`${label} 2`} />
        </>
      );
      break;
    case 'maths':
    case 'compare':
    case 'logic': {
      const ops = expr.kind === 'maths' ? ['+', '-', '×', '÷', 'mod'] : expr.kind === 'compare' ? ['=', '≠', '<', '>', '≤', '≥'] : ['and', 'or'];
      const side = expr.kind === 'logic' ? 'boolean' : expr.kind === 'maths' ? 'number' : 'any';
      body = (
        <>
          <ExprSlot expr={expr.a} type={side} label={`${label} 1`} />
          <select className="cw-input cw-mini cw-op" aria-label={`${label} op`} value={expr.op} onChange={(e) => set({ op: e.target.value })}>
            {ops.map((o) => (
              <option key={o} value={o}>
                {o === 'and' ? w('and') : o === 'or' ? w('or') : o}
              </option>
            ))}
          </select>
          <ExprSlot expr={expr.b} type={side} label={`${label} 2`} />
        </>
      );
      break;
    }
  }
  const simple = expr.kind === 'number' || expr.kind === 'text' || expr.kind === 'boolean' || expr.kind === 'variable' || expr.kind === 'object';
  return (
    <span className={`cw-expr${simple ? '' : ' pill'}${bad ? ' bad' : ''}`} data-block={expr.id}>
      {body}
      {changer}
    </span>
  );
}
