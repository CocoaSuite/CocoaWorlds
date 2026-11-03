// End-to-end: the snapping grid's size: ] coarser, [ finer, or picked from the viewport's Grid readout; saved with
// the project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('grid size: keys and picker', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  try {
    await newProject(page, 'Grid');
    const size = () => page.evaluate(() => window.__cwStore.getState().session.project.settings.gridSize ?? 16);
    await page.getByTestId('viewport').hover();
    await page.keyboard.press(']');
    await until(size, 32, 3000);
    await page.keyboard.press('[');
    await page.keyboard.press('[');
    await until(size, 8, 3000);
    await page.getByRole('combobox', { name: 'Grid size' }).selectOption('2');
    await until(size, 2, 3000);
    await page.keyboard.press('2');
    await new Promise((r) => setTimeout(r, 500));
    await page.getByTestId('viewport').hover();
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -300);
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, 'grid-fine');
    assert.equal(await size(), 2);
  } catch (e) {
    await shot(page, 'grid-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
