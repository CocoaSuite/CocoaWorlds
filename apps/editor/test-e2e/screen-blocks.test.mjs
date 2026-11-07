// End-to-end: blocks straight in the Screens workspace. A button gets a "When clicked" stack in the screens' own
// script, edited under the screen; in Play, clicking the button runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, pickBlock, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('screen blocks: a button click handled in the Screens workspace', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  try {
    await newProject(page, 'Shop');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [1024, 16, 1024], [-512, -16, -512]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Screens' }).click();
    await page.getByRole('button', { name: '+ Screen' }).click();
    await page.getByRole('list', { name: 'Screens' }).getByRole('switch', { name: 'Frees the mouse' }).click({ force: true });
    await page.getByRole('toolbar', { name: 'Add to screen' }).getByRole('button', { name: '+ Button' }).click();
    const props = page.getByRole('complementary', { name: 'Screen element' });
    await props.getByLabel('Name', { exact: true }).fill('Coin');
    await props.getByLabel('Name', { exact: true }).press('Enter');
    await props.getByLabel('Text', { exact: true }).fill('Get a coin');
    await props.getByLabel('Text', { exact: true }).press('Enter');

    // The stack, made from the button, with a block added in the editor under the screen.
    await props.getByRole('button', { name: '+ When clicked (blocks)' }).click();
    const blocks = page.getByRole('region', { name: 'Screen blocks' });
    const stack = blocks.getByRole('group', { name: 'When the player clicks a button on screen' });
    await stack.waitFor();
    assert.equal(await stack.getByLabel('When the player clicks', { exact: true }).locator('option:checked').textContent(), 'Screen › Coin');
    await stack.getByRole('button', { name: '+ Add a block' }).click();
    await pickBlock(page, 'Player and score › Change the score');
    await shot(page, 'sb01-screens');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    const layer = page.getByTestId('ui-layer');
    for (let i = 0; i < 2; i++) await layer.getByRole('button', { name: 'Get a coin' }).click();
    await until(() => page.evaluate(() => window.__cwViewport.play.world.playerStatus().score), 2, 8000);
    await page.keyboard.press('F5');
  } catch (e) {
    await shot(page, 'sb-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
