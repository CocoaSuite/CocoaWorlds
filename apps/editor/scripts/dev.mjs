// Development: Vite dev server for the UI with hot reload, esbuild watching main/preload, Electron pointed at Vite.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root); // vite.config.mts sets root to src/renderer relative to here
const server = await createServer({ configFile: path.join(root, 'vite.config.mts') });
await server.listen();
const url = server.resolvedUrls.local[0];

spawn(process.execPath, [path.join(root, 'scripts/build-main.mjs'), '--watch'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));

const electronBin = (await import('electron')).default;
const app = spawn(electronBin, ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, CW_DEV_URL: url } });
app.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
