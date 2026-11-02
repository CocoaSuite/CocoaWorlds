/** Exposes the narrow `window.cocoa` API to the sandboxed editor UI. */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CocoaApi } from '../shared/api';

const api: CocoaApi = {
  platform: process.platform,
  versions: {
    app: process.env.npm_package_version ?? '0.1.0',
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
  },
  projects: {
    defaultLocation: () => ipcRenderer.invoke(IPC.defaultLocation),
    pickFolder: (title, defaultPath) => ipcRenderer.invoke(IPC.pickFolder, title, defaultPath),
    create: (parentDir, name) => ipcRenderer.invoke(IPC.create, parentDir, name),
    open: (dir, scenePath) => ipcRenderer.invoke(IPC.open, dir, scenePath),
    createScene: (dir, name) => ipcRenderer.invoke(IPC.createScene, dir, name),
    setStartScene: (dir, scenePath) => ipcRenderer.invoke(IPC.setStartScene, dir, scenePath),
    readScene: (dir, scenePath) => ipcRenderer.invoke(IPC.readScene, dir, scenePath),
    recent: () => ipcRenderer.invoke(IPC.recent),
    forget: (dir) => ipcRenderer.invoke(IPC.forget, dir),
    saveScene: (dir, scenePath, scene) => ipcRenderer.invoke(IPC.saveScene, dir, scenePath, scene),
    autosave: (dir, scenePath, scene) => ipcRenderer.invoke(IPC.autosave, dir, scenePath, scene),
    discardRecovery: (dir, scenePath) => ipcRenderer.invoke(IPC.discardRecovery, dir, scenePath),
    reveal: (dir) => ipcRenderer.invoke(IPC.reveal, dir),
    listPrefabs: (dir) => ipcRenderer.invoke(IPC.listPrefabs, dir),
    savePrefab: (dir, prefab, path) => ipcRenderer.invoke(IPC.savePrefab, dir, prefab, path),
    saveSettings: (dir, settings) => ipcRenderer.invoke(IPC.saveSettings, dir, settings),
    listAssets: (dir) => ipcRenderer.invoke(IPC.listAssets, dir),
    writeAsset: (dir, kind, name, bytes) => ipcRenderer.invoke(IPC.writeAsset, dir, kind, name, bytes),
    readAsset: (dir, path) => ipcRenderer.invoke(IPC.readAsset, dir, path),
    addSample: (dir, name) => ipcRenderer.invoke(IPC.addSample, dir, name),
  },
  game: {
    export: (dir, target) => ipcRenderer.invoke(IPC.exportGame, dir, target),
    reveal: (path) => ipcRenderer.invoke(IPC.revealGame, path),
    launch: (path) => ipcRenderer.invoke(IPC.launchGame, path),
    onProgress: (fn) => {
      const listener = (_e: unknown, text: string) => fn(text);
      ipcRenderer.on(IPC.exportProgress, listener);
      return () => ipcRenderer.removeListener(IPC.exportProgress, listener);
    },
  },
  window: {
    setTitle: (title) => ipcRenderer.send(IPC.setTitle, title),
    setDirty: (dirty) => ipcRenderer.send(IPC.setDirty, dirty),
    onSaveRequest: (fn) => {
      const listener = async (_e: unknown, id: string) => {
        let ok = false;
        try {
          ok = await fn();
        } finally {
          ipcRenderer.send(IPC.saveResponse, id, ok);
        }
      };
      ipcRenderer.on(IPC.saveRequest, listener);
      return () => ipcRenderer.removeListener(IPC.saveRequest, listener);
    },
  },
};

contextBridge.exposeInMainWorld('cocoa', api);
