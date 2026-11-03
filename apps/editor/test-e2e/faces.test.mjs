// End-to-end: select faces, change material and texture alignment, undo, paint with the paint tool, save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

async function clickCentre(page, mods = []) {
  const box = await page.getByTestId('viewport').boundingBox();
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  for (const m of mods) await page.keyboard.up(m);
}

const faceCount = (page) => page.getByTestId('face-count').textContent();

test('face tool and paint tool', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const sceneFile = path.join(projectsDir, 'face-paint', 'scenes', 'level_01.cwscene');
  const savedFaces = async () => {
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
    return scene.entities.find((e) => e.name === 'block').components.brush.faces;
  };
  try {
    await newProject(page, 'Face Paint');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [256, 128, 256], [0, 0, 0]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await tree().getByRole('treeitem', { name: 'block' }).click();
    await page.keyboard.press('f');

    // 1. Face tool: clicking the middle of the top view picks the top face.
    await page.keyboard.press('t');
    await insp().getByText('Click a face to select it', { exact: false }).waitFor();
    await clickCentre(page);
    await until(() => faceCount(page), '1');

    // 2. Material and alignment for that face; each change is one undo step.
    await insp().getByRole('radio', { name: 'Orange' }).click();
    await until(() => page.getByTestId('face-material').textContent(), 'Orange');
    await setField(page, 'Offset U', 32);
    await setField(page, 'Rotation', 45);
    await until(() => page.getByLabel('Rotation', { exact: true }).inputValue(), '45');
    await page.keyboard.press('Control+z');
    await until(() => page.getByLabel('Rotation', { exact: true }).inputValue(), '0');
    await page.keyboard.press('Control+Shift+z');
    await until(() => page.getByLabel('Rotation', { exact: true }).inputValue(), '45');
    await shot(page, 'f01-top-face');

    let faces = await savedFaces();
    const top = faces.filter((f) => f.material === 'dev/orange');
    assert.equal(top.length, 1, 'one orange face');
    assert.equal(top[0].rotation, 45);
    assert.equal(top[0].offset[0], 32);
    for (const p of top[0].points) assert.equal(p[1], 128, 'the orange face is the top');
    assert.equal(faces.filter((f) => f.material === 'dev/grid').length, 5);

    // 3. Ctrl+click adds a side face (front view); values that differ show as mixed.
    await page.keyboard.press('3');
    await page.keyboard.press('f');
    await clickCentre(page, ['Control']);
    await until(() => faceCount(page), '2');
    await until(() => page.getByTestId('face-material').textContent(), 'Mixed');
    await until(() => page.getByLabel('Rotation', { exact: true }).inputValue(), '');

    // 4. Shift+click takes every face of the brush; Fit stretches the texture across each face.
    await clickCentre(page, ['Shift']);
    await until(() => faceCount(page), '6');
    await insp().getByRole('button', { name: 'Fit', exact: true }).click();
    faces = await savedFaces();
    // Every unrotated face is 256 units wide along U: one tile of 256 texels means 1 unit per texel.
    for (const f of faces.filter((x) => x.rotation === 0)) assert.equal(f.scale[0], 1);
    // Side faces are 128 high along V.
    assert.ok(faces.some((f) => f.rotation === 0 && f.scale[1] === 0.5));
    // Delete does nothing in the face tool (faces can't be deleted on their own).
    await page.keyboard.press('Delete');
    await tree().getByRole('treeitem', { name: 'block' }).waitFor();
    await page.keyboard.press('Escape');
    await insp().getByText('Click a face to select it', { exact: false }).waitFor();

    // 5. Paint tool: pick a material, click a face. Ctrl+click picks up the material under the cursor.
    await page.keyboard.press('p');
    const panel = page.getByRole('group', { name: 'Paint tool' });
    await panel.getByRole('radio', { name: 'Blue' }).click();
    await page.keyboard.press('2');
    await clickCentre(page);
    await panel.getByRole('radio', { name: 'Green' }).click();
    await until(() => page.getByTestId('paint-material').textContent(), 'Green');
    await clickCentre(page, ['Control']);
    await until(() => page.getByTestId('paint-material').textContent(), 'Blue');
    faces = await savedFaces();
    assert.equal(faces.filter((f) => f.material === 'dev/blue').length, 1, 'one face painted');

    // 6. Shift+click paints the whole brush, in one undo step.
    await page.keyboard.press('3');
    await clickCentre(page, ['Shift']);
    await shot(page, 'f02-painted');
    faces = await savedFaces();
    assert.equal(faces.filter((f) => f.material === 'dev/blue').length, 6, 'whole brush painted');
    await page.keyboard.press('Control+z');
    faces = await savedFaces();
    assert.equal(faces.filter((f) => f.material === 'dev/blue').length, 1);
    assert.equal(faces.length, 6, 'shape never changes');
  } catch (e) {
    await shot(page, 'f-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
