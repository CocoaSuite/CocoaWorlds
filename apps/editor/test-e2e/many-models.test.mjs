// End-to-end (A2c): many copies of one still model are drawn together in the game: a few instanced draws, not
// one per copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { boxGlb, launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';
test('many copies of a model: batched in Play', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Crates');
    await page.getByRole('tab', { name: 'Assets' }).click();
    const file = path.join(tmp, 'Crate.glb');
    await fs.writeFile(file, boxGlb({ still: true }));
    await page.getByTestId('import-models').setInputFiles(file);
    await page.getByRole('list', { name: 'Models' }).getByRole('button', { name: 'Place' }).first().click();
    await until(() => page.evaluate(() => window.__cwStore.getState().doc.entities.filter((e) => e.components.model).length), 1, 6000);
    // 256 crates: select them all and duplicate, eight times over.
    await page.evaluate(() => {
      const s = window.__cwStore;
      for (let i = 0; i < 8; i++) {
        const ids = s.getState().doc.entities.filter((e) => e.components.model).map((e) => e.id);
        s.getState().select(ids, 'replace');
        s.getState().duplicateSelection();
      }
    });
    const crates = await page.evaluate(() => window.__cwStore.getState().doc.entities.filter((e) => e.components.model).length);
    assert.equal(crates, 256);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await until(() => page.evaluate(() => window.__cwViewport.play?.batches.copies ?? 0), 256, 15000);
    await new Promise((r) => setTimeout(r, 500));
    const draws = await page.evaluate(() => window.__cwViewport.renderer.info.render.calls);
    assert.ok(draws < 60, `${draws} draw calls`);
    await shot(page, 'many-models');
  } catch (e) {
    await shot(page, 'many-models-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
