import { Toast } from '@cocoaworlds/ui';
import { useEffect } from 'react';
import { EditorScreen } from './editor/EditorScreen';
import { StartScreen } from './start/StartScreen';
import { useEditor } from './store';

export function App() {
  const session = useEditor((s) => s.session);
  const toast = useEditor((s) => s.toast);
  useEditor((s) => s.lang); // re-render all text when the language changes

  // When the window is closing with unsaved changes, main asks us to save.
  useEffect(() => window.cocoa.window.onSaveRequest(() => useEditor.getState().save()), []);

  return (
    <>
      {session ? <EditorScreen /> : <StartScreen />}
      <Toast message={toast?.text ?? null} nonce={toast?.n} />
    </>
  );
}
