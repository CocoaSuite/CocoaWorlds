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
    open: (dir) => ipcRenderer.invoke(IPC.open, dir),
    recent: () => ipcRenderer.invoke(IPC.recent),
    forget: (dir) => ipcRenderer.invoke(IPC.forget, dir),
    saveScene: (dir, scenePath, scene) => ipcRenderer.invoke(IPC.saveScene, dir, scenePath, scene),
    autosave: (dir, scenePath, scene) => ipcRenderer.invoke(IPC.autosave, dir, scenePath, scene),
    discardRecovery: (dir, scenePath) => ipcRenderer.invoke(IPC.discardRecovery, dir, scenePath),
    reveal: (dir) => ipcRenderer.invoke(IPC.reveal, dir),
    listPrefabs: (dir) => ipcRenderer.invoke(IPC.listPrefabs, dir),
    savePrefab: (dir, prefab, path) => ipcRenderer.invoke(IPC.savePrefab, dir, prefab, path),
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
