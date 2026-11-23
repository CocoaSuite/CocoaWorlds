// End-to-end: the snapping grid's size: ] coarser, [ finer, or picked from the command bar's Grid picker; saved with
// the project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('grid size: keys and picker', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  try {
    await newProject(page, 'Grid');
    const toolbar = page.getByRole('toolbar', { name: 'Tools' });
    assert.equal(await toolbar.getAttribute('aria-orientation'), 'horizontal');
    assert.equal(await toolbar.getByRole('combobox', { name: 'Grid size' }).count(), 1);
    const toolBox = await toolbar.boundingBox();
    const viewBox = await page.getByTestId('viewport').boundingBox();
    assert.ok(toolBox && viewBox && toolBox.y + toolBox.height <= viewBox.y);
    const size = () => page.evaluate(() => window.__cwStore.getState().session.project.settings.gridSize ?? 16);
    await page.getByTestId('viewport').hover();
    await page.keyboard.press(']');
    await until(size, 32, 3000);
    await page.keyboard.press('[');
    await page.keyboard.press('[');
    await until(size, 8, 3000);
    await page.getByRole('combobox', { name: 'Grid size' }).selectOption('2');
    await until(size, 2, 3000);
    const angle = page.getByRole('combobox', { name: 'Angle snap' });
    const snapping = () => page.evaluate(() => window.__cwStore.getState().snap);
    const snapAngle = () => page.evaluate(() => window.__cwStore.getState().snapAngle);
    assert.equal(await angle.inputValue(), '15');
    await angle.selectOption('45');
    await until(snapAngle, 45);
    await page.getByRole('button', { name: 'Snap On', exact: true }).click();
    await until(snapping, false);
    assert.equal(await snapAngle(), 45);
    await angle.selectOption('0');
    await until(snapAngle, 0);
    await page.getByRole('button', { name: 'Snap Off', exact: true }).click();
    await until(snapping, true);
    assert.equal(await snapAngle(), 0);
    assert.equal(await size(), 2);
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
