// End-to-end: the sound library the editor ships with, under Sounds in the Assets tab: folders, search, and Use
// (copied into the project, where Sound components can pick it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';
test('sound library: browse by folder, search, use one in the project', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Sounds');
    await page.getByRole('tab', { name: 'Assets' }).click();
    const cats = page.getByRole('tablist', { name: 'Categories' });
    await cats.getByRole('tab', { name: /^Sounds/ }).click();
    await cats.getByRole('tab', { name: /^Sound library/ }).click();
    const grid = page.getByRole('list', { name: 'Sound library' });
    await until(() => grid.getByRole('listitem').count(), 400, 10000);
    // One folder at a time.
    await cats.getByRole('tab', { name: /^UI\b/ }).click();
    const ui = page.getByRole('list', { name: 'UI' });
    const inUi = await ui.getByRole('listitem').count();
    assert.ok(inUi > 5 && inUi < 400, `UI has ${inUi}`);
    // Search within it.
    await page.getByRole('searchbox', { name: 'Search' }).fill('cancel');
    await until(async () => { const n = await ui.getByRole('listitem').count(); return n >= 1 && n < inUi; }, true, 4000);
    await shot(page, 'sound-library');
    // Use: into the project's sounds, ticked off in the library, and listed under Sounds.
    await ui.getByRole('button', { name: 'Use cancel', exact: true }).click();
    await until(() => ui.getByLabel('In the project’s sounds').count(), 1, 6000);
    const file = path.join(projectsDir, 'sounds', 'assets', 'sounds', 'cancel.ogg');
    assert.ok((await fs.stat(file)).size > 1000);
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await cats.getByRole('tab', { name: /^Sounds/ }).click();
    await until(() => page.getByRole('list', { name: 'Sounds' }).getByRole('listitem').count(), 1, 4000);
  } catch (e) {
    await shot(page, 'sound-library-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
