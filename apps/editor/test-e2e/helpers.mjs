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

/** A GLB model for tests: a 1 m box (in metres, like Blender) with a one-second “Spin” animation about Y. */
export function boxGlb() {
  const pos = new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, -0.5, -0.5, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0.5, -0.5, 1, 0.5]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const times = new Float32Array([0, 0.5, 1]);
  const s = Math.SQRT1_2;
  const rot = new Float32Array([0, 0, 0, 1, 0, 1, 0, 0, 0, s, 0, -s]);
  const parts = [pos, idx, times, rot].map((a) => Buffer.from(a.buffer));
  const views = [];
  let offset = 0;
  const pad4 = (n) => (n + 3) & ~3;
  for (const p of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: p.length });
    offset = pad4(offset + p.length);
  }
  const bin = Buffer.alloc(offset);
  parts.forEach((p, i) => p.copy(bin, views[i].byteOffset));
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Box', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.55, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
    ],
    animations: [{ name: 'Spin', samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const chunk = (data, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.write(type, 4, 'latin1');
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(jsonBuf, 'JSON'), chunk(bin, 'BIN\0')]);
}
