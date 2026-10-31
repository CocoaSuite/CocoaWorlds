/**
 * Project folders on disk. Pure Node (no Electron imports) so it can be unit-tested.
 *
 * Guarantees:
 *  - Saves are atomic: write a temp file, flush, then rename over the target.
 *  - Paths coming from the UI are resolved inside the project folder or rejected.
 *  - Files upgraded from an older format are backed up before anything is written.
 *  - Autosaves live in .cocoaworlds/autosave and are only ever offered, never applied silently.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ASSETS_DIR,
  PREFABS_DIR,
  PROJECT_FILE,
  SCENE_EXT,
  SCRIPTS_DIR,
  WORK_DIR,
  fileStem,
  newProject,
  parseProject,
  parseScene,
  stringify,
  validateScene,
  type SceneFile,
} from '@cocoaworlds/core';
import type { OpenedProject } from '../shared/api';

export class ProjectError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

/** Resolve a project-relative path, refusing anything that escapes the project folder. */
export function resolveInside(dir: string, rel: string): string {
  const root = path.resolve(dir);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new ProjectError('That file is outside the project folder.');
  return full;
}

export async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const h = await fs.open(tmp, 'w');
  try {
    await h.writeFile(text, 'utf8');
    await h.sync();
  } finally {
    await h.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

const GITIGNORE = `# CocoaWorlds caches, autosaves and builds\n${WORK_DIR}/\nbuilds/\n`;

export async function createProject(parentDir: string, name: string): Promise<OpenedProject> {
  const clean = name.trim();
  if (!clean) throw new ProjectError('Give the project a name.');
  if (clean.length > 80) throw new ProjectError('Project names can be at most 80 characters.');
  const dir = path.join(path.resolve(parentDir), fileStem(clean).replace(/_/g, '-'));
  if (await exists(dir)) {
    const entries = await fs.readdir(dir);
    if (entries.length) throw new ProjectError(`A folder named “${path.basename(dir)}” already exists here and is not empty.`);
  }
  const { project, scenes } = newProject(clean);
  await fs.mkdir(dir, { recursive: true });
  for (const sub of [ASSETS_DIR, SCRIPTS_DIR, PREFABS_DIR, path.join(WORK_DIR, 'autosave')]) {
    await fs.mkdir(path.join(dir, sub), { recursive: true });
  }
  for (const [rel, scene] of Object.entries(scenes)) await writeAtomic(resolveInside(dir, rel), stringify(scene));
  await writeAtomic(path.join(dir, '.gitignore'), GITIGNORE);
  // Project file last: a folder without it is never mistaken for a finished project.
  await writeAtomic(path.join(dir, PROJECT_FILE), stringify(project));
  return openProject(dir);
}

function autosavePath(dir: string, scenePath: string): string {
  return path.join(dir, WORK_DIR, 'autosave', path.basename(scenePath));
}

async function backup(dir: string, file: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, WORK_DIR, 'backups', stamp, path.relative(dir, file));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(file, dest);
}

export async function openProject(dirIn: string): Promise<OpenedProject> {
  let dir = path.resolve(dirIn);
  if (path.basename(dir) === PROJECT_FILE) dir = path.dirname(dir);
  const projFile = path.join(dir, PROJECT_FILE);
  if (!(await exists(projFile))) throw new ProjectError('This folder is not a CocoaWorlds project (no project.cwproj).');

  let parsed;
  try {
    parsed = parseProject(await fs.readFile(projFile, 'utf8'));
  } catch (e) {
    const err = e as Error & { problems?: { path: string; message: string }[] };
    throw new ProjectError(err.message, err.problems?.map((p) => `${p.path}: ${p.message}`));
  }
  const { project } = parsed;
  const scenePath = project.startScene;
  const sceneFile = resolveInside(dir, scenePath);
  if (!(await exists(sceneFile))) throw new ProjectError(`The start scene “${scenePath}” is missing.`);

  let sceneParsed;
  try {
    sceneParsed = parseScene(await fs.readFile(sceneFile, 'utf8'));
  } catch (e) {
    const err = e as Error & { problems?: { path: string; message: string }[] };
    throw new ProjectError(`${scenePath}: ${err.message}`, err.problems?.map((p) => `${p.path}: ${p.message}`));
  }

  const migrated = parsed.migrated || sceneParsed.migrated;
  if (parsed.migrated) {
    await backup(dir, projFile);
    await writeAtomic(projFile, stringify(project));
  }
  if (sceneParsed.migrated) {
    await backup(dir, sceneFile);
    await writeAtomic(sceneFile, stringify(sceneParsed.scene));
  }

  let recovery: OpenedProject['recovery'] = null;
  const auto = autosavePath(dir, scenePath);
  if (await exists(auto)) {
    const [a, s] = await Promise.all([fs.stat(auto), fs.stat(sceneFile)]);
    if (a.mtimeMs > s.mtimeMs) {
      try {
        const r = parseScene(await fs.readFile(auto, 'utf8'));
        recovery = { scene: r.scene, savedAt: a.mtime.toISOString() };
      } catch {
        // A damaged autosave is ignored; the saved scene is untouched.
      }
    }
  }
  return { dir, project, scenePath, scene: sceneParsed.scene, migrated, recovery };
}

function checkScene(scenePath: string, scene: unknown): SceneFile {
  if (!scenePath.endsWith(SCENE_EXT)) throw new ProjectError('Scenes must use the .cwscene extension.');
  const r = validateScene(scene);
  if (!r.ok) throw new ProjectError('The scene could not be saved because it is invalid.', r.problems.map((p) => `${p.path}: ${p.message}`));
  return r.value;
}

export async function saveScene(dir: string, scenePath: string, scene: unknown): Promise<{ savedAt: string }> {
  const valid = checkScene(scenePath, scene);
  await writeAtomic(resolveInside(dir, scenePath), stringify(valid));
  // The autosave is now older than (or equal to) the real file; remove it so it isn't offered again.
  await fs.rm(autosavePath(dir, scenePath), { force: true });
  return { savedAt: new Date().toISOString() };
}

export async function autosaveScene(dir: string, scenePath: string, scene: unknown): Promise<{ savedAt: string }> {
  const valid = checkScene(scenePath, scene);
  resolveInside(dir, scenePath);
  await writeAtomic(autosavePath(dir, scenePath), stringify(valid));
  return { savedAt: new Date().toISOString() };
}

export async function discardRecovery(dir: string, scenePath: string): Promise<void> {
  resolveInside(dir, scenePath);
  await fs.rm(autosavePath(dir, scenePath), { force: true });
}
