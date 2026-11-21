// Bundles the Electron main process and the preload script (CommonJS, Node target).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // (@electron/get is an ES module that finds its own files: it is loaded from node_modules, not bundled.)
  external: ['electron', '@electron/get', 'extract-zip'],
  sourcemap: true,
  logLevel: 'info',
  absWorkingDir: root,
};

const entries = [
  { entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs' },
  // Sandboxed preloads must be a single file that only requires 'electron'.
  { entryPoints: ['src/preload/preload.ts'], outfile: 'dist/main/preload.js' },
  // The main process of exported desktop games (copied into each one; its package.json sits beside it).
  { entryPoints: ['src/game-shell/main.ts'], outfile: 'dist/main/game-shell.cjs', sourcemap: false, external: ['electron', './package.json'] },
];

// The icon a game gets when its project has none of its own.
import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync(path.join(root, 'dist/main'), { recursive: true });
copyFileSync(path.join(root, 'src/renderer/assets/game-icon.png'), path.join(root, 'dist/main/game-icon.png'));

if (watch) {
  const { context } = await import('esbuild');
  for (const e of entries) await (await context({ ...common, ...e })).watch();
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
}
