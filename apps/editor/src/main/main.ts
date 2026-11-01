/**
 * Electron main process: windows, native dialogs and the project file system.
 * The UI runs sandboxed with context isolation; it reaches this process only through the IPC handlers below.
 */
import { BrowserWindow, Menu, app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { IPC, type Result } from '../shared/api';
import { ProjectError, autosaveScene, createProject, discardRecovery, listPrefabs, openProject, savePrefab, saveProjectSettings, saveScene } from './project-fs';
import { SettingsStore } from './settings';

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
  handle(IPC.open, async (dir) => {
    const opened = await openProject(str(dir));
    await settings.touch(opened.project.name, opened.dir);
    return opened;
  });
  handleRaw(IPC.recent, () => settings.recent());
  handleRaw(IPC.forget, async (dir) => settings.forget(str(dir)));
  handle(IPC.saveScene, async (dir, scenePath, scene) => saveScene(str(dir), str(scenePath), scene));
  handle(IPC.autosave, async (dir, scenePath, scene) => autosaveScene(str(dir), str(scenePath), scene));
  handle(IPC.listPrefabs, async (dir) => listPrefabs(str(dir)));
  handle(IPC.saveSettings, async (dir, settings) => saveProjectSettings(str(dir), settings));
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
