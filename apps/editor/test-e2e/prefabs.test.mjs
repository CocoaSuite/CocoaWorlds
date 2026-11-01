// End-to-end: make a prefab from a group, place a copy, change values per copy, apply to the prefab, revert,
// save (copies record their changes), unlink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

test('prefabs: make, place, change, apply, revert, unlink', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const items = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const prefabBox = () => page.getByTestId('prefab-section');
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const pick = async (name, n) => {
    await items(name).nth(n).click();
    await until(() => items(name).nth(n).getAttribute('aria-selected'), 'true');
    await frames();
  };
  const dir = path.join(projectsDir, 'prefab-test');
  try {
    await newProject(page, 'Prefab Test');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [64, 16, 64], [0, 0, 0]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await page.getByRole('menubar').getByText('Add', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Point light' }).click();
    await items('block').first().click();
    await items('point_light').first().click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+g');
    await items('group').waitFor();

    // 1. Make a prefab from the group.
    await page.getByRole('menubar').getByText('Edit', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Make prefab…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Make a prefab' });
    await dialog.getByLabel('Name', { exact: true }).fill('lamp');
    await dialog.getByRole('button', { name: 'Make prefab', exact: true }).click();
    await prefabBox().getByText('Copy of lamp').waitFor();
    await prefabBox().getByText('Same as the prefab.').waitFor();
    // The origin moved to the bottom centre of the contents without moving anything.
    assert.equal(await page.getByLabel('Position X', { exact: true }).inputValue(), '32');
    assert.equal(await page.getByLabel('Position Z', { exact: true }).inputValue(), '32');
    await pick('block', 0);
    assert.equal(await page.getByLabel('Centre X', { exact: true }).inputValue(), '32');
    let prefab = JSON.parse(await fs.readFile(path.join(dir, 'prefabs', 'lamp.cwprefab'), 'utf8'));
    assert.equal(prefab.entities.length, 3);

    // 2. Place a copy from the Assets panel.
    await page.getByRole('tab', { name: 'Assets' }).click();
    await page.getByRole('listitem', { name: 'lamp' }).getByRole('button', { name: 'Place' }).click();
    await items('lamp_2').waitFor();
    assert.equal(await items('block').count(), 2);

    // 3. The copy's light gets brighter: that's a change of this copy only.
    await pick('point_light', 1);
    await setField(insp(), 'Brightness', 4);
    await prefabBox().getByText('Light › Brightness').waitFor();

    // 4. The first copy's base gets wider and is applied to the prefab: the other copy follows,
    //    but keeps its own brightness.
    await pick('block', 0);
    await setField(page, 'Size X', 128);
    await prefabBox().getByText('Shape').waitFor();
    await prefabBox().getByRole('button', { name: 'Apply', exact: true }).click();
    await prefabBox().getByText('Same as the prefab.').waitFor();
    await pick('block', 1);
    assert.equal(await page.getByLabel('Size X', { exact: true }).inputValue(), '128');
    await pick('point_light', 1);
    assert.equal(await insp().getByLabel('Brightness', { exact: true }).inputValue(), '4');
    prefab = JSON.parse(await fs.readFile(path.join(dir, 'prefabs', 'lamp.cwprefab'), 'utf8'));
    const xs = prefab.entities.find((e) => e.name === 'block').components.brush.faces.flatMap((f) => f.points.map((p) => p[0]));
    assert.equal(Math.max(...xs) - Math.min(...xs), 128, 'the prefab file has the wider base');
    await shot(page, 'pf01-copies');

    // 5. Save: the copy records what it changed.
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(path.join(dir, 'scenes', 'level_01.cwscene'), 'utf8'));
    const lights = scene.entities.filter((e) => e.name === 'point_light');
    assert.deepEqual(lights.map((e) => e.components.prefabLink.changed ?? []), [[], ['components.light.intensity']]);

    // 6. Revert brings the prefab's value back; Unlink makes it an ordinary object.
    await prefabBox().getByRole('button', { name: 'Revert', exact: true }).click();
    await until(() => insp().getByLabel('Brightness', { exact: true }).inputValue(), '1.5');
    await prefabBox().getByText('Same as the prefab.').waitFor();
    await prefabBox().getByRole('button', { name: 'Unlink' }).click();
    await until(() => prefabBox().count(), 0);
  } catch (e) {
    await shot(page, 'pf-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
