// End-to-end (benchmark step B5): a shop screen made in the Screens tab — a Buy button, a text showing Cash and
// a hotbar — and blocks that pay and give a seed. Played: the screen frees the mouse, Buy works, the hotbar shows
// the seeds; a click with a seed in hand uses one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('screen UI: a shop with a button, a value text and a hotbar', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const item = (name) => page.getByRole('tree').getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  try {
    await newProject(page, 'Garden');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [1024, 16, 1024], [-512, -16, -512]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');

    // 1. The Screens tab: a screen that frees the mouse, with a Buy button, a text and a hotbar; an item.
    // The Screens workspace fills the window; the 3D view is out of the way.
    const ws = page.getByRole('tablist', { name: 'Workspace' });
    assert.equal(await ws.getByRole('tab', { name: 'Materials' }).isDisabled(), true);
    await ws.getByRole('tab', { name: 'Screens' }).click();
    await page.getByRole('region', { name: 'Screens' }).waitFor();
    assert.equal(await page.getByTestId('viewport').isVisible(), false);
    await page.getByRole('button', { name: '+ Screen' }).click();
    const screens = page.getByRole('list', { name: 'Screens' });
    await screens.getByRole('listitem', { name: 'Screen' }).waitFor();
    await screens.getByRole('switch', { name: 'Frees the mouse' }).click({ force: true });
    const tools = page.getByRole('toolbar', { name: 'Add to screen' });
    const props = () => page.getByRole('complementary', { name: 'Screen element' });
    const setText = async (label, value) => {
      const f = props().getByLabel(label, { exact: true });
      await f.fill(value);
      await f.press('Enter');
    };
    await tools.getByRole('button', { name: '+ Button' }).click();
    await setText('Name', 'Buy');
    await setText('Text', 'Buy a seed');
    await tools.getByRole('button', { name: '+ Text' }).click();
    await setText('Name', 'CashText');
    await setText('Text', 'Cash: {Cash}');
    // Hang it from the top-left corner.
    await props().getByRole('radio', { name: 'top-left' }).click();
    await tools.getByRole('button', { name: '+ Hotbar' }).click();
    await page.getByRole('button', { name: '+ Item' }).click();
    const items = page.getByRole('list', { name: 'Items' });
    const itemName = items.getByLabel('Item name');
    await itemName.fill('Seed');
    await itemName.press('Enter');
    await items.getByRole('listitem', { name: 'Seed' }).waitFor();

    // Dragging the button on the stage moves it.
    const stage = page.getByTestId('ui-stage');
    const btn = stage.locator('[data-ui="Buy"]');
    await btn.click();
    const x0 = Number(await props().getByLabel('Screen element X', { exact: true }).inputValue());
    const bb = await btn.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2, { steps: 6 });
    await page.mouse.up();
    const x1 = Number(await props().getByLabel('Screen element X', { exact: true }).inputValue());
    assert.ok(x1 > x0 + 20, `dragged from ${x0} to ${x1}`);
    await shot(page, 'ui01-editor');

    // Keys belong to the Screens workspace: B doesn't pick the brush tool; Delete removes the picked element.
    await page.keyboard.press('b');
    await tools.getByRole('button', { name: '+ Panel' }).click();
    await stage.locator('[data-ui="Panel"]').waitFor();
    await page.keyboard.press('Delete');
    await until(() => stage.locator('[data-ui="Panel"]').count(), 0);
    await ws.getByRole('tab', { name: 'Scene' }).click();
    await page.getByTestId('viewport').waitFor();
    assert.equal(await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: /Select/ }).first().getAttribute('aria-pressed'), 'true');

    // 2. Blocks on the floor: Cash, and clicking Buy adds 1 Cash and gives a seed; using a seed says so.
    await item('block').click();
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Script/ }).click();
    const panel = page.getByRole('region', { name: 'Script of block' });
    await panel.getByRole('button', { name: '+ Game value' }).click();
    await panel.getByLabel('Game value name').waitFor();
    await panel.getByRole('button', { name: '+ When…' }).click();
    await page.getByRole('menuitem', { name: 'When the player clicks a button on screen' }).click();
    const stack = panel.getByRole('group', { name: 'When the player clicks a button on screen' });
    assert.equal(await stack.getByLabel('When the player clicks', { exact: true }).locator('option:checked').textContent(), 'Screen › Buy');
    await stack.getByRole('button', { name: '+ Add a block' }).click();
    await page.getByRole('menuitem', { name: 'Variables › Change a variable' }).click();
    await stack.getByLabel('Change', { exact: true }).selectOption({ label: 'Cash (game)' });
    await stack.getByRole('button', { name: '+ Add a block' }).last().click();
    await page.getByRole('menuitem', { name: 'Inventory › Give the player an item' }).click();
    assert.equal(await stack.getByLabel('Give the player', { exact: true }).inputValue(), 'Seed');
    await panel.getByRole('button', { name: '+ When…' }).click();
    await page.getByRole('menuitem', { name: 'When the player uses an item (click)' }).click();
    const use = panel.getByRole('group', { name: 'When the player uses an item (click)' });
    await use.getByRole('button', { name: '+ Add a block' }).click();
    await page.getByRole('menuitem', { name: 'Inventory › Take an item from the player' }).click();
    assert.equal(await page.getByRole('tab', { name: /Problems \d/ }).count(), 0, 'no problems');
    await shot(page, 'ui02-blocks');

    // Saved in the scene.
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(path.join(projectsDir, 'garden', 'scenes', 'level_01.cwscene'), 'utf8'));
    assert.deepEqual(scene.settings.ui.screens[0].elements.map((e) => e.name), ['Buy', 'CashText', 'Hotbar']);
    assert.deepEqual(scene.settings.ui.items, [{ name: 'Seed', icon: '' }]);

    // 3. Play: the mouse is free (no “click to play”), Buy works, the hotbar fills.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    const layer = page.getByTestId('ui-layer');
    await layer.getByRole('status').filter({ hasText: 'Cash: 0' }).waitFor();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await page.getByTestId('click-to-play').count(), 0, 'the screen frees the mouse');
    for (let i = 0; i < 3; i++) await layer.getByRole('button', { name: 'Buy a seed' }).click();
    await layer.getByRole('status').filter({ hasText: 'Cash: 3' }).waitFor();
    await layer.getByRole('listitem', { name: 'Seed 3' }).waitFor();
    await shot(page, 'ui03-play');
    // Using a seed (as a click while the mouse is captured would).
    await page.evaluate(() => window.__cwViewport.play.useItem());
    await layer.getByRole('listitem', { name: 'Seed 2' }).waitFor();
    // Number keys pick a slot.
    await page.evaluate(() => window.__cwViewport.play.selectSlot(2));
    await until(() => layer.locator('.cw-ui-slot.on').getAttribute('aria-label'), 'slot 3');
    await page.keyboard.press('Escape');
    if (await page.getByTestId('play-banner').count()) await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
    assert.equal(await page.getByTestId('ui-layer').count(), 0);
  } catch (e) {
    await shot(page, 'ui-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
