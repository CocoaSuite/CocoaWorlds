/** Centred tool bar under the viewport (CocoaCanvas #tbar). Tools from later phases are shown disabled with a note. */
import { Divider, ToolButton, type IconName } from '@cocoaworlds/ui';
import type { BrushShape } from '../brush/brushes';
import { t } from '../i18n';
import { useEditor, type Tool } from '../store';

export function ToolBar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const snap = useEditor((s) => s.snap);
  const vertexSnap = useEditor((s) => s.vertexSnap);
  const toggle = useEditor((s) => s.toggle);
  const shape = useEditor((s) => s.brushOptions.shape);
  const setBrushOptions = useEditor((s) => s.setBrushOptions);
  const grid = useEditor((s) => s.session?.project.settings.gridSize ?? 16);
  const T = (id: Tool, icon: IconName, label: string, key: string) => (
    <ToolButton icon={icon} label={label} shortcut={key} active={tool === id} onClick={() => setTool(id)} />
  );
  const B = (s: BrushShape, icon: IconName, label: string, key?: string) => (
    <ToolButton
      icon={icon}
      label={label}
      shortcut={key}
      active={tool === 'brush' && shape === s}
      onClick={() => {
        setBrushOptions({ shape: s });
        setTool('brush');
      }}
    />
  );
  return (
    <div className="cw-tbar" role="toolbar" aria-label="Tools">
      {T('select', 'select', t('tool.select'), 'V')}
      {T('move', 'move', t('tool.move'), 'W')}
      {T('rotate', 'rotate', t('tool.rotate'), 'E')}
      {T('scale', 'scale', t('tool.scale'), 'R')}
      <Divider />
      {B('box', 'block', t('tool.block'), 'B')}
      {B('cylinder', 'cylinder', t('tool.cylinder'))}
      {B('wedge', 'wedge', t('tool.wedge'))}
      {B('stairs', 'stairs', t('tool.stairs'))}
      {B('polygon', 'polygon', t('tool.polygon'))}
      <Divider />
      {T('vertex', 'vertex', t('tool.vertex'), 'X')}
      {T('face', 'face', t('tool.face'), 'T')}
      {T('clip', 'clip', t('tool.clip'), 'C')}
      <Divider />
      <ToolButton icon="trigger" label={`${t('tool.trigger')} — ${t('soon')}`} disabled />
      {T('paint', 'paint', t('tool.paint'), 'P')}
      <Divider />
      <button type="button" className={`cw-snap${snap ? ' on' : ''}`} aria-pressed={snap} title="Grid snapping (G)" onClick={() => toggle('snap')}>
        {t('grid.snap')} {snap ? `${grid}u` : t('grid.off')}
      </button>
      <button type="button" className={`cw-snap${vertexSnap ? ' on' : ''}`} aria-pressed={vertexSnap} title="Snap to brush corners (Shift+G)" onClick={() => toggle('vertexSnap')}>
        {t('grid.vertices')}
      </button>
    </div>
  );
}
