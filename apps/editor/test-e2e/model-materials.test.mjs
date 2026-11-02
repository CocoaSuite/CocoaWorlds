// End-to-end: project materials on an imported model. The chicken's parts (material slots) take a project
// material from the Inspector or from the Paint tool; the editor, the saved scene and Play all use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('model materials: per-part materials from the Inspector and the Paint tool', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = page.getByRole('complementary', { name: 'Inspector' });
  const ws = page.getByRole('tablist', { name: 'Workspace' });
  // What each part of the chicken in the editor is drawn with (a project material's id, or the file's own).
  const parts = () =>
    page.evaluate(() => {
      const out = {};
      window.__cwViewport.scene.traverse((o) => {
        if (!o.isMesh || !o.userData.slots) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        o.userData.slots.forEach((s, i) => (out[s] = mats[i].name.startsWith('mat/') ? mats[i].name : 'file'));
      });
      return out;
    });
  try {
    await newProject(page, 'Barn');
    // A red material.
    await ws.getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: '+ Material', exact: true }).click();
    const props = page.getByRole('complementary', { name: 'Material', exact: true });
    await props.getByLabel('Colour', { exact: true }).fill('#d03020');
    await ws.getByRole('tab', { name: 'Scene' }).click();

    // 1. The chicken's parts are listed under its Model; Body takes the material.
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Chicken (enemy)' }).click();
    const slots = insp.getByRole('group', { name: 'Materials' });
    await slots.getByLabel('Material for Body').waitFor();
    assert.equal(await slots.getByRole('combobox').count(), 3);
    await until(async () => JSON.stringify(await parts()), JSON.stringify({ 'Eye whites': 'file', Pupils: 'file', Body: 'file' }), 10000);
    const matId = await slots.getByLabel('Material for Body').locator('option', { hasText: 'Material' }).getAttribute('value');
    await slots.getByLabel('Material for Body').selectOption(matId);
    await until(async () => (await parts()).Body, matId, 10000);
    assert.equal((await parts()).Pupils, 'file');
    await page.keyboard.press('f');
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, 'mm01-inspector');

    // 2. Back as in the file, then painted on with the Paint tool (a click on the chicken).
    await slots.getByLabel('Material for Body').selectOption('');
    await until(async () => (await parts()).Body, 'file', 10000);
    await page.getByRole('tab', { name: 'Assets' }).click();
    await page.getByRole('tablist', { name: 'Categories' }).getByRole('tab', { name: /^Materials/ }).click();
    await page.getByRole('list', { name: 'Materials' }).getByRole('listitem', { name: 'Material', exact: true }).getByRole('button').click();
    await page.getByRole('group', { name: 'Paint tool' }).waitFor();
    const box = await page.getByTestId('viewport').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await until(async () => (await parts()).Body, matId, 10000);
    // Undo takes the paint off.
    await page.keyboard.press('Control+z');
    await until(async () => (await parts()).Body, 'file', 10000);
    await page.keyboard.press('Control+y');
    await until(async () => (await parts()).Body, matId, 10000);
    await shot(page, 'mm02-painted');

    // 3. Saved with the scene, and drawn in Play.
    await page.keyboard.press('v');
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(path.join(projectsDir, 'barn', 'scenes', 'level_01.cwscene'), 'utf8'));
    assert.deepEqual(scene.entities.find((e) => e.name === 'chicken').components.model.materials, { Body: matId });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(
      () =>
        page.evaluate(() => {
          const inst = [...(window.__cwViewport.play?.models.values() ?? [])][0];
          let name = '';
          inst?.object.traverse((o) => o.isMesh && o.userData.slots?.[0] === 'Body' && (name = o.material.name));
          return name;
        }),
      matId,
      15000,
    );
    await page.keyboard.press('F5');
  } catch (e) {
    await shot(page, 'mm-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
