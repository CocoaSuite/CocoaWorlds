// End-to-end: looking at a door that opens with E shows “E  Open” under the crosshair; using it opens the door.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('use prompt near a door', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const item = (name) => page.getByRole('tree').getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  try {
    await newProject(page, 'Door E');
    await page.keyboard.press('2');
    for (const [size, corner] of [
      [[1024, 16, 1024], [-512, -16, -512]],
      [[128, 128, 16], [-64, 0, -96]],
    ]) {
      await page.keyboard.press('b');
      await drawBrush(page);
      await setDraft(page, size, corner);
      await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
      await page.keyboard.press('v');
    }
    await item('block_2').click();
    await insp().getByRole('button', { name: 'Recipes…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Door that opens when used/ }).click();
    const panel = page.getByRole('region', { name: 'Script of block_2' });
    // The prompt word is editable on the block.
    assert.equal(await panel.getByLabel('showing', { exact: true }).inputValue(), 'Open');

    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await page.getByTestId('use-prompt').waitFor();
    assert.equal((await page.getByTestId('use-prompt').textContent()).trim(), 'EOpen');
    await shot(page, 'u01-prompt');
    await page.keyboard.press('e');
    // The door slides up out of reach: the prompt goes away.
    await until(() => page.getByTestId('use-prompt').count(), 0, 3000);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'u-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
