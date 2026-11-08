/**
 * Exporting a game (B4): the scene and the assets it uses, with the player page, as a web folder (any web
 * server: itch.io, GitHub Pages …) or as a desktop game (the Electron runtime with the game inside, decision D9).
 *
 * A desktop game for this computer reuses the editor's own Electron, so it needs no download; for another
 * system (Windows, macOS, Linux) the Electron of the same version is downloaded once and cached.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { effectsOf, gameRules, materialsOf, plantsOf, validateProject, validateScene, type ProjectFile, type SceneFile } from '@cocoaworlds/core';

export type ExportTarget = 'web' | 'win32' | 'darwin' | 'linux';

export interface ExportResult {
  /** Where the game was written (a folder; for macOS, the folder holding the .app). */
  folder: string;
  /** The file that starts it (index.html, the program, or the .app). */
  start: string;
  bytes: number;
}

/** A file and folder name made of letters, digits, spaces, dashes and underscores. */
export function gameFileName(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return s || 'Game';
}

/** The project's game, as the player reads it (game/game.json). */
export async function gameData(projectDir: string): Promise<{ project: ProjectFile; data: object; scene: SceneFile }> {
  const projectRaw = JSON.parse(await fs.readFile(path.join(projectDir, 'project.cwproj'), 'utf8'));
  const pv = validateProject(projectRaw);
  if (!pv.ok) throw new Error(`The project file has problems: ${pv.problems[0]?.message}`);
  const project = pv.value;
  const scenePath = project.startScene ?? project.scenes?.[0];
  if (!scenePath) throw new Error('The project has no scene.');
  const sceneRaw = JSON.parse(await fs.readFile(path.join(projectDir, scenePath), 'utf8'));
  const sv = validateScene(sceneRaw);
  if (!sv.ok) throw new Error(`The scene has problems: ${sv.problems[0]?.message}`);
  const scene = sv.value;
  if (!scene.entities.some((e) => e.components.playerSpawn)) throw new Error('The scene needs a Player start to be played as a game.');
  // The other scenes, for level changes, by name (the file name without .cwscene).
  const stem = (p: string) => path.basename(p, '.cwscene');
  const scenes: Record<string, SceneFile> = { [stem(scenePath)]: scene };
  for (const p of project.scenes) {
    if (p === scenePath) continue;
    const raw = JSON.parse(await fs.readFile(path.join(projectDir, p), 'utf8').catch(() => 'null'));
    const v = raw ? validateScene(raw) : null;
    if (v?.ok) scenes[stem(p)] = v.value;
  }
  // Only the materials the scenes use (and so only their images).
  const sceneJson = JSON.stringify(scenes);
  const materials = materialsOf(project.settings).filter((m) => sceneJson.includes(`"${m.id}"`));
  const plants = plantsOf(project.settings).filter((p) => sceneJson.includes(`"${p.id}"`));
  return {
    project,
    scene,
    data: { format: 'cocoaworlds.game', name: project.name, id: project.id, scene, start: stem(scenePath), scenes, rules: gameRules(project.settings), values: project.settings.values ?? [], materials, plants, effects: effectsOf(project.settings).filter((x) => sceneJson.includes(`"${x.id}"`)), surfaceSounds: project.settings.surfaceSounds },
  };
}

/** Every project asset the game's data mentions (textures on faces, sounds, models, pictures on screen). */
export function usedAssets(json: string): string[] {
  return [...new Set(json.match(/assets\/(?:textures|sounds|models|terrain)\/[^"\\]+/g) ?? [])].sort();
}

/** The player page's files, from the build manifest: its script, the chunks it loads, and their styles. */
export async function playerFiles(rendererDir: string): Promise<string[]> {
  const manifest = JSON.parse(await fs.readFile(path.join(rendererDir, '.vite', 'manifest.json'), 'utf8')) as Record<
    string,
    { file: string; imports?: string[]; dynamicImports?: string[]; css?: string[]; assets?: string[]; isEntry?: boolean; src?: string }
  >;
  const entry = Object.keys(manifest).find((k) => k.endsWith('player.html'));
  if (!entry) throw new Error('This build of the editor has no game player.');
  const out = new Set<string>(['player.html']);
  const visit = (key: string) => {
    const m = manifest[key];
    if (!m || out.has(m.file)) return;
    out.add(m.file);
    for (const c of m.css ?? []) out.add(c);
    for (const a of m.assets ?? []) out.add(a);
    for (const i of [...(m.imports ?? []), ...(m.dynamicImports ?? [])]) visit(i);
  };
  visit(entry);
  return [...out];
}

async function copyFile(from: string, to: string): Promise<number> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return (await fs.stat(to)).size;
}

/** Copy a folder (keeping links and file modes: Electron's runtime needs both). Returns the bytes copied. */
async function copyDir(from: string, to: string, skip: (rel: string) => boolean = () => false, rel = ''): Promise<number> {
  await fs.mkdir(to, { recursive: true });
  let bytes = 0;
  for (const d of await fs.readdir(from, { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (skip(r)) continue;
    const a = path.join(from, d.name), b = path.join(to, d.name);
    if (d.isSymbolicLink()) await fs.symlink(await fs.readlink(a), b);
    else if (d.isDirectory()) bytes += await copyDir(a, b, skip, r);
    else {
      await fs.copyFile(a, b);
      await fs.chmod(b, (await fs.stat(a)).mode);
      bytes += (await fs.stat(b)).size;
    }
  }
  return bytes;
}

/** Write the web version of the game into `folder` (emptied first). */
export async function writeWebGame(projectDir: string, rendererDir: string, folder: string): Promise<ExportResult> {
  const { data } = await gameData(projectDir);
  const json = JSON.stringify(data);
  await fs.rm(folder, { recursive: true, force: true });
  await fs.mkdir(path.join(folder, 'game'), { recursive: true });
  let bytes = 0;
  for (const f of await playerFiles(rendererDir)) bytes += await copyFile(path.join(rendererDir, f), path.join(folder, f === 'player.html' ? 'index.html' : f));
  await fs.writeFile(path.join(folder, 'game', 'game.json'), json);
  bytes += json.length;
  for (const a of usedAssets(json)) {
    const src = path.join(projectDir, a);
    // (A missing file shows the “missing texture” look in the game, as it does in the editor.)
    bytes += await copyFile(src, path.join(folder, 'game', a)).catch(() => 0);
  }
  return { folder, start: path.join(folder, 'index.html'), bytes };
}

/** Where an Electron runtime's program and resources are, for a platform. */
function layout(target: Exclude<ExportTarget, 'web'>, root: string, exeName: string) {
  if (target === 'darwin') {
    const app = fs.readdir(root).then((names) => names.find((n) => n.endsWith('.app')));
    return { app, resources: async () => path.join(root, (await app)!, 'Contents', 'Resources') };
  }
  return { app: Promise.resolve(undefined), resources: async () => path.join(root, 'resources'), exe: path.join(root, exeName) };
}

/**
 * Write a desktop game: the Electron runtime (`runtime` folder: this editor's own, or a downloaded one), with
 * the game shell and the web game as its app, renamed after the game.
 */
export async function writeDesktopGame(
  projectDir: string,
  rendererDir: string,
  shellFile: string,
  runtime: string,
  target: Exclude<ExportTarget, 'web'>,
  folder: string,
): Promise<ExportResult> {
  const { project } = await gameData(projectDir);
  const name = gameFileName(project.name);
  await fs.rm(folder, { recursive: true, force: true });
  // The runtime without any app it carried (the editor's own, or Electron's default page).
  const skip = (rel: string) => /(^|\/)(app\.asar|app\.asar\.unpacked|app|default_app\.asar)$/.test(rel) && /resources\//i.test(rel);
  // (A macOS runtime may be the .app bundle itself: it goes inside the folder.)
  let bytes = runtime.endsWith('.app') ? await copyDir(runtime, path.join(folder, path.basename(runtime)), (rel) => skip(`x.app/${rel}`)) : await copyDir(runtime, folder, skip);
  const l = layout(target, folder, '');
  const resources = await l.resources();
  const appDir = path.join(resources, 'app');
  const web = await writeWebGame(projectDir, rendererDir, path.join(appDir, 'web'));
  bytes += web.bytes;
  await fs.copyFile(shellFile, path.join(appDir, 'main.cjs'));
  await fs.writeFile(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'game', productName: project.name, version: '1.0.0', main: 'main.cjs', private: true }, null, 2),
  );
  // Named after the game.
  let start: string;
  if (target === 'darwin') {
    const app = (await l.app)!;
    const renamed = `${name}.app`;
    if (app !== renamed) await fs.rename(path.join(folder, app), path.join(folder, renamed));
    start = path.join(folder, renamed);
  } else {
    const exe = (await fs.readdir(folder)).find((f) => (target === 'win32' ? /\.exe$/i.test(f) && !/crashpad|squirrel/i.test(f) : /^(electron|cocoaworlds)$/i.test(f)));
    if (!exe) throw new Error('The runtime has no program to start.');
    start = path.join(folder, target === 'win32' ? `${name}.exe` : name);
    await fs.rename(path.join(folder, exe), start);
  }
  return { folder, start, bytes };
}

/** This editor's Electron runtime: the folder its program runs from (on macOS, its .app bundle). */
export function ownRuntime(execPath: string, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return execPath.slice(0, execPath.indexOf('.app/') + 4);
  return path.dirname(execPath);
}

/** Download (once) and unpack the Electron runtime for another system. */
export async function downloadRuntime(version: string, target: Exclude<ExportTarget, 'web'>, cacheDir: string, onProgress?: (fraction: number) => void): Promise<string> {
  const dir = path.join(cacheDir, `electron-${version}-${target}-x64`);
  const ok = await fs
    .stat(path.join(dir, '.complete'))
    .then(() => true)
    .catch(() => false);
  if (ok) return dir;
  const { downloadArtifact } = await import('@electron/get');
  const zip = await downloadArtifact({
    version,
    platform: target,
    arch: 'x64',
    artifactName: 'electron',
    downloadOptions: onProgress ? { getProgressCallback: async (p: { percent: number }) => onProgress(p.percent) } : undefined,
  });
  const extract = (await import('extract-zip')).default;
  await fs.rm(dir, { recursive: true, force: true });
  await extract(zip, { dir });
  await fs.writeFile(path.join(dir, '.complete'), '');
  return dir;
}
