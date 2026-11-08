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
  freshIds,
  innerLists,
  type EventBlock,
  type EventLimit,
  type Handler,
  type EventKind,
  type Expr,
  type ExprKind,
  type Problem,
  type Place,
  type Ref,
  type Script,
  type Statement,
  type StatementKind,
  type VariableDef,
  emptyScript,
} from '@cocoaworlds/scripting';
import { CREATURE_MOMENTS, UI_SCRIPT_OWNER, uiOf, type GameValue } from '@cocoaworlds/core';
import { Button, ContextMenu, IconButton, type MenuEntry } from '@cocoaworlds/ui';
import { Picker, type PickGroup, type PickItem } from './Picker';
import { Fragment, createContext, useContext, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { getLang, t } from '../../i18n';
import { useEditor } from '../../store';
import { sceneInfo } from './scene-info';
import { EVENT_GROUPS, STATEMENT_GROUPS, VALUES_FOR, axisLabel, directionLabel, eventName, groupTitle, statementName, valueName, w } from './words';

interface Ctx {
  owner: string;
  script: Script;
  /** Game values shared by every script (from the project). */
  globals: GameValue[];
  update: (fn: (s: Script) => Script, label: string, mergeKey?: string) => void;
  problems: Map<string, Problem[]>;
  active: Set<string>;
  objects: { id: string; name: string; isZone: boolean; isSign: boolean; isLight: boolean }[];
  menu: (x: number, y: number, items: MenuEntry[]) => void;
  pick: (x: number, y: number, groups: PickGroup[], extra?: PickItem | null) => void;
  /** The handler being drawn (for “the thing that entered”). */
  otherAllowed: boolean;
  /** In “When the player uses this”, the other thing is the player. */
  otherIsPlayer?: boolean;
}
const C = createContext<Ctx | null>(null);
const useC = () => useContext(C)!;

/**
 * Copied blocks: one block (with what's inside it) or a whole stack. Lives for the app session, so blocks can
 * be pasted into another object's script.
 */
type Clip = { kind: 'blocks'; blocks: Statement[] } | { kind: 'stack'; handler: Handler };
let clip: Clip | null = null;
const clipListeners = new Set<() => void>();
function setClip(next: Clip) {
  clip = JSON.parse(JSON.stringify(next)) as Clip;
  for (const f of clipListeners) f();
}
/** Paste the clipboard into a script: blocks into a list at an index, a stack at the end. */
function pasteInto(s: Script, at: { key: string; index: number } | null): Script {
  if (!clip) return s;
  if (clip.kind === 'stack') return addHandler(s, freshIds(clip.handler));
  let out = s;
  const blocks = freshIds(clip.blocks);
  const where = at ?? (s.handlers.length ? { key: s.handlers[s.handlers.length - 1]!.id, index: s.handlers[s.handlers.length - 1]!.body.length } : null);
  if (!where) return s;
  blocks.forEach((b, i) => (out = insertStatement(out, where.key, where.index + i, b)));
  return out;
}
const clipLabel = () => (!clip ? '' : clip.kind === 'stack' ? t('script.pasteStack') : t('script.pasteBlocks').replace('{n}', String(countBlocks(clip.blocks))));
function countBlocks(list: Statement[]): number {
  return list.reduce((n, s) => n + 1 + innerLists(s).reduce((m, [, l]) => m + countBlocks(l), 0), 0);
}

/** The selected object's blocks, or with `screens`, the screens' own script (in the Screens workspace). */
export function ScriptPanel({ screens = false }: { screens?: boolean } = {}) {
  useEditor((s) => s.rev);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const active = useEditor((s) => s.activeBlocks);
  const playing = useEditor((s) => !!s.playing);
  const st = useEditor.getState();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; groups: PickGroup[]; extra?: PickItem | null } | null>(null);
  const [, setClipRev] = useState(0);
  useEffect(() => {
    const f = () => setClipRev((n) => n + 1);
    clipListeners.add(f);
    return () => void clipListeners.delete(f);
  }, []);

  const owner = screens ? (doc ? { id: UI_SCRIPT_OWNER, name: t('script.screens') } : undefined) : selection.length === 1 ? doc?.get(selection[0]!) : undefined;
  const script = (screens ? (uiOf(doc?.settings).script ?? emptyScript()) : (owner as { components?: Record<string, unknown> } | undefined)?.components?.script) as Script | undefined;
  const project = useEditor((s) => s.session?.project);
  const globals = useMemo(() => project?.settings.values ?? [], [project]);
  const objects = useMemo(
    () => (doc ? doc.entities.map((e) => ({ id: e.id, name: e.name, isZone: !!e.components.trigger, isSign: !!e.components.sign, isLight: !!e.components.light })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, useEditor.getState().rev],
  );
  const problems = useMemo(() => {
    const m = new Map<string, Problem[]>();
    if (!owner || !script) return m;
    const info = sceneInfo(doc!, project);
    for (const p of compileScript(owner.id, script, info).problems) m.set(p.block, [...(m.get(p.block) ?? []), p]);
    return m;
  }, [owner, script, objects, project, globals]);

  if (!owner) return <div className="cw-muted cw-script-empty">{t('script.selectObject')}</div>;
  if (!script)
    return (
      <div className="cw-script-empty">
        <span className="cw-muted">{t('script.none').replace('{name}', owner.name)}</span>
        <Button variant="primary" onClick={() => st.addComponent(owner.id, 'script')}>
          {t('script.add')}
        </Button>
        <Button onClick={() => st.openDialog('recipes')}>{t('recipe.open')}</Button>
      </div>
    );

  const ctx: Ctx = {
    owner: owner.id,
    script,
    globals,
    update: screens
      ? (fn, label, mergeKey) => st.setSceneSettings({ ui: { ...uiOf(useEditor.getState().doc?.settings), script: fn((uiOf(useEditor.getState().doc?.settings).script as Script | undefined) ?? emptyScript()) } }, label, mergeKey)
      : (fn, label, mergeKey) => st.updateScript(owner.id, fn, label, mergeKey),
    problems,
    active: new Set(active.get(owner.id) ?? []),
    objects,
    menu: (x, y, items) => setMenu({ x, y, items }),
    pick: (x, y, groups, extra) => setPicker({ x, y, groups, extra }),
    otherAllowed: false,
  };
  const addStack = (ev: { clientX: number; clientY: number }) =>
    ctx.pick(
      ev.clientX,
      ev.clientY,
      EVENT_GROUPS.map((g) => ({
        title: groupTitle(g.title),
        items: g.kinds.map((k) => ({
          label: eventName(k),
          onSelect: () => {
            const zone: Ref = objects.find((o) => o.id === owner.id)?.isZone ? { self: true } : objects.find((o) => o.isZone) ? { entity: objects.find((o) => o.isZone)!.id } : { self: true };
            const ev = newEvent(k, zone);
            const ui = uiOf(useEditor.getState().doc?.settings);
            if (ev.kind === 'uiClick') ev.element = ui.screens.flatMap((x) => x.elements).find((e) => e.kind === 'button')?.id ?? '';
            if (ev.kind === 'listPick') ev.list = ui.screens.flatMap((x) => x.elements).find((e) => e.kind === 'list')?.id ?? '';
            ctx.update((s) => addHandler(s, { id: blockId(), event: ev, body: [] }), 'Add stack');
          },
        })),
      })),
      clip ? { label: clipLabel(), onSelect: () => ctx.update((s) => pasteInto(s, null), 'Paste blocks') } : null,
    );
  /** Ctrl+C / Ctrl+X / Ctrl+V / Delete on the block (or stack) that has the keyboard focus. */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || playing) return;
    const id = el.closest<HTMLElement>('[data-pick]')?.dataset.pick;
    if (!id) return;
    const m = e.ctrlKey || e.metaKey;
    const k = e.code.replace(/^Key/, '').toLowerCase();
    const handler = script.handlers.find((h) => h.id === id);
    const at = handler ? null : locate(script, id);
    const stmt = at ? findStatement(script, id) : null;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (m && (k === 'c' || k === 'x')) {
      if (handler) setClip({ kind: 'stack', handler });
      else if (stmt) setClip({ kind: 'blocks', blocks: [stmt] });
      if (k === 'x') ctx.update((s) => (handler ? removeHandler(s, id) : removeStatement(s, id)), 'Cut blocks');
      return done();
    }
    if (m && k === 'v') {
      if (clip) ctx.update((s) => pasteInto(s, clip?.kind === 'blocks' ? (handler ? { key: handler.id, index: handler.body.length } : at && { key: at.key, index: at.index + 1 }) : null), 'Paste blocks');
      return done();
    }
    if (m && k === 'd') {
      if (handler) ctx.update((s) => addHandler(s, freshIds(handler)), 'Duplicate stack');
      else if (stmt && at) ctx.update((s) => insertStatement(s, at.key, at.index + 1, freshIds(stmt)), 'Duplicate block');
      return done();
    }
    if (!m && (e.key === 'Delete' || e.key === 'Backspace')) {
      ctx.update((s) => (handler ? removeHandler(s, id) : removeStatement(s, id)), 'Remove block');
      return done();
    }
    // Keep editor shortcuts (tools, Ctrl+Z) off the picked block's keys.
    if (m && k !== 'z' && k !== 'y' && k !== 's') e.stopPropagation();
  };

  return (
    <C.Provider value={ctx}>
      <div className={`cw-script${playing ? ' playing' : ''}`} aria-label={t('script.title').replace('{name}', owner.name)} role="region" onKeyDown={onKey}>
        <div className="cw-script-head">
          <span className="cw-script-owner">{t('script.title').replace('{name}', owner.name)}</span>
          <Variables />
          <GameValues />
          <span className="cw-sp" />
          {!screens && <Button onClick={() => st.openDialog('recipes')}>{t('recipe.open')}</Button>}
          <Button onClick={addStack}>{t('script.addStack')}</Button>
        </div>
        <div className="cw-stacks">
          {!script.handlers.length && <p className="cw-hint">{t('script.empty')}</p>}
          {script.handlers.map((h) => (
            <C.Provider key={h.id} value={{ ...ctx, otherAllowed: h.event.kind === 'enter' || h.event.kind === 'leave' || h.event.kind === 'use', otherIsPlayer: h.event.kind === 'use' }}>
              <div className="cw-stack" role="group" aria-label={eventName(h.event.kind)}>
                <EventRow ev={h.event} onRemove={() => ctx.update((s) => removeHandler(s, h.id), 'Remove stack')} onCopy={() => setClip({ kind: 'stack', handler: h })} pick={h.id} />
                <List listKey={h.id} list={h.body} />
              </div>
            </C.Provider>
          ))}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {picker && <Picker {...picker} onClose={() => setPicker(null)} />}
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

/** Game values: shared by every script in the project, saved in the project file. */
function GameValues() {
  const c = useC();
  const save = useEditor((s) => s.setGameValues);
  const playing = useEditor((s) => !!s.playing);
  const list = c.globals;
  const put = (next: GameValue[], label: string) => !playing && void save(next, label);
  const add = () => {
    let n = 1;
    const base = list.length ? 'Value' : 'Cash';
    let name = base;
    while (list.some((v) => v.name === name)) name = `${base}${++n}`;
    put([...list, { name, type: 'number', initial: 0, show: true }], `Added the game value ${name}`);
  };
  const edit = (i: number, next: GameValue) => put(list.map((v, j) => (j === i ? next : v)), `Changed the game value ${next.name}`);
  return (
    <div className="cw-vars" aria-label={t('script.gameValues')}>
      <span className="cw-muted" title={t('script.gameValuesHint')}>
        {t('script.gameValues')}
      </span>
      {list.map((v, i) => (
        <span key={v.name} className="cw-var game">
          <input
            className="cw-input cw-var-name"
            aria-label={t('script.gameValueName')}
            defaultValue={v.name}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim();
              if (!name || name === v.name) return void (e.currentTarget.value = v.name);
              if (list.some((x) => x.name === name)) return void (e.currentTarget.value = v.name);
              edit(i, { ...v, name });
            }}
          />
          <select
            className="cw-input cw-mini"
            aria-label={`${v.name} ${t('script.varType')}`}
            value={v.type}
            onChange={(e) => {
              const type = e.target.value as GameValue['type'];
              edit(i, { ...v, type, initial: type === 'number' ? 0 : type === 'boolean' ? false : '' });
            }}
          >
            <option value="number">{t('script.typeNumber')}</option>
            <option value="boolean">{t('script.typeBoolean')}</option>
            <option value="text">{t('script.typeText')}</option>
          </select>
          <span className="cw-muted">=</span>
          <InlineValue type={v.type} value={v.initial} label={`${v.name} ${t('script.startsAt')}`} onChange={(initial) => edit(i, { ...v, initial })} />
          <label className="cw-var-show">
            <input type="checkbox" checked={v.show} aria-label={`${v.name}: ${t('script.showOnScreen')}`} onChange={(e) => edit(i, { ...v, show: e.target.checked })} />
            {t('script.showOnScreen')}
          </label>
          <label className="cw-var-show" title={t('script.keptHint')}>
            <input type="checkbox" checked={!!v.saved} aria-label={`${v.name}: ${t('script.kept')}`} onChange={(e) => edit(i, { ...v, saved: e.target.checked })} />
            {t('script.kept')}
          </label>
          <IconButton icon="close" label={`${t('comp.remove')} ${v.name}`} className="cw-var-x" onClick={() => put(list.filter((_, j) => j !== i), `Removed the game value ${v.name}`)} />
        </span>
      ))}
      <Button size="sm" onClick={add}>
        {t('script.addGameValue')}
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

function findStatement(script: Script, id: string): Statement | null {
  const search = (list: Statement[]): Statement | null => {
    for (const s of list) {
      if (s.id === id) return s;
      for (const [, inner] of innerLists(s)) {
        const f = search(inner);
        if (f) return f;
      }
    }
    return null;
  };
  for (const h of script.handlers) {
    const f = search(h.body);
    if (f) return f;
  }
  return null;
}

function EventRow({ ev, onRemove, onCopy, pick }: { ev: EventBlock; onRemove: () => void; onCopy: () => void; pick: string }) {
  const c = useC();
  const set = (patch: Partial<EventBlock>) => c.update((s) => replaceBlock(s, ev.id, (b) => ({ ...b, ...patch }) as EventBlock), 'Edit block');
  let content: ReactNode;
  if (ev.kind === 'start') content = w('start');
  else if (ev.kind === 'use')
    content = (
      <>
        {w('use')}, {w('usePrompt')} <kbd className="cw-key">E</kbd>{' '}
        <TextSlot value={ev.prompt ?? ''} label={w('usePrompt')} onChange={(prompt) => set({ prompt } as Partial<EventBlock>)} />, {w('within')}{' '}
        <ReachSlot value={ev.reach} fallback={96} label={`${w('use')} ${w('within')}`} onChange={(reach) => set({ reach } as Partial<EventBlock>)} /> {w('units')}
      </>
    );
  else if (ev.kind === 'useHolding')
    content = (
      <>
        {w('useHolding')} <RefSlot value={ev.item} allowNone noHeld noneLabel={w('anything')} onChange={(item) => set({ item } as Partial<EventBlock>)} label={w('useHolding')} />, {w('within')}{' '}
        <ReachSlot value={ev.reach} fallback={128} label={`${w('useHolding')} ${w('within')}`} onChange={(reach) => set({ reach } as Partial<EventBlock>)} /> {w('units')}
      </>
    );
  else if (ev.kind === 'die') content = w('die');
  else if (ev.kind === 'breaks') content = w('breaks');
  else if (ev.kind === 'hit') content = w('hit');
  else if (ev.kind === 'dies') content = w('dies');
  else if (ev.kind === 'hides' || ev.kind === 'unhides' || ev.kind === 'found' || ev.kind === 'sits' || ev.kind === 'stands') content = w(ev.kind);
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
  else if (ev.kind === 'messageStop') content = (
    <>
      {w('messageStop')} <TextSlot value={ev.message} label={w('messageStop')} onChange={(message) => set({ message } as Partial<EventBlock>)} /> {w('stopsComing')}
    </>
  );
  else if (ev.kind === 'uiClick') content = (
    <>
      {w('uiClick')} <ElementSlot value={ev.element} kinds={['button']} label={w('uiClick')} onChange={(element) => set({ element } as Partial<EventBlock>)} />
    </>
  );
  else if (ev.kind === 'useItem') content = (
    <>
      {w('useItem')} <ItemSlot value={ev.item} allowAny label={w('useItem')} onChange={(item) => set({ item } as Partial<EventBlock>)} />
    </>
  );
  else if (ev.kind === 'listPick') content = (
    <>
      {w('listPick')} <ElementSlot value={ev.list} kinds={['list']} label={w('listPick')} onChange={(list) => set({ list } as Partial<EventBlock>)} />
    </>
  );
  else if (ev.kind === 'does') content = (
    <>
      {w('does')}{' '}
      <select className="cw-input cw-mini" aria-label={w('does')} value={ev.what} onChange={(e) => set({ what: e.target.value } as Partial<EventBlock>)}>
        <option value="">{w('anyMove')}</option>
        {CREATURE_MOMENTS.map((m) => (
          <option key={m.name} value={m.name}>
            {m.label[getLang() === 'ru' ? 'ru' : 'en']}
          </option>
        ))}
      </select>{' '}
      {w('doesHere')}
    </>
  );
  else if (ev.kind === 'key') content = (
    <>
      {w('keyEv')} <KeySlot value={ev.key} label={w('keyEv')} onChange={(key) => set({ key } as Partial<EventBlock>)} />
    </>
  );
  else if (ev.kind === 'press') content = (
    <>
      {w('keyEv')} <KeySlot value={ev.key} label={w('keyEv')} onChange={(key) => set({ key } as Partial<EventBlock>)} /> {w('atThis')}, {w('usePrompt')}{' '}
      <TextSlot value={ev.prompt ?? ''} label={w('usePrompt')} onChange={(prompt) => set({ prompt } as Partial<EventBlock>)} />, {w('within')}{' '}
      <ReachSlot value={ev.reach} fallback={96} label={`${w('keyEv')} ${w('within')}`} onChange={(reach) => set({ reach } as Partial<EventBlock>)} /> {w('units')}
    </>
  );
  else if (ev.kind === 'near' || ev.kind === 'far') content = (
    <>
      {w(ev.kind === 'near' ? 'nearEv' : 'farEv')} <ExprSlot expr={ev.distance} type="number" label={w(ev.kind === 'near' ? 'nearEv' : 'farEv')} /> {w(ev.kind === 'near' ? 'unitsOfThis' : 'unitsFromThis')}
    </>
  );
  else if (ev.kind === 'newDay') content = w('newDay');
  else if (ev.kind === 'dayStarts') content = (
    <>
      {w('dayStarts')} <ExprSlot expr={ev.day} type="number" label={w('dayStarts')} /> {w('starts')}
    </>
  );
  else if (ev.kind === 'atHour') content = (
    <>
      {w('atHour')} <ExprSlot expr={ev.hour} type="number" label={w('atHour')} /> {w('oClock')}
    </>
  );
  else if (ev.kind === 'every') content = (
    <>
      {w('every')} <ExprSlot expr={ev.seconds} type="number" label={w('every')} /> {w('seconds')}
    </>
  );
  // (Use stacks saved “only once” as `once` before every event had a limit.)
  const limit = ev.limit ?? ((ev as { once?: boolean }).once ? 'once' : '');
  return (
    <div className="cw-blk event" data-block={ev.id} data-pick={pick} tabIndex={-1} onMouseDown={focusRow}>
      <div className="cw-blk-line">
        <span className="cw-blk-words">
          {content}{' '}
          <select className="cw-slot cw-sb-limit" aria-label={w('limit')} value={limit} onChange={(e) => set({ limit: (e.currentTarget.value || undefined) as EventLimit | undefined, once: undefined } as Partial<EventBlock>)}>
            <option value="">{w('limitAny')}</option>
            <option value="day">{w('limitDay')}</option>
            <option value="once">{w('limitOnce')}</option>
          </select>
        </span>
        <span className="cw-blk-tools">
          <IconButton icon="copy" label={t('script.copyStack')} onClick={onCopy} />
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
      {list.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && (
            <button type="button" className={`cw-blk-and${s.and ? ' on' : ''}`} aria-pressed={!!s.and} onClick={() => c.update((sc) => replaceBlock(sc, s.id, (b) => ({ ...b, and: s.and ? undefined : true }) as Statement), s.and ? 'Run blocks in turn' : 'Run blocks together')}>
              {w('and')}
            </button>
          )}
          <StatementRow s={s} listKey={listKey} />
        </Fragment>
      ))}
      <button
        type="button"
        className="cw-add-blk"
        onClick={(ev) =>
          pickBlock(
            c,
            ev,
            (stmt) => c.update((sc) => insertStatement(sc, listKey, list.length, stmt), 'Add block'),
            () => c.update((sc) => pasteInto(sc, { key: listKey, index: list.length }), 'Paste blocks'),
          )
        }
      >
        + {t('script.addBlock')}
      </button>
    </div>
  );
}

/** Clicking a block's words picks it (for Ctrl+C, Ctrl+V, Delete), unless the click was in a slot. */
function focusRow(e: React.MouseEvent<HTMLElement>) {
  const el = e.target as HTMLElement;
  if (el.closest('input, select, button, textarea')) return;
  if (el.closest('[data-pick]') !== e.currentTarget) return;
  e.preventDefault();
  e.currentTarget.focus();
}

/** New screen and item blocks start on the first screen, element or item there is. */
function withUiDefaults<T extends Statement>(s: T): T {
  const ui = uiOf(useEditor.getState().doc?.settings);
  const els = ui.screens.flatMap((x) => x.elements);
  const o = s as Record<string, unknown>;
  if (o.screen === '' && ui.screens[0]) o.screen = ui.screens[0].id;
  if (o.list === '') o.list = els.find((e) => e.kind === 'list' && e.source === 'rows')?.id ?? '';
  if (o.element === '') o.element = (s.kind === 'setUiText' ? els.find((e) => e.kind === 'text' || e.kind === 'button') : els[0])?.id ?? '';
  if (o.item === '' && ui.items[0]) o.item = ui.items[0].name;
  return s;
}

/** Open the block picker; `add` puts the new block in, `paste` the copied ones. */
function pickBlock(c: Ctx, ev: { clientX: number; clientY: number }, add: (s: Statement) => void, paste?: () => void): void {
  const firstVar = c.script.variables[0]?.name;
  c.pick(
    ev.clientX,
    ev.clientY,
    STATEMENT_GROUPS.map((g) => ({
      title: groupTitle(g.title),
      items: g.kinds.map((k) => ({ label: statementName(k), onSelect: () => add(withUiDefaults(newStatement(k as StatementKind, { target: { self: true }, variable: firstVar }))) })),
    })),
    paste && clip?.kind === 'blocks' ? { label: clipLabel(), onSelect: paste } : null,
  );
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
    ) : s.kind === 'oneOf' ? (
      <>
        {s.options.map((list, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <div className="cw-blk-else">
                {w('orElse')}
                {s.options.length > 1 && <IconButton icon="close" label={t('script.removeChoice')} onClick={() => set({ options: s.options.filter((_, j) => j !== i) })} />}
              </div>
            )}
            <List listKey={`${s.id}:o${i}`} list={list} />
          </Fragment>
        ))}
        <button type="button" className="cw-add-blk" onClick={() => set({ options: [...s.options, []] })}>
          {w('addChoice')}
        </button>
      </>
    ) : s.kind === 'repeat' || s.kind === 'forever' || s.kind === 'while' ? (
      <List listKey={`${s.id}:body`} list={s.body} />
    ) : null;
  return (
    <div className={`cw-blk ${kindClass(s.kind)}${c.active.has(s.id) ? ' running' : ''}${c.problems.get(s.id)?.some((p) => p.severity === 'error') ? ' bad' : ''}`} data-block={s.id} data-pick={s.id} tabIndex={-1} onMouseDown={focusRow} role="group" aria-label={statementName(s.kind)}>
      <div className="cw-blk-line">
        <span className="cw-blk-words">{words}</span>
        <span className="cw-blk-tools">
          <IconButton
            icon="plus"
            label={t('script.addAfter')}
            onClick={(ev) =>
              pickBlock(
                c,
                ev,
                (stmt) => at && c.update((sc) => insertStatement(sc, at.key, at.index + 1, stmt), 'Add block'),
                () => at && c.update((sc) => pasteInto(sc, { key: at.key, index: at.index + 1 }), 'Paste blocks'),
              )
            }
          />
          <IconButton icon="copy" label={t('script.copyBlock')} onClick={() => setClip({ kind: 'blocks', blocks: [s] })} />
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

const kindClass = (k: StatementKind) => (k === 'if' || k === 'oneOf' || k === 'repeat' || k === 'forever' || k === 'while' || k === 'wait' || k === 'stop' ? 'control' : k === 'set' || k === 'change' ? 'data' : 'action');

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
    case 'turnTo':
      return (
        <>
          {w('turnTo')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={statementName('turnTo')} /> {w('toAngle')}{' '}
          <ExprSlot expr={s.degrees} type="number" label={`${statementName('turnTo')} ${w('toAngle')}`} /> {w('fromStart')}
          <select className="cw-input cw-mini" aria-label={`${statementName('turnTo')} ${w('around')}`} value={s.axis} onChange={(e) => set({ axis: e.target.value })}>
            {(['up', 'north', 'east'] as const).map((a) => (
              <option key={a} value={a}>
                {axisLabel(a)}
              </option>
            ))}
          </select>
          {w('over')} <ExprSlot expr={s.seconds} type="number" label={`${statementName('turnTo')} ${w('over')}`} /> {w('seconds')}
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
    case 'startTrain':
    case 'stopTrain':
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
    case 'oneOf':
      return w('oneOf');
    case 'forgetProgress':
      return w('forgetProgress');
    case 'saveGame':
      return w('saveGame');
    case 'blockSaving':
      return w('blockSaving');
    case 'allowSaving':
      return w('allowSaving');
    case 'changeScene':
      return (
        <>
          {w('changeScene')} <SceneSlot value={s.scene} label={w('changeScene')} onChange={(scene) => set({ scene })} /> {w('landmark')}{' '}
          <TextSlot value={s.landmark} label={w('landmark')} onChange={(landmark) => set({ landmark })} />
        </>
      );
    case 'while':
      return (
        <>
          {w('while')} <ExprSlot expr={s.condition} type="boolean" label={w('while')} />
        </>
      );
    case 'stop':
      return w('stop');
    case 'spawn':
      return (
        <>
          {w('spawn')} <RefSlot value={s.template} onChange={(template) => set({ template })} label={w('spawn')} /> {w('at')}{' '}
          <RefSlot value={s.at} allowPlayer allowAim onChange={(at) => set({ at })} label={`${w('spawn')} ${w('at')}`} />
        </>
      );
    case 'remove':
      return (
        <>
          {w('remove')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('remove')} />
        </>
      );
    case 'physical':
      return (
        <>
          {w('physical')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('physical')} /> {w('fall')}
        </>
      );
    case 'scale':
      return (
        <>
          {w('scale')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('scale')} /> {w('setTo')}{' '}
          <ExprSlot expr={s.factor} type="number" label={`${w('scale')} ${w('setTo')}`} /> {w('timesSize')} <ExprSlot expr={s.seconds} type="number" label={`${w('scale')} ${w('over')}`} /> {w('seconds')}
        </>
      );
    case 'explode':
      return (
        <>
          {w('explode')} <RefSlot value={s.at} allowPlayer allowAim onChange={(at) => at && set({ at })} label={w('explode')} /> {w('blastSize')}{' '}
          <ExprSlot expr={s.radius} type="number" label={`${w('explode')} ${w('blastSize')}`} /> {w('units')}, {w('damage')} <ExprSlot expr={s.amount} type="number" label={`${w('explode')} ${w('damage')}`} />
        </>
      );
    case 'playEffect':
      return (
        <>
          {w('playEffect')} <EffectSlot value={s.effect} onChange={(effect) => set({ effect })} /> {w('atWord')} <RefSlot value={s.at} allowPlayer allowAim onChange={(at) => at && set({ at })} label={`${w('playEffect')} ${w('atWord')}`} />{' '}
          <label className="cw-mini-check">
            <input type="checkbox" checked={s.follow} onChange={(e) => set({ follow: e.target.checked })} /> {w('followIt')}
          </label>
        </>
      );
    case 'noise':
      return (
        <>
          {w('noise')} <RefSlot value={s.at} allowPlayer allowAim onChange={(at) => at && set({ at })} label={w('noise')} /> {w('loudness')}{' '}
          <ExprSlot expr={s.loudness} type="number" label={`${w('noise')} ${w('loudness')}`} />
        </>
      );
    case 'hint':
      return (
        <>
          {w('hint')} <RefSlot value={s.at} allowPlayer allowAim onChange={(at) => at && set({ at })} label={w('hint')} /> {w('giveOrTake')}{' '}
          <ExprSlot expr={s.spread} type="number" label={`${w('hint')} ${w('giveOrTake')}`} /> {w('sure')} <ExprSlot expr={s.sure} type="number" label={`${w('hint')} ${w('sure')}`} /> {w('asKind')}{' '}
          <select className="cw-input cw-mini" aria-label={`${w('hint')} ${w('asKind')}`} value={s.as} onChange={(e) => set({ as: e.target.value as 'sound' | 'sighting' | 'event' })}>
            <option value="sound">{w('hintSound')}</option>
            <option value="sighting">{w('hintSighting')}</option>
            <option value="event">{w('hintEvent')}</option>
          </select>
        </>
      );
    case 'push':
      return (
        <>
          {w('push')} <RefSlot value={s.target} allowPlayer onChange={(target) => set({ target })} label={w('push')} />
          <select className="cw-input cw-mini" aria-label={`${w('push')} ${w('direction')}`} value={s.direction} onChange={(e) => set({ direction: e.target.value })}>
            {(['up', 'down', 'north', 'south', 'east', 'west'] as const).map((d) => (
              <option key={d} value={d}>
                {directionLabel(d)}
              </option>
            ))}
          </select>
          {w('withStrength')} <ExprSlot expr={s.strength} type="number" label={`${w('push')} ${w('withStrength')}`} />
        </>
      );
    case 'freezePlayer':
    case 'unfreezePlayer':
    case 'unhide':
    case 'drop':
    case 'silence':
    case 'unsilence':
      return w(s.kind);
    case 'place':
      return (
        <>
          {w('put')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('put')} /> {w('atSpot')}{' '}
          <RefSlot value={s.spot} noHeld onChange={(spot) => set({ spot })} label={`${w('put')} ${w('atSpot')}`} />
          <select className="cw-input cw-mini" aria-label={`${w('put')} ${w('staysThere')}`} value={s.still ? 'still' : 'fall'} onChange={(e) => set({ still: e.target.value === 'still' })}>
            <option value="still">{w('staysThere')}</option>
            <option value="fall">{w('fallsThere')}</option>
          </select>
        </>
      );
    case 'pickUp':
      return (
        <>
          {w('pickUp')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('pickUp')} />
        </>
      );
    case 'viewFrom':
      return (
        <>
          {w('viewFrom')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('viewFrom')} /> {w('for')} <ExprSlot expr={s.seconds} type="number" label={`${w('viewFrom')} ${w('for')}`} />{' '}
          {w('seconds')}
        </>
      );
    case 'setSide':
      return (
        <>
          {w('setSide')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('setSide')} />{' '}
          <select className="cw-input cw-var-slot" aria-label={`${w('setSide')} ${w('sideIs')}`} value={s.side} onChange={(e) => set({ side: e.target.value as typeof s.side })}>
            <option value="hostile">{w('sideHostile')}</option>
            <option value="friendly">{w('sideFriendly')}</option>
            <option value="neutral">{w('sideNeutral')}</option>
          </select>
        </>
      );
    case 'runAway':
      return (
        <>
          {w('setSide')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('runAway')} /> {w('runAway')}{' '}
          <ExprSlot expr={s.seconds} type="number" label={`${w('runAway')} ${w('for')}`} /> {w('seconds')}
        </>
      );
    case 'wander':
      return (
        <>
          {w('setSide')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={statementName('wander')} />{' '}
          <select className="cw-input cw-var-slot" aria-label={statementName('wander')} value={s.on ? 'on' : 'off'} onChange={(e) => set({ on: e.target.value === 'on' })}>
            <option value="on">{w('wanderOn')}</option>
            <option value="off">{w('wanderOff')}</option>
          </select>
        </>
      );
    case 'walkTo':
      return (
        <>
          {w('walkTo')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('walkTo')} /> {w('to')}{' '}
          <RefSlot value={s.to} allowPlayer allowAim onChange={(to) => set({ to })} label={`${w('walkTo')} ${w('to')}`} />
        </>
      );
    case 'moveTo':
      return (
        <>
          {w('move')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('moveTo')} /> {w('to')}{' '}
          <RefSlot value={s.to} allowPlayer allowAim onChange={(to) => set({ to })} label={`${w('moveTo')} ${w('to')}`} /> {w('over')}{' '}
          <ExprSlot expr={s.seconds} type="number" label={`${w('moveTo')} ${w('over')}`} /> {w('seconds')}, {w('stopping')} <ExprSlot expr={s.gap} type="number" label={`${w('moveTo')} ${w('stopping')}`} />{' '}
          {w('short')}
        </>
      );
    case 'teleport':
      return (
        <>
          {w('teleport')} <RefSlot value={s.to} allowAim onChange={(to) => set({ to })} label={w('teleport')} />
        </>
      );
    case 'damage':
      return (
        <>
          {w('damage')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('damage')} /> {w('by')} <ExprSlot expr={s.amount} type="number" label={`${w('damage')} ${w('by')}`} />
        </>
      );
    case 'playSound':
      return (
        <>
          {w('playSound')} <SoundSlot value={s.sound} onChange={(sound) => set({ sound })} /> {w('at')}{' '}
          <RefSlot value={s.at} allowNone noneLabel={w('everywhere')} allowPlayer allowAim onChange={(at) => set({ at })} label={`${w('playSound')} ${w('at')}`} /> {w('volume')}{' '}
          <ExprSlot expr={s.volume} type="number" label={`${w('playSound')} ${w('volume')}`} /> {w('forCreatures')}{' '}
          {s.loudness ? (
            <ExprSlot expr={s.loudness} type="number" label={`${w('playSound')} ${w('forCreatures')}`} />
          ) : (
            <button type="button" className="cw-input cw-mini" onClick={() => set({ loudness: { ...newExpr('number'), value: 0 } as Expr })}>
              0
            </button>
          )}
        </>
      );
    case 'playAnim':
      return (
        <>
          {w('playAnim')} <TextSlot value={s.name} label={w('playAnim')} onChange={(name) => set({ name })} /> {w('onWord')}{' '}
          <RefSlot value={s.target} onChange={(target) => set({ target })} label={`${w('playAnim')} ${w('onWord')}`} />
          <select className="cw-input cw-mini" aria-label={`${w('playAnim')} ${w('looping')}`} value={s.loop ? 'loop' : 'once'} onChange={(e) => set({ loop: e.target.value === 'loop' })}>
            <option value="loop">{w('looping')}</option>
            <option value="once">{w('once')}</option>
          </select>
        </>
      );
    case 'stopSound':
      return (
        <>
          {w('stopSound')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('stopSound')} />
        </>
      );
    case 'say':
      return (
        <>
          {w('say')} <ExprSlot expr={s.text} type="text" label={w('say')} /> {w('forWord')} <ExprSlot expr={s.seconds} type="number" label={`${w('say')} ${w('forWord')}`} /> {w('seconds')}
        </>
      );
    case 'addRow':
    case 'removeRow':
      return (
        <>
          {w(s.kind)} <ExprSlot expr={s.text} type="text" label={statementName(s.kind)} /> {w(s.kind === 'addRow' ? 'toList' : 'fromList')}{' '}
          <ElementSlot value={s.list} kinds={['list']} label={`${statementName(s.kind)} list`} onChange={(list) => set({ list })} />
        </>
      );
    case 'clearList':
      return (
        <>
          {w('clearList')} <ElementSlot value={s.list} kinds={['list']} label={w('clearList')} onChange={(list) => set({ list })} />
        </>
      );
    case 'showScreen':
    case 'hideScreen':
    case 'toggleScreen':
      return (
        <>
          {w(s.kind)} <ScreenSlot value={s.screen} label={w(s.kind)} onChange={(screen) => set({ screen })} />
        </>
      );
    case 'showUi':
    case 'hideUi':
      return (
        <>
          {w(s.kind)} <ElementSlot value={s.element} label={statementName(s.kind)} onChange={(element) => set({ element })} />
        </>
      );
    case 'setUiText':
      return (
        <>
          {w('setUiText')} <ElementSlot value={s.element} kinds={['text', 'button']} label={statementName('setUiText')} onChange={(element) => set({ element })} /> {w('setTo')}{' '}
          <ExprSlot expr={s.text} type="text" label={`${statementName('setUiText')} ${w('setTo')}`} />
        </>
      );
    case 'giveItem':
      return (
        <>
          {w('giveItem')} <ExprSlot expr={s.amount} type="number" label={`${w('giveItem')} amount`} /> <ItemSlot value={s.item} label={w('giveItem')} onChange={(item) => set({ item })} />
        </>
      );
    case 'takeItem':
      return (
        <>
          {w('takeItem')} <ExprSlot expr={s.amount} type="number" label={`${w('takeItem')} amount`} /> <ItemSlot value={s.item} label={w('takeItem')} onChange={(item) => set({ item })} /> {w('fromPlayer')}
        </>
      );
    case 'setText':
      return (
        <>
          {w('setText')} <RefSlot value={s.target} signsOnly onChange={(target) => set({ target })} label={w('setText')} /> {w('setTo')}{' '}
          <ExprSlot expr={s.text} type="text" label={`${w('setText')} ${w('setTo')}`} />
        </>
      );
    case 'setLight':
      return (
        <>
          {w('setLight')}
          <select className="cw-input cw-mini" aria-label={statementName('setLight')} value={s.prop} onChange={(e) => set({ prop: e.target.value, value: e.target.value === 'color' ? ({ ...newExpr('text'), value: '#ffffff' } as Expr) : ({ ...newExpr('number'), value: 1 } as Expr) })}>
            {(['intensity', 'range', 'angle', 'color'] as const).map((p) => (
              <option key={p} value={p}>
                {w(p)}
              </option>
            ))}
          </select>
          {w('ofLight')} <RefSlot value={s.target} lightsOnly onChange={(target) => set({ target })} label={statementName('setLight')} /> {w('setTo')}{' '}
          <ExprSlot expr={s.value} type={s.prop === 'color' ? 'text' : 'number'} label={`${statementName('setLight')} ${w('setTo')}`} /> {w('over')}{' '}
          <ExprSlot expr={s.seconds} type="number" label={`${statementName('setLight')} ${w('over')}`} /> {w('seconds')}
        </>
      );
    case 'setTime':
      return (
        <>
          {w('setTime')} <ExprSlot expr={s.value} type="number" label={w('setTime')} /> {w('hoursNoon')}
        </>
      );
    case 'setDay':
      return (
        <>
          {w('setDay')} <ExprSlot expr={s.value} type="number" label={w('setDay')} />
        </>
      );
    case 'setGlow':
      return (
        <>
          {w('setGlow')} <RefSlot value={s.target} onChange={(target) => set({ target })} label={w('setGlow')} /> {w('setTo')}{' '}
          <ExprSlot expr={s.strength} type="number" label={`${w('setGlow')} ${w('setTo')}`} /> {w('over')}{' '}
          <ExprSlot expr={s.seconds} type="number" label={`${w('setGlow')} ${w('over')}`} /> {w('seconds')}
        </>
      );
    case 'hurt':
    case 'heal':
    case 'giveArmour':
    case 'addScore':
      return (
        <>
          {w(s.kind)} <ExprSlot expr={s.amount} type="number" label={w(s.kind)} />
        </>
      );
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

function RefSlot<T extends Ref | Place | null>({
  value,
  onChange,
  label,
  zonesOnly,
  signsOnly,
  lightsOnly,
  allowNone,
  allowPlayer,
  allowAim,
  noneLabel,
  noHeld,
}: {
  value: T;
  onChange: (r: T) => void;
  label: string;
  zonesOnly?: boolean;
  signsOnly?: boolean;
  lightsOnly?: boolean;
  allowNone?: boolean;
  /** Offer “the player”. */
  allowPlayer?: boolean;
  /** Offer “where the player looks” (places only). */
  allowAim?: boolean;
  /** What “none” is called (default: everyone). */
  noneLabel?: string;
  /** Leave out “what the player holds”. */
  noHeld?: boolean;
}) {
  const c = useC();
  const enc = (r: Ref | Place | null) =>
    r === null ? 'none' : 'self' in r ? 'self' : 'other' in r ? 'other' : 'player' in r ? 'player' : 'aim' in r ? 'aim' : 'held' in r ? 'held' : `e:${r.entity}`;
  const dec = (v: string) =>
    (v === 'none'
      ? null
      : v === 'self'
        ? { self: true }
        : v === 'other'
          ? { other: true }
          : v === 'player'
            ? { player: true }
            : v === 'aim'
              ? { aim: true }
              : v === 'held'
                ? { held: true }
                : { entity: v.slice(2) }) as T;
  const objs = c.objects.filter((o) => o.id !== c.owner && (!zonesOnly || o.isZone) && (!signsOnly || o.isSign) && (!lightsOnly || o.isLight));
  const current = enc(value);
  const missing = current.startsWith('e:') && !c.objects.some((o) => o.id === current.slice(2));
  return (
    <select className="cw-input cw-ref" aria-label={label} value={current} onChange={(e) => onChange(dec(e.target.value))}>
      {allowNone && <option value="none">{noneLabel ?? w('everyone')}</option>}
      <option value="self">{w('self')}</option>
      {(allowPlayer || current === 'player') && <option value="player">{w('player')}</option>}
      {(allowAim || current === 'aim') && <option value="aim">{w('aim')}</option>}
      {((!zonesOnly && !signsOnly && !lightsOnly && !noHeld) || current === 'held') && <option value="held">{w('held')}</option>}
      {!zonesOnly && (c.otherAllowed || current === 'other') && <option value="other">{c.otherIsPlayer ? w('player') : w('other')}</option>}
      {missing && <option value={current}>?</option>}
      {objs.map((o) => (
        <option key={o.id} value={`e:${o.id}`}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** How far Use reaches (units): a plain number. */
function ReachSlot({ value, fallback, label, onChange }: { value: Expr | undefined; fallback: number; label: string; onChange: (e: Expr) => void }) {
  const v = value?.kind === 'number' ? value.value : fallback;
  return (
    <input
      className="cw-input cw-mini"
      style={{ width: 72 }}
      type="number"
      min={1}
      step={16}
      aria-label={label}
      value={v}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (n > 0) onChange({ id: value?.id ?? blockId(), kind: 'number', value: n });
      }}
    />
  );
}

/** A screen of the scene's screen UI. */
function ScreenSlot({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  useEditor((st) => st.rev);
  const screens = uiOf(useEditor.getState().doc?.settings).screens;
  return (
    <select className="cw-input cw-ref" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {!screens.some((x) => x.id === value) && <option value={value}>{value ? '?' : w('pickScreen')}</option>}
      {screens.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );
}

/** Something on a screen (of the given kinds), listed as “screen › name”. */
function ElementSlot({ value, onChange, label, kinds }: { value: string; onChange: (v: string) => void; label: string; kinds?: string[] }) {
  useEditor((st) => st.rev);
  const els = uiOf(useEditor.getState().doc?.settings).screens.flatMap((sc) => sc.elements.filter((e) => !kinds || kinds.includes(e.kind)).map((e) => ({ id: e.id, name: `${sc.name} › ${e.name}` })));
  return (
    <select className="cw-input cw-ref" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {!els.some((x) => x.id === value) && <option value={value}>{value ? '?' : w('pickElement')}</option>}
      {els.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );
}

/** Keys a game can react to: letters the game doesn't use itself, and Tab. */
const FREE_KEYS = ['Tab', ...'BFGHIJKLMNOPQRTUVXYZ'.split('').map((c) => `Key${c}`)];

function KeySlot({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select className="cw-input cw-ref" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {!FREE_KEYS.includes(value) && <option value={value}>{value || '?'}</option>}
      {FREE_KEYS.map((k) => (
        <option key={k} value={k}>
          {k.replace(/^Key/, '')}
        </option>
      ))}
    </select>
  );
}

/** An item the player can carry (or any item, for “When the player uses”). */
function ItemSlot({ value, onChange, label, allowAny }: { value: string; onChange: (v: string) => void; label: string; allowAny?: boolean }) {
  useEditor((st) => st.rev);
  const items = uiOf(useEditor.getState().doc?.settings).items;
  return (
    <select className="cw-input cw-ref" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAny ? <option value="">{w('anyItem')}</option> : !items.some((x) => x.name === value) && <option value={value}>{value ? `${value} ?` : w('pickItem')}</option>}
      {allowAny && value && !items.some((x) => x.name === value) && <option value={value}>{value} ?</option>}
      {items.map((x) => (
        <option key={x.name} value={x.name}>
          {x.name}
        </option>
      ))}
    </select>
  );
}

/** An effect from the VFX workspace. */
function EffectSlot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const effects = useEditor((s) => s.session?.project.settings.effects) ?? [];
  return (
    <select className="cw-input cw-ref" aria-label={w('playEffect')} value={value} onChange={(e) => onChange(e.target.value)}>
      {!effects.some((x) => x.id === value) && <option value={value}>{value ? `${value} ?` : w('pickEffect')}</option>}
      {effects.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );
}

/** A sound file from the project's assets. */
function SoundSlot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const sounds = useEditor((s) => s.assets.sounds);
  return (
    <select className="cw-input cw-ref" aria-label={w('playSound')} value={value} onChange={(e) => onChange(e.target.value)}>
      {!sounds.some((x) => x.path === value) && <option value={value}>{value ? `${value} ?` : w('pickSound')}</option>}
      {sounds.map((x) => (
        <option key={x.path} value={x.path}>
          {x.name}
        </option>
      ))}
    </select>
  );
}

/** A scene of the project, by name. */
function SceneSlot({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const scenes = (useEditor((s) => s.session?.project.scenes) ?? []).map((p) => p.split('/').pop()!.replace(/\.cwscene$/, ''));
  return (
    <select className="cw-input cw-var-slot" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {!scenes.includes(value) && <option value={value}>{value || w('pickScene')}</option>}
      {scenes.map((n) => (
        <option key={n} value={n}>
          {n}
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
  // Game values the script's own variables don't hide.
  const games = c.globals.filter((g) => (!numbersOnly || g.type === 'number') && !c.script.variables.some((v) => v.name === g.name));
  return (
    <select className="cw-input cw-var-slot" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {!vars.some((v) => v.name === value) && !games.some((g) => g.name === value) && <option value={value}>{value || w('pickVariable')}</option>}
      {vars.map((v) => (
        <option key={v.name} value={v.name}>
          {v.name}
        </option>
      ))}
      {games.map((g) => (
        <option key={`g:${g.name}`} value={g.name}>
          {g.name} ({w('gameValue')})
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
    case 'health':
    case 'armour':
    case 'score':
    case 'copy':
      body = <span className="cw-pill-text">{w(expr.kind)}</span>;
      break;
    case 'varOf':
      body = (
        <>
          <TextSlot value={expr.variable} label={`${label} ${w('variableName')}`} onChange={(variable) => set({ variable })} /> {w('ofWord')}{' '}
          <RefSlot value={expr.of} onChange={(of) => set({ of })} label={`${label} ${w('ofWord')}`} />
        </>
      );
      break;
    case 'object':
      body = <RefSlot value={expr.ref} label={label} onChange={(ref) => ref && set({ ref })} />;
      break;
    case 'itemCount':
      body = (
        <>
          {w('itemCount')} <ItemSlot value={expr.item} label={`${label} ${w('itemCount')}`} onChange={(item) => set({ item })} /> {w('hasWord')}
        </>
      );
      break;
    case 'selectedItem':
    case 'pickedRow':
    case 'clock':
    case 'hiding':
    case 'timeOfDay':
    case 'day':
      body = <span className="cw-pill-text">{w(expr.kind)}</span>;
      break;
    case 'distance':
      body = (
        <>
          {w('distanceFrom')} <RefSlot value={expr.from} allowPlayer onChange={(from) => set({ from })} label={`${label} ${w('distanceFrom')}`} /> {w('toWord')}{' '}
          <RefSlot value={expr.to} allowPlayer onChange={(to) => set({ to })} label={`${label} ${w('distanceFrom')} ${w('toWord')}`} />
        </>
      );
      break;
    case 'lightOn':
      body = (
        <>
          <RefSlot value={expr.target} lightsOnly onChange={(target) => set({ target })} label={`${label} ${w('isOn')}`} /> {w('isOn')}
        </>
      );
      break;
    case 'holds':
      body = (
        <>
          {w('holdsWord')} <RefSlot value={expr.what} allowNone noHeld noneLabel={w('anything')} onChange={(what) => set({ what })} label={`${label} ${w('holdsWord')}`} />
        </>
      );
      break;
    case 'inside':
      body = (
        <>
          <RefSlot value={expr.what} allowPlayer onChange={(what) => set({ what })} label={`${label} ${w('isInside')}`} /> {w('isInside')}{' '}
          <RefSlot value={expr.zone} zonesOnly onChange={(zone) => set({ zone })} label={`${label} ${w('isInside')} zone`} />
        </>
      );
      break;
    case 'isDay':
      body = (
        <>
          {w('isDay')} <ExprSlot expr={expr.a} type="number" label={`${label} ${w('isDay')}`} />
        </>
      );
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
