/** Export and import of materials (Materials workspace): the menu items and the images dialog. */
import type { MaterialDef } from '@cocoaworlds/core';
import { OUTPUT_ROLES, outputNodes, withOverrides, type OutputRole } from '@cocoaworlds/materials';
import { Button, Dialog, Segmented, Switch, type MenuEntry } from '@cocoaworlds/ui';
import { useMemo, useState } from 'react';
import { MAP_FIELDS } from '@cocoaworlds/core';
import { t, type Key } from '../i18n';
import { exportCocoaMats, exportImages, type ImageOptions } from '../materials/export';
import { context, useGraphs } from '../materials/graphs';
import { useEditor } from '../store';

const done = (files: string[]) => {
  if (files.length) useEditor.getState().notify(t('mex.done').replace('{n}', String(files.length)));
};
const failed = (e: unknown) => {
  const st = useEditor.getState();
  st.log('error', 'Materials', (e as Error).message);
  st.notify(`${t('mex.failed')}: ${(e as Error).message}`);
};

export function exportItems(ms: MaterialDef[], openImages: () => void): MenuEntry[] {
  const graphs = ms.filter((m) => m.graph);
  return [
    {
      label: t('mex.cocoamat'),
      disabled: !graphs.length,
      hint: graphs.length ? undefined : t('mex.onlyGraphs'),
      onSelect: () => void exportCocoaMats(graphs).then(done, failed),
    },
    { label: t('mex.images'), disabled: !ms.length, onSelect: openImages },
  ];
}

/** Which maps the materials make. */
function rolesOf(ms: MaterialDef[]): OutputRole[] {
  const graphs = useGraphs.getState().graphs;
  const out = new Set<OutputRole>();
  for (const m of ms) {
    const g = m.graph ? graphs[m.graph] : undefined;
    if (g) for (const r of outputNodes(withOverrides(g, m.overrides)).keys()) out.add(r);
    else for (const r of OUTPUT_ROLES) if (m[MAP_FIELDS[r]]) out.add(r);
  }
  return OUTPUT_ROLES.filter((r) => out.has(r));
}

const ROLE_KEY: Record<OutputRole, Key> = {
  color: 'mex.r.color',
  height: 'mex.r.height',
  normal: 'mex.r.normal',
  roughness: 'mex.r.roughness',
  metalness: 'mex.r.metalness',
  occlusion: 'mex.r.occlusion',
  glow: 'mex.r.glow',
  opacity: 'mex.r.opacity',
  wearColor: 'mex.r.wearColor',
  wearRoughness: 'mex.r.wearRoughness',
  wearMetal: 'mex.r.wearMetal',
  wearNoise: 'mex.r.wearNoise',
};

export function ImagesDialog({ ms, onClose }: { ms: MaterialDef[]; onClose: () => void }) {
  const roles = useMemo(() => rolesOf(ms), [ms]);
  const sizes = useMemo(() => {
    let max = 2048;
    try {
      max = context().getParameter(context().MAX_TEXTURE_SIZE) as number;
    } catch {
      /* ignore */
    }
    return [256, 512, 1024, 2048, 4096].filter((s) => s <= max);
  }, []);
  const [size, setSize] = useState(String(Math.min(2048, ms[0]?.bakeSize ?? 1024)));
  const [green, setGreen] = useState<ImageOptions['green']>('down');
  const [orm, setOrm] = useState(false);
  const [want, setWant] = useState<Set<OutputRole>>(() => new Set(roles));
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      done(await exportImages(ms, { size: Number(size), green, orm, roles: want.size === roles.length ? undefined : [...want] }));
      onClose();
    } catch (e) {
      failed(e);
      setBusy(false);
    }
  };
  return (
    <Dialog title={t('mex.imagesTitle')} onClose={() => !busy && onClose()} width={420}>
      <p className="cw-hint">{ms.length === 1 ? ms[0]!.name : t('mex.several').replace('{n}', String(ms.length))}</p>
      <div className="cw-form">
        <label className="cw-f">
          <span>{t('mex.size')}</span>
          <select className="cw-input" aria-label={t('mex.size')} value={size} disabled={busy} onChange={(e) => setSize(e.currentTarget.value)}>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s} × {s}
              </option>
            ))}
          </select>
        </label>
        <div className="cw-f">
          <span>{t('mex.green')}</span>
          <Segmented<ImageOptions['green']>
            label={t('mex.green')}
            value={green}
            onChange={setGreen}
            options={[
              { value: 'down', label: t('mex.greenDown') },
              { value: 'up', label: t('mex.greenUp') },
            ]}
          />
        </div>
        <label className="cw-screens-sw" title={t('mex.ormHint')}>
          <Switch label={t('mex.orm')} checked={orm} onChange={setOrm} />
          {t('mex.orm')}
        </label>
        <fieldset className="cw-mex-maps" aria-label={t('mex.maps')}>
          <legend>{t('mex.maps')}</legend>
          {roles.map((r) => (
            <label key={r}>
              <input
                type="checkbox"
                checked={want.has(r)}
                disabled={busy}
                onChange={(e) => {
                  const next = new Set(want);
                  if (e.currentTarget.checked) next.add(r);
                  else next.delete(r);
                  setWant(next);
                }}
              />
              {t(ROLE_KEY[r])}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="cw-actions">
        <Button disabled={busy} onClick={onClose}>
          {t('new.cancel')}
        </Button>
        <Button variant="primary" disabled={busy || (!want.size && !orm)} onClick={() => void go()}>
          {busy ? t('mex.working') : t('mex.export')}
        </Button>
      </div>
    </Dialog>
  );
}
