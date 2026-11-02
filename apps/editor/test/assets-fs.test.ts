import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listAssets, readAsset, readGraph, safeName, writeAsset, writeGenerated, writeGraph } from '../src/main/assets-fs';

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

describe('graph materials on disk (Cocoa Materials)', () => {
  const graph = { format: 'cocoaworlds.material', version: 1, nodes: [], links: [] };

  it('writes graphs in the materials folder (a new one never replaces another) and reads them back', async () => {
    expect(await writeGraph(dir, 'materials/stone.cwmat', graph, true)).toBe('materials/stone.cwmat');
    expect(await writeGraph(dir, 'materials/stone.cwmat', graph, true)).toBe('materials/stone_2.cwmat');
    // Saving over its own file is fine.
    expect(await writeGraph(dir, 'materials/stone.cwmat', { ...graph, nodes: [{ id: 'a' }] }, false)).toBe('materials/stone.cwmat');
    expect(await readGraph(dir, 'materials/stone.cwmat')).toEqual({ ...graph, nodes: [{ id: 'a' }] });
  });

  it('refuses paths outside the materials folder, other files, and missing or broken graphs', async () => {
    await expect(writeGraph(dir, '../evil.cwmat', graph, true)).rejects.toThrow(/not a graph file/);
    await expect(writeGraph(dir, 'materials/x.json', graph, true)).rejects.toThrow(/not a graph file/);
    await expect(writeGraph(dir, 'materials/x.cwmat', { nodes: [] }, true)).rejects.toThrow(/not a Cocoa Materials graph/);
    await expect(readGraph(dir, 'materials/none.cwmat')).rejects.toThrow(/missing/);
    await fs.mkdir(path.join(dir, 'materials'), { recursive: true });
    await fs.writeFile(path.join(dir, 'materials', 'bad.cwmat'), '{ nope');
    await expect(readGraph(dir, 'materials/bad.cwmat')).rejects.toThrow(/damaged/);
  });

  it('writes baked maps into the generated folder, replacing the last bake; they stay out of the texture list', async () => {
    expect(await writeGenerated(dir, 'stone_color.png', png)).toBe('assets/textures/generated/stone_color.png');
    expect(await writeGenerated(dir, 'stone_color.png', new Uint8Array([9]))).toBe('assets/textures/generated/stone_color.png');
    expect([...(await readAsset(dir, 'assets/textures/generated/stone_color.png'))]).toEqual([9]);
    expect((await listAssets(dir)).textures).toEqual([]);
    await expect(writeGenerated(dir, '../x.png', png)).rejects.toThrow(/plain .png name/);
    await expect(writeGenerated(dir, 'x.exe', png)).rejects.toThrow(/plain .png name/);
  });
});
