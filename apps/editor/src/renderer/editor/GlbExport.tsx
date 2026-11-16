/** Export the selected brushes and groups as a `.glb` (Edit menu, scene tree and view right-click menus). */
import { Button, Dialog, Segmented, Switch } from '@cocoaworlds/ui';
import { useMemo, useState } from 'react';
import { getLang, t } from '../i18n';
import { useEditor } from '../store';
import { DEFAULT_GLB_OPTIONS, exportGlb, exportedBrushIds, glbFileName, type GlbOptions } from '../viewport/glb-export';
import { materialLabel } from '../viewport/project-materials';

let last: GlbOptions = DEFAULT_GLB_OPTIONS;

export function GlbExportDialog() {
  const open = useEditor((s) => s.dialog === 'exportGlb');
  if (!open) return null;
  return <GlbExportForm />;
}

function GlbExportForm() {
  const s = useEditor.getState();
  const doc = useEditor((x) => x.doc);
  const selection = useEditor((x) => x.selection);
  const session = useEditor((x) => x.session);
  const count = useMemo(() => (doc ? exportedBrushIds(doc, selection).length : 0), [doc, selection]);
  const sceneName = session?.scenePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'brushes';
  const [name, setName] = useState(() => (doc ? glbFileName(doc, selection, sceneName) : 'brushes.glb'));
  const [opts, setOpts] = useState<GlbOptions>(last);
  const [busy, setBusy] = useState(false);
  const close = () => s.openDialog(null);
  const set = (p: Partial<GlbOptions>) => setOpts((o) => (last = { ...o, ...p }));
  const fileName = () => {
    const n = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_') || 'brushes';
    return /\.glb$/i.test(n) ? n : `${n}.glb`;
  };

  const run = async (to: 'file' | 'project') => {
    if (!doc) return;
    setBusy(true);
    try {
      const lang = getLang();
      const bytes = await exportGlb(doc, selection, opts, (m) => materialLabel(m, lang));
      if (to === 'file') {
        const r = await window.cocoa.models.saveFile(fileName(), bytes);
        if (!r.ok) throw new Error(r.error);
        if (r.value === null) return; // cancelled: leave the dialog open
        s.log('info', 'Export', `Wrote ${count} brushes to ${r.value}`);
        s.notify(t('glb.saved').replace('{path}', r.value));
      } else {
        const added = await s.importAssets('models', [new File([bytes as BlobPart], fileName())]);
        if (!added.length) return;
        s.notify(t('glb.added').replace('{path}', added[0]!));
      }
      close();
    } catch (e) {
      s.log('error', 'Export', (e as Error).message);
      s.notify(`${t('glb.failed')}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('glb.title')} onClose={close}>
      <p className="cw-hint">{t('glb.body')}</p>
      {count ? (
        <div className="cw-form">
          <p className="cw-hint" data-testid="glb-count">{t('glb.count').replace('{n}', String(count))}</p>
          <label className="cw-f">
            <span>{t('glb.name')}</span>
            <input className="cw-input" aria-label={t('glb.name')} value={name} disabled={busy} onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <div className="cw-f">
            <span>{t('glb.units')}</span>
            <Segmented<GlbOptions['units']>
              label={t('glb.units')}
              value={opts.units}
              onChange={(units) => set({ units })}
              options={[
                { value: 'metres', label: t('glb.metres') },
                { value: 'units', label: t('glb.gameUnits') },
              ]}
            />
          </div>
          <div className="cw-f">
            <span>{t('glb.origin')}</span>
            <Segmented<GlbOptions['origin']>
              label={t('glb.origin')}
              value={opts.origin}
              onChange={(origin) => set({ origin })}
              options={[
                { value: 'selection', label: t('glb.originSel') },
                { value: 'scene', label: t('glb.originScene') },
              ]}
            />
          </div>
          <label className="cw-screens-sw">
            <Switch label={t('glb.merge')} checked={opts.merge} onChange={(merge) => set({ merge })} />
            {t('glb.merge')}
          </label>
        </div>
      ) : (
        <p className="cw-hint" role="alert">{t('glb.none')}</p>
      )}
      <div className="cw-actions">
        <Button disabled={busy} onClick={close}>
          {t('new.cancel')}
        </Button>
        {count > 0 && (
          <>
            <Button disabled={busy} onClick={() => void run('project')}>
              {t('glb.toProject')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void run('file')}>
              {t('glb.save')}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
