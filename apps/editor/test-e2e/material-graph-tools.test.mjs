// End-to-end: the material graph's tools. Box-picking several nodes and moving them together; sections that carry
// the nodes inside them (made around picked nodes, renamed, recoloured, removed, saved in the graph file); the
// preview kept on one node while another is changed; right-click still adds, right-drag pans; a new node bakes;
// a Free transform placed by hand with handles over its flat picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, quit, shot, tempDirs, until } from './helpers.mjs';

test('material graph: box select, sections, kept preview', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const dir = path.join(projectsDir, 'tools');
  const graphFile = async () => JSON.parse(await fs.readFile(path.join(dir, 'materials', 'graph_material.cwmat'), 'utf8'));
  const nodeOf = (type) => page.locator(`.react-flow__node:has(.cm-node[data-node-type="${type}"])`);
  const posOf = async (type) => {
    const n = (await graphFile()).nodes.find((x) => x.type === type);
    return { x: n.x, y: n.y };
  };
  try {
    await newProject(page, 'Tools');
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Materials' }).click();
    const region = page.getByRole('region', { name: 'Materials', exact: true });
    const side = page.getByRole('complementary', { name: 'Material', exact: true });
    await region.getByRole('button', { name: '+ Graph material' }).click();
    const flow = page.getByTestId('material-graph');
    await flow.waitFor();
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);
    // (Everything in view and not too small.)
    await page.locator('.react-flow__controls-fitview').click();
    await page.locator('.react-flow__controls-zoomout').click();
    await new Promise((r) => setTimeout(r, 400));

    // 1. A box drawn on empty graph picks the nodes wholly inside it; dragging one moves them all (one undo step).
    const fb = await flow.boundingBox();
    const outc = await nodeOf('outColor').boundingBox();
    const map = await nodeOf('gradientMap').boundingBox();
    const before = { out: await posOf('outColor'), map: await posOf('gradientMap') };
    const left = Math.min(outc.x, map.x) - 12, top = Math.min(outc.y, map.y) - 12;
    const right = Math.max(outc.x + outc.width, map.x + map.width) + 12, bottom = Math.max(outc.y + outc.height, map.y + map.height) + 12;
    assert.ok(left > fb.x && top > fb.y + 36, 'room to start the box on empty graph');
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 10 });
    await page.mouse.up();
    await until(() => page.locator('.react-flow__node.selected').count(), 2, 4000);
    await shot(page, 'gt01-box');
    const grab = await nodeOf('outColor').locator('.cm-node-h').boundingBox();
    await page.mouse.move(grab.x + 30, grab.y + grab.height / 2);
    await page.mouse.down();
    await page.mouse.move(grab.x + 30 + 90, grab.y + grab.height / 2 + 60, { steps: 10 });
    await page.mouse.up();
    await until(async () => (await posOf('outColor')).x > before.out.x + 40 && (await posOf('gradientMap')).x > before.map.x + 40, true, 6000);
    const movedBy = (await posOf('outColor')).x - before.out.x;
    assert.ok(Math.abs((await posOf('gradientMap')).x - before.map.x - movedBy) < 2, 'both moved the same way');
    await new Promise((r) => setTimeout(r, 800));
    await page.keyboard.press('Control+z');
    await until(async () => JSON.stringify([await posOf('outColor'), await posOf('gradientMap')]), JSON.stringify([before.out, before.map]), 6000);

    // 2. A section made around the picked nodes; dragging its title carries them; renamed and recoloured.
    await page.getByRole('button', { name: '+ Section' }).click();
    await until(async () => (await graphFile()).sections?.length ?? 0, 1, 6000);
    let sec = (await graphFile()).sections[0];
    assert.equal(sec.label, 'Section');
    assert.ok(sec.x < before.out.x && sec.y < Math.min(before.out.y, before.map.y), 'made around the picked nodes');
    await page.locator('.react-flow__pane').click({ position: { x: fb.width - 20, y: fb.height - 20 } });
    const title = page.getByTestId('graph-section').locator('.cm-sec-h');
    await title.dblclick({ position: { x: 30, y: 12 } });
    await page.getByRole('textbox', { name: 'Section', exact: true }).fill('Base');
    await page.keyboard.press('Enter');
    await until(async () => (await graphFile()).sections[0].label, 'Base', 6000);
    await page.getByRole('button', { name: 'Section colour' }).click();
    await until(async () => (await graphFile()).sections[0].color ?? '', '#4b9cff', 6000);
    const tb = await title.boundingBox();
    await page.mouse.move(tb.x + 50, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + 50 - 70, tb.y + tb.height / 2 - 50, { steps: 10 });
    await page.mouse.up();
    await until(async () => (await graphFile()).sections[0].x < sec.x - 30, true, 6000);
    sec = (await graphFile()).sections[0];
    const dx = (await posOf('outColor')).x - before.out.x;
    assert.ok(dx < -30, 'the section carried its nodes');
    assert.ok(Math.abs((await posOf('gradientMap')).x - before.map.x - dx) < 2);
    await shot(page, 'gt02-section');
    // A box can be drawn inside a section (only its title takes the mouse).
    const sb = await page.getByTestId('graph-section').boundingBox();
    await page.locator('.react-flow__pane').click({ position: { x: fb.width - 20, y: fb.height - 20 } });
    await page.mouse.move(sb.x + 4, sb.y + 34);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width - 4, sb.y + sb.height - 4, { steps: 8 });
    await page.mouse.up();
    await until(() => page.locator('.react-flow__node.selected .cm-node').count(), 2, 4000);
    // Picked by its title and deleted: the section goes, its nodes stay.
    await page.locator('.react-flow__pane').click({ position: { x: fb.width - 20, y: fb.height - 20 } });
    await title.click({ position: { x: 30, y: 12 } });
    await page.keyboard.press('Delete');
    await until(async () => (await graphFile()).sections?.length ?? 0, 0, 6000);
    assert.ok((await graphFile()).nodes.some((n) => n.type === 'outColor'));
    await page.keyboard.press('Control+z');
    await until(async () => (await graphFile()).sections?.length ?? 0, 1, 6000);

    // 3. The preview kept on one node while another is picked and changed.
    await page.locator('.react-flow__pane').click({ position: { x: fb.width - 20, y: fb.height - 20 } });
    await nodeOf('noise').getByRole('button', { name: 'Keep the preview on this node (double-click does it too)' }).click();
    await page.getByTestId('preview-kept').waitFor();
    assert.match(await page.getByTestId('preview-kept').textContent(), /Noise/);
    await nodeOf('gradientMap').click();
    await side.getByText('Node settings').or(side.getByLabel('Node settings')).first().waitFor();
    assert.match(await page.getByTestId('preview-kept').textContent(), /Noise/, 'still the kept node');
    await page.getByTestId('node-preview').waitFor();
    await shot(page, 'gt03-kept');
    await page.getByTestId('preview-kept').getByRole('button', { name: 'Preview the picked node again' }).click();
    await until(() => page.getByTestId('preview-kept').count(), 0, 4000);
    await nodeOf('outRoughness').dblclick();
    await page.getByTestId('preview-kept').waitFor();
    assert.match(await page.getByTestId('preview-kept').textContent(), /Roughness/);

    // 4. Right-click on empty graph adds; a new kind of node is added, wired and baked.
    await page.mouse.click(fb.x + fb.width - 30, fb.y + fb.height - 30, { button: 'right' });
    const menu = page.getByRole('dialog', { name: '+ Node' });
    await menu.getByLabel('Find a node…').fill('truchet');
    await menu.getByLabel('Find a node…').press('Enter');
    await nodeOf('truchet').waitFor();
    // A right-drag pans and adds nothing.
    const vp = async () => page.locator('.react-flow__viewport').getAttribute('style');
    const was = await vp();
    await page.mouse.move(fb.x + fb.width - 200, fb.y + fb.height - 40);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(fb.x + fb.width - 100, fb.y + fb.height - 90, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await until(async () => (await vp()) !== was, true, 4000);
    assert.equal(await menu.count(), 0, 'no menu after a right-drag');
    await until(() => page.getByTestId('bake-status').textContent(), 'Baked', 30000);

    // 5. Free transform: placed by hand with the handles over its flat picture (one undo step per drag).
    await page.getByTestId('preview-kept').getByRole('button', { name: 'Preview the picked node again' }).click();
    await page.mouse.click(fb.x + fb.width - 30, fb.y + fb.height - 30, { button: 'right' });
    await menu.getByLabel('Find a node…').fill('free transform');
    await menu.getByLabel('Find a node…').press('Enter');
    await nodeOf('freeTransform').waitFor();
    const ft = async () => (await graphFile()).nodes.find((n) => n.type === 'freeTransform').params;
    const handles = page.getByTestId('place-handles');
    await handles.waitFor();
    const hb = await handles.boundingBox();
    // Move: from the middle of the box, a quarter of the square right and down a little.
    await page.mouse.move(hb.x + hb.width * 0.55, hb.y + hb.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width * 0.8, hb.y + hb.height * 0.65, { steps: 8 });
    await page.mouse.up();
    await until(async () => Math.round(((await ft()).x ?? 0.5) * 100), 75, 6000);
    await until(async () => Math.round(((await ft()).y ?? 0.5) * 100), 60, 6000);
    // Size: the bottom-right corner pulled out (from the middle, so the box doubles).
    const corner = await handles.locator('[data-handle="size-2"]').boundingBox();
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2 + hb.width * 0.1, corner.y + corner.height / 2 + hb.height * 0.05, { steps: 8 });
    await page.mouse.up();
    await until(async () => Math.round(((await ft()).w ?? 0.5) * 100), 70, 6000);
    await until(async () => Math.round(((await ft()).h ?? 0.5) * 100), 60, 6000);
    // Turn: the round handle (above the box) swung a quarter turn clockwise around the middle.
    const knob = await handles.locator('[data-handle="turn"]').boundingBox();
    const p = await ft();
    const cx = hb.x + p.x * hb.width, cy = hb.y + p.y * hb.height;
    await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
    await page.mouse.down();
    await page.mouse.move(cx + (cy - (knob.y + knob.height / 2)), cy, { steps: 10 });
    await page.mouse.up();
    await until(async () => Math.abs(Math.round((await ft()).angle ?? 0) - 90) <= 2, true, 6000);
    await shot(page, 'gt04-free-transform');
    await new Promise((r) => setTimeout(r, 800));
    await page.keyboard.press('Control+z');
    await until(async () => (await ft()).angle ?? 0, 0, 6000);
    assert.equal(Math.round((await ft()).w * 100), 70, 'undo takes back only the turn');
  } catch (e) {
    await shot(page, 'gt-failure');
    throw e;
  } finally {
    await quit(app);
  }
});
