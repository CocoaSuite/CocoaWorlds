// End-to-end: the Plants workspace: new plants from preset tiles, reset a changed field, undo, seed variants,
// rename, and your own presets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('plants workspace: presets, reset, undo, variants, rename, own presets', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Plants');
    await page.getByRole('tab', { name: 'Plants' }).click();
    // Preset tiles, with pictures.
    await page.getByRole('button', { name: '+ Willow' }).click();
    await until(() => page.locator('.cw-plants-tile img').count(), 8, 10000);
    const items = page.getByRole('listbox', { name: 'Project plants' }).getByRole('option');
    await until(() => items.count(), 1, 4000);
    // A changed field shows ↺, which puts back the preset's value.
    const height = page.getByLabel('Height', { exact: true });
    await height.fill('700');
    await height.press('Enter');
    await until(() => page.getByRole('button', { name: 'Reset Height' }).count(), 1, 4000);
    await page.getByRole('button', { name: 'Reset Height' }).click();
    await until(() => height.inputValue(), '480', 4000);
    // Undo brings the change back.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await until(() => height.inputValue(), '700', 4000);
    // New crown shapes.
    await page.getByLabel('Crown', { exact: true }).selectOption('umbrella');
    // Variants: pick one, it becomes the seed.
    await page.getByRole('button', { name: 'Shuffle variants' }).click();
    const variants = page.getByRole('group', { name: 'Variants' }).getByRole('button');
    await until(() => variants.count(), 6, 4000);
    await until(() => page.locator('.cw-plants-variants img').count(), 6, 10000);
    const label = await variants.nth(2).getAttribute('aria-label');
    await variants.nth(2).click();
    await until(() => page.getByLabel('Seed', { exact: true }).inputValue(), label.replace(/\D/g, ''), 4000);
    await shot(page, 'plants');
    // Rename by double-click.
    await items.first().dblclick();
    const name = page.getByRole('listbox', { name: 'Project plants' }).getByLabel('Name');
    await name.fill('Old oak');
    await name.press('Enter');
    await until(() => items.first().textContent(), 'Old oak', 4000);
    // Save as preset: a new tile under My presets that makes a copy.
    await page.getByRole('button', { name: 'Save as preset' }).click();
    await page.getByRole('button', { name: '+ Old oak' }).click();
    await until(() => items.count(), 2, 4000);
  } catch (e) {
    await shot(page, 'plants-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
