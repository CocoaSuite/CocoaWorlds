// End-to-end: health and score on screen. A coin recipe adds to the score, the health bar drops when hurt,
// the new blocks are in the block menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('health and score', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const item = (name) => page.getByRole('tree').getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const consoleText = () => page.getByRole('tab', { name: 'Console' }).click().then(() => page.getByRole('log').textContent());
  try {
    await newProject(page, 'Coins');
    await page.keyboard.press('2');
    for (const [size, corner] of [
      [[1024, 16, 1024], [-512, -16, -512]],
      [[16, 32, 16], [-8, 16, -160]],
    ]) {
      await page.keyboard.press('b');
      await drawBrush(page);
      await setDraft(page, size, corner);
      await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
      await page.keyboard.press('v');
    }

    // 1. The small block becomes a coin.
    await item('block_2').click();
    await insp().getByRole('button', { name: 'Recipes…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Coin: \+1 score/ }).click();
    await item('block_2_zone').waitFor();
    const panel = page.getByRole('region', { name: 'Script of block_2' });
    await panel.getByRole('group', { name: 'Change the score' }).waitFor();
    // The new blocks are in the block menu.
    await panel.getByRole('button', { name: /Add a block/ }).first().click();
    await page.getByRole('menuitem', { name: 'Player and score › Hurt the player' }).waitFor();
    await page.keyboard.press('Escape');

    // 2. Play: full health, score 0; walk into the coin.
    await page.keyboard.press('F5');
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await page.getByTestId('hud').waitFor();
    assert.equal(await page.getByTestId('hud-health').textContent(), '100');
    assert.equal(await page.getByTestId('hud-score').textContent(), '0');
    await page.keyboard.down('w');
    await until(() => page.getByTestId('hud-score').textContent(), '1', 5000);
    await page.keyboard.up('w');

    // 3. Hurt: the bar drops and the screen flashes red; hurt to 0, the player starts again at full health.
    await page.evaluate(() => window.__cwViewport.play.hurt(80));
    await until(() => page.getByTestId('hud-health').textContent(), '20');
    await page.locator('.cw-hurt').waitFor();
    assert.equal(await page.getByRole('meter', { name: 'Health' }).getAttribute('aria-valuenow'), '20');
    await shot(page, 'h01-hurt');
    await page.evaluate(() => window.__cwViewport.play.hurt(50));
    await until(() => page.getByTestId('hud-health').textContent(), '100');

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
    assert.equal(await page.getByTestId('hud').count(), 0);
    // The console kept the story.
    const text = await consoleText();
    assert.ok(text.includes('Score: 1 (+1)'), text);
    assert.ok(text.includes('The player died (a test) and starts again'), text);

    // 4. A project without health: switch it off in the Inspector (nothing selected → scene and game rules).
    await page.keyboard.press('Escape');
    const healthSwitch = insp().getByRole('switch', { name: 'Player health' });
    assert.equal(await healthSwitch.isChecked(), true);
    await healthSwitch.click({ force: true });
    await until(() => healthSwitch.isChecked(), false);
    await new Promise((r) => setTimeout(r, 400));
    await shot(page, 'h02-rules');
    const project = JSON.parse(await fs.readFile(path.join(projectsDir, 'coins', 'project.cwproj'), 'utf8'));
    assert.deepEqual(project.settings.game, { health: false, score: true, thirdPerson: false, saveItems: false });
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await page.getByTestId('hud-score').waitFor();
    assert.equal(await page.getByTestId('hud-health').count(), 0);
    await page.evaluate(() => window.__cwViewport.play.hurt(500));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await page.evaluate(() => window.__cwViewport.play.status().deaths), 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'h-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
