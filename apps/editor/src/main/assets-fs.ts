/**
 * Project assets on disk: textures, sounds and models in `assets/<kind>/`. The UI sends the bytes of files the
 * user picked (it has no file-system access); they are copied in under a safe, unique name. Assets are
 * referenced by their project path (`assets/textures/brick.png`), so a level keeps working when the project
 * folder moves.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ProjectError, resolveInside, writeAtomic } from './project-fs';
import type { AssetEntry, AssetKind, LibrarySound } from '../shared/api';

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
const SAMPLES: Record<string, { file: string; as: string; kind: AssetKind }> = { chicken: { file: 'chicken.glb', as: 'chicken_rigged.glb', kind: 'models' } };

/**
 * Put a ready-made asset into the project (once: if it's there already, that one is used). `samplesDir` is the
 * folder the editor's samples ship in.
 */
export async function addSample(dir: string, samplesDir: string, name: unknown): Promise<AssetEntry> {
  const s = typeof name === 'string' ? SAMPLES[name] : undefined;
  if (!s) throw new ProjectError('There is no ready-made asset by that name.');
  return copyIn(dir, ASSET_KINDS[s.kind].dir, s.as, await fs.readFile(path.join(samplesDir, s.file)));
}

/**
 * Put a file the editor ships with into the project as `sub/as`. The same file there already is used again; a
 * different file of that name (the user's own) is left alone and this one gets a number.
 */
async function copyIn(dir: string, sub: string, as: string, src: Buffer): Promise<AssetEntry> {
  const ext = path.extname(as), stem = path.basename(as, ext);
  for (let i = 1; ; i++) {
    const name = i === 1 ? as : `${stem}_${i}${ext}`;
    const rel = `${sub}/${name}`;
    const to = resolveInside(dir, rel);
    const have = await fs.readFile(to).catch(() => null);
    if (have && !have.equals(src)) continue;
    if (!have) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, src);
    }
    return { path: rel, name: path.basename(name, ext), bytes: src.length };
  }
}

// ── The sound library (shipped in samples/sounds, one folder per kind of sound) ──

const LIBRARY_EXT = ['.ogg', '.mp3', '.wav'];

/** Every sound in the library, by folder (its top folder: `Footsteps/digital/…` is in Footsteps). */
export async function librarySounds(samplesDir: string): Promise<LibrarySound[]> {
  const root = path.join(samplesDir, 'sounds');
  const out: LibrarySound[] = [];
  const walk = async (rel: string): Promise<void> => {
    const names = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const d of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await walk(r);
      else if (rel && LIBRARY_EXT.includes(path.extname(d.name).toLowerCase())) {
        const st = await fs.stat(path.join(root, r));
        out.push({ path: r, name: path.basename(d.name, path.extname(d.name)), group: rel.split('/')[0]!, bytes: st.size });
      }
    }
  };
  await walk('');
  return out;
}

/** A library sound's file, only from inside the library. */
function libraryFile(samplesDir: string, rel: unknown): string {
  if (typeof rel !== 'string' || !LIBRARY_EXT.includes(path.extname(rel).toLowerCase())) throw new ProjectError('That is not a sound in the library.');
  const root = path.resolve(samplesDir, 'sounds');
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new ProjectError('That is not a sound in the library.');
  return full;
}

export async function readLibrarySound(samplesDir: string, rel: unknown): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(libraryFile(samplesDir, rel)));
}

/** Copy a library sound into the project's sounds (kept by its own name, e.g. `assets/sounds/foley_creak_1.ogg`). */
export async function addLibrarySound(dir: string, samplesDir: string, rel: unknown): Promise<AssetEntry> {
  const file = libraryFile(samplesDir, rel);
  return copyIn(dir, ASSET_KINDS.sounds.dir, safeName(path.basename(file)), await fs.readFile(file));
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

// ── Cocoa Materials (decision C3) ──

const GRAPH_PATH = /^materials\/[\w-]+\.cwmat$/;

/** A graph material's graph file, as it is on disk (checked by the UI, which knows the node set). */
export async function readGraph(dir: string, rel: unknown): Promise<unknown> {
  if (typeof rel !== 'string' || !GRAPH_PATH.test(rel)) throw new ProjectError('That is not a graph file in the materials folder.');
  const text = await fs.readFile(resolveInside(dir, rel), 'utf8').catch(() => {
    throw new ProjectError(`The graph file ${rel} is missing.`);
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new ProjectError(`The graph file ${rel} is damaged (not valid JSON).`);
  }
}

/** Save a graph. With `create`, a new file named after `rel` (renamed if that name is taken). Returns its path. */
export async function writeGraph(dir: string, rel: unknown, graph: unknown, create: unknown): Promise<string> {
  if (typeof rel !== 'string' || !GRAPH_PATH.test(rel)) throw new ProjectError('That is not a graph file in the materials folder.');
  const g = graph as { format?: unknown; nodes?: unknown; links?: unknown };
  if (!g || g.format !== 'cocoaworlds.material' || !Array.isArray(g.nodes) || !Array.isArray(g.links)) throw new ProjectError('That is not a Cocoa Materials graph.');
  let file = rel;
  if (create === true) {
    const stem = rel.slice('materials/'.length, -'.cwmat'.length);
    for (let i = 2; await exists(resolveInside(dir, file)); i++) file = `materials/${stem}_${i}.cwmat`;
  }
  const full = resolveInside(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await writeAtomic(full, `${JSON.stringify(graph, null, 2)}\n`);
  return file;
}

/** A map baked from a graph: `assets/textures/generated/<name>.png`, replacing the one before. */
export async function writeGenerated(dir: string, name: unknown, bytes: unknown): Promise<string> {
  if (typeof name !== 'string' || !/^[\w-]+\.png$/.test(name)) throw new ProjectError('A baked map needs a plain .png name.');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ASSET_BYTES) throw new ProjectError('The baked map could not be saved.');
  const rel = `${ASSET_KINDS.textures.dir}/generated/${name}`;
  const full = resolveInside(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
  return rel;
}
