// End-to-end: an object's pivot: shown in the Inspector, set from buttons and numbers, dragged in the view
// (snapping to a corner, like a door hinge), used by the rotate gizmo, saved, and undone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

const screenOf = (page, p) => page.evaluate((p) => window.__cwViewport.toScreen(p), p);
const gizmoAt = (page) => page.evaluate(() => window.__cwViewport.proxy.position.toArray().map((v) => Math.round(v)).join(','));

test('pivot: inspector, edit in view with corner snap, rotate around it', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const pivot = () => page.getByRole('complementary', { name: 'Inspector' });
  const val = (axis) => page.getByLabel(`Pivot ${axis}`, { exact: true }).inputValue();
  const sceneFile = path.join(projectsDir, 'pivots', 'scenes', 'level_01.cwscene');
  try {
    await newProject(page, 'Pivots');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [128, 128, 16], [0, 0, 0]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await item('block').click();
    await page.keyboard.press('f');

    // 1. By default the pivot is the middle of the brush, and the move gizmo sits there.
    await until(() => val('X'), '64');
    assert.equal(await val('Y'), '64');
    assert.equal(await val('Z'), '8');
    await page.keyboard.press('w');
    await until(() => gizmoAt(page), '64,64,8');

    // 2. Bottom, then a typed value, then back to the middle.
    await pivot().getByRole('button', { name: 'Bottom' }).click();
    await until(() => val('Y'), '0');
    await page.getByLabel('Pivot X', { exact: true }).fill('100');
    await page.getByLabel('Pivot X', { exact: true }).press('Enter');
    await until(() => gizmoAt(page), '100,0,8');
    await pivot().getByRole('button', { name: 'Middle' }).click();
    await until(() => val('X'), '64');

    // 3. Edit pivot (O): drag the gizmo's middle onto the block's corner at x = 0, z = 0: it snaps there.
    await page.keyboard.press('o');
    await page.getByRole('button', { name: 'Pivot', pressed: true }).first().waitFor();
    const from = await screenOf(page, [64, 128, 8]);
    const to = await screenOf(page, [2, 128, 1]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await until(() => val('X'), '0');
    assert.equal(await val('Z'), '0');
    await shot(page, 'pv01-hinge');
    // The block itself didn't move.
    await until(() => page.getByLabel('Centre X', { exact: true }).inputValue(), '64');
    await page.keyboard.press('o');

    // 4. The rotate gizmo turns around the hinge now.
    await page.keyboard.press('e');
    const g = (await gizmoAt(page)).split(',');
    assert.equal(g[0], '0');
    assert.equal(g[2], '0');

    // 5. Saved with the brush, as an offset from its middle.
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const block = JSON.parse(await fs.readFile(sceneFile, 'utf8')).entities.find((e) => e.name === 'block');
    assert.equal(block.components.pivot.point[0], -64);
    assert.equal(block.components.pivot.point[2], -8);

    // 6. Undo takes the pivot back to the middle.
    await page.keyboard.press('Control+z');
    await until(() => val('X'), '64');
  } catch (e) {
    await shot(page, 'pv-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
