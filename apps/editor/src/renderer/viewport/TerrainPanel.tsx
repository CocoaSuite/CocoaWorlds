/**
 * The Terrain tool's options (T1): what the brush does, its size and strength, and the layer it paints with.
 * Drag on a terrain to shape it; each stroke is one undo step.
 */
import { readComponent, type TerrainData } from '@cocoaworlds/core';
import { Segmented } from '@cocoaworlds/ui';
import { Slider } from '../editor/MaterialsPanel';
import { t } from '../i18n';
import { useEditor, type TerrainBrush } from '../store';

const MODES: TerrainBrush['mode'][] = ['raise', 'lower', 'smooth', 'flatten', 'dig', 'fill', 'paint'];

export function TerrainPanel() {
  const b = useEditor((s) => s.terrainBrush);
  const set = useEditor((s) => s.setTerrainBrush);
  // The layer colours of the selected terrain (or the scene's first).
  const layers = useEditor((s) => {
    const doc = s.doc;
    const e = doc?.entities.find((x) => s.selection.includes(x.id) && x.components.terrain) ?? doc?.entities.find((x) => x.components.terrain);
    if (!e) return null;
    const d = readComponent<TerrainData>('terrain', e.components.terrain);
    return `${d.layer0},${d.layer1},${d.layer2},${d.layer3}`;
  });
  return (
    <div className="cw-brush-panel cw-terrain-panel" role="group" aria-label={t('terrain.panel')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cw-brush-row">
        <Segmented label={t('terrain.mode')} value={b.mode} onChange={(mode) => set({ mode })} options={MODES.map((m) => ({ value: m, label: t(`terrain.${m}`) }))} />
      </div>
      <div className="cw-brush-row cw-terrain-sliders">
        <span className="cw-brush-k">{t('terrain.size')}</span>
        <Slider label={t('terrain.size')} value={b.radius} min={16} max={512} step={8} digits={0} onChange={(radius) => set({ radius })} />
        <span className="cw-brush-k">{t('terrain.strength')}</span>
        <Slider label={t('terrain.strength')} value={b.strength} min={0.05} max={1} step={0.05} onChange={(strength) => set({ strength })} />
      </div>
      {b.mode === 'paint' && (
        <div className="cw-brush-row" role="radiogroup" aria-label={t('terrain.layer')}>
          <span className="cw-brush-k">{t('terrain.layer')}</span>
          {(layers?.split(',') ?? ['#5f8f3a', '#8a6a45', '#8c8c8c', '#d9c58a']).map((c, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={b.layer === i}
              aria-label={t('terrain.layerN').replace('{n}', String(i + 1))}
              className={`cw-terrain-layer${b.layer === i ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => set({ layer: i })}
            />
          ))}
        </div>
      )}
      <div className="cw-brush-hint">{layers ? t('terrain.hint') : t('terrain.none')}</div>
    </div>
  );
}
