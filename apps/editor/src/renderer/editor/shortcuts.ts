/**
 * Global editor shortcuts, following CocoaCanvas conventions (DESIGN_SYSTEM.md §5).
 * Keys are read by physical position (`e.code`) so they work with any keyboard layout, as `latKey` does in CocoaCanvas.
 */
import { useEffect } from 'react';
import { useEditor } from '../store';

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

export const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: 'Select tool', keys: ['V'] },
  { label: 'Move tool', keys: ['W'] },
  { label: 'Rotate tool', keys: ['E'] },
  { label: 'Scale tool', keys: ['R'] },
  { label: 'Perspective / Top / Front / Side', keys: ['1', '2', '3', '4'] },
  { label: 'Frame selected', keys: ['F'] },
  { label: 'Look around (perspective)', keys: ['Right-drag', 'W A S D'] },
  { label: 'Orbit', keys: ['Alt', 'Left-drag'] },
  { label: 'Pan', keys: ['Middle-drag'] },
  { label: 'Pan (alternative)', keys: ['Space', 'Left-drag'] },
  { label: 'Zoom', keys: ['Wheel'] },
  { label: 'Undo / Redo', keys: [`${mod}+Z`, `${mod}+Shift+Z`] },
  { label: 'Duplicate', keys: [`${mod}+D`] },
  { label: 'Delete', keys: ['Delete'] },
  { label: 'Rename', keys: ['F2'] },
  { label: 'Select all', keys: [`${mod}+A`] },
  { label: 'Save', keys: [`${mod}+S`] },
  { label: 'Toggle grid snapping', keys: ['G'] },
  { label: 'Deselect / step out', keys: ['Esc'] },
  { label: 'This list', keys: ['?'] },
];

export function inField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** True while the viewport is in a right-drag fly mode; letters then steer the camera instead of switching tools. */
export const flyState = { active: false };

export function useShortcuts(openKeys: () => void): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (inField(e.target) || document.querySelector('.cw-modal')) return;
      const s = useEditor.getState();
      const m = e.ctrlKey || e.metaKey;
      const code = e.code;
      if (m) {
        const k = code.replace(/^Key/, '').toLowerCase();
        const run = (fn: () => void) => {
          e.preventDefault();
          fn();
        };
        if (k === 'z') return run(e.shiftKey ? s.redo : s.undo);
        if (k === 'y') return run(s.redo);
        if (k === 's') return run(() => void s.save());
        if (k === 'd') return run(s.duplicateSelection);
        if (k === 'a') return run(s.selectAll);
        return;
      }
      if (flyState.active) return;
      if (e.key === '?') return openKeys();
      switch (code) {
        case 'KeyV':
          return s.setTool('select');
        case 'KeyW':
          return s.setTool('move');
        case 'KeyE':
          return s.setTool('rotate');
        case 'KeyR':
          return s.setTool('scale');
        case 'KeyF':
          return s.frameSelection();
        case 'KeyG':
          return s.toggle('snap');
        case 'Digit1':
          return s.setView('perspective');
        case 'Digit2':
          return s.setView('top');
        case 'Digit3':
          return s.setView('front');
        case 'Digit4':
          return s.setView('side');
        case 'F2':
          if (s.selection.length === 1) {
            e.preventDefault();
            s.startRename(s.selection[0]!);
          }
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          return s.deleteSelection();
        case 'Escape':
          if (s.tool !== 'select') return s.setTool('select');
          return s.select([]);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [openKeys]);
}
