// End-to-end: a many-sided sphere selects without stalling; the brush height follows the cursor and a click over
// a panel finishes it; blocks can be copied and pasted; the new blocks are in the menus; a swinging door turns
// on a hinge; a model can collide by its own shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, findBlock, launch, newProject, pickBlock, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('fixes: sphere selection, brush height, copy and paste, hinged doors, model collision', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const item = (name) => page.getByRole('tree').getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  try {
    await newProject(page, 'Fixes');
    await page.keyboard.press('2');

    // 1. A 32-sided sphere: selecting it doesn't stall the editor.
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Brush shapes' }).click(); await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Sphere brush' }).click();
    const brushPanel = page.getByRole('group', { name: 'Brush tool' });
    const sides = brushPanel.getByLabel('Sides', { exact: true });
    await sides.fill('32');
    await sides.press('Enter');
    await drawBrush(page);
    await setDraft(page, [256, 256, 256], [-128, 0, -128]);
    await brushPanel.getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await item('sphere').waitFor();
    await page.keyboard.press('Escape');
    const t0 = Date.now();
    await item('sphere').click();
    await until(() => item('sphere').getAttribute('aria-selected'), 'true');
    await insp().getByRole('button', { name: 'Add component' }).waitFor();
    // Two frames drawn after selecting.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const took = Date.now() - t0;
    assert.ok(took < 2000, `selecting the sphere took ${took} ms`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('1');

    // 2. Brush height: after the footprint the top follows the cursor; a click over the Inspector finishes it.
    await page.keyboard.press('b');
    const box = await page.getByTestId('viewport').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height * 0.7;
    await page.mouse.move(cx - 260, cy - 20);
    await page.mouse.down();
    await page.mouse.move(cx - 160, cy + 30, { steps: 6 });
    await page.mouse.up();
    await brushPanel.getByRole('button', { name: 'Create' }).waitFor();
    const height = () => page.evaluate(() => window.__cwViewport.draft?.height ?? null);
    const h0 = await height();
    // Up a little: a little taller (not hundreds of units for a few pixels).
    await page.mouse.move(cx - 160, cy + 10, { steps: 4 });
    const h1 = await height();
    assert.ok(h1 > h0 && h1 - h0 < 200, `height ${h0} → ${h1}`);
    // Off over the Inspector: still following, and a click there finishes the brush.
    const ib = await insp().boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + 40, { steps: 10 });
    await shot(page, 'fx01-height-over-panel');
    const before = await page.getByRole('tree').getByRole('treeitem').count();
    await page.mouse.click(ib.x + ib.width / 2, ib.y + 40);
    await until(() => page.getByRole('tree').getByRole('treeitem').count(), before + 1);
    await page.keyboard.press('v');

    // 3. Blocks: copy and paste, by button and by keyboard; the new blocks are in the menus.
    await item('block').click();
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Script/ }).click();
    const script = page.getByRole('region', { name: 'Script of block' });
    await script.getByRole('button', { name: '+ When…' }).click();
    await findBlock(page, 'When a message stops coming');
    await pickBlock(page, 'When the game starts');
    const stack = () => script.getByRole('group', { name: 'When the game starts' });
    await stack().getByRole('button', { name: '+ Add a block' }).click();
    await findBlock(page, 'Control › Repeat while …');
    await findBlock(page, 'Do › Turn to an angle (doors)');
    await pickBlock(page, 'Control › Wait');
    const waits = () => script.getByRole('group', { name: 'Wait' }).count();
    assert.equal(await waits(), 1);
    await script.getByRole('group', { name: 'Wait' }).getByRole('button', { name: 'Copy this block' }).click();
    await stack().getByRole('button', { name: '+ Add a block' }).last().click();
    await pickBlock(page, 'Paste the copied blocks (1)');
    await until(waits, 2);
    // Keyboard: click the words of the first Wait, Ctrl+C, Ctrl+V pastes after it.
    await script.getByRole('group', { name: 'Wait' }).first().locator('.cw-blk-words').click({ position: { x: 4, y: 6 } });
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await until(waits, 3);
    // A whole stack: copy it with its button, paste it from “+ When…”.
    await stack().getByRole('button', { name: 'Copy this stack' }).click();
    await script.getByRole('button', { name: '+ When…' }).click();
    await pickBlock(page, 'Paste the copied stack');
    await until(() => script.getByRole('group', { name: 'When the game starts' }).count(), 2);
    await until(waits, 6);
    // Ctrl+Z takes the paste back.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    await until(waits, 3);
    // A “while” block with “is inside a zone”.
    await stack().getByRole('button', { name: '+ Add a block' }).last().click();
    await pickBlock(page, 'Control › Repeat while …');
    await script.getByRole('group', { name: 'Repeat while …' }).waitFor();
    await shot(page, 'fx02-blocks');

    // 4. A swinging door: the recipe puts the pivot on its hinge.
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [128, 128, 8], [256, 0, -300]);
    await brushPanel.getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await item('block_2').click();
    await insp().getByRole('button', { name: 'Recipes…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Swinging door: E opens and closes it/ }).click();
    await page.getByRole('region', { name: 'Script of block_2' }).getByRole('group', { name: 'When the player uses this (E)' }).waitFor();
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(path.join(projectsDir, 'fixes', 'scenes', 'level_01.cwscene'), 'utf8'));
    const door = scene.entities.find((e) => e.name === 'block_2');
    // The hinge: the west end (x = 256), a pivot 64 left of the door's middle.
    assert.deepEqual(door.components.pivot.point.map((v) => Math.round(v)), [-64, 0, 0]);
    assert.ok(JSON.stringify(door.components.script).includes('"turnTo"'));

    // 5. A model can collide by its own shape.
    await page.keyboard.press('Escape');
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Empty object' }).click();
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Model/ }).click();
    const collision = insp().getByRole('group', { name: 'Model' }).getByRole('combobox', { name: 'Collision' });
    assert.deepEqual(await collision.locator('option').allTextContents(), ['None', 'Box', 'Hull', 'Exact']);
    await collision.selectOption({ label: 'Hull' });
    await until(() => collision.inputValue(), 'hull');
  } catch (e) {
    await shot(page, 'fx-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
