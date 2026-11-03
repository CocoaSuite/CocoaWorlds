// End-to-end: the Sky workspace: a preset sets the scene's sky and its Sun (height, colour, brightness), fields
// shape it, and the change undoes in one step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('sky workspace: presets, sun height, clouds, undo', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Skies');
    await page.getByRole('tab', { name: 'Sky' }).click();
    const sky = () => page.evaluate(() => window.__cwStore.getState().doc.settings.sky);
    await page.getByRole('button', { name: 'Sky preset Sunset' }).click();
    await until(async () => (await sky()).horizon, '#ff9a5c', 4000);
    assert.equal((await sky()).lightFromSky, true);
    assert.equal(await page.getByRole('switch', { name: 'Light from the sky' }).isChecked(), true);
    await until(async () => Math.round(Number(await page.getByLabel('Sun height').inputValue())), 4, 4000);
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, 'sky-sunset');
    const cover = page.getByLabel('Cover', { exact: true });
    await cover.fill('0.7');
    await cover.press('Enter');
    await until(async () => (await sky()).clouds, 0.7, 4000);
    const height = page.getByLabel('Sun height');
    await height.fill('35');
    await height.press('Enter');
    await page.getByRole('button', { name: 'Sky preset Clear day' }).click();
    await until(async () => (await sky()).horizon, '#cfe3f3', 4000);
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, 'sky-day');
    // The preset is one step back.
    await page.keyboard.press('Control+z');
    await until(async () => (await sky()).horizon, '#ff9a5c', 4000);
    await until(() => page.getByLabel('Sun height').inputValue(), '35', 4000);
    // Save it to the project, name it, and bring it back after another preset.
    await page.getByRole('button', { name: 'Save this sky' }).click();
    const name = page.getByLabel('Sky name');
    await name.fill('Dusk');
    await name.press('Enter');
    await page.getByRole('button', { name: 'Sky preset Night' }).click();
    await until(async () => (await sky()).horizon, '#1b2440', 4000);
    await page.getByRole('button', { name: 'Use sky Dusk' }).click();
    await until(async () => (await sky()).horizon, '#ff9a5c', 4000);
    await until(() => page.getByLabel('Sun height').inputValue(), '35', 4000);
    const kept = await page.evaluate(() => window.__cwStore.getState().session.project.settings.skies.map((x) => x.name));
    assert.deepEqual(kept, ['Dusk']);
  } catch (e) {
    await shot(page, 'sky-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
