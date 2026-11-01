// End-to-end: put a ready-made recipe on a door, see its blocks and zone, play it as the player, undo it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('recipe: door that opens when the player comes near', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const doorY = () =>
    page.evaluate(() => {
      const w = window.__cwViewport.play.world;
      const u = w.movingBodies().find((b) => b.kind === 'unit');
      return u ? Math.round(w.positionOf(u.id)[1]) : null;
    });
  try {
    await newProject(page, 'Recipe Door');
    await page.keyboard.press('2');
    for (const [size, corner] of [
      [[1024, 16, 1024], [-512, -16, -512]],
      [[128, 128, 16], [-64, 0, -320]],
    ]) {
      await page.keyboard.press('b');
      await drawBrush(page);
      await setDraft(page, size, corner);
      await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
      await page.keyboard.press('v');
    }

    // 1. The door (block_2) gets the recipe from the Inspector.
    await item('block_2').click();
    await insp().getByRole('button', { name: 'Recipes…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Add a recipe to block_2').waitFor();
    await shot(page, 'r01-recipes');
    await dialog.getByRole('button', { name: /Door that opens when the player comes near/ }).click();
    await item('block_2_zone').waitFor();
    // Its blocks are ordinary blocks in the Visual script tab.
    const panel = page.getByRole('region', { name: 'Script of block_2' });
    await panel.getByRole('group', { name: 'When something enters a zone' }).waitFor();
    await panel.getByRole('group', { name: 'When something leaves a zone' }).waitFor();
    await page.getByRole('tab', { name: /Problems/ }).waitFor();
    assert.equal(await page.getByRole('tab', { name: /Problems \d/ }).count(), 0, 'no problems');
    await shot(page, 'r02-blocks');

    // 2. Play: walk to the door, it slides up; walk back, it comes down.
    await page.keyboard.press('F5');
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click();
    await until(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''), 'CANVAS');
    await until(doorY, 64);
    await page.keyboard.down('w');
    // (Generous waits: the test display renders slowly, so the game runs slower than real time.)
    await until(doorY, 192, 15000);
    await page.keyboard.up('w');
    await shot(page, 'r03-open');
    await page.keyboard.down('s');
    await until(doorY, 64, 15000);
    await page.keyboard.up('s');
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);

    // 3. One undo takes away both the zone and the blocks.
    await page.keyboard.press('Control+z');
    await until(() => item('block_2_zone').count(), 0);
    await item('block_2').click();
    await panel.getByRole('group', { name: 'When something enters a zone' }).waitFor({ state: 'detached' });
  } catch (e) {
    await shot(page, 'r-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
