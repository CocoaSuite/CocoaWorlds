/** Inspector for the selection (CocoaCanvas right panel). Scene settings when nothing is selected. */
import type { EntityData, Transform, Vec3 } from '@cocoaworlds/core';
import { Field, NumberField, PanelHeader, Section, Switch } from '@cocoaworlds/ui';
import { t } from '../i18n';
import { useSelectedEntities, useEditor } from '../store';

export function Inspector() {
  useEditor((s) => s.rev);
  const sel = useSelectedEntities();
  const kind = sel.length === 1 ? componentLabel(sel[0]!) : sel.length > 1 ? `${sel.length}` : '';
  return (
    <aside className="cw-side cw-right" aria-label={t('insp.title')}>
      <PanelHeader title={t('insp.title')}>{kind && <span className="cw-ph-note">{kind}</span>}</PanelHeader>
      <div className="cw-insp cw-scroll">
        {sel.length === 0 && <SceneSettings />}
        {sel.length === 1 && <EntityInspector e={sel[0]!} />}
        {sel.length > 1 && (
          <p className="cw-empty">
            {sel.length} {t('insp.multi')}
          </p>
        )}
      </div>
    </aside>
  );
}

function componentLabel(e: EntityData): string {
  const light = e.components.light as { kind?: string } | undefined;
  if (light) return `${light.kind ?? ''} light`;
  if (e.components.playerSpawn) return 'Player spawn';
  return 'Object';
}

function SceneSettings() {
  const doc = useEditor((s) => s.doc)!;
  return (
    <>
      <p className="cw-empty" style={{ padding: 0 }}>
        {t('insp.nothing')}
      </p>
      <Section title={t('insp.sceneSettings')}>
        <Field label={t('insp.name')}>
          <span>{doc.name}</span>
        </Field>
        <Field label={t('insp.ambient')}>
          <span className="cw-swatch-row">
            <span className="cw-swatch" style={{ background: doc.settings.ambientColor }} />
            <code>{doc.settings.ambientColor}</code>
          </span>
        </Field>
        <Field label={t('insp.background')}>
          <span className="cw-swatch-row">
            <span className="cw-swatch" style={{ background: doc.settings.backgroundColor }} />
            <code>{doc.settings.backgroundColor}</code>
          </span>
        </Field>
        <Field label={t('insp.gravity')}>
          <code>{doc.settings.gravity} u/s²</code>
        </Field>
      </Section>
    </>
  );
}

function Vec3Row({ label, value, step, onCommit, onLive, onBegin, name }: { label: string; name: string; value: Vec3; step: number; onBegin: () => void; onLive: (v: Vec3) => void; onCommit: (v: Vec3) => void }) {
  const axes = ['x', 'y', 'z'] as const;
  return (
    <div className="cw-f3">
      <span>{label}</span>
      {axes.map((a, i) => (
        <NumberField
          key={a}
          axis={a}
          label={a.toUpperCase()}
          ariaLabel={`${name} ${a.toUpperCase()}`}
          step={step}
          value={value[i]!}
          onBegin={onBegin}
          onChange={(v) => {
            const n = [...value] as Vec3;
            n[i] = v;
            onLive(n);
          }}
          onCommit={(v) => {
            const n = [...value] as Vec3;
            n[i] = v;
            onCommit(n);
          }}
        />
      ))}
    </div>
  );
}

function EntityInspector({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  const grid = useEditor((x) => (x.snap ? (x.session?.project.settings.gridSize ?? 16) : 1));
  const tr = e.transform;
  const key = `insp-${e.id}`;
  const setPart = (part: keyof Transform, v: Vec3, live: boolean) => {
    const next: Transform = { ...tr, [part]: v };
    s.setTransform(e.id, next, live ? `${key}-${part}` : undefined);
  };
  const begin = () => s.begin('Move');
  const end = (part: keyof Transform) => (v: Vec3) => {
    setPart(part, v, true);
    s.commit();
  };

  return (
    <>
      <input
        className="cw-input"
        aria-label={t('insp.name')}
        key={`${e.id}-${e.name}`}
        defaultValue={e.name}
        onKeyDown={(ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') ev.currentTarget.blur();
        }}
        onBlur={(ev) => s.rename(e.id, ev.currentTarget.value)}
      />
      <Section title={t('insp.transform')}>
        <Vec3Row label={t('insp.position')} name="Position" value={tr.position} step={grid} onBegin={begin} onLive={(v) => setPart('position', v, true)} onCommit={end('position')} />
        <Vec3Row label={t('insp.rotation')} name="Rotation" value={tr.rotation} step={1} onBegin={begin} onLive={(v) => setPart('rotation', v, true)} onCommit={end('rotation')} />
        <Vec3Row label={t('insp.scale')} name="Scale" value={tr.scale} step={0.05} onBegin={begin} onLive={(v) => setPart('scale', v, true)} onCommit={end('scale')} />
      </Section>
      <Section title={t('insp.display')}>
        <div className="cw-flagrow">
          <span>{t('insp.visible')}</span>
          <Switch label={t('insp.visible')} checked={e.visible} onChange={(v) => s.setFlag(e.id, 'visible', v)} />
        </div>
        <div className="cw-flagrow">
          <span>{t('insp.locked')}</span>
          <Switch label={t('insp.locked')} checked={e.locked} onChange={(v) => s.setFlag(e.id, 'locked', v)} />
        </div>
      </Section>
      <Section title={t('insp.components')}>
        {Object.keys(e.components).length === 0 && <span className="cw-muted">—</span>}
        {Object.entries(e.components).map(([name, data]) => (
          <div key={name} className="cw-comp">
            <b>{name}</b>
            {Object.entries(data).map(([k, v]) => (
              <div key={k} className="cw-f">
                <span>{k}</span>
                <code>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</code>
              </div>
            ))}
          </div>
        ))}
      </Section>
    </>
  );
}
