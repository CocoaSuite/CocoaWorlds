/** Compact horizontal command bar for the Level workspace. */
import { Icon, type IconName } from '@cocoaworlds/ui';
import { useEffect, useRef, useState } from 'react';
import type { BrushShape } from '../brush/brushes';
import { t } from '../i18n';
import { GRID_SIZES, SNAP_ANGLES, useEditor, type Tool } from '../store';

export function ToolBar() {
  const tool = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);
  const angle = useEditor((s) => s.snapAngle);
  const grid = useEditor((s) => s.session?.project.settings.gridSize ?? 16);
  const selected = useEditor((s) => s.selection.length > 0);
  const st = useEditor.getState();
  const setTool = useEditor((s) => s.setTool);
  const shape = useEditor((s) => s.brushOptions.shape);
  const setBrushOptions = useEditor((s) => s.setBrushOptions);
  const setBrushRole = useEditor((s) => s.setBrushRole);
  const role = useEditor((s) => s.brushRole);
  const [shapes, setShapes] = useState(false);
  const fly = useRef<HTMLDivElement>(null);
  // (The shapes flyout closes on a click elsewhere or Esc.)
  useEffect(() => {
    if (!shapes) return;
    const away = (e: PointerEvent) => !fly.current?.contains(e.target as Node) && setShapes(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setShapes(false);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [shapes]);
  const SHAPES: [BrushShape, IconName, string, string?][] = [
    ['box', 'block', t('tool.block'), 'B'],
    ['cylinder', 'cylinder', t('tool.cylinder')],
    ['sphere', 'sphere', t('tool.sphere')],
    ['wedge', 'wedge', t('tool.wedge')],
    ['stairs', 'stairs', t('tool.stairs')],
    ['polygon', 'polygon', t('tool.polygon')],
    ['plane', 'face', t('tool.plane')],
  ];
  const current = SHAPES.find((x) => x[0] === shape) ?? SHAPES[0]!;
  const T = (id: Tool, icon: IconName, label: string, key: string) => (
    <CommandTool icon={icon} label={label} shortcut={key} active={tool === id} onClick={() => setTool(id)} text={['select', 'move', 'rotate', 'scale'].includes(id)} />
  );
  const B = (s: BrushShape, icon: IconName, label: string, key?: string) => (
    <CommandTool
      text
      icon={icon}
      label={label}
      shortcut={key}
      active={tool === 'brush' && shape === s && role !== 'trigger'}
      onClick={() => {
        setBrushOptions({ shape: s });
        if (role === 'trigger') setBrushRole('solid');
        setTool('brush');
        setShapes(false);
      }}
    />
  );
  return (
    <div className="cw-tbar" role="toolbar" aria-orientation="horizontal" aria-label="Tools">
      {T('select', 'select', t('tool.select'), '1 / V')}
      {T('move', 'move', t('tool.move'), '2 / W')}
      {T('rotate', 'rotate', t('tool.rotate'), '3 / E')}
      {T('scale', 'scale', t('tool.scale'), '4 / R')}
      <hr className="cw-rail-sep" />
      {/* Brushes: the shape last used, with the others in a flyout. */}
      <div className="cw-tb-group" ref={fly}>
        {B(current[0], current[1], current[2], '5 / B')}
        <button type="button" className="cw-tb-more" aria-label={t('tool.shapes')} aria-expanded={shapes} onClick={() => setShapes(!shapes)}>
          <Icon name="chevronDown" size={10} />
        </button>
        {shapes && (
          <div className="cw-tb-fly" role="group" aria-label={t('tool.shapes')}>
            {SHAPES.map(([s, icon, label, key]) => (
              <span key={s}>{B(s, icon, label, key)}</span>
            ))}
          </div>
        )}
      </div>
      <hr className="cw-rail-sep" />
      {T('vertex', 'vertex', t('tool.vertex'), '6 / X')}
      {T('face', 'face', t('tool.face'), '7 / T')}
      {T('clip', 'clip', t('tool.clip'), '8 / C')}
      {T('loopcut', 'loopcut', t('tool.loopcut'), `9 / ${navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'}+R`)}
      <hr className="cw-rail-sep" />
      <CommandTool
        icon="trigger"
        label={t('tool.trigger')}
        shortcut="0"
        active={tool === 'brush' && role === 'trigger'}
        onClick={() => {
          setBrushOptions({ shape: 'box' });
          setBrushRole('trigger');
          setTool('brush');
        }}
      />
      {T('paint', 'paint', t('tool.paint'), '- / P')}
      {T('terrain', 'terrain', t('tool.terrain'), '= / H')}
      <hr className="cw-rail-sep" />
      <CommandTool icon="copy" label={t('edit.duplicate')} disabled={!selected} onClick={st.duplicateSelection} />
      <CommandTool icon="folder" label={t('edit.group')} disabled={!selected} onClick={st.groupSelection} />
      <CommandTool icon="close" label={t('edit.delete')} disabled={!selected} onClick={st.deleteSelection} />
      <hr className="cw-rail-sep" />
      <div className="cw-command-snap">
        <button type="button" className="cw-command-tool" aria-label={`${t('grid.snap')} ${snap ? t('grid.on') : t('grid.off')}`} aria-pressed={snap} onClick={() => st.toggle('snap')}>
          <Icon name="grid" /> <span>{t('grid.snap')} {snap ? t('grid.on') : t('grid.off')}</span>
        </button>
        <select className="cw-pill-select mono" aria-label={t('grid.size')} value={grid}
          onChange={(e) => st.setGridSize(Number(e.currentTarget.value))}>
          {GRID_SIZES.map((g) => <option key={g} value={g}>{g}u</option>)}
        </select>
        <label className="cw-command-angle">
          <span>{t('grid.angle')}</span>
          <select className="cw-pill-select mono" aria-label={t('grid.angle')} value={angle}
            onChange={(e) => st.setSnapAngle(Number(e.currentTarget.value))}>
            {SNAP_ANGLES.map((a) => <option key={a} value={a}>{a ? `${a}°` : t('grid.off')}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

function CommandTool({ icon, label, shortcut, active, text, disabled, onClick }: {
  icon: IconName; label: string; shortcut?: string; active?: boolean; text?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return <button type="button" className={`cw-tool cw-command-tool${active ? ' on' : ''}`}
    aria-label={label} aria-pressed={active === undefined ? undefined : active}
    title={shortcut ? `${label} (${shortcut})` : label} disabled={disabled} onClick={onClick}>
    <Icon name={icon} />{text && <span>{label}</span>}
  </button>;
}
