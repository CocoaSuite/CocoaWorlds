// End-to-end (benchmark step B2): a tycoon dropper line made in the editor. A hidden part with Physics is
// the template, an empty drops a copy every second onto a conveyor, and the game is seen in third person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('copies while playing: dropper, conveyor, third person', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const item = (name) => page.getByRole('tree').getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const addComponent = async (name) => {
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
  };
  try {
    await newProject(page, 'Dropper');
    await page.keyboard.press('2');
    await addBrush(page, [1024, 16, 1024], [-512, -16, -512]);
    // The part (hidden template with Physics) and the conveyor belt.
    await addBrush(page, [16, 16, 16], [-8, 200, -8]);
    await addBrush(page, [64, 8, 384], [-32, 0, -400]);

    await item('block_2').click();
    await addComponent('Physics');
    await insp().getByRole('switch', { name: 'Visible' }).click({ force: true });
    await item('block_3').click();
    await addComponent('Conveyor');
    await insp().getByLabel('Speed', { exact: true }).waitFor();

    // The dropper: an empty above the belt that makes a copy every second.
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Empty object' }).click();
    for (const [axis, v] of [
      ['Y', '64'],
      ['Z', '-120'],
    ]) {
      const f = insp().getByLabel(`Position ${axis}`, { exact: true });
      await f.fill(v);
      await f.press('Enter');
    }
    await addComponent('Script');
    const panel = page.getByRole('region', { name: 'Script of object' });
    await panel.getByRole('button', { name: '+ When…' }).click();
    await page.getByRole('menuitem', { name: 'Every few seconds' }).click();
    const stack = panel.getByRole('group', { name: 'Every few seconds' });
    await stack.getByRole('button', { name: '+ Add a block' }).click();
    await page.getByRole('menuitem', { name: 'Objects › Make a copy' }).click();
    await stack.getByLabel('Make a copy of', { exact: true }).selectOption({ label: 'block_2' });
    assert.equal(await stack.getByLabel('Make a copy of at', { exact: true }).inputValue(), 'self');
    assert.equal(await page.getByRole('tab', { name: /Problems \d/ }).count(), 0, 'no problems');
    await shot(page, 'c01-dropper');

    // Third person, from Game rules (nothing selected).
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await insp().getByRole('switch', { name: 'Third-person camera' }).click({ force: true });
    await until(() => insp().getByRole('switch', { name: 'Third-person camera' }).isChecked(), true);

    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    // Copies appear (and are drawn), and the conveyor carries them north.
    const copies = () => page.evaluate(() => (window.__cwViewport.play?.movers ?? []).filter((m) => m.id.includes('#')).map((m) => m.id));
    await until(async () => (await copies()).length >= 2, true, 6000);
    const first = (await copies())[0];
    const z0 = await page.evaluate((id) => window.__cwViewport.play.world.positionOf(id)[2], first);
    await new Promise((r) => setTimeout(r, 1500));
    const z1 = await page.evaluate((id) => window.__cwViewport.play.world.positionOf(id)[2], first);
    assert.ok(z1 < z0 - 30, `carried north (${z0} → ${z1})`);
    assert.ok(await page.evaluate(() => !!window.__cwViewport.play.group.getObjectByName('player-body')), 'the player is seen');
    await shot(page, 'c02-third-person');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'c-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
