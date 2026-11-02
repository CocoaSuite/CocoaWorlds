/** A grid of material swatches (radio group). Used by the face inspector and the paint tool. */
import { DEV_MATERIALS, swatchStyle } from '../brush/materials';
import { getLang } from '../i18n';
import { useEditor } from '../store';
import { MaterialSwatch } from './MaterialSwatch';
import { TextureSwatch } from './TextureSwatch';

export function MaterialPicker({ value, onChange, label }: { value: string | null; onChange: (id: string) => void; label: string }) {
  const lang = getLang();
  const textures = useEditor((s) => s.assets.textures);
  const materials = useEditor((s) => s.session?.project.settings.materials) ?? [];
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
      {materials.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={value === m.id}
          aria-label={m.name}
          title={m.name}
          className={`cw-mat${value === m.id ? ' on' : ''}`}
          onClick={() => onChange(m.id)}
        >
          <MaterialSwatch def={m} />
        </button>
      ))}
      {textures.map((tx) => (
        <button
          key={tx.path}
          type="button"
          role="radio"
          aria-checked={value === tx.path}
          aria-label={tx.name}
          title={tx.path}
          className={`cw-mat${value === tx.path ? ' on' : ''}`}
          onClick={() => onChange(tx.path)}
        >
          <TextureSwatch path={tx.path} />
        </button>
      ))}
    </div>
  );
}
