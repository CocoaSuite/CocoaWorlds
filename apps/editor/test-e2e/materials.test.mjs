// End-to-end: the Materials workspace. Make materials (from an image, and by hand), change them with undo,
// paint a block with one, see the change on the block at once, and keep them in the project file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { drawBrush, launch, newProject, quit, setDraft, setField, shot, tempDirs, until } from './helpers.mjs';

/** A small PNG: an orange and dark checker. */
function checkerPng(size = 64) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) raw.set(((x >> 3) + (y >> 3)) % 2 ? [240, 120, 30] : [60, 30, 20], y * (size * 3 + 1) + 1 + x * 3);
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

test('materials: make, edit with undo, paint, delete', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const projectFile = path.join(projectsDir, 'lava-cave', 'project.cwproj');
  const savedMaterials = async () => JSON.parse(await fs.readFile(projectFile, 'utf8')).settings.materials ?? [];
  const world = (fn, arg) => page.evaluate(fn, arg);
  try {
    const image = path.join(tmp, 'lava_rock.png');
    await fs.writeFile(image, checkerPng());
    await newProject(page, 'Lava Cave');
    await page.keyboard.press('2');
    await page.keyboard.press('b');
    await drawBrush(page);
    await setDraft(page, [256, 128, 256], [-128, 0, -128]);
    await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
    await page.keyboard.press('v');

    const ws = page.getByRole('tablist', { name: 'Workspace' });
    await ws.getByRole('tab', { name: 'Materials' }).click();
    const region = page.getByRole('region', { name: 'Materials', exact: true });
    await region.getByText('No materials yet').waitFor();

    // 1. From an image: imported into the project's textures and made a material named after it.
    await page.getByTestId('material-images').setInputFiles(image);
    const list = region.getByRole('listbox', { name: 'Materials' });
    await list.getByRole('option', { name: 'Lava rock' }).waitFor();
    const props = page.getByRole('complementary', { name: 'Material', exact: true });
    assert.equal(await props.getByLabel('Image', { exact: true }).inputValue(), 'assets/textures/lava_rock.png');
    await page.getByTestId('material-preview').waitFor();

    // 2. By hand: renamed, a colour, glowing, scrolling, less rough.
    await region.getByRole('button', { name: '+ Material' }).click();
    await list.getByRole('option', { name: 'Material' }).waitFor();
    const name = props.getByLabel('Name', { exact: true });
    await name.fill('Lava');
    await name.press('Enter');
    await list.getByRole('option', { name: 'Lava', exact: true }).waitFor();
    await props.getByLabel('Image', { exact: true }).selectOption({ label: 'lava_rock' });
    await props.getByRole('switch', { name: 'Glows' }).click();
    await props.getByLabel('Glow colour', { exact: true }).fill('#ff5010');
    await setField(props, 'Scroll up (units a second)', 32);
    await props.getByLabel('Roughness', { exact: true }).fill('0.3');
    await until(async () => (await savedMaterials()).find((m) => m.name === 'Lava')?.roughness, 0.3, 6000);
    const lava = (await savedMaterials()).find((m) => m.name === 'Lava');
    assert.equal(lava.emissive, '#ff5010');
    assert.deepEqual(lava.scroll, [0, 32]);
    assert.equal(lava.map, 'assets/textures/lava_rock.png');
    assert.match(lava.id, /^mat\/[0-9a-z]{16}$/);

    // Undo puts the roughness back (one step for the whole drag), redo brings it again.
    await new Promise((r) => setTimeout(r, 800));
    await page.keyboard.press('Control+z');
    await until(() => props.getByLabel('Roughness', { exact: true }).inputValue(), '0.8');
    await page.keyboard.press('Control+y');
    await until(() => props.getByLabel('Roughness', { exact: true }).inputValue(), '0.3');
    await shot(page, 'm01-materials');

    // 3. Paint the block with it (Shift+click: every face), from the workspace's button.
    await props.getByRole('button', { name: 'Duplicate' }).waitFor();
    await region.getByRole('button', { name: 'Paint with it' }).click();
    const paint = page.getByRole('group', { name: 'Paint tool' });
    await paint.getByTestId('paint-material').getByText('Lava').waitFor();
    assert.equal(await paint.getByRole('radio', { name: 'Lava', exact: true }).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('1');
    const box = await page.getByTestId('viewport').boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Shift');
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-status').getByText('Saved').waitFor();
    const scene = JSON.parse(await fs.readFile(path.join(projectsDir, 'lava-cave', 'scenes', 'level_01.cwscene'), 'utf8'));
    const faces = scene.entities.find((e) => e.name === 'block').components.brush.faces;
    assert.equal(faces.filter((f) => f.material === lava.id).length, 6);

    // Drawn with its image and glow, and it scrolls.
    const look = (id) => {
      const m = window.__cwViewport.world.materials.get(id);
      return m ? { w: m.map?.image?.width ?? 0, glow: m.emissive.getHexString(), rough: m.roughness, y: m.map?.offset.y ?? 0 } : null;
    };
    await until(async () => (await world(look, lava.id))?.w, 64, 8000);
    assert.equal((await world(look, lava.id)).glow, 'ff5010');
    const y0 = (await world(look, lava.id)).y;
    await new Promise((r) => setTimeout(r, 300));
    assert.notEqual((await world(look, lava.id)).y, y0, 'the image scrolls');
    await page.keyboard.press('v');
    await page.keyboard.press('Escape');
    await shot(page, 'm02-painted');

    // 4. Changing the material changes the block at once, without repainting.
    await ws.getByRole('tab', { name: 'Materials' }).click();
    await list.getByRole('option', { name: 'Lava', exact: true }).click();
    await region.getByTestId('material-uses').getByText('Used by 6 faces in this scene.').waitFor();
    await props.getByLabel('Metal', { exact: true }).fill('1');
    await until(async () => (await world((id) => window.__cwViewport.world.materials.get(id).metalness, lava.id)), 1);
    await region.getByRole('radio', { name: 'Cube' }).click();
    await new Promise((r) => setTimeout(r, 300));
    await shot(page, 'm03-metal');

    // 5. Delete: the faces show the missing check; undo brings the material back.
    await props.getByRole('button', { name: 'Delete' }).click();
    await until(() => list.getByRole('option', { name: 'Lava', exact: true }).count(), 0);
    await until(async () => (await world((id) => window.__cwViewport.world.materials.get(id).map?.image?.tagName, lava.id)), 'CANVAS');
    await until(async () => (await world((id) => window.__cwViewport.world.materials.get(id).emissive.getHexString(), lava.id)), '000000');
    await page.keyboard.press('Control+z');
    await list.getByRole('option', { name: 'Lava', exact: true }).waitFor();
    await until(async () => (await world((id) => window.__cwViewport.world.materials.get(id).emissive.getHexString(), lava.id)), 'ff5010');
    await until(async () => (await savedMaterials()).length, 2, 6000);

    // 6. Play draws it too.
    await ws.getByRole('tab', { name: 'Scene' }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    await page.keyboard.press('F5');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'm-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
