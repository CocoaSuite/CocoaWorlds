// End-to-end (R1): a ready-made ladder is a Repeat group. Only the parts are saved; the copies are shown,
// and dragging the knob at the top makes it taller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';
test('repeat: a ladder grows from its handle', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Repeat');
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Ladder' }).click();
    await page.getByTestId('viewport').hover();
    await page.keyboard.press('f');
    const info = () =>
      page.evaluate(() => {
        const v = window.__cwViewport;
        const id = v.selection[0];
        const shown = v.shownDoc(v.doc).entities;
        return {
          saved: v.doc.entities.filter((e) => e.name === 'rung').length,
          rungs: shown.filter((e) => e.name === 'rung').length,
          climbs: shown.filter((e) => e.components.ladder).length,
          length: v.doc.get(id).components.repeat.length,
          handle: v.repeatHandle.visible,
        };
      });
    assert.deepEqual(await info(), { saved: 1, rungs: 4, climbs: 4, length: 128, handle: true });
    await shot(page, 'repeat01');
    // Drag the knob upwards: the ladder gets longer, in whole grid steps.
    const at = await page.evaluate(() => {
      const v = window.__cwViewport;
      const p = v.repeatHandle.position.clone().project(v.rig.camera);
      const r = v.renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    });
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(at.x, at.y - i * 12);
    await page.mouse.up();
    await until(async () => (await info()).length > 128, true, 6000);
    const after = await info();
    assert.ok(after.rungs > 4, `rungs ${after.rungs}`);
    assert.equal(after.saved, 1);
    await shot(page, 'repeat02');
    // One undo step puts it back.
    await page.keyboard.press('Control+z');
    await until(async () => (await info()).rungs, 4, 6000);
    // In the game the copies are drawn too, not only the saved parts.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await until(() => page.evaluate(() => window.__cwViewport.play?.doc.entities.filter((e) => e.name === 'rung').length ?? 0), 4, 15000);
    const tall = await page.evaluate(() => {
      let top = -Infinity;
      window.__cwViewport.play.group.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); top = Math.max(top, o.geometry.boundingBox.max.y); } });
      return top;
    });
    assert.ok(tall >= 128, `level top ${tall}`);
    await shot(page, 'repeat03');
  } catch (e) {
    await shot(page, 'repeat-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
