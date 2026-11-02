/**
 * The only surface the editor UI has onto the computer. Exposed by the preload script as `window.cocoa`.
 * The renderer never gets Node.js or direct file-system access.
 */
import type { PrefabFile, ProjectFile, SceneFile } from '@cocoaworlds/core';

export interface RecentProject {
  name: string;
  dir: string;
  openedAt: string;
}

export interface OpenedProject {
  dir: string;
  project: ProjectFile;
  scenePath: string;
  scene: SceneFile;
  /** True when the files were upgraded from an older format (a backup was written). */
  migrated: boolean;
  /** An autosave newer than the saved scene, offered for recovery. Never applied automatically. */
  recovery: { scene: SceneFile; savedAt: string } | null;
}

export interface PrefabEntry {
  /** Project-relative path, e.g. `prefabs/lamp.cwprefab`. */
  path: string;
  prefab: PrefabFile;
}

export type AssetKind = 'textures' | 'sounds' | 'models';

export interface AssetEntry {
  /** Project-relative path, e.g. `assets/textures/brick.png`. */
  path: string;
  /** File name without its extension. */
  name: string;
  bytes: number;
}

/** A sound in the editor's own library: its path in the library (`Footsteps/foley_creak_1.ogg`) and folder. */
export interface LibrarySound {
  path: string;
  name: string;
  /** The library folder it's in (`Footsteps`). */
  group: string;
  bytes: number;
}

export type ExportTarget = 'web' | 'win32' | 'darwin' | 'linux';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; details?: string[] };

export interface CocoaApi {
  platform: 'win32' | 'darwin' | 'linux' | string;
  versions: { app: string; electron: string; chrome: string };
  projects: {
    defaultLocation(): Promise<string>;
    pickFolder(title: string, defaultPath?: string): Promise<string | null>;
    create(parentDir: string, name: string): Promise<Result<OpenedProject>>;
    /** Open a project at its start scene, or at one of its scenes. */
    open(dir: string, scenePath?: string): Promise<Result<OpenedProject>>;
    /** Add a scene to the project; returns the project as written and the new scene's path. */
    createScene(dir: string, name: string): Promise<Result<{ project: ProjectFile; scenePath: string }>>;
    setStartScene(dir: string, scenePath: string): Promise<Result<ProjectFile>>;
    /** A scene as saved (for level changes while playing in the editor). */
    readScene(dir: string, scenePath: string): Promise<Result<SceneFile>>;
    recent(): Promise<RecentProject[]>;
    forget(dir: string): Promise<void>;
    saveScene(dir: string, scenePath: string, scene: SceneFile): Promise<Result<{ savedAt: string }>>;
    autosave(dir: string, scenePath: string, scene: SceneFile): Promise<Result<{ savedAt: string }>>;
    discardRecovery(dir: string, scenePath: string): Promise<void>;
    reveal(dir: string): Promise<void>;
    listPrefabs(dir: string): Promise<Result<{ prefabs: PrefabEntry[]; problems: string[] }>>;
    savePrefab(dir: string, prefab: PrefabFile, path?: string): Promise<Result<{ path: string }>>;
    /** Save the project's settings; returns the project as written. */
    saveSettings(dir: string, settings: ProjectFile['settings']): Promise<Result<ProjectFile>>;
    listAssets(dir: string): Promise<Result<Record<AssetKind, AssetEntry[]>>>;
    /** Copy a file the user picked into the project's assets. */
    writeAsset(dir: string, kind: AssetKind, name: string, bytes: Uint8Array): Promise<Result<AssetEntry>>;
    readAsset(dir: string, path: string): Promise<Result<Uint8Array>>;
    /** Put a ready-made asset the editor ships with (“chicken”) into the project's assets, once. */
    addSample(dir: string, name: string): Promise<Result<AssetEntry>>;
    /** The sound library that ships with the editor: every sound, by folder. */
    librarySounds(): Promise<Result<LibrarySound[]>>;
    /** A library sound's bytes (to listen to it before using it). */
    readLibrarySound(path: string): Promise<Result<Uint8Array>>;
    /** Copy a library sound into the project's sounds (once: the same file there already is used again). */
    addLibrarySound(dir: string, path: string): Promise<Result<AssetEntry>>;
    /** A graph material's graph (`materials/….cwmat`), unchecked. */
    readGraph(dir: string, path: string): Promise<Result<unknown>>;
    /** Save a graph; with `create`, as a new file (renamed if taken). Returns its path. */
    writeGraph(dir: string, path: string, graph: unknown, create?: boolean): Promise<Result<string>>;
    /** Save a map baked from a graph as `assets/textures/generated/<name>`. Returns its path. */
    writeGenerated(dir: string, name: string, bytes: Uint8Array): Promise<Result<string>>;
  };
  game: {
    /**
     * Export the project's game (saved files) for a target: asks where (unless a folder is given in tests),
     * reports progress, and returns where it was written.
     */
    export(dir: string, target: ExportTarget): Promise<Result<{ folder: string; start: string; bytes: number } | null>>;
    /** Show an exported game in the file manager, or start a desktop game built for this computer. */
    reveal(path: string): Promise<void>;
    launch(path: string): Promise<Result<true>>;
    onProgress(fn: (text: string) => void): () => void;
  };
  window: {
    setTitle(title: string): void;
    setDirty(dirty: boolean): void;
    /** Main asks the UI to save before closing; resolve true when saved. */
    onSaveRequest(fn: () => Promise<boolean>): () => void;
  };
}

export const IPC = {
  defaultLocation: 'projects:defaultLocation',
  pickFolder: 'projects:pickFolder',
  create: 'projects:create',
  open: 'projects:open',
  recent: 'projects:recent',
  forget: 'projects:forget',
  saveScene: 'projects:saveScene',
  autosave: 'projects:autosave',
  discardRecovery: 'projects:discardRecovery',
  reveal: 'projects:reveal',
  listPrefabs: 'projects:listPrefabs',
  savePrefab: 'projects:savePrefab',
  saveSettings: 'projects:saveSettings',
  createScene: 'projects:createScene',
  setStartScene: 'projects:setStartScene',
  readScene: 'projects:readScene',
  listAssets: 'assets:list',
  writeAsset: 'assets:write',
  readAsset: 'assets:read',
  addSample: 'assets:addSample',
  librarySounds: 'assets:librarySounds',
  readLibrarySound: 'assets:readLibrarySound',
  addLibrarySound: 'assets:addLibrarySound',
  readGraph: 'materials:readGraph',
  writeGraph: 'materials:writeGraph',
  writeGenerated: 'materials:writeGenerated',
  exportGame: 'game:export',
  exportProgress: 'game:exportProgress',
  revealGame: 'game:reveal',
  launchGame: 'game:launch',
  setTitle: 'window:setTitle',
  setDirty: 'window:setDirty',
  saveRequest: 'window:saveRequest',
  saveResponse: 'window:saveResponse',
} as const;
