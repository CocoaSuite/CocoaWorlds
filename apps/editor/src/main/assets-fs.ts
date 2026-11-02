/**
 * Project assets on disk: textures, sounds and models in `assets/<kind>/`. The UI sends the bytes of files the
 * user picked (it has no file-system access); they are copied in under a safe, unique name. Assets are
 * referenced by their project path (`assets/textures/brick.png`), so a level keeps working when the project
 * folder moves.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ProjectError, resolveInside } from './project-fs';
import type { AssetEntry, AssetKind } from '../shared/api';

export const ASSET_KINDS: Record<AssetKind, { dir: string; ext: string[] }> = {
  textures: { dir: 'assets/textures', ext: ['.png', '.jpg', '.jpeg', '.webp'] },
  sounds: { dir: 'assets/sounds', ext: ['.ogg', '.mp3', '.wav'] },
  models: { dir: 'assets/models', ext: ['.glb', '.gltf'] },
};

/** Largest single asset accepted (bytes). */
export const MAX_ASSET_BYTES = 64 * 1024 * 1024;

const isKind = (k: unknown): k is AssetKind => typeof k === 'string' && k in ASSET_KINDS;

/** Every asset of every kind, sorted by name. Missing folders are simply empty. */
export async function listAssets(dir: string): Promise<Record<AssetKind, AssetEntry[]>> {
  const out = { textures: [], sounds: [], models: [] } as Record<AssetKind, AssetEntry[]>;
  for (const kind of Object.keys(ASSET_KINDS) as AssetKind[]) {
    const { dir: sub, ext } = ASSET_KINDS[kind];
    const folder = resolveInside(dir, sub);
    const names = await fs.readdir(folder).catch(() => [] as string[]);
    for (const n of names.sort()) {
      if (!ext.includes(path.extname(n).toLowerCase())) continue;
      const st = await fs.stat(path.join(folder, n)).catch(() => null);
      if (st?.isFile()) out[kind].push({ path: `${sub}/${n}`, name: path.basename(n, path.extname(n)), bytes: st.size });
    }
  }
  return out;
}

/** A file name that is safe on every system: lower case letters, digits, dashes and underscores. */
export function safeName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const stem = path
    .basename(name, path.extname(name))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `${stem || 'asset'}${ext}`;
}

/** Copy one picked file into the project. Returns its project path (renamed if the name is taken). */
export async function writeAsset(dir: string, kind: unknown, name: unknown, bytes: unknown): Promise<AssetEntry> {
  if (!isKind(kind)) throw new ProjectError('Unknown kind of asset.');
  if (typeof name !== 'string' || !name) throw new ProjectError('The file needs a name.');
  if (!(bytes instanceof Uint8Array)) throw new ProjectError('The file could not be read.');
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new ProjectError(`${name} is larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
  const { dir: sub, ext } = ASSET_KINDS[kind];
  const safe = safeName(name);
  const e = path.extname(safe);
  if (!ext.includes(e)) throw new ProjectError(`${name} isn't a supported ${kind.slice(0, -1)} file (${ext.join(', ')}).`);
  const folder = resolveInside(dir, sub);
  await fs.mkdir(folder, { recursive: true });
  let file = safe;
  for (let i = 2; await exists(path.join(folder, file)); i++) file = `${path.basename(safe, e)}_${i}${e}`;
  await fs.writeFile(path.join(folder, file), bytes);
  return { path: `${sub}/${file}`, name: path.basename(file, e), bytes: bytes.byteLength };
}

/** Ready-made assets the editor ships with (Add › Chicken), by name: where they come from and where they go. */
const SAMPLES: Record<string, { file: string; kind: AssetKind }> = { chicken: { file: 'chicken.glb', kind: 'models' } };

/**
 * Put a ready-made asset into the project (once: if it's there already, that one is used). `samplesDir` is the
 * folder the editor's samples ship in.
 */
export async function addSample(dir: string, samplesDir: string, name: unknown): Promise<AssetEntry> {
  const s = typeof name === 'string' ? SAMPLES[name] : undefined;
  if (!s) throw new ProjectError('There is no ready-made asset by that name.');
  const { dir: sub } = ASSET_KINDS[s.kind];
  const rel = `${sub}/${s.file}`;
  const to = resolveInside(dir, rel);
  if (!(await exists(to))) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(path.join(samplesDir, s.file), to);
  }
  const st = await fs.stat(to);
  return { path: rel, name: path.basename(s.file, path.extname(s.file)), bytes: st.size };
}

/** The bytes of an asset (only files inside the project's assets folder). */
export async function readAsset(dir: string, rel: unknown): Promise<Uint8Array> {
  if (typeof rel !== 'string' || !rel.startsWith('assets/')) throw new ProjectError('Only files in the assets folder can be read.');
  const full = resolveInside(dir, rel);
  return new Uint8Array(await fs.readFile(full));
}

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(
    () => true,
    () => false,
  );
}
