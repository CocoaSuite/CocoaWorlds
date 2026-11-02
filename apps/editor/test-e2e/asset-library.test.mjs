// End-to-end: the asset library (Assets tab): categories, search, pictures, and what clicking each kind does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';
function png(size = 64) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set(((x >> 3) + (y >> 3)) % 2 ? [200, 160, 60] : [60, 50, 30], y * (size * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
test('asset library: categories, search, pictures, place and paint', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
  try {
    await newProject(page, 'Farm');
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Chicken (enemy)' }).click();
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: '+ Graph material' }).click();
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);
    await page.getByRole('button', { name: '+ Material', exact: true }).click();
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Scene' }).click();
    await page.getByRole('tab', { name: 'Assets' }).click();
    const f = path.join(tmp, 'hay_bale.png'); await fs.writeFile(f, png());
    await page.getByTestId('import-textures').setInputFiles(f);
    await page.getByRole('tablist', { name: 'Categories' }).getByRole('tab', { name: /^All/ }).click();
    const cats = page.getByRole('tablist', { name: 'Categories' });
    const grid = (name) => page.getByRole('list', { name });
    // Everything, with counts per category.
    await grid('All').getByRole('listitem').nth(3).waitFor();
    assert.equal(await grid('All').getByRole('listitem').count(), 4);
    assert.match(await cats.getByRole('tab', { name: /^Materials/ }).textContent(), /2$/);
    // Pictures: the materials on spheres, the model drawn.
    await until(() => page.locator('.cw-lib-tile.k-materials img, .cw-lib-tile.k-models img').count(), 3, 15000);
    await shot(page, 'lib01');
    // Categories and search narrow it.
    await cats.getByRole('tab', { name: /^Materials/ }).click();
    assert.equal(await grid('Materials').getByRole('listitem').count(), 2);
    await page.getByLabel('Search assets').fill('graph');
    assert.equal(await grid('Materials').getByRole('listitem').count(), 1);
    await page.getByLabel('Search assets').fill('');
    // A model: placed where the view looks.
    await cats.getByRole('tab', { name: /^Models/ }).click();
    const before = await page.getByRole('tree').getByRole('treeitem').count();
    await grid('Models').getByRole('listitem', { name: 'chicken_rigged' }).getByRole('button', { name: 'Place' }).click();
    await until(() => page.getByRole('tree').getByRole('treeitem').count(), before + 1);
    // A material: painting with it; double-click opens it in Materials.
    await cats.getByRole('tab', { name: /^Materials/ }).click();
    await grid('Materials').getByRole('listitem', { name: 'Material', exact: true }).getByRole('button').click();
    await page.getByRole('group', { name: 'Paint tool' }).getByRole('radio', { name: 'Material', exact: true }).waitFor();
    await grid('Materials').getByRole('listitem', { name: 'Graph material' }).getByRole('button').dblclick();
    await page.getByTestId('material-graph').waitFor();
    assert.equal(await page.getByRole('listbox', { name: 'Materials' }).getByRole('option', { name: 'Graph material' }).getAttribute('aria-selected'), 'true');
  } catch (e) {
    await shot(page, 'lib-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
