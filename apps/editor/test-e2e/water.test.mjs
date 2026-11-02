// End-to-end (A1): water and ladders drawn with the Brush tool; in Play the player wades in, swims, dives
// (the view turns the water's colour) and climbs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner, kind = 'Solid') {
  await page.keyboard.press('b');
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('radio', { name: kind, exact: true }).click();
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('water and ladders', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const player = () => page.evaluate(() => {
    const p = window.__cwViewport.play.world.player;
    return { y: p.feetPosition.y, z: p.feetPosition.z, water: p.waterLevel, ladder: p.onLadder };
  });
  try {
    await newProject(page, 'Swimming');
    await page.keyboard.press('2');
    // A floor, a deep pool sunk into it ahead of the Player start, and a ladder up a wall to the side.
    await addBrush(page, [1024, 16, 512], [-512, -16, -128]);
    await addBrush(page, [1024, 16, 384], [-512, -176, -512]);
    await addBrush(page, [1024, 160, 16], [-512, -176, -528]);
    await addBrush(page, [16, 160, 384], [-528, -176, -512]);
    await addBrush(page, [16, 160, 384], [512, -176, -512]);
    await addBrush(page, [1024, 144, 384], [-512, -160, -512], 'Water');
    await addBrush(page, [64, 256, 16], [448, 0, 360], 'Solid');
    await addBrush(page, [48, 256, 12], [456, 0, 348], 'Ladder');
    const tree = page.getByRole('tree');
    await tree.getByRole('treeitem', { name: 'water' }).click();
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    await insp.getByText('Colour under water').waitFor();
    await tree.getByRole('treeitem', { name: 'ladder' }).click();
    await insp.getByText('Climb speed').waitFor();
    await page.keyboard.press('Escape');
    await shot(page, 'w01-editor');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await until(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''), 'CANVAS');

    // Walk forward (−Z) off the edge into the pool: swimming, unhurt.
    await page.keyboard.down('w');
    await until(async () => (await player()).water >= 2, true, 6000);
    await page.keyboard.up('w');
    // Dive (Crouch): the view goes the water's colour.
    await page.keyboard.down('c');
    await until(async () => (await player()).water, 3, 4000);
    await until(() => page.evaluate(() => window.__cwViewport.scene.fog?.color.getHexString()), '28607a', 3000);
    await shot(page, 'w02-underwater');
    await page.keyboard.up('c');
    assert.equal(await page.evaluate(() => window.__cwViewport.play.world.health), 100);

    // The ladder: put the player at its foot and climb.
    await page.evaluate(() => window.__cwViewport.play.world.player.teleport({ x: 480, y: 0, z: 300 }, Math.PI));
    await page.keyboard.down('w');
    await until(async () => (await player()).ladder, true, 4000);
    await until(async () => (await player()).y > 100, true, 4000);
    await page.keyboard.up('w');
    await shot(page, 'w03-ladder');
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'w-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
