/** React wrapper around ViewportEngine plus the viewport overlays (view switcher, grid/snap pill, stats, selection readout). */
import { shown } from '../axes';
import { uiOf, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { SaveMenu } from '../ui/SaveMenu';
import { UiLayer } from '../ui/UiLayer';
import { BlueprintMenu } from '../ui/BlueprintMenu';
import { HudView } from '../ui/Hud';
import { ContextMenu, Segmented, type MenuEntry } from '@cocoaworlds/ui';
import { useEffect, useRef, useState } from 'react';
import { flyState } from '../editor/shortcuts';
import { t } from '../i18n';
import { GRID_SIZES, useSelectedEntities, useEditor, type ViewMode } from '../store';
import type { DraftState } from './brush-draft';
import { BrushPanel } from './BrushPanel';
import { TerrainPanel } from './TerrainPanel';
import { ClipPanel } from './ClipPanel';
import { VertexPanel } from './VertexPanel';
import { LoopCutPanel } from './LoopCutPanel';
import { BevelPanel } from './BevelPanel';
import type { BevelInfo } from './engine';
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
  const [uiMouse, setUiMouse] = useState(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const [loop, setLoop] = useState<{ cuts: number; fits: boolean | null }>({ cuts: 1, fits: null });
  const [bevel, setBevel] = useState<BevelInfo | null>(null);
  const [clip, setClip] = useState<{ state: ClipState | null; keep: ClipKeep }>({ state: null, keep: 'both' });
  const brushOptions = useEditor((s) => s.brushOptions);
  const brushRole = useEditor((s) => s.brushRole);

  const doc = useEditor((s) => s.doc);
  const rev = useEditor((s) => s.rev);
  const selection = useEditor((s) => s.selection);
  const playing = useEditor((s) => s.playing);
  // (After a level change, the scene the player is in now.)
  const [sceneNow, setSceneNow] = useState<SceneFile | null>(null);
  useEffect(() => setSceneNow(null), [playing]);
  const playScene = sceneNow ?? playing?.scene;
  // Playing as the player: the editor's own overlays (views, grid, the selection) make way for the game's screen.
  const asPlayer = !!playing && lock !== null;
  const faceSelection = useEditor((s) => s.faceSelection);
  const tool = useEditor((s) => s.tool);
  const view = useEditor((s) => s.view);
  const snap = useEditor((s) => s.snap);
  const vertexSnap = useEditor((s) => s.vertexSnap);
  const pivotEdit = useEditor((s) => s.pivotEdit);
  const showGrid = useEditor((s) => s.showGrid);
  const showNav = useEditor((s) => s.showNav);
  const showGrass = useEditor((s) => s.showGrass);
  const showProbes = useEditor((s) => s.showProbes);
  const showCollisions = useEditor((s) => s.showCollisions);
  const terrainBrush = useEditor((s) => s.terrainBrush);
  const gameLighting = useEditor((s) => s.gameLighting);
  const showStats = useEditor((s) => s.showStats);
  const showPlayBar = useEditor((s) => s.showPlayBar);
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
        terrainEdit: (cmd) => useEditor.getState().terrainEdit(cmd),
        repeatLength: (id, length) => useEditor.getState().setComponentField(id, 'repeat', 'length', length, `repeat-${id}`),
        clickSelect: (id, additive, deep) => useEditor.getState().clickSelect(id, additive, deep),
        liveMany: (changes) => useEditor.getState().applyLive(changes),
        draft: setDraft,
        createBrush: (min, max, outline) => useEditor.getState().createBrushes(min, max, outline),
        cancelTool: () => useEditor.getState().setTool('select'),
        // A level change: the next scene comes from the editor (this scene) or from its saved file.
        travel: (t) => {
          const st = useEditor.getState();
          const session = st.session;
          const playing = st.playing;
          if (!session || !playing) return;
          const path = session.project.scenes.find((p) => p.split('/').pop()!.replace(/\.cwscene$/, '') === t.scene);
          if (!path) {
            st.log('error', 'Play', `There is no scene called “${t.scene}” to go to.`);
            st.stopPlaying();
            return;
          }
          const load = path === session.scenePath ? Promise.resolve(playing.scene) : window.cocoa.projects.readScene(session.dir, path).then((r) => (r.ok ? r.value : Promise.reject(new Error(r.error))));
          void load
            .then((scene) => {
              setSceneNow(scene);
              return engine.current?.travelTo(scene, t, playing.rules, playing.values);
            })
            .then(() => st.log('info', 'Play', `Level change: now in ${t.scene}${t.landmark ? ` by the landmark ${t.landmark}` : ''}.`))
            .catch((err: Error) => {
              st.log('error', 'Play', `Could not go to ${t.scene}: ${err.message}`);
              st.stopPlaying();
            });
        },
        selectFace: (ref, mode, cut) => useEditor.getState().selectFace(ref, mode, cut),
        modelPart: (id, slot, mode) => useEditor.getState().paintModelPart(id, slot, mode),
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
        uiMouse: setUiMouse,
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
        cancelEdit: () => useEditor.getState().cancelEdit(),
        bevelState: setBevel,
        rebevel: (changes) => {
          const st = useEditor.getState();
          // (Replaces the bevel just made, as one undo step.)
          if (st.history.undoLabel === 'Bevel') st.history.undo();
          st.begin('Bevel');
          st.applyLive(changes);
          st.commit();
        },
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
    useEditor.setState({ placementPoint: () => e.aimPoint() });
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
    engine.current?.setGizmoMode(tool === 'select' || tool === 'brush' || tool === 'face' || tool === 'paint' || tool === 'vertex' || tool === 'clip' || tool === 'loopcut' || tool === 'terrain' ? 'none' : tool === 'move' ? 'translate' : tool);
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
    e.startPlay(playing.scene, playing.rules, playing.values, st.session?.project.id)
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
    engine.current?.setNavVisible(showNav);
  }, [showNav]);
  useEffect(() => {
    engine.current?.setGrassVisible(showGrass);
  }, [showGrass]);
  useEffect(() => {
    engine.current?.setProbesVisible(showProbes);
  }, [showProbes]);
  useEffect(() => {
    engine.current?.setCollisionsVisible(showCollisions);
  }, [showCollisions]);
  const zUp = useEditor((s) => s.zUp);
  useEffect(() => {
    engine.current?.setZUp(zUp);
  }, [zUp]);
  useEffect(() => {
    engine.current?.setTerrainTool(tool === 'terrain' && !playing ? terrainBrush : null);
  }, [tool, terrainBrush, playing]);
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
        { label: t('add.poster'), onSelect: () => s.add('poster', ctx?.ground ?? undefined) },
        { label: t('add.painting'), onSelect: () => s.add('painting', ctx?.ground ?? undefined) },
        { label: t('add.stake'), onSelect: () => s.add('stake', ctx?.ground ?? undefined) },
        { label: t('add.junk'), onSelect: () => s.add('junk', ctx?.ground ?? undefined) },
        { label: t('add.carpet'), onSelect: () => s.add('carpet', ctx?.ground ?? undefined) },
        { label: t('add.outlet'), onSelect: () => s.add('outlet', ctx?.ground ?? undefined) },
        { label: t('add.extender'), onSelect: () => s.add('extender', ctx?.ground ?? undefined) },
        { label: t('add.stringLights'), onSelect: () => s.add('stringLights', ctx?.ground ?? undefined) },
        { label: t('add.generator'), onSelect: () => s.add('generator', ctx?.ground ?? undefined) },
        { label: t('add.lightSwitch'), onSelect: () => s.add('lightSwitch', ctx?.ground ?? undefined) },
        { label: t('add.printer'), onSelect: () => void s.addPrinter(ctx?.ground ?? undefined) },
        { label: t('add.chicken'), onSelect: () => void s.addChicken(false, ctx?.ground ?? undefined) },
        { label: t('add.chickenFriend'), onSelect: () => void s.addChicken(true, ctx?.ground ?? undefined) },
        { label: t('add.ladder'), onSelect: () => s.addLadder(ctx?.ground ?? undefined) },
        { label: t('add.terrain'), onSelect: () => s.addTerrain(ctx?.ground ?? undefined) },
        { label: `${t('add.empty')}`, onSelect: () => s.add('empty', ctx?.ground ?? undefined) },
      ];

  const one = sel.length === 1 ? sel[0]! : null;
  // (As shown: Z up when set.)
  const readout = one ? shown(one.transform.position, 'point', zUp) : [0, 0, 0];

  return (
    <div className="cw-view" ref={host} data-testid="viewport">
      {glError && (
        <div className="cw-gl-error">
          The 3D view could not start: {glError}. Check that your graphics drivers support WebGL 2.
        </div>
      )}
      {!asPlayer && (
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
      )}
      {!asPlayer && (
      <div className="cw-ov cw-ov-tr cw-pill">
        <span className="cw-pill-k">{t('grid.grid')}</span>
        <select
          className="cw-pill-select mono"
          aria-label={t('grid.size')}
          title={t('grid.sizeTitle')}
          value={gridSize}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => useEditor.getState().setGridSize(Number(e.currentTarget.value))}
        >
          {GRID_SIZES.map((g) => (
            <option key={g} value={g}>
              {g}u
            </option>
          ))}
        </select>
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
      )}
      {one && !asPlayer && (
        <div className="cw-ov cw-ov-bl mono" data-testid="selection-readout">
          <span>
            <span className="ax-x">X</span> {readout[0]} <span className="ax-y">Y</span> {readout[1]}{' '}
            <span className="ax-z">Z</span> {readout[2]}
          </span>
          <span>{one.name}</span>
        </div>
      )}
      {showStats && stats && (
        <div className="cw-ov cw-ov-br mono" data-testid="viewport-stats">
          {stats.building ? `${t('stats.building')} · ` : ''}
          {stats.worldMs !== null ? `${t('stats.world')} ${stats.worldMs.toFixed(1)} ms\u00a0\u00a0 ${t('stats.draw')} ` : ''}
          {stats.frameMs.toFixed(1)} ms&nbsp;&nbsp; {stats.draws} draws&nbsp;&nbsp; {stats.triangles.toLocaleString()} tris&nbsp;&nbsp; {t('stats.build')} {stats.buildMs} ms
        </div>
      )}
      {playing && showPlayBar && (
        <div className="cw-ov cw-play-banner" data-testid="play-banner">
          <span className="cw-live-dot" />
          {lock === null ? t('play.banner') : t('play.bannerPlayer')}
          <button type="button" className="cw-play-stop" onClick={() => useEditor.getState().stopPlaying()}>
            {t('play.stop')}
          </button>
          <button type="button" className="cw-play-hide" data-testid="play-banner-hide" title={`${t('play.hideBar')} (F6)`} aria-label={t('play.hideBar')} onClick={() => useEditor.getState().toggle('showPlayBar')}>
            ×
          </button>
        </div>
      )}
      {playing && lock === true && <div className="cw-crosshair" aria-hidden="true" />}
      {playing && hud && playScene && <UiLayer ui={uiOf(playScene.settings)} live={hud.ui} values={hud.allValues} onClick={(id) => engine.current?.clickUi(id)} onRow={(list, row) => engine.current?.pickRow(list, row)} />}
      {playing && hud && <HudView hud={hud} />}
      {hud?.blueprints && <BlueprintMenu menu={hud.blueprints} onPick={(id) => engine.current?.pickBlueprint(id)} onClose={() => engine.current?.closeBlueprints()} />}
      {playing && lock === false && !uiMouse && hud && playing.rules.saveMenu && (
        <SaveMenu onResume={() => engine.current?.capturePlayer()} onSave={() => engine.current?.saveGame() ?? false} onLoad={() => engine.current?.loadGame() ?? false} savedAt={engine.current?.savedAt ?? null} />
      )}
      {playing && lock === false && !uiMouse && !(hud && playing.rules.saveMenu) && (
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
      {!playing && tool === 'terrain' && <TerrainPanel />}
      {!playing && tool === 'loopcut' && <LoopCutPanel cuts={loop.cuts} fits={loop.fits} onCuts={(n) => engine.current?.setLoopCuts(n)} />}
      {tool === 'vertex' && bevel && <BevelPanel info={bevel} onAdjust={(p) => engine.current?.adjustBevel(p)} />}
      {tool === 'vertex' && !bevel && <VertexPanel count={vertexCount} hasBrushes={sel.some((e) => !!e.components.brush) || selection.length > 0} />}
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
