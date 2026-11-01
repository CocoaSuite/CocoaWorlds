// End-to-end (benchmark step B3): import an image as a texture, paint a block with it, save, and see it drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

/** A small PNG: a red and white checker, `size` pixels square. */
function checkerPng(size = 64) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      raw.set(on ? [220, 40, 40] : [245, 245, 245], y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('textures: import, paint, save, draw', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const sceneFile = path.join(projectsDir, 'textured', 'scenes', 'level_01.cwscene');
  try {
    const file = path.join(tmp, 'Red Checker.png');
    await fs.writeFile(file, checkerPng());
    await newProject(page, 'Textured');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [256, 128, 256], [-128, 0, -128]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');

    // 1. Import from the Assets tab (the system file chooser; here given the file directly).
    await page.getByRole('tab', { name: 'Assets' }).click();
    await page.getByTestId('import-textures').setInputFiles(file);
    const tile = page.getByRole('list', { name: 'Textures' }).getByRole('listitem', { name: 'red_checker' });
    await tile.waitFor();
    const copied = await fs.stat(path.join(projectsDir, 'textured', 'assets', 'textures', 'red_checker.png'));
    assert.ok(copied.size > 50);

    // 2. Click it: the paint tool with that texture; Shift+click paints the whole block.
    await tile.click();
    const panel = page.getByRole('group', { name: 'Paint tool' });
    await panel.getByRole('radio', { name: 'red_checker' }).waitFor();
    assert.equal(await panel.getByRole('radio', { name: 'red_checker' }).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('1');
    const box = await page.getByTestId('viewport').boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Shift');

    // 3. Saved with the texture's project path; drawn with the image.
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
    const faces = scene.entities.find((e) => e.name === 'block').components.brush.faces;
    assert.equal(faces.filter((f) => f.material === 'assets/textures/red_checker.png').length, 6);
    await until(
      () => page.evaluate(() => window.__cwViewport.world.materials.get('assets/textures/red_checker.png')?.map?.image?.width ?? 0),
      64,
      8000,
    );
    await page.keyboard.press('v');
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));
    await shot(page, 't01-textured');
  } catch (e) {
    await shot(page, 't-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
