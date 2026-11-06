/** The block picker: groups down the side, their blocks beside them, and a search over all of them. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../i18n';

export interface PickItem {
  label: string;
  onSelect: () => void;
}
export interface PickGroup {
  title: string;
  items: PickItem[];
}
export interface PickerProps {
  x: number;
  y: number;
  groups: PickGroup[];
  /** Shown above the groups (paste). */
  extra?: PickItem | null;
  onClose: () => void;
}

export function Picker({ x, y, groups, extra, onClose }: PickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [group, setGroup] = useState(0);
  const [query, setQuery] = useState('');
  const [hot, setHot] = useState(0);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? groups.flatMap((g) => g.items.filter((i) => i.label.toLowerCase().includes(q) || g.title.toLowerCase().includes(q)).map((i) => ({ ...i, group: g.title }))) : (groups[group]?.items ?? []).map((i) => ({ ...i, group: '' }))),
    [q, groups, group],
  );

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [onClose]);
  useEffect(() => setHot(0), [q, group]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.hot')?.scrollIntoView({ block: 'nearest' });
  }, [hot]);

  const pick = (i: PickItem) => {
    onClose();
    i.onSelect();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') setHot((h) => Math.min(shown.length - 1, h + 1));
    else if (e.key === 'ArrowUp') setHot((h) => Math.max(0, h - 1));
    else if (e.key === 'Tab' && !q) setGroup((g) => (g + (e.shiftKey ? groups.length - 1 : 1)) % groups.length);
    else if (e.key === 'Enter' && shown[hot]) pick(shown[hot]!);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={ref} className="cw-pick" role="dialog" style={{ left: pos.x, top: pos.y }} onKeyDown={onKey}>
      <input className="cw-input cw-pick-search" autoFocus placeholder={t('script.search')} aria-label={t('script.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {extra && (
        <button type="button" className="cw-pick-extra" onClick={() => pick(extra)}>
          {extra.label}
        </button>
      )}
      <div className="cw-pick-body">
        {!q && (
          <div className="cw-pick-groups" role="tablist">
            {groups.map((g, i) => (
              <button key={g.title} type="button" role="tab" aria-selected={i === group} className={i === group ? 'on' : ''} onClick={() => setGroup(i)} onMouseEnter={() => setGroup(i)}>
                {g.title}
              </button>
            ))}
          </div>
        )}
        <div className="cw-pick-items" ref={listRef} role="listbox">
          {shown.map((i, n) => (
            <button key={`${i.group}${i.label}`} type="button" role="option" aria-selected={n === hot} className={n === hot ? 'hot' : ''} onMouseMove={() => setHot(n)} onClick={() => pick(i)}>
              <span>{i.label}</span>
              {i.group && <small>{i.group}</small>}
            </button>
          ))}
          {!shown.length && <div className="cw-pick-none">{t('script.noMatch')}</div>}
        </div>
      </div>
    </div>
  );
}
