// End-to-end (T2): terrain tiles. A tile added beside a terrain carries its ground on and meets it with no wall at
// the seam; one stroke over the seam raises both; undo takes both back; both are saved; Play stands on the seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('terrain tiles: added beside, seamless, shaped across the seam, played on', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Tiles');
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Terrain' }).click();
    await until(() => page.evaluate(() => window.__cwViewport.terrains.meshes.length > 0), true, 10000);

    // Terrain tool, then a tile on +X.
    await page.getByTestId('viewport').hover();
    await page.keyboard.press('h');
    const panel = page.getByRole('group', { name: 'Terrain tool' });
    await panel.getByRole('button', { name: 'Add a tile on +X' }).click();
    const terrains = () => page.evaluate(() => window.__cwStore.getState().doc.entities.filter((e) => e.components.terrain).map((e) => ({ id: e.id, name: e.name, file: e.components.terrain.file, x: e.transform.position[0], y: e.transform.position[1], z: e.transform.position[2] })));
    await until(async () => (await terrains()).length, 2, 6000);
    const [a, b] = await terrains();
    assert.equal(b.x - a.x, 2048, 'one tile’s width along x');
    assert.equal(b.z, a.z);
    assert.equal(b.y, a.y);
    assert.notEqual(b.file, a.file);
    // A second +X from the first is taken.
    await page.getByRole('tree').getByRole('treeitem', { name: a.name, exact: true }).click();
    await panel.getByRole('button', { name: 'Add a tile on +X' }).click();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await terrains()).length, 2);

    // The ground in world space near the seam (x = seam ± 200): its top, and any upright faces right on the seam.
    const seamX = a.x + 2048, midZ = a.z + 1024, ground = a.y + 256;
    const near = () =>
      page.evaluate(([seamX, midZ, ground]) => {
        let hiA = -Infinity, hiB = -Infinity, wall = 0, tris = 0;
        const v = window.__cwViewport.rig.camera.position.clone();
        for (const m of window.__cwViewport.terrains.meshes) {
          m.updateMatrixWorld(true);
          const p = m.geometry.getAttribute('position'), n = m.geometry.getAttribute('normal');
          for (let i = 0; i < p.count; i++) {
            v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld);
            // (Above the grid's bottom: its closed underside has upright sides all round.)
            if (Math.abs(v.x - seamX) < 12 && Math.abs(n.getX(i)) > 0.95 && v.y > ground - 200) wall++;
            if (n.getY(i) < 0.2 || Math.abs(v.x - seamX) > 200 || Math.abs(v.z - midZ) > 200) continue;
            tris++;
            if (v.x < seamX) hiA = Math.max(hiA, v.y - ground);
            else hiB = Math.max(hiB, v.y - ground);
          }
        }
        return { hiA, hiB, wall, tris };
      }, [seamX, midZ, ground]);
    const flat = await near();
    assert.equal(flat.wall, 0, `no wall at the seam (${JSON.stringify(flat)})`);
    assert.ok(Math.abs(flat.hiA) < 2 && Math.abs(flat.hiB) < 2, `flat on both sides ${JSON.stringify(flat)}`);

    // A stroke right on the seam raises both tiles, and still no wall.
    // (The view framed on the seam.)
    await page.evaluate(([x, y, z]) => {
      const v = window.__cwViewport;
      const lo = v.rig.camera.position.clone().set(x - 400, y - 50, z - 400);
      const hi = v.rig.camera.position.clone().set(x + 400, y + 50, z + 400);
      v.rig.frame({ min: lo, max: hi, getCenter: (o) => o.copy(lo).add(hi).multiplyScalar(0.5), getSize: (o) => o.copy(hi).sub(lo), getBoundingSphere: (sp) => { sp.center.copy(lo).add(hi).multiplyScalar(0.5); sp.radius = lo.distanceTo(hi) / 2; return sp; }, isEmpty: () => false });
      v.invalidate();
    }, [seamX, ground, midZ]);
    await page.getByTestId('viewport').hover();
    await new Promise((r) => setTimeout(r, 300));
    const box = await page.getByTestId('viewport').boundingBox();
    const at = await page.evaluate(([x, y, z]) => {
      const c = window.__cwViewport.rig.camera;
      c.updateMatrixWorld(true);
      const p = c.position.clone().set(x, y, z).project(c);
      return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
    }, [seamX, ground, midZ]);
    assert.ok(at.x > 0.05 && at.x < 0.95 && at.y > 0.05 && at.y < 0.95, `the seam is in view (${JSON.stringify(at)})`);
    const sx = box.x + box.width * at.x, sy = box.y + box.height * at.y;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 3, sy);
    await new Promise((r) => setTimeout(r, 1200));
    await page.mouse.up();
    await until(async () => { const h = await near(); return h.hiA > 30 && h.hiB > 30; }, true, 6000);
    const hill = await near();
    assert.equal(hill.wall, 0, `no wall at the seam after shaping (${JSON.stringify(hill)})`);
    assert.ok(Math.abs(hill.hiA - hill.hiB) < 24, `the hill is one hill across the seam (${JSON.stringify(hill)})`);
    await shot(page, 'terrain-tiles-hill');

    // One undo takes the whole stroke back, on both tiles.
    await page.keyboard.press('Control+z');
    await until(async () => { const h = await near(); return h.hiA < 4 && h.hiB < 4; }, true, 6000);
    await page.keyboard.press('Control+Shift+z');
    await until(async () => { const h = await near(); return h.hiA > 30 && h.hiB > 30; }, true, 6000);

    // Both saved, each in its own file.
    await page.keyboard.press('v');
    await page.keyboard.press('Control+s');
    const dir = path.join(projectsDir, 'tiles', 'assets', 'terrain');
    await until(async () => (await fs.readdir(dir).catch(() => [])).length, 2, 8000);

    // Play: the player stands on the seam's hill (spawn moved there, on top of it).
    const top = ground + Math.max(hill.hiA, hill.hiB);
    await page.evaluate(([x, y, z]) => {
      const s = window.__cwStore.getState();
      const sp = s.doc.entities.find((e) => e.components.playerSpawn);
      s.setTransform(sp.id, { ...sp.transform, position: [x, y + 40, z] });
    }, [seamX, top, midZ]);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await until(() => page.evaluate(() => !!window.__cwViewport.play), true, 20000);
    // (Stepped here: a window without focus holds the game still.)
    await page.evaluate(() => {
      for (let k = 0; k < 180; k++) window.__cwViewport.play.tick(1 / 60);
    });
    const feet = await page.evaluate(() => window.__cwViewport.play.world.player.feetPosition.y);
    assert.ok(feet > ground + 20 && Math.abs(feet - top) < 24, `feet at ${feet}, the hill's top at ${top}`);
    await shot(page, 'terrain-tiles-play');
  } catch (e) {
    await shot(page, 'terrain-tiles-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
