/** React wrapper around ViewportEngine plus the viewport overlays (view switcher, grid/snap pill, stats, selection readout). */
import type { Vec3 } from '@cocoaworlds/core';
import { ContextMenu, Segmented, type MenuEntry } from '@cocoaworlds/ui';
import { useEffect, useRef, useState } from 'react';
import { flyState } from '../editor/shortcuts';
import { t } from '../i18n';
import { useSelectedEntities, useEditor, type ViewMode } from '../store';
import type { DraftState } from './brush-draft';
import { BrushPanel } from './BrushPanel';
import { ViewportEngine, type ViewportStats } from './engine';

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<ViewportEngine | null>(null);
  const [stats, setStats] = useState<ViewportStats | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; ground: Vec3 | null } | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const brushOptions = useEditor((s) => s.brushOptions);
  const brushRole = useEditor((s) => s.brushRole);

  const doc = useEditor((s) => s.doc);
  const rev = useEditor((s) => s.rev);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const view = useEditor((s) => s.view);
  const snap = useEditor((s) => s.snap);
  const showGrid = useEditor((s) => s.showGrid);
  const showStats = useEditor((s) => s.showStats);
  const gridSize = useEditor((s) => s.session?.project.settings.gridSize ?? 16);
  const focusRequest = useEditor((s) => s.focusRequest);
  const sel = useSelectedEntities();
  const setView = useEditor((s) => s.setView);

  useEffect(() => {
    if (!host.current) return;
    let e: ViewportEngine;
    try {
      e = new ViewportEngine(host.current, {
        select: (ids, mode) => useEditor.getState().select(ids, mode),
        beginEdit: (label) => useEditor.getState().begin(label),
        liveTransform: (id, tr) => useEditor.getState().setTransform(id, tr, 'gizmo'),
        liveBrush: (id, b) => useEditor.getState().setBrush(id, b, 'gizmo', 'Transform brush'),
        draft: setDraft,
        createBrush: (min, max) => useEditor.getState().createBrushes(min, max),
        cancelTool: () => useEditor.getState().setTool('select'),
        endEdit: () => useEditor.getState().commit(),
        contextMenu: (x, y, ground) => setCtx({ x, y, ground }),
        stats: setStats,
        setFlying: (a) => {
          flyState.active = a;
        },
      });
    } catch (err) {
      setGlError((err as Error).message);
      return;
    }
    engine.current = e;
    (window as unknown as { __cwViewport?: ViewportEngine }).__cwViewport = e;
    return () => {
      e.dispose();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setDoc(doc);
  }, [doc]);
  useEffect(() => {
    engine.current?.syncAll();
  }, [rev]);
  useEffect(() => {
    engine.current?.setSelection(selection);
  }, [selection]);
  useEffect(() => {
    engine.current?.setGizmoMode(tool === 'select' || tool === 'brush' ? 'none' : tool === 'move' ? 'translate' : tool);
  }, [tool]);
  useEffect(() => {
    engine.current?.setBrushTool(tool === 'brush', brushOptions, brushRole);
  }, [tool, brushOptions, brushRole]);
  useEffect(() => {
    engine.current?.setView(view);
  }, [view]);
  useEffect(() => {
    engine.current?.setSnap(snap, gridSize);
  }, [snap, gridSize]);
  useEffect(() => {
    engine.current?.setGridVisible(showGrid);
  }, [showGrid]);
  useEffect(() => {
    if (focusRequest) engine.current?.frameSelection();
  }, [focusRequest]);

  const s = useEditor.getState();
  const ctxItems: MenuEntry[] = selection.length
    ? [
        { label: t('view.frame'), shortcut: 'F', onSelect: s.frameSelection },
        { label: t('edit.duplicate'), onSelect: s.duplicateSelection },
        { label: t('edit.rename'), disabled: selection.length !== 1, onSelect: () => s.startRename(selection[0]!) },
        'separator',
        { label: t('edit.delete'), onSelect: s.deleteSelection },
      ]
    : [
        { label: `${t('add.pointLight')}`, onSelect: () => s.add('pointLight', ctx?.ground ?? undefined) },
        { label: `${t('add.spotLight')}`, onSelect: () => s.add('spotLight', ctx?.ground ?? undefined) },
        { label: `${t('add.spawn')}`, onSelect: () => s.add('spawn', ctx?.ground ?? undefined) },
        { label: `${t('add.empty')}`, onSelect: () => s.add('empty', ctx?.ground ?? undefined) },
      ];

  const one = sel.length === 1 ? sel[0]! : null;

  return (
    <div className="cw-view" ref={host} data-testid="viewport">
      {glError && (
        <div className="cw-gl-error">
          The 3D view could not start: {glError}. Check that your graphics drivers support WebGL 2.
        </div>
      )}
      <div className="cw-ov cw-ov-tl">
        <Segmented<ViewMode>
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'perspective', label: t('view.perspective') },
            { value: 'top', label: t('view.top') },
            { value: 'front', label: t('view.front') },
            { value: 'side', label: t('view.side') },
          ]}
        />
      </div>
      <div className="cw-ov cw-ov-tr cw-pill">
        <span className="cw-pill-k">{t('grid.grid')}</span>
        <span className="mono">{gridSize}u</span>
        <span className="cw-pill-sep" />
        <span className="cw-pill-k">{t('grid.snap')}</span>
        <span>{snap ? t('grid.on') : t('grid.off')}</span>
      </div>
      {one && (
        <div className="cw-ov cw-ov-bl mono" data-testid="selection-readout">
          <span>
            <span className="ax-x">X</span> {one.transform.position[0]} <span className="ax-y">Y</span> {one.transform.position[1]}{' '}
            <span className="ax-z">Z</span> {one.transform.position[2]}
          </span>
          <span>{one.name}</span>
        </div>
      )}
      {showStats && stats && (
        <div className="cw-ov cw-ov-br mono" data-testid="viewport-stats">
          {stats.frameMs.toFixed(1)} ms · {stats.draws} draws · {stats.triangles.toLocaleString()} tris
        </div>
      )}
      {tool === 'brush' && (
        <BrushPanel
          draft={draft}
          onBounds={(min, max) => engine.current?.setDraftBounds(min, max)}
          onCreate={() => engine.current?.confirmDraft()}
          onCancel={() => engine.current?.cancelDraft()}
        />
      )}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
