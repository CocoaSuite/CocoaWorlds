/** The web app's frame: a thin top bar (undo, redo, saved state) over the Materials workspace. */
import { Button, Toast } from '@cocoaworlds/ui';
import { useEffect, useReducer } from 'react';
import { MaterialsPanel } from '../editor/MaterialsPanel';
import { useEditor } from '../store';

export function WebApp() {
  useEditor((s) => s.rev);
  const history = useEditor((s) => s.history);
  const toast = useEditor((s) => s.toast);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => history.subscribe(redraw), [history]);

  // Undo and redo (the graph has its own keys for the rest).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const a = document.activeElement;
      if (a?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const k = e.code.replace(/^Key/, '').toLowerCase();
      const s = useEditor.getState();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (k === 'y') {
        e.preventDefault();
        s.redo();
      } else if (k === 's') e.preventDefault(); // (Saved as you go.)
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  return (
    <div className="cw-editor cmw">
      <header className="cmw-bar">
        <strong>Cocoa Materials</strong>
        <span className="cw-muted cmw-saved">Saved in this browser</span>
        <span className="cmw-gap" />
        <Button size="sm" disabled={!history.canUndo} onClick={() => useEditor.getState().undo()}>
          Undo
        </Button>
        <Button size="sm" disabled={!history.canRedo} onClick={() => useEditor.getState().redo()}>
          Redo
        </Button>
      </header>
      <MaterialsPanel />
      <Toast message={toast?.text ?? null} nonce={toast?.n} />
    </div>
  );
}
