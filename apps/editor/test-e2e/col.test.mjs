// End-to-end: COL, the invisible collider: drawn with the brush tool, striped in the editor, paintable,
// not drawn in the game but still solid to stand on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('COL: invisible collider', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const item = (name) => page.getByRole('tree').getByRole('treeitem', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) });
  const sceneFile = path.join(projectsDir, 'invisible', 'scenes', 'level_01.cwscene');
  try {
    await newProject(page, 'Invisible');
    await page.keyboard.press('2');
    // 1. Brush tool, kind COL: a floor of invisible collider.
    await page.keyboard.press('b');
    const panel = page.getByRole('group', { name: 'Brush tool' });
    await panel.getByRole('radio', { name: 'COL' }).click();
    await drawBrush(page);
    await setDraft(page, [512, 16, 512], [-256, -16, -256]);
    await panel.getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await item('col').waitFor();
    // 2. A visible block, painted COL on one face from the material picker is possible too: the picker lists it.
    await page.keyboard.press('p');
    await page.getByRole('radio', { name: 'COL — invisible collider' }).waitFor();
    await page.keyboard.press('1');
    await shot(page, 'c01-editor');
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const col = JSON.parse(await fs.readFile(sceneFile, 'utf8')).entities.find((e) => e.name === 'col');
    assert.ok(col.components.brush.faces.every((f) => f.material === 'tool/col'));
    assert.equal(col.components.brush.role, 'solid');

    // 3. Play: nothing of it is drawn, yet the player stands on it.
    await page.keyboard.press('v');
    await page.keyboard.press('F5');
    await page.getByTestId('play-banner').waitFor();
    await until(() => page.evaluate(() => !!window.__cwViewport.play?.world.player), true, 10000);
    const drawn = await page.evaluate(() => {
      let n = 0;
      window.__cwViewport.play.group.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const g of o.geometry.groups.length ? o.geometry.groups : [{ materialIndex: 0, count: o.geometry.index?.count ?? 0 }]) if (mats[g.materialIndex ?? 0]?.visible) n += g.count;
      });
      return n;
    });
    assert.equal(drawn, 0, 'no visible triangles');
    await new Promise((r) => setTimeout(r, 1000));
    const y = await page.evaluate(() => window.__cwViewport.play.world.player.feetPosition.y);
    assert.ok(y > -1 && y < 2, `standing on the floor (${y})`);
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'c-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
