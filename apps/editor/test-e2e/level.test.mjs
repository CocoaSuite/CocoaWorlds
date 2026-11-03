// End-to-end: a polygon brush drawn corner by corner, and a level big enough to build in the background.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, quit, setField, shot, tempDirs, until } from './helpers.mjs';

const screenOf = (page, p) => page.evaluate((p) => window.__cwViewport.toScreen(p), p);

test('polygon brush and background level builds', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const sceneFile = path.join(projectsDir, 'level', 'scenes', 'level_01.cwscene');
  try {
    await newProject(page, 'Level');
    await page.keyboard.press('2');

    // 1. Polygon brush: five corners clicked in the top view, closed by clicking the first, depth typed.
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Brush shapes' }).click(); await page.getByRole('button', { name: 'Polygon brush' }).click();
    const panel = page.getByRole('group', { name: 'Brush tool' });
    await panel.getByText('Click to place the corners', { exact: false }).waitFor();
    const corners = [[0, 0], [128, 0], [192, 96], [64, 192], [-64, 96]];
    for (const [x, z] of corners) {
      const s = await screenOf(page, [x, 0, z]);
      await page.mouse.click(s.x, s.y);
    }
    await panel.getByText('Click the first corner', { exact: false }).waitFor();
    await shot(page, 'l01-polygon-outline');
    const first = await screenOf(page, [0, 0, 0]);
    await page.mouse.click(first.x, first.y);
    await panel.getByRole('button', { name: 'Create' }).waitFor();
    await setField(panel, 'Size Y', 96);
    await panel.getByRole('button', { name: 'Create' }).click();
    await item('prism').waitFor();
    await page.keyboard.press('v');
    await item('prism').click();
    assert.equal(await page.getByLabel('Size X', { exact: true }).inputValue(), '256');
    assert.equal(await page.getByLabel('Size Y', { exact: true }).inputValue(), '96');
    assert.equal(await page.getByLabel('Size Z', { exact: true }).inputValue(), '192');
    await page.keyboard.press('1');
    await page.keyboard.press('f');
    await shot(page, 'l02-polygon-prism');
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
    assert.equal(scene.entities.find((e) => e.name === 'prism').components.brush.faces.length, 7, 'five sides, top and bottom');

    // 2. Over 64 brushes: builds move to the background worker; the level still renders and picks.
    await page.keyboard.press('2');
    await item('prism').click();
    await page.keyboard.press('Control+c');
    for (let i = 0; i < 70; i++) await page.keyboard.press('Control+v');
    await until(() => tree().getByRole('treeitem').count(), 2 + 71, 15000);
    assert.equal(await page.evaluate(() => !!window.__cwViewport.world.worker), true, 'worker started');
    await until(() => page.getByTestId('viewport-stats').textContent().then((t) => t.includes('updating')), false, 15000);
    // 71 prisms × (5 sides × 2 + 2 caps × 3) triangles = 1,136 at least on screen.
    await page.keyboard.press('Escape');
    await page.keyboard.press('f');
    await page.keyboard.press('1');
    await page.keyboard.press('f');
    await shot(page, 'l03-many');
    // Move one far prism: the change lands through the worker.
    const last = (await tree().getByRole('treeitem').allTextContents()).at(-1).trim();
    await item(last).click();
    const before = Number(await page.getByLabel('Centre X', { exact: true }).inputValue());
    await setField(page, 'Centre X', before + 512);
    await until(() => page.getByTestId('viewport-stats').textContent().then((t) => t.includes('updating')), false, 15000);
    const pieces = await page.evaluate(() => window.__cwViewport.world.stats.solids);
    assert.equal(pieces, 71);
  } catch (e) {
    await shot(page, 'l-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
