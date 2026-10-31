/** Project manager: create a project, open a folder, reopen a recent project. Mockup 04. */
import { Button, Dialog, Icon, ContextMenu } from '@cocoaworlds/ui';
import { useCallback, useEffect, useState } from 'react';
import type { RecentProject } from '../../shared/api';
import logo from '../assets/cocoaworlds-logo.svg';
import { t } from '../i18n';
import { useEditor } from '../store';

function useRecent() {
  const [items, setItems] = useState<RecentProject[]>([]);
  const reload = useCallback(() => {
    void window.cocoa.projects.recent().then(setItems);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { items, reload };
}

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString();
}

export function StartScreen() {
  const { items, reload } = useRecent();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; details?: string[] } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; dir: string } | null>(null);
  const openSession = useEditor((s) => s.openSession);
  const lang = useEditor((s) => s.lang);
  const setLang = useEditor((s) => s.setLang);

  const open = async (dir: string) => {
    const r = await window.cocoa.projects.open(dir);
    if (r.ok) openSession(r.value);
    else {
      setError({ title: t('error.open'), message: r.error, details: r.details });
      reload();
    }
  };

  const openFolder = async () => {
    const dir = await window.cocoa.projects.pickFolder(t('file.openProject'));
    if (dir) await open(dir);
  };

  return (
    <div className="cw-start">
      <aside className="cw-start-nav">
        <img src={logo} alt="CocoaWorlds" className="cw-start-logo" />
        <nav>
          <button type="button" className="on">
            <Icon name="folder" />
            {t('start.projects')}
          </button>
        </nav>
        <div className="cw-sp" />
        <div className="cw-start-foot">
          <div className="cw-seg" role="radiogroup" aria-label={t('view.language')}>
            <button type="button" role="radio" aria-checked={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
              English
            </button>
            <button type="button" role="radio" aria-checked={lang === 'ru'} className={lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>
              Русский
            </button>
          </div>
          <span>
            CocoaWorlds {window.cocoa.versions.app} · Electron {window.cocoa.versions.electron}
          </span>
        </div>
      </aside>

      <main className="cw-start-main cw-scroll">
        <div className="cw-start-head">
          <h1>{t('start.projects')}</h1>
          <div className="cw-sp" />
          <Button onClick={openFolder}>{t('start.open')}</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('start.new')}
          </Button>
        </div>

        <section>
          <div className="cw-start-label">{t('start.templates')}</div>
          <div className="cw-start-templates">
            <button type="button" className="cw-card" onClick={() => setCreating(true)}>
              <Icon name="plus" size={22} style={{ color: 'var(--cw-brand-hi)' }} />
              <b>{t('start.empty.title')}</b>
              <span>{t('start.empty.body')}</span>
            </button>
          </div>
        </section>

        <section>
          <div className="cw-start-label">{t('start.recent')}</div>
          {items.length === 0 ? (
            <div className="cw-empty">{t('start.noRecent')}</div>
          ) : (
            <div className="cw-start-recent">
              {items.map((r) => (
                <button
                  type="button"
                  key={r.dir}
                  className="cw-card cw-recent"
                  onClick={() => open(r.dir)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtx({ x: e.clientX, y: e.clientY, dir: r.dir });
                  }}
                >
                  <span className="cw-recent-thumb" aria-hidden="true">
                    <Icon name="cube" size={28} />
                  </span>
                  <span className="cw-recent-meta">
                    <b>{r.name}</b>
                    <span>{when(r.openedAt)}</span>
                  </span>
                  <span className="cw-recent-path">{r.dir}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      {creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(o) => {
            setCreating(false);
            openSession(o);
          }}
        />
      )}
      {error && (
        <Dialog title={error.title} onClose={() => setError(null)}>
          <p>{error.message}</p>
          {error.details?.length ? (
            <ul className="cw-err-list">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
          <div className="cw-actions">
            <Button variant="primary" onClick={() => setError(null)}>
              {t('close')}
            </Button>
          </div>
        </Dialog>
      )}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          items={[
            { label: t('file.reveal'), onSelect: () => void window.cocoa.projects.reveal(ctx.dir) },
            { label: t('start.forget'), onSelect: () => void window.cocoa.projects.forget(ctx.dir).then(reload) },
          ]}
        />
      )}
    </div>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (o: import('../../shared/api').OpenedProject) => void }) {
  const [name, setName] = useState('My Game');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void window.cocoa.projects.defaultLocation().then(setLocation);
  }, []);

  const folder = name.trim()
    ? name
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '') || 'untitled'
    : '';

  const create = async () => {
    if (!name.trim() || !location) return;
    setBusy(true);
    setError(null);
    const r = await window.cocoa.projects.create(location, name);
    setBusy(false);
    if (r.ok) onCreated(r.value);
    else setError(r.error);
  };

  return (
    <Dialog title={t('new.title')} onClose={onClose} width={480}>
      <form
        className="cw-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="cw-f">
          <span>{t('new.name')}</span>
          <input className="cw-input" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <div className="cw-f">
          <span>{t('new.location')}</span>
          <div className="cw-row">
            <input className="cw-input mono" aria-label={t('new.location')} value={location} onChange={(e) => setLocation(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            <Button
              onClick={async () => {
                const d = await window.cocoa.projects.pickFolder(t('new.location'), location);
                if (d) setLocation(d);
              }}
            >
              {t('new.browse')}
            </Button>
          </div>
        </div>
        {folder && location && (
          <p className="cw-hint">
            {t('new.willCreate')} <code>{`${location.replace(/[\\/]+$/, '')}/${folder}`}</code>
          </p>
        )}
        {error && <p className="cw-error">{error}</p>}
        <div className="cw-actions">
          <Button onClick={onClose}>{t('new.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim() || !location}>
            {t('new.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
