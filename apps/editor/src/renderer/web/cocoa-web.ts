/**
 * `window.cocoa` for the web build of Cocoa Materials: the same surface the desktop editor gets from Electron,
 * but backed by the browser. One project lives in IndexedDB (its settings, graphs and textures); exports are
 * downloads and imports come from a file picker. Calls the web build never makes fail with a plain message.
 */
import { newProject, type ProjectFile, type SceneFile } from '@cocoaworlds/core';
import type { AssetEntry, AssetKind, CocoaApi, OpenedProject, Result } from '../../shared/api';

export const WEB_DIR = 'web';
const DB = 'cocoa-materials';
const STORE = 'files';
const PROJECT_KEY = 'project.json';

const KINDS: Record<AssetKind, { dir: string; ext: string[] }> = {
  textures: { dir: 'assets/textures', ext: ['.png', '.jpg', '.jpeg', '.webp'] },
  sounds: { dir: 'assets/sounds', ext: ['.ogg', '.mp3', '.wav'] },
  models: { dir: 'assets/models', ext: ['.glb', '.gltf'] },
  fonts: { dir: 'assets/fonts', ext: ['.ttf', '.otf', '.woff', '.woff2'] },
};
const GRAPH_PATH = /^materials\/[\w-]+\.cwmat$/;

// ── Storage: everything is read into memory once; writes go to memory at once and to IndexedDB behind it. ──
const files = new Map<string, Uint8Array | string>();
let db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
function put(key: string, value: Uint8Array | string): void {
  files.set(key, value);
  if (!db) return;
  db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
}
function del(key: string): void {
  files.delete(key);
  if (!db) return;
  db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
}
async function loadAll(): Promise<void> {
  try {
    db = await openDb();
  } catch {
    db = null; // Private browsing and the like: works, but nothing is kept.
    return;
  }
  await new Promise<void>((ok) => {
    const tx = db!.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return ok();
      files.set(String(c.key), c.value as Uint8Array | string);
      c.continue();
    };
    req.onerror = () => ok();
  });
}

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const no = (error: string): Result<never> => ({ ok: false, error });
const notHere = async () => no('Not available in the web version.');

function safeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `${stem || 'file'}${ext}`;
}
const stemOf = (n: string) => n.replace(/\.[^.]+$/, '');
const bytesOf = (v: Uint8Array | string) => (typeof v === 'string' ? new TextEncoder().encode(v) : v);

/** Hand a file to the browser as a download. */
export function download(name: string, bytes: Uint8Array | Blob, type = 'application/octet-stream'): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Ask for files (must be called from a click). */
export function pickFiles(accept: string, multiple = true): Promise<{ name: string; bytes: Uint8Array }[]> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      const list = [...(input.files ?? [])];
      input.remove();
      done(await Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    };
    input.addEventListener('change', () => void finish());
    input.addEventListener('cancel', () => void finish());
    document.body.appendChild(input);
    input.click();
  });
}

function projectFile(): ProjectFile {
  const raw = files.get(PROJECT_KEY);
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as ProjectFile;
    } catch {
      /* damaged: start again */
    }
  }
  const p = newProject('Cocoa Materials').project;
  put(PROJECT_KEY, JSON.stringify(p));
  return p;
}

/** The project the web app works in (made on first visit). */
export function openedProject(): OpenedProject {
  const project = projectFile();
  const scene: SceneFile = newProject('Cocoa Materials').scenes[project.startScene] ?? Object.values(newProject('x').scenes)[0]!;
  return { dir: WEB_DIR, project, scenePath: project.startScene, scene, migrated: false, recovery: null };
}

function listAssets(): Record<AssetKind, AssetEntry[]> {
  const out = { textures: [], sounds: [], models: [], fonts: [] } as Record<AssetKind, AssetEntry[]>;
  for (const kind of Object.keys(KINDS) as AssetKind[]) {
    const { dir, ext } = KINDS[kind];
    for (const [key, v] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      if (!key.startsWith(`${dir}/`) || key.slice(dir.length + 1).includes('/')) continue;
      const name = key.slice(dir.length + 1);
      if (!ext.some((e) => name.toLowerCase().endsWith(e))) continue;
      out[kind].push({ path: key, name: stemOf(name), bytes: bytesOf(v).byteLength });
    }
  }
  return out;
}

export async function installWebCocoa(): Promise<void> {
  await loadAll();
  const api: CocoaApi = {
    platform: 'web',
    versions: { app: 'web', electron: '', chrome: navigator.userAgent },
    projects: {
      defaultLocation: async () => WEB_DIR,
      pickFolder: async () => null,
      create: notHere,
      open: async () => ok(openedProject()),
      createScene: notHere,
      setStartScene: notHere,
      readScene: notHere,
      recent: async () => [],
      forget: async () => {},
      saveScene: async () => ok({ savedAt: new Date().toISOString() }),
      autosave: async () => ok({ savedAt: new Date().toISOString() }),
      discardRecovery: async () => {},
      reveal: async () => {},
      listPrefabs: async () => ok({ prefabs: [], problems: [] }),
      savePrefab: notHere,
      saveSettings: async (_dir, settings) => {
        const p = { ...projectFile(), settings };
        put(PROJECT_KEY, JSON.stringify(p));
        return ok(p);
      },
      listAssets: async () => ok(listAssets()),
      writeAsset: async (_dir, kind, name, bytes) => {
        const k = KINDS[kind];
        if (!k) return no('Unknown kind of asset.');
        const safe = safeName(name);
        const ext = safe.slice(safe.lastIndexOf('.'));
        if (!k.ext.includes(ext)) return no(`${name} isn't a supported file (${k.ext.join(', ')}).`);
        let file = safe;
        for (let i = 2; files.has(`${k.dir}/${file}`); i++) file = `${stemOf(safe)}_${i}${ext}`;
        put(`${k.dir}/${file}`, bytes);
        return ok({ path: `${k.dir}/${file}`, name: stemOf(file), bytes: bytes.byteLength });
      },
      readAsset: async (_dir, path) => {
        const v = files.get(path);
        return v === undefined ? no(`${path} is missing.`) : ok(bytesOf(v));
      },
      addSample: notHere,
      writeTerrain: notHere,
      librarySounds: async () => ok([]),
      readLibrarySound: notHere,
      addLibrarySound: notHere,
      trashAsset: async (_dir, path) => {
        const v = files.get(path);
        if (v === undefined) return no(`${path} isn't there any more.`);
        const to = path.replace(/^assets\//, 'assets/_deleted/');
        put(to, v);
        del(path);
        return ok(to);
      },
      restoreAsset: async (_dir, trashed, path) => {
        const v = files.get(trashed);
        if (v === undefined) return no('That file is gone.');
        put(path, v);
        del(trashed);
        return ok(undefined);
      },
      readGraph: async (_dir, path) => {
        const v = files.get(path);
        if (typeof v !== 'string') return no(`The graph file ${path} is missing.`);
        try {
          return ok(JSON.parse(v) as unknown);
        } catch {
          return no(`The graph file ${path} is damaged (not valid JSON).`);
        }
      },
      writeGraph: async (_dir, path, graph, create) => {
        if (!GRAPH_PATH.test(path)) return no('That is not a graph file in the materials folder.');
        let file = path;
        if (create) {
          const stem = path.slice('materials/'.length, -'.cwmat'.length);
          for (let i = 2; files.has(file); i++) file = `materials/${stem}_${i}.cwmat`;
        }
        put(file, `${JSON.stringify(graph, null, 2)}\n`);
        return ok(file);
      },
      writeGenerated: async (_dir, name, bytes) => {
        if (!/^[\w-]+\.png$/.test(name)) return no('A baked map needs a plain .png name.');
        const rel = `${KINDS.textures.dir}/generated/${name}`;
        put(rel, bytes);
        return ok(rel);
      },
    },
    materials: {
      saveFile: async (name, bytes) => {
        download(name, bytes);
        return ok(name);
      },
      pickFolder: async () => ok('downloads'),
      writeFiles: async (_folder, list) => {
        for (const f of list) download(f.name, f.bytes);
        return ok(list.map((f) => f.name));
      },
      openFiles: async () => ok(await pickFiles('.cocoamat,application/zip')),
    },
    models: {
      saveFile: async (name, bytes) => {
        download(name, bytes);
        return ok(name);
      },
    },
    game: {
      export: notHere,
      reveal: async () => {},
      launch: notHere,
      onProgress: () => () => {},
    },
    window: {
      setTitle: () => void (document.title = 'Cocoa Materials'),
      setDirty: () => {},
      onSaveRequest: () => () => {},
    },
  };
  window.cocoa = api;
}
