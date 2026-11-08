#!/usr/bin/env node
// The acoustics bench: how much time sound propagation takes per frame, with more and more sounds, in a big
// level of rooms (one and three storeys). Runs the engine's runtime in plain Node (no editor, no audio device).
// Usage: npm run bench:acoustics [-- --seconds 20] [--rooms 12]
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
const SECONDS = option('seconds', 20);
const ROOMS = option('rooms', 12);

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-acoustics-'));
const bundle = path.join(tmp, 'acoustics.mjs');
await build({ entryPoints: [path.join(here, 'acoustics-scene.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'error' });
const { roomsScene, runAcoustics } = await import(pathToFileURL(bundle).href);

// Garbage collections, to tell the engine's own spikes from the collector's.
const gcs = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) gcs.push([e.startTime, e.startTime + e.duration]);
}).observe({ entryTypes: ['gc'] });
const gcAt = (a, b) => gcs.some(([s, e]) => s < b && e > a);

const rows = [];
for (const floors of [1, 3]) {
  const scene = roomsScene(ROOMS, 256, floors);
  for (const n of (process.env.SOUNDS ?? '8,32,64,128,256').split(',').map(Number)) {
    const r = await runAcoustics(scene, n, SECONDS, gcAt);
    rows.push({ level: `${ROOMS}×${ROOMS} rooms × ${floors} floor${floors > 1 ? 's' : ''}`, ...r });
    console.log(
      `[acoustics] ${rows.at(-1).level}, ${n} sounds: avg ${r.avg.toFixed(3)} ms, p50 ${r.p50.toFixed(3)}, p99 ${r.p99.toFixed(3)}, peak ${r.peak.toFixed(3)} ms; ` +
        `${r.over1} frames > 1 ms (${r.over1gc} with a GC); first 2 s ${r.warmup.toFixed(0)} ms; ${r.updates} updates, ${r.rays + r.gridRays} rays, grid ${(r.gridBytes / 1024).toFixed(0)} KB, ${r.floods} floods; ${r.behind} behind walls, ${r.round} heard round; longest parts ${r.phases.map((x) => x.toFixed(2)).join('/')} ms`,
    );
  }
}
await fs.writeFile(path.join(tmp, 'acoustics.json'), JSON.stringify(rows, null, 2));
console.log(`[acoustics] results: ${path.join(tmp, 'acoustics.json')}`);
