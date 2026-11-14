// End-to-end: the Mining game rule. Play starts in the base room of a block mine; the pickaxe digs, ores fill the
// backpack, Tab opens the upgrade menu, monsters walk the caves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('mining', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const world = (fn, arg) => page.evaluate(fn, arg);
  try {
    await newProject(page, 'Mine');
    await page.keyboard.press('Escape');
    await insp().getByRole('switch', { name: 'Mining' }).click({ force: true });
    await until(() => insp().getByRole('switch', { name: 'Mining' }).isChecked(), true);

    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await page.getByTestId('mine-hud').waitFor();
    // (Screen occlusion is off on the software renderer tests use; on, it once blanked the whole view.)
    await until(() => world(() => !!window.__cwViewport.ao), true);
    await world(() => Object.defineProperty(window.__cwViewport.ao, 'software', { value: false }));
    // The chunks around load and are drawn.
    await until(() => world(() => window.__cwViewport.play.world.mine.blocks.chunks.size >= 27), true, 20000);
    await until(() => world(() => (window.__cwViewport.play.group.getObjectByName('mine')?.children.filter((c) => c.isMesh && c.geometry.index?.count > 0).length ?? 0) >= 4), true, 20000);
    await world(() => window.__cwViewport.play.world.setPlayerInput({ yaw: 0.6, pitch: -0.15 }));
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, 'm01-base');

    // Dig out of the base: a tunnel ahead.
    await world(() => {
      const w = window.__cwViewport.play.world;
      w.player.teleport({ x: 7 * w.mine.B, y: 0, z: 0 }, Math.PI / 2 * 3);
      w.setPlayerInput({ yaw: -Math.PI / 2, pitch: -0.1, fire: true, forward: 1 });
    });
    await until(() => world(() => window.__cwViewport.play.world.mine.blocks.get(8, 1, 0) === 0), true, 20000);
    await new Promise((r) => setTimeout(r, 2500));
    await world(() => window.__cwViewport.play.world.setPlayerInput({ fire: false, forward: 0 }));
    await shot(page, 'm02-dig');

    // Out in a cave, with ores and a monster.
    await world(() => {
      const w = window.__cwViewport.play.world, m = w.mine;
      m.money = 5e6;
      for (const id of ['feet', 'lantern', 'sense']) for (let i = 0; i < 3; i++) m.buySkill(id);
      for (let x = 18; x < 30; x++) for (let y = 0; y < 3; y++) for (let z = -2; z < 3; z++) m.blocks.set(x, y, z, 0);
      w.player.teleport({ x: 19 * m.B, y: 0, z: 0 });
      w.setPlayerInput({ yaw: -Math.PI / 2, pitch: -0.05 });
    });
    // (A monster in front: a plain figure, as the scene has no Zombie object.)
    await world(() => {
      const m = window.__cwViewport.play.world.mine;
      for (let i = 0; i < 50 && !m.mobs.length; i++) m.spawn(19.5, 0, 0.5);
      const p = window.__cwViewport.play.world.player, d = p.lookDirection(), [x, , z] = m.toBlock(p.eye());
      m.mobs[0].pos = [x + d[0] * 4, 0, z + d[2] * 4];
      m.mobs[0].def = { ...m.mobs[0].def, speed: 0 };
    });
    await new Promise((r) => setTimeout(r, 2500));
    await shot(page, 'm03-cave');
    assert.ok(await world(() => window.__cwViewport.play.mineView.mobs.size > 0));

    // Tab: the menu frees the mouse; buying works from it.
    await world(() => window.__cwViewport.play.mineAction('menu', 'open'));
    await page.getByTestId('mine-menu').waitFor();
    await page.getByTestId('buy-pickaxe').click();
    await until(() => world(() => window.__cwViewport.play.world.mine.tier), 1);
    await page.getByTestId('skill-swing').click();
    await until(() => world(() => window.__cwViewport.play.world.mine.skills.get('swing') ?? 0), 1);
    await shot(page, 'm04-menu');
    await page.getByTestId('mine-close').click();
    await until(() => page.getByTestId('mine-menu').count(), 0);
    await page.keyboard.press('F5');
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
