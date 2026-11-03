// End-to-end: the scene's background sound, and a Sound area brush that echoes like a cave and swaps in its
// own background while the player is inside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drawBrush, launch, newProject, quit, setDraft, shot, tempDirs, until } from './helpers.mjs';

/** A short sine tone as a 16-bit mono WAV. */
function toneWav(seconds = 0.5, hz = 440, rate = 22050) {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000), 44 + i * 2);
  return b;
}

async function addBrush(page, size, corner) {
  await page.keyboard.press('b');
  await drawBrush(page);
  await setDraft(page, size, corner);
  await page.getByRole('group', { name: 'Brush tool' }).getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('v');
}

test('sound areas: background sound, cave echo, leaving the area', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  /** What Play hears through now: the effect, where its levels have got to, and the background loop. */
  const heard = () =>
    page.evaluate(() => {
      const p = window.__cwViewport.play;
      const st = p?.stage;
      if (!st) return null;
      const wet = st.echoes.get(st.effect)?.wet.gain.value ?? 0;
      const bg = p.background?.audio;
      return { effect: st.effect, area: p.hearingNow?.area ?? null, lowpass: Math.round(st.lowpass.frequency.value), wet: Math.round(wet * 100) / 100, background: p.background?.sound.split('/').pop() ?? null, playing: !!bg?.isPlaying, loop: !!bg?.getLoop() };
    });
  try {
    const wind = path.join(tmp, 'wind.wav'), drips = path.join(tmp, 'drips.wav');
    await fs.writeFile(wind, toneWav(1, 110));
    await fs.writeFile(drips, toneWav(1, 660));
    await newProject(page, 'Echoes');
    await page.getByRole('tab', { name: 'Assets' }).click();
    await page.getByTestId('import-sounds').setInputFiles([wind, drips]);
    await page.getByRole('list', { name: 'Sounds' }).getByRole('listitem', { name: 'drips' }).waitFor();

    // Nothing selected: the scene's background sound.
    await page.keyboard.press('Escape');
    await insp().getByRole('combobox', { name: 'Background sound' }).selectOption({ label: 'wind' });
    await insp().getByLabel('Background volume').waitFor();

    // A floor, and a cave round the Player start (at the origin, facing −Z) that ends 128 ahead.
    await page.keyboard.press('2');
    await addBrush(page, [2048, 16, 2048], [-1024, -16, -1024]);
    await addBrush(page, [256, 256, 256], [-128, 0, -128]);
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Sound area/ }).click();
    const area = insp().getByRole('group', { name: 'Sound area' });
    await area.getByRole('combobox', { name: 'Sounds like' }).selectOption({ label: 'Cave (long echo)' });
    await area.getByRole('combobox', { name: 'Background sound' }).selectOption({ label: 'drips' });
    await shot(page, 'sa01-area');
    const saved = await page.evaluate(() => {
      const doc = window.__cwStore.getState().doc;
      const a = doc.entities.find((e) => e.components.soundArea);
      return { background: doc.settings.backgroundSound?.sound, id: a?.id, effect: a?.components.soundArea.effect };
    });
    assert.equal(saved.background?.split('/').pop(), 'wind.wav');
    assert.equal(saved.effect, 'cave');

    // Play: in the cave, its echo fades in and its drips loop in place of the wind.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(() => page.evaluate(() => !!window.__cwViewport.play?.world.player), true, 10000);
    await until(async () => JSON.stringify(await heard()), JSON.stringify({ effect: 'cave', area: saved.id, lowpass: 20000, wet: 0.55, background: 'drips.wav', playing: true, loop: true }), 8000);

    // Walk out of it: no echo, the wind comes back.
    if (await page.getByTestId('click-to-play').count()) await page.getByTestId('click-to-play').click({ timeout: 2000 }).catch(() => {});
    await until(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''), 'CANVAS');
    await page.keyboard.down('w');
    await until(async () => (await heard())?.area, null, 15000);
    await page.keyboard.up('w');
    await until(async () => JSON.stringify(await heard()), JSON.stringify({ effect: 'none', area: null, lowpass: 20000, wet: 0, background: 'wind.wav', playing: true, loop: true }), 8000);
    // (The drips faded out and were stopped.)
    await until(() => page.evaluate(() => window.__cwViewport.play.group.children.filter((o) => o.name === 'background-sound').length), 1, 3000);
    await shot(page, 'sa02-outside');

    await page.keyboard.press('Escape');
    if (await page.getByTestId('play-banner').count()) await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'sa-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
