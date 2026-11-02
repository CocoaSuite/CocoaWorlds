/**
 * The Screens workspace (B5): the screen UI editor, filling the window (switched from the top bar). Screens on the left with the items the player can carry; the
 * selected screen in the middle, where elements are picked, dragged and resized; the picked element's settings
 * on the right. Everything is saved in the scene and undoable.
 */
import { blockId, emptyScript, type Script } from '@cocoaworlds/scripting';
import { ScriptPanel } from './script/ScriptPanel';
import {
  UI_ANCHORS,
  newUiElement,
  newUiScreen,
  uiOf,
  type ItemDef,
  type UiAnchor,
  type UiElement,
  type UiKind,
  type UiScreen,
  type UiSettings,
  type WeaponDef,
  newWeapon,
  weaponOf,
} from '@cocoaworlds/core';
import { Button, ColorField, IconButton, NumberField, Switch } from '@cocoaworlds/ui';
import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { useEditor } from '../store';
import { ItemIcon, UiLayer } from '../ui/UiLayer';

const KIND_KEYS: Record<UiKind, Parameters<typeof t>[0]> = {
  text: 'ui.kind.text',
  button: 'ui.kind.button',
  panel: 'ui.kind.panel',
  image: 'ui.kind.image',
  bar: 'ui.kind.bar',
  hotbar: 'ui.kind.hotbar',
  list: 'ui.kind.list',
};

/** A unique name: base, base_2, … */
function unique(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function ScreensPanel() {
  useEditor((s) => s.rev);
  const doc = useEditor((s) => s.doc);
  const project = useEditor((s) => s.session?.project);
  const textures = useEditor((s) => s.assets.textures);
  const sounds = useEditor((s) => s.assets.sounds);
  const st = useEditor.getState();
  const ui = uiOf(doc?.settings);
  const [screenId, setScreenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const screen = ui.screens.find((s) => s.id === screenId) ?? ui.screens[0] ?? null;
  const element = screen?.elements.find((e) => e.id === selected) ?? null;

  const update = (fn: (u: UiSettings) => UiSettings, label: string, mergeKey?: string) => st.setSceneSettings({ ui: fn(uiOf(useEditor.getState().doc?.settings)) }, label, mergeKey);
  const editScreen = (id: string, fn: (s: UiScreen) => UiScreen, label: string, mergeKey?: string) =>
    update((u) => ({ ...u, screens: u.screens.map((s) => (s.id === id ? fn(s) : s)) }), label, mergeKey);
  const editElement = (id: string, patch: Partial<UiElement>, label: string, mergeKey?: string) =>
    screen && editScreen(screen.id, (s) => ({ ...s, elements: s.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }), label, mergeKey);

  // Sample values for `{Name}` and bars while designing: game values at their start, full health.
  const values = useMemo(() => {
    const v: Record<string, unknown> = { health: 100, score: 0 };
    for (const g of project?.settings.values ?? []) v[g.name] = g.initial;
    return v;
  }, [project]);

  // Delete removes the picked element; the arrow keys nudge it (Shift: 16 at a time).
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      const tgt = ev.target as HTMLElement | null;
      if (!element || !screen || tgt?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.cw-modal')) return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        editScreen(screen.id, (s) => ({ ...s, elements: withoutElement(s.elements, element.id) }), 'Remove screen element');
        setSelected(null);
        return;
      }
      const d = ev.shiftKey ? 16 : 1;
      const move: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
      const m = move[ev.key];
      if (!m) return;
      ev.preventDefault();
      // Offsets count inward from the anchored edges, so right and bottom anchors move the other way.
      const sx = element.anchor.includes('right') ? -1 : 1, sy = element.anchor.startsWith('bottom') ? -1 : 1;
      editElement(element.id, { x: element.x + m[0] * sx, y: element.y + m[1] * sy }, 'Nudge screen element', `ui-nudge-${element.id}`);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const addScreen = () => {
    const s = newUiScreen(unique('Screen', ui.screens.map((x) => x.name)));
    update((u) => ({ ...u, screens: [...u.screens, s] }), 'Add screen');
    setScreenId(s.id);
    setSelected(null);
  };
  const addElement = (kind: UiKind) => {
    if (!screen) return;
    const all = ui.screens.flatMap((s) => s.elements.map((e) => e.name));
    // Added inside the picked panel or list's panel, if one is picked.
    const inside = element && element.kind === 'panel' ? element.id : element?.parent ?? '';
    const e = { ...newUiElement(kind), name: unique(t(KIND_KEYS[kind]), all), parent: kind === 'hotbar' ? '' : inside };
    if (inside && kind !== 'hotbar') {
      // Stacked from the top of the panel, below what is already in it, as wide as the panel allows.
      const box = screen.elements.find((x) => x.id === inside);
      if (box) {
        const below = screen.elements.filter((x) => x.parent === inside && x.anchor === 'top').reduce((y, x) => Math.max(y, x.y + x.h), 0);
        const y = below + 8;
        const w = kind === 'image' ? Math.min(e.w, box.w - 16) : box.w - 16;
        const h = Math.max(24, Math.min(e.h, box.h - y - 8));
        Object.assign(e, { anchor: 'top', x: 0, y, w, h });
      }
    }
    editScreen(screen.id, (s) => ({ ...s, elements: [...s.elements, e] }), `Add ${kind}`);
    setSelected(e.id);
  };

  return (
    <div className="cw-screens" role="region" aria-label={t('ws.screens')}>
      <aside className="cw-screens-side" aria-label={t('ui.screens')}>
        <div className="cw-screens-h">
          <span>{t('ui.screens')}</span>
          <Button size="sm" onClick={addScreen}>
            {t('ui.addScreen')}
          </Button>
        </div>
        {!ui.screens.length && <p className="cw-muted cw-screens-hint">{t('ui.noScreens')}</p>}
        <ul className="cw-screens-list" role="list" aria-label={t('ui.screens')}>
          {ui.screens.map((s) => (
            <li key={s.id} className={s.id === screen?.id ? 'on' : ''} aria-label={s.name}>
              <button type="button" className="cw-screens-pick" onClick={() => (setScreenId(s.id), setSelected(null))}>
                {s.name}
              </button>
              {s.id === screen?.id && (
                <div className="cw-screens-props">
                  <TextInput label={t('ui.screenName')} value={s.name} onCommit={(name) => name.trim() && editScreen(s.id, (x) => ({ ...x, name: name.trim() }), 'Rename screen')} />
                  <label className="cw-screens-sw">
                    <Switch label={t('ui.shownAtStart')} checked={s.shownAtStart} onChange={(v) => editScreen(s.id, (x) => ({ ...x, shownAtStart: v }), 'Screen shown at start')} />
                    {t('ui.shownAtStart')}
                  </label>
                  <label className="cw-screens-sw" title={t('ui.freesMouseHint')}>
                    <Switch label={t('ui.freesMouse')} checked={s.freesMouse} onChange={(v) => editScreen(s.id, (x) => ({ ...x, freesMouse: v }), 'Screen frees the mouse')} />
                    {t('ui.freesMouse')}
                  </label>
                  <Outline
                    elements={s.elements}
                    selected={selected}
                    onSelect={setSelected}
                    onMove={(id, by) =>
                      editScreen(
                        s.id,
                        (x) => {
                          const i = x.elements.findIndex((e) => e.id === id), j = i + by;
                          if (i < 0 || j < 0 || j >= x.elements.length) return x;
                          const next = [...x.elements];
                          [next[i], next[j]] = [next[j]!, next[i]!];
                          return { ...x, elements: next };
                        },
                        'Reorder screen elements',
                      )
                    }
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      update((u) => ({ ...u, screens: u.screens.filter((x) => x.id !== s.id) }), 'Remove screen');
                      setScreenId(null);
                    }}
                  >
                    {t('ui.removeScreen')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <Items items={ui.items} textures={textures} sounds={sounds} update={update} />
      </aside>

      <div className="cw-screens-main">
        <div className="cw-screens-tools" role="toolbar" aria-label={t('ui.add')}>
          {(['text', 'button', 'panel', 'image', 'bar', 'list', 'hotbar'] as UiKind[]).map((k) => (
            <Button key={k} size="sm" disabled={!screen} onClick={() => addElement(k)}>
              + {t(KIND_KEYS[k])}
            </Button>
          ))}
          <span className="cw-muted cw-screens-tip">{screen ? t('ui.stageHint') : ''}</span>
        </div>
        <div className="cw-screens-stagewrap">
        <div className="cw-screens-stage">
          {screen ? (
            <UiLayer
              ui={ui}
              live={null}
              values={values}
              edit={{
                screen: screen.id,
                selected,
                onSelect: setSelected,
                onChange: (id, patch, drag) => editElement(id, patch, 'Move screen element', drag),
              }}
            />
          ) : (
            <div className="cw-muted cw-screens-empty">{t('ui.pickScreen')}</div>
          )}
        </div>
        </div>
        <section className="cw-screens-script" aria-label={t('script.screenBlocks')}>
          <ScriptPanel screens />
        </section>
      </div>

      <aside className="cw-screens-side right" aria-label={t('ui.element')}>
        {element && (element.kind === 'button' || element.kind === 'list') && (
          <Button
            size="sm"
            onClick={() => {
              // A stack for this element in the screens' script, ready for blocks.
              const event = element.kind === 'button' ? { id: blockId(), kind: 'uiClick' as const, element: element.id } : { id: blockId(), kind: 'listPick' as const, list: element.id };
              update((u) => {
                const sc = ((u.script as Script | undefined) ?? emptyScript()) as Script;
                return { ...u, script: { ...sc, handlers: [...sc.handlers, { id: blockId(), event, body: [] }] } };
              }, element.kind === 'button' ? 'Add When clicked' : 'Add When a row is picked');
            }}
          >
            {element.kind === 'button' ? t('ui.addClick') : t('ui.addPick')}
          </Button>
        )}
        {element && screen ? (
          <ElementProps
            e={element}
            others={screen.elements.filter((x) => x.id !== element.id && x.kind === 'panel' && !insideOf(screen.elements, x.id, element.id))}
            values={Object.keys(values)}
            textures={textures.map((x) => ({ path: x.path, name: x.name }))}
            set={(patch, label, key) => editElement(element.id, patch, label, key)}
            onDuplicate={() => {
              const copy = { ...element, id: newUiElement(element.kind).id, name: unique(element.name, ui.screens.flatMap((s) => s.elements.map((e) => e.name))), x: element.x + 16, y: element.y + 16 };
              editScreen(screen.id, (s) => ({ ...s, elements: [...s.elements, copy] }), 'Duplicate screen element');
              setSelected(copy.id);
            }}
            onRemove={() => {
              editScreen(screen.id, (s) => ({ ...s, elements: withoutElement(s.elements, element.id) }), 'Remove screen element');
              setSelected(null);
            }}
          />
        ) : (
          <p className="cw-muted cw-screens-hint">{screen ? t('ui.pickElement') : ''}</p>
        )}
      </aside>
    </div>
  );
}

/** Elements without one and everything inside it. */
function withoutElement(list: UiElement[], id: string): UiElement[] {
  const gone = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of list) if (e.parent && gone.has(e.parent) && !gone.has(e.id)) (gone.add(e.id), (grew = true));
  }
  return list.filter((e) => !gone.has(e.id));
}

/** Whether `id` sits (somewhere) inside `outer`. */
function insideOf(list: UiElement[], id: string, outer: string): boolean {
  const byId = new Map(list.map((e) => [e.id, e]));
  const seen = new Set<string>();
  for (let x = byId.get(id); x && !seen.has(x.id); x = x.parent ? byId.get(x.parent) : undefined) {
    if (x.id === outer) return true;
    seen.add(x.id);
  }
  return false;
}

/** The screen's elements in drawing order (later ones on top), indented by what they sit inside. */
function Outline({ elements, selected, onSelect, onMove }: { elements: UiElement[]; selected: string | null; onSelect: (id: string) => void; onMove: (id: string, by: -1 | 1) => void }) {
  const depth = (e: UiElement) => {
    let d = 0;
    const byId = new Map(elements.map((x) => [x.id, x]));
    for (let p = e.parent ? byId.get(e.parent) : undefined; p && d < 8; p = p.parent ? byId.get(p.parent) : undefined) d++;
    return d;
  };
  if (!elements.length) return null;
  return (
    <ul className="cw-screens-outline" role="list" aria-label={t('ui.elements')}>
      {elements.map((e) => (
        <li key={e.id} className={e.id === selected ? 'on' : ''} aria-label={e.name}>
          <button type="button" className="cw-screens-pick" style={{ paddingLeft: 6 + depth(e) * 12 }} onClick={() => onSelect(e.id)}>
            {e.name}
            {!e.visible && <span className="cw-muted"> ({t('ui.hiddenTag')})</span>}
          </button>
          <IconButton icon="up" label={`${t('ui.back2')} ${e.name}`} onClick={() => onMove(e.id, -1)} />
          <IconButton icon="down" label={`${t('ui.front')} ${e.name}`} onClick={() => onMove(e.id, 1)} />
        </li>
      ))}
    </ul>
  );
}

/** A text box that saves when left. `lines`: Enter starts a new line (one row per line). */
function TextInput({ label, value, onCommit, multiline, lines }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; lines?: boolean }) {
  const props = {
    className: 'cw-input',
    'aria-label': label,
    defaultValue: value,
    key: value,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !lines && !(multiline && e.shiftKey)) {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.value !== value && onCommit(e.currentTarget.value),
  };
  return multiline || lines ? <textarea rows={lines ? 5 : 2} {...props} /> : <input {...props} />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cw-screens-row">
      <span className="cw-screens-l">{label}</span>
      <span className="cw-screens-v">{children}</span>
    </div>
  );
}

/** The picked element's settings. */
function ElementProps({
  e,
  others,
  values,
  textures,
  set,
  onDuplicate,
  onRemove,
}: {
  e: UiElement;
  /** Panels it can sit inside. */
  others: UiElement[];
  values: string[];
  textures: { path: string; name: string }[];
  set: (patch: Partial<UiElement>, label: string, mergeKey?: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const num = (key: 'x' | 'y' | 'w' | 'h' | 'size' | 'max' | 'slots' | 'columns' | 'rowHeight', label: string, step = 1) => (
    <NumberField label={label} ariaLabel={`${t('ui.element')} ${label}`} value={e[key]} step={step} onChange={(v) => set({ [key]: v }, 'Edit screen element', `ui-${e.id}-${key}`)} onCommit={(v) => set({ [key]: v }, 'Edit screen element', `ui-${e.id}-${key}`)} />
  );
  const hasText = e.kind === 'text' || e.kind === 'button';
  const alpha = e.fill.length === 9 ? parseInt(e.fill.slice(7), 16) / 255 : 1;
  const withAlpha = (hex: string, a: number) => (a >= 0.999 ? hex.slice(0, 7) : hex.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, '0'));
  return (
    <div className="cw-screens-props" role="group" aria-label={`${t('ui.element')} ${e.name}`}>
      <div className="cw-screens-h">
        <span>{t(KIND_KEYS[e.kind])}</span>
        <span className="cw-sp" />
        <IconButton icon="copy" label={t('ui.duplicate')} onClick={onDuplicate} />
        <IconButton icon="close" label={t('ui.remove')} onClick={onRemove} />
      </div>
      <Row label={t('ui.name')}>
        <TextInput label={t('ui.name')} value={e.name} onCommit={(name) => name.trim() && set({ name: name.trim() }, 'Rename screen element')} />
      </Row>
      {e.kind !== 'hotbar' && (
        <Row label={t('ui.inside')}>
          <select className="cw-input" aria-label={t('ui.inside')} value={e.parent} onChange={(ev) => set({ parent: ev.target.value, x: 0, y: 0 }, 'Put screen element inside')}>
            <option value="">{t('ui.theScreen')}</option>
            {others.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label={t('ui.anchor')}>
        <span className="cw-anchor" role="radiogroup" aria-label={t('ui.anchor')}>
          {UI_ANCHORS.map((a: UiAnchor) => (
            <button key={a} type="button" role="radio" aria-checked={e.anchor === a} aria-label={a} className={e.anchor === a ? 'on' : ''} onClick={() => set({ anchor: a, x: 16 * (a.includes('left') || a.includes('right') ? 1 : 0), y: 16 * (a.includes('top') || a.includes('bottom') ? 1 : 0) }, 'Anchor screen element')} />
          ))}
        </span>
      </Row>
      <Row label={t('ui.place')}>
        <span className="cw-screens-pair">
          {num('x', 'X')}
          {num('y', 'Y')}
        </span>
      </Row>
      <Row label={t('ui.size')}>
        <span className="cw-screens-pair">
          {num('w', 'W')}
          {num('h', 'H')}
        </span>
      </Row>
      {(hasText || e.kind === 'list') && (
        <Row label={t('ui.align')}>
          <span className="cw-anchor row" role="radiogroup" aria-label={t('ui.align')}>
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={e.align === a} aria-label={a} className={e.align === a ? 'on' : ''} onClick={() => set({ align: a }, 'Align screen element')}>
                {a === 'left' ? '⇤' : a === 'right' ? '⇥' : '↔'}
              </button>
            ))}
          </span>
        </Row>
      )}
      {e.kind === 'list' && (
        <>
          <Row label={t('ui.listShows')}>
            <select className="cw-input" aria-label={t('ui.listShows')} value={e.source} onChange={(ev) => set({ source: ev.target.value as UiElement['source'] }, 'List source')}>
              <option value="rows">{t('ui.listRows')}</option>
              <option value="inventory">{t('ui.listInventory')}</option>
            </select>
          </Row>
          {e.source === 'rows' && (
            <Row label={t('ui.rows')}>
              <TextInput label={t('ui.rows')} value={e.rows.join('\n')} lines onCommit={(v) => set({ rows: v.split('\n').map((x) => x.trim()).filter(Boolean) }, 'List rows')} />
            </Row>
          )}
          <p className="cw-muted cw-screens-note">{e.source === 'rows' ? t('ui.rowsHint') : t('ui.inventoryHint')}</p>
          <Row label={t('ui.columns')}>{num('columns', '')}</Row>
          <Row label={t('ui.rowHeight')}>{num('rowHeight', 'px')}</Row>
          <Row label={t('ui.textSize')}>{num('size', 'px')}</Row>
          <Row label={t('ui.textColor')}>
            <ColorField label={t('ui.textColor')} value={e.color} onChange={(color) => set({ color }, 'Screen element colour', `ui-${e.id}-color`)} />
          </Row>
        </>
      )}
      {hasText && (
        <>
          <Row label={t('ui.text')}>
            <TextInput label={t('ui.text')} value={e.text} multiline onCommit={(text) => set({ text }, 'Screen element text')} />
          </Row>
          <p className="cw-muted cw-screens-note">{t('ui.textHint')}</p>
          <Row label={t('ui.textSize')}>{num('size', 'px')}</Row>
          <Row label={t('ui.textColor')}>
            <ColorField label={t('ui.textColor')} value={e.color} onChange={(color) => set({ color }, 'Screen element colour', `ui-${e.id}-color`)} />
          </Row>
        </>
      )}
      {e.kind !== 'image' && e.kind !== 'hotbar' && (
        <Row label={e.kind === 'bar' ? t('ui.barColor') : t('ui.fill')}>
          <span className="cw-screens-pair">
            {e.kind !== 'bar' && (
              <Switch label={`${t('ui.fill')} on`} checked={!!e.fill} onChange={(on) => set({ fill: on ? '#000000aa' : '' }, 'Screen element background')} />
            )}
            {(e.fill || e.kind === 'bar') && (
              <ColorField label={e.kind === 'bar' ? t('ui.barColor') : t('ui.fill')} value={(e.fill || '#d94b3d').slice(0, 7)} onChange={(hex) => set({ fill: withAlpha(hex, alpha) }, 'Screen element colour', `ui-${e.id}-fill`)} />
            )}
          </span>
        </Row>
      )}
      {e.fill && e.kind !== 'bar' && e.kind !== 'image' && e.kind !== 'hotbar' && (
        <Row label={t('ui.opacity')}>
          <NumberField label="%" ariaLabel={t('ui.opacity')} value={Math.round(alpha * 100)} step={5} onCommit={(v) => set({ fill: withAlpha(e.fill, Math.max(0, Math.min(100, v)) / 100) }, 'Screen element opacity', `ui-${e.id}-alpha`)} />
        </Row>
      )}
      {e.kind === 'image' && (
        <Row label={t('ui.image')}>
          <select className="cw-input" aria-label={t('ui.image')} value={e.image} onChange={(ev) => set({ image: ev.target.value }, 'Screen element image')}>
            <option value="">{t('ui.pickImage')}</option>
            {textures.map((x) => (
              <option key={x.path} value={x.path}>
                {x.name}
              </option>
            ))}
          </select>
        </Row>
      )}
      {e.kind === 'bar' && (
        <>
          <Row label={t('ui.barShows')}>
            <select className="cw-input" aria-label={t('ui.barShows')} value={e.value} onChange={(ev) => set({ value: ev.target.value }, 'Bar value')}>
              {!values.includes(e.value) && <option value={e.value}>{e.value || '—'}</option>}
              {values.map((v) => (
                <option key={v} value={v}>
                  {v === 'health' ? t('hud.health') : v === 'score' ? t('hud.score') : v}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('ui.barMax')}>{num('max', '', 10)}</Row>
        </>
      )}
      {e.kind === 'hotbar' && <Row label={t('ui.slots')}>{num('slots', '')}</Row>}
      <Row label={t('ui.visible')}>
        <Switch label={t('ui.visible')} checked={e.visible} onChange={(visible) => set({ visible }, visible ? 'Show screen element' : 'Hide screen element')} />
      </Row>
    </div>
  );
}

/** The items the player can carry: a name and a picture each. */
function Items({
  items,
  textures,
  sounds,
  update,
}: {
  items: ItemDef[];
  textures: { path: string; name: string }[];
  sounds: { path: string; name: string }[];
  update: (fn: (u: UiSettings) => UiSettings, label: string) => void;
}) {
  const set = (i: number, next: ItemDef, label: string) => update((u) => ({ ...u, items: u.items.map((x, j) => (j === i ? next : x)) }), label);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="cw-screens-items" aria-label={t('ui.items')}>
      <div className="cw-screens-h">
        <span title={t('ui.itemsHint')}>{t('ui.items')}</span>
        <Button size="sm" onClick={() => update((u) => ({ ...u, items: [...u.items, { name: unique('Item', u.items.map((x) => x.name)), icon: '' }] }), 'Add item')}>
          {t('ui.addItem')}
        </Button>
      </div>
      <ul role="list" aria-label={t('ui.items')} className="cw-screens-itemlist">
        {items.map((it, i) => (
          <li key={it.name} aria-label={it.name}>
            <span className="cw-ui-slot mini">
              <ItemIcon item={it} />
            </span>
            <TextInput
              label={t('ui.itemName')}
              value={it.name}
              onCommit={(name) => {
                const n = name.trim();
                if (n && !items.some((x) => x.name === n)) set(i, { ...it, name: n }, 'Rename item');
              }}
            />
            <select className="cw-input cw-mini" aria-label={`${it.name} ${t('ui.icon')}`} value={it.icon} onChange={(e) => set(i, { ...it, icon: e.target.value }, 'Item picture')}>
              <option value="">{t('ui.noIcon')}</option>
              {textures.map((x) => (
                <option key={x.path} value={x.path}>
                  {x.name}
                </option>
              ))}
            </select>
            <Button size="sm" className={it.weapon ? 'on' : ''} aria-label={`${it.name}: ${t('wpn.title')}`} aria-expanded={open === it.name} onClick={() => setOpen(open === it.name ? null : it.name)}>
              {it.weapon ? '⌖' : '+⌖'}
            </Button>
            <IconButton icon="close" label={`${t('ui.remove')} ${it.name}`} onClick={() => update((u) => ({ ...u, items: u.items.filter((_, j) => j !== i) }), 'Remove item')} />
            {open === it.name && <WeaponProps item={it} items={items} sounds={sounds} onChange={(weapon, label) => set(i, { ...it, weapon }, label)} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

const PRESETS: { id: string; key: Parameters<typeof t>[0] }[] = [
  { id: 'crowbar', key: 'wpn.crowbar' },
  { id: 'pistol', key: 'wpn.pistol' },
  { id: 'smg', key: 'wpn.smg' },
  { id: 'shotgun', key: 'wpn.shotgun' },
  { id: 'rocket', key: 'wpn.rocket' },
  { id: 'grenade', key: 'wpn.grenade' },
];

/** An item's weapon settings: off, a ready-made weapon, or each number by hand. */
function WeaponProps({
  item,
  items,
  sounds,
  onChange,
}: {
  item: ItemDef;
  items: ItemDef[];
  sounds: { path: string; name: string }[];
  onChange: (w: WeaponDef | undefined, label: string) => void;
}) {
  const w = weaponOf(item.weapon);
  const set = (patch: Partial<WeaponDef>) => w && onChange({ ...w, ...patch }, 'Weapon settings');
  const num = (key: 'damage' | 'rate' | 'range' | 'spread' | 'pellets' | 'speed' | 'blast' | 'push', label: Parameters<typeof t>[0], step: number) => (
    <Row label={t(label)}>
      <NumberField label="#" ariaLabel={`${item.name}: ${t(label)}`} value={w![key]} step={step} onCommit={(v) => set({ [key]: Math.max(0, v) })} />
    </Row>
  );
  return (
    <div className="cw-weapon" role="group" aria-label={`${item.name}: ${t('wpn.title')}`}>
      <Row label={t('wpn.title')}>
        <select
          className="cw-input"
          aria-label={`${item.name}: ${t('wpn.preset')}`}
          value=""
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === 'none') onChange(undefined, 'Not a weapon');
            else if (v) onChange(newWeapon(v), 'Make a weapon');
          }}
        >
          <option value="">{w ? t('wpn.change') : t('wpn.make')}</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.key)}
            </option>
          ))}
          {w && <option value="none">{t('wpn.none')}</option>}
        </select>
      </Row>
      {w && (
        <>
          <Row label={t('wpn.kind')}>
            <select className="cw-input" aria-label={`${item.name}: ${t('wpn.kind')}`} value={w.kind} onChange={(e) => set({ kind: e.currentTarget.value as WeaponDef['kind'] })}>
              <option value="bullet">{t('wpn.bullet')}</option>
              <option value="projectile">{t('wpn.projectile')}</option>
              <option value="melee">{t('wpn.melee')}</option>
            </select>
          </Row>
          {num('damage', 'wpn.damage', 1)}
          {num('rate', 'wpn.rate', 0.5)}
          <label className="cw-screens-sw">
            <Switch label={`${item.name}: ${t('wpn.automatic')}`} checked={w.automatic} onChange={(v) => set({ automatic: v })} />
            {t('wpn.automatic')}
          </label>
          {w.kind !== 'projectile' && num('range', 'wpn.range', 64)}
          {w.kind === 'bullet' && num('spread', 'wpn.spread', 0.5)}
          {w.kind === 'bullet' && num('pellets', 'wpn.pellets', 1)}
          {w.kind === 'projectile' && num('speed', 'wpn.speed', 50)}
          {w.kind === 'projectile' && (
            <label className="cw-screens-sw">
              <Switch label={`${item.name}: ${t('wpn.arc')}`} checked={w.arc} onChange={(v) => set({ arc: v })} />
              {t('wpn.arc')}
            </label>
          )}
          {num('blast', 'wpn.blast', 16)}
          {num('push', 'wpn.push', 50)}
          <Row label={t('wpn.ammo')}>
            <select className="cw-input" aria-label={`${item.name}: ${t('wpn.ammo')}`} value={w.ammo} onChange={(e) => set({ ammo: e.currentTarget.value })}>
              <option value="">{t('wpn.noAmmo')}</option>
              {items
                .filter((x) => x.name !== item.name)
                .map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name}
                  </option>
                ))}
              {w.ammo && !items.some((x) => x.name === w.ammo) && <option value={w.ammo}>{w.ammo}</option>}
            </select>
          </Row>
          <Row label={t('wpn.sound')}>
            <select className="cw-input" aria-label={`${item.name}: ${t('wpn.sound')}`} value={w.sound} onChange={(e) => set({ sound: e.currentTarget.value })}>
              <option value="">{t('mat.noImage')}</option>
              {sounds.map((x) => (
                <option key={x.path} value={x.path}>
                  {x.name}
                </option>
              ))}
            </select>
          </Row>
          <p className="cw-muted cw-screens-note">{t('wpn.hint')}</p>
        </>
      )}
    </div>
  );
}
