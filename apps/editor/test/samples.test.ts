import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addSample } from '../src/main/assets-fs';

const samples = path.join(__dirname, '..', 'samples');

describe('ready-made assets', () => {
  it('copy the rigged chicken in once, never over a different file of the same name', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-sample-'));
    await fs.writeFile(path.join(dir, 'project.cwproj'), '{}');
    const a = await addSample(dir, samples, 'chicken');
    expect(a.path).toBe('assets/models/chicken_rigged.glb');
    // Again: the same file.
    expect((await addSample(dir, samples, 'chicken')).path).toBe(a.path);
    // The user's own model of that name stays as it is; the chicken goes in beside it.
    await fs.writeFile(path.join(dir, a.path), 'my own model');
    const b = await addSample(dir, samples, 'chicken');
    expect(b.path).toBe('assets/models/chicken_rigged_2.glb');
    expect(await fs.readFile(path.join(dir, a.path), 'utf8')).toBe('my own model');
    const bytes = await fs.readFile(path.join(dir, b.path));
    expect(bytes.subarray(0, 4).toString()).toBe('glTF');
    await expect(addSample(dir, samples, 'nothing')).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
