// End-to-end: smooth shading on round brushes (on by default for a cylinder, switched in the Inspector) and
// bevelled edges on a material.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';
async function addBrush(page, size, corner, shape) {
  await page.keyboard.press('b');
  if (shape) { await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Brush shapes' }).click(); await page.getByRole('button', { name: shape }).first().click(); }
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}
test('smooth shading and bevelled edges', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Shading');
    await page.keyboard.press('2');
    await addBrush(page, [128, 128, 128], [-200, 0, -64], 'Cylinder brush');
    await addBrush(page, [128, 128, 128], [64, 0, -64]);
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    const tree = page.getByRole('tree');
    await tree.getByRole('treeitem', { name: /^cylinder/ }).click();
    const sw = insp.getByRole('switch', { name: 'Smooth shading' });
    assert.equal(await sw.isChecked(), true, 'a new cylinder is smooth');
    // The cylinder's side normals are round in the level mesh.
    const round = () =>
      page.evaluate(() => {
        let n = 0, all = 0;
        window.__cwViewport.world.group.traverse((o) => {
          if (o.name !== 'world-solids') return;
          const p = o.geometry.getAttribute('position'), nm = o.geometry.getAttribute('normal');
          for (let i = 0; i < p.count; i++) {
            const x = p.getX(i) + 136, z = p.getZ(i);
            if (p.getX(i) > -50 || Math.abs(nm.getY(i)) > 0.5) continue;
            all++;
            if ((nm.getX(i) * x + nm.getZ(i) * z) / Math.hypot(x, z) > 0.999) n++;
          }
        });
        // (The share of the sides' corners whose normal points straight out from the axis.)
        return all ? n / all : 0;
      });
    await until(async () => (await round()) > 0.95, true, 6000);
    await sw.click();
    await until(async () => (await round()) < 0.9, true, 6000);
    await sw.click();
    // Bevelled edges: a material with a bevel, on the block.
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: '+ Material', exact: true }).click();
    const mat = page.getByRole('complementary', { name: 'Material', exact: true });
    await mat.getByLabel('Colour', { exact: true }).fill('#8aa0b8');
    await mat.getByRole('slider', { name: 'Bevel edges (u)' }).fill('10');
    await page.getByRole('button', { name: 'Paint with it' }).click();
    await page.keyboard.press('1');
    const box = await page.getByTestId('viewport').boundingBox();
    await tree.getByRole('treeitem', { name: /^block/ }).click();
    await page.getByTestId('viewport').hover();
    await page.keyboard.press('f');
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Shift');
    const saved = await page.evaluate(() => window.__cwStore.getState().session.project.settings.materials[0]);
    assert.equal(saved.bevel, 10);
    await until(() => page.evaluate((id) => window.__cwViewport.world.materials.get(id)?.userData.shadingKey, saved.id), 'face||bevel', 6000);
    await page.keyboard.press('v');
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, 'shading');
  } catch (e) {
    await shot(page, 'shading-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
