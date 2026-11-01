/**
 * Floating panel for the brush tool: pick a shape and solid/subtract, read or type the exact size, then create.
 * The brief's workflow: choose type → draw footprint → set height → preview → confirm.
 */
import type { V3 } from '@cocoaworlds/geometry';
import { Button, NumberField, Segmented } from '@cocoaworlds/ui';
import type { BrushShape, Facing } from '../brush/brushes';
import { t } from '../i18n';
import { useEditor } from '../store';
import type { DraftState } from './brush-draft';

export function BrushPanel({ draft, onBounds, onCreate, onCancel }: { draft: DraftState | null; onBounds: (min: V3, max: V3) => void; onCreate: () => void; onCancel: () => void }) {
  const opts = useEditor((s) => s.brushOptions);
  const role = useEditor((s) => s.brushRole);
  const setOpts = useEditor((s) => s.setBrushOptions);
  const setRole = useEditor((s) => s.setBrushRole);
  const grid = useEditor((s) => (s.snap ? (s.session?.project.settings.gridSize ?? 16) : 1));

  const size = draft ? ([0, 1, 2].map((i) => draft.max[i]! - draft.min[i]!) as V3) : null;
  const setSize = (axis: number, v: number) => {
    if (!draft) return;
    const max = [...draft.max] as V3;
    max[axis] = draft.min[axis]! + Math.max(1, v);
    onBounds(draft.min, max);
  };
  const setOrigin = (axis: number, v: number) => {
    if (!draft) return;
    const d = v - draft.min[axis]!;
    const min = [...draft.min] as V3, max = [...draft.max] as V3;
    min[axis] = min[axis]! + d;
    max[axis] = max[axis]! + d;
    onBounds(min, max);
  };

  const ortho = useEditor((s) => s.view !== 'perspective');
  const hint = !draft
    ? t('brush.hintDraw')
    : draft.stage === 'footprint'
      ? t('brush.hintFootprint')
      : ortho
        ? t('brush.hintDepth')
        : t('brush.hintHeight');

  return (
    <div className="cw-brush-panel" role="group" aria-label={t('brush.panel')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cw-brush-row">
        <Segmented<BrushShape>
          label={t('brush.shape')}
          value={opts.shape}
          onChange={(shape) => setOpts({ shape })}
          options={[
            { value: 'box', label: t('brush.box') },
            { value: 'cylinder', label: t('brush.cylinder') },
            { value: 'wedge', label: t('brush.wedge') },
            { value: 'stairs', label: t('brush.stairs') },
          ]}
        />
        <Segmented<'solid' | 'subtract'>
          label={t('brush.role')}
          value={role}
          onChange={setRole}
          options={[
            { value: 'solid', label: t('brush.solid') },
            { value: 'subtract', label: t('brush.subtract') },
          ]}
        />
        {opts.shape === 'cylinder' && (
          <label className="cw-brush-opt">
            {t('brush.sides')}
            <span className="cw-brush-num">
              <NumberField label="#" ariaLabel={t('brush.sides')} value={opts.sides} step={1} onCommit={(v) => setOpts({ sides: Math.max(3, Math.min(64, Math.round(v))) })} />
            </span>
          </label>
        )}
        {opts.shape === 'stairs' && (
          <label className="cw-brush-opt">
            {t('brush.steps')}
            <span className="cw-brush-num">
              <NumberField label="#" ariaLabel={t('brush.steps')} value={opts.steps} step={1} onCommit={(v) => setOpts({ steps: Math.max(1, Math.min(64, Math.round(v))) })} />
            </span>
          </label>
        )}
        {(opts.shape === 'wedge' || opts.shape === 'stairs') && (
          <Segmented<string>
            label={t('brush.facing')}
            value={String(opts.facing)}
            onChange={(v) => setOpts({ facing: Number(v) as Facing })}
            options={[
              { value: '0', label: '+Z' },
              { value: '90', label: '+X' },
              { value: '180', label: '−Z' },
              { value: '270', label: '−X' },
            ]}
          />
        )}
      </div>
      <div className="cw-brush-row">
        {draft && size ? (
          <>
            <div className="cw-brush-dims" aria-label={t('brush.size')}>
              <span className="cw-brush-k">{t('brush.size')}</span>
              {(['x', 'y', 'z'] as const).map((a, i) => (
                <NumberField key={a} axis={a} label={a.toUpperCase()} ariaLabel={`${t('brush.size')} ${a.toUpperCase()}`} value={Math.abs(size[i]!)} step={grid} onCommit={(v) => setSize(i, v)} />
              ))}
            </div>
            <div className="cw-brush-dims" aria-label={t('brush.origin')}>
              <span className="cw-brush-k">{t('brush.origin')}</span>
              {(['x', 'y', 'z'] as const).map((a, i) => (
                <NumberField key={a} axis={a} label={a.toUpperCase()} ariaLabel={`${t('brush.origin')} ${a.toUpperCase()}`} value={draft.min[i]!} step={grid} onCommit={(v) => setOrigin(i, v)} />
              ))}
            </div>
            <div className="cw-sp" />
            <Button onClick={onCancel}>{t('new.cancel')}</Button>
            <Button variant="primary" disabled={draft.stage !== 'height'} onClick={onCreate}>
              {t('brush.create')}
            </Button>
          </>
        ) : (
          <span className="cw-brush-hint">{hint}</span>
        )}
      </div>
      {draft && <div className="cw-brush-hint">{hint}</div>}
    </div>
  );
}
