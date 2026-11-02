// End-to-end: the ready-made chicken (a rigged, animated model). Add › Chicken copies the model into the project
// once; in Play the enemy chicken comes and pecks the player, animated; the friendly one potters about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

test('the chicken: enemy and friend', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = page.getByRole('complementary', { name: 'Inspector' });
  const addMenu = async (label) => {
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: label }).click();
  };
  try {
    await newProject(page, 'Farm');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [2048, 16, 2048], [-1024, -16, -1024]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');

    // An enemy chicken ahead, facing the player; a friendly one off to the side.
    await addMenu('Chicken (enemy)');
    await page.getByRole('tree').getByRole('treeitem', { name: 'chicken', exact: true }).waitFor();
    await setField(insp, 'Position Z', -300);
    await setField(insp, 'Rotation Y', 180);
    assert.equal(await insp.getByLabel('Scale X', { exact: true }).inputValue(), '0.5');
    await insp.getByRole('group', { name: 'Creature' }).waitFor();
    await addMenu('Chicken (friend)');
    await page.getByRole('tree').getByRole('treeitem', { name: 'chicken_friend' }).waitFor();
    await setField(insp, 'Position X', 300);
    const glb = await fs.stat(path.join(projectsDir, 'farm', 'assets', 'models', 'chicken.glb'));
    assert.ok(glb.size > 100000);
    await page.keyboard.press('1');
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, 'k01-editor');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(() => page.evaluate(() => !!window.__cwViewport.play), true, 10000);
    const npcs = () => page.evaluate(() => window.__cwViewport.play.world.npcStates());
    // Both models load, rigged, with their animations.
    await until(() => page.evaluate(() => [...window.__cwViewport.play.models.values()].filter((m) => m.mixer).length), 2, 10000);
    // The enemy comes for the player and pecks.
    await until(async () => (await npcs()).find((n) => n.id && n.state === 'attack') !== undefined, true, 15000);
    await until(() => page.evaluate(() => window.__cwViewport.play.world.playerStatus().health < 100), true, 8000);
    await shot(page, 'k02-pecked');
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'k-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
