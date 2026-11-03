// End-to-end: glass casts no shadow. A pane in front of the sun darkens the floor while it is opaque, and stops
// darkening it once its material is glass (in the editor and in Play).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

async function addBrush(page, size, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

/** The viewport as RGBA pixels. */
async function pixels(page) {
  await new Promise((r) => setTimeout(r, 600));
  const png = await page.getByTestId('viewport').screenshot();
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, img.width, img.height).data);
  }, png.toString('base64'));
}

const lum = (p, i) => p[i] + p[i + 1] + p[i + 2];

/** Pixels where the pane itself is drawn: they change when only its colour changes (its shadow doesn't). */
function silhouette(white, black) {
  const m = new Uint8Array(white.length / 4);
  for (let i = 0; i < white.length; i += 4) if (Math.abs(lum(white, i) - lum(black, i)) > 30) m[i / 4] = 1;
  return m;
}

/** How many pixels of `b` off the pane are clearly darker than in `a` (its shadow on the floor). */
function shadowed(a, b, pane) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (!pane[i / 4] && lum(a, i) - lum(b, i) > 45) n++;
  return n;
}

test('glass casts no shadow', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const MAT = 'mat/paneglass0000000';
  try {
    await newProject(page, 'Glass shadow');
    await page.keyboard.press('2');
    await addBrush(page, [1536, 32, 1536], [-768, -32, -768]);
    // A pane standing on the floor, its long shadow beside it.
    await addBrush(page, [384, 384, 16], [-192, 0, -8]);
    const pane = await page.evaluate(() => window.__cwStore.getState().doc.entities.filter((e) => e.components.brush).at(-1));

    // One material on every face of the pane.
    await page.evaluate(
      ([id, mat]) => {
        window.__cwStore.getState().setMaterials([{ id: mat, name: 'Pane', color: '#ffffff', roughness: 0.6, metalness: 0, refraction: 0 }], 'Add material');
        const brush = window.__cwStore.getState().doc.get(id).components.brush;
        window.__cwStore.getState().setFaceSurfaces(brush.faces.map((_, face) => ({ id, face, patch: { material: mat } })), 'Paint');
      },
      [pane.id, MAT],
    );
    const setMat = (patch) =>
      page.evaluate(
        ([mat, patch]) => {
          const s = window.__cwStore.getState();
          s.setMaterials(s.session.project.settings.materials.map((m) => (m.id === mat ? { ...m, ...patch } : m)), 'Pane');
        },
        [MAT, patch],
      );
    const visible = (v) => page.evaluate(([id, v]) => window.__cwStore.getState().setFlag(id, 'visible', v), [pane.id, v]);

    // From a distance, with the scene's own sun and shadows.
    await page.getByRole('radio', { name: 'Perspective' }).click();
    await page.getByRole('tree').getByRole('treeitem', { name: pane.name }).click();
    await page.getByTestId('viewport').hover();
    await page.keyboard.press('f');
    for (let i = 0; i < 2; i++) await page.mouse.wheel(0, 150);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Lighting (Game|Preview)/ }).click();
    await until(() => page.evaluate(() => window.__cwViewport.renderer.shadowMap.enabled), true);

    // Without the pane; with it opaque (white, then black: where it is drawn); and with it glass.
    await visible(false);
    const bare = await pixels(page);
    await visible(true);
    const white = await pixels(page);
    await shot(page, 'glass-shadow-opaque');
    await setMat({ color: '#000000' });
    const black = await pixels(page);
    const where = silhouette(white, black);
    await setMat({ color: '#ffffff', refraction: 1 });
    await until(() => page.evaluate((mat) => window.__cwViewport.world.materials.get(mat)?.transmission, MAT), 1, 4000);
    const glass = await pixels(page);
    await shot(page, 'glass-shadow-glass');

    const opaqueShadow = shadowed(bare, white, where);
    const glassShadow = shadowed(bare, glass, where);
    console.log(`shadowed floor pixels: opaque ${opaqueShadow}, glass ${glassShadow}`);
    assert.ok(opaqueShadow > 2000, `an opaque pane casts a shadow (${opaqueShadow} pixels)`);
    assert.ok(glassShadow < opaqueShadow / 10, `a glass pane casts none (${glassShadow} vs ${opaqueShadow})`);
  } catch (e) {
    await shot(page, 'glass-shadow-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
