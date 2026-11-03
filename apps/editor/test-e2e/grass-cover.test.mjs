// End-to-end: Foliage on a model (not only brushes and terrains), with Grass on top: a grass layer over its
// material where it faces up, and tufts only there; switching it off removes the layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('grass on top: a model grows grass and a grass layer', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Cover');
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Chicken (enemy)' }).click();
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Foliage/ }).click();
    const covers = () => page.evaluate(() => window.__cwViewport.foliage.group.children.filter((o) => o.name === 'grass-cover').length);
    await until(covers, 1, 15000);
    const tufts = await page.evaluate(() => window.__cwViewport.foliage.count);
    assert.ok(tufts > 0, `tufts ${tufts}`);
    await page.getByTestId('viewport').hover();
    await page.keyboard.press('f');
    await new Promise((r) => setTimeout(r, 1000));
    await shot(page, 'grass-cover');
    await insp.getByRole('switch', { name: 'Grass on top' }).click();
    await until(covers, 0, 8000);
  } catch (e) {
    await shot(page, 'grass-cover-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
