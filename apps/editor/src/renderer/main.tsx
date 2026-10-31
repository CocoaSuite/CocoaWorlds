import '@cocoaworlds/ui/styles.css';
import './editor.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useEditor } from './store';

// Development builds expose the store for debugging and tests.
if (import.meta.env.DEV) (window as unknown as { __cwStore: typeof useEditor }).__cwStore = useEditor;

createRoot(document.getElementById('root')!).render(<App />);
