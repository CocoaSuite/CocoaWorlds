import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listAssets, readAsset, safeName, writeAsset } from '../src/main/assets-fs';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-assets-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('project assets', () => {
  it('copies picked files in under safe, unique names and lists them by kind', async () => {
    const a = await writeAsset(dir, 'textures', 'Red Brick (old).PNG', png);
    expect(a).toEqual({ path: 'assets/textures/red_brick_old.png', name: 'red_brick_old', bytes: 7 });
    const b = await writeAsset(dir, 'textures', 'red brick old.png', png);
    expect(b.path).toBe('assets/textures/red_brick_old_2.png');
    await writeAsset(dir, 'sounds', 'door.ogg', new Uint8Array([1]));
    const all = await listAssets(dir);
    expect(all.textures.map((x) => x.path)).toEqual(['assets/textures/red_brick_old.png', 'assets/textures/red_brick_old_2.png']);
    expect(all.sounds.map((x) => x.name)).toEqual(['door']);
    expect(all.models).toEqual([]);
    expect([...(await readAsset(dir, a.path))]).toEqual([...png]);
  });

  it('refuses the wrong kind of file, files outside the assets folder, and unknown kinds', async () => {
    await expect(writeAsset(dir, 'textures', 'notes.txt', png)).rejects.toThrow(/supported texture/);
    await expect(writeAsset(dir, 'scripts', 'x.png', png)).rejects.toThrow(/Unknown kind/);
    await expect(readAsset(dir, '../secret.png')).rejects.toThrow(/assets folder/);
    await expect(readAsset(dir, 'assets/../../secret.png')).rejects.toThrow(/outside the project/);
    expect(safeName('Ünïcode Wäll!!.JPG')).toBe('unicode_wall.jpg');
  });
});
