/**
 * The web build of Cocoa Materials (the Materials workspace on its own, for browsers and iPads):
 * `npm run build:web` → dist/materials-web, a static site that works offline once opened.
 */
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** A service worker that keeps every built file, so the app opens without a connection. */
function offline(): Plugin {
  return {
    name: 'cocoa-materials-offline',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', ...Object.keys(bundle).map((f) => `./${f === 'materials.html' ? 'index.html' : f}`), './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-512.png'];
      const version = createHash('sha1').update(Object.keys(bundle).sort().join('|')).digest('hex').slice(0, 10);
      const sw = `const CACHE = 'cocoa-materials-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match('./index.html'))));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
    // The page is served as the site's index.
    closeBundle() {
      const dir = fileURLToPath(new URL('./dist/materials-web/', import.meta.url));
      if (existsSync(`${dir}materials.html`)) renameSync(`${dir}materials.html`, `${dir}index.html`);
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  publicDir: 'web/public',
  plugins: [react(), offline()],
  build: {
    outDir: '../../dist/materials-web',
    emptyOutDir: true,
    target: ['safari16', 'chrome120'],
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { index: fileURLToPath(new URL('./src/renderer/materials.html', import.meta.url)) } },
  },
  server: { port: 5190, strictPort: false, open: '/materials.html' },
});
