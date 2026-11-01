// End-to-end: add components in the Inspector, draw a trigger zone, play the physics preview, stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner, tool = 'b') {
  if (tool === 'b') await page.keyboard.press('b');
  else await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Trigger zone' }).click();
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('components, trigger zone, play and stop', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const consoleText = () => page.getByRole('log').textContent();
  const sceneFile = path.join(projectsDir, 'physics', 'scenes', 'level_01.cwscene');
  try {
    await newProject(page, 'Physics');
    await page.keyboard.press('2');
    await addBrush(page, [512, 16, 512], [-256, -16, -256]);
    await addBrush(page, [32, 32, 32], [-16, 200, -16]);
    await addBrush(page, [128, 80, 128], [-64, 60, -64], 'trigger');
    await item('trigger').waitFor();

    // 1. The crate gets physics through "Add component".
    await item('block_2').click();
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Physics/ }).click();
    const physics = insp().getByRole('group', { name: 'Physics' });
    await physics.getByLabel('Moves', { exact: true }).waitFor();
    assert.equal(await physics.getByLabel('Moves', { exact: true }).inputValue(), 'dynamic');
    await physics.getByLabel('Bounce', { exact: true }).fill('0');
    await physics.getByLabel('Bounce', { exact: true }).press('Enter');
    // Only Breakable, a Script and a Sound still fit a moving brush (a trigger zone or conveyor can't move; lights and
    // shapes are for point objects).
    await insp().getByRole('button', { name: 'Add component' }).click();
    assert.deepEqual((await page.getByRole('menuitem').allTextContents()).map((x) => x.split(' — ')[0]), ['Sound', 'Breakable', 'Script']);
    await page.keyboard.press('Escape');

    // 2. The trigger zone notices physics objects.
    await item('trigger').click();
    const zone = insp().getByRole('group', { name: 'Trigger zone' });
    await zone.getByLabel('Notices', { exact: true }).selectOption({ label: 'Physics objects' });
    await page.keyboard.press('1');
    await page.keyboard.press('f');
    await shot(page, 'p01-editor');

    // 3. Play: the crate falls through the zone onto the floor; the console reports the zone.
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(async () => (await consoleText()).includes('block_2 entered trigger'), true, 10000);
    await until(async () => (await consoleText()).includes('block_2 left trigger'), true, 10000);
    await shot(page, 'p02-playing');
    // The panels are inert while playing.
    assert.equal(await page.locator('.cw-inert-wrap').first().getAttribute('inert'), '');

    // 4. Stop: the first Esc frees the mouse (the starter scene has a Player start, so you play as the
    //    player), the second goes back to editing with the scene exactly as before.
    await page.keyboard.press('Escape');
    await page.getByTestId('click-to-play').waitFor();
    await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
    await item('block_2').click();
    assert.equal(await page.getByLabel('Centre Y', { exact: true }).inputValue(), '216');
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
    const crate = scene.entities.find((e) => e.name === 'block_2');
    assert.equal(crate.components.rigidBody.motion, 'dynamic');
    assert.equal(crate.components.rigidBody.bounciness, 0);
    const trig = scene.entities.find((e) => e.name === 'trigger');
    assert.equal(trig.components.trigger.detects, 'physics');

    // 5. F5 plays again from the saved state.
    await page.keyboard.press('F5');
    await page.getByTestId('play-banner').waitFor();
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'p-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
