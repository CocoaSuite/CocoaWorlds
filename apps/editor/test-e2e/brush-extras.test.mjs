// End-to-end: plane brushes (one face), bevelled brushes (segments), a subtract that cuts only a chosen brush,
// and a glass material.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner, opts = {}) {
  await page.keyboard.press('b');
  if (opts.shape) {
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Brush shapes' }).click();
    await page.getByRole('button', { name: opts.shape }).first().click();
  }
  await drawBrush(page);
  await setDraft(page, size, corner);
  if (opts.subtract) await page.getByRole('group', { name: 'Brush tool' }).getByRole('radio', { name: 'Subtract' }).click();
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('planes, bevels, chosen cuts, glass', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 300)));
  try {
    await newProject(page, 'Extras');
    await page.keyboard.press('2');
    await addBrush(page, [512, 32, 512], [-256, -32, -256]);
    await addBrush(page, [128, 128, 128], [-160, 0, -64]);
    const ents = () => page.evaluate(() => window.__cwStore.getState().doc.entities.filter((e) => e.components.brush).map((e) => ({ id: e.id, name: e.name, faces: e.components.brush.faces.length, mesh: e.components.brush.mesh, role: e.components.brush.role, cuts: e.components.cuts })));
    // Bevel the block: 6 faces + 12 edges × 4 segments.
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    await page.getByRole('tree').getByRole('treeitem', { name: 'block_2' }).click();
    await insp.getByLabel('Segments').fill('4');
    await insp.getByLabel('Segments').press('Enter');
    await insp.getByLabel('Round').fill('16');
    await insp.getByLabel('Round').press('Enter');
    await insp.getByRole('button', { name: 'Bevel edges' }).click();
    await until(async () => (await ents()).find((e) => e.name === 'block_2').faces, 54, 4000);
    // A plane: one face.
    await addBrush(page, [128, 2, 128], [64, 0, -64], { shape: 'Plane (one face)' });
    await until(async () => (await ents()).some((e) => e.faces === 1 && e.mesh?.polys.length === 1), true, 4000);
    // A subtract that cuts only the bevelled block (not the floor it also touches).
    await addBrush(page, [96, 96, 96], [-200, -16, -32], { subtract: true });
    const cutter = (await ents()).find((e) => e.role === 'subtract');
    await page.getByRole('tree').getByRole('treeitem', { name: cutter.name }).click();
    await insp.getByRole('radio', { name: 'Only chosen' }).click();
    const block = (await ents()).find((e) => e.name === 'block_2');
    await insp.getByLabel('Add a brush it cuts…').selectOption(block.id);
    await until(async () => (await ents()).find((e) => e.role === 'subtract').cuts?.only, block.id, 4000);
    // Glass.
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: '+ Material', exact: true }).click();
    const mat = page.getByRole('complementary', { name: 'Material', exact: true });
    await mat.getByRole('slider', { name: 'Glass (see-through)' }).fill('1');
    await until(() => page.evaluate(() => window.__cwStore.getState().session.project.settings.materials[0].refraction), 1, 4000);
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Level' }).click();
    await page.getByRole('radio', { name: 'Perspective' }).click();
    await page.getByRole('tree').getByRole('treeitem', { name: 'block_2' }).click();
    await page.getByTestId('viewport').hover();
    await page.keyboard.press('f');
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, 'brush-extras');
  } catch (e) {
    await shot(page, 'brush-extras-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
