/** The main editor window: CocoaCanvas frame (top bar, scene list, stage, inspector) plus the bottom workspace. Mockup 01. */
import { RECIPES, type Recipe } from '@cocoaworlds/scripting';
import { Button, Dialog } from '@cocoaworlds/ui';
import { useEffect, useState } from 'react';
import { getLang, t } from '../i18n';
import { useEditor } from '../store';
import { Viewport } from '../viewport/Viewport';
import { BottomPanel } from './BottomPanel';
import { Inspector } from './Inspector';
import { SceneTree } from './SceneTree';
import { ToolBar } from './ToolBar';
import { TopBar } from './TopBar';
import { ScreensPanel } from './ScreensPanel';
import { SHORTCUTS, useShortcuts } from './shortcuts';

const AUTOSAVE_MS = 30_000;

export function EditorScreen() {
  const showBottom = useEditor((s) => s.showBottom);
  const playing = useEditor((s) => !!s.playing);
  const recovery = useEditor((s) => s.recovery);
  const recover = useEditor((s) => s.recover);
  const workspace = useEditor((s) => s.workspace);
  const [keysOpen, setKeysOpen] = useState(false);
  useShortcuts(() => setKeysOpen(true));

  useEffect(() => {
    const id = setInterval(() => void useEditor.getState().autosave(), AUTOSAVE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="cw-editor">
      <TopBar onShowKeys={() => setKeysOpen(true)} />
      {/* The scene stays mounted (hidden) under other workspaces, so its 3D view keeps its state. */}
      {workspace === 'screens' && <ScreensPanel />}
      <div className={`cw-mid${playing ? ' cw-playing' : ''}`} hidden={workspace !== 'scene'}>
        {/* While playing, editing panels are inert: the game runs from a snapshot of the scene. */}
        <div className="cw-inert-wrap" inert={playing}>
          <SceneTree />
        </div>
        <div className="cw-stage">
          <Viewport />
          <div className="cw-inert-wrap" inert={playing}>
            <ToolBar />
          </div>
          {showBottom && <BottomPanel />}
        </div>
        <div className="cw-inert-wrap" inert={playing}>
          <Inspector />
        </div>
      </div>

      <MakePrefabDialog />
      <RecipesDialog />
      {recovery && (
        <Dialog title={t('recover.title')} onClose={() => void recover(false)}>
          <p>{t('recover.body')}</p>
          <p>{new Date(recovery.savedAt).toLocaleString()}</p>
          <div className="cw-actions">
            <Button onClick={() => void recover(false)}>{t('recover.discard')}</Button>
            <Button variant="primary" onClick={() => void recover(true)}>
              {t('recover.recover')}
            </Button>
          </div>
        </Dialog>
      )}

      {keysOpen && (
        <Dialog title={t('keys.title')} onClose={() => setKeysOpen(false)} width={520}>
          <div className="cw-keys">
            {SHORTCUTS.map((s) => (
              <div key={s.label} className="cw-keyrow">
                <span>{s.label}</span>
                <span>
                  {s.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <div className="cw-actions">
            <Button variant="primary" onClick={() => setKeysOpen(false)}>
              {t('close')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** Asks for a name, then turns the selection into a prefab and its first copy. */
function MakePrefabDialog() {
  const open = useEditor((s) => s.dialog === 'makePrefab');
  const s = useEditor.getState();
  const first = useEditor((x) => (x.selection.length ? x.doc?.get(x.selection[0]!)?.name ?? '' : ''));
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const close = () => s.openDialog(null);
  const submit = async (name: string) => {
    setBusy(true);
    const ok = await s.makePrefab(name);
    setBusy(false);
    if (ok) close();
  };
  return (
    <Dialog title={t('prefab.makeTitle')} onClose={close}>
      <p className="cw-hint">{t('prefab.makeBody')}</p>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit(String(new FormData(ev.currentTarget).get('name') ?? ''));
        }}
      >
        <label className="cw-f">
          <span>{t('prefab.name')}</span>
          <input className="cw-input" name="name" aria-label={t('prefab.name')} defaultValue={first} autoFocus onKeyDown={(ev) => ev.stopPropagation()} />
        </label>
        <div className="cw-actions">
          <Button onClick={close}>{t('new.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {t('prefab.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Recipes (V2): pick a ready-made mechanic for the selected object. */
function RecipesDialog() {
  const open = useEditor((s) => s.dialog === 'recipes');
  const target = useEditor((x) => (x.selection.length === 1 ? x.doc?.get(x.selection[0]!) : undefined));
  if (!open) return null;
  const s = useEditor.getState();
  const close = () => s.openDialog(null);
  const lang = getLang();
  const groups: { id: Recipe['group']; title: string }[] = [
    { id: 'doors', title: t('recipe.doors') },
    { id: 'moving', title: t('recipe.moving') },
    { id: 'gameplay', title: t('recipe.gameplay') },
  ];
  return (
    <Dialog title={target ? t('recipe.title').replace('{name}', target.name) : t('recipe.open')} onClose={close}>
      {!target ? (
        <p className="cw-hint">{t('recipe.pick')}</p>
      ) : (
        <div className="cw-recipes">
          <p className="cw-hint">{t('recipe.intro')}</p>
          {groups.map((g) => (
            <section key={g.id} aria-label={g.title}>
              <h3 className="cw-recipe-h">{g.title}</h3>
              {RECIPES.filter((r) => r.group === g.id).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="cw-recipe"
                  onClick={() => {
                    s.applyRecipe(target.id, r.id);
                    close();
                  }}
                >
                  <strong>{r.name[lang]}</strong>
                  <span>{r.description[lang]}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
      <div className="cw-actions">
        <Button onClick={close}>{t('new.cancel')}</Button>
      </div>
    </Dialog>
  );
}
