// End-to-end (CM3): a wear layer. A material with wear on edges and in creases, painted on a pillar standing on
// a floor: saved, the level carries edge distances, and the material draws with its wear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';
test('wear: edges and creases worn, from the mesh', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Wear');
    const block = async (size, corner) => {
      await page.keyboard.press('2'); await page.keyboard.press('b'); await drawBrush(page);
      await setDraft(page, size, corner);
      await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
      await page.keyboard.press('v');
    };
    await block([512, 16, 512], [-256, -16, -256]);
    await block([128, 160, 128], [-64, 0, -64]);
    const ws = page.getByRole('tablist', { name: 'Workspace' });
    await ws.getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: '+ Material', exact: true }).click();
    const props = page.getByRole('complementary', { name: 'Material', exact: true });
    await props.getByLabel('Colour', { exact: true }).fill('#b0342a');
    await props.getByRole('switch', { name: 'Wear' }).click();
    await props.getByLabel('In creases', { exact: true }).fill('1');
    await props.getByLabel('Width (u)', { exact: true }).fill('12');
    await page.getByRole('button', { name: 'Paint with it' }).click();
    await page.keyboard.press('1');
    const box = await page.getByTestId('viewport').boundingBox();
    await page.keyboard.down('Shift'); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 20); await page.keyboard.up('Shift');
    await page.keyboard.press('v'); await page.keyboard.press('Escape');
    await page.getByRole('tree').getByRole('treeitem', { name: 'block_2' }).click();
    await page.getByTestId('viewport').hover(); await page.keyboard.press('f');
    await page.getByRole('button', { name: /^Lighting/ }).click();
    await new Promise((r) => setTimeout(r, 2500));
    await shot(page, 'wear01');
    const saved = JSON.parse(await fs.readFile(path.join(projectsDir, 'wear', 'project.cwproj'), 'utf8')).settings.materials[0];
    assert.equal(saved.wear.crease, 1);
    assert.equal(saved.wear.width, 12);
    const state = await page.evaluate((id) => {
      const v = window.__cwViewport;
      let rings = false;
      v.world.group.traverse((o) => o.name === 'world-solids' && (rings = !!o.geometry.getAttribute('aWear')));
      return { rings, key: v.world.materials.get(id)?.userData.shadingKey };
    }, saved.id);
    assert.deepEqual(state, { rings: true, key: 'face|wear' });
    // Wear off: back to the plain shader.
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await props.getByRole('switch', { name: 'Wear' }).click();
    await until(() => page.evaluate((id) => window.__cwViewport.world.materials.get(id)?.userData.shadingKey, saved.id), 'face|', 6000);
  } catch (e) {
    await shot(page, 'wear-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
