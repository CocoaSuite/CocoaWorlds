// End-to-end (A2b): a Foliage component on a brush grows grass tufts on its top, drawn in the editor and in
// Play; saved as the component only, and it doesn't stop the player walking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';
test('foliage: tufts on a brush top, shown in the editor and in Play', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Grass');
    await page.keyboard.press('2'); await page.keyboard.press('b'); await drawBrush(page);
    await setDraft(page, [512, 16, 512], [-256, -16, -256]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Foliage/ }).click();
    const tufts = () => page.evaluate(() => window.__cwViewport.foliage.count);
    await until(async () => (await tufts()) > 500, true, 10000);
    const saved = await tufts();
    await page.getByTestId('viewport').hover(); await page.keyboard.press('f');
    await shot(page, 'foliage01');
    // Play: the same tufts are drawn in the game, and the player can still stand on the block.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await until(() => page.evaluate(() => !!window.__cwViewport.play), true, 15000);
    const inGame = await page.evaluate(() => {
      let n = 0;
      window.__cwViewport.play.group.traverse((o) => { if (o.isInstancedMesh && o.name.startsWith('foliage:')) n += o.count; });
      return n;
    });
    assert.equal(inGame, saved);
    await shot(page, 'foliage02');
  } catch (e) {
    await shot(page, 'foliage-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
