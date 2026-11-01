/** React wrapper around ViewportEngine plus the viewport overlays (view switcher, grid/snap pill, stats, selection readout). */
import type { Vec3 } from '@cocoaworlds/core';
import { ContextMenu, Segmented, type MenuEntry } from '@cocoaworlds/ui';
import { useEffect, useRef, useState } from 'react';
import { flyState } from '../editor/shortcuts';
import { t } from '../i18n';
import { useSelectedEntities, useEditor, type ViewMode } from '../store';
import type { DraftState } from './brush-draft';
import { BrushPanel } from './BrushPanel';
import { PaintPanel } from './PaintPanel';
import { ClipPanel } from './ClipPanel';
import { VertexPanel } from './VertexPanel';
import { LoopCutPanel } from './LoopCutPanel';
import type { ClipKeep, ClipState } from './clip-tool';
import { ViewportEngine, type Hud, type ViewportStats } from './engine';

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+';

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<ViewportEngine | null>(null);
  const [stats, setStats] = useState<ViewportStats | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; ground: Vec3 | null } | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [vertexCount, setVertexCount] = useState(0);
  /** Playing as the player: null = not, false = waiting for a click, true = mouse captured. */
  const [lock, setLock] = useState<boolean | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [loop, setLoop] = useState<{ cuts: number; fits: boolean | null }>({ cuts: 1, fits: null });
  const [clip, setClip] = useState<{ state: ClipState | null; keep: ClipKeep }>({ state: null, keep: 'both' });
  const brushOptions = useEditor((s) => s.brushOptions);
  const brushRole = useEditor((s) => s.brushRole);

  const doc = useEditor((s) => s.doc);
  const rev = useEditor((s) => s.rev);
  const selection = useEditor((s) => s.selection);
  const playing = useEditor((s) => s.playing);
  const faceSelection = useEditor((s) => s.faceSelection);
  const tool = useEditor((s) => s.tool);
  const view = useEditor((s) => s.view);
  const snap = useEditor((s) => s.snap);
  const vertexSnap = useEditor((s) => s.vertexSnap);
  const pivotEdit = useEditor((s) => s.pivotEdit);
  const showGrid = useEditor((s) => s.showGrid);
  const gameLighting = useEditor((s) => s.gameLighting);
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
        clickSelect: (id, additive, deep) => useEditor.getState().clickSelect(id, additive, deep),
        liveMany: (changes) => useEditor.getState().applyLive(changes),
        draft: setDraft,
        createBrush: (min, max, outline) => useEditor.getState().createBrushes(min, max, outline),
        cancelTool: () => useEditor.getState().setTool('select'),
        selectFace: (ref, mode, cut) => useEditor.getState().selectFace(ref, mode, cut),
        boxSelect: (ids, additive) => useEditor.getState().boxSelect(ids, additive),
        playFrame: (frame, names) => {
          const st = useEditor.getState();
          for (const ev of frame.events) {
            const what = names.get(ev.other) ?? ev.other;
            const zone = names.get(ev.trigger) ?? ev.trigger;
            st.log('info', 'Trigger', `${ev.time.toFixed(2)} s — ${what} ${ev.kind === 'enter' ? 'entered' : 'left'} ${zone}`);
          }
          for (const l of frame.logs) st.log('info', names.get(l.owner) ?? 'Script', l.text);
          for (const e of frame.errors) st.log('error', names.get(e.owner) ?? 'Script', e.message);
          for (const u of frame.uses) st.log('info', 'Player', `The player used ${names.get(u) ?? u}`);
          for (const n of frame.notes) st.log('info', 'Player', n);
        },
        activeBlocks: (blocks) => useEditor.setState({ activeBlocks: blocks }),
        playerLock: setLock,
        hud: setHud,
        livePivot: (id, world) => useEditor.getState().setPivot(id, world, `pivot-${id}`),
        loopCutState: (cuts, fits) => setLoop({ cuts, fits }),
        applyLoopCut: (id, brush) => {
          const st = useEditor.getState();
          st.setBrush(id, brush, undefined, 'Loop cut');
          useEditor.setState({ selection: [id] });
          // Straight on to moving the new corners.
          st.setTool('vertex');
          st.log('info', 'Brush', `Loop cut ${st.doc?.get(id)?.name ?? id}: ${brush.mesh?.verts.length ?? 0} corners`);
        },
        vertexInfo: setVertexCount,
        clipState: (state, keep) => setClip({ state, keep }),
        clip: (plane, keep) => useEditor.getState().clipSelection(plane, keep),
        message: (text) => {
          const key = `vertex.${text}` as Parameters<typeof t>[0];
          useEditor.getState().notify(t(key));
        },
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
    useEditor.setState({ placementPoint: () => e.focusPoint() });
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
    engine.current?.setGizmoMode(tool === 'select' || tool === 'brush' || tool === 'face' || tool === 'paint' || tool === 'vertex' || tool === 'clip' || tool === 'loopcut' ? 'none' : tool === 'move' ? 'translate' : tool);
  }, [tool]);
  useEffect(() => {
    engine.current?.setBrushTool(tool === 'brush', brushOptions, brushRole);
  }, [tool, brushOptions, brushRole]);
  useEffect(() => {
    engine.current?.setFaceTool(tool === 'face' || tool === 'paint');
    engine.current?.setEditTool(tool === 'vertex' ? 'vertex' : tool === 'clip' ? 'clip' : tool === 'loopcut' ? 'loopcut' : 'none');
  }, [tool]);
  useEffect(() => {
    engine.current?.setFaceSelection(faceSelection);
  }, [faceSelection, tool]);
  useEffect(() => {
    engine.current?.setView(view);
  }, [view]);
  useEffect(() => {
    engine.current?.setSnap(snap, gridSize);
  }, [snap, gridSize]);
  useEffect(() => {
    engine.current?.setVertexSnap(vertexSnap);
  }, [vertexSnap]);
  useEffect(() => {
    engine.current?.setPivotEdit(pivotEdit);
  }, [pivotEdit]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (!playing) {
      e.stopPlay();
      setLock(null);
      return;
    }
    let cancelled = false;
    const st = useEditor.getState();
    e.startPlay(playing.scene, playing.rules, playing.values)
      .then((info) => {
        if (cancelled) return;
        st.log(
          'info',
          'Play',
          info.player
            ? `Playing as the player: ${info.moving} moving object(s), ${info.triggers} trigger zone(s). Esc frees the mouse; Esc again or Stop returns to editing.`
            : `Playing: ${info.moving} moving object(s), ${info.triggers} trigger zone(s). No Player start in the scene, so this is a physics preview. Esc or Stop returns to editing.`,
        );
        for (const p of info.problems) {
          st.log(p.severity === 'error' ? 'error' : 'warn', info.names.get(p.owner) ?? 'Script', p.severity === 'error' ? `${p.message} (this stack doesn't run)` : p.message);
        }
      })
      .catch((err: Error) => {
        st.log('error', 'Play', `Could not start the game: ${err.message}`);
        st.stopPlaying();
      });
    return () => {
      cancelled = true;
    };
  }, [playing]);
  useEffect(() => {
    engine.current?.setGridVisible(showGrid);
  }, [showGrid]);
  useEffect(() => {
    engine.current?.setGameLighting(gameLighting);
  }, [gameLighting]);
  useEffect(() => {
    if (focusRequest) engine.current?.frameSelection();
  }, [focusRequest]);

  const s = useEditor.getState();
  const ctxItems: MenuEntry[] = selection.length
    ? [
        { label: t('view.frame'), shortcut: 'F', onSelect: s.frameSelection },
        { label: t('edit.copy'), shortcut: `${mod}C`, onSelect: s.copySelection },
        { label: t('edit.cut'), shortcut: `${mod}X`, onSelect: s.cutSelection },
        { label: t('edit.paste'), shortcut: `${mod}V`, disabled: !s.canPaste, onSelect: s.paste },
        { label: t('edit.duplicate'), onSelect: s.duplicateSelection },
        { label: t('edit.group'), shortcut: `${mod}G`, onSelect: s.groupSelection },
        { label: t('prefab.make'), onSelect: () => s.openDialog('makePrefab') },
        { label: t('edit.rename'), disabled: selection.length !== 1, onSelect: () => s.startRename(selection[0]!) },
        'separator',
        { label: t('edit.delete'), onSelect: s.deleteSelection },
      ]
    : [
        { label: t('edit.paste'), shortcut: `${mod}V`, disabled: !s.canPaste, onSelect: s.paste },
        'separator',
        { label: `${t('add.pointLight')}`, onSelect: () => s.add('pointLight', ctx?.ground ?? undefined) },
        { label: `${t('add.spotLight')}`, onSelect: () => s.add('spotLight', ctx?.ground ?? undefined) },
        { label: `${t('add.spawn')}`, onSelect: () => s.add('spawn', ctx?.ground ?? undefined) },
        { label: t('add.sign'), onSelect: () => s.add('sign', ctx?.ground ?? undefined) },
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
        {!playing && (
          <>
            <span className="cw-pill-sep" />
            <button
              type="button"
              className="cw-pill-btn"
              aria-pressed={gameLighting}
              title={t('view.gameLightingHint')}
              onClick={() => useEditor.getState().toggle('gameLighting')}
            >
              <span className="cw-pill-k">{t('view.lighting')}</span> {gameLighting ? t('view.lightingGame') : t('view.lightingPreview')}
            </button>
          </>
        )}
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
          {stats.building ? `${t('stats.building')} · ` : ''}
          {stats.frameMs.toFixed(1)} ms · {stats.draws} draws · {stats.triangles.toLocaleString()} tris · {t('stats.build')} {stats.buildMs} ms
        </div>
      )}
      {playing && (
        <div className="cw-ov cw-play-banner" data-testid="play-banner">
          <span className="cw-live-dot" />
          {lock === null ? t('play.banner') : t('play.bannerPlayer')}
          <button type="button" className="cw-play-stop" onClick={() => useEditor.getState().stopPlaying()}>
            {t('play.stop')}
          </button>
        </div>
      )}
      {playing && lock === true && <div className="cw-crosshair" aria-hidden="true" />}
      {playing && hud && <HudView hud={hud} />}
      {playing && lock === false && (
        <button type="button" className="cw-ov cw-click-play" data-testid="click-to-play" onClick={() => engine.current?.capturePlayer()}>
          <strong>{t('play.click')}</strong>
          <span>{t('play.keys')}</span>
        </button>
      )}
      {!playing && tool === 'brush' && (
        <BrushPanel
          draft={draft}
          onBounds={(min, max) => engine.current?.setDraftBounds(min, max)}
          onCreate={() => engine.current?.confirmDraft()}
          onCancel={() => engine.current?.cancelDraft()}
        />
      )}
      {tool === 'paint' && <PaintPanel />}
      {!playing && tool === 'loopcut' && <LoopCutPanel cuts={loop.cuts} fits={loop.fits} onCuts={(n) => engine.current?.setLoopCuts(n)} />}
      {tool === 'vertex' && <VertexPanel count={vertexCount} hasBrushes={sel.some((e) => !!e.components.brush) || selection.length > 0} />}
      {tool === 'clip' && (
        <ClipPanel
          state={clip.state}
          keep={clip.keep}
          hasBrushes={selection.length > 0}
          onKeep={(k) => engine.current?.setClipKeep(k)}
          onApply={() => engine.current?.applyClip()}
          onCancel={() => engine.current?.cancelClip()}
        />
      )}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}

/** Health (and the score, once a script uses it) in the corner of the game view; red flash when hurt. */
function HudView({ hud }: { hud: Hud }) {
  const low = hud.showHealth && hud.health <= 25;
  return (
    <>
      {hud.use !== null && (
        <div className="cw-ov cw-use-prompt" data-testid="use-prompt" role="status">
          <kbd>E</kbd>
          <span>{hud.use || t('hud.use')}</span>
        </div>
      )}
      {hud.messages.length > 0 && (
        <div className="cw-ov cw-hud-messages" data-testid="hud-messages" role="status">
          {hud.messages.slice(-3).map((m, i) => (
            <div key={i} className="cw-hud-message">
              {m}
            </div>
          ))}
        </div>
      )}
      {hud.hurt && hud.showHealth && <div className="cw-hurt" aria-hidden="true" />}
      {(hud.showHealth || hud.showScore || hud.values.length > 0) && (
      <div className="cw-ov cw-hud" data-testid="hud">
        {hud.showHealth && (
          <div className={`cw-hud-item${low ? ' low' : ''}`} role="meter" aria-label={t('hud.health')} aria-valuemin={0} aria-valuemax={hud.maxHealth} aria-valuenow={hud.health}>
            <span className="cw-hud-label">{t('hud.health')}</span>
            <span className="cw-hud-value" data-testid="hud-health">
              {hud.health}
            </span>
            <span className="cw-hud-bar">
              <span style={{ width: `${(100 * hud.health) / hud.maxHealth}%` }} />
            </span>
          </div>
        )}
        {hud.values.map((v) => (
          <div key={v.name} className="cw-hud-item" data-testid={`hud-value-${v.name}`}>
            <span className="cw-hud-label">{v.name}</span>
            <span className="cw-hud-value">{v.value}</span>
          </div>
        ))}
        {hud.showScore && (
          <div className="cw-hud-item">
            <span className="cw-hud-label">{t('hud.score')}</span>
            <span className="cw-hud-value" data-testid="hud-score">
              {hud.score}
            </span>
          </div>
        )}
      </div>
      )}
    </>
  );
}
