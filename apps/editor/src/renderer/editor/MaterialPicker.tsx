/**
 * The material library: what's chosen now (big, with where it's used), search, filters (project, built-in,
 * textures, hotspot sheets), recently used and starred materials, then everything in folders (a material's Folder
 * setting; built-in and textures have their own). Used by the Paint tool and the face inspector.
 *
 * Every material is one radio in its folder (recents and stars are shortcuts to them). Right-click a swatch, or
 * the star on the current one, to star it. Folders remember whether they're open.
 */
import type { MaterialDef } from '@cocoaworlds/core';
import { useState } from 'react';
import { DEV_MATERIALS, swatchStyle } from '../brush/materials';
import { getLang } from '../i18n';
import { useEditor } from '../store';
import { MaterialSwatch } from './MaterialSwatch';
import { TextureSwatch } from './TextureSwatch';

const L = (en: string, ru: string) => (getLang() === 'ru' ? ru : en);

interface Item {
  id: string;
  name: string;
  folder: string;
  kind: 'project' | 'builtin' | 'texture';
  hotspot: boolean;
  def?: MaterialDef;
}

type Filter = 'all' | 'project' | 'builtin' | 'texture' | 'hotspot';

const CLOSED = 'cw-mat-folders-closed';
function loadClosed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLOSED) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function Swatch({ item, className }: { item: Item; className?: string }) {
  if (item.kind === 'project') return <MaterialSwatch def={item.def} className={className} />;
  if (item.kind === 'texture') return <TextureSwatch path={item.id} className={className} />;
  return <span className={className ?? 'cw-mat-sw'} style={swatchStyle(item.id)} />;
}

export function MaterialPicker({ value, onChange, label }: { value: string | null; onChange: (id: string) => void; label: string }) {
  const lang = getLang();
  const textures = useEditor((s) => s.assets.textures);
  const materials = useEditor((s) => s.session?.project.settings.materials) ?? [];
  const favourites = useEditor((s) => s.session?.project.settings.favouriteMaterials) ?? [];
  const recents = useEditor((s) => s.recentMaterials);
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.rev);
  const st = useEditor.getState();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [closed, setClosed] = useState(loadClosed);
  const [list, setList] = useState(false);

  const items: Item[] = [
    ...materials.map((m) => ({ id: m.id, name: m.name, folder: m.folder?.trim() || L('Materials', 'Материалы'), kind: 'project' as const, hotspot: !!m.hotspots?.length, def: m })),
    ...DEV_MATERIALS.map((m) => ({ id: m.id, name: m.label[lang], folder: L('Built-in', 'Встроенные'), kind: 'builtin' as const, hotspot: false })),
    ...textures.map((tx) => ({ id: tx.path, name: tx.name, folder: L('Textures', 'Текстуры'), kind: 'texture' as const, hotspot: false })),
  ];
  const byId = new Map(items.map((i) => [i.id, i]));
  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (filter === 'all' || (filter === 'hotspot' ? i.hotspot : i.kind === filter)) &&
      (!q || i.name.toLowerCase().includes(q) || i.folder.toLowerCase().includes(q)),
  );
  const folders = new Map<string, Item[]>();
  for (const i of shown) folders.set(i.folder, [...(folders.get(i.folder) ?? []), i]);
  const toggleFolder = (f: string) => {
    const next = new Set(closed);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    setClosed(next);
    try {
      localStorage.setItem(CLOSED, JSON.stringify([...next]));
    } catch {
      /* (Not kept: storage is off.) */
    }
  };

  // The chosen one: how many faces in this scene use it.
  const cur = value ? byId.get(value) : undefined;
  let uses = 0;
  if (value)
    for (const e of doc?.entities ?? []) for (const f of ((e.components.brush as { faces?: { material?: string; surface?: { material?: string } }[] } | undefined)?.faces ?? [])) if ((f.surface?.material ?? f.material) === value) uses++;
  const star = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    st.toggleFavouriteMaterial(id);
  };
  const shortcut = (id: string, prefix: string) => {
    const i = byId.get(id);
    if (!i) return null;
    return (
      <button key={`${prefix}${id}`} type="button" className={`cw-mat cw-mat-quick${value === id ? ' on' : ''}`} aria-label={`${prefix} ${i.name}`} title={i.name} onClick={() => onChange(id)} onContextMenu={star(id)}>
        <Swatch item={i} />
      </button>
    );
  };
  const chips: { k: Filter; label: string }[] = [
    { k: 'all', label: L('All', 'Все') },
    { k: 'project', label: L('Project', 'Проект') },
    { k: 'builtin', label: L('Built-in', 'Встроенные') },
    { k: 'texture', label: L('Textures', 'Текстуры') },
    { k: 'hotspot', label: L('Hotspot', 'Хотспоты') },
  ];
  const recent = recents.filter((id) => byId.has(id)).slice(0, 8);
  const favs = favourites.filter((id) => byId.has(id));

  return (
    <div className="cw-lib-picker">
      {cur && (
        <div className="cw-lib-cur">
          <Swatch item={cur} className="cw-lib-cur-sw" />
          <span className="cw-lib-cur-t">
            <strong>{cur.name}</strong>
            <span>
              {cur.folder}, {L(`used on ${uses} faces`, `на ${uses} гранях`)}
            </span>
          </span>
          <button type="button" className={`cw-lib-star${favourites.includes(cur.id) ? ' on' : ''}`} aria-label={favourites.includes(cur.id) ? L('Unstar', 'Убрать звезду') : L('Star', 'Отметить звездой')} aria-pressed={favourites.includes(cur.id)} onClick={() => st.toggleFavouriteMaterial(cur.id)}>
            ★
          </button>
        </div>
      )}
      <div className="cw-lib-search-row">
        <input className="cw-input" type="search" placeholder={L('Search materials…', 'Поиск материалов…')} aria-label={L('Search materials', 'Поиск материалов')} value={query} onChange={(e) => setQuery(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button type="button" className="cw-lib-view" aria-label={list ? L('Grid view', 'Плиткой') : L('List view', 'Списком')} title={list ? L('Grid view', 'Плиткой') : L('List view', 'Списком')} onClick={() => setList(!list)}>
          {list ? '▦' : '☰'}
        </button>
      </div>
      <div className="cw-lib-chips" role="group" aria-label={L('Show', 'Показать')}>
        {chips.map((c) => (
          <button key={c.k} type="button" className={`cw-chip${filter === c.k ? ' on' : ''}`} aria-pressed={filter === c.k} onClick={() => setFilter(c.k)}>
            {c.label}
          </button>
        ))}
      </div>
      {!q && filter === 'all' && recent.length > 0 && (
        <div className="cw-lib-sec">
          <span className="cw-lib-sec-h">{L('Recent', 'Недавние')}</span>
          <div className="cw-lib-quick">{recent.map((id) => shortcut(id, L('Recent:', 'Недавний:')))}</div>
        </div>
      )}
      {!q && filter === 'all' && favs.length > 0 && (
        <div className="cw-lib-sec">
          <span className="cw-lib-sec-h">★ {L('Starred', 'Избранное')}</span>
          <div className="cw-lib-quick">{favs.map((id) => shortcut(id, L('Starred:', 'Избранный:')))}</div>
        </div>
      )}
      <div role="radiogroup" aria-label={label} className="cw-lib-folders">
        {[...folders].map(([f, list2]) => {
          const open = !!q || !closed.has(f);
          return (
            <div key={f} className="cw-lib-sec">
              <button type="button" className="cw-lib-folder" aria-expanded={open} onClick={() => toggleFolder(f)}>
                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                {f}
                <span className="cw-lib-count">{list2.length}</span>
              </button>
              {open && (
                <div className={list ? 'cw-lib-list' : 'cw-mat-grid'}>
                  {list2.map((i) => (
                    <button key={i.id} type="button" role="radio" aria-checked={value === i.id} aria-label={i.name} title={`${i.name}${i.kind === 'texture' ? ` (${i.id})` : ''}`} className={`cw-mat${value === i.id ? ' on' : ''}`} onClick={() => onChange(i.id)} onContextMenu={star(i.id)}>
                      <Swatch item={i} />
                      {list && <span className="cw-lib-row-name">{i.name}</span>}
                      {favourites.includes(i.id) && <span className="cw-lib-fav" aria-hidden="true">★</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!folders.size && <div className="cw-muted">{L('Nothing matches.', 'Ничего не найдено.')}</div>}
      </div>
      <div className="cw-lib-foot">
        <span>{L('Right-click stars a material. Ctrl+click in the view picks one up.', 'Правый щелчок отмечает материал звездой. Ctrl+щелчок в виде берёт его.')}</span>
        <span className="mono">{items.length}</span>
      </div>
    </div>
  );
}
