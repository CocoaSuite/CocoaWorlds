/** The main editor window: CocoaCanvas frame (top bar, scene list, stage, inspector) plus the bottom workspace. Mockup 01. */
import { Button, Dialog } from '@cocoaworlds/ui';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useEditor } from '../store';
import { Viewport } from '../viewport/Viewport';
import { BottomPanel } from './BottomPanel';
import { Inspector } from './Inspector';
import { SceneTree } from './SceneTree';
import { ToolBar } from './ToolBar';
import { TopBar } from './TopBar';
import { SHORTCUTS, useShortcuts } from './shortcuts';

const AUTOSAVE_MS = 30_000;

export function EditorScreen() {
  const showBottom = useEditor((s) => s.showBottom);
  const playing = useEditor((s) => !!s.playing);
  const recovery = useEditor((s) => s.recovery);
  const recover = useEditor((s) => s.recover);
  const [keysOpen, setKeysOpen] = useState(false);
  useShortcuts(() => setKeysOpen(true));

  useEffect(() => {
    const id = setInterval(() => void useEditor.getState().autosave(), AUTOSAVE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="cw-editor">
      <TopBar onShowKeys={() => setKeysOpen(true)} />
      <div className={`cw-mid${playing ? ' cw-playing' : ''}`}>
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
