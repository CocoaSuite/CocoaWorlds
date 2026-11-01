import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Production builds get a strict Content-Security-Policy; the dev server needs inline scripts for hot reload. */
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    // Physics (Rapier) compiles WebAssembly; this allows wasm compilation only, not JavaScript eval.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    // Project assets (textures, sounds, models) are read through the main process and handed over as blob: URLs.
    "connect-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  return {
    name: 'cocoaworlds-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`),
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), csp()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome130',
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5183, strictPort: false },
});
