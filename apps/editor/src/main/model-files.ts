/**
 * Models written outside the project: a `.glb` of selected brushes saved through a native dialog.
 * (Tests skip the dialog: CW_MODEL_EXPORT_DIR is where saves go.)
 */
import { app, dialog, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ProjectError } from './project-fs';

const MAX_BYTES = 512 * 1024 * 1024;

/** Save one `.glb` where the user says. Returns where, or null when cancelled. */
export async function saveModelFile(win: BrowserWindow | null, name: unknown, bytes: unknown): Promise<string | null> {
  if (typeof name !== 'string' || !/^[^\\/:*?"<>|\u0000-\u001f]{1,200}\.glb$/i.test(name) || name.startsWith('..')) throw new ProjectError('That is not a plain .glb file name.');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) throw new ProjectError('The model could not be saved.');
  let target = process.env.CW_MODEL_EXPORT_DIR ? path.join(process.env.CW_MODEL_EXPORT_DIR, name) : null;
  if (!target) {
    if (!win) return null;
    const r = await dialog.showSaveDialog(win, {
      title: 'Export as GLB',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'glTF binary', extensions: ['glb'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return target;
}
