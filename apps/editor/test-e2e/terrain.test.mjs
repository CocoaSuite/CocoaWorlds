// End-to-end (T1): a terrain is ground: drawn, picked, saved in its own file, and stood on in Play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';
test('terrain: drawn, picked, saved, stood on', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Hills');
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Terrain' }).click();
    await until(() => page.evaluate(() => window.__cwViewport.terrains.meshes.length > 0), true, 10000);
    // Clicking the ground picks the terrain.
    await page.keyboard.press('Escape');
    const box = await page.getByTestId('viewport').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.8);
    const insp = page.getByRole('complementary', { name: 'Inspector' });
    await until(() => insp.getByRole('textbox').first().inputValue(), 'terrain', 6000);
    await shot(page, 'terrain01');
    // The Terrain tool: a held stroke raises a hill; one undo takes the whole stroke back.
    const heights = () =>
      page.evaluate(() => {
        let hi = -Infinity, lo = Infinity, painted = 0;
        for (const m of window.__cwViewport.terrains.meshes) {
          const p = m.geometry.getAttribute('position'), w = m.geometry.getAttribute('aWeights'), n = m.geometry.getAttribute('normal');
          for (let i = 0; i < p.count; i++) {
            // (The ground's top only: not its closed underside.)
            if (n.getY(i) < 0.2 || Math.abs(p.getX(i) - 1024) > 200 || Math.abs(p.getZ(i) - 1024) > 200) continue;
            hi = Math.max(hi, p.getY(i));
            lo = Math.min(lo, p.getY(i));
            if (w.getZ(i) > 0.5) painted++;
          }
        }
        return { hi, lo, painted };
      });
    const flat = await heights();
    assert.ok(Math.abs(flat.hi - 256) < 2 && Math.abs(flat.lo - 256) < 2, JSON.stringify(flat));
    await page.getByTestId('viewport').hover();
    await page.keyboard.press('h');
    const panel = page.getByRole('group', { name: 'Terrain tool' });
    const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.62 };
    const stroke = async (ms) => {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + 4, at.y);
      await new Promise((r) => setTimeout(r, ms));
      await page.mouse.up();
    };
    await stroke(1200);
    await until(async () => (await heights()).hi > 290, true, 6000);
    await shot(page, 'terrain-hill');
    await page.keyboard.press('Control+z');
    await until(async () => (await heights()).hi < 260, true, 6000);
    // Dig makes a hole.
    await panel.getByRole('radio', { name: 'Dig' }).click();
    await stroke(200);
    await until(async () => (await heights()).lo < 200, true, 6000);
    // Paint puts layer 3 down.
    await panel.getByRole('radio', { name: 'Paint' }).click();
    await panel.getByRole('radio', { name: 'Layer 3' }).click();
    await stroke(600);
    await until(async () => (await heights()).painted > 10, true, 6000);
    await page.keyboard.press('v');
    // Saved: the scene, and the terrain's shape in its own file.
    await page.keyboard.press('Control+s');
    const dir = path.join(projectsDir, 'hills', 'assets', 'terrain');
    await until(async () => (await fs.readdir(dir).catch(() => [])).length, 1, 8000);
    const [file] = await fs.readdir(dir);
    assert.match(file, /\.cwvox$/);
    assert.ok((await fs.stat(path.join(dir, file))).size > 1000);
    // Play: the player stands on it (there is no other floor).
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await until(() => page.evaluate(() => !!window.__cwViewport.play), true, 20000);
    await new Promise((r) => setTimeout(r, 2500));
    const feet = await page.evaluate(() => window.__cwViewport.play.world.player.feetPosition.y);
    assert.ok(Math.abs(feet) < 6, `feet at ${feet}`);
    await shot(page, 'terrain02');
  } catch (e) {
    await shot(page, 'terrain-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
