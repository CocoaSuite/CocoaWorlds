/**
 * Making an exported desktop game its own program rather than a renamed Electron: its icon and names in the
 * Windows program file, the macOS bundle (Info.plist, helper apps, .icns), and the runtime's own notices
 * tucked into a licenses folder. No Electron APIs here: icon pictures arrive as PNGs already sized.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as ResEdit from 'resedit';

/** One square PNG of the game's icon. */
export interface IconPng {
  size: number;
  png: Buffer;
}

/** Sizes made for each system. */
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

/** A Windows .ico holding PNG pictures (Vista and later read PNG entries). Sizes above 256 are left out. */
export function icoFrom(pngs: IconPng[]): Buffer {
  const list = pngs.filter((p) => p.size <= 256).sort((a, b) => a.size - b.size);
  const head = Buffer.alloc(6 + 16 * list.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(list.length, 4);
  let offset = head.length;
  list.forEach((p, i) => {
    const o = 6 + i * 16;
    head.writeUInt8(p.size >= 256 ? 0 : p.size, o);
    head.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
    head.writeUInt8(0, o + 2);
    head.writeUInt8(0, o + 3);
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(p.png.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += p.png.length;
  });
  return Buffer.concat([head, ...list.map((p) => p.png)]);
}

/** A macOS .icns of PNG entries. */
export function icnsFrom(pngs: IconPng[]): Buffer {
  const type: Record<number, string[]> = { 16: ['icp4'], 32: ['icp5', 'ic11'], 64: ['icp6', 'ic12'], 128: ['ic07'], 256: ['ic08', 'ic13'], 512: ['ic09', 'ic14'], 1024: ['ic10'] };
  const parts: Buffer[] = [];
  for (const p of pngs)
    for (const t of type[p.size] ?? []) {
      const h = Buffer.alloc(8);
      h.write(t, 0, 'ascii');
      h.writeUInt32BE(p.png.length + 8, 4);
      parts.push(h, p.png);
    }
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.write('icns', 0, 'ascii');
  h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

/** Give a Windows program the game's icon and names (Task Manager, Explorer, file properties). */
export async function brandWindowsExe(exe: string, name: string, fileName: string, ico: Buffer | null): Promise<void> {
  const exeData = await fs.readFile(exe);
  const pe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(pe);
  if (ico) {
    const iconFile = ResEdit.Data.IconFile.from(ico);
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const id = groups[0]?.id ?? 1;
    const lang = groups[0]?.lang ?? 1033;
    // (Replaces the first group, the one Explorer shows; the others are removed with it.)
    res.entries = res.entries.filter((e) => e.type !== 14 && e.type !== 3);
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      id,
      lang,
      iconFile.icons.map((i) => i.data),
    );
  }
  const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  for (const vi of infos) {
    for (const l of vi.getAllLanguagesForStringValues()) {
      vi.setStringValues(l, {
        ProductName: name,
        FileDescription: name,
        InternalName: fileName,
        OriginalFilename: `${fileName}.exe`,
        CompanyName: name,
        LegalCopyright: '',
      });
    }
    vi.setFileVersion(1, 0, 0, 0);
    vi.setProductVersion(1, 0, 0, 0);
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(pe);
  await fs.writeFile(exe, Buffer.from(pe.generate()));
}

const plistKey = (plist: string, key: string): string | undefined => plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
const setPlist = (plist: string, key: string, value: string): string => {
  const esc = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  return re.test(plist) ? plist.replace(re, `$1${esc}$2`) : plist.replace(/<dict>/, `<dict>\n\t<key>${key}</key>\n\t<string>${esc}</string>`);
};

/**
 * Make a macOS .app the game's own: program, helper apps and bundle names after the game, its own bundle id
 * and icon. Returns nothing; the bundle stays where it is (already named after the game).
 */
export async function brandMacApp(app: string, name: string, bundleId: string, icns: Buffer | null): Promise<void> {
  const contents = path.join(app, 'Contents');
  const infoPath = path.join(contents, 'Info.plist');
  let info = await fs.readFile(infoPath, 'utf8');
  const oldExe = plistKey(info, 'CFBundleExecutable') ?? 'Electron';
  if (oldExe !== name) await fs.rename(path.join(contents, 'MacOS', oldExe), path.join(contents, 'MacOS', name));
  info = setPlist(info, 'CFBundleExecutable', name);
  info = setPlist(info, 'CFBundleName', name);
  info = setPlist(info, 'CFBundleDisplayName', name);
  info = setPlist(info, 'CFBundleIdentifier', bundleId);
  info = setPlist(info, 'CFBundleShortVersionString', '1.0.0');
  info = setPlist(info, 'CFBundleVersion', '1.0.0');
  if (icns) {
    const oldIcon = plistKey(info, 'CFBundleIconFile');
    if (oldIcon) await fs.rm(path.join(contents, 'Resources', oldIcon.endsWith('.icns') ? oldIcon : `${oldIcon}.icns`), { force: true });
    await fs.writeFile(path.join(contents, 'Resources', 'icon.icns'), icns);
    info = setPlist(info, 'CFBundleIconFile', 'icon.icns');
  }
  await fs.writeFile(infoPath, info);
  // Helper apps (GPU, Renderer, Plugin …): Electron finds them by the program's name, so they follow it.
  const frameworks = path.join(contents, 'Frameworks');
  for (const d of await fs.readdir(frameworks).catch(() => [] as string[])) {
    if (!d.startsWith(`${oldExe} Helper`) || !d.endsWith('.app')) continue;
    const helperName = name + d.slice(oldExe.length, -4);
    const from = path.join(frameworks, d);
    const to = path.join(frameworks, `${helperName}.app`);
    const hc = path.join(from, 'Contents');
    const hInfoPath = path.join(hc, 'Info.plist');
    let hInfo = await fs.readFile(hInfoPath, 'utf8');
    const hExe = plistKey(hInfo, 'CFBundleExecutable') ?? d.slice(0, -4);
    await fs.rename(path.join(hc, 'MacOS', hExe), path.join(hc, 'MacOS', helperName));
    hInfo = setPlist(hInfo, 'CFBundleExecutable', helperName);
    hInfo = setPlist(hInfo, 'CFBundleName', helperName);
    hInfo = setPlist(hInfo, 'CFBundleDisplayName', helperName);
    const hId = plistKey(hInfo, 'CFBundleIdentifier') ?? '';
    const suffix = hId.match(/\.helper.*$/)?.[0] ?? '.helper';
    hInfo = setPlist(hInfo, 'CFBundleIdentifier', bundleId + suffix);
    await fs.writeFile(hInfoPath, hInfo);
    await fs.rename(from, to);
  }
}

/** Electron's and Chromium's notices and its version file: kept (they must ship) but out of sight. */
export async function tuckLicenses(folder: string): Promise<void> {
  const dest = path.join(folder, 'licenses');
  for (const f of ['LICENSE', 'LICENSES.chromium.html', 'version']) {
    const from = path.join(folder, f);
    const ok = await fs
      .stat(from)
      .then(() => true)
      .catch(() => false);
    if (!ok) continue;
    if (f === 'version') {
      await fs.rm(from);
      continue;
    }
    await fs.mkdir(dest, { recursive: true });
    await fs.rename(from, path.join(dest, f === 'LICENSE' ? 'LICENSE.electron.txt' : f));
  }
}

/** A bundle id for a game: reverse-domain, letters and digits only. */
export function bundleIdOf(name: string, projectId: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'game';
  const tail = projectId.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 8);
  return `com.cocoaworlds.${slug}${tail ? `.${tail}` : ''}`;
}
