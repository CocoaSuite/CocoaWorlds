// End-to-end: the twilit forest. The glade, each region, its lair and boss, the hotbar and the map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('twilit forest', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const world = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await newProject(page, 'Forest');
    await page.keyboard.press('Escape');
    await insp().getByRole('switch', { name: 'Mining' }).click({ force: true });
    await until(() => insp().getByRole('switch', { name: 'Mining' }).isChecked(), true);
    await world(() => window.__cwStore.getState().setSceneSettings({ mining: { world: 'forest', seed: 77 } }, 'Forest'));
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await page.getByTestId('forest-bar').waitFor();
    await until(() => world(() => !!window.__cwViewport.ao), true);
    await world(() => Object.defineProperty(window.__cwViewport.ao, 'software', { value: false }));
    await wait(6000);
    await shot(page, 'f01-glade');
    const lairs = await world(() => window.__cwViewport.play.world.mine.forestBlocks.lairList());
    console.log(lairs);
    const go = async (x, z, yaw, pitch, up = 1) => {
      await world(
        ({ x, z, yaw, pitch, up }) => {
          const w = window.__cwViewport.play.world, m = w.mine, b = m.forestBlocks;
          const y = Math.max(b.height(Math.floor(x), Math.floor(z)) + up, 0);
          const p = m.toWorld(x, y, z);
          w.player.teleport({ x: p[0], y: p[1], z: p[2] }, yaw);
          w.setPlayerInput({ yaw, pitch });
          m.bosses = [];
          m.mobs = [];
        },
        { x, z, yaw, pitch, up },
      );
      await wait(6000);
    };
    // Each region from its ground.
    const rings = [[100, 'hollowroot'], [240, 'mirefen'], [360, 'sporelands'], [480, 'frostpine'], [600, 'ember'], [720, 'mooncrown']];
    for (const [r, id] of rings) {
      await go(r, 0.5, Math.PI / 2, -0.05, 2);
      await world(() => {
        const m = window.__cwViewport.play.world.mine;
        for (const b of m.config.bosses) m.trophies.add(b.id);
      });
      await shot(page, `f02-${id}`);
    }
    // Lairs from outside, then their bosses winding up.
    let n = 0;
    for (const l of lairs) {
      n++;
      await go(l.x - 40, l.z, -Math.PI / 2, 0.08, 6);
      await shot(page, `f03-${n}-${l.label}`);
      const st = await world((l) => {
        const m = window.__cwViewport.play.world.mine, s = m.forestBlocks.structureAt(Math.floor(l.x), m.forestBlocks.height(Math.floor(l.x), Math.floor(l.z)), Math.floor(l.z));
        return s ? s.boss : null;
      }, l);
      if (!st) continue;
      await world(({ st }) => {
        const w = window.__cwViewport.play.world, m = w.mine, p = m.toWorld(st[0] - 9, st[1], st[2] + 0.5);
        w.player.teleport({ x: p[0], y: p[1], z: p[2] }, -Math.PI / 2);
        w.setPlayerInput({ yaw: -Math.PI / 2, pitch: 0.15 });
      }, { st });
      await wait(1200);
      await world(() => window.__cwViewport.play.world.mine.bosses.forEach((b) => (b.step = () => {})));
      await wait(4000);
      await world(() => {
        const m = window.__cwViewport.play.world.mine, t = window.__cwViewport.play.world.time;
        for (const b of m.bosses) {
          b.step = () => {};
          b.state = 'windup';
          b.attack = b.def.attacks.includes('slam') ? 'slam' : b.def.attacks[0];
          b.since = t - 7;
          b.until = t + 3;
          b.yaw = Math.PI / 2;
        }
      });
      await wait(800);
      await shot(page, `f04-${n}-boss`);
    }
    // Monsters of a region, the hotbar with blocks, the menu with the map.
    await go(110, 10, Math.PI / 2, 0, 2);
    await world(() => {
      const w = window.__cwViewport.play.world, m = w.mine, f = w.player.feetPosition, [x, y, z] = m.toBlock([f.x, f.y, f.z]);
      for (const id of ['dusk_grass', 'stone', 'giant_bark', 'dusk_leaves', 'glow_cap', 'moon_bricks', 'lantern']) {
        m.inv.set(m.forestBlocks.m(id), 12);
        m.hot.push(m.forestBlocks.m(id));
      }
      m.select(3);
      void x, y, z;
    });
    await wait(800);
    await shot(page, 'f05-hotbar');
    await world(() => window.__cwViewport.play.world.mineAction('menu'));
    await page.getByTestId('mine-menu').waitFor();
    await wait(500);
    await shot(page, 'f06-menu');
    await world(() => window.__cwViewport.play.world.mineAction('menu', 'close'));
    assert.ok(true);
  } finally {
    await quit(app);
  }
});
