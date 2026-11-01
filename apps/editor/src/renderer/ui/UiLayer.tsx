/**
 * The screen UI (B5) drawn over the game: the same component shows it while playing (buttons clickable, the
 * hotbar live) and in the Screens tab (elements picked, dragged and resized).
 *
 * Layout is in reference pixels of a 720-high screen, scaled to the real height (see core/ui.ts).
 */
import { UI_REF_H, fillText, uiOffset, uiRects, uiShown, type ItemDef, type UiElement, type UiSettings } from '@cocoaworlds/core';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { assetUrl } from '../assets';

/** What is shown while playing (from the game); null in the editor (each element as designed). */
export interface UiLive {
  shown: string[];
  hidden: string[];
  texts: Record<string, string>;
  lists: Record<string, string[]>;
  inventory: { item: string; count: number }[];
  slot: number;
}

export interface UiEditing {
  /** The screen being edited (only it is drawn). */
  screen: string;
  selected: string | null;
  onSelect(id: string | null): void;
  /** A drag moved or resized an element (one undo step per drag: `drag` is the same during it). */
  onChange(id: string, patch: Partial<UiElement>, drag: string): void;
}

/** A project texture as a URL (loaded once). */
export function useAssetUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) assetUrl(path).then((u) => live && setUrl(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

function useSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function UiLayer({
  ui,
  live,
  values,
  edit,
  onClick,
  onRow,
  className = '',
}: {
  ui: UiSettings;
  live: UiLive | null;
  /** Game values, health and score, for `{Name}` in texts and for bars. */
  values: Record<string, unknown>;
  edit?: UiEditing;
  onClick?: (id: string) => void;
  /** The player picked a row of a list. */
  onRow?: (list: string, row: string) => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(host);
  const k = h > 0 ? h / UI_REF_H : 1;
  const refW = k > 0 ? w / k : 0;
  const screens = ui.screens.filter((s) => (edit ? s.id === edit.screen : live ? live.shown.includes(s.id) : s.shownAtStart));
  return (
    <div ref={host} className={`cw-ui${edit ? ' editing' : ''} ${className}`} data-testid={edit ? 'ui-stage' : 'ui-layer'} onPointerDown={edit ? () => edit.onSelect(null) : undefined}>
      {w > 0 &&
        screens.map((s) => (
          <ScreenView key={s.id} name={s.name} elements={s.elements} k={k} refW={refW} items={ui.items} live={live} values={values} edit={edit} onClick={onClick} onRow={onRow} />
        ))}
    </div>
  );
}

function ScreenView({
  name,
  elements,
  ...rest
}: {
  name: string;
  elements: UiElement[];
  k: number;
  refW: number;
  items: ItemDef[];
  live: UiLive | null;
  values: Record<string, unknown>;
  edit?: UiEditing;
  onClick?: (id: string) => void;
  onRow?: (list: string, row: string) => void;
}) {
  const rects = uiRects(elements, rest.refW, UI_REF_H);
  const hidden = (id: string) => (rest.live ? rest.live.hidden.includes(id) : !rest.edit && !elements.find((e) => e.id === id)?.visible);
  return (
    <div className="cw-ui-screen" role="group" aria-label={name}>
      {elements
        .filter((e) => uiShown(e, elements, hidden))
        .map((e) => {
          const p = e.parent ? rects.get(e.parent) : undefined;
          return <Element key={e.id} e={e} r={rects.get(e.id)!} space={p ?? { left: 0, top: 0, width: rest.refW, height: UI_REF_H }} {...rest} />;
        })}
    </div>
  );
}

type Box = { left: number; top: number; width: number; height: number };

function Element({
  e,
  r,
  space,
  k,
  items,
  live,
  values,
  edit,
  onClick,
  onRow,
}: {
  e: UiElement;
  /** Its box, and the box it sits in (its parent's, or the screen). */
  r: Box;
  space: Box;
  k: number;
  refW: number;
  items: ItemDef[];
  live: UiLive | null;
  values: Record<string, unknown>;
  edit?: UiEditing;
  onClick?: (id: string) => void;
  onRow?: (list: string, row: string) => void;
}) {
  const style: CSSProperties = {
    left: r.left * k,
    top: r.top * k,
    width: r.width * k,
    height: r.height * k,
    fontSize: e.size * k,
    color: e.color,
    justifyContent: e.align === 'left' ? 'flex-start' : e.align === 'right' ? 'flex-end' : 'center',
    textAlign: e.align,
  };
  if (e.fill && e.kind !== 'bar' && e.kind !== 'hotbar') style.background = e.fill;
  const text = fillText(live?.texts[e.id] ?? e.text, values);
  const selected = edit?.selected === e.id;

  const drag = (ev: RPointerEvent<HTMLElement>, mode: 'move' | 'size') => {
    if (!edit) return;
    ev.stopPropagation();
    ev.preventDefault();
    edit.onSelect(e.id);
    const el = ev.currentTarget;
    el.setPointerCapture(ev.pointerId);
    const sx = ev.clientX, sy = ev.clientY;
    const start = { ...r };
    const key = `ui-${mode}-${e.id}-${Date.now()}`;
    const snap = (v: number) => (ev.altKey ? v : Math.round(v / 4) * 4);
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - sx) / k, dy = (m.clientY - sy) / k;
      // (Offsets are within the box it sits in.)
      const sl = start.left - space.left, st = start.top - space.top;
      if (mode === 'move') {
        const off = uiOffset(e, snap(sl + dx), snap(st + dy), space.width, space.height);
        edit.onChange(e.id, { x: Math.round(off.x), y: Math.round(off.y) }, key);
      } else {
        const nw = Math.max(8, snap(start.width + dx)), nh = Math.max(8, snap(start.height + dy));
        // Keep the top-left corner where it is.
        const off = uiOffset({ ...e, w: nw, h: nh }, sl, st, space.width, space.height);
        edit.onChange(e.id, { w: nw, h: nh, x: Math.round(off.x), y: Math.round(off.y) }, key);
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const common = {
    className: `cw-ui-el ${e.kind}${selected ? ' selected' : ''}${edit && !e.visible ? ' hidden' : ''}`,
    style,
    'data-ui': e.name,
    onPointerDown: edit ? (ev: RPointerEvent<HTMLElement>) => drag(ev, 'move') : undefined,
  };
  const handle = selected ? <span className="cw-ui-size" aria-label="Resize" onPointerDown={(ev) => drag(ev, 'size')} /> : null;

  switch (e.kind) {
    case 'button':
      return (
        <button
          type="button"
          {...common}
          tabIndex={edit ? -1 : 0}
          onClick={
            edit
              ? undefined
              : (ev) => {
                  ev.stopPropagation();
                  onClick?.(e.id);
                }
          }
        >
          {text}
          {handle}
        </button>
      );
    case 'text':
      return (
        <div {...common} role={edit ? undefined : 'status'}>
          {text}
          {handle}
        </div>
      );
    case 'panel':
      return <div {...common}>{handle}</div>;
    case 'image':
      return (
        <div {...common}>
          <Img path={e.image} />
          {handle}
        </div>
      );
    case 'bar': {
      const v = Number(values[e.value] ?? 0);
      const frac = e.max > 0 ? Math.max(0, Math.min(1, v / e.max)) : 0;
      return (
        <div {...common} role="meter" aria-label={e.name} aria-valuenow={v} aria-valuemin={0} aria-valuemax={e.max}>
          <span className="cw-ui-bar-fill" style={{ width: `${frac * 100}%`, background: e.fill || '#d94b3d' }} />
          {handle}
        </div>
      );
    }
    case 'list': {
      const inv = e.source === 'inventory';
      const rows = inv ? (live?.inventory ?? []).map((x) => x.item) : (live?.lists[e.id] ?? e.rows);
      const counts = new Map((live?.inventory ?? []).map((x) => [x.item, x.count]));
      const cols = Math.max(1, Math.min(8, Math.round(e.columns)));
      const held = inv && live ? (live.inventory[live.slot]?.item ?? '') : '';
      return (
        <div {...common} role="listbox" aria-label={e.name} onWheel={(ev) => ev.stopPropagation()}>
          <div className="cw-ui-rows" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: e.rowHeight * k }}>
            {rows.map((row, i) => {
              const def = inv ? (items.find((x) => x.name === row) ?? { name: row, icon: '' }) : null;
              return (
                <button
                  key={`${row}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={held === row}
                  aria-label={inv ? `${row} ${counts.get(row) ?? 0}` : fillText(row, values)}
                  className={`cw-ui-row${cols > 1 ? ' tile' : ''}${held === row ? ' on' : ''}`}
                  tabIndex={edit ? -1 : 0}
                  style={{ justifyContent: cols > 1 ? 'center' : style.justifyContent }}
                  onClick={
                    edit
                      ? undefined
                      : (ev) => {
                          ev.stopPropagation();
                          onRow?.(e.id, row);
                        }
                  }
                >
                  {def && <ItemIcon item={def} />}
                  <span className="cw-ui-row-text">{inv ? row : fillText(row, values)}</span>
                  {inv && (counts.get(row) ?? 0) > 1 && <span className="cw-ui-row-count">{counts.get(row)}</span>}
                </button>
              );
            })}
            {inv && edit && <span className="cw-ui-row placeholder">{e.name}</span>}
          </div>
          {handle}
        </div>
      );
    }
    case 'hotbar': {
      const inv = live?.inventory ?? [];
      const n = Math.max(1, Math.min(12, Math.round(e.slots)));
      return (
        <div {...common} role="list" aria-label={e.name}>
          {Array.from({ length: n }, (_, i) => {
            const it = inv[i];
            return (
              <div key={i} role="listitem" aria-label={it ? `${it.item} ${it.count}` : `slot ${i + 1}`} className={`cw-ui-slot${(live?.slot ?? 0) === i ? ' on' : ''}`}>
                <span className="cw-ui-slot-n">{i + 1}</span>
                {it && <ItemIcon item={items.find((x) => x.name === it.item) ?? { name: it.item, icon: '' }} />}
                {it && it.count > 1 && <span className="cw-ui-slot-count">{it.count}</span>}
              </div>
            );
          })}
          {handle}
        </div>
      );
    }
  }
}

function Img({ path }: { path: string }) {
  const url = useAssetUrl(path);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="cw-ui-noimg">{path ? '' : 'image'}</span>;
}

/** An item's picture in a slot: its icon texture, or the first letters of its name. */
export function ItemIcon({ item }: { item: ItemDef }) {
  const url = useAssetUrl(item.icon);
  return url ? <img className="cw-ui-icon" src={url} alt={item.name} draggable={false} /> : <span className="cw-ui-initials">{item.name.slice(0, 2)}</span>;
}
