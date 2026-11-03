/**
 * Bevel (vertex tool, Ctrl+B): while dragging, what it's set to and the keys; once made, the width, segments and
 * profile stay adjustable (as Blender's “Adjust last operation”).
 */
import { NumberField } from '@cocoaworlds/ui';
import { Slider } from '../editor/MaterialsPanel';
import { getLang } from '../i18n';
import type { BevelInfo } from './engine';

const L = (en: string, ru: string) => (getLang() === 'ru' ? ru : en);

export function BevelPanel({ info, onAdjust }: { info: BevelInfo; onAdjust: (p: { width?: number; segments?: number; profile?: number }) => void }) {
  const label = L('Bevel', 'Фаска');
  return (
    <div className="cw-brush-panel cw-tool-panel" role="group" aria-label={label} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cw-brush-row">
        <strong>{label}</strong>
      </div>
      {info.live ? (
        <>
          <div className="cw-brush-row mono" data-testid="bevel-live">
            {L('Width', 'Ширина')} {info.typed ? `${info.typed}|` : info.width.toFixed(2)} · {L('Segments', 'Сегменты')} {info.segments} · {L('Profile', 'Профиль')} {info.profile.toFixed(2)}
            {info.profileMode ? ` (${L('moving the profile', 'меняется профиль')})` : ''}
          </div>
          <div className="cw-brush-hint">
            {L(
              'Move the mouse away from the edges for width; wheel or +/− segments; P profile; type a number; Shift finer, Ctrl whole units. Click or Enter to make it, right-click or Esc to cancel.',
              'Отводите мышь от рёбер — ширина; колесо или +/− — сегменты; P — профиль; можно ввести число; Shift — точнее, Ctrl — целые. Щелчок или Enter — сделать, правый щелчок или Esc — отмена.',
            )}
          </div>
        </>
      ) : (
        <>
          <div className="cw-brush-row">
            <span className="cw-brush-k">{L('Width', 'Ширина')}</span>
            <span className="cw-brush-num">
              <NumberField label="u" ariaLabel={L('Bevel width', 'Ширина фаски')} value={Math.round(info.width * 100) / 100} step={1} onCommit={(v) => onAdjust({ width: v })} />
            </span>
          </div>
          <div className="cw-brush-row">
            <span className="cw-brush-k">{L('Segments', 'Сегменты')}</span>
            <span className="cw-brush-num">
              <NumberField label="#" ariaLabel={L('Bevel segments', 'Сегменты фаски')} value={info.segments} step={1} onCommit={(v) => onAdjust({ segments: v })} />
            </span>
          </div>
          <div className="cw-brush-row">
            <span className="cw-brush-k">{L('Profile', 'Профиль')}</span>
            <Slider label={L('Bevel profile', 'Профиль фаски')} min={0.25} max={0.99} step={0.01} value={info.profile} onChange={(v) => onAdjust({ profile: v })} />
          </div>
          <div className="cw-brush-hint">{L('Profile: 0.25 straight, 0.5 round, higher squarer.', 'Профиль: 0.25 — прямой, 0.5 — круглый, выше — квадратнее.')}</div>
        </>
      )}
      {info.refused > 0 && <div className="cw-brush-hint">{L(`${info.refused} brush(es) aren’t convex and were left as they are.`, `Кистей не выпуклых, оставлены как есть: ${info.refused}.`)}</div>}
    </div>
  );
}
