import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newEntity, stringify } from '@cocoaworlds/core';
import { ProjectError, autosaveScene, createProject, openProject, resolveInside, saveScene } from '../src/main/project-fs';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-test-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('project folders', () => {
  it('creates the expected folder layout and reopens it', async () => {
    const o = await createProject(tmp, 'Facility Demo');
    expect(path.basename(o.dir)).toBe('facility-demo');
    const entries = (await fs.readdir(o.dir)).sort();
    expect(entries).toEqual(['.cocoaworlds', '.gitignore', 'assets', 'prefabs', 'project.cwproj', 'scenes', 'scripts']);
    const again = await openProject(o.dir);
    expect(again.project.id).toBe(o.project.id);
    expect(again.scene.entities.map((e) => e.name)).toEqual(['player_spawn', 'sun']);
    expect(again.recovery).toBeNull();
  });

  it('refuses to create over a non-empty folder', async () => {
    await fs.mkdir(path.join(tmp, 'taken'));
    await fs.writeFile(path.join(tmp, 'taken', 'file.txt'), 'x');
    await expect(createProject(tmp, 'Taken')).rejects.toBeInstanceOf(ProjectError);
  });

  it('saves a scene atomically and the change survives reopening', async () => {
    const o = await createProject(tmp, 'Save Test');
    const scene = structuredClone(o.scene);
    scene.entities.push(newEntity('crate', {}, { position: [64, 0, 32] }));
    await saveScene(o.dir, o.scenePath, scene);
    const files = await fs.readdir(path.join(o.dir, 'scenes'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const again = await openProject(o.dir);
    expect(again.scene.entities.find((e) => e.name === 'crate')?.transform.position).toEqual([64, 0, 32]);
  });

  it('offers a newer autosave for recovery and clears it after a real save', async () => {
    const o = await createProject(tmp, 'Recovery');
    const scene = structuredClone(o.scene);
    scene.entities.push(newEntity('unsaved'));
    await new Promise((r) => setTimeout(r, 20));
    await autosaveScene(o.dir, o.scenePath, scene);
    const reopened = await openProject(o.dir);
    expect(reopened.recovery?.scene.entities.some((e) => e.name === 'unsaved')).toBe(true);
    // The saved scene itself is untouched.
    expect(reopened.scene.entities.some((e) => e.name === 'unsaved')).toBe(false);
    await saveScene(o.dir, o.scenePath, reopened.scene);
    expect((await openProject(o.dir)).recovery).toBeNull();
  });

  it('rejects paths that escape the project folder', () => {
    expect(() => resolveInside('/proj', '../etc/passwd')).toThrow(ProjectError);
    expect(() => resolveInside('/proj', '/etc/passwd')).toThrow(ProjectError);
    expect(resolveInside('/proj', 'scenes/a.cwscene')).toBe(path.resolve('/proj/scenes/a.cwscene'));
  });

  it('refuses to save an invalid scene and leaves the file alone', async () => {
    const o = await createProject(tmp, 'Invalid');
    const file = path.join(o.dir, o.scenePath);
    const before = await fs.readFile(file, 'utf8');
    const bad = { ...o.scene, entities: [{ id: 'x' }] };
    await expect(saveScene(o.dir, o.scenePath, bad)).rejects.toBeInstanceOf(ProjectError);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it('explains a damaged scene file instead of crashing', async () => {
    const o = await createProject(tmp, 'Damaged');
    await fs.writeFile(path.join(o.dir, o.scenePath), '{"format":"cocoaworlds.scene"');
    await expect(openProject(o.dir)).rejects.toThrow(/not valid JSON/);
  });

  it('refuses folders that are not projects', async () => {
    await expect(openProject(tmp)).rejects.toThrow(/not a CocoaWorlds project/);
  });

  it('writes stable, diff-friendly JSON', async () => {
    const o = await createProject(tmp, 'Diffs');
    const text = await fs.readFile(path.join(o.dir, o.scenePath), 'utf8');
    expect(text).toBe(stringify(o.scene));
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('prefab files', () => {
  it('saves with a name made from the prefab, lists them, and never overwrites another', async () => {
    const { makePrefab, newEntity: ne } = await import('@cocoaworlds/core');
    const { listPrefabs, savePrefab } = await import('../src/main/project-fs');
    const { dir } = await createProject(tmp, 'Prefabs');
    const root = ne('Big Lamp', { group: {} });
    const a = makePrefab('Big Lamp', [root], root.id);
    const b = makePrefab('Big Lamp', [root], root.id);
    expect((await savePrefab(dir, a)).path).toBe('prefabs/big_lamp.cwprefab');
    expect((await savePrefab(dir, b)).path).toBe('prefabs/big_lamp_2.cwprefab');
    // Saving again to a known path updates it.
    await savePrefab(dir, { ...a, name: 'Renamed' }, 'prefabs/big_lamp.cwprefab');
    const { prefabs, problems } = await listPrefabs(dir);
    expect(problems).toEqual([]);
    expect(prefabs.map((p) => p.prefab.name).sort()).toEqual(['Big Lamp', 'Renamed']);
  });

  it('refuses paths outside the prefabs folder and invalid prefabs; reports damaged files', async () => {
    const { makePrefab, newEntity: ne } = await import('@cocoaworlds/core');
    const { listPrefabs, savePrefab } = await import('../src/main/project-fs');
    const { dir } = await createProject(tmp, 'Prefabs2');
    const root = ne('x', {});
    const p = makePrefab('x', [root], root.id);
    await expect(savePrefab(dir, p, 'scenes/evil.cwprefab')).rejects.toThrow(/prefabs folder/);
    await expect(savePrefab(dir, p, '../../evil.cwprefab')).rejects.toThrow();
    await expect(savePrefab(dir, { ...p, entities: [] })).rejects.toThrow(/not valid/);
    await fs.writeFile(path.join(dir, 'prefabs', 'broken.cwprefab'), '{ nope');
    const { prefabs, problems } = await listPrefabs(dir);
    expect(prefabs).toEqual([]);
    expect(problems[0]).toMatch(/broken\.cwprefab/);
  });
});
