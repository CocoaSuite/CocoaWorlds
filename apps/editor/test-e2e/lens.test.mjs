// End-to-end: camera lens effects and the noise overlay (Inspector, nothing selected › Camera lens and noise):
// a look picked from the menu sets the scene's lens settings and the passes draw with Lighting: Game; undo puts
// them back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('camera lens looks and noise overlay', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const lens = () => page.evaluate(() => window.__cwStore.getState().doc.settings.lens ?? null);
  /** Which lens passes drew the last frame (null: the composer isn't in use). */
  const passes = () =>
    page.evaluate(() => {
      const c = window.__cwViewport.ao?.c;
      return c ? [c.lens.dof.enabled, c.lens.lens.enabled, c.lens.noise.enabled].join(',') : null;
    });
  try {
    await newProject(page, 'Lens');
    await page.keyboard.press('2');
    await addBrush(page, [1024, 16, 1024], [-512, -16, -512]);
    await addBrush(page, [64, 128, 64], [-160, 0, -256]);
    await addBrush(page, [64, 128, 64], [96, 0, -480]);
    await page.keyboard.press('1');
    await page.getByRole('button', { name: /^Lighting (Game|Preview)/ }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    assert.equal(await lens(), null);

    // A look from the menu.
    await insp().getByLabel('Look', { exact: true }).selectOption('vhs');
    await until(async () => (await lens())?.scanlines, 0.35);
    assert.equal((await lens()).aberration, 0.7);
    await until(passes, 'false,true,true', 6000);
    await shot(page, 'lens01-vhs');

    // Depth of field on, a number changed by hand.
    await insp().getByRole('switch', { name: 'Depth of field' }).click({ force: true });
    await until(async () => (await lens())?.dof, true);
    await setField(page, 'Film grain', 0.6);
    await until(async () => (await lens())?.grain, 0.6);
    await until(passes, 'true,true,true', 6000);
    await shot(page, 'lens02-dof');

    // The main switch hides them all; undo brings them back.
    await insp().getByRole('switch', { name: 'Lens effects' }).click({ force: true });
    await until(async () => (await lens())?.enabled, false);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    await until(async () => (await lens())?.enabled, true);

    // Clean turns everything off.
    await insp().getByLabel('Look', { exact: true }).selectOption('none');
    await until(async () => (await lens())?.grain, 0);
    assert.equal((await lens()).dof, false);
    await shot(page, 'lens03-clean');
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
