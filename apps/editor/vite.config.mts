import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** A path inside the renderer, absolute (the dev server's scan reads inputs from `root`, the build from here). */
const page = (name: string) => fileURLToPath(new URL(`./src/renderer/${name}`, import.meta.url));

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
    // (data: for glTF files that embed their buffers.)
    "connect-src 'self' blob: data:",
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
    // The editor, and the player that exported games run in (export copies only what the player needs:
    // see the manifest).
    manifest: true,
    rollupOptions: { input: { index: page('index.html'), player: page('player.html') } },
  },
  server: { port: 5183, strictPort: false },
});
