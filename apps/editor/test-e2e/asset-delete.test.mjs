// End-to-end: deleting an imported texture from the Assets tab: it says what still uses it, moves the file into
// assets/_deleted, and Undo puts it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';
function png(size = 32) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
test('assets: delete a texture (and undo)', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  try {
    await newProject(page, 'Tidy');
    await page.getByRole('tab', { name: 'Assets' }).click();
    const f = path.join(tmp, 'old_brick.png');
    await fs.writeFile(f, png());
    await page.getByTestId('import-textures').setInputFiles(f);
    const tile = page.getByRole('listitem', { name: 'old_brick' }).first();
    await tile.waitFor();
    // Right-click menu: Delete…
    await tile.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Delete old_brick?' });
    await ask.waitFor();
    await shot(page, 'asset-delete');
    await ask.getByRole('button', { name: 'Delete', exact: true }).click();
    const dir = path.join(projectsDir, 'tidy');
    await until(() => fs.stat(path.join(dir, 'assets', '_deleted', 'textures', 'old_brick.png')).then(() => true, () => false), true, 6000);
    await until(() => page.getByRole('listitem', { name: 'old_brick' }).count(), 0, 6000);
    // Undo: back where it was.
    await page.keyboard.press('Control+z');
    await until(() => fs.stat(path.join(dir, 'assets', 'textures', 'old_brick.png')).then(() => true, () => false), true, 6000);
    await until(() => page.getByRole('listitem', { name: 'old_brick' }).count(), 1, 6000);
  } catch (e) {
    await shot(page, 'asset-delete-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
