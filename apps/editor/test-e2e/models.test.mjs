// End-to-end (benchmark step B3): import a GLB model, show it on an object (in metres), play its animation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { boxGlb, launch, newProject, pickBlock, quit, shot, tempDirs, until } from './helpers.mjs';

test('models: import, Model component, animation block', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  try {
    const file = path.join(tmp, 'Crate.glb');
    await fs.writeFile(file, boxGlb());
    await newProject(page, 'Modelled');
    await page.getByRole('tab', { name: 'Assets' }).click();
    await page.getByTestId('import-models').setInputFiles(file);
    await page.getByRole('list', { name: 'Models' }).getByRole('listitem', { name: 'crate' }).waitFor();

    // An object showing the model, 1 m tall → about 39 u.
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Empty object' }).click();
    const id = await page.evaluate(() => window.__cwViewport.selection[0]);
    for (const [axis, v] of [['Z', '-160']]) {
      const f = insp().getByLabel(`Position ${axis}`, { exact: true });
      await f.fill(v);
      await f.press('Enter');
    }
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Model/ }).click();
    await insp().getByRole('group', { name: 'Model' }).getByRole('combobox', { name: 'Model' }).selectOption({ label: 'crate' });
    const height = () =>
      page.evaluate((id) => {
        let h = 0;
        window.__cwViewport.scene.traverse((o) => {
          if (o.name === 'model' && o.parent?.userData.entityId === id) {
            o.updateWorldMatrix(true, true);
            const b = new o.matrixWorld.constructor();
            const box = { min: Infinity, max: -Infinity };
            o.traverse((m) => {
              if (!m.isMesh) return;
              m.geometry.computeBoundingBox();
              const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
              box.min = Math.min(box.min, bb.min.y);
              box.max = Math.max(box.max, bb.max.y);
            });
            void b;
            h = box.max - box.min;
          }
        });
        return Math.round(h);
      }, id);
    await until(height, 39, 8000);
    await page.keyboard.press('1');
    await shot(page, 'm01-model');

    // A block plays its animation.
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Script/ }).click();
    const panel = page.getByRole('region', { name: 'Script of object' });
    await panel.getByRole('button', { name: '+ When…' }).click();
    await pickBlock(page, 'When the game starts');
    const stack = panel.getByRole('group', { name: 'When the game starts' });
    await stack.getByRole('button', { name: '+ Add a block' }).click();
    await pickBlock(page, 'Models › Play an animation');
    const name = stack.getByLabel('Play animation', { exact: true });
    await name.fill('Spin');
    await name.press('Enter');
    assert.equal(await page.getByRole('tab', { name: /Problems \d/ }).count(), 0, 'no problems');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    const spinning = () => page.evaluate((id) => window.__cwViewport.play?.models.get(id)?.mixer?._actions.some((a) => a.isRunning()) ?? false, id);
    await until(spinning, true, 8000);
    await shot(page, 'm02-play');
    await page.keyboard.press('Escape');
    if (await page.getByTestId('play-banner').count()) await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'm-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
