#!/usr/bin/env node
// The frame-time bench: plays the bench scene (scene.ts) in the editor for a while and writes frame times.
// How to use it: README.md in this folder. Usage: npm run bench [-- --seconds 30] [--software] [--build] [--breakdown]
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
/** --project <folder>: play a copy of this project (its first scene) instead of the bench level. */
const PROJECT = option('project', null);
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

/** A CPU profile as two short tables: ms per frame in each function itself, and with all it calls. */
function profileTable(profile, frames) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const name = (n) => {
    const f = n.callFrame;
    return f.url ? `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}` : f.functionName || '(native)';
  };
  const self = new Map(), total = new Map();
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i] ?? 0;
    const k = name(byId.get(id));
    self.set(k, (self.get(k) ?? 0) + dt);
    const seen = new Set();
    for (let c = id; c; c = parent.get(c)) {
      const kk = name(byId.get(c));
      if (seen.has(kk)) continue;
      seen.add(kk);
      total.set(kk, (total.get(kk) ?? 0) + dt);
    }
  });
  const top = (m, count) =>
    [...m]
      .filter(([k]) => k !== '(root)' && k !== '(idle)')
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([k, t]) => [k, +(t / 1000 / frames).toFixed(2)]);
  return { self: top(self, 25), total: top(total, 40) };
}

async function quit(app) {
  const killer = setTimeout(() => app.process().kill('SIGKILL'), 8000);
  await app.close().catch(() => {});
  clearTimeout(killer);
}

let app, page;
const resultsDir = path.join(here, 'results');
try {
  let projectName = 'Bench';
  if (PROJECT) {
    // A copy, so the original is never touched (Play can save progress, and the editor may tidy files on open).
    const src = path.resolve(PROJECT);
    const file = (await fs.readdir(src)).find((f) => f.endsWith('.cwproj'));
    if (!file) throw new Error(`no .cwproj file in ${src}`);
    projectName = JSON.parse(await fs.readFile(path.join(src, file), 'utf8')).name ?? path.basename(src);
    log(`copying ${projectName} from ${src}…`);
    await fs.mkdir(projectsDir, { recursive: true });
    await fs.cp(src, path.join(projectsDir, path.basename(src)), { recursive: true, filter: (f) => !/[\\/](node_modules|\.git|export|builds?)$/.test(f) });
    // Listed under Projects, as if opened before.
    await fs.mkdir(userData, { recursive: true });
    await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ recent: [{ name: projectName, dir: path.join(projectsDir, path.basename(src)), openedAt: new Date().toISOString() }] }));
  } else {
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
  }

  // Open it and play.
  log('opening it…');
  ({ app, page } = await launch());
  const esc = projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('button', { name: new RegExp(esc) }).first().click();
  await page.getByRole('tree').getByRole('treeitem', PROJECT ? {} : { name: /crate/ }).first().waitFor();
  await until(() => page.evaluate(() => !!window.__cwViewport && !window.__cwViewport.world.building), 120000, 'the level to build');
  await sleep(1000);
  log('playing…');
  if (process.env.CW_BENCH_DEBUG) {
    page.on('console', (m) => log('page:', m.text().slice(0, 600)));
    await page.evaluate(() => window.__cwViewport.renderer.domElement.addEventListener('webglcontextlost', () => console.log('CONTEXT LOST at', performance.now().toFixed(0), 'play:', !!window.__cwViewport.play, 'warmed:', window.__cwViewport.warmed === window.__cwViewport.play)));
  }
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
  // The player turns round slowly and walks about; on the bench level, a rocket every three seconds. (In a project of
  // your own nothing is given or fired: only turning and walking.)
  await page.evaluate((own) => {
    const p = window.__cwViewport.play;
    if (!own) {
      p.giveItem('Launcher', 1);
      p.giveItem('Rockets', 999);
      p.selectSlot(0);
    }
    const t0 = performance.now();
    let fired = 0;
    window.__benchDrive = setInterval(() => {
      const q = window.__cwViewport.play;
      if (!q) return;
      const t = (performance.now() - t0) / 1000;
      q.setInput({ yaw: -0.6 + t * 0.5, pitch: -0.08 + Math.sin(t * 0.7) * 0.06, forward: Math.sin(t * 0.4) > -0.3 ? 1 : 0, right: Math.sin(t * 0.23) * 0.6 });
      if (!own && t - fired > 3) {
        fired = t;
        q.useItem();
      }
    }, 16);
  }, !!PROJECT);
  log(`warming up ${WARMUP} s…`);
  await sleep(WARMUP * 1000);
  // Where the draw calls come from, over a few frames (--breakdown): each shadow-casting light, each render.
  let breakdown = null;
  if (flag('breakdown')) {
    log('counting draw calls per pass…');
    breakdown = await page.evaluate(async (frames) => {
      window.__benchDebug = true;
      const r = window.__cwViewport.renderer, info = r.info.render, sm = r.shadowMap;
      const counts = {}, times = {};
      const add = (k, n) => (counts[k] = (counts[k] ?? 0) + n);
      // (Time per pass with the card's work waited for: gl.finish() after each, so its cost lands on the pass.)
      const gl = r.getContext();
      const timed = (k, t0) => {
        gl.finish();
        times[k] = (times[k] ?? 0) + performance.now() - t0;
      };
      const smRender = sm.render;
      let inShadow = 0;
      sm.render = function (lights, scene, camera) {
        for (const l of lights) {
          if (!l.castShadow) continue;
          const c0 = info.calls, t0 = performance.now();
          smRender.call(this, [l], scene, camera);
          add(`shadow: ${l.type}${l.name ? ` ${l.name}` : ''}`, info.calls - c0);
          timed(`shadow: ${l.type}${l.name ? ` ${l.name}` : ''}`, t0);
          inShadow += info.calls - c0;
        }
      };
      const render = r.render;
      r.render = function (scene, camera) {
        const c0 = info.calls, s0 = inShadow, t = r.getRenderTarget();
        const shadowMs = () => Object.entries(times).reduce((a, [k, v]) => a + (k.startsWith('shadow:') ? v : 0), 0);
        const t0 = performance.now(), sh0 = shadowMs();
        render.call(this, scene, camera);
        const where = t ? (t.isWebGLCubeRenderTarget ? 'reflection capture' : 'to a texture') : 'screen';
        add(`${where}: ${scene.name || scene.type} (${camera.type})`, info.calls - c0 - (inShadow - s0));
        // (Its shadows' time is counted under them, not twice.)
        timed(`${where}: ${scene.name || scene.type} (${camera.type})`, t0 + (shadowMs() - sh0));
      };
      // (Frames from before the counting are dropped; then wait for frames drawn with it, two minutes at most.)
      window.__cwViewport.frames.take();
      let n = 0;
      const until = performance.now() + 120000;
      while (n < frames && performance.now() < until) {
        await new Promise((res) => setTimeout(res, 100));
        n += window.__cwViewport.frames.take().interval.length;
      }
      sm.render = smRender;
      r.render = render;
      if (window.__benchDebug) console.log('breakdown', n, JSON.stringify(counts), 'lost:', r.getContext().isContextLost());
      n = Math.max(1, n);
      return {
        frames: n,
        perFrame: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v / n)])),
        msPerFrame: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, +(v / n).toFixed(2)])),
      };
    }, SOFTWARE ? 3 : 120);
  }
  // Where the UI thread's time goes, function by function (--profile).
  const cdp = flag('profile') ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    await cdp.send('Profiler.start');
  }
  await page.evaluate(() => window.__cwViewport.frames.take());
  log(`measuring ${SECONDS} s (leave the window alone)…`);
  const frames = { interval: [], tick: [], world: [], draw: [], draws: [], triangles: [] };
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    await sleep(Math.min(2000, end - Date.now()));
    const part = await page.evaluate(() => window.__cwViewport.frames.take());
    for (const k of Object.keys(frames)) frames[k].push(...part[k]);
  }
  const cpuProfile = cdp ? (await cdp.send('Profiler.stop')).profile : null;
  await page.evaluate(() => clearInterval(window.__benchDrive));
  await fs.mkdir(resultsDir, { recursive: true });
  await page.screenshot({ path: path.join(resultsDir, 'last-run.png'), timeout: 180000 }).catch(() => log('(no picture of the last frame: it took too long)'));
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
  const profile = cpuProfile ? profileTable(cpuProfile, Math.max(1, n)) : null;
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
    ...(breakdown ? { breakdown } : {}),
    ...(profile ? { profile } : {}),
  };
  const stamp = summary.date.slice(0, 19).replace(/[:T]/g, '-');
  const base = path.join(resultsDir, `${stamp}-${commit}`);
  await fs.writeFile(`${base}.json`, JSON.stringify({ ...summary, raw: frames }, null, 1));
  const m = summary.ms;
  const row = (name, s) => `| ${name} | ${s.mean} | ${s.median} | ${s.p95} | ${s.p99} | ${s.worst} |`;
  const md = [
    `# Bench ${summary.date.slice(0, 16).replace('T', ' ')} (commit ${commit})${PROJECT ? ` · project: ${projectName}` : ''}`,
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
    ...(breakdown
      ? ['| By pass, per frame | draw calls | ms (card waited for) |', '|---|---|---|', ...Object.entries(breakdown.perFrame).map(([k, v]) => `| ${k} | ${v} | ${breakdown.msPerFrame[k] ?? ''} |`), '']
      : []),
    ...(profile
      ? [
          '| UI thread, ms per frame: in the function itself | |',
          '|---|---|',
          ...profile.self.map(([k, v]) => `| ${k} | ${v} |`),
          '',
          '| UI thread, ms per frame: the function and all it calls | |',
          '|---|---|',
          ...profile.total.map(([k, v]) => `| ${k} | ${v} |`),
          '',
        ]
      : []),
  ].join('\n');
  await fs.writeFile(`${base}.md`, md);
  if (cpuProfile) await fs.writeFile(`${base}.cpuprofile`, JSON.stringify(cpuProfile));
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
