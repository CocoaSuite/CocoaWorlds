/** Centred tool bar under the viewport (CocoaCanvas #tbar). Tools from later phases are shown disabled with a note. */
import { Divider, ToolButton } from '@cocoaworlds/ui';
import { t } from '../i18n';
import { useEditor, type Tool } from '../store';

export function ToolBar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const snap = useEditor((s) => s.snap);
  const toggle = useEditor((s) => s.toggle);
  const grid = useEditor((s) => s.session?.project.settings.gridSize ?? 16);
  const later = (k: Parameters<typeof t>[0]) => `${t(k)} — ${t('tool.later')}`;
  const T = (id: Tool, icon: Parameters<typeof ToolButton>[0]['icon'], label: string, key: string) => (
    <ToolButton icon={icon} label={label} shortcut={key} active={tool === id} onClick={() => setTool(id)} />
  );
  return (
    <div className="cw-tbar" role="toolbar" aria-label="Tools">
      {T('select', 'select', t('tool.select'), 'V')}
      {T('move', 'move', t('tool.move'), 'W')}
      {T('rotate', 'rotate', t('tool.rotate'), 'E')}
      {T('scale', 'scale', t('tool.scale'), 'R')}
      <Divider />
      <ToolButton icon="block" label={later('tool.block')} disabled />
      <ToolButton icon="cylinder" label={later('tool.cylinder')} disabled />
      <ToolButton icon="wedge" label={later('tool.wedge')} disabled />
      <ToolButton icon="stairs" label={later('tool.stairs')} disabled />
      <Divider />
      <ToolButton icon="vertex" label={later('tool.vertex')} disabled />
      <ToolButton icon="face" label={later('tool.face')} disabled />
      <ToolButton icon="clip" label={later('tool.clip')} disabled />
      <Divider />
      <ToolButton icon="trigger" label={later('tool.trigger')} disabled />
      <ToolButton icon="paint" label={later('tool.material')} disabled />
      <Divider />
      <button type="button" className={`cw-snap${snap ? ' on' : ''}`} aria-pressed={snap} title="Grid snapping (G)" onClick={() => toggle('snap')}>
        {t('grid.snap')} {snap ? `${grid}u` : t('grid.off')}
      </button>
    </div>
  );
}
