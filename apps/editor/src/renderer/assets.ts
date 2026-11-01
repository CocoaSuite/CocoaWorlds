/**
 * Project assets in the UI: their bytes come from the main process (the UI has no file access) and are turned
 * into blob URLs once per project, for images, sounds and models alike.
 */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
};

let projectDir: string | null = null;
/** Exported games read their assets from files beside them instead of through the editor. */
let reader: ((path: string) => Promise<ArrayBuffer>) | null = null;

export function setAssetReader(read: (path: string) => Promise<ArrayBuffer>): void {
  reader = read;
  urls.clear();
}
const urls = new Map<string, Promise<string>>();

/** The open project (assets are read from it). Changing project forgets every cached URL. */
export function setAssetProject(dir: string | null): void {
  if (dir === projectDir) return;
  projectDir = dir;
  for (const p of urls.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  urls.clear();
}

/** A blob URL for a project asset (`assets/textures/brick.png`). */
export function assetUrl(path: string): Promise<string> {
  let p = urls.get(path);
  if (!p) {
    const dir = projectDir;
    p = (async () => {
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const type = MIME[ext] ?? 'application/octet-stream';
      if (reader) return URL.createObjectURL(new Blob([await reader(path)], { type }));
      if (!dir) throw new Error('No project is open.');
      const r = await window.cocoa.projects.readAsset(dir, path);
      if (!r.ok) throw new Error(r.error);
      return URL.createObjectURL(new Blob([r.value as BlobPart], { type }));
    })();
    // A failed read is retried next time.
    p.catch(() => urls.delete(path));
    urls.set(path, p);
  }
  return p;
}

/** Forget one asset (after it changed on disk). */
export function forgetAsset(path: string): void {
  const p = urls.get(path);
  if (p) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  urls.delete(path);
}

export const isTexture = (material: string) => material.startsWith('assets/textures/');
