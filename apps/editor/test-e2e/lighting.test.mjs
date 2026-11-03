// End-to-end (benchmark step B3): the scene's own lighting. Lights light the level in Play and with
// Lighting: Game; the sky and fog are edited in the Inspector, with undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('scene lighting, sky and fog', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const lightTypes = () =>
    page.evaluate(() => {
      const g = window.__cwViewport.lighting.group;
      return { visible: g.visible, types: g.children.filter((o) => o.isLight).map((o) => o.type).sort() };
    });
  try {
    await newProject(page, 'Lit');
    await page.keyboard.press('2');
    await addBrush(page, [1024, 16, 1024], [-512, -16, -512]);
    await addBrush(page, [256, 192, 16], [-128, 0, -256]);
    await addBrush(page, [64, 64, 64], [64, 0, -128]);
    // A bulb in front of the wall.
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Point light' }).click();
    for (const [axis, v] of [
      ['Y', '96'],
      ['Z', '-160'],
    ]) {
      const f = insp().getByLabel(`Position ${axis}`, { exact: true });
      await f.fill(v);
      await f.press('Enter');
    }
    await page.keyboard.press('1');

    // Preview lighting by default; Lighting: Game shows the scene's lights.
    assert.equal((await lightTypes()).visible, false);
    await page.getByRole('button', { name: /^Lighting (Game|Preview)/ }).click();
    await until(async () => (await lightTypes()).visible, true);
    assert.deepEqual((await lightTypes()).types, ['DirectionalLight', 'HemisphereLight', 'PointLight']);
    await shot(page, 'l01-game-lighting');

    // Sky and fog from the Inspector (nothing selected), with undo.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const fog = insp().getByRole('switch', { name: 'Fog' });
    await fog.click({ force: true });
    await until(() => page.evaluate(() => !!window.__cwViewport.scene.fog), true);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    await until(() => page.evaluate(() => !!window.__cwViewport.scene.fog), false);
    await page.keyboard.press('Control+y');
    await until(() => page.evaluate(() => !!window.__cwViewport.scene.fog), true);
    assert.ok(await page.evaluate(() => !!window.__cwViewport.lighting.group.getObjectByName('sky')), 'the sky is on');

    // Back to preview lighting, then Play: the scene's lighting always.
    await page.getByRole('button', { name: /^Lighting (Game|Preview)/ }).click();
    await until(async () => (await lightTypes()).visible, false);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByTestId('play-banner').waitFor();
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await until(async () => (await lightTypes()).visible, true);
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, 'l02-play');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
    await until(async () => (await lightTypes()).visible, false);
  } catch (e) {
    await shot(page, 'l-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
