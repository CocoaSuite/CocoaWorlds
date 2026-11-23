import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { drawBrush, launch, quit, setDraft, tempDirs, until } from './helpers.mjs';

test('isometric World mode uses an above-ground editor camera and a following Play camera', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  try {
    await page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('Name').fill('Isometric');
    await dialog.getByLabel('World mode').selectOption('isometric');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('tree').getByRole('treeitem').first().waitFor();
    await until(() => page.evaluate(() => {
      const rig = window.__cwViewport?.rig;
      return !!rig && rig.kind === 'isometric' && rig.camera.isOrthographicCamera && rig.camera.position.y > rig.target.y;
    }), true);

    // Switch the editing view to Top to create a floor. Play follows the WORLD mode, not this view.
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [1024, 16, 1024], [-512, -16, -512]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(() => page.evaluate(() => {
      const v = window.__cwViewport;
      const body = v.play?.group.getObjectByName('player-body');
      return !!body && body.visible && v.playCamera.isOrthographicCamera && v.playCamera.position.y > body.position.y;
    }), true, 15000);

    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await until(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''), 'CANVAS');
    assert.equal(await page.locator('.cw-crosshair').count(), 0);
    await page.keyboard.down('w');
    await until(() => page.evaluate(() => {
      const v = window.__cwViewport;
      const feet = v.play.world.player.feetPosition;
      return feet.x < -35 && feet.z < -35 && Math.abs(v.playCamera.focus.x - feet.x) < 10;
    }), true, 15000);
    await page.keyboard.up('w');
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
