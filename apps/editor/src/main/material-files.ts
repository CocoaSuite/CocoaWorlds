/**
 * Material files outside the project: `.cocoamat` files saved and opened through native dialogs, and maps
 * written into a folder the user picked. The UI can only write into folders a dialog gave it in this session.
 * (Tests skip the dialogs: CW_MATERIAL_EXPORT_DIR is where saves go, CW_MATERIAL_IMPORT_FILE what opens.)
 */
import { app, dialog, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ProjectError } from './project-fs';

const MAX_BYTES = 512 * 1024 * 1024;
const picked = new Set<string>();
const bytesOk = (b: unknown): b is Uint8Array => b instanceof Uint8Array && b.byteLength <= MAX_BYTES;
const plainName = (n: unknown): string => {
  if (typeof n !== 'string' || !n || n.length > 200 || /[\\/:*?"<>|\u0000-\u001f]/.test(n) || n === '.' || n === '..') throw new ProjectError('That is not a plain file name.');
  return n;
};

function defaultDir(): string {
  return process.env.CW_MATERIAL_EXPORT_DIR ?? app.getPath('documents');
}

/** Save one `.cocoamat` where the user says. Returns where, or null when cancelled. */
export async function saveMaterialFile(win: BrowserWindow | null, name: unknown, bytes: unknown): Promise<string | null> {
  const file = plainName(name);
  if (!bytesOk(bytes)) throw new ProjectError('The material could not be saved.');
  let target = process.env.CW_MATERIAL_EXPORT_DIR ? path.join(process.env.CW_MATERIAL_EXPORT_DIR, file) : null;
  if (!target) {
    if (!win) return null;
    const r = await dialog.showSaveDialog(win, {
      title: 'Export material',
      defaultPath: path.join(defaultDir(), file),
      filters: [{ name: 'CocoaSuite material', extensions: ['cocoamat'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return target;
}

/** A folder to export into (remembered, so files can be written there). Null when cancelled. */
export async function pickExportFolder(win: BrowserWindow | null, title: unknown): Promise<string | null> {
  let dir = process.env.CW_MATERIAL_EXPORT_DIR ?? null;
  if (!dir) {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, { title: typeof title === 'string' ? title : 'Export to…', defaultPath: defaultDir(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    dir = r.filePaths[0];
  }
  dir = path.resolve(dir);
  await fs.mkdir(dir, { recursive: true });
  picked.add(dir);
  return dir;
}

/** Write files into a folder picked before. Returns their paths. */
export async function writeExportFiles(folder: unknown, files: unknown): Promise<string[]> {
  if (typeof folder !== 'string' || !picked.has(path.resolve(folder))) throw new ProjectError('That folder was not chosen for exporting.');
  if (!Array.isArray(files)) throw new ProjectError('Nothing to write.');
  const out: string[] = [];
  for (const f of files as { name?: unknown; bytes?: unknown }[]) {
    const name = plainName(f?.name);
    if (!bytesOk(f.bytes)) throw new ProjectError(`${name} could not be written.`);
    const full = path.join(path.resolve(folder), name);
    await fs.writeFile(full, f.bytes);
    out.push(full);
  }
  return out;
}

/** Pick `.cocoamat` files to import. Empty when cancelled. */
export async function openMaterialFiles(win: BrowserWindow | null): Promise<{ name: string; bytes: Uint8Array }[]> {
  let files: string[] = process.env.CW_MATERIAL_IMPORT_FILE ? process.env.CW_MATERIAL_IMPORT_FILE.split(path.delimiter) : [];
  if (!files.length) {
    if (!win) return [];
    const r = await dialog.showOpenDialog(win, { title: 'Import materials', defaultPath: defaultDir(), filters: [{ name: 'CocoaSuite material', extensions: ['cocoamat'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    files = r.filePaths;
  }
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (const f of files) {
    const st = await fs.stat(f);
    if (st.size > MAX_BYTES) throw new ProjectError(`${path.basename(f)} is too big.`);
    out.push({ name: path.basename(f), bytes: new Uint8Array(await fs.readFile(f)) });
  }
  return out;
}
