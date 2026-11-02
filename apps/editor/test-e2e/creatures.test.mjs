// End-to-end (A1): an enemy creature added in the Inspector; in Play it comes for the player and hurts them,
// and the player's pistol brings it down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

test('creatures: an enemy hunts the player and can be shot', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = page.getByRole('complementary', { name: 'Inspector' });
  try {
    await newProject(page, 'Xen');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [2048, 16, 2048], [-1024, -16, -1024]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');

    // An enemy 500 ahead, turned to face the Player start.
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Empty object' }).click();
    await setField(insp, 'Position Z', -500);
    await setField(insp, 'Rotation Y', 180);
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Creature/ }).click();
    const npc = insp.getByRole('group', { name: 'Creature' });
    await npc.getByLabel('Health', { exact: true }).fill('24');
    await npc.getByLabel('Health', { exact: true }).press('Enter');
    await page.keyboard.press('1');
    await shot(page, 'c01-creature');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await until(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''), 'CANVAS');
    await until(() => page.evaluate(() => !!window.__cwViewport.play), true, 10000);
    const npcState = () => page.evaluate(() => window.__cwViewport.play.world.npcStates()[0]);
    await until(async () => ['chase', 'attack'].includes((await npcState()).state), true, 8000);
    // (500 u at 150 u/s, on a test renderer that can run the game at a third of real speed.)
    await until(async () => (await npcState()).state === 'attack', true, 30000);
    await until(() => page.evaluate(() => window.__cwViewport.play.world.playerStatus().health < 100), true, 5000);
    await shot(page, 'c02-attacked');

    // Shoot it down (a pistol given here: weapons are tested on their own).
    await page.evaluate(() => {
      const w = window.__cwViewport.play.world;
      w.ui.items.push({ name: 'Pistol', icon: '', weapon: { kind: 'bullet', damage: 8, rate: 4, automatic: false, range: 8192, spread: 0, pellets: 1, ammo: '', speed: 0, arc: false, blast: 0, push: 100, sound: '' } });
      w.giveItem('Pistol', 1);
      w.selectSlot(0);
    });
    const box = await page.getByTestId('viewport').boundingBox();
    for (let i = 0; i < 12 && (await npcState()).alive; i++) {
      await page.evaluate(() => {
        const w = window.__cwViewport.play.world;
        const n = w.npcStates()[0];
        const f = w.player.feetPosition;
        // Aim at its middle.
        w.setPlayerInput({ yaw: Math.atan2(-(n.feet[0] - f.x), -(n.feet[2] - f.z)), pitch: -0.25 });
      });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await new Promise((r) => setTimeout(r, 700));
    }
    assert.equal((await npcState()).alive, false);
    await shot(page, 'c03-down');
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'c-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
