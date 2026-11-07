// End-to-end (benchmark step B3): import a sound, give an object a looping Sound, play another from a block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launch, newProject, pickBlock, quit, shot, tempDirs, until } from './helpers.mjs';

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

test('sounds: import, Sound component, play sound block', async () => {
  const { tmp, userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  const insp = () => page.getByRole('complementary', { name: 'Inspector' });
  const playing = () => page.evaluate(() => (window.__cwViewport.play?.sounds ?? []).map((s) => `${s.sound.split('/').pop()}:${s.audio.getLoop()}`).sort());
  try {
    const hum = path.join(tmp, 'Machine Hum.wav'), ding = path.join(tmp, 'ding.wav');
    await fs.writeFile(hum, toneWav(1, 110));
    await fs.writeFile(ding, toneWav(2, 880));
    await newProject(page, 'Noisy');
    await page.getByRole('tab', { name: 'Assets' }).click();
    await page.getByTestId('import-sounds').setInputFiles([hum, ding]);
    await page.getByRole('list', { name: 'Sounds' }).getByRole('listitem', { name: 'machine_hum' }).waitFor();

    // A humming object: an empty with a Sound component.
    await page.getByRole('menubar').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Empty object' }).click();
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Sound/ }).click();
    await insp().getByRole('group', { name: 'Sound' }).getByRole('combobox', { name: 'Sound' }).selectOption({ label: 'machine_hum' });

    // And a block on it that plays a ding when the game starts.
    await insp().getByRole('button', { name: 'Add component' }).click();
    await page.getByRole('menuitem', { name: /^Script/ }).click();
    const panel = page.getByRole('region', { name: 'Script of object' });
    await panel.getByRole('button', { name: '+ When…' }).click();
    await pickBlock(page, 'When the game starts');
    const stack = panel.getByRole('group', { name: 'When the game starts' });
    await stack.getByRole('button', { name: '+ Add a block' }).click();
    await pickBlock(page, 'Sound › Play a sound');
    await stack.getByLabel('Play sound', { exact: true }).selectOption({ label: 'ding' });
    assert.equal(await page.getByRole('tab', { name: /Problems \d/ }).count(), 0, 'no problems');
    await shot(page, 'snd01-blocks');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('play-banner').waitFor();
    await until(async () => (await playing()).join(' '), 'ding.wav:false machine_hum.wav:true', 8000);
    await page.keyboard.press('Escape');
    if (await page.getByTestId('play-banner').count()) await page.keyboard.press('Escape');
    await until(() => page.getByTestId('play-banner').count(), 0);
  } catch (e) {
    await shot(page, 'snd-failure');
    throw e;
  } finally {
    await quit(app);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
