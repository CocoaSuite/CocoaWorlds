import { Button, Dialog, Divider, Icon, IconButton, MenuBar, Spacer } from '@cocoaworlds/ui';
import { useState } from 'react';
import logo from '../assets/cocoaworlds-logo.svg';
import { t } from '../i18n';
import { useEditor } from '../store';

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+';

export function TopBar({ onShowKeys }: { onShowKeys: () => void }) {
  const s = useEditor();
  const session = s.session!;
  useEditor((x) => x.rev);
  const h = s.history;
  const status = s.saving ? t('status.saving') : s.dirty ? t('status.edited') : t('status.saved');

  const [asking, setAsking] = useState(false);
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
        {session.project.name} <span className="cw-crumb-sep">/</span> <b>{s.doc?.name}</b>
      </div>
      <div className="cw-status" data-testid="save-status">
        <span className={`cw-dot ${s.dirty ? 'warn' : 'ok'}`} />
        {status}
      </div>
      <Spacer />
      <IconButton icon="undo" label={t('edit.undo')} disabled={!h.canUndo} onClick={s.undo} />
      <IconButton icon="redo" label={t('edit.redo')} disabled={!h.canRedo} onClick={s.redo} />
      <Divider />
      <Button disabled title={t('soon')}>
        {t('build')}
      </Button>
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
