// End-to-end (CM2): exposed settings and variants. A node setting is exposed; the material and a variant of it
// set it differently; each bakes its own maps from the one graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('material variants: one graph, two materials with their own settings', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const dir = path.join(projectsDir, 'quarry');
  const materials = async () => JSON.parse(await fs.readFile(path.join(dir, 'project.cwproj'), 'utf8')).settings.materials ?? [];
  const graph = async () => JSON.parse(await fs.readFile(path.join(dir, 'materials', 'graph_material.cwmat'), 'utf8'));
  try {
    await newProject(page, 'Quarry');
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: '+ Graph material' }).click();
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);
    const side = page.getByRole('complementary', { name: 'Material', exact: true });

    // Expose the noise's scale.
    await page.locator('.react-flow__node:has(.cm-node[data-node-type="noise"])').click();
    await side.getByRole('button', { name: 'Expose Scale' }).click();
    await until(async () => ((await graph()).exposed ?? []).map((e) => e.label).join(), 'Noise: Scale', 6000);
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 400 } });
    const own = side.getByRole('group', { name: 'Its own settings' });
    await own.getByLabel('Noise: Scale', { exact: true }).waitFor();

    // A variant, with a bigger scale; each bakes its own maps.
    await side.getByRole('button', { name: 'Make a variant' }).click();
    await page.getByRole('listbox', { name: 'Materials' }).getByRole('option', { name: 'Graph material variant' }).waitFor();
    await side.getByRole('group', { name: 'Its own settings' }).getByLabel('Noise: Scale', { exact: true }).fill('16');
    await until(async () => Object.values((await materials()).find((m) => m.name === 'Graph material variant')?.overrides ?? {})[0], 16, 8000);
    await until(async () => {
      const [a, b] = await materials();
      return !!a?.map && !!b?.map && a.map !== b.map;
    }, true, 30000);
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);
    const [a, b] = await materials();
    assert.equal(a.graph, b.graph);
    assert.ok(!(await fs.readFile(path.join(dir, a.map))).equals(await fs.readFile(path.join(dir, b.map))), 'different pictures');
    // Back to the graph's value.
    await side.getByRole('button', { name: 'Back to the graph’s value Noise: Scale' }).click();
    await until(async () => (await materials()).find((m) => m.name === 'Graph material variant')?.overrides, undefined, 8000);
    await shot(page, 'mv01');
  } catch (e) {
    console.log('DBG', JSON.stringify((await materials()).map((m) => [m.name, m.overrides])), await page.getByRole('complementary', { name: 'Material', exact: true }).getByLabel('Noise: Scale', { exact: true }).inputValue().catch(() => '?'));
    await shot(page, 'mv-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
