/**
 * The main process of an exported desktop game: one window playing the web game beside it (`web/`), served
 * from a private scheme so it behaves exactly as on a web server. Saved progress lives in the game's own
 * user-data folder (named after the game).
 */
import { BrowserWindow, Menu, app, net, protocol, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pkg = require('./package.json') as { productName?: string; name: string };
const title = pkg.productName ?? pkg.name;
app.setName(title);

protocol.registerSchemesAsPrivileged([{ scheme: 'game', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const root = path.join(__dirname, 'web');

app.whenReady().then(() => {
  protocol.handle('game', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(root, rel));
    // Only files of the game.
    if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#000000',
    title,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // F11: full screen.
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  void win.loadURL('game://app/index.html');
});

app.on('window-all-closed', () => app.quit());
