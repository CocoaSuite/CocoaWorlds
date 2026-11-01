/** Floating hint for the vertex tool. */
import { t } from '../i18n';

export function VertexPanel({ count, hasBrushes }: { count: number; hasBrushes: boolean }) {
  return (
    <div className="cw-brush-panel cw-tool-panel" role="group" aria-label={t('vertex.panel')} onPointerDown={(e) => e.stopPropagation()}>
      {hasBrushes && (
        <div className="cw-brush-row">
          <span className="cw-brush-k">{t('vertex.count')}</span>
          <span className="mono" data-testid="vertex-count">
            {count}
          </span>
        </div>
      )}
      <div className="cw-brush-hint">{hasBrushes ? t('vertex.hint') : t('vertex.hintNoSel')}</div>
    </div>
  );
}
