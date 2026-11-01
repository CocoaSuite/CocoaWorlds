/** Floating panel for the paint tool: choose a material, then click faces in the view. */
import { devMaterial } from '../brush/materials';
import { MaterialPicker } from '../editor/MaterialPicker';
import { getLang, t } from '../i18n';
import { useEditor } from '../store';

export function PaintPanel() {
  const material = useEditor((s) => s.paintMaterial);
  const setMaterial = useEditor((s) => s.setPaintMaterial);
  return (
    <div className="cw-brush-panel cw-paint-panel" role="group" aria-label={t('paint.panel')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cw-brush-row">
        <span className="cw-brush-k">{t('face.material')}</span>
        <span className="mono" data-testid="paint-material">{devMaterial(material)?.label[getLang()] ?? material}</span>
      </div>
      <MaterialPicker label={t('face.material')} value={material} onChange={setMaterial} />
      <div className="cw-brush-hint">{t('paint.hint')}</div>
    </div>
  );
}
