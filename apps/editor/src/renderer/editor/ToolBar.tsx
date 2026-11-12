/** The tool rail down the left edge of the Level workspace. Snapping and the other toggles live in the status bar. */
import { Icon, ToolButton, type IconName } from '@cocoaworlds/ui';
import { useEffect, useRef, useState } from 'react';
import type { BrushShape } from '../brush/brushes';
import { t } from '../i18n';
import { useEditor, type Tool } from '../store';

export function ToolBar() {
  const tool = useEditor((s) => s.tool);
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
    <ToolButton icon={icon} label={label} shortcut={key} active={tool === id} onClick={() => setTool(id)} />
  );
  const B = (s: BrushShape, icon: IconName, label: string, key?: string) => (
    <ToolButton
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
    <div className="cw-tbar" role="toolbar" aria-orientation="vertical" aria-label="Tools">
      {T('select', 'select', t('tool.select'), 'V')}
      {T('move', 'move', t('tool.move'), 'W')}
      {T('rotate', 'rotate', t('tool.rotate'), 'E')}
      {T('scale', 'scale', t('tool.scale'), 'R')}
      <hr className="cw-rail-sep" />
      {/* Brushes: the shape last used, with the others in a flyout. */}
      <div className="cw-tb-group" ref={fly}>
        {B(current[0], current[1], current[2], 'B')}
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
      {T('vertex', 'vertex', t('tool.vertex'), 'X')}
      {T('face', 'face', t('tool.face'), 'T')}
      {T('clip', 'clip', t('tool.clip'), 'C')}
      {T('loopcut', 'loopcut', t('tool.loopcut'), `${navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'}+R`)}
      <hr className="cw-rail-sep" />
      <ToolButton
        icon="trigger"
        label={t('tool.trigger')}
        active={tool === 'brush' && role === 'trigger'}
        onClick={() => {
          setBrushOptions({ shape: 'box' });
          setBrushRole('trigger');
          setTool('brush');
        }}
      />
      {T('paint', 'paint', t('tool.paint'), 'P')}
      {T('terrain', 'terrain', t('tool.terrain'), 'H')}
    </div>
  );
}
