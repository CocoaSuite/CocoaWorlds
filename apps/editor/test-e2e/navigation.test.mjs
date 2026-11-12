// End-to-end (A2): View › Show where creatures can walk draws the walkable spots, and they follow edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';
test('navigation: the walkable area is drawn and follows the level', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  try {
    await newProject(page, 'Nav');
    const block = async (size, corner) => {
      await page.keyboard.press('2'); await page.keyboard.press('b'); await drawBrush(page);
      await setDraft(page, size, corner);
      await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
      await page.keyboard.press('v');
    };
    await block([512, 16, 512], [-256, -16, -256]);
    await page.getByRole('menubar').getByRole('button', { name: 'View' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show where creatures can walk' }).click();
    const spots = () => page.evaluate(() => window.__cwViewport.navDraw?.userData.spots ?? 0);
    await until(async () => (await spots()) > 500, true, 10000);
    const before = await spots();
    await page.getByTestId('viewport').hover(); await page.keyboard.press('1');
    await shot(page, 'nav01');
    // A pillar in the middle: no standing round its foot (a creature's width), but room on its top.
    await block([128, 160, 128], [-64, 0, -64]);
    await until(async () => { const n = await spots(); return n === before - 100 + 64; }, true, 10000);
    // Switched off, nothing is drawn.
    await page.getByRole('menubar').getByRole('button', { name: 'View' }).click();
    await page.getByRole('menuitemcheckbox', { name: /Show where creatures can walk/ }).click();
    await until(() => page.evaluate(() => !window.__cwViewport.navDraw), true, 4000);
  } catch (e) {
    await shot(page, 'nav-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
