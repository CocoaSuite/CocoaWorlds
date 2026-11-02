/** Scene hierarchy (CocoaCanvas layers panel): select, rename, hide, lock, reparent by drag, context menu. */
import type { EntityData } from '@cocoaworlds/core';
import { Button, ContextMenu, Icon, PanelHeader, type IconName, type MenuEntry } from '@cocoaworlds/ui';
import { useMemo, useState, type DragEvent } from 'react';
import { t } from '../i18n';
import { isGroup } from '../scene-ops';
import { reparentKeepWorld, useEditor } from '../store';

export function iconFor(e: EntityData): IconName {
  const brush = e.components.brush as { role?: string } | undefined;
  if (brush) return brush.role === 'subtract' ? 'trigger' : 'block';
  const doc = useEditor.getState().doc;
  if (doc && isGroup(doc, e)) return 'folder';
  const light = e.components.light as { kind?: string } | undefined;
  if (light?.kind === 'directional') return 'sun';
  if (light?.kind === 'spot') return 'spot';
  if (light) return 'light';
  if (e.components.playerSpawn) return 'person';
  return 'cube';
}

export function SceneTree() {
  const doc = useEditor((s) => s.doc)!;
  useEditor((s) => s.rev);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [drop, setDrop] = useState<{ id: string | null } | null>(null);
  const [addOpen, setAddOpen] = useState<{ x: number; y: number } | null>(null);

  const rows = useMemo(() => {
    const out: { e: EntityData; depth: number; hasKids: boolean }[] = [];
    const q = filter.trim().toLowerCase();
    if (q) {
      for (const e of doc.entities) if (e.name.toLowerCase().includes(q)) out.push({ e, depth: 0, hasKids: false });
      return out;
    }
    const walk = (parent: string | null, depth: number) => {
      for (const e of doc.children(parent)) {
        const kids = doc.children(e.id).length > 0;
        out.push({ e, depth, hasKids: kids });
        if (kids && !collapsed.has(e.id)) walk(e.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, useEditor.getState().rev, filter, collapsed]);

  const onDrop = (e: DragEvent, target: string | null) => {
    e.preventDefault();
    setDrop(null);
    const id = e.dataTransfer.getData('application/x-cw-entity');
    if (!id || id === target) return;
    try {
      // Keep the object where it is in the world while it changes parent.
      const h = useEditor.getState().history;
      h.begin('Move in hierarchy');
      for (const c of reparentKeepWorld(doc, id, target)) h.execute(c);
      h.commit();
    } catch (err) {
      useEditor.getState().notify((err as Error).message);
    }
  };

  const s = useEditor.getState();
  const ctxItems: MenuEntry[] = [
    { label: t('edit.rename'), shortcut: 'F2', disabled: selection.length !== 1, onSelect: () => s.startRename(selection[0]!) },
    { label: t('edit.duplicate'), disabled: !selection.length, onSelect: s.duplicateSelection },
    { label: t('view.frame'), disabled: !selection.length, onSelect: s.frameSelection },
    'separator',
    { label: t('edit.delete'), disabled: !selection.length, onSelect: s.deleteSelection },
  ];

  return (
    <aside className="cw-side cw-left" aria-label={t('scene.title')}>
      <PanelHeader title={t('scene.title')}>
        <Button size="sm" onClick={(e) => setAddOpen({ x: e.clientX, y: e.clientY + 8 })}>
          + {t('menu.add')}
        </Button>
      </PanelHeader>
      <div className="cw-tree-filter">
        <input className="cw-input" placeholder={t('scene.filter')} aria-label={t('scene.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') setFilter('');
        }} />
      </div>
      <div
        className="cw-tree cw-scroll"
        role="tree"
        aria-multiselectable="true"
        onPointerDown={(e) => e.target === e.currentTarget && select([])}
        onDragOver={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setDrop({ id: null });
          }
        }}
        onDrop={(e) => e.target === e.currentTarget && onDrop(e, null)}
      >
        {rows.length === 0 && <div className="cw-empty">{t('scene.empty')}</div>}
        {rows.map(({ e, depth, hasKids }) => (
          <Row
            key={e.id}
            e={e}
            depth={depth}
            hasKids={hasKids}
            open={!collapsed.has(e.id)}
            selected={selection.includes(e.id)}
            dropping={drop?.id === e.id}
            onToggle={() => {
              const n = new Set(collapsed);
              if (n.has(e.id)) n.delete(e.id);
              else n.add(e.id);
              setCollapsed(n);
            }}
            onSelect={(mode) => select([e.id], mode)}
            onContext={(x, y) => {
              if (!selection.includes(e.id)) select([e.id]);
              setCtx({ x, y });
            }}
            onDragOver={() => setDrop({ id: e.id })}
            onDrop={(ev) => onDrop(ev, e.id)}
          />
        ))}
      </div>
      <div className="cw-tree-foot">
        <span>{selection.length ? `${selection.length} ${t('scene.selected')}` : ''}</span>
        <span>
          {doc.entities.length} {t('scene.objects')}
        </span>
      </div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
      {addOpen && (
        <ContextMenu
          x={addOpen.x}
          y={addOpen.y}
          onClose={() => setAddOpen(null)}
          items={[
            { label: t('add.empty'), onSelect: () => s.add('empty') },
            'separator',
            { label: t('add.pointLight'), onSelect: () => s.add('pointLight') },
            { label: t('add.spotLight'), onSelect: () => s.add('spotLight') },
            { label: t('add.sun'), onSelect: () => s.add('sun') },
            'separator',
            { label: t('add.spawn'), onSelect: () => s.add('spawn') },
            { label: t('add.sign'), onSelect: () => s.add('sign') },
            { label: t('add.chicken'), onSelect: () => void s.addChicken(false) },
            { label: t('add.chickenFriend'), onSelect: () => void s.addChicken(true) },
            { label: t('add.ladder'), onSelect: () => s.addLadder() },
          ]}
        />
      )}
    </aside>
  );
}

function Row(p: {
  e: EntityData;
  depth: number;
  hasKids: boolean;
  open: boolean;
  selected: boolean;
  dropping: boolean;
  onToggle: () => void;
  onSelect: (mode: 'replace' | 'toggle') => void;
  onContext: (x: number, y: number) => void;
  onDragOver: () => void;
  onDrop: (e: DragEvent) => void;
}) {
  const { e } = p;
  const renaming = useEditor((s) => s.renaming === e.id);
  const s = useEditor.getState();
  return (
    <div
      className={`cw-lr${p.selected ? ' on' : ''}${!e.visible ? ' off' : ''}${p.dropping ? ' drop' : ''}`}
      role="treeitem"
      aria-selected={p.selected}
      aria-expanded={p.hasKids ? p.open : undefined}
      style={{ paddingLeft: 2 + p.depth * 18 }}
      draggable={!renaming}
      onDragStart={(ev) => {
        ev.dataTransfer.setData('application/x-cw-entity', e.id);
        ev.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(ev) => {
        ev.preventDefault();
        p.onDragOver();
      }}
      onDrop={p.onDrop}
      onPointerDown={(ev) => {
        if (ev.button !== 0) return;
        p.onSelect(ev.ctrlKey || ev.metaKey || ev.shiftKey ? 'toggle' : 'replace');
      }}
      onDoubleClick={() => s.startRename(e.id)}
      onContextMenu={(ev) => {
        ev.preventDefault();
        p.onContext(ev.clientX, ev.clientY);
      }}
    >
      {p.hasKids ? (
        <button type="button" className={`cw-cx${p.open ? ' o' : ''}`} aria-label={p.open ? 'Collapse' : 'Expand'} onPointerDown={(ev) => ev.stopPropagation()} onClick={p.onToggle} />
      ) : (
        <span className="cw-cx0" style={{ width: 14, flex: 'none' }} />
      )}
      <span className="cw-ls">
        <Icon name={iconFor(e)} />
      </span>
      <span className="cw-ln">
        {renaming ? (
          <input
            className="cw-input"
            autoFocus
            defaultValue={e.name}
            aria-label={t('edit.rename')}
            onFocus={(ev) => ev.currentTarget.select()}
            onPointerDown={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === 'Enter') ev.currentTarget.blur();
              if (ev.key === 'Escape') {
                ev.currentTarget.value = e.name;
                ev.currentTarget.blur();
              }
            }}
            onBlur={(ev) => {
              s.rename(e.id, ev.currentTarget.value);
              s.startRename(null);
            }}
          />
        ) : (
          e.name
        )}
      </span>
      <button
        type="button"
        className={`cw-lb${e.locked ? ' set' : ''}`}
        aria-label={e.locked ? 'Unlock' : 'Lock'}
        onPointerDown={(ev) => ev.stopPropagation()}
        onClick={() => s.setFlag(e.id, 'locked', !e.locked)}
      >
        <Icon name={e.locked ? 'lock' : 'unlock'} />
      </button>
      <button
        type="button"
        className={`cw-lb${!e.visible ? ' set' : ''}`}
        aria-label={e.visible ? 'Hide' : 'Show'}
        onPointerDown={(ev) => ev.stopPropagation()}
        onClick={() => s.setFlag(e.id, 'visible', !e.visible)}
      >
        <Icon name={e.visible ? 'eye' : 'eyeOff'} />
      </button>
    </div>
  );
}
