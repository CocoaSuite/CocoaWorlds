// End-to-end: give a trigger zone a script with the block editor, play it, see it act, and see problems.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner, trigger = false) {
  if (trigger) await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Trigger zone' }).click();
  else await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('a door script made from blocks', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const tree = () => page.getByRole('tree');
  const item = (name) => tree().getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const panel = () => page.getByRole('region', { name: 'Script of trigger' });
  const consoleText = () => page.getByRole('tab', { name: 'Console' }).click().then(() => page.getByRole('log').textContent());
  try {
    await newProject(page, 'Door Script');
    // No Player start: Play is the physics preview (the crate does the work here).
    await item('player_spawn').click();
    await page.keyboard.press('Delete');
    await until(() => item('player_spawn').count(), 0);
    await page.keyboard.press('2');
    await addBrush(page, [512, 16, 512], [-256, -16, -256]);
    await addBrush(page, [16, 128, 128], [100, 0, -64]);
    await addBrush(page, [32, 32, 32], [-16, 200, -16]);
    await addBrush(page, [128, 80, 128], [-64, 60, -64], true);
    // The crate falls; the zone notices physics objects.
    await item('block_3').click();
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Physics/ }).click();
    await item('trigger').click();
    await insp().getByLabel('Notices', { exact: true }).selectOption({ label: 'Physics objects' });

    // 1. Add a script: the Visual script tab opens on it.
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Script/ }).click();
    await panel().waitFor();
    await panel().getByText('Start with a “When…” stack', { exact: false }).waitFor();

    // 2. When something enters this zone → move the door up, then write in the console.
    await panel().getByRole('button', { name: '+ When…' }).click();
    await page.getByRole('menuitem', { name: 'When something enters a zone' }).click();
    const stack = panel().getByRole('group', { name: 'When something enters a zone' });
    await stack.getByRole('button', { name: '+ Add a block' }).click();
    await page.getByRole('menuitem', { name: 'Do › Move' }).click();
    const move = stack.getByRole('group', { name: 'Move' });
    await move.getByLabel('Move', { exact: true }).selectOption({ label: 'block_2' });
    const over = move.getByLabel('Move over', { exact: true });
    await over.fill('0.5');
    await over.press('Enter');
    await stack.getByRole('button', { name: '+ Add a block' }).last().click();
    await page.getByRole('menuitem', { name: 'Do › Write in the console' }).click();
    const write = stack.getByRole('group', { name: 'Write in the console' });
    await write.getByLabel('Write', { exact: true }).fill('Door opened');
    await write.getByLabel('Write', { exact: true }).press('Enter');
    await shot(page, 's01-script');

    // 3. A block with a problem says so under itself and in the Problems tab.
    await stack.getByRole('button', { name: '+ Add a block' }).last().click();
    await page.getByRole('menuitem', { name: 'Variables › Change a variable' }).click();
    await stack.getByText('Pick a variable.').waitFor();
    await page.getByRole('tab', { name: /Problems 1/ }).waitFor();
    await stack.getByRole('group', { name: 'Change a variable' }).hover();
    await stack.getByRole('group', { name: 'Change a variable' }).getByRole('button', { name: 'Remove block' }).click();
    await until(() => stack.getByText('Pick a variable.').count(), 0);

    // 4. Play: the crate drops into the zone, the door slides up, the console says so.
    await page.keyboard.press('F5');
    await page.getByTestId('play-banner').waitFor();
    await until(async () => (await consoleText()).includes('Door opened'), true, 10000);
    await until(
      () => page.evaluate(() => {
        const w = window.__cwViewport.play.world;
        return w.movingBodies().filter((b) => b.kind === 'unit').map((b) => Math.round(w.positionOf(b.id)[1]));
      }).then((ys) => ys.join()),
      '128',
      5000,
    );
    await shot(page, 's02-door-open');
    await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);

    // 5. Saved with the scene, on the zone.
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(path.join(projectsDir, 'door-script', 'scenes', 'level_01.cwscene'), 'utf8'));
    const script = scene.entities.find((e) => e.name === 'trigger').components.script;
    assert.equal(script.handlers[0].event.kind, 'enter');
    assert.deepEqual(script.handlers[0].body.map((b) => b.kind), ['move', 'log']);
    assert.equal(script.handlers[0].body[0].seconds.value, 0.5);
  } catch (e) {
    await shot(page, 's-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
