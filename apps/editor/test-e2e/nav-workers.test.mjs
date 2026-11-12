// End-to-end: where creatures can walk is measured in background workers when Play starts (not on the UI thread),
// and the grid is the one the game world measures itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

test('navigation workers: Play measures the level off the UI thread', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  page.on('console', (m) => m.type() === 'error' && console.log('[c]', m.text().slice(0, 400)));
  const insp = page.getByRole('complementary', { name: 'Inspector' });
  try {
    await newProject(page, 'NavWork');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [2048, 16, 2048], [-1024, -16, -1024]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Empty object' }).click();
    await setField(insp, 'Position Z', -500);
    await insp.getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Creature/ }).click();

    assert.equal(await page.evaluate(() => window.__cwNavWork?.measured ?? 0), 0);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(() => page.evaluate(() => !!window.__cwViewport.play), true, 20000);

    // The workers measured it; nothing fell back to the UI thread.
    const work = await page.evaluate(() => ({ ...window.__cwNavWork }));
    assert.equal(work.measured, 1, JSON.stringify(work));
    assert.equal(work.failed, 0, JSON.stringify(work));
    assert.ok(work.workers >= 1);

    // The grid in play is the one a world measuring the level itself gets (the editor's own preview does that).
    const inPlay = await page.evaluate(() => {
      const n = window.__cwViewport.play.navigation();
      return { count: n.count, xyz: Array.from(n.xyz.slice(0, 3000)), links: n.links().length };
    });
    assert.ok(inPlay.count > 5000, `spots: ${inPlay.count}`);
    await page.keyboard.press('F5');
    await until(() => page.evaluate(() => !window.__cwViewport.play), true, 10000);
    await page.getByRole('menubar').getByRole('button', { name: 'View' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show where creatures can walk' }).click();
    await until(() => page.evaluate(() => (window.__cwViewport.navDraw?.userData.spots ?? 0) > 0), true, 15000);
    assert.equal(await page.evaluate(() => window.__cwViewport.navDraw.userData.spots), inPlay.count);

    // A second Play uses the same workers.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(() => page.evaluate(() => !!window.__cwViewport.play), true, 20000);
    const again = await page.evaluate(() => ({ ...window.__cwNavWork, count: window.__cwViewport.play.navigation().count }));
    assert.equal(again.measured, 2, JSON.stringify(again));
    assert.equal(again.failed, 0);
    assert.equal(again.count, inPlay.count);
  } catch (e) {
    await shot(page, 'nav-workers-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
