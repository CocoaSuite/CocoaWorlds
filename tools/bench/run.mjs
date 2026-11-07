#!/usr/bin/env node
// The frame-time bench: plays the bench scene (scene.ts) in the editor for a while and writes frame times.
// How to use it: README.md in this folder. Usage: npm run bench [-- --seconds 30] [-- --software] [-- --build]
import { spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const appDir = path.join(root, 'apps', 'editor');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SECONDS = Number(option('seconds', 30));
const WARMUP = 8;
const SOFTWARE = flag('software');
const log = (...a) => console.log('[bench]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn().catch(() => false)) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

// ── 1. The editor, built ──
if (flag('build') || !existsSync(path.join(appDir, 'dist', 'main', 'main.cjs'))) {
  log('building the editor (npm run build)…');
  const r = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// ── 2. The bench scene, from the engine's own functions ──
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-bench-'));
const bundle = path.join(tmp, 'scene.mjs');
await build({ entryPoints: [path.join(here, 'scene.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'error' });
const { benchScene, benchPlants, BENCH } = await import(pathToFileURL(bundle).href);
const userData = path.join(tmp, 'userdata');
const projectsDir = path.join(tmp, 'projects');

async function launch() {
  const args = [
    // (Frames as fast as they come, not held to the screen's refresh rate, and never slowed when not in front.)
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...(SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    '.',
  ];
  const app = await electron.launch({ args, cwd: appDir, env: { ...process.env, CW_USER_DATA: userData, CW_PROJECTS_DIR: projectsDir } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  await page.waitForLoadState('domcontentloaded');
  const win = await app.browserWindow(page);
  await win.evaluate((w) => {
    w.setSize(1600, 900);
    w.center();
    w.focus();
  });
  return { app, page };
}

async function quit(app) {
  const killer = setTimeout(() => app.process().kill('SIGKILL'), 8000);
  await app.close().catch(() => {});
  clearTimeout(killer);
}

let app, page;
const resultsDir = path.join(here, 'results');
try {
  // A new project, made the way a person makes one.
  log('making the bench project…');
  ({ app, page } = await launch());
  await page.getByRole('heading', { name: 'Projects' }).waitFor();
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name').fill('Bench');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('tree').getByRole('treeitem').first().waitFor();
  await quit(app);

  // Its level and plants replaced by the bench's; health off, so creatures that reach the player don't end the run.
  const projectDir = path.join(projectsDir, 'bench');
  const projectFile = path.join(projectDir, 'project.cwproj');
  const sceneFile = path.join(projectDir, 'scenes', 'level_01.cwscene');
  const project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  project.settings.plants = benchPlants();
  project.settings.game = { ...project.settings.game, health: false };
  await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
  const old = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
  const scene = benchScene();
  await fs.writeFile(sceneFile, JSON.stringify({ ...old, schemaVersion: scene.schemaVersion, entities: scene.entities, settings: { ...old.settings, ui: scene.settings.ui } }, null, 2));

  // Open it and play.
  log('opening it…');
  ({ app, page } = await launch());
  await page.getByRole('button', { name: /Bench/ }).click();
  await page.getByRole('tree').getByRole('treeitem', { name: /crate/ }).first().waitFor();
  await until(() => page.evaluate(() => !!window.__cwViewport && !window.__cwViewport.world.building), 120000, 'the level to build');
  await sleep(1000);
  log('playing…');
  await page.getByTestId('viewport').click({ position: { x: 20, y: 20 } }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.keyboard.press('F5');
  await page.getByTestId('play-banner').waitFor();
  if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 3000 }).catch(() => {});
  await until(() => page.evaluate(() => window.__cwViewport.warmed === window.__cwViewport.play && !!window.__cwViewport.play), 180000, 'Play to start');
  const machine = await page.evaluate(() => {
    const gl = window.__cwViewport.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const c = window.__cwViewport.renderer.domElement;
    return {
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      gpuVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      canvas: [c.width, c.height],
      pixelRatio: window.devicePixelRatio,
    };
  });
  // The player turns round slowly and walks about; a rocket every three seconds.
  await page.evaluate(() => {
    const p = window.__cwViewport.play;
    p.giveItem('Launcher', 1);
    p.giveItem('Rockets', 999);
    p.selectSlot(0);
    const t0 = performance.now();
    let fired = 0;
    window.__benchDrive = setInterval(() => {
      const q = window.__cwViewport.play;
      if (!q) return;
      const t = (performance.now() - t0) / 1000;
      q.setInput({ yaw: -0.6 + t * 0.5, pitch: -0.08 + Math.sin(t * 0.7) * 0.06, forward: Math.sin(t * 0.4) > -0.3 ? 1 : 0, right: Math.sin(t * 0.23) * 0.6 });
      if (t - fired > 3) {
        fired = t;
        q.useItem();
      }
    }, 16);
  });
  log(`warming up ${WARMUP} s…`);
  await sleep(WARMUP * 1000);
  await page.evaluate(() => window.__cwViewport.frames.take());
  log(`measuring ${SECONDS} s (leave the window alone)…`);
  const frames = { interval: [], tick: [], world: [], draw: [], draws: [], triangles: [] };
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    await sleep(Math.min(2000, end - Date.now()));
    const part = await page.evaluate(() => window.__cwViewport.frames.take());
    for (const k of Object.keys(frames)) frames[k].push(...part[k]);
  }
  await page.evaluate(() => clearInterval(window.__benchDrive));
  await fs.mkdir(resultsDir, { recursive: true });
  await page.screenshot({ path: path.join(resultsDir, 'last-run.png') });
  await quit(app);
  app = null;

  // ── 3. Results ──
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || 'unknown';
  const electronVersion = JSON.parse(await fs.readFile(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const at = (q) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? 0;
    const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
    return { mean: +mean.toFixed(2), median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), p99: +at(0.99).toFixed(2), worst: +(s[s.length - 1] ?? 0).toFixed(2) };
  };
  const n = frames.interval.length;
  const summary = {
    date: new Date().toISOString(),
    commit,
    seconds: SECONDS,
    software: SOFTWARE,
    scene: BENCH,
    machine: { ...machine, os: `${os.type()} ${os.release()} (${os.arch()})`, cpu: os.cpus()[0]?.model ?? '?', cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30), electron: electronVersion },
    frames: n,
    fps: +(n / SECONDS).toFixed(1),
    over33ms: frames.interval.filter((x) => x > 1000 / 30).length,
    over50ms: frames.interval.filter((x) => x > 50).length,
    ms: { frame: stat(frames.interval), tick: stat(frames.tick), world: stat(frames.world), draw: stat(frames.draw) },
    drawCalls: stat(frames.draws),
    triangles: stat(frames.triangles),
  };
  const stamp = summary.date.slice(0, 19).replace(/[:T]/g, '-');
  const base = path.join(resultsDir, `${stamp}-${commit}`);
  await fs.writeFile(`${base}.json`, JSON.stringify({ ...summary, raw: frames }, null, 1));
  const m = summary.ms;
  const row = (name, s) => `| ${name} | ${s.mean} | ${s.median} | ${s.p95} | ${s.p99} | ${s.worst} |`;
  const md = [
    `# Bench ${summary.date.slice(0, 16).replace('T', ' ')} (commit ${commit})`,
    '',
    `${summary.machine.gpu} · ${summary.machine.cpu} (${summary.machine.cores} threads, ${summary.machine.memoryGB} GB) · ${summary.machine.os} · Electron ${electronVersion} · canvas ${machine.canvas.join('×')}${SOFTWARE ? ' · software GPU' : ''}`,
    '',
    `**${summary.fps} fps** over ${SECONDS} s (${n} frames, no vsync); frames over 33 ms: ${summary.over33ms}, over 50 ms: ${summary.over50ms}.`,
    '',
    '| ms | mean | median | 95% | 99% | worst |',
    '|---|---|---|---|---|---|',
    row('whole frame', m.frame),
    row('game tick (world + moving what is drawn)', m.tick),
    row('world step alone', m.world),
    row('drawing (CPU side)', m.draw),
    '',
    `Draw calls: median ${summary.drawCalls.median}, worst ${summary.drawCalls.worst}. Triangles: median ${Math.round(summary.triangles.median).toLocaleString('en')}.`,
    '',
  ].join('\n');
  await fs.writeFile(`${base}.md`, md);
  console.log(`\n${md}`);
  log(`written: ${path.relative(root, base)}.md (send this one) and .json`);
} catch (e) {
  if (page) await fs.mkdir(resultsDir, { recursive: true }).then(() => page.screenshot({ path: path.join(resultsDir, 'failure.png') })).catch(() => {});
  console.error('[bench] failed:', e.message);
  process.exitCode = 1;
} finally {
  if (app) await quit(app);
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
