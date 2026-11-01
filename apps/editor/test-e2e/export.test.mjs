// End-to-end (benchmark step B4): Build… exports the game for the web and for this computer; both exported games
// run, and a game value marked “kept” carries over from one session to the next (saved progress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { _electron as electron, chromium } from 'playwright-core';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

const exists = (p) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false);

/** A Chromium to open the web game in: Playwright's own, or another installed version of it (CW_CHROMIUM). */
async function findChromium() {
  if (process.env.CW_CHROMIUM) return process.env.CW_CHROMIUM;
  if (await exists(chromium.executablePath())) return undefined;
  const root = path.dirname(path.dirname(path.dirname(chromium.executablePath())));
  for (const d of (await fs.readdir(root).catch(() => [])).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(root, d, 'chrome-linux64', 'chrome');
    if (await exists(p)) return p;
  }
  return null;
}

/** Serve a folder over http (web games need a web server). */
function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('export: web and desktop games, with saved progress', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const exportDir = path.join(tmp, 'exports');
  process.env.CW_EXPORT_DIR = exportDir;
  const { app, page } = await launch(userData, projectsDir);
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  try {
    await newProject(page, 'Coin Counter');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [1024, 16, 1024], [-512, -16, -512]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');

    // Cash, kept between sessions; every game start adds 1. A screen shows it.
    await page.getByRole('tree').getByRole('treeitem', { name: /block/ }).click();
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Script/ }).click();
    const panel = page.getByRole('region', { name: 'Script of block' });
    await panel.getByRole('button', { name: '+ Game value' }).click();
    // (Saved to the project file, so it shows a moment later.)
    await panel.getByRole('checkbox', { name: 'Cash: kept' }).click();
    await until(() => panel.getByRole('checkbox', { name: 'Cash: kept' }).isChecked(), true);
    await panel.getByRole('button', { name: '+ When…' }).click();
    await page.getByRole('menuitem', { name: 'When the game starts' }).click();
    const stack = panel.getByRole('group', { name: 'When the game starts' });
    await stack.getByRole('button', { name: '+ Add a block' }).click();
    await page.getByRole('menuitem', { name: 'Variables › Change a variable' }).click();
    await stack.getByLabel('Change', { exact: true }).selectOption({ label: 'Cash (game)' });
    const ws = page.getByRole('tablist', { name: 'Workspace' });
    await ws.getByRole('tab', { name: 'Screens' }).click();
    await page.getByRole('button', { name: '+ Screen' }).click();
    await page.getByRole('toolbar', { name: 'Add to screen' }).getByRole('button', { name: '+ Text' }).click();
    const text = page.getByRole('complementary', { name: 'Screen element' }).getByLabel('Text', { exact: true });
    await text.fill('Coins: {Cash}');
    await text.press('Enter');
    await ws.getByRole('tab', { name: 'Scene' }).click();

    // Play in the editor keeps it too: 1, then 2.
    for (const want of ['Coins: 1', 'Coins: 2']) {
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await page.getByTestId('ui-layer').getByText(want).waitFor();
      await page.keyboard.press('F5');
      await until(() => page.getByTestId('play-banner').count(), 0);
    }
    // Forget it: back to 1.
    await page.keyboard.press('Escape');
    await insp().getByRole('button', { name: 'Forget saved progress' }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('ui-layer').getByText('Coins: 1').waitFor();
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);

    // 1. Web.
    await page.getByRole('button', { name: 'Build…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Build the game' });
    await dialog.getByRole('radio', { name: 'Web' }).check();
    await shot(page, 'x01-build');
    await dialog.getByRole('button', { name: 'Export' }).click();
    await dialog.getByTestId('export-done').waitFor({ timeout: 60000 });
    const web = path.join(exportDir, 'Coin Counter (Web)');
    assert.ok(await exists(path.join(web, 'index.html')));
    const game = JSON.parse(await fs.readFile(path.join(web, 'game', 'game.json'), 'utf8'));
    assert.equal(game.format, 'cocoaworlds.game');
    assert.equal(game.values[0].saved, true);
    // Only the player's files, not the editor's.
    const files = await fs.readdir(path.join(web, 'assets'));
    assert.ok(files.some((f) => f.startsWith('player-')) && !files.some((f) => f.startsWith('index-')), files.join(' '));

    // 2. This computer (Linux here).
    await dialog.getByRole('radio', { name: 'Linux' }).check();
    await dialog.getByRole('button', { name: 'Export' }).click();
    await dialog.getByTestId('export-done').waitFor({ timeout: 120000 });
    const desk = path.join(exportDir, 'Coin Counter (Linux)');
    const program = path.join(desk, 'Coin Counter');
    assert.ok(await exists(program), 'the program is named after the game');
    assert.ok(await exists(path.join(desk, 'resources', 'app', 'web', 'index.html')));
    assert.ok(!(await exists(path.join(desk, 'resources', 'default_app.asar'))));
    await dialog.getByRole('button', { name: 'Close' }).click();
  } catch (e) {
    await shot(page, 'x-failure');
    throw e;
  } finally {
    await quit(app);
  }

  try {
    // The desktop game runs, and keeps Cash between its own sessions: 1, then 2.
    const desk = path.join(exportDir, 'Coin Counter (Linux)');
    for (const want of ['Coins: 1', 'Coins: 2']) {
      const g = await electron.launch({
        executablePath: path.join(desk, 'Coin Counter'),
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
        env: { ...process.env, XDG_CONFIG_HOME: path.join(tmp, 'config') },
      });
      const w = await g.firstWindow();
      w.on('pageerror', (e) => console.error('[game error]', e.stack));
      await w.getByText(want).waitFor({ timeout: 30000 });
      assert.equal(await w.title(), 'Coin Counter');
      if (want === 'Coins: 2' && process.env.CW_SHOTS_DIR) await w.screenshot({ path: path.join(process.env.CW_SHOTS_DIR, 'x02-desktop.png') });
      await quit(g);
    }

    // The web game runs from a web server.
    const server = await serve(path.join(exportDir, 'Coin Counter (Web)'));
    const executablePath = await findChromium();
    if (executablePath === null) {
      console.warn('No Chromium found: the web game was exported but not run.');
      server.close();
      return;
    }
    const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
      const p = await browser.newPage();
      p.on('pageerror', (e) => console.error('[web error]', e.stack));
      await p.goto(`http://127.0.0.1:${server.address().port}/`);
      await p.getByText('Coins: 1').waitFor({ timeout: 30000 });
      await p.reload();
      await p.getByText('Coins: 2').waitFor({ timeout: 30000 });
      if (process.env.CW_SHOTS_DIR) await p.screenshot({ path: path.join(process.env.CW_SHOTS_DIR, 'x03-web.png') });
    } finally {
      await browser.close();
      server.close();
    }
  } finally {
    delete process.env.CW_EXPORT_DIR;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
