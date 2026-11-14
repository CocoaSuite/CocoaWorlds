// End-to-end: the mine's structures and their bosses. Each kind is found under the shaft, walked into, its boss
// woken; the pickaxe guards and parries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('mining structures and bosses', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const world = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await newProject(page, 'Mine');
    await page.keyboard.press('Escape');
    await insp().getByRole('switch', { name: 'Mining' }).click({ force: true });
    await until(() => insp().getByRole('switch', { name: 'Mining' }).isChecked(), true);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await page.getByTestId('mine-hud').waitFor();
    await until(() => world(() => !!window.__cwViewport.ao), true);
    await world(() => Object.defineProperty(window.__cwViewport.ao, 'software', { value: false }));
    // (Every kind, wherever it first stands under the shaft.)
    const found = await world(() => {
      const m = window.__cwViewport.play.world.mine, out = {};
      for (let y = -12; y > -3000; y -= 8) {
        const s = m.blocks.structureAt(0, y, 0);
        if (s && !out[s.def.id]) out[s.def.id] = { boss: s.boss, at: s.at, size: s.size, key: s.key };
      }
      m.money = 1e9;
      m.tier = 11;
      for (const id of ['lantern', 'feet']) for (let i = 0; i < 5; i++) m.buySkill(id);
      return out;
    });
    console.log(Object.keys(found));
    assert.ok(Object.keys(found).length >= 3);
    const go = async (s, back, yaw, pitch) => {
      await world(
        ({ s, back, yaw, pitch }) => {
          const w = window.__cwViewport.play.world, m = w.mine, [x, y, z] = s.boss;
          m.bosses = [];
          w.player.teleport({ x: (x + 0.5 - back) * m.B + m.origin[0] - m.B / 2, y: y * m.B + m.origin[1], z: z * m.B + m.origin[2] }, -Math.PI / 2 + yaw);
          w.setPlayerInput({ yaw: -Math.PI / 2 + yaw, pitch });
        },
        { s, back, yaw, pitch },
      );
      await wait(5000);
    };
    let n = 0;
    for (const [kind, s] of Object.entries(found)) {
      n++;
      // A look round inside, then the boss up close.
      await go(s, 9, 0, 0.15);
      await world(() => {
        const m = window.__cwViewport.play.world.mine;
        for (const b of m.bosses) b.step = () => {};
      });
      await shot(page, `b${n}a-${kind}`);
      assert.ok(await world(() => window.__cwViewport.play.world.mine.hud().place.length > 0));
      await world(() => {
        const m = window.__cwViewport.play.world.mine, t = window.__cwViewport.play.world.time;
        for (const b of m.bosses) {
          b.state = 'windup';
          b.attack = b.def.attacks.includes('slam') ? 'slam' : 'swing';
          b.since = t - 7;
          b.until = t + 3;
          b.yaw = Math.PI / 2;
        }
      });
      await wait(800);
      await shot(page, `b${n}b-${kind}-windup`);
    }
    // Guarding: the pickaxe comes up.
    await world(() => window.__cwViewport.play.world.setPlayerInput({ block: true }));
    await until(() => world(() => window.__cwViewport.play.world.mine.blocking), true);
    await wait(600);
    await shot(page, 'b9-guard');
    await world(() => window.__cwViewport.play.world.setPlayerInput({ block: false }));
    // A real fight: the boss wakes and its bar shows.
    const first = Object.values(found)[0];
    await go(first, 6, 0, 0);
    await page.getByTestId('mine-boss').waitFor({ timeout: 30000 });
    await shot(page, 'b10-fight');
  } finally {
    await quit(app);
  }
});
