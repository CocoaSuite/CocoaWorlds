// End-to-end: box selection, the vertex tool (move an edge), the clip tool (keep both, keep one side).
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

test('box select, vertex tool, clip tool', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const selected = (name) => item(name).getAttribute('aria-selected');
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const sizeX = async (name) => {
    await item(name).click();
    await until(() => selected(name), 'true');
    await frames();
    return Number(await page.getByLabel('Size X', { exact: true }).inputValue());
  };
  const sceneFile = path.join(projectsDir, 'tools', 'scenes', 'level_01.cwscene');
  try {
    await newProject(page, 'Tools');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [256, 128, 128], [0, 0, 0]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await item('block').click();
    await page.keyboard.press('f');
    await page.keyboard.press('Escape');
    await until(() => selected('block'), 'false');

    // 1. Box selection: dragging from empty space over part of the block selects it.
    const near = await screenOf(page, [-40, 128, -40]);
    const mid = await screenOf(page, [128, 128, 64]);
    await drag(page, near, mid);
    await until(() => selected('block'), 'true');

    // 2. Vertex tool: box-pick the edge at x = 256, z = 0 (two corners), move it 64 along X with the arrow.
    await page.keyboard.press('x');
    await page.getByTestId('vertex-count').getByText('0').waitFor();
    const edge = await screenOf(page, [256, 128, 0]);
    await drag(page, { x: edge.x - 12, y: edge.y - 12 }, { x: edge.x + 12, y: edge.y + 12 });
    await page.getByTestId('vertex-count').getByText('2').waitFor();
    const to = await screenOf(page, [320, 128, 0]);
    await drag(page, { x: edge.x + 45, y: edge.y }, { x: to.x + 45, y: to.y });
    await shot(page, 't01-vertex-edge');
    assert.equal(await sizeX('block'), 320, 'the edge moved out to x = 320');
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    let scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
    assert.equal(scene.entities.find((e) => e.name === 'block').components.brush.faces.length, 6, 'still six flat faces');
    await page.keyboard.press('Control+z');
    await until(() => sizeX('block'), 256);

    // 3. Clip tool: a line across the block at x = 128 cuts it into two halves.
    await page.keyboard.press('c');
    const clipPanel = page.getByRole('group', { name: 'Clip tool' });
    await clipPanel.getByText('drag a line across them', { exact: false }).waitFor();
    await drag(page, await screenOf(page, [128, 128, -48]), await screenOf(page, [128, 128, 176]));
    await clipPanel.getByText('Red parts are removed', { exact: false }).waitFor();
    await shot(page, 't02-clip-preview');
    await page.keyboard.press('Enter');
    await item('block_2').waitFor();
    assert.equal(await sizeX('block'), 128);
    assert.equal(await sizeX('block_2'), 128);
    await page.keyboard.press('Control+z');
    await until(() => item('block_2').count(), 0);

    // 4. Keep one side: Tab switches what to keep; the other half is removed.
    await item('block').click();
    await page.keyboard.press('c');
    await drag(page, await screenOf(page, [128, 128, -48]), await screenOf(page, [128, 128, 176]));
    await page.keyboard.press('Tab');
    await until(() => clipPanel.getByRole('radio', { name: 'One side' }).getAttribute('aria-checked'), 'true');
    await shot(page, 't03-clip-one-side');
    await clipPanel.getByRole('button', { name: 'Clip' }).click();
    assert.equal(await sizeX('block'), 128);
    assert.equal(await item('block_2').count(), 0);
  } catch (e) {
    await shot(page, 't-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
