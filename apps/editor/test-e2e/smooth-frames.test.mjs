// End-to-end: the smooth-frames sweep in a real Play (docs/rendering.md, “Smooth frames”). Reflections are on before
// the first frame; a rocket's blast lights up with a light made with the game and goes dark again (no light is
// added or taken away); a pistol's tracer comes from the pool; a sign changes its text in place (same material);
// a falling crate is drawn where the frame's snapshot says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('smooth frames: pooled blasts and tracers, signs redrawn in place, reflections from the start', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const play = (fn, arg) => page.evaluate(fn, arg);
  const insp = page.getByRole('complementary', { name: 'Inspector' });
  try {
    await newProject(page, 'Smooth');
    await page.keyboard.press('2');
    await addBrush(page, [1024, 16, 1024], [-512, -16, -512]);
    // A wall ahead of the Player start (which looks along −Z), and a crate high up to the left that falls.
    await addBrush(page, [512, 256, 16], [-256, 0, -432]);
    await addBrush(page, [48, 48, 48], [-200, 400, -300]);
    await page.getByRole('tree').getByRole('treeitem', { name: 'block_3' }).click();
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Physics/ }).click();
    await insp.getByRole('group', { name: 'Physics' }).getByLabel('Moves', { exact: true }).waitFor();
    // A sign on the wall.
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Text sign' }).click();
    await page.getByRole('tree').getByRole('treeitem', { name: 'sign', exact: true }).waitFor();
    await setField(insp, 'Position X', 128);
    await setField(insp, 'Position Y', 160);
    await setField(insp, 'Position Z', -414);

    // Items: a rocket launcher and a pistol, each with its ammo.
    const ws = page.getByRole('tablist', { name: 'Workspace' });
    await ws.getByRole('tab', { name: 'Screens' }).click();
    const items = page.getByRole('list', { name: 'Items' });
    for (const name of ['Launcher', 'Rockets', 'Pistol', '9mm']) {
      await page.getByRole('button', { name: '+ Item' }).click();
      const field = items.getByRole('listitem').last().getByLabel('Item name');
      await field.fill(name);
      await field.press('Enter');
      await items.getByRole('listitem', { name }).waitFor();
    }
    for (const [name, ready, ammo] of [['Launcher', 'Rocket launcher', 'Rockets'], ['Pistol', 'Pistol', '9mm']]) {
      await items.getByRole('button', { name: `${name}: Weapon` }).click();
      await page.getByLabel(`${name}: Ready-made weapon`).selectOption({ label: ready });
      await until(() => page.getByLabel(`${name}: Uses up`).inputValue(), ammo);
    }
    await ws.getByRole('tab', { name: 'Scene' }).click();

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await until(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''), 'CANVAS');

    // Reflections were switched on with the shaders' warm-up, before the first frame (so shiny materials never
    // compile again mid-game). (The warm-up compiles every shader: slow on a software GPU.)
    await until(() => play(() => window.__cwViewport.warmed === window.__cwViewport.play), true, 30000);
    assert.equal(await play(() => window.__cwViewport.reflections.on), true);

    // The falling crate is drawn where this frame's snapshot puts it (between its last two physics steps).
    const crate = () => play(() => {
      const p = window.__cwViewport.play;
      const id = p.world.doc.entities.find((e) => e.name === 'block_3').id;
      const f = p.frame;
      const i = f.body(id);
      const drawn = p.world.drawnMotionOf(id);
      return { y: f.bodyPose[i * 16 + 13], drawn: drawn[13], present: f.present(i) };
    });
    const first = await crate();
    assert.equal(first.present, true);
    assert.ok(Math.abs(first.y - first.drawn) < 1e-9, `snapshot ${first.y} = drawn ${first.drawn}`);
    await until(async () => (await crate()).y < first.y - 50, true, 15000);

    // Blasts have their lights from the start: dark, and always there.
    const lights = () => play(() => {
      let n = 0;
      window.__cwViewport.scene.traverse((o) => o.isLight && n++);
      return n;
    });
    const blastLights = () => play(() => window.__cwViewport.play.effects.blasts.filter((b) => b.light).map((b) => b.light.intensity));
    assert.deepEqual(await blastLights(), [0, 0]);
    const lightsBefore = await lights();

    await play(() => {
      const w = window.__cwViewport.play.world;
      w.giveItem('Launcher', 1);
      w.giveItem('Rockets', 5);
      w.giveItem('Pistol', 1);
      w.giveItem('9mm', 12);
      w.selectSlot(0);
    });
    const box = await page.getByTestId('viewport').boundingBox();
    const fire = () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // The rocket hits the wall: one of the made-up-front lights flares, the fireball shows, then both fade away.
    await fire();
    await until(async () => (await blastLights()).some((x) => x > 0), true, 8000);
    await shot(page, 'sf01-blast');
    assert.equal(await lights(), lightsBefore, 'no light added for the blast');
    await until(async () => (await blastLights()).every((x) => x === 0), true, 8000);
    await until(() => play(() => window.__cwViewport.play.effects.blasts.every((b) => !b.ball.visible)), true);
    assert.equal(await lights(), lightsBefore);

    // A pistol shot: a tracer from the pool shows for a moment, then hides; the pool keeps its size.
    await play(() => window.__cwViewport.play.world.selectSlot(2));
    const tracers = () => play(() => window.__cwViewport.play.effects.tracers.map((t) => t.line.visible));
    const pool = (await tracers()).length;
    const next = () => play(() => window.__cwViewport.play.effects.tracerNext);
    const before = await next();
    await page.getByTestId('hud-ammo').getByText('12').waitFor();
    // (Clicked again until it fires: the rocket's reload is over a second and a half of game time, many seconds on
    // this slow test display.)
    const ammo = () => page.getByTestId('hud-ammo').textContent();
    for (let i = 0; i < 40 && (await ammo()) === '12'; i++) {
      await fire();
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(await ammo(), '11');
    // (The next tracer of the pool was used; it shows for a few hundredths of a second, which can fall between
    // two looks at this slow test display.)
    assert.equal(await next(), (before + 1) % pool);
    await shot(page, 'sf02-tracer');
    await until(async () => (await tracers()).every((v) => !v), true, 6000);
    assert.equal((await tracers()).length, pool);

    // The sign's text changes (as “Set the text of a sign” does): drawn again with the same material.
    const signMaterial = () => play(() => {
      const s = [...window.__cwViewport.play.signs.values()][0];
      s.sign.object.material.userData.testMark ??= Math.random();
      return s.sign.object.material.userData.testMark;
    });
    const mark = await signMaterial();
    await play(() => {
      const w = window.__cwViewport.play.world;
      w.signs.set([...w.signs.keys()][0], 'Changed in place');
      w.signVersion++;
    });
    await until(() => play(() => window.__cwViewport.play.signText([...window.__cwViewport.play.signs.keys()][0])), 'Changed in place');
    await until(() => play(() => [...window.__cwViewport.play.signs.values()][0].data.text), 'Changed in place');
    assert.equal(await signMaterial(), mark, 'the same material');
    await shot(page, 'sf03-sign');


    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'sf-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
