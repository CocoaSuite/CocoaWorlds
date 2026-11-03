import { Button, ContextMenu, Dialog, Divider, Icon, IconButton, MenuBar, Spacer } from '@cocoaworlds/ui';
import { useEffect, useState } from 'react';
import logo from '../assets/cocoaworlds-logo.svg';
import { t } from '../i18n';
import { flushProjectSave, useEditor } from '../store';

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+';

export function TopBar({ onShowKeys }: { onShowKeys: () => void }) {
  const s = useEditor();
  const session = s.session!;
  useEditor((x) => x.rev);
  const h = s.history;
  const status = s.saving ? t('status.saving') : s.dirty ? t('status.edited') : t('status.saved');

  const [asking, setAsking] = useState(false);
  const [building, setBuilding] = useState(false);
  const confirmClose = () => (s.dirty ? setAsking(true) : s.closeSession());

  return (
    <header className="cw-top">
      <img src={logo} alt="CocoaWorlds" className="cw-brand" />
      <MenuBar
        menus={[
          {
            label: t('menu.file'),
            items: [
              { label: t('file.save'), shortcut: `${mod}S`, onSelect: () => void s.save() },
              'separator',
              { label: t('file.reveal'), onSelect: () => void window.cocoa.projects.reveal(session.dir) },
              'separator',
              { label: t('file.close'), onSelect: confirmClose },
            ],
          },
          {
            label: t('menu.edit'),
            items: [
              { label: h.undoLabel ? `${t('edit.undo')} ${h.undoLabel}` : t('edit.undo'), shortcut: `${mod}Z`, disabled: !h.canUndo, onSelect: s.undo },
              { label: h.redoLabel ? `${t('edit.redo')} ${h.redoLabel}` : t('edit.redo'), shortcut: `${mod}⇧Z`, disabled: !h.canRedo, onSelect: s.redo },
              'separator',
              { label: t('edit.copy'), shortcut: `${mod}C`, disabled: !s.selection.length, onSelect: s.copySelection },
              { label: t('edit.cut'), shortcut: `${mod}X`, disabled: !s.selection.length, onSelect: s.cutSelection },
              { label: t('edit.paste'), shortcut: `${mod}V`, disabled: !s.canPaste, onSelect: s.paste },
              { label: t('edit.duplicate'), shortcut: `${mod}D`, disabled: !s.selection.length, onSelect: s.duplicateSelection },
              'separator',
              { label: t('edit.group'), shortcut: `${mod}G`, disabled: !s.selection.length, onSelect: s.groupSelection },
              { label: t('prefab.make'), disabled: !s.selection.length, onSelect: () => s.openDialog('makePrefab') },
              { label: t('edit.ungroup'), shortcut: `${mod}⇧G`, disabled: !s.selection.length, onSelect: s.ungroupSelection },
              'separator',
              { label: t('edit.delete'), shortcut: 'Del', disabled: !s.selection.length, onSelect: s.deleteSelection },
              { label: t('edit.rename'), shortcut: 'F2', disabled: s.selection.length !== 1, onSelect: () => s.startRename(s.selection[0]!) },
              'separator',
              { label: t('edit.selectAll'), shortcut: `${mod}A`, onSelect: s.selectAll },
              { label: t('edit.deselect'), shortcut: 'Esc', onSelect: () => s.select([]) },
            ],
          },
          {
            label: t('menu.view'),
            items: [
              { label: `${s.view === 'perspective' ? '✓ ' : ''}${t('view.perspective')}`, shortcut: '1', onSelect: () => s.setView('perspective') },
              { label: `${s.view === 'top' ? '✓ ' : ''}${t('view.top')}`, shortcut: '2', onSelect: () => s.setView('top') },
              { label: `${s.view === 'front' ? '✓ ' : ''}${t('view.front')}`, shortcut: '3', onSelect: () => s.setView('front') },
              { label: `${s.view === 'side' ? '✓ ' : ''}${t('view.side')}`, shortcut: '4', onSelect: () => s.setView('side') },
              'separator',
              { label: t('view.frame'), shortcut: 'F', disabled: !s.selection.length, onSelect: s.frameSelection },
              'separator',
              { label: `${s.showGrid ? '✓ ' : ''}${t('view.grid')}`, onSelect: () => s.toggle('showGrid') },
              { label: `${s.showNav ? '✓ ' : ''}${t('view.nav')}`, onSelect: () => s.toggle('showNav') },
              { label: `${s.showGrass ? '✓ ' : ''}${t('view.grass')}`, onSelect: () => s.toggle('showGrass') },
              { label: `${s.gameLighting ? '✓ ' : ''}${t('view.gameLighting')}`, onSelect: () => s.toggle('gameLighting') },
              { label: `${s.showStats ? '✓ ' : ''}${t('view.stats')}`, onSelect: () => s.toggle('showStats') },
              { label: `${s.showBottom ? '✓ ' : ''}${t('view.bottom')}`, onSelect: () => s.toggle('showBottom') },
              'separator',
              { label: `${s.lang === 'en' ? '✓ ' : ''}English`, onSelect: () => s.setLang('en') },
              { label: `${s.lang === 'ru' ? '✓ ' : ''}Русский`, onSelect: () => s.setLang('ru') },
            ],
          },
          {
            label: t('menu.add'),
            items: [
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
            { label: t('add.terrain'), onSelect: () => s.addTerrain() },
            ],
          },
          {
            label: t('menu.help'),
            items: [
              { label: t('help.shortcuts'), shortcut: '?', onSelect: onShowKeys },
              { label: `${t('help.about')} — ${window.cocoa.versions.app}`, disabled: true, onSelect: () => {} },
            ],
          },
        ]}
      />
      <div className="cw-crumbs">
        {session.project.name} <span className="cw-crumb-sep">/</span> <ScenePicker />
      </div>
      <Workspaces />
      <div className="cw-status" data-testid="save-status">
        <span className={`cw-dot ${s.dirty ? 'warn' : 'ok'}`} />
        {status}
      </div>
      <Spacer />
      <IconButton icon="undo" label={t('edit.undo')} disabled={!h.canUndo} onClick={s.undo} />
      <IconButton icon="redo" label={t('edit.redo')} disabled={!h.canRedo} onClick={s.redo} />
      <Divider />
      <Button disabled={!!s.playing} onClick={() => setBuilding(true)}>
        {t('build')}
      </Button>
      {building && <BuildDialog onClose={() => setBuilding(false)} />}
      {s.playing ? (
        <Button variant="primary" onClick={s.stopPlaying} title={`${t('play.stop')} (Esc, F5)`}>
          <Icon name="stop" size={13} style={{ fill: 'currentColor', stroke: 'none' }} />
          {t('play.stop')}
        </Button>
      ) : (
        <Button variant="primary" onClick={s.play} title={`${t('play')} (F5)`}>
          <Icon name="play" size={13} style={{ fill: 'currentColor', stroke: 'none' }} />
          {t('play')}
        </Button>
      )}
      {asking && (
        <Dialog title={t('close.title')} onClose={() => setAsking(false)}>
          <p>{t('close.body')}</p>
          <div className="cw-actions">
            <Button onClick={() => setAsking(false)}>{t('new.cancel')}</Button>
            <Button
              onClick={() => {
                setAsking(false);
                s.closeSession();
              }}
            >
              {t('close.discard')}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (await s.save()) {
                  setAsking(false);
                  s.closeSession();
                }
              }}
            >
              {t('file.save')}
            </Button>
          </div>
        </Dialog>
      )}
    </header>
  );
}

/** The open scene's name; a click lists the project's scenes to open, adds one, or makes this the start. */
function ScenePicker() {
  const s = useEditor();
  const session = s.session!;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const stem = (p: string) => p.split('/').pop()!.replace(/\.cwscene$/, '');
  const start = session.project.startScene;
  return (
    <>
      <button
        type="button"
        className="cw-scene-pick"
        aria-label={t('scenes.pick')}
        aria-haspopup="menu"
        disabled={!!s.playing}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <b>{s.doc?.name}</b> ▾
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...session.project.scenes.map((p) => ({
              label: `${stem(p)}${p === start ? `  · ${t('scenes.startTag')}` : ''}${p === session.scenePath ? '  ✓' : ''}`,
              disabled: p === session.scenePath,
              onSelect: () => void s.goToScene(p),
            })),
            'separator' as const,
            { label: t('scenes.add'), onSelect: () => (setName(''), setNaming(true)) },
            { label: t('scenes.makeStart'), disabled: start === session.scenePath, onSelect: () => void s.setStartScene(session.scenePath) },
          ]}
        />
      )}
      {naming && (
        <Dialog title={t('scenes.addTitle')} onClose={() => setNaming(false)} width={380}>
          <form
            className="cw-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setNaming(false);
              void s.addScene(name);
            }}
          >
            <label className="cw-f">
              <span>{t('scenes.name')}</span>
              <input className="cw-input" aria-label={t('scenes.name')} autoFocus value={name} placeholder="level_02" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </label>
            <div className="cw-actions">
              <Button onClick={() => setNaming(false)}>{t('new.cancel')}</Button>
              <Button variant="primary" type="submit" disabled={!name.trim()}>
                {t('scenes.create')}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

/** Scene, Screens (the screen UI editor) and, later, Materials: each fills the window. */
function Workspaces() {
  const ws = useEditor((x) => x.workspace);
  const playing = useEditor((x) => !!x.playing);
  const set = useEditor((x) => x.setWorkspace);
  const tabs: { id: 'scene' | 'screens' | 'materials'; label: string; soon?: boolean }[] = [
    { id: 'scene', label: t('ws.scene') },
    { id: 'screens', label: t('ws.screens') },
    { id: 'materials', label: t('ws.materials') },
  ];
  return (
    <div className="cw-ws" role="tablist" aria-label={t('ws.label')}>
      {tabs.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={ws === x.id}
          className={ws === x.id ? 'on' : ''}
          disabled={x.soon || (playing && x.id !== 'scene')}
          title={x.soon ? t('ws.soon') : undefined}
          onClick={() => set(x.id)}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

type Target = 'web' | 'win32' | 'darwin' | 'linux';

/** Build… : export the game for the web or a desktop system (B4). */
function BuildDialog({ onClose }: { onClose: () => void }) {
  const here = window.cocoa.platform;
  const [target, setTarget] = useState<Target>(here === 'win32' || here === 'darwin' || here === 'linux' ? (here as Target) : 'web');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState<{ folder: string; start: string; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => window.cocoa.game.onProgress(setProgress), []);
  const names: Record<Target, string> = { web: t('export.web'), win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const go = async () => {
    const st = useEditor.getState();
    const dir = st.session?.dir;
    if (!dir) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (st.dirty && !(await st.save())) throw new Error(t('export.failed'));
      await flushProjectSave();
      const r = await window.cocoa.game.export(dir, target);
      if (!r.ok) throw new Error(r.error);
      if (r.value) {
        setDone(r.value);
        st.log('info', 'Build', `${names[target]}: ${r.value.folder} (${(r.value.bytes / 1024 / 1024).toFixed(1)} MB)`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t('export.title')} onClose={() => !busy && onClose()} width={520}>
      <p className="cw-hint">{t('export.intro')}</p>
      <div className="cw-export-targets" role="radiogroup" aria-label={t('export.target')}>
        {(['web', 'win32', 'darwin', 'linux'] as Target[]).map((x) => (
          <label key={x} className={`cw-export-target${target === x ? ' on' : ''}`}>
            <input type="radio" name="target" checked={target === x} disabled={busy} onChange={() => setTarget(x)} aria-label={names[x]} />
            <strong>{names[x]}</strong>
            <span className="cw-muted">{x === 'web' ? t('export.webHint') : x === here ? `${t('export.thisComputer')} · ${t('export.desktopHint')}` : `${t('export.download')} · ${t('export.desktopHint')}`}</span>
          </label>
        ))}
      </div>
      {busy && (
        <p role="status" className="cw-hint">
          {progress || t('export.working')}
        </p>
      )}
      {error && (
        <p role="alert" className="cw-export-error">
          {t('export.failed')}: {error}
        </p>
      )}
      {done && (
        <p role="status" className="cw-export-done" data-testid="export-done">
          {t('export.done')}: <span className="mono">{done.folder}</span>
        </p>
      )}
      <div className="cw-actions">
        {done && <Button onClick={() => void window.cocoa.game.reveal(done.start)}>{t('export.show')}</Button>}
        {done && target === here && (
          <Button
            onClick={async () => {
              const r = await window.cocoa.game.launch(done.start);
              if (!r.ok) setError(r.error);
            }}
          >
            {t('export.play')}
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          {t('export.close')}
        </Button>
        <Button variant="primary" onClick={() => void go()} disabled={busy}>
          {busy ? t('export.working') : t('export.go')}
        </Button>
      </div>
    </Dialog>
  );
}
