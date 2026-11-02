// End-to-end (CM1): Cocoa Materials. A graph material is made from the starting graph, changed by adding and
// wiring nodes and moving sliders (with undo), baked to images in the project, and painted on a block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('cocoa materials: a graph material, edited, baked and used', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const dir = path.join(projectsDir, 'stone');
  const materials = async () => JSON.parse(await fs.readFile(path.join(dir, 'project.cwproj'), 'utf8')).settings.materials ?? [];
  const graphFile = async () => JSON.parse(await fs.readFile(path.join(dir, 'materials', 'graph_material.cwmat'), 'utf8'));
  const nodeOf = (type) => page.locator(`.react-flow__node:has(.cm-node[data-node-type="${type}"])`);
  try {
    await newProject(page, 'Stone');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [256, 128, 256], [-128, 0, -128]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    const region = page.getByRole('region', { name: 'Materials', exact: true });
    const side = page.getByRole('complementary', { name: 'Material', exact: true });

    // 1. A new graph material: the starting graph, evaluated on the graphics card and baked into the project.
    await region.getByRole('button', { name: '+ Graph material' }).click();
    await page.getByTestId('material-graph').waitFor();
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);
    // (The project file is written a moment after.)
    await until(async () => (await materials())[0]?.map ?? '', 'assets/textures/generated/graph_material_color.png', 6000);
    let m = (await materials())[0];
    assert.equal(m.graph, 'materials/graph_material.cwmat');
    assert.equal(m.map, 'assets/textures/generated/graph_material_color.png');
    assert.equal(m.normalMap, 'assets/textures/generated/graph_material_normal.png');
    assert.equal(m.roughnessMap, 'assets/textures/generated/graph_material_roughness.png');
    assert.equal((await graphFile()).format, 'cocoaworlds.material');
    const png = path.join(dir, m.map);
    const firstColour = await fs.readFile(png);
    assert.deepEqual([...firstColour.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    // 512 × 512, as the material asks.
    assert.equal(firstColour.readUInt32BE(16), 512);
    await shot(page, 'cm01-new');

    // 2. Add a node from the menu (searching), then wire it into the gradient map in place of the noise.
    await page.getByTestId('material-graph').getByRole('button', { name: '+ Node' }).click();
    const menu = page.getByRole('dialog', { name: '+ Node' });
    await menu.getByLabel('Find a node…').fill('brick');
    await menu.getByLabel('Find a node…').press('Enter');
    await nodeOf('bricks').waitFor();
    await side.getByText('Bricks and tiles').waitFor();
    // (Moved clear of the others first, so its output can be grabbed.)
    const nb = await nodeOf('bricks').boundingBox();
    await page.mouse.move(nb.x + nb.width / 2, nb.y + 10);
    await page.mouse.down();
    await page.mouse.move(nb.x + nb.width / 2 - 60, nb.y + 300, { steps: 8 });
    await page.mouse.up();
    const from = await nodeOf('bricks').locator('.react-flow__handle-right').boundingBox();
    const to = await nodeOf('gradientMap').locator('.react-flow__handle-left').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    const idOf = async (type) => (await graphFile()).nodes.find((n) => n.type === type)?.id;
    await until(async () => {
      const g = await graphFile();
      const map = await idOf('gradientMap');
      return g.links.find((l) => l.to === map && l.input === 'in')?.from === (await idOf('bricks'));
    }, true, 6000);
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);
    await until(async () => !(await fs.readFile(png)).equals(firstColour), true, 8000);
    await shot(page, 'cm02-bricks');

    // 3. A slider is one undo step; undo and redo reach the file too.
    await nodeOf('bricks').click();
    const rows = side.getByLabel('Rows', { exact: true });
    await rows.fill('12');
    await until(async () => (await graphFile()).nodes.find((n) => n.type === 'bricks').params.rows, 12, 6000);
    await new Promise((r) => setTimeout(r, 800));
    await page.keyboard.press('Control+z');
    await until(async () => (await graphFile()).nodes.find((n) => n.type === 'bricks').params.rows, undefined, 6000);
    await page.keyboard.press('Control+y');
    await until(async () => (await graphFile()).nodes.find((n) => n.type === 'bricks').params.rows, 12, 6000);

    // 4. Taking a map away: deleting the roughness number unbakes that map; undo brings it back.
    await nodeOf('value').click();
    await page.keyboard.press('Delete');
    await until(async () => (await graphFile()).nodes.some((n) => n.type === 'value'), false, 6000);
    await until(async () => (await materials())[0].roughnessMap, undefined, 30000);
    await page.keyboard.press('Control+z');
    await until(async () => (await materials())[0].roughnessMap, 'assets/textures/generated/graph_material_roughness.png', 30000);
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 300 } });
    await page.getByTestId('material-preview').waitFor();
    await shot(page, 'cm03-settled');

    // 5. The library on the left: a click adds a node in the middle of the graph; dragging drops it where let go.
    const count = async (type) => (await graphFile()).nodes.filter((n) => n.type === type).length;
    const lib = page.getByRole('complementary', { name: 'Library' });
    await lib.getByLabel('Search the library').fill('check');
    await lib.getByRole('button', { name: 'Checker' }).click();
    await until(() => count('checker'), 1, 6000);
    await lib.getByLabel('Search the library').fill('');
    assert.ok((await lib.getByRole('button').count()) > 35, 'every node is listed');
    const fl = await page.getByTestId('material-graph').boundingBox();
    const src = await lib.getByRole('button', { name: 'Cells', exact: true }).boundingBox();
    await page.mouse.move(src.x + 20, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(fl.x + fl.width - 160, fl.y + fl.height - 140, { steps: 10 });
    await page.mouse.up();
    await until(() => count('cells'), 1, 6000);
    const cells = (await graphFile()).nodes.find((n) => n.type === 'cells');
    const cellBox = await nodeOf('cells').boundingBox();
    assert.ok(Math.abs(cellBox.x + cellBox.width / 2 - (fl.x + fl.width - 160)) < 40 && Math.abs(cellBox.y + 20 - (fl.y + fl.height - 140)) < 40, 'dropped where let go');
    assert.ok(cells);
    await shot(page, 'cm05-library');

    // 6. Copy and paste nodes (with their settings), duplicate, undo.
    await nodeOf('bricks').click();
    await page.keyboard.press('Control+c');
    await page.mouse.move(fl.x + fl.width / 2, fl.y + 60);
    await page.keyboard.press('Control+v');
    await until(() => count('bricks'), 2, 6000);
    assert.deepEqual((await graphFile()).nodes.filter((n) => n.type === 'bricks').map((n) => n.params.rows), [12, 12]);
    await page.keyboard.press('Control+d');
    await until(() => count('bricks'), 3, 6000);
    await page.keyboard.press('Control+z');
    await until(() => count('bricks'), 2, 6000);
    await page.keyboard.press('Control+z');
    await until(() => count('bricks'), 1, 6000);

    // 7. Painted on the block, the level draws it with its colour, bump and roughness maps.
    m = (await materials())[0];
    await region.getByRole('button', { name: 'Paint with it' }).click();
    await page.keyboard.press('1');
    const box = await page.getByTestId('viewport').boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Shift');
    const look = (id) => {
      const x = window.__cwViewport.world.materials.get(id);
      return x ? [x.map?.image?.width ?? 0, !!x.normalMap, !!x.roughnessMap, x.roughness] : null;
    };
    await until(async () => JSON.stringify(await page.evaluate(look, m.id)), JSON.stringify([512, true, true, 1]), 10000);
    await page.keyboard.press('v');
    await shot(page, 'cm04-painted');
  } catch (e) {
    await shot(page, 'cm-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
