/** Inspector for a selected brush: kind, exact size and centre, hollow, apply cut, and any problems. */
import { shown, storedAxis } from '../axes';
import type { Vec3 } from '@cocoaworlds/core';
import type { EntityData } from '@cocoaworlds/core';
import { bevelBrush, bounds, buildWorld, center, composeM4, polygons, transform, translate, validate, type V3 } from '@cocoaworlds/geometry';
import { Button, NumberField, Section, Segmented } from '@cocoaworlds/ui';
import { useState } from 'react';
import { worldBrushOf, worldBrushes } from '../brush/brushes';
import { t } from '../i18n';
import { useEditor } from '../store';

const r = (n: number) => Math.round(n * 1000) / 1000;

export function BrushInspector({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  const doc = useEditor((x) => x.doc)!;
  useEditor((x) => x.rev);
  const grid = useEditor((x) => (x.snap ? (x.session?.project.settings.gridSize ?? 16) : 1));
  const [thickness, setThickness] = useState(16);
  // (Shown Z-up when set; kept Y-up.)
  const zUp = useEditor((x) => x.zUp);
  const [hollowDir, setHollowDir] = useState<'inward' | 'outward'>('inward');
  const [bevel, setBevel] = useState(8);
  const [segments, setSegments] = useState(3);
  // Sizes and centres are shown and edited in world space.
  const b = worldBrushOf(doc, e);
  const trigger = !!e.components.trigger;
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
    s.moveBrush(e.id, d);
  };
  const begin = () => s.begin('Edit brush');
  const done = () => s.commit();

  return (
    <>
      <Section title={t('insp.brush')}>
        {trigger ? (
          <p className="cw-hint">{t('insp.triggerHint')}</p>
        ) : (
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
        )}
        <div className="cw-f3">
          <span>{t('insp.size')}</span>
          {(['x', 'y', 'z'] as const).map((a, i) => (
            <NumberField
              key={a}
              axis={a}
              label={a.toUpperCase()}
              ariaLabel={`${t('insp.size')} ${a.toUpperCase()}`}
              value={shown(size as Vec3, 'size', zUp)[i]!}
              step={grid}
              onBegin={begin}
              onChange={(v) => resize(storedAxis(i, 'size', zUp).i, v, true)}
              onCommit={(v) => {
                resize(storedAxis(i, 'size', zUp).i, v, true);
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
              value={shown(c as Vec3, 'point', zUp)[i]!}
              step={grid}
              onBegin={begin}
              onChange={(v) => move(storedAxis(i, 'point', zUp).i, v * storedAxis(i, 'point', zUp).sign, true)}
              onCommit={(v) => {
                move(storedAxis(i, 'point', zUp).i, v * storedAxis(i, 'point', zUp).sign, true);
                done();
              }}
            />
          ))}
        </div>
        <div className="cw-f">
          <span>{t('insp.faces')}</span>
          <span>{polygons(b.brush).length}</span>
        </div>
        {b.brush.mesh && (
          <>
            <div className="cw-f">
              <span>{t('insp.mesh')}</span>
              <span>{b.brush.mesh.verts.length} {t('insp.corners')}</span>
            </div>
            <p className="cw-hint">{t('insp.meshHint')}</p>
          </>
        )}
        {cutBy.length > 0 && (
          <div className="cw-f">
            <span>{t('insp.cutBy')}</span>
            <span>{cutBy.map((id) => doc.get(id)?.name ?? id).join(', ')}</span>
          </div>
        )}
      </Section>

      {trigger || b.brush.mesh ? null : b.role === 'solid' ? (
        <>
          <div className="cw-f">
            <span>{t('insp.hollowDir')}</span>
            <Segmented<'inward' | 'outward'>
              label={t('insp.hollowDir')}
              value={hollowDir}
              onChange={setHollowDir}
              options={[
                { value: 'inward', label: t('insp.inward') },
                { value: 'outward', label: t('insp.outward') },
              ]}
            />
          </div>
          <div className="cw-row cw-brush-actions">
            <label className="cw-brush-opt">
              {t('insp.thickness')}
              <span className="cw-brush-num">
                <NumberField label="u" ariaLabel={t('insp.thickness')} value={thickness} step={grid || 1} onCommit={(v) => setThickness(Math.max(1, v))} />
              </span>
            </label>
            <Button onClick={() => s.makeHollow(e.id, thickness, hollowDir)}>{t('insp.hollow')}</Button>
          </div>
          <p className="cw-hint">{t(hollowDir === 'inward' ? 'insp.inwardHint' : 'insp.outwardHint')}</p>
          {!b.brush.mesh && (
            <div className="cw-row cw-brush-actions">
              <label className="cw-brush-opt">
                {t('insp.bevelRadius')}
                <span className="cw-brush-num">
                  <NumberField label="u" ariaLabel={t('insp.bevelRadius')} value={bevel} step={1} onCommit={(v) => setBevel(Math.max(0.5, v))} />
                </span>
              </label>
              <label className="cw-brush-opt">
                {t('insp.bevelSegments')}
                <span className="cw-brush-num">
                  <NumberField label="#" ariaLabel={t('insp.bevelSegments')} value={segments} step={1} onCommit={(v) => setSegments(Math.max(1, Math.min(12, Math.round(v))))} />
                </span>
              </label>
              <Button onClick={() => s.setBrush(e.id, bevelBrush(b.brush, bevel, segments), undefined, 'Bevel edges')}>{t('insp.bevel')}</Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="cw-hint">{t('insp.subtractHint')}</p>
          <CutsOnly id={e.id} />
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

/** A subtract brush: cut everything it touches, or only the brushes chosen here. */
function CutsOnly({ id }: { id: string }) {
  const doc = useEditor((x) => x.doc);
  useEditor((x) => x.rev);
  const s = useEditor.getState();
  const e = doc?.get(id);
  if (!doc || !e) return null;
  const only = (e.components.cuts as { only?: string } | undefined)?.only;
  const chosen = only ? only.split(',').filter(Boolean) : [];
  const solids = doc.entities.filter((x) => x.id !== id && (x.components.brush as { role?: string } | undefined)?.role === 'solid');
  const set = (ids: string[]) => s.setComponentField(id, 'cuts', 'only', ids.join(','));
  return (
    <div className="cw-cuts" role="group" aria-label={t('insp.cuts')}>
      <div className="cw-f">
        <span>{t('insp.cuts')}</span>
        <Segmented<'all' | 'only'>
          label={t('insp.cuts')}
          value={only === undefined ? 'all' : 'only'}
          onChange={(v) => (v === 'all' ? s.removeComponent(id, 'cuts') : s.addComponent(id, 'cuts'))}
          options={[
            { value: 'all', label: t('insp.cutsAll') },
            { value: 'only', label: t('insp.cutsOnly') },
          ]}
        />
      </div>
      {only !== undefined && (
        <>
          <div className="cw-cuts-list">
            {chosen.map((c) => (
              <span key={c} className="cw-cuts-chip">
                {doc.get(c)?.name ?? c}
                <button type="button" aria-label={`${t('insp.cutsRemove')} ${doc.get(c)?.name ?? c}`} onClick={() => set(chosen.filter((x) => x !== c))}>
                  ×
                </button>
              </span>
            ))}
            {!chosen.length && <span className="cw-hint">{t('insp.cutsNone')}</span>}
          </div>
          <select className="cw-input" aria-label={t('insp.cutsAdd')} value="" onChange={(ev) => ev.currentTarget.value && set([...chosen, ev.currentTarget.value])}>
            <option value="">{t('insp.cutsAdd')}</option>
            {solids
              .filter((x) => !chosen.includes(x.id))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </>
      )}
    </div>
  );
}
