// End-to-end: a material set to blend into the ground fades into the floor it's sunk into, near where they meet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';
async function addBrush(page, size, corner, shape) {
  await page.keyboard.press('b');
  if (shape) await page.getByRole('button', { name: shape }).first().click();
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}
async function material(page, colour, blend) {
  await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
  await page.getByRole('button', { name: '+ Material', exact: true }).click();
  const mat = page.getByRole('complementary', { name: 'Material', exact: true });
  await mat.getByLabel('Colour', { exact: true }).fill(colour);
  if (blend) await mat.getByRole('slider', { name: 'Blend into ground (u)' }).fill(String(blend));
  await page.getByRole('button', { name: 'Paint with it' }).click();
}
test('blend into ground', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Blend');
    await page.keyboard.press('2');
    await addBrush(page, [1024, 32, 1024], [-512, -32, -512]);
    await addBrush(page, [192, 192, 192], [-96, -96, -96], 'Sphere brush');
    const view = page.getByTestId('viewport');
    const tree = page.getByRole('tree');
    // The ball: dark and blending; the floor: light.
    await material(page, '#5a3c22', 40);
    await page.keyboard.press('1');
    await tree.getByRole('treeitem', { name: /^sphere/ }).click();
    await view.hover();
    await page.keyboard.press('f');
    const box = await view.boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
    await page.keyboard.up('Shift');
    await material(page, '#c8c8c8', 0);
    await page.keyboard.press('1');
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.92);
    await page.keyboard.up('Shift');
    await page.keyboard.press('v');
    await page.keyboard.press('Escape');
    const saved = await page.evaluate(() => window.__cwStore.getState().session.project.settings.materials[0]);
    assert.equal(saved.blend, 40);
    await until(() => page.evaluate((id) => window.__cwViewport.world.materials.get(id)?.userData.groundBlend, saved.id), true, 6000);
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, 'ground-blend');
  } catch (e) {
    await shot(page, 'ground-blend-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
