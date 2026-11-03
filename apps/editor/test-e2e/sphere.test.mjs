// End-to-end: the Sphere brush from the tool bar, with its number of sides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs } from './helpers.mjs';

test('sphere brush', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const item = (name) => page.getByRole('tree').getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  try {
    await newProject(page, 'Ball');
    await page.keyboard.press('2');
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Brush shapes' }).click(); await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Sphere brush' }).click();
    const panel = page.getByRole('group', { name: 'Brush tool' });
    await panel.getByRole('radio', { name: 'Sphere' }).waitFor();
    const sides = panel.getByLabel('Sides', { exact: true });
    await sides.fill('12');
    await sides.press('Enter');
    await drawBrush(page);
    await setDraft(page, [128, 128, 128], [-64, 0, -64]);
    await panel.getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await item('sphere').waitFor();
    await page.keyboard.press('1');
    await shot(page, 'sp01-sphere');
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(path.join(projectsDir, 'ball', 'scenes', 'level_01.cwscene'), 'utf8'));
    const s = scene.entities.find((e) => e.name === 'sphere');
    // 12 around × 6 rings.
    assert.equal(s.components.brush.faces.length, 72);
  } catch (e) {
    await shot(page, 'sp-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
