/**
 * Inspector for the face tool: material and texture alignment of the selected faces. With several faces
 * selected, a field shows a value when they all agree; typing a value sets it on every selected face.
 */
import type { FaceSurface } from '@cocoaworlds/geometry';
import { Button, NumberField, Section, Segmented } from '@cocoaworlds/ui';
import { brushOf } from '../brush/brushes';
import { materialLabel } from '../viewport/project-materials';
import { getLang, t } from '../i18n';
import { useEditor, type Justify } from '../store';
import { MaterialPicker } from './MaterialPicker';

const r = (n: number) => Math.round(n * 10000) / 10000;

export function FaceInspector() {
  useEditor((x) => x.rev);
  const refs = useEditor((x) => x.faceSelection);
  const doc = useEditor((x) => x.doc);
  const s = useEditor.getState();

  const surfaces: FaceSurface[] = [];
  if (doc) for (const ref of refs) {
    const f = brushOf(doc.get(ref.id))?.brush.faces[ref.face];
    if (f) surfaces.push(f.surface);
  }

  if (!surfaces.length) {
    return (
      <Section title={t('face.title')}>
        <p className="cw-hint">{t('face.none')}</p>
      </Section>
    );
  }

  /** The shared value of a field, or null when the selected faces differ. */
  const common = <T,>(get: (f: FaceSurface) => T): T | null => {
    const first = get(surfaces[0]!);
    return surfaces.every((f) => get(f) === first) ? first : null;
  };
  const material = common((f) => f.material);
  const align = common((f) => f.align);
  const num = (get: (f: FaceSurface) => number) => common((f) => r(get(f)));

  const field = (key: string, label: string, aria: string, value: number | null, step: number, apply: (v: number) => void) => (
    <NumberField
      key={key}
      label={label}
      ariaLabel={aria}
      value={value ?? NaN}
      step={step}
      onBegin={() => s.begin(t('face.title'))}
      onChange={(v) => apply(v)}
      onCommit={(v) => {
        apply(v);
        s.commit();
      }}
    />
  );
  const mk = (k: string) => `face-${k}`;
  const materialName = material ? materialLabel(material, getLang()) : t('face.mixed');
  const justify: { side: Justify; label: string }[] = [
    { side: 'left', label: t('face.left') },
    { side: 'right', label: t('face.right') },
    { side: 'top', label: t('face.top') },
    { side: 'bottom', label: t('face.bottom') },
    { side: 'center', label: t('face.center') },
  ];

  return (
    <>
      <Section title={t('face.title')}>
        <div className="cw-f">
          <span>{t('face.count')}</span>
          <span data-testid="face-count">{surfaces.length}</span>
        </div>
        <div className="cw-f">
          <span>{t('face.material')}</span>
          <span className="mono" data-testid="face-material">{materialName}</span>
        </div>
        <MaterialPicker label={t('face.material')} value={material} onChange={(m) => s.setFaces({ material: m }, undefined, 'Set material')} />
      </Section>
      <Section title={t('face.align')}>
        <div className="cw-f">
          <span>{t('face.align')}</span>
          <Segmented<FaceSurface['align'] | ''>
            label={t('face.align')}
            value={align ?? ''}
            onChange={(a) => a && s.setFaces({ align: a }, undefined, 'Texture alignment')}
            options={[
              { value: 'world', label: t('face.world') },
              { value: 'face', label: t('face.faceAlign') },
            ]}
          />
        </div>
        <div className="cw-f2">
          <span>{t('face.offset')}</span>
          {field('ou', 'U', `${t('face.offset')} U`, num((f) => f.offset[0]), 1, (v) => s.setFaces({ offset: [v, undefined] }, mk('ou')))}
          {field('ov', 'V', `${t('face.offset')} V`, num((f) => f.offset[1]), 1, (v) => s.setFaces({ offset: [undefined, v] }, mk('ov')))}
        </div>
        <div className="cw-f2">
          <span>{t('face.scale')}</span>
          {field('su', 'U', `${t('face.scale')} U`, num((f) => f.scale[0]), 0.05, (v) => s.setFaces({ scale: [v, undefined] }, mk('su')))}
          {field('sv', 'V', `${t('face.scale')} V`, num((f) => f.scale[1]), 0.05, (v) => s.setFaces({ scale: [undefined, v] }, mk('sv')))}
        </div>
        <div className="cw-f">
          <span>{t('face.rotation')}</span>
          {field('rot', '°', t('face.rotation'), num((f) => f.rotation), 15, (v) => s.setFaces({ rotation: ((v % 360) + 360) % 360 }, mk('rot')))}
        </div>
        <p className="cw-hint">{t('face.alignHint')}</p>
        <div className="cw-row cw-face-actions">
          <Button onClick={() => s.fitFaces()}>{t('face.fit')}</Button>
          <Button onClick={() => s.hotspotFaces()}>{t('face.hotspot')}</Button>
          <Button onClick={() => s.setFaces({ offset: [0, 0], scale: [0.25, 0.25], rotation: 0 }, undefined, 'Reset texture')}>{t('face.reset')}</Button>
          <Button onClick={() => s.selectAllFaces()}>{t('face.selectAll')}</Button>
        </div>
        <div className="cw-f">
          <span>{t('face.justify')}</span>
          <div className="cw-row cw-face-justify">
            {justify.map((j) => (
              <Button key={j.side} onClick={() => s.justifyFaces(j.side)}>
                {j.label}
              </Button>
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}
