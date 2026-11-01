// End-to-end: nested transforms (decision G3). Turn and move a group of brushes, save, reopen, ungroup;
// and open a format-1 scene, which is upgraded without moving anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

async function addBlock(page, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, [128, 64, 128], corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('groups carry their contents; format 1 scenes upgrade in place', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  let { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const selected = (name) => item(name).getAttribute('aria-selected');
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const read = async (name, label) => {
    await item(name).click();
    await until(() => selected(name), 'true');
    await frames();
    return Number(await page.getByLabel(label, { exact: true }).inputValue());
  };
  const sceneFile = path.join(projectsDir, 'nested', 'scenes', 'level_01.cwscene');
  try {
    await newProject(page, 'Nested');
    await page.keyboard.press('2');
    await addBlock(page, [0, 0, 0]);
    await addBlock(page, [256, 0, 0]);
    await item('block').click();
    await item('block_2').click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+g');
    await item('group').waitFor();

    // 1. Turn the group 90° about Y: the blocks swing around the group's origin; their saved faces don't change.
    await setField(page, 'Rotation Y', 90);
    assert.equal(await read('block', 'Centre X'), 64);
    assert.equal(await read('block', 'Centre Z'), -64);
    assert.equal(await read('block_2', 'Centre Z'), -320);
    // 2. Move the group: everything inside follows.
    await item('group').click();
    await setField(page, 'Position X', 512);
    assert.equal(await read('block', 'Centre X'), 576);
    await page.keyboard.press('1');
    await page.keyboard.press('f');
    await shot(page, 'n01-group-turned');
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    let scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
    assert.equal(scene.schemaVersion, 2);
    const g = scene.entities.find((e) => e.name === 'group');
    assert.deepEqual(g.transform.rotation, [0, 90, 0]);
    assert.deepEqual(g.transform.position, [512, 0, 0]);
    const xs = scene.entities.find((e) => e.name === 'block').components.brush.faces.flatMap((f) => f.points.map((p) => p[0]));
    assert.equal(Math.min(...xs), 0, 'faces stay in the group’s space');
    assert.equal(Math.max(...xs), 128);
    await quit(app);

    // 3. Reopen: same place. Ungroup: the blocks stay where they are in the world.
    ({ app, page } = await launch(userData, projectsDir));
    await page.getByRole('button', { name: /Nested/ }).click();
    await item('group').waitFor();
    assert.equal(await read('block', 'Centre X'), 576);
    assert.equal(await read('block', 'Centre Z'), -64);
    await item('group').click();
    await page.keyboard.press('Control+Shift+g');
    await until(() => item('group').count(), 0);
    assert.equal(await read('block', 'Centre X'), 576);
    assert.equal(await read('block', 'Centre Z'), -64);
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    await quit(app);

    // 4. A format-1 scene (world-space children, a group with a stray offset) opens without anything moving.
    scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
    const lamp = { id: 'lamp000000000001', name: 'lamp', parent: 'oldgroup00000001', transform: { position: [40, 100, 40], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: { light: { kind: 'point', color: '#ffffff', intensity: 1, range: 512 } }, visible: true, locked: false, tags: [] };
    const oldGroup = { id: 'oldgroup00000001', name: 'oldgroup', parent: null, transform: { position: [16, 0, 16], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: { group: {} }, visible: true, locked: false, tags: [] };
    scene.schemaVersion = 1;
    scene.entities.push(oldGroup, lamp);
    await fs.writeFile(sceneFile, JSON.stringify(scene, null, 2));
    ({ app, page } = await launch(userData, projectsDir));
    await page.getByRole('button', { name: /Nested/ }).click();
    await item('lamp').waitFor();
    await item('lamp').click();
    assert.equal(await page.getByLabel('Position X', { exact: true }).inputValue(), '40');
    await item('oldgroup').click();
    await until(() => selected('oldgroup'), 'true');
    await frames();
    assert.equal(await page.getByLabel('Position X', { exact: true }).inputValue(), '0');
    const backups = await fs.readdir(path.join(projectsDir, 'nested', '.cocoaworlds', 'backups')).catch(() => []);
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
    assert.equal(scene.schemaVersion, 2);
    assert.ok(backups.length + (await fs.readdir(path.join(projectsDir, 'nested', '.cocoaworlds', 'backups'))).length > 0, 'a backup of the old file was kept');
  } catch (e) {
    await shot(page, 'n-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
