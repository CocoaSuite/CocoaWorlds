/** A grid of material swatches (radio group). Used by the face inspector and the paint tool. */
import { DEV_MATERIALS, swatchStyle } from '../brush/materials';
import { getLang } from '../i18n';

export function MaterialPicker({ value, onChange, label }: { value: string | null; onChange: (id: string) => void; label: string }) {
  const lang = getLang();
  return (
    <div className="cw-mat-grid" role="radiogroup" aria-label={label}>
      {DEV_MATERIALS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={value === m.id}
          aria-label={m.label[lang]}
          title={`${m.label[lang]} (${m.id})`}
          className={`cw-mat${value === m.id ? ' on' : ''}`}
          onClick={() => onChange(m.id)}
        >
          <span className="cw-mat-sw" style={swatchStyle(m.id)} />
        </button>
      ))}
    </div>
  );
}
