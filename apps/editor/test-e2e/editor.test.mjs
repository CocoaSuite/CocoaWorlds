// End-to-end: launches the built Electron editor and drives it like a user.
// Run `npm run build` first. On Linux without a display, run under xvfb-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shots = process.env.CW_SHOTS_DIR;

async function launch(userData, projectsDir) {
  const app = await electron.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '.'],
    cwd: appDir,
    env: { ...process.env, CW_USER_DATA: userData, CW_PROJECTS_DIR: projectsDir },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  page.on('pageerror', (e) => console.error('[page error]', e.stack));
  page.on('console', async (m) => { if (m.type() !== 'error') return; const a = await Promise.all(m.args().map((x) => x.jsonValue().catch(() => '?'))); console.error('[console]', a.map(String).join(' | ').slice(0, 600)); });
  page.setDefaultTimeout(15000);
  return { app, page };
}

/** Close the app; if a native "save changes?" dialog or anything else blocks, kill it. */
async function quit(app) {
  const killer = setTimeout(() => app.process().kill('SIGKILL'), 5000);
  await app.close().catch(() => {});
  clearTimeout(killer);
}

/** Poll until a field shows the expected value (UI updates land a frame after the keypress). */
async function valueIs(locator, expected, ms = 3000) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await locator.inputValue();
    if (v === expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(v, expected);
}

async function countIs(locator, expected, ms = 3000) {
  const end = Date.now() + ms;
  let n;
  while (Date.now() < end) {
    n = await locator.count();
    if (n === expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(n, expected);
}

const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
};

test('create, edit, undo, save and reopen a project', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-e2e-'));
  const userData = path.join(tmp, 'userdata');
  const projectsDir = path.join(tmp, 'projects');
  let { app, page } = await launch(userData, projectsDir);
  try {
    // Start screen
    await page.getByRole('heading', { name: 'Projects' }).waitFor();
    await shot(page, '01-start');

    // New project
    await page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('Name').fill('E2E Demo');
    await shot(page, '02-new-project');
    await dialog.getByRole('button', { name: 'Create' }).click();

    // Editor opens with the default scene
    const tree = page.getByRole('tree');
    await tree.getByRole('treeitem').first().waitFor();
    assert.equal(await tree.getByRole('treeitem').count(), 2);
    await page.getByTestId('viewport-stats').waitFor({ timeout: 15000 });
    assert.match(await page.getByTestId('save-status').innerText(), /Saved/);

    // Add a point light from the Add menu
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Point light' }).click();
    await countIs(tree.getByRole('treeitem'), 3);
    assert.match(await page.getByTestId('save-status').innerText(), /Edited/);

    // Move it with the inspector
    const posX = page.getByLabel('Position X');
    await posX.fill('128');
    await posX.press('Enter');
    await page.getByTestId('selection-readout').getByText('128').waitFor();
    await page.getByRole('button', { name: 'Move', exact: true }).click(); // move tool shows the gizmo
    await shot(page, '03-editor-light-selected');

    // Undo the move, redo it (focus the tree so shortcuts aren't typed into a field)
    await tree.getByRole('treeitem', { name: /point_light/ }).click();
    await page.keyboard.press('Control+z');
    await valueIs(page.getByLabel('Position X'), '0');
    await page.keyboard.press('Control+Shift+z');
    await valueIs(page.getByLabel('Position X'), '128');

    // Delete and undo
    await page.keyboard.press('Delete');
    await countIs(tree.getByRole('treeitem'), 2);
    await page.keyboard.press('Control+z');
    await countIs(tree.getByRole('treeitem'), 3);

    // Rename through F2
    await tree.getByRole('treeitem', { name: /point_light/ }).click();
    await page.keyboard.press('F2');
    const rename = tree.getByLabel('Rename');
    await rename.fill('lamp_corridor');
    await rename.press('Enter');
    await tree.getByRole('treeitem', { name: /lamp_corridor/ }).waitFor();

    // Views
    for (const v of ['Top', 'Front', 'Side', 'Perspective']) {
      await page.getByRole('radio', { name: v }).click();
      await shot(page, `04-view-${v.toLowerCase()}`);
    }

    // Drag the gizmo's X arrow in the top view: the light moves along X in whole grid steps, as one undo step.
    await page.getByRole('radio', { name: 'Top' }).click();
    await tree.getByRole('treeitem', { name: /lamp_corridor/ }).click();
    await page.keyboard.press('f');
    await page.keyboard.press('w');
    const box = await page.getByTestId('viewport').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx + 45, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 90, cy, { steps: 6 });
    await page.mouse.move(cx + 160, cy, { steps: 6 });
    await page.mouse.up();
    const draggedX = Number(await page.getByLabel('Position X').inputValue());
    assert.ok(draggedX > 128, `gizmo drag should move the light right (x=${draggedX})`);
    assert.equal(draggedX % 16, 0, 'gizmo drag snaps to the 16-unit grid');
    assert.equal(Number(await page.getByLabel('Position Z').inputValue()), 0, 'X-axis drag leaves Z alone');
    await shot(page, '04b-gizmo-drag');
    await page.keyboard.press('Control+z');
    await valueIs(page.getByLabel('Position X'), '128');
    await page.getByRole('radio', { name: 'Perspective' }).click();

    // Save to disk
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const projDir = path.join(projectsDir, 'e2e-demo');
    const sceneText = await fs.readFile(path.join(projDir, 'scenes', 'level_01.cwscene'), 'utf8');
    const scene = JSON.parse(sceneText);
    const lamp = scene.entities.find((e) => e.name === 'lamp_corridor');
    assert.ok(lamp, 'renamed light was saved');
    assert.deepEqual(lamp.transform.position, [128, 128, 0]);

    // Language switch
    await page.getByRole('menubar').getByRole('button', { name: 'View' }).click();
    await page.getByRole('menuitemcheckbox', { name: /Русский/ }).click();
    await page.getByRole('menubar').getByText('Правка', { exact: true }).waitFor();
    await shot(page, '05-russian');
    await page.getByRole('menubar').getByText('Вид', { exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: /English/ }).click();
  } catch (e) {
    await shot(page, 'failure');
    throw e;
  } finally {
    await quit(app);
  }

  // Relaunch: the project is in Recent and reopens with the saved light.
  ({ app, page } = await launch(userData, projectsDir));
  try {
    await page.getByRole('heading', { name: 'Projects' }).waitFor();
    await page.getByRole('button', { name: /E2E Demo/ }).click();
    await page.getByRole('tree').getByRole('treeitem', { name: /lamp_corridor/ }).waitFor();
    await shot(page, '06-reopened');
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
