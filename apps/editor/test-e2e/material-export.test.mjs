// Material export (docs/cocoamat-format.md): a graph material and its variant as .cocoamat files, read back with
// their own values; one imported again and baked the same; and the same materials as images.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('export graph materials as .cocoamat and images, and import one back', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const out = path.join(tmp, 'out');
  process.env.CW_MATERIAL_EXPORT_DIR = out;
  process.env.CW_MATERIAL_IMPORT_FILE = path.join(out, 'Graph material variant.cocoamat');
  const { app, page } = await launch(userData, projectsDir);
  const dir = path.join(projectsDir, 'quarry');
  const materials = async () => JSON.parse(await fs.readFile(path.join(dir, 'project.cwproj'), 'utf8')).settings.materials ?? [];
  const list = page.getByRole('listbox', { name: 'Materials' }).last();
  try {
    await newProject(page, 'Quarry');
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    await page.getByRole('button', { name: '+ Graph material' }).click();
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);
    const side = page.getByRole('complementary', { name: 'Material', exact: true });

    // Expose the noise's scale; a variant sets it to 16.
    await page.locator('.react-flow__node:has(.cm-node[data-node-type="noise"])').click();
    await side.getByRole('button', { name: 'Expose Scale' }).click();
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 400 } });
    await side.getByRole('button', { name: 'Make a variant' }).click();
    await list.getByRole('option', { name: 'Graph material variant' }).waitFor();
    await side.getByRole('group', { name: 'Its own settings' }).getByLabel('Noise: Scale', { exact: true }).fill('16');
    await until(async () => Object.values((await materials()).find((m) => m.name === 'Graph material variant')?.overrides ?? {})[0], 16, 8000);
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);

    // Both picked: one .cocoamat each, into the folder.
    await list.getByRole('option', { name: 'Graph material', exact: true }).click();
    await list.getByRole('option', { name: 'Graph material variant' }).click({ modifiers: ['Control'] });
    await page.getByRole('button', { name: 'Export…' }).click();
    await page.getByRole('menuitem', { name: 'CocoaSuite material (.cocoamat)…' }).click();
    const files = path.join(out, 'Graph material.cocoamat');
    await until(async () => (await fs.readdir(out).catch(() => [])).filter((f) => f.endsWith('.cocoamat')).length, 2, 20000);
    const read = async (f) =>
      page.evaluate(async (b) => {
        const r = await window.__cwMatFiles.readCocoaMat(new Uint8Array(b));
        return r.ok ? { manifest: r.value.manifest, baked: [...r.value.baked.keys()], nodes: r.value.nodes.nodes.map((n) => n.type) } : r.error;
      }, [...(await fs.readFile(f))]);
    const a = await read(files);
    const b = await read(path.join(out, 'Graph material variant.cocoamat'));
    assert.equal(typeof a, 'object', String(a));
    assert.equal(a.manifest.parameters[0].label, 'Noise: Scale');
    assert.equal(a.manifest.parameters[0].value, 4);
    assert.equal(b.manifest.parameters[0].value, 16);
    assert.equal(b.manifest.parameters[0].default, 4);
    assert.deepEqual(a.baked.sort(), ['color', 'height', 'normal', 'roughness']);
    assert.ok(a.nodes.includes('noise') && !a.nodes.includes('bricks'));

    // Import the variant: a new graph material with the same value, baked the same.
    await page.getByRole('button', { name: 'Import…' }).click();
    // (Baking on a software GPU can hold the page up for a while.)
    await until(async () => (await materials()).length, 3, 40000);
    const made = (await materials())[2];
    assert.equal(made.name, 'Graph material variant');
    assert.deepEqual(Object.values(made.overrides), [16]);
    assert.notEqual(made.graph, (await materials())[1].graph);
    await until(async () => !!(await materials())[2].map, true, 30000);
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);
    const [, v, imp] = await materials();
    const same = await page.evaluate(async ([x, y]) => {
      const px = async (b) => {
        const img = await createImageBitmap(new Blob([new Uint8Array(b)]));
        const c = new OffscreenCanvas(img.width, img.height).getContext('2d');
        c.drawImage(img, 0, 0);
        return c.getImageData(0, 0, img.width, img.height).data;
      };
      const p = await px(x), q = await px(y);
      let s = 0;
      for (let i = 0; i < p.length; i++) s += Math.abs(p[i] - q[i]);
      return p.length === q.length ? s / p.length : 999;
    }, [[...(await fs.readFile(path.join(dir, v.map)))], [...(await fs.readFile(path.join(dir, imp.map)))]]);
    assert.ok(same < 1, `imported bakes the same (${same})`);

    // Images: 256 px, green up, packed ORM.
    await list.getByRole('option', { name: 'Graph material', exact: true }).click();
    await list.getByRole('option', { name: 'Graph material', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Images (PNG)…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Export as images' });
    await dlg.getByLabel('Size').selectOption('256');
    await dlg.getByRole('radio', { name: 'Up (OpenGL)' }).click();
    await dlg.getByLabel('Pack occlusion, roughness, metal (ORM)').check();
    await dlg.getByRole('button', { name: 'Export', exact: true }).click();
    await dlg.waitFor({ state: 'detached', timeout: 20000 });
    const names = (await fs.readdir(out)).filter((f) => f.startsWith('Graph material_') || f === 'Graph material.material.json').sort();
    assert.deepEqual(names, ['Graph material.material.json', 'Graph material_color.png', 'Graph material_height.png', 'Graph material_normal.png', 'Graph material_orm.png']);
    const png = await fs.readFile(path.join(out, 'Graph material_height.png'));
    assert.equal(png.readUInt32BE(16), 256);
    assert.equal(png[25], 0, 'height is grey');
    const m = JSON.parse(await fs.readFile(path.join(out, 'Graph material.material.json'), 'utf8'));
    assert.equal(m.normalGreen, 'up');
    assert.equal(m.evaluation.size, 256);
    await shot(page, 'mex01');
  } catch (e) {
    await shot(page, 'mex-failure');
    throw e;
  } finally {
    delete process.env.CW_MATERIAL_EXPORT_DIR;
    delete process.env.CW_MATERIAL_IMPORT_FILE;
    await quit(app);
  }
});
