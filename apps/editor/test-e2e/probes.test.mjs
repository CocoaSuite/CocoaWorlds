// End-to-end: rooms made of brushes get their own reflection probes; a shiny floor reflects its own room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('reflection probes for rooms', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 600)));
  try {
    await newProject(page, 'Probes');
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: '+ Material', exact: true }).click();
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Level' }).click();
    const n = await page.evaluate(() => {
      const st = window.__cwStore.getState();
      const m = { ...st.session.project.settings.materials[0], color: '#d8d8d8', metalness: 1, roughness: 0.12 };
      st.setMaterials([m], 'Shiny');
      const boxes = [];
      const t = 16;
      const room = (a, b, skipEast, skipWest) => {
        boxes.push([[a[0] - t, a[1] - t, a[2] - t], [b[0] + t, a[1], b[2] + t], 'floor']);
        boxes.push([[a[0] - t, b[1], a[2] - t], [b[0] + t, b[1] + t, b[2] + t]]);
        if (!skipWest) boxes.push([[a[0] - t, a[1], a[2] - t], [a[0], b[1], b[2] + t]]);
        if (!skipEast) boxes.push([[b[0], a[1], a[2] - t], [b[0] + t, b[1], b[2] + t]]);
        boxes.push([[a[0], a[1], a[2] - t], [b[0], b[1], a[2]]]);
        boxes.push([[a[0], a[1], b[2]], [b[0], b[1], b[2] + t]]);
      };
      room([0, 0, 0], [512, 192, 512], true, false);
      room([528, 0, 0], [1040, 192, 512], false, true);
      // The shared wall with a doorway.
      boxes.push([[512, 0, -16], [528, 192, 224]], [[512, 0, 288], [528, 192, 528]], [[512, 128, 224], [528, 192, 288]]);
      // A column to see in the floor, and ground outside.
      boxes.push([[200, 0, 200], [264, 192, 264]]);
      boxes.push([[-2048, -64, -2048], [3072, -16, 3072]]);
      const floors = [];
      for (const [a, b, kind] of boxes) {
        st.createBrushes(a, b);
        if (kind) floors.push(...window.__cwStore.getState().selection);
      }
      const doc = window.__cwStore.getState().doc;
      const changes = floors.flatMap((id) => doc.get(id).components.brush.faces.map((_, face) => ({ id, face, patch: { material: m.id } })));
      st.setFaceSurfaces(changes, 'Paint floors');
      if (!st.gameLighting) st.toggle('gameLighting');
      st.toggle('showProbes');
      const v = window.__cwViewport;
      v.rig.pos.set(40, 150, 40);
      v.rig.yaw = -2.36;
      v.rig.pitch = -0.4;
      v.rig.focusDist = 300;
      v.rig.applyPersp();
      v.invalidate();
      return boxes.length;
    });
    assert.ok(n > 10);
    await until(() => page.evaluate(() => window.__cwViewport.reflections?.boxes.length ?? 0), 2, 8000);
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, 'probes-on');
    await page.evaluate(() => window.__cwStore.getState().setSceneSettings({ autoProbes: false }, 'off'));
    await until(() => page.evaluate(() => window.__cwViewport.reflections?.boxes.length ?? -1), 0, 8000);
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, 'probes-off');
  } catch (e) {
    await shot(page, 'probes-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
