/**
 * Electron main process: windows, native dialogs and the project file system.
 * The UI runs sandboxed with context isolation; it reaches this process only through the IPC handlers below.
 */
import { BrowserWindow, Menu, app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { IPC, type Result } from '../shared/api';
import { listAssets, readAsset, writeAsset, addSample, librarySounds, readLibrarySound, addLibrarySound, trashAsset, restoreAsset, writeTerrain, readGraph, writeGraph, writeGenerated } from './assets-fs';
import { ProjectError, autosaveScene, createProject, discardRecovery, listPrefabs, openProject, savePrefab, saveProjectSettings, saveScene, createScene, setStartScene, readScene } from './project-fs';
import { SettingsStore } from './settings';
import { downloadRuntime, gameData, gameFileName, ownRuntime, writeDesktopGame, writeWebGame, type ExportTarget } from './export';
import { spawn } from 'node:child_process';
import { openMaterialFiles, pickExportFolder, saveMaterialFile, writeExportFiles } from './material-files';

if (process.env.CW_USER_DATA) app.setPath('userData', process.env.CW_USER_DATA);

const DEV_URL = process.env.CW_DEV_URL;
const isMac = process.platform === 'darwin';
let win: BrowserWindow | null = null;
let dirty = false;
let settings: SettingsStore;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#121212',
    title: 'CocoaWorlds',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Play mode starts sounds from game events, not from clicks.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.once('ready-to-show', () => win?.show());

  // The editor never navigates away or opens arbitrary windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (!dirty || !win) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', 'Don’t Save', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes before closing?',
      detail: 'Your changes will be lost if you don’t save them.',
    });
    if (choice === 2) return;
    if (choice === 1) {
      dirty = false;
      win.close();
      return;
    }
    requestSave().then((saved) => {
      if (saved && win) {
        dirty = false;
        win.close();
      }
    });
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function requestSave(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!win) return resolve(false);
    const id = String(Date.now());
    const handler = (_e: unknown, replyId: string, ok: boolean) => {
      if (replyId !== id) return;
      ipcMain.removeListener(IPC.saveResponse, handler);
      resolve(ok);
    };
    ipcMain.on(IPC.saveResponse, handler);
    win.webContents.send(IPC.saveRequest, id);
  });
}

/** Only accept calls from our own window. */
function trusted(e: IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents;
}

const str = (v: unknown): string => {
  if (typeof v !== 'string' || !v) throw new ProjectError('Invalid request.');
  return v;
};

function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T>): void {
  ipcMain.handle(channel, async (e, ...args): Promise<Result<T>> => {
    if (!trusted(e)) return { ok: false, error: 'Request rejected.' };
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      const pe = err as ProjectError;
      console.error(`[${channel}]`, err);
      return { ok: false, error: pe.message || 'Something went wrong.', details: pe.details };
    }
  });
}

/** Handlers that return plain values (no Result wrapper). */
function handleRaw<T>(channel: string, fn: (...args: unknown[]) => Promise<T>): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) throw new Error('Request rejected.');
    return fn(...args);
  });
}

/** Games exported in this session (only these can be shown or started from the UI). */
const exported = new Set<string>();

const TARGET_LABEL: Record<ExportTarget, string> = { web: 'Web', win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

function registerExport(): void {
  handle(IPC.exportGame, async (dirArg, targetArg) => {
    const dir = str(dirArg);
    const target = String(targetArg) as ExportTarget;
    if (!(target in TARGET_LABEL)) throw new Error('Unknown export target.');
    const say = (text: string) => win?.webContents.send(IPC.exportProgress, text);
    const { project } = await gameData(dir);
    let parent = process.env.CW_EXPORT_DIR ?? null;
    if (!parent) {
      if (!win) return null;
      const r = await dialog.showOpenDialog(win, {
        title: 'Export the game to…',
        defaultPath: path.join(app.getPath('documents'), 'CocoaWorlds Exports'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      parent = r.filePaths[0];
    }
    const folder = path.join(parent, `${gameFileName(project.name)} (${TARGET_LABEL[target]})`);
    const rendererDir = path.join(__dirname, '../renderer');
    let result;
    if (target === 'web') {
      say('Writing the web game…');
      result = await writeWebGame(dir, rendererDir, folder);
    } else {
      let runtime: string;
      if (target === process.platform) runtime = ownRuntime(process.execPath, process.platform);
      else {
        say(`Getting the ${TARGET_LABEL[target]} runtime (once, about 100 MB)…`);
        let shown = -1;
        runtime = await downloadRuntime(process.versions.electron, target, path.join(app.getPath('userData'), 'runtimes'), (f) => {
          const pct = Math.round(f * 100);
          if (pct !== shown) say(`Getting the ${TARGET_LABEL[target]} runtime… ${(shown = pct)}%`);
        });
      }
      say(`Writing the ${TARGET_LABEL[target]} game…`);
      result = await writeDesktopGame(dir, rendererDir, path.join(__dirname, 'game-shell.cjs'), runtime, target, folder);
    }
    exported.add(result.start);
    exported.add(result.folder);
    say('Done.');
    return result;
  });
  handleRaw(IPC.revealGame, async (p) => {
    if (exported.has(str(p))) shell.showItemInFolder(str(p));
  });
  handle(IPC.launchGame, async (p) => {
    const start = str(p);
    if (!exported.has(start)) throw new Error('That is not a game exported here.');
    const child = process.platform === 'darwin' ? spawn('open', [start], { detached: true, stdio: 'ignore' }) : spawn(start, [], { detached: true, stdio: 'ignore', cwd: path.dirname(start) });
    child.unref();
    return true as const;
  });
}

function registerIpc(): void {
  handleRaw(IPC.defaultLocation, async () => process.env.CW_PROJECTS_DIR ?? path.join(app.getPath('documents'), 'CocoaWorlds'));
  handleRaw(IPC.pickFolder, async (title, defaultPath) => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: typeof title === 'string' ? title : 'Choose folder',
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle(IPC.create, async (parent, name) => {
    const opened = await createProject(str(parent), str(name));
    await settings.touch(opened.project.name, opened.dir);
    return opened;
  });
  handle(IPC.open, async (dir, scene) => {
    const opened = await openProject(str(dir), typeof scene === 'string' ? scene : undefined);
    await settings.touch(opened.project.name, opened.dir);
    return opened;
  });
  handleRaw(IPC.recent, () => settings.recent());
  handleRaw(IPC.forget, async (dir) => settings.forget(str(dir)));
  handle(IPC.saveScene, async (dir, scenePath, scene) => saveScene(str(dir), str(scenePath), scene));
  handle(IPC.autosave, async (dir, scenePath, scene) => autosaveScene(str(dir), str(scenePath), scene));
  handle(IPC.listPrefabs, async (dir) => listPrefabs(str(dir)));
  handle(IPC.saveSettings, async (dir, settings) => saveProjectSettings(str(dir), settings));
  handle(IPC.createScene, async (dir, name) => createScene(str(dir), str(name)));
  handle(IPC.setStartScene, async (dir, scene) => setStartScene(str(dir), str(scene)));
  handle(IPC.readScene, async (dir, scene) => readScene(str(dir), str(scene)));
  handle(IPC.listAssets, async (dir) => listAssets(str(dir)));
  handle(IPC.writeAsset, async (dir, kind, name, bytes) => writeAsset(str(dir), kind, name, bytes));
  handle(IPC.readAsset, async (dir, rel) => readAsset(str(dir), rel));
  handle(IPC.addSample, async (dir, name) => addSample(str(dir), path.join(app.getAppPath(), 'samples'), name));
  handle(IPC.writeTerrain, async (dir, name, bytes) => writeTerrain(str(dir), name, bytes));
  handle(IPC.librarySounds, async () => librarySounds(path.join(app.getAppPath(), 'samples')));
  handle(IPC.readLibrarySound, async (p) => readLibrarySound(path.join(app.getAppPath(), 'samples'), p));
  handle(IPC.addLibrarySound, async (dir, p) => addLibrarySound(str(dir), path.join(app.getAppPath(), 'samples'), p));
  handle(IPC.trashAsset, async (dir, rel) => trashAsset(str(dir), rel));
  handle(IPC.restoreAsset, async (dir, t, rel) => restoreAsset(str(dir), t, rel));
  handle(IPC.readGraph, async (dir, rel) => readGraph(str(dir), rel));
  handle(IPC.writeGraph, async (dir, rel, graph, create) => writeGraph(str(dir), rel, graph, create));
  handle(IPC.writeGenerated, async (dir, name, bytes) => writeGenerated(str(dir), name, bytes));
  handle(IPC.saveMaterialFile, async (name, bytes) => saveMaterialFile(win, name, bytes));
  handle(IPC.pickExportFolder, async (title) => pickExportFolder(win, title));
  handle(IPC.writeExportFiles, async (folder, files) => writeExportFiles(folder, files));
  handle(IPC.openMaterialFiles, async () => openMaterialFiles(win));
  registerExport();
  handle(IPC.savePrefab, async (dir, prefab, rel) => savePrefab(str(dir), prefab, rel === undefined ? undefined : str(rel)));
  handleRaw(IPC.discardRecovery, async (dir, scenePath) => discardRecovery(str(dir), str(scenePath)));
  handleRaw(IPC.reveal, async (dir) => {
    await shell.openPath(str(dir));
  });
  ipcMain.on(IPC.setTitle, (e, title: unknown) => {
    if (win && e.sender === win.webContents && typeof title === 'string') win.setTitle(title.slice(0, 200));
  });
  ipcMain.on(IPC.setDirty, (e, d: unknown) => {
    if (win && e.sender === win.webContents) {
      dirty = d === true;
      win.setDocumentEdited(dirty);
    }
  });
}

function buildMenu(): void {
  // Menus live inside the window (CocoaCanvas style). macOS still needs an app menu for system shortcuts.
  if (isMac) {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }
}

app.whenReady().then(() => {
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
