// End-to-end: Plant objects of the same kind (here willows) are drawn together (instanced), in the editor and in Play, and each
// can still be picked in the viewport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

test('plants of one kind: one batch, still picked one by one, shown in Play', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const ws = page.getByRole('tablist', { name: 'Workspace' });
  const tree = page.getByRole('tree');
  try {
    await newProject(page, 'Batched');
    // A floor to stand on in Play.
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [4096, 16, 4096], [-2048, -16, -2048]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await page.keyboard.press('1');
    await ws.getByRole('tab', { name: 'Plants' }).click();
    await page.getByRole('button', { name: '+ Willow' }).click();
    await page.getByRole('button', { name: 'Place in scene' }).click();
    await ws.getByRole('tab', { name: 'Level' }).click();
    await tree.getByRole('treeitem', { name: /willow/ }).first().waitFor();
    // Five more copies of it in a row (duplicated, then moved apart).
    const ids = await page.evaluate(() => {
      const st = window.__cwStore.getState();
      const plant = st.doc.entities.find((e) => e.components.plant);
      return { id: plant.id, at: plant.transform.position };
    });
    for (let i = 0; i < 5; i++) {
      await tree.getByRole('treeitem', { name: /willow/ }).first().click();
      await page.keyboard.press('Control+d');
    }
    await until(() => page.evaluate(() => window.__cwStore.getState().doc.entities.filter((e) => e.components.plant).length), 6);
    await page.evaluate(() => {
      const st = window.__cwStore.getState();
      st.doc.entities.filter((e) => e.components.plant).forEach((e, i) => st.setTransform(e.id, { ...e.transform, position: [i * 240 + 64, 0, -900] }));
    });
    const plants = () => page.evaluate(() => {
      const p = window.__cwViewport.plants;
      const batches = p.group.children.filter((o) => o.isInstancedMesh && o.visible);
      return { drawn: p.drawn, instances: batches.reduce((n, b) => n + b.count, 0) };
    });
    // Six plants in one area: one draw per detail level in use (not one each).
    // (A plant dissolving between two levels is in both.)
    await until(async () => (await plants()).instances >= 6, true);
    assert.ok((await plants()).drawn <= 2, `drawn ${(await plants()).drawn}`);
    await shot(page, 'plants-batched-editor');

    // Picking still finds the one plant under the pointer.
    const where = await page.evaluate((id) => {
      const v = window.__cwViewport;
      const m = v.plants.meshes.find((x) => x.userData.entityId === id);
      m.updateMatrixWorld(true);
      const b = m.geometry.boundingBox;
      const mul = (e, p) => [0, 1, 2, 3].map((r) => e[r] * p[0] + e[4 + r] * p[1] + e[8 + r] * p[2] + e[12 + r] * p[3]);
      // (Its middle, through the camera, to the screen.)
      const local = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2, 1];
      const cam = v.rig.camera;
      cam.updateMatrixWorld(true);
      const clip = mul(cam.projectionMatrix.elements, mul(cam.matrixWorldInverse.elements, mul(m.matrixWorld.elements, local)));
      const c = { x: clip[0] / clip[3], y: clip[1] / clip[3] };
      const r = v.renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height, id };
    }, ids.id);
    {
      await page.mouse.click(where.x, where.y);
      await until(() => page.evaluate(() => window.__cwStore.getState().selection.length > 0), true);
      assert.equal(await page.evaluate(() => !!window.__cwStore.getState().doc.entities.find((e) => e.id === window.__cwStore.getState().selection[0])?.components.plant), true);
    }

    // In Play: batched too.
    await page.keyboard.press('Escape');
    await page.keyboard.press('F5');
    await page.getByTestId('play-banner').waitFor();
    await until(() => page.evaluate(() => {
      const p = window.__cwViewport.play?.plants;
      return p ? p.group.children.filter((o) => o.isInstancedMesh && o.visible).reduce((n, b) => n + b.count, 0) >= 6 : false;
    }), true, 30000);
    await shot(page, 'plants-batched-play');
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'plants-batched-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
