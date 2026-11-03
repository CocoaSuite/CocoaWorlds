// End-to-end: a smart material (Stylised rock) is made from the Materials tab, bakes, and is projected on brushes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('smart material: stylised rock', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Rock');
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await page.getByLabel('+ Smart material…').selectOption({ label: 'Stylised rock' });
    await until(() => page.evaluate(() => (window.__cwStore.getState().session.project.settings.materials ?? []).some((m) => m.name === 'Stylised rock' && !!m.map && !!m.normalMap)), true, 30000);
    const m = await page.evaluate(() => window.__cwStore.getState().session.project.settings.materials[0]);
    assert.equal(m.mapping, 'world');
    await shot(page, 'smart-rock-editor');
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Scene' }).click();
    await page.evaluate((id) => {
      const st = window.__cwStore.getState();
      const ids = [];
      st.setBrushOptions?.({ shape: 'box' });
      st.createBrushes([-512, -64, -512], [512, 0, 512]);
      ids.push(...window.__cwStore.getState().selection);
      st.createBrushes([-160, 0, -96], [96, 224, 128]);
      ids.push(...window.__cwStore.getState().selection);
      const doc = window.__cwStore.getState().doc;
      st.setFaceSurfaces(ids.flatMap((e) => doc.get(e).components.brush.faces.map((_, face) => ({ id: e, face, patch: { material: id } }))), 'Paint');
      if (!st.gameLighting) st.toggle('gameLighting');
      const v = window.__cwViewport;
      v.rig.pos.set(-330, 230, 420);
      v.rig.yaw = -0.62;
      v.rig.pitch = -0.33;
      v.rig.applyPersp();
      v.invalidate();
    }, m.id);
    await new Promise((r) => setTimeout(r, 2500));
    await shot(page, 'smart-rock');
  } catch (e) {
    await shot(page, 'smart-rock-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
