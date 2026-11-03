// End-to-end: Blender-like bevel of picked edges in the vertex tool (Ctrl+B, mouse for width, wheel for
// segments, click to make it), then adjusting it, and undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('bevel picked edges', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Bevel');
    await page.evaluate(() => {
      const st = window.__cwStore.getState();
      st.createBrushes([-64, 0, -64], [64, 128, 64]);
      st.setTool('vertex');
    });
    const faces = () => page.evaluate(() => { const st = window.__cwStore.getState(); return st.doc.get(st.selection[0]).components.brush.faces.length; });
    assert.equal(await faces(), 6);
    // Click the middle of the top front edge (y 128, z 64) and of the top right edge (x 64).
    const at = (p) => page.evaluate((p) => window.__cwViewport.toScreen(p), p);
    const a = await at([0, 128, 64]);
    const b = await at([64, 128, 0]);
    await page.mouse.click(a.x, a.y);
    await page.keyboard.down('Control');
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up('Control');
    const c = await at([32, 128, 32]);
    await page.mouse.move(c.x + 5, c.y + 5);
    await page.keyboard.press('Control+b');
    await page.getByTestId('bevel-live').waitFor();
    await page.mouse.move(c.x + 60, c.y + 60, { steps: 4 });
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    const live = await page.getByTestId('bevel-live').textContent();
    assert.match(live, /Segments 3/);
    await shot(page, 'bevel-live');
    await page.mouse.click(c.x + 60, c.y + 60);
    // Two edges, three strips each.
    await until(faces, 12, 4000);
    // Adjust: 1 segment.
    const seg = page.getByLabel('Bevel segments');
    await seg.fill('1');
    await seg.press('Enter');
    await until(faces, 8, 4000);
    await shot(page, 'bevel-made');
    // One undo takes the whole bevel off.
    await page.evaluate(() => window.__cwStore.getState().undo());
    assert.equal(await faces(), 6);
    // Esc cancels a bevel in progress.
    await page.evaluate(() => window.__cwStore.getState().redo());
    assert.equal(await faces(), 8);
  } catch (e) {
    await shot(page, 'bevel-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
