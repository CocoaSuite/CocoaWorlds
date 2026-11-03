// End-to-end: the blocks for putting held things at spots: “while holding” stack, Put … at the spot, holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newProject, quit, shot, tempDirs } from './helpers.mjs';

test('place-at-spot blocks', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Place');
    await page.evaluate(() => {
      const st = window.__cwStore.getState();
      st.createBrushes([-32, 0, -32], [32, 32, 32]);
      const id = window.__cwStore.getState().selection[0];
      st.addComponent(id, 'script');
    });
    const panel = page.getByRole('region', { name: /Visual script/ }).or(page.locator('.cw-script')).first();
    await page.getByRole('button', { name: '+ When…' }).click();
    await page.getByRole('menuitem', { name: 'When the player uses this while holding something' }).click();
    const stack = page.getByRole('group', { name: 'When the player uses this while holding something' });
    await stack.getByRole('button', { name: '+ Add a block' }).click();
    await page.getByRole('menuitem', { name: 'Objects › Put an object at a spot' }).click();
    await stack.getByRole('button', { name: '+ Add a block' }).last().click();
    await page.getByRole('menuitem', { name: 'Control › If … otherwise' }).click();
    await page.getByRole('button', { name: '+ When…' }).click();
    await page.getByRole('menuitem', { name: 'When the player uses this (E)' }).click();
    const script = await page.evaluate(() => {
      const st = window.__cwStore.getState();
      return st.doc.get(st.selection[0]).components.script;
    });
    assert.equal(script.handlers[0].event.kind, 'useHolding');
    assert.deepEqual(script.handlers[0].body[0].target, { held: true });
    await page.getByLabel('When the player uses this (E or click) while holding within').fill('200');
    await new Promise((r) => setTimeout(r, 300));
    await shot(page, 'place-script');
    void panel;
  } catch (e) {
    await shot(page, 'place-script-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
