/** Floating panel for the clip tool: what to keep, apply, cancel. */
import { Button, Segmented } from '@cocoaworlds/ui';
import { t } from '../i18n';
import type { ClipKeep, ClipState } from './clip-tool';

export function ClipPanel({ state, keep, hasBrushes, onKeep, onApply, onCancel }: { state: ClipState | null; keep: ClipKeep; hasBrushes: boolean; onKeep: (k: ClipKeep) => void; onApply: () => void; onCancel: () => void }) {
  const hint = !hasBrushes ? t('clip.hintNoSel') : state?.ready ? t('clip.hintReady') : t('clip.hintNone');
  return (
    <div className="cw-brush-panel cw-tool-panel" role="group" aria-label={t('clip.panel')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cw-brush-row">
        <span className="cw-brush-k">{t('clip.keep')}</span>
        <Segmented<ClipKeep>
          label={t('clip.keep')}
          value={keep}
          onChange={onKeep}
          options={[
            { value: 'both', label: t('clip.both') },
            { value: 'front', label: t('clip.front') },
            { value: 'back', label: t('clip.back') },
          ]}
        />
        <div className="cw-sp" />
        <Button onClick={onCancel} disabled={!state}>
          {t('new.cancel')}
        </Button>
        <Button variant="primary" onClick={onApply} disabled={!state?.ready}>
          {t('clip.apply')}
        </Button>
      </div>
      <div className="cw-brush-hint">{hint}</div>
    </div>
  );
}
