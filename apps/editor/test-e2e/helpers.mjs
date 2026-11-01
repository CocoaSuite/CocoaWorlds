// Shared helpers for end-to-end tests.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

export const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shots = process.env.CW_SHOTS_DIR;

export async function tempDirs() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-e2e-'));
  return { tmp, userData: path.join(tmp, 'userdata'), projectsDir: path.join(tmp, 'projects') };
}

export async function launch(userData, projectsDir) {
  const app = await electron.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '.'],
    cwd: appDir,
    env: { ...process.env, CW_USER_DATA: userData, CW_PROJECTS_DIR: projectsDir },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.error('[page error]', e.stack));
  if (process.env.CW_DEBUG) page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text().slice(0, 6000)));
  page.setDefaultTimeout(15000);
  return { app, page };
}

/** Close the app; if a native dialog or anything else blocks, kill it. */
export async function quit(app) {
  const killer = setTimeout(() => app.process().kill('SIGKILL'), 5000);
  await app.close().catch(() => {});
  clearTimeout(killer);
}

export const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
};

export async function until(fn, expected, ms = 4000) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await fn();
    if (v === expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(v, expected);
}

export async function newProject(page, name) {
  await page.getByRole('heading', { name: 'Projects' }).waitFor();
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('tree').getByRole('treeitem').first().waitFor();
}

/** Type a value into a labelled number field and commit it. */
export async function setField(page, label, value) {
  const f = page.getByLabel(label, { exact: true });
  await f.fill(String(value));
  await f.press('Enter');
}

/** Drag out a brush footprint in the middle of the viewport (brush tool must be active). */
export async function drawBrush(page) {
  const box = await page.getByTestId('viewport').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 40, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).waitFor();
}

export async function setDraft(page, size, corner) {
  const panel = page.getByRole('group', { name: 'Brush tool' });
  for (const [i, a] of ['X', 'Y', 'Z'].entries()) {
    await setField(panel, `Size ${a}`, size[i]);
    await setField(panel, `Corner ${a}`, corner[i]);
  }
}
