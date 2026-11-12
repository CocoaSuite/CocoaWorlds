// End-to-end (A1): an item made into a weapon in the Screens workspace; in Play, clicking fires it, uses
// ammo (shown on screen) and breaks a breakable crate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('weapons: a pistol with ammo breaks a crate', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const world = (fn) => page.evaluate(fn);
  try {
    await newProject(page, 'Shooting');
    await page.keyboard.press('2');
    await addBrush(page, [1024, 16, 1024], [-512, -16, -512]);
    // A crate ahead of the Player start (which looks along −Z), at eye height.
    await addBrush(page, [64, 64, 64], [-32, 32, -336]);
    await page.getByRole('tree').getByRole('treeitem', { name: 'block_2' }).click();
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Breakable/ }).click();

    // A fire beside the crate: an empty object with Particles (fire).
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Empty object' }).click();
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Particles/ }).click();
    await insp.getByRole('group', { name: 'Particles' }).getByRole('combobox', { name: 'What' }).selectOption({ label: 'Fire' });
    await setField(insp, 'Position X', 96);
    await setField(insp, 'Position Z', -240);

    // Items: a pistol (ready-made weapon) and its 9mm ammo.
    const ws = page.getByRole('tablist', { name: 'Workspace' });
    await ws.getByRole('tab', { name: 'Screens' }).click();
    const items = page.getByRole('list', { name: 'Items' });
    for (const name of ['Pistol', '9mm']) {
      await page.getByRole('button', { name: '+ Item' }).click();
      const field = items.getByRole('listitem').last().getByLabel('Item name');
      await field.fill(name);
      await field.press('Enter');
      await items.getByRole('listitem', { name }).waitFor();
    }
    await items.getByRole('button', { name: 'Pistol: Weapon' }).click();
    await page.getByLabel('Pistol: Ready-made weapon').selectOption({ label: 'Pistol' });
    await until(() => page.getByLabel('Pistol: Uses up').inputValue(), '9mm');
    await shot(page, 'g01-weapon-settings');
    await ws.getByRole('tab', { name: 'Level' }).click();

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await until(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''), 'CANVAS');
    await world(() => {
      const w = window.__cwViewport.play.world;
      w.giveItem('Pistol', 1);
      w.giveItem('9mm', 12);
      w.selectSlot(0);
    });
    await page.getByTestId('hud-ammo').getByText('12').waitFor();

    // Click: one shot, one bullet, 8 damage.
    const box = await page.getByTestId('viewport').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByTestId('hud-ammo').getByText('11').waitFor();
    const crate = () => world(() => {
      const w = window.__cwViewport.play.world;
      return w.healthOf(w.doc.entities.find((e) => e.name === 'block_2').id);
    });
    await until(crate, 42);
    // A bullet hole where it hit, and the fire burning.
    await until(() => world(() => window.__cwViewport.play.effects.decals.length > 0), true);
    await until(() => world(() => window.__cwViewport.play.effects.particles.count > 0), true);
    await shot(page, 'g02-shooting');
    // More shots (the game's clock runs slower than real time on this slow test renderer: wait well over a
    // pistol's quarter second between them) until broken.
    for (let i = 0; i < 12 && (await crate()) > 0; i++) {
      await new Promise((r) => setTimeout(r, 800));
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(await crate(), 0);
    // Seven hits at least, each a bullet.
    assert.ok(Number(await page.getByTestId('hud-ammo').textContent()) <= 5);
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'g-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
