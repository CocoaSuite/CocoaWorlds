// End-to-end: loop cut a block (Ctrl+R), then drag the new corners into a dent: the block becomes an edited
// mesh (decision G4), is saved with its corners, and clip leaves it alone with a message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

const screenOf = (page, p) => page.evaluate((p) => window.__cwViewport.toScreen(p), p);

async function drag(page, a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

test('loop cut, free corners, edited mesh', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const sceneFile = path.join(projectsDir, 'meshes', 'scenes', 'level_01.cwscene');
  const saved = async () => {
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    return JSON.parse(await fs.readFile(sceneFile, 'utf8')).entities.find((e) => e.name === 'block').components.brush;
  };
  try {
    await newProject(page, 'Meshes');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [256, 128, 128], [0, 0, 0]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await item('block').click();
    await page.keyboard.press('f');

    // 1. Loop cut: hover near the block's front edge; the wheel adds and removes cuts; a click cuts.
    await page.keyboard.press('Control+r');
    const panel = page.getByRole('group', { name: 'Loop cut' });
    await panel.waitFor();
    const over = await screenOf(page, [200, 128, 6]);
    await page.mouse.move(over.x, over.y, { steps: 4 });
    await page.mouse.move(over.x + 1, over.y, { steps: 2 });
    await page.mouse.wheel(0, -100);
    await until(() => panel.getByLabel('Cuts').inputValue(), '2');
    await page.mouse.wheel(0, 100);
    await until(() => panel.getByLabel('Cuts').inputValue(), '1');
    await shot(page, 'm01-loop-preview');
    await page.mouse.click(over.x + 1, over.y);
    // Straight into the vertex tool with the new corners ready.
    await page.getByTestId('vertex-count').waitFor();
    let brush = await saved();
    assert.equal(brush.mesh.verts.length, 12, 'eight corners plus a ring of four');
    assert.equal(brush.faces.length, 10);
    assert.equal(brush.mesh.verts.filter((v) => v[0] === 128).length, 4, 'the ring is halfway along');
    await page.getByRole('complementary', { name: 'Inspector' }).getByText('Edited mesh').waitFor();

    // 2. Pick the ring's two front corners (x = 128, z = 0) and drag them in: a dent the old vertex tool refused.
    const front = await screenOf(page, [128, 128, 0]);
    await drag(page, { x: front.x - 10, y: front.y - 10 }, { x: front.x + 10, y: front.y + 10 });
    await page.getByTestId('vertex-count').getByText('2').waitFor();
    const to = await screenOf(page, [128, 128, 48]);
    await drag(page, { x: front.x, y: front.y + 40 }, { x: to.x, y: to.y + 40 });
    await shot(page, 'm02-dent');
    brush = await saved();
    const dented = brush.mesh.verts.filter((v) => v[0] === 128 && v[2] === 48);
    assert.equal(dented.length, 2, 'both corners moved in to z = 48');
    assert.ok(brush.mesh, 'still an edited mesh (it has a dent now)');

    // 3. Clip leaves an edited mesh alone and says why.
    await page.keyboard.press('c');
    await drag(page, await screenOf(page, [64, 128, -48]), await screenOf(page, [64, 128, 176]));
    await page.keyboard.press('Enter');
    await page.getByText('Clip doesn’t work on edited meshes', { exact: false }).first().waitFor();
    assert.equal(await item('block_2').count(), 0);

    // 4. Undo twice: back to the plain block (the loop cut is undone too).
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    brush = await saved();
    assert.equal(brush.mesh, undefined);
    assert.equal(brush.faces.length, 6);
  } catch (e) {
    await shot(page, 'm-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
