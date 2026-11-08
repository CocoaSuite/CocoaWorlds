// The project's footstep and hit sounds, for each kind of surface.
import { SURFACES, SURFACE_LABELS, type Surface, type SurfaceSoundSet } from '@cocoaworlds/core';
import { NumberField } from '@cocoaworlds/ui';
import { getLang, t } from '../i18n';
import { useEditor } from '../store';

export const surfaceLabel = (s: Surface) => SURFACE_LABELS[s][getLang() === 'ru' ? 1 : 0];

const LISTS = [
  ['steps', 'ss.steps'],
  ['soft', 'ss.soft'],
  ['hard', 'ss.hard'],
] as const;

export function SurfaceSoundsEditor() {
  const all = useEditor((s) => s.session?.project.settings.surfaceSounds) ?? {};
  const sounds = useEditor((s) => s.assets.sounds);
  const playing = useEditor((s) => !!s.playing);
  const save = (s: Surface, next: SurfaceSoundSet) => !playing && void useEditor.getState().setSurfaceSounds({ ...all, [s]: next });
  const name = (path: string) => sounds.find((a) => a.path === path)?.name ?? path.split('/').pop();
  return (
    <>
      <p className="cw-hint">{t('ss.hint')}</p>
      {SURFACES.map((s) => {
        const set = all[s] ?? {};
        return (
          <div key={s} className="cw-ss">
            <div className="cw-ss-head">
              <b>{surfaceLabel(s)}</b>
              <NumberField label="" ariaLabel={`${surfaceLabel(s)} ${t('ss.volume')}`} value={set.volume ?? 1} step={0.1} onCommit={(v) => save(s, { ...set, volume: Math.max(0, Math.min(2, v)) })} />
            </div>
            {LISTS.map(([k, label]) => (
              <div key={k} className="cw-ss-row">
                <span className="cw-muted">{t(label)}</span>
                {(set[k] ?? []).map((f) => (
                  <button key={f} className="cw-ss-chip" title={t('ss.remove')} onClick={() => save(s, { ...set, [k]: set[k]!.filter((x) => x !== f) })}>
                    {name(f)} ×
                  </button>
                ))}
                <select
                  className="cw-input cw-select cw-ss-add"
                  aria-label={`${surfaceLabel(s)} ${t(label)}`}
                  value=""
                  onChange={(e) => e.currentTarget.value && save(s, { ...set, [k]: [...(set[k] ?? []), e.currentTarget.value] })}
                >
                  <option value="">{t('ss.add')}</option>
                  {sounds
                    .filter((a) => !(set[k] ?? []).includes(a.path))
                    .map((a) => (
                      <option key={a.path} value={a.path}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
