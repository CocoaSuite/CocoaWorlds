// End-to-end: Z is up in what the editor shows (the default), the engine staying Y-up: the Inspector's Z is the
// height and Y the depth (negated, as in Blender); scale swaps Y and Z; switching it off shows Y-up again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('z is up: inspector shows Blender axes, the scene keeps Y-up', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir, { zUp: true });
  try {
    await newProject(page, 'ZUp');
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Empty object' }).click();
    const z = page.getByLabel('Position Z', { exact: true });
    await z.fill('100');
    await z.press('Enter');
    const y = page.getByLabel('Position Y', { exact: true });
    await y.fill('40');
    await y.press('Enter');
    // Stored Y-up: height 100, depth −40.
    const at = await page.evaluate(() => {
      const s = window.__cwStore.getState();
      return s.doc.get(s.selection[0]).transform.position;
    });
    assert.deepEqual([Math.round(at[1]), Math.round(at[2])], [100, -40]);
    await shot(page, 'z-up');
    // Off: Y-up again.
    await page.getByRole('menubar').getByRole('button', { name: 'View' }).click();
    await page.getByRole('menuitem', { name: /Z is up/ }).click();
    await until(() => page.getByLabel('Position Y', { exact: true }).inputValue(), '100', 4000);
  } catch (e) {
    await shot(page, 'z-up-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
