// End-to-end (A1): a second scene made from the scene picker, a level-change zone and landmarks; in Play the
// player walks into the zone and goes on in the other scene, by the landmark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner, kind = 'Solid') {
  await page.keyboard.press('b');
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('radio', { name: kind, exact: true }).click();
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

async function landmark(page, name, z) {
  const insp = page.getByRole('complementary', { name: 'Inspector' });
  await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
  await page.getByRole('menuitem', { name: 'Empty object' }).click();
  const field = insp.getByLabel('Name', { exact: true }).first();
  await field.fill(name);
  await field.press('Enter');
  await page.getByRole('tree').getByRole('treeitem', { name }).waitFor();
  await setField(insp, 'Position Z', z);
  await insp.getByRole('button', { name: 'Add component' }).click();
  await page.getByRole('menuitem', { name: /^Landmark/ }).click();
}

test('scenes and level changes', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = page.getByRole('complementary', { name: 'Inspector' });
  const logText = () => page.getByRole('log').textContent();
  try {
    await newProject(page, 'Two Levels');
    await page.keyboard.press('2');
    await addBrush(page, [1024, 16, 1024], [-512, -16, -512]);
    await landmark(page, 'gate', -256);

    // A second scene, from the scene picker: a floor and the same landmark; then back to the first.
    await page.getByRole('button', { name: 'Scenes of the project' }).click();
    await page.getByRole('menuitem', { name: 'New scene…' }).click();
    const dialog = page.getByRole('dialog', { name: 'New scene' });
    await dialog.getByLabel('Name').fill('level 02');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('button', { name: 'Scenes of the project' }).getByText('level_02').waitFor();
    await page.keyboard.press('2');
    await addBrush(page, [1024, 16, 1024], [-512, -16, -512]);
    await landmark(page, 'gate', 128);
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const project = JSON.parse(await fs.readFile(path.join(projectsDir, 'two-levels', 'project.cwproj'), 'utf8'));
    assert.deepEqual(project.scenes, ['scenes/level_01.cwscene', 'scenes/level_02.cwscene']);
    await page.getByRole('button', { name: 'Scenes of the project' }).click();
    await page.getByRole('menuitem', { name: /^level_01/ }).click();
    await page.getByRole('button', { name: 'Scenes of the project' }).getByText('level_01').waitFor();

    // In the first scene: a level-change zone across the way to the gate.
    await addBrush(page, [256, 128, 32], [-128, 0, -240]);
    await page.getByRole('tree').getByRole('treeitem', { name: 'block_2' }).click();
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Level change/ }).click();
    const lc = insp.getByRole('group', { name: 'Level change' });
    await lc.getByRole('combobox', { name: 'Goes to' }).selectOption({ label: 'level_02' });
    const lm = lc.getByLabel('Landmark', { exact: true });
    await lm.fill('gate');
    await lm.press('Enter');
    await shot(page, 's01-level-change');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await until(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''), 'CANVAS');
    await page.keyboard.down('w');
    await until(async () => (await logText()).includes('Level change: now in level_02 by the landmark gate'), true, 10000);
    await page.keyboard.up('w');
    // In level_02, near its gate (z 128) rather than at its Player start (z 0).
    const z = await page.evaluate(() => window.__cwViewport.play.world.player.feetPosition.z);
    assert.ok(z > 64, `arrived by the gate (z ${z})`);
    await shot(page, 's02-arrived');
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 's-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
