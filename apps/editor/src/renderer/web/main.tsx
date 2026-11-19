/**
 * Cocoa Materials on the web: the editor's Materials workspace on its own, in a browser (an iPad too). Files
 * live in the browser (see cocoa-web.ts) and the page works offline once loaded (see sw.js).
 */
import '@cocoaworlds/ui/styles.css';
import '../editor.css';
import './web.css';
import { installWebCocoa, openedProject } from './cocoa-web';

async function boot(): Promise<void> {
  // window.cocoa must exist before the store and the panels are loaded.
  await installWebCocoa();
  const [{ createRoot }, { useEditor }, { WebApp }] = await Promise.all([import('react-dom/client'), import('../store'), import('./WebApp')]);
  const st = useEditor.getState();
  st.openSession(openedProject());
  useEditor.setState({ workspace: 'materials' });
  createRoot(document.getElementById('root')!).render(<WebApp />);
  if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('./sw.js').catch(() => {});
}
void boot();
