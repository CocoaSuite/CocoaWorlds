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
    await setDraft(page, [1536, 16, 1536], [-768, -16, -768]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Foliage/ }).click();
    const tufts = () => page.evaluate(() => window.__cwViewport.foliage.count);
    await until(async () => (await tufts()) > 500, true, 10000);
    const saved = await tufts();
    const block = async (size, corner) => {
      await page.keyboard.press('2'); await page.keyboard.press('b'); await drawBrush(page);
      await setDraft(page, size, corner);
      await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
      await page.keyboard.press('v');
    };
    // A crate standing on the grass clears it underneath…
    await block([128, 64, 128], [-64, 0, -64]);
    await until(async () => (await tufts()) < saved - 100, true, 10000);
    const cleared = await tufts();
    await block([160, 2, 64], [-80, 0, 80]);
    await until(async () => (await tufts()) < cleared - 60, true, 10000);
    await page.getByRole('radio', { name: 'Perspective' }).click();
    await page.getByRole('tree').getByRole('treeitem', { name: 'block_3' }).click();
    await page.getByTestId('viewport').hover(); await page.keyboard.press('f');
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, 'foliage-crate');
    // …a pebble doesn't (too small)…
    const withSlab = await tufts();
    await block([16, 16, 16], [200, 0, 200]);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await tufts(), withSlab);
    // …and the crate can be set to let grass grow under it.
    await page.getByRole('tree').getByRole('treeitem', { name: 'block_2' }).click();
    await insp.getByRole('switch', { name: 'Clears grass under it' }).click();
    await until(async () => (await tufts()) > withSlab, true, 10000);
    await page.getByRole('tree').getByRole('treeitem', { name: 'block', exact: true }).click();
    await page.getByTestId('viewport').hover(); await page.keyboard.press('f');
    await shot(page, 'foliage01');
    // A chicken (a creature: it moves about) leaves the grass alone by default, and says so in the Inspector.
    const beforeChicken = await tufts();
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Chicken (enemy)' }).click();
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(await tufts(), beforeChicken);
    assert.equal(await insp.getByRole('switch', { name: 'Clears grass under it' }).isChecked(), false);
    // View › Show grass hides it in the editor, and shows it again.
    const grassShown = () => page.evaluate(() => window.__cwViewport.foliage.group.visible);
    await page.getByRole('menubar').getByRole('button', { name: 'View' }).click();
    await page.getByRole('menuitemcheckbox', { name: /Show grass/ }).click();
    await until(grassShown, false, 4000);
    await page.getByRole('menubar').getByRole('button', { name: 'View' }).click();
    await page.getByRole('menuitemcheckbox', { name: /Show grass/ }).click();
    await until(grassShown, true, 4000);
    const before = await tufts();
    // Play: the same tufts are drawn in the game, and the player can still stand on the block.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await until(() => page.evaluate(() => !!window.__cwViewport.play), true, 15000);
    const inGame = await page.evaluate(() => {
      let n = 0;
      window.__cwViewport.play.group.traverse((o) => { if (o.isInstancedMesh && o.name.startsWith('foliage:') && o.name.endsWith(':lod0')) n += o.count; });
      return n;
    });
    assert.equal(inGame, before);
    // Level of detail: full blades near the player, simpler ones further out (and every tuft at one level at most).
    // (Once the game has drawn a frame from the player's eyes: the first can take a while in software.)
    await until(() => page.evaluate(() => window.__cwViewport.play.foliage.shown[1] > 0), true, 20000);
    const shown = await page.evaluate(() => window.__cwViewport.play.foliage.shown);
    assert.ok(shown[0] > 0 && shown[1] > 0, `levels ${shown}`);
    assert.ok(shown[0] + shown[1] + shown[2] <= saved && shown[0] < saved / 2, `levels ${shown} of ${saved}`);
    await shot(page, 'foliage02');
  } catch (e) {
    await shot(page, 'foliage-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
