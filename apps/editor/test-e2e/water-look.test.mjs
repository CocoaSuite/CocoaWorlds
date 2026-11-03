// End-to-end: stylized water — shallow and deep colours from the depth behind it, foam along the shore and round
// what stands in it. A sloping terrain beach, a sea over half of it, a block standing in the water.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';
async function addBrush(page, size, corner, kind = 'Solid') {
  await page.keyboard.press('b');
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('radio', { name: kind, exact: true }).click();
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}
test('water look: depth colours and foam', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Sea');
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Terrain' }).click();
    await until(() => page.evaluate(() => window.__cwViewport.terrains.meshes.length > 0), true, 10000);
    // A slope from deep (west) up to dry land (east).
    const png = await page.evaluate(async () => {
      const c = new OffscreenCanvas(64, 64);
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 64, 0);
      grad.addColorStop(0, '#000');
      grad.addColorStop(1, '#fff');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      // A little island out in the sea.
      g.fillStyle = '#9a9a9a';
      g.beginPath();
      g.arc(14, 40, 5, 0, Math.PI * 2);
      g.fill();
      const b = await c.convertToBlob({ type: 'image/png' });
      return [...new Uint8Array(await b.arrayBuffer())];
    });
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    await insp.getByTestId('import-heightmap').setInputFiles({ name: 'beach.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await page.keyboard.press('2');
    await addBrush(page, [2048, 240, 2048], [-1024, -240, -1024], 'Water');
    await addBrush(page, [64, 320, 64], [-300, -240, -120]);
    // Water is drawn with the water look, which reads the scene's depth.
    await until(
      () => page.evaluate(() => { let n = 0; window.__cwViewport.scene.traverse((o) => { if (o.material?.name === 'cw-water') n++; }); return n; }),
      1,
      8000,
    );
    await page.getByRole('radio', { name: 'Perspective' }).click();
    await page.evaluate(() => {
      const v = window.__cwViewport;
      v.rig.camera.position.set(-200, 900, 700);
      v.rig.camera.lookAt(-150, -60, -100);
      v.rig.camera.updateMatrixWorld();
      v.invalidate();
    });
    await new Promise((r) => setTimeout(r, 1500));
    const depth = await page.evaluate(() => window.__cwViewport.waterDepth.target?.width ?? 0);
    assert.ok(depth > 0, 'a depth picture was drawn');
    await shot(page, 'water-look');
  } catch (e) {
    await shot(page, 'water-look-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
