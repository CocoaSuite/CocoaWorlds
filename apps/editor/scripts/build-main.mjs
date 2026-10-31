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
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
  absWorkingDir: root,
};

const entries = [
  { entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs' },
  // Sandboxed preloads must be a single file that only requires 'electron'.
  { entryPoints: ['src/preload/preload.ts'], outfile: 'dist/main/preload.js' },
];

if (watch) {
  const { context } = await import('esbuild');
  for (const e of entries) await (await context({ ...common, ...e })).watch();
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
}
