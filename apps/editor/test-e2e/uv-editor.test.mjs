// End-to-end: the UV workspace: a hotspot sheet set up on a material, which then maps itself onto a brush painted
// with it; the brush's islands shown, and moved with G (one undo step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('uv editor: hotspot sheet, automap on paint, move islands', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Uvs');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [256, 64, 64], [-128, 0, -32]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    // A material with a trim sheet that maps itself when painted.
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: '+ Material', exact: true }).click();
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Scene' }).click();
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'UV', exact: true }).click();
    await page.getByRole('radio', { name: 'Hotspots' }).click();
    await page.getByRole('button', { name: 'Trims' }).click();
    await page.getByRole('switch', { name: 'Map when painted' }).click();
    const mat = () => page.evaluate(() => window.__cwStore.getState().session.project.settings.materials[0]);
    await until(async () => (await mat()).hotspots?.length, 5, 4000);
    assert.equal((await mat()).hotspotAuto, true);
    // Paint the whole brush with it.
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: 'Paint with it' }).click();
    await page.keyboard.press('1');
    await page.getByRole('tree').getByRole('treeitem', { name: /^block/ }).click();
    const view = page.getByTestId('viewport');
    await view.hover();
    await page.keyboard.press('f');
    const box = await view.boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Shift');
    const faces = () => page.evaluate(() => {
      const s = window.__cwStore.getState();
      const e = s.doc.entities.find((x) => x.components.brush);
      return e.components.brush.faces.map((f) => f.surface ?? f);
    });
    // Every face fitted into the sheet (no longer the default 0.25 scale).
    await until(async () => (await faces()).every((f) => f.material.startsWith('mat/') && !(f.scale[0] === 0.25 && f.scale[1] === 0.25)), true, 6000);
    // The UVs: islands of the selected brush, moved with G.
    await page.keyboard.press('v');
    await page.getByRole('tree').getByRole('treeitem', { name: /^block/ }).click();
    await page.getByRole('radio', { name: 'UVs' }).click();
    const canvas = page.getByTestId('uv-canvas');
    const cb = await canvas.boundingBox();
    await shot(page, 'uv-editor');
    const before = (await faces()).map((f) => f.offset[0]);
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.keyboard.press('g');
    await page.mouse.move(cb.x + cb.width / 2 + 60, cb.y + cb.height / 2, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    await until(async () => (await faces()).every((f, i) => Math.abs(f.offset[0] - before[i]) > 1), true, 4000);
    await shot(page, 'uv-editor-moved');
    await page.keyboard.press('Control+z');
    await until(async () => (await faces()).every((f, i) => Math.abs(f.offset[0] - before[i]) < 1e-6), true, 4000);
  } catch (e) {
    await shot(page, 'uv-editor-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
