// Export as GLB: a group of two blocks written through the scene tree's menu (one file, in metres, bottom centre at
// the origin, the group's tree kept), then one block added to the project's models and placed back as a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBlock(page, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, [128, 64, 128], corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

/** The JSON chunk of a .glb. */
function gltfJson(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'glTF magic');
  const len = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + len).toString('utf8'));
}

test('selected group of brushes exports as a GLB file and into the project as a model', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const out = path.join(tmp, 'out');
  process.env.CW_MODEL_EXPORT_DIR = out;
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const dialog = () => page.getByRole('dialog', { name: 'Export as GLB' });
  try {
    await newProject(page, 'Glb');
    await page.keyboard.press('2');
    await addBlock(page, [0, 0, 0]);
    await addBlock(page, [256, 0, 0]);
    await item('block').click();
    await item('block_2').click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+g');
    await item('group').waitFor();
    await item('group').click();

    // 1. Right-click the group › Export as GLB… › Save file: one .glb with both blocks under the group.
    await item('group').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Export as GLB…' }).click();
    await dialog().waitFor();
    assert.equal(await page.getByTestId('glb-count').textContent(), 'Brushes: 2');
    assert.equal(await dialog().getByLabel('File name').inputValue(), 'group.glb');
    await shot(page, 'glb-export-dialog');
    await dialog().getByRole('button', { name: 'Save file…' }).click();
    const file = path.join(out, 'group.glb');
    await until(async () => (await fs.stat(file).catch(() => null)) !== null, true, 20000);
    await dialog().waitFor({ state: 'detached' });
    const gltf = gltfJson(await fs.readFile(file));
    assert.deepEqual(gltf.nodes.map((n) => n.name).sort(), ['block', 'block_2', 'group']);
    assert.equal(gltf.meshes.length, 2);
    // Both blocks: 384 u wide, 64 u tall, in metres, with the bottom centre at the origin.
    const pos = gltf.meshes.map((m) => gltf.accessors[m.primitives[0].attributes.POSITION]);
    const minX = Math.min(...pos.map((a) => a.min[0])), maxX = Math.max(...pos.map((a) => a.max[0]));
    const minY = Math.min(...pos.map((a) => a.min[1])), maxY = Math.max(...pos.map((a) => a.max[1]));
    assert.ok(Math.abs(maxX - minX - 384 / 39.37) < 1e-3, `width ${maxX - minX}`);
    assert.ok(Math.abs(minX + maxX) < 1e-3, 'centred');
    assert.ok(Math.abs(minY) < 1e-4 && Math.abs(maxY - 64 / 39.37) < 1e-3, `height ${minY}..${maxY}`);
    assert.ok(gltf.materials.length >= 1);
    assert.ok((gltf.images ?? []).length >= 1, 'the grid texture is in the file');

    // 2. One block › Add to project models: it lands in assets/models and shows in the Models library.
    await item('block').click();
    await page.getByRole('menubar').getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Export as GLB…' }).click();
    await dialog().getByRole('button', { name: 'Add to project models' }).click();
    const model = path.join(projectsDir, 'glb', 'assets', 'models', 'block.glb');
    await until(async () => (await fs.stat(model).catch(() => null)) !== null, true, 20000);
    const one = gltfJson(await fs.readFile(model));
    assert.deepEqual(one.nodes.map((n) => n.name), ['block']);
    await shot(page, 'glb-export-added');
  } finally {
    await quit(app);
  }
});
