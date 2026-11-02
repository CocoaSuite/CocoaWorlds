// End-to-end (A1): two path points chained in the Inspector (drawn as a route), a platform with a Train
// component on them; in Play it moves from the first point to the second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

test('trains follow paths', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = page.getByRole('complementary', { name: 'Inspector' });
  const tree = page.getByRole('tree');
  try {
    await newProject(page, 'Railway');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [1024, 16, 1024], [-512, -16, -512]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');

    // Two path points: start at (−256, 64, −256), end at (256, 64, −256).
    for (const [name, x] of [['start', -256], ['end', 256]]) {
      await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
      await page.getByRole('menuitem', { name: 'Empty object' }).click();
      const field = insp.getByLabel('Name', { exact: true }).first();
      await field.fill(name);
      await field.press('Enter');
      await tree.getByRole('treeitem', { name }).waitFor();
      await setField(insp, 'Position X', x);
      await setField(insp, 'Position Y', 64);
      await setField(insp, 'Position Z', -256);
      await insp.getByRole('button', { name: 'Add component' }).click();
      await page.getByRole('menuitem', { name: /^Path point/ }).click();
    }
    await tree.getByRole('treeitem', { name: 'start' }).click();
    await insp.getByRole('group', { name: 'Path point' }).getByRole('combobox', { name: 'Next point' }).selectOption({ label: 'end' });

    // A platform riding on them.
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [128, 16, 128], [-64, 0, 64]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await tree.getByRole('treeitem', { name: 'block_2' }).click();
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Train/ }).click();
    const train = insp.getByRole('group', { name: 'Train' });
    await train.getByRole('combobox', { name: 'First point' }).selectOption({ label: 'start' });
    await until(() => page.evaluate(() => !!window.__cwViewport.scene.getObjectByName('paths')), true);
    await page.keyboard.press('1');
    await shot(page, 'r01-path');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(() => page.evaluate(() => !!window.__cwViewport.play), true, 10000);
    const x = () => page.evaluate(() => {
      const w = window.__cwViewport.play.world;
      return w.positionOf(w.doc.entities.find((e) => e.name === 'block_2').id)[0];
    });
    // From the first point (x −256) towards the second (x 256) at 100 u/s.
    await until(async () => (await x()) > -200, true, 8000);
    await until(async () => Math.abs((await x()) - 256) < 1, true, 20000);
    assert.ok(Math.abs((await x()) - 256) < 1);
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'r-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
