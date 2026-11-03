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
  { label: 'Brush tool (draw, set height, click or Enter)', keys: ['B'] },
  { label: 'Face tool (select faces, edit texture alignment)', keys: ['T'] },
  { label: 'Faces: add or remove / whole brush', keys: [`${mod}+click`, 'Shift+click'] },
  { label: 'Paint tool (click faces to apply a material)', keys: ['P'] },
  { label: 'Vertex tool (pick corners or edge middles, move with the arrows)', keys: ['X'] },
  { label: 'Finer or coarser snapping grid', keys: ['[', ']'] },
  { label: 'Clip tool (drag a line across brushes; Tab: what to keep; Enter: clip)', keys: ['C'] },
  { label: 'Loop cut (hover a brush, wheel for more cuts, click to cut)', keys: [`${mod}+R`] },
  { label: 'Edit pivot: the move gizmo moves the selected object’s pivot (snaps to corners)', keys: ['O'] },
  { label: 'Box select (drag on empty space)', keys: ['Left-drag'] },
  { label: 'Paint: pick up a material', keys: [`${mod}+click`] },
  { label: 'Perspective / Top / Front / Side', keys: ['1', '2', '3', '4'] },
  { label: 'Frame selected', keys: ['F'] },
  { label: 'Look around (perspective)', keys: ['Right-drag', 'W A S D'] },
  { label: 'Orbit', keys: ['Alt', 'Left-drag'] },
  { label: 'Pan', keys: ['Middle-drag'] },
  { label: 'Pan (alternative)', keys: ['Space', 'Left-drag'] },
  { label: 'Zoom', keys: ['Wheel'] },
  { label: 'Undo / Redo', keys: [`${mod}+Z`, `${mod}+Shift+Z`] },
  { label: 'Duplicate', keys: [`${mod}+D`] },
  { label: 'Copy / Cut / Paste', keys: [`${mod}+C`, `${mod}+X`, `${mod}+V`] },
  { label: 'Group / Ungroup', keys: [`${mod}+G`, `${mod}+Shift+G`] },
  { label: 'Step into a group / out of it', keys: ['Enter', 'Esc'] },
  { label: 'Pick an object inside a group', keys: ['Double-click'] },
  { label: 'Move several objects', keys: ['Select them', 'W'] },
  { label: 'Delete', keys: ['Delete'] },
  { label: 'Rename', keys: ['F2'] },
  { label: 'Select all', keys: [`${mod}+A`] },
  { label: 'Save', keys: [`${mod}+S`] },
  { label: 'Toggle grid snapping', keys: ['G'] },
  { label: 'Toggle snapping to corners', keys: ['Shift+G'] },
  { label: 'Deselect / step out', keys: ['Esc'] },
  { label: 'Play / Stop', keys: ['F5'] },
  { label: 'Stop playing', keys: ['Esc'] },
  { label: 'This list', keys: ['?'] },
];

export function inField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Sliders, switches, colour wells: no text to edit, so Ctrl+Z and the like still mean the editor's. */
function noText(target: EventTarget | null): boolean {
  const el = target as HTMLInputElement | null;
  return el?.tagName === 'INPUT' && ['range', 'checkbox', 'radio', 'color', 'button'].includes(el.type);
}

/** True while the viewport is in a right-drag fly mode; letters then steer the camera instead of switching tools. */
export const flyState = { active: false };

export function useShortcuts(openKeys: () => void): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((inField(e.target) && !(noText(e.target) && (e.ctrlKey || e.metaKey))) || document.querySelector('.cw-modal')) return;
      const s = useEditor.getState();
      if (e.code === 'F5') {
        e.preventDefault();
        return s.playing ? s.stopPlaying() : s.play();
      }
      // While playing, the scene can't be edited: only Esc (stop) and the camera keys work.
      if (s.playing) {
        if (e.key === 'Escape' && !flyState.active) s.stopPlaying();
        return;
      }
      const m = e.ctrlKey || e.metaKey;
      const code = e.code;
      // Other workspaces (Screens) have their own keys: only undo, redo and save are shared.
      if (s.workspace !== 'scene') {
        const k = code.replace(/^Key/, '').toLowerCase();
        if (!m || !['z', 'y', 's'].includes(k)) return;
      }
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
        if (k === 'c') return run(s.copySelection);
        if (k === 'x') return run(s.cutSelection);
        if (k === 'v') return run(s.paste);
        if (k === 'g') return run(e.shiftKey ? s.ungroupSelection : s.groupSelection);
        if (k === 'a') return run(s.tool === 'face' ? s.selectAllFaces : s.selectAll);
        if (k === 'r') return run(() => s.setTool('loopcut'));
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
        case 'KeyB':
          s.setBrushOptions({ shape: 'box' });
          if (s.brushRole === 'trigger') s.setBrushRole('solid');
          return s.setTool('brush');
        case 'KeyT':
          return s.setTool('face');
        case 'KeyX':
          return s.setTool('vertex');
        case 'KeyC':
          return s.setTool('clip');
        case 'KeyP':
          return s.setTool('paint');
        case 'KeyH':
          return s.setTool('terrain');
        case 'KeyF':
          return s.frameSelection();
        case 'KeyO':
          return s.toggle('pivotEdit');
        case 'KeyG':
          return s.toggle(e.shiftKey ? 'vertexSnap' : 'snap');
        case 'Enter':
          return s.enterGroup();
        case 'Digit1':
          return s.setView('perspective');
        case 'Digit2':
          return s.setView('top');
        case 'Digit3':
          return s.setView('front');
        case 'Digit4':
          return s.setView('side');
        case 'BracketLeft':
          return s.stepGrid(-1);
        case 'BracketRight':
          return s.stepGrid(1);
        case 'F2':
          if (s.selection.length === 1) {
            e.preventDefault();
            s.startRename(s.selection[0]!);
          }
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          // Faces can't be deleted on their own; don't delete the whole brush by surprise.
          if (s.tool === 'face' || s.tool === 'paint' || s.tool === 'vertex') return;
          return s.deleteSelection();
        case 'Escape':
          if (s.tool === 'face' && s.faceSelection.length) return s.selectFace(null);
          if (s.tool !== 'select') return s.setTool('select');
          if (s.stepOut()) return;
          return s.select([]);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [openKeys]);
}
