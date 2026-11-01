// End-to-end: build a room from brushes, hollow it, cut a doorway with a live subtract brush, move it, apply it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, quit, setField, shot, tempDirs, until } from './helpers.mjs';

async function drawBrush(page) {
  const box = await page.getByTestId('viewport').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 40, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).waitFor();
}

async function setDraft(page, size, corner) {
  const panel = page.getByRole('group', { name: 'Brush tool' });
  for (const [i, a] of ['X', 'Y', 'Z'].entries()) {
    await setField(panel, `Size ${a}`, size[i]);
    await setField(panel, `Corner ${a}`, corner[i]);
  }
}

test('room from brushes, live doorway, apply cut, save', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  try {
    await newProject(page, 'Brush Room');

    // 1. A 512 × 256 × 512 block drawn in the top view, sized exactly with the panel.
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [512, 256, 512], [0, 0, 0]);
    await shot(page, 'b01-draft');
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await tree().getByRole('treeitem', { name: /block/ }).waitFor();
    await page.keyboard.press('v');
    await tree().getByRole('treeitem', { name: /block/ }).click();
    assert.equal(await page.getByLabel('Size X', { exact: true }).inputValue(), '512');
    assert.equal(await page.getByLabel('Size Y', { exact: true }).inputValue(), '256');
    assert.equal(await page.getByLabel('Size Z', { exact: true }).inputValue(), '512');

    // 2. Hollow it into six 16-unit walls.
    await page.getByRole('button', { name: 'Make hollow' }).click();
    await until(() => tree().getByRole('treeitem').count(), 2 + 7);
    for (const n of ['floor', 'ceiling', 'wall_west', 'wall_east', 'wall_north', 'wall_south']) await tree().getByRole('treeitem', { name: n }).waitFor();

    // 3. A live subtract brush through the east wall makes a doorway.
    await page.keyboard.press('b');
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('radio', { name: 'Subtract' }).click();
    await drawBrush(page);
    await setDraft(page, [32, 128, 128], [488, 16, 192]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await tree().getByRole('treeitem', { name: /^cut/ }).waitFor();
    await page.keyboard.press('v');
    await tree().getByRole('treeitem', { name: 'wall_east' }).click();
    await page.getByText('Cut by').waitFor();

    // 4. Moving the cutter moves the hole; the wall brush itself is untouched.
    await tree().getByRole('treeitem', { name: /^cut/ }).click();
    await setField(page, 'Centre Z', 384);
    await tree().getByRole('treeitem', { name: 'wall_east' }).click();
    await page.getByText('Cut by').waitFor();
    // Hide the near walls and ceiling to look in; hidden brushes drop out of the level geometry.
    for (const n of ['ceiling', 'wall_west', 'wall_south']) {
      await tree().getByRole('treeitem', { name: n }).hover();
      await tree().getByRole('treeitem', { name: n }).getByRole('button', { name: 'Hide' }).click();
    }
    await page.keyboard.press('1');
    await page.keyboard.press('Escape');
    await page.keyboard.press('f');
    await shot(page, 'b02-live-doorway');
    for (const n of ['ceiling', 'wall_west', 'wall_south']) {
      await tree().getByRole('treeitem', { name: n }).getByRole('button', { name: 'Show' }).click();
    }

    // 5. Apply the cut: the wall becomes pieces and the cutter is removed. Undo brings it back.
    await tree().getByRole('treeitem', { name: /^cut/ }).click();
    await page.getByRole('button', { name: 'Apply cut' }).click();
    await until(() => tree().getByRole('treeitem', { name: /^cut/ }).count(), 0);
    const pieces = await tree().getByRole('treeitem', { name: /^wall_east_\d/ }).count();
    assert.ok(pieces >= 2, `wall split into pieces (${pieces})`);
    await shot(page, 'b03-applied');
    await page.keyboard.press('Control+z');
    await tree().getByRole('treeitem', { name: /^cut/ }).waitFor();
    await page.keyboard.press('Control+Shift+z');
    await until(() => tree().getByRole('treeitem', { name: /^cut/ }).count(), 0);

    // 6. Save: brushes are in the scene file as three points per face.
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(path.join(projectsDir, 'brush-room', 'scenes', 'level_01.cwscene'), 'utf8'));
    const brushes = scene.entities.filter((e) => e.components.brush);
    assert.ok(brushes.length >= 7, `brushes saved (${brushes.length})`);
    const floor = brushes.find((e) => e.name === 'floor');
    assert.equal(floor.components.brush.role, 'solid');
    assert.equal(floor.components.brush.faces.length, 6);
    for (const f of floor.components.brush.faces) for (const p of f.points) for (const c of p) assert.ok(Number.isInteger(c));
  } catch (e) {
    await shot(page, 'b-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
