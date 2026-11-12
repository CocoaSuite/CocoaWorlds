/** The status bar along the bottom of every workspace: one hint for the tool in hand, then toggles and save state. */
import { t, type Key } from '../i18n';
import { useEditor } from '../store';

export function StatusBar() {
  const workspace = useEditor((s) => s.workspace);
  const tool = useEditor((s) => s.tool);
  const playing = useEditor((s) => !!s.playing);
  const vertexSnap = useEditor((s) => s.vertexSnap);
  const pivotEdit = useEditor((s) => s.pivotEdit);
  const uvPane = useEditor((s) => s.uvPane);
  const toggle = useEditor((s) => s.toggle);
  const dirty = useEditor((s) => s.dirty);
  const saving = useEditor((s) => s.saving);
  const level = workspace === 'scene';
  const hint = playing ? t('hint.playing') : level ? t(`hint.${tool}` as Key) : '';
  const Toggle = (on: boolean, label: string, flip: () => void) => (
    <button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={flip}>
      {label}
    </button>
  );
  return (
    <footer className="cw-statusbar">
      <span className="cw-sb-hint">{hint}</span>
      {/* The viewport draws its frame figures into this slot (View > Statistics). */}
      <span id="cw-sb-stats" className="cw-sb-stats mono" hidden={!level} />
      {level && !playing && (
        <>
          {Toggle(vertexSnap, t('grid.vertices'), () => toggle('vertexSnap'))}
          {Toggle(pivotEdit, t('pivot.edit'), () => toggle('pivotEdit'))}
          {Toggle(uvPane, 'UV', () => toggle('uvPane'))}
        </>
      )}
      <span data-testid="save-status" className={dirty ? 'cw-sb-edited' : ''}>
        {saving ? t('status.saving') : dirty ? t('status.edited') : t('status.saved')}
      </span>
    </footer>
  );
}
