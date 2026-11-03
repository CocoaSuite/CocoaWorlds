/** The Paint tool's material library (in the Inspector while painting): choose a material, then click faces. */
import { materialLabel } from './project-materials';
import { MaterialPicker } from '../editor/MaterialPicker';
import { getLang, t } from '../i18n';
import { useEditor } from '../store';

export function PaintPanel() {
  const material = useEditor((s) => s.paintMaterial);
  const setMaterial = useEditor((s) => s.setPaintMaterial);
  return (
    <div className="cw-paint-side" role="group" aria-label={t('paint.panel')}>
      <span className="cw-sr" data-testid="paint-material">
        {materialLabel(material, getLang())}
      </span>
      <MaterialPicker label={t('face.material')} value={material} onChange={setMaterial} />
      <div className="cw-brush-hint">{t('paint.hint')}</div>
    </div>
  );
}
