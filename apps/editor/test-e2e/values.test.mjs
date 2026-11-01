// End-to-end (benchmark step B1): a text sign, a game value shown on screen, a message, and a block that
// changes the sign, all made in the editor and checked in Play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('game values, messages and text signs', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const item = (name) => page.getByRole('tree').getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const panel = () => page.getByRole('region', { name: 'Script of block' });
  try {
    await newProject(page, 'Tycoon');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [1024, 16, 1024], [-512, -16, -512]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');

    // 1. A text sign from the Add menu; its text is edited in the Inspector.
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Text sign' }).click();
    await item('sign').waitFor();
    // (The new sign is selected; the viewport knows its id.)
    const signEntity = await page.evaluate(() => window.__cwViewport.selection[0]);
    const field = insp().getByLabel('Text', { exact: true });
    await field.fill('Dropper: $10');
    await field.press('Enter');
    // In front of the Player start, at eye height.
    const z = insp().getByLabel('Position Z', { exact: true });
    await z.fill('-160');
    await z.press('Enter');
    await page.keyboard.press('1');
    await shot(page, 'v00-sign');
    await page.keyboard.press('2');

    // 2. A script on the floor: a game value Cash (shown on screen), and blocks that use it.
    await item('block').click();
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Script/ }).click();
    await panel().waitFor();
    await panel().getByRole('button', { name: '+ Game value' }).click();
    await panel().getByLabel('Game value name').waitFor();
    assert.equal(await panel().getByLabel('Game value name').inputValue(), 'Cash');
    await panel().getByRole('button', { name: '+ When…' }).click();
    await page.getByRole('menuitem', { name: 'When the game starts' }).click();
    const stack = panel().getByRole('group', { name: 'When the game starts' });
    await stack.getByRole('button', { name: '+ Add a block' }).click();
    await page.getByRole('menuitem', { name: 'Variables › Change a variable' }).click();
    await stack.getByLabel('Change', { exact: true }).selectOption({ label: 'Cash (game)' });
    const by = stack.getByLabel('Change by', { exact: true });
    await by.fill('25');
    await by.press('Enter');
    await stack.getByRole('button', { name: '+ Add a block' }).last().click();
    await page.getByRole('menuitem', { name: 'Screen and signs › Show a message on screen' }).click();
    const say = stack.getByLabel('Show on screen', { exact: true });
    await say.fill('Welcome to your tycoon');
    await say.press('Enter');
    await stack.getByRole('button', { name: '+ Add a block' }).last().click();
    await page.getByRole('menuitem', { name: 'Screen and signs › Set the text of a sign' }).click();
    await stack.getByLabel('Set the text of', { exact: true }).selectOption({ label: 'sign' });
    const to = stack.getByLabel('Set the text of to', { exact: true });
    await to.fill('Sold out');
    await to.press('Enter');
    assert.equal(await page.getByRole('tab', { name: /Problems \d/ }).count(), 0, 'no problems');
    await shot(page, 'v01-blocks');
    const project = JSON.parse(await fs.readFile(path.join(projectsDir, 'tycoon', 'project.cwproj'), 'utf8'));
    assert.deepEqual(project.settings.values, [{ name: 'Cash', type: 'number', initial: 0, show: true }]);

    // 3. Play: Cash on screen, the message, the sign changed.
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await page.getByTestId('hud-value-Cash').waitFor();
    await until(() => page.getByTestId('hud-value-Cash').textContent(), 'Cash25');
    await until(() => page.evaluate((id) => window.__cwViewport.play.signText(id), signEntity), 'Sold out');
    await page.getByTestId('hud-messages').getByText('Welcome to your tycoon').waitFor();
    const signId = await page.evaluate(() => {
      const play = window.__cwViewport.play;
      let id = null;
      play.group.traverse((o) => {
        if (o.name === 'sign') id = true;
      });
      return id;
    });
    assert.ok(signId, 'the sign is drawn in the game');
    await shot(page, 'v02-play');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
    // The scene's own sign is unchanged after Play.
    await item('sign').click();
    assert.equal(await insp().getByLabel('Text', { exact: true }).inputValue(), 'Dropper: $10');
  } catch (e) {
    await shot(page, 'v-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
