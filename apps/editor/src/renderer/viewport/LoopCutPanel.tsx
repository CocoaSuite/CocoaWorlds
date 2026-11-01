/** Floating panel for the loop cut tool: how many cuts, and what the cursor is over. */
import { NumberField } from '@cocoaworlds/ui';
import { t } from '../i18n';

export function LoopCutPanel({ cuts, fits, onCuts }: { cuts: number; fits: boolean | null; onCuts: (n: number) => void }) {
  return (
    <div className="cw-brush-panel cw-tool-panel" role="group" aria-label={t('tool.loopcut')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cw-brush-row">
        <span className="cw-brush-k">{t('loopcut.count')}</span>
        <span className="cw-brush-num">
          <NumberField label="#" ariaLabel={t('loopcut.count')} value={cuts} step={1} onCommit={(v) => onCuts(v)} />
        </span>
      </div>
      <div className="cw-brush-hint" data-testid="loopcut-hint">
        {fits === false ? t('loopcut.none') : t('loopcut.hint')}
      </div>
    </div>
  );
}
