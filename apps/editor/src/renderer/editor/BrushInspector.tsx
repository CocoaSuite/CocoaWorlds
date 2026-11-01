/** Inspector for a selected brush: kind, exact size and centre, hollow, apply cut, and any problems. */
import type { EntityData } from '@cocoaworlds/core';
import { bounds, buildWorld, center, composeM4, polygons, transform, translate, validate, type V3 } from '@cocoaworlds/geometry';
import { Button, NumberField, Section, Segmented } from '@cocoaworlds/ui';
import { useState } from 'react';
import { brushOf, worldBrushes } from '../brush/brushes';
import { t } from '../i18n';
import { useEditor } from '../store';

const r = (n: number) => Math.round(n * 1000) / 1000;

export function BrushInspector({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  const doc = useEditor((x) => x.doc)!;
  useEditor((x) => x.rev);
  const grid = useEditor((x) => (x.snap ? (x.session?.project.settings.gridSize ?? 16) : 1));
  const [thickness, setThickness] = useState(16);
  const b = brushOf(e);
  if (!b) return null;
  const bb = bounds(b.brush);
  if (!bb) return null;
  const size = [0, 1, 2].map((i) => r(bb.max[i]! - bb.min[i]!)) as V3;
  const c = center(b.brush).map(r) as V3;
  const problems = validate(b.brush);
  const cutBy = b.role === 'solid' ? (buildWorld(worldBrushes(doc).filter((w) => w.id === e.id || w.role === 'subtract')).solids[0]?.cutBy ?? []) : [];

  /** Resize about the brush's minimum corner so it grows away from where it was drawn. */
  const resize = (axis: number, v: number, live: boolean) => {
    if (v <= 0) return;
    const k: V3 = [1, 1, 1];
    k[axis] = v / (size[axis] || 1);
    s.setBrush(e.id, transform(b.brush, composeM4([0, 0, 0], [0, 0, 0], k, bb.min)), live ? `size-${e.id}` : undefined, 'Resize brush');
  };
  const move = (axis: number, v: number, live: boolean) => {
    const d: V3 = [0, 0, 0];
    d[axis] = v - c[axis]!;
    if (d[axis] === 0) return;
    s.setBrush(e.id, translate(b.brush, d), live ? `move-${e.id}` : undefined, 'Move brush');
  };
  const begin = () => s.begin('Edit brush');
  const done = () => s.commit();

  return (
    <>
      <Section title={t('insp.brush')}>
        <div className="cw-f">
          <span>{t('insp.kind')}</span>
          <Segmented<'solid' | 'subtract'>
            label={t('insp.kind')}
            value={b.role}
            onChange={(role) => s.changeBrushRole(e.id, role)}
            options={[
              { value: 'solid', label: t('brush.solid') },
              { value: 'subtract', label: t('brush.subtract') },
            ]}
          />
        </div>
        <div className="cw-f3">
          <span>{t('insp.size')}</span>
          {(['x', 'y', 'z'] as const).map((a, i) => (
            <NumberField
              key={a}
              axis={a}
              label={a.toUpperCase()}
              ariaLabel={`${t('insp.size')} ${a.toUpperCase()}`}
              value={size[i]!}
              step={grid}
              onBegin={begin}
              onChange={(v) => resize(i, v, true)}
              onCommit={(v) => {
                resize(i, v, true);
                done();
              }}
            />
          ))}
        </div>
        <div className="cw-f3">
          <span>{t('insp.center')}</span>
          {(['x', 'y', 'z'] as const).map((a, i) => (
            <NumberField
              key={a}
              axis={a}
              label={a.toUpperCase()}
              ariaLabel={`${t('insp.center')} ${a.toUpperCase()}`}
              value={c[i]!}
              step={grid}
              onBegin={begin}
              onChange={(v) => move(i, v, true)}
              onCommit={(v) => {
                move(i, v, true);
                done();
              }}
            />
          ))}
        </div>
        <div className="cw-f">
          <span>{t('insp.faces')}</span>
          <span>{polygons(b.brush).length}</span>
        </div>
        {cutBy.length > 0 && (
          <div className="cw-f">
            <span>{t('insp.cutBy')}</span>
            <span>{cutBy.map((id) => doc.get(id)?.name ?? id).join(', ')}</span>
          </div>
        )}
      </Section>

      {b.role === 'solid' ? (
        <div className="cw-row cw-brush-actions">
          <label className="cw-brush-opt">
            {t('insp.thickness')}
            <span className="cw-brush-num">
              <NumberField label="u" ariaLabel={t('insp.thickness')} value={thickness} step={grid || 1} onCommit={(v) => setThickness(Math.max(1, v))} />
            </span>
          </label>
          <Button onClick={() => s.makeHollow(e.id, thickness)}>{t('insp.hollow')}</Button>
        </div>
      ) : (
        <>
          <p className="cw-hint">{t('insp.subtractHint')}</p>
          <Button onClick={() => s.applySubtract([e.id])}>{t('insp.applyCut')}</Button>
          <p className="cw-hint">{t('insp.applyCutHint')}</p>
        </>
      )}

      {problems.length > 0 && (
        <Section title={t('insp.problems')}>
          {problems.map((p) => (
            <p key={p} className="cw-error">
              {t(`brushProblem.${p}` as Parameters<typeof t>[0])}
            </p>
          ))}
        </Section>
      )}
    </>
  );
}

/** Shown when several brushes are selected. */
export function MultiBrushActions({ count }: { count: number }) {
  const s = useEditor.getState();
  return count >= 2 ? <Button onClick={s.mergeSelection}>{t('insp.merge')}</Button> : null;
}
