// End-to-end: Play puts you in the player's shoes: click to capture the mouse, walk into a zone, use a wall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner, trigger = false) {
  if (trigger) await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Trigger zone' }).click();
  else await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('play as the player', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const consoleText = () => page.getByRole('log').textContent();
  const feet = () => page.evaluate(() => window.__cwViewport.play.world.player.feetPosition);
  try {
    await newProject(page, 'Walker');
    await page.keyboard.press('2');
    await addBrush(page, [1024, 16, 1024], [-512, -16, -512]);
    // The starter scene's Player start is at the origin, facing −Z: a zone ahead, then a wall.
    await addBrush(page, [128, 100, 128], [-64, 0, -300], true);
    await addBrush(page, [256, 128, 16], [-128, 0, -420]);

    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(async () => (await consoleText()).includes('Playing as the player'), true, 10000);
    // Capture the mouse (Play may already have; otherwise “Click to play”).
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await until(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''), 'CANVAS');
    await page.locator('.cw-crosshair').waitFor();

    // Standing on the floor at eye height.
    await until(async () => { const y = (await feet()).y; return y > -1 && y < 2; }, true);

    // Walk forward: into the zone, up to the wall.
    await page.keyboard.down('w');
    // (Generous: the test display can run the game at a third of real speed.)
    await until(async () => (await consoleText()).includes('The player entered trigger'), true, 15000);
    await until(async () => (await feet()).z < -380, true, 15000);
    await page.keyboard.up('w');
    const stoppedAt = (await feet()).z;
    assert.ok(stoppedAt > -404 + 16 - 2, `stopped at the wall, not through it (${stoppedAt})`);
    await shot(page, 'pl01-at-wall');

    // Use the wall in front.
    await page.keyboard.press('e');
    await until(async () => (await consoleText()).includes('The player used block_2'), true, 3000);

    // Game keys don't reach the editor: Ctrl+Z (crouch + Z) did not undo anything.
    await page.keyboard.press('Control+z');

    // Esc frees the mouse, Esc again stops.
    await page.keyboard.press('Escape');
    await page.getByTestId('click-to-play').waitFor();
    await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
    assert.equal(await page.getByRole('tree').getByRole('treeitem', { name: /(^|\s)block_2(\s|$)/ }).count(), 1);
  } catch (e) {
    await shot(page, 'pl-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
