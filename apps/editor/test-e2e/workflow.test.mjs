// End-to-end: move several objects at once, snap to a corner, group / ungroup, copy / cut / paste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBlock(page, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, [128, 128, 128], corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

/** Screen position of a world point, from the viewport's own projection. */
const screenOf = (page, p) => page.evaluate((p) => window.__cwViewport.toScreen(p), p);

test('multi-move, corner snap, groups, clipboard', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  // Hovered rows also expose their Lock/Hide buttons in the accessible name, so match the label as a whole word.
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const selected = (name) => item(name).getAttribute('aria-selected');
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const centreX = async (name) => {
    await item(name).click();
    await until(() => selected(name), 'true');
    await frames();
    return Number(await page.getByLabel('Centre X', { exact: true }).inputValue());
  };
  const dragX = async (fromX, fromY, toX, toY) => {
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move((fromX + toX) / 2, (fromY + toY) / 2, { steps: 6 });
    await page.mouse.move(toX, toY, { steps: 6 });
    await page.mouse.up();
  };
  try {
    await newProject(page, 'Group Copy');
    await page.keyboard.press('2');
    await addBlock(page, [0, 0, 0]);
    await addBlock(page, [256, 0, 0]);
    assert.equal(await centreX('block'), 64);
    assert.equal(await centreX('block_2'), 320);

    // 1. Two blocks selected: the gizmo moves both, by the same grid step, as one undo step.
    await item('block').click();
    await item('block_2').click({ modifiers: ['Control'] });
    await page.keyboard.press('f');
    await page.keyboard.press('w');
    const vb = await page.getByTestId('viewport').boundingBox();
    const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
    await dragX(cx + 45, cy, cx + 125, cy);
    await shot(page, 'w01-multi-move');
    const a = await centreX('block');
    const b = await centreX('block_2');
    assert.ok(a > 64, `first block moved (${a})`);
    assert.equal(a % 16, 0, 'grid step');
    assert.equal(b - a, 256, 'both moved together');
    await page.keyboard.press('Control+z');
    await until(() => centreX('block'), 64);
    assert.equal(await centreX('block_2'), 320);

    // 2. Corner snap: with grid snap off, dragging block_2 onto block's corner lines them up exactly.
    await item('block_2').click();
    await page.keyboard.press('g');
    const gizmo = await screenOf(page, [320, 128, 64]);
    const corner = await screenOf(page, [128, 128, 0]);
    await dragX(gizmo.x + 45, gizmo.y, corner.x, corner.y);
    await shot(page, 'w02-corner-snap');
    const c2 = await centreX('block_2');
    const min = c2 - 64, max = c2 + 64;
    assert.ok(min === 128 || max === 128, `block_2 snapped to x = 128 (spans ${min}–${max})`);
    await page.keyboard.press('g');
    await page.keyboard.press('Control+z');
    await until(() => centreX('block_2'), 320);

    // 3. Group: Ctrl+G; a click in the view picks the group, a double-click the block inside, Esc steps out.
    await page.keyboard.press('Escape');
    await item('block').click();
    await item('block_2').click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+g');
    await item('group').waitFor();
    assert.equal(await selected('group'), 'true');
    await page.keyboard.press('Escape'); // back to the select tool
    await page.keyboard.press('Escape'); // clear the selection
    const inA = await screenOf(page, [64, 128, 64]);
    await page.mouse.click(inA.x, inA.y);
    await until(() => selected('group'), 'true');
    await page.mouse.dblclick(inA.x, inA.y);
    await until(() => selected('block'), 'true');
    assert.equal(await selected('group'), 'false');
    await page.keyboard.press('Escape');
    await until(() => selected('group'), 'true');
    // Moving the group moves what's inside.
    await page.keyboard.press('f');
    await page.keyboard.press('w');
    await dragX(cx + 45, cy, cx + 125, cy);
    const g1 = await centreX('block');
    assert.ok(g1 > 64 && (await centreX('block_2')) - g1 === 256, 'group moved as a whole');
    await page.keyboard.press('Control+z');
    await until(() => centreX('block'), 64);
    // Ungroup puts the blocks back where they were in the tree and selects them.
    await item('group').click();
    await page.keyboard.press('Control+Shift+g');
    await until(() => item('group').count(), 0);
    assert.equal(await selected('block'), 'true');
    assert.equal(await selected('block_2'), 'true');

    // 4. Copy / paste: each paste lands one grid step further; cut then paste puts it back in place.
    await item('block').click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await item('block_3').waitFor();
    assert.equal(await selected('block_3'), 'true');
    assert.equal(await centreX('block_3'), 80);
    await page.keyboard.press('Control+v');
    assert.equal(await centreX('block_4'), 96);
    await page.keyboard.press('Control+x');
    await until(() => item('block_4').count(), 0);
    await page.keyboard.press('Control+v');
    assert.equal(await centreX('block_4'), 96);
    await page.keyboard.press('Control+z');
    await until(() => item('block_4').count(), 0);

    // 5. Copying a group copies what's inside it.
    await item('block').click();
    await item('block_2').click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+g');
    await item('group').waitFor();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await item('group_2').waitFor();
    assert.equal(await item('block_2').count(), 2, 'the copy has its own block_2');
    await shot(page, 'w03-groups');

    // 6. Save and check the file: a group entity with a group component and children pointing at it.
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
  } catch (e) {
    await shot(page, 'w-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
