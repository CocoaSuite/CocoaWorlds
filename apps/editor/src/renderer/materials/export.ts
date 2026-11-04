/**
 * Materials out of and into the project: `.cocoamat` files (docs/cocoamat-format.md) for CocoaSurface, plain
 * images (section 10) for other tools, and `.cocoamat` import.
 */
import { MAP_FIELDS, newMaterial, type MaterialDef } from '@cocoaworlds/core';
import {
  GraphEvaluator,
  OUTPUT_ROLES,
  catalogFor,
  changedNodes,
  channelsOf,
  encodePng,
  evaluable,
  fileStem,
  graphForExport,
  imageNames,
  imagesUsed,
  manifestOf,
  materialOf,
  nodeDef,
  outputNodes,
  readCocoaMat,
  withOverrides,
  writeCocoaMat,
  type CocoaMat,
  type MatGraph,
  type OutputRole,
} from '@cocoaworlds/materials';
import { useEditor } from '../store';
import { bakeLater, context, graphPathFor, loadBitmap, loadGraph, useGraphs } from './graphs';

/** Maps that are pictures of values (one channel), not colours. */
const GREY: ReadonlySet<OutputRole> = new Set(['height', 'roughness', 'metalness', 'occlusion', 'opacity', 'wearRoughness', 'wearMetal', 'wearNoise']);

type Loader = (path: string) => Promise<ImageBitmap>;

/** Evaluate a graph at `size`: each map's RGBA bytes, top row first (spec 5.4). */
export async function evaluateRoles(g: MatGraph, size: number, load: Loader = loadBitmap): Promise<Map<OutputRole, Uint8Array>> {
  const cache = new Map<string, Promise<ImageBitmap>>();
  const get = (p: string) => {
    if (!cache.has(p)) cache.set(p, load(p));
    return cache.get(p)!;
  };
  await Promise.all(imagesUsed(g).map((p) => get(p).catch(() => null)));
  const ev = new GraphEvaluator(context(), { loadImage: get });
  try {
    ev.evaluate(g, size);
    // (Images arrive a moment after they are asked for.)
    await new Promise((r) => setTimeout(r, 0));
    ev.evaluate(g, size);
    const out = new Map<OutputRole, Uint8Array>();
    for (const [role, n] of outputNodes(g)) {
      const px = ev.read(n.id);
      if (px) out.set(role, px);
    }
    return out;
  } finally {
    ev.dispose();
  }
}

/** A map as an 8-bit PNG: grey for value maps, RGB otherwise (spec 7). */
export const mapPng = (role: OutputRole | 'orm', px: Uint8Array, size: number) => {
  const ch = role !== 'orm' && GREY.has(role) ? 1 : 3;
  return encodePng(size, size, ch, channelsOf(px, ch));
};

async function decode(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

/** An image's RGBA bytes, drawn at `w` × `h` (its own size when not given). */
function pixelsOf(img: ImageBitmap, w = img.width, h = img.height): Uint8Array {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return new Uint8Array(g.getImageData(0, 0, w, h).data.buffer);
}

const isWebp = (p: string) => /\.webp$/i.test(p);

/** A material's `.cocoamat` (graph materials only). `readImage` gets a project image's bytes. */
export async function buildCocoaMat(
  m: MaterialDef,
  g: MatGraph,
  opts: { readImage: (path: string) => Promise<Uint8Array>; load?: Loader; baked?: boolean; generator?: string; created?: string },
): Promise<Uint8Array> {
  const paths = imageNames(imagesUsed(g, m.overrides));
  const images = new Map<string, Uint8Array>();
  for (const [from, to] of paths) {
    let bytes = await opts.readImage(from);
    if (isWebp(from)) {
      const img = await decode(bytes);
      bytes = await encodePng(img.width, img.height, 4, pixelsOf(img));
      img.close();
    }
    images.set(to, bytes);
  }
  const size = m.bakeSize ?? 512;
  const baked = new Map<OutputRole, Uint8Array>();
  if (opts.baked !== false) for (const [role, px] of await evaluateRoles(withOverrides(g, m.overrides), size, opts.load)) baked.set(role, await mapPng(role, px, size));
  return writeCocoaMat({
    manifest: manifestOf(m, g, { generator: opts.generator ?? `CocoaWorlds ${window.cocoa?.versions.app ?? ''}`.trim(), created: opts.created, paths, baked: { size, roles: [...baked.keys()] } }),
    graph: graphForExport(g, paths),
    nodes: catalogFor(g),
    images,
    baked,
  });
}

async function graphOf(m: MaterialDef): Promise<MatGraph | null> {
  if (!m.graph) return null;
  await loadGraph(m.graph);
  return useGraphs.getState().graphs[m.graph] ?? null;
}

const projectReader = (dir: string) => async (p: string) => {
  const r = await window.cocoa.projects.readAsset(dir, p);
  if (!r.ok) throw new Error(`${p}: ${r.error}`);
  return r.value;
};

/** Names in a folder made unique. */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const i = (seen.get(k) ?? 0) + 1;
    seen.set(k, i);
    return i === 1 ? n : n.replace(/(\.[^.]+)$/, ` ${i}$1`);
  });
}

/**
 * Export graph materials as `.cocoamat`: one through a save dialog, several into a chosen folder. Returns the
 * files written (empty when cancelled).
 */
export async function exportCocoaMats(ms: MaterialDef[]): Promise<string[]> {
  const dir = useEditor.getState().session?.dir;
  const list = ms.filter((m) => m.graph);
  if (!dir || !list.length) return [];
  const files: { name: string; bytes: Uint8Array }[] = [];
  const names = uniqueNames(list.map((m) => `${fileStem(m.name)}.cocoamat`));
  let folder: string | null = null;
  if (list.length > 1) {
    const r = await window.cocoa.materials.pickFolder('Export materials to…');
    if (!r.ok) throw new Error(r.error);
    if (!r.value) return [];
    folder = r.value;
  }
  for (const [i, m] of list.entries()) {
    const g = await graphOf(m);
    if (!g) throw new Error(`${m.name}: its graph could not be read.`);
    files.push({ name: names[i]!, bytes: await buildCocoaMat(m, g, { readImage: projectReader(dir) }) });
  }
  if (!folder) {
    const r = await window.cocoa.materials.saveFile(files[0]!.name, files[0]!.bytes);
    if (!r.ok) throw new Error(r.error);
    return r.value ? [r.value] : [];
  }
  const r = await window.cocoa.materials.writeFiles(folder, files);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

export interface ImageOptions {
  size: number;
  green: 'down' | 'up';
  /** Occlusion, roughness and metal in one picture (R, G, B). */
  orm: boolean;
  /** Which maps (all when not given). */
  roles?: OutputRole[];
}

const EMPTY: MatGraph = { format: 'cocoaworlds.material', version: 1, nodes: [], links: [] };

/** A material's maps at `size`, from its graph or its images (RGBA, top row first). */
export async function mapsOf(m: MaterialDef, size: number, opts: { graph?: MatGraph | null; load?: Loader; readImage?: (p: string) => Promise<Uint8Array> } = {}): Promise<Map<OutputRole, Uint8Array>> {
  const g = opts.graph === undefined ? await graphOf(m) : opts.graph;
  if (m.graph && g) return evaluateRoles(withOverrides(g, m.overrides), size, opts.load);
  const read = opts.readImage ?? projectReader(useEditor.getState().session!.dir);
  const out = new Map<OutputRole, Uint8Array>();
  for (const role of OUTPUT_ROLES) {
    const p = m[MAP_FIELDS[role]] as string | undefined;
    if (!p) continue;
    const img = await decode(await read(p));
    out.set(role, pixelsOf(img, size, size));
    img.close();
  }
  return out;
}

/** The files of a bitmap export (spec section 10). */
export async function imageFiles(m: MaterialDef, opts: ImageOptions, src: Parameters<typeof mapsOf>[2] = {}): Promise<{ name: string; bytes: Uint8Array }[]> {
  const n = opts.size;
  const g = src.graph === undefined ? await graphOf(m) : src.graph;
  const maps = await mapsOf(m, n, { ...src, graph: g });
  const stem = fileStem(m.name);
  const want = (r: OutputRole) => !opts.roles || opts.roles.includes(r);
  const files: { name: string; bytes: Uint8Array }[] = [];
  // (Only a graph's own normals are known to point down; an image's are left as they are.)
  const normal = maps.get('normal');
  if (normal && opts.green === 'up' && m.graph) for (let i = 1; i < normal.length; i += 4) normal[i] = 255 - normal[i]!;
  const packed: OutputRole[] = opts.orm ? ['occlusion', 'roughness', 'metalness'] : [];
  for (const [role, px] of maps) if (want(role) && !packed.includes(role)) files.push({ name: `${stem}_${role}.png`, bytes: await mapPng(role, px, n) });
  if (opts.orm) {
    const o = maps.get('occlusion'), r = maps.get('roughness'), mt = maps.get('metalness');
    const px = new Uint8Array(n * n * 4);
    const rv = Math.round(m.roughness * 255), mv = Math.round(m.metalness * 255);
    for (let i = 0; i < n * n; i++) {
      px[i * 4] = o ? o[i * 4]! : 255;
      px[i * 4 + 1] = r ? r[i * 4]! : rv;
      px[i * 4 + 2] = mt ? mt[i * 4]! : mv;
      px[i * 4 + 3] = 255;
    }
    files.push({ name: `${stem}_orm.png`, bytes: await mapPng('orm', px, n) });
  }
  const manifest = manifestOf(m, g ?? EMPTY, { generator: `CocoaWorlds ${window.cocoa?.versions.app ?? ''}`.trim() });
  manifest.normalGreen = opts.green;
  manifest.evaluation.size = n;
  files.push({ name: `${stem}.material.json`, bytes: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`) });
  return files;
}

/** Export materials as images into a chosen folder. Returns the files written (empty when cancelled). */
export async function exportImages(ms: MaterialDef[], opts: ImageOptions): Promise<string[]> {
  if (!ms.length) return [];
  const r = await window.cocoa.materials.pickFolder('Export images to…');
  if (!r.ok) throw new Error(r.error);
  if (!r.value) return [];
  const files: { name: string; bytes: Uint8Array }[] = [];
  for (const m of ms) files.push(...(await imageFiles(m, opts)));
  const names = uniqueNames(files.map((f) => f.name));
  const w = await window.cocoa.materials.writeFiles(r.value, files.map((f, i) => ({ name: names[i]!, bytes: f.bytes })));
  if (!w.ok) throw new Error(w.error);
  return w.value;
}

/** Why a file can't become a CocoaWorlds material, or what may look different. */
function nodeProblems(f: CocoaMat): { error?: string; warning?: string } {
  const { missing, different } = changedNodes(f);
  if (missing.length) return { error: `It uses nodes this CocoaWorlds doesn't have: ${missing.join(', ')}.` };
  if (different.length) return { warning: `Some nodes work differently here (${different.map((t) => nodeDef(t)?.label.en ?? t).join(', ')}), so it may look different.` };
  return {};
}

/**
 * Import `.cocoamat` files: each becomes a graph material (graph in `materials/`, images in `assets/textures/`,
 * values as its own settings). Returns the new materials (to add to the project) and what went wrong.
 */
export async function importCocoaMats(files: { name: string; bytes: Uint8Array }[]): Promise<{ made: MaterialDef[]; problems: string[] }> {
  const st = useEditor.getState();
  const dir = st.session?.dir;
  const made: MaterialDef[] = [];
  const problems: string[] = [];
  if (!dir) return { made, problems };
  for (const file of files) {
    const r = await readCocoaMat(file.bytes);
    if (!r.ok) {
      problems.push(`${file.name}: ${r.error}`);
      continue;
    }
    const f = r.value;
    const np = nodeProblems(f);
    if (np.error) {
      problems.push(`${file.name}: ${np.error}`);
      continue;
    }
    if (np.warning) problems.push(`${file.name}: ${np.warning}`);
    // Images into the project's textures.
    const where = new Map<string, string>();
    for (const [name, bytes] of f.images) {
      const w = await window.cocoa.projects.writeAsset(dir, 'textures', name.split('/').pop()!, bytes);
      if (!w.ok) throw new Error(w.error);
      where.set(name, w.value.path);
    }
    const fix = (v: unknown) => (typeof v === 'string' && where.has(v) ? where.get(v)! : v);
    const graph: MatGraph = { ...f.graph, nodes: f.graph.nodes.map((n) => ({ ...n, params: Object.fromEntries(Object.entries(n.params).map(([k, v]) => [k, fix(v)])) as typeof n.params })) };
    const fields = materialOf(f.manifest);
    if (fields.overrides) fields.overrides = Object.fromEntries(Object.entries(fields.overrides).map(([k, v]) => [k, fix(v)]));
    const w = await window.cocoa.projects.writeGraph(dir, graphPathFor(f.manifest.name), graph, true);
    if (!w.ok) throw new Error(w.error);
    useGraphs.setState((s) => ({ graphs: { ...s.graphs, [w.value]: graph } }));
    made.push(newMaterial(fields.name, { ...(fields as Partial<MaterialDef>), graph: w.value, bakeSize: [256, 512, 1024, 2048].includes(fields.bakeSize ?? 0) ? fields.bakeSize : 512 }));
  }
  if (made.length) await st.loadAssets();
  return { made, problems };
}

/** Bake imported materials once they're in the project. */
export function bakeImported(ms: MaterialDef[]): void {
  for (const m of ms) if (m.graph) bakeLater(m.graph);
}

/** Evaluate a `.cocoamat` itself, with its own images (for checking files, as CocoaSurface would). */
export async function evaluateFile(bytes: Uint8Array, size?: number): Promise<{ manifest: CocoaMat['manifest']; maps: Map<OutputRole, Uint8Array> } | string> {
  const r = await readCocoaMat(bytes);
  if (!r.ok) return r.error;
  const f = r.value;
  const n = size ?? f.manifest.evaluation.size;
  return { manifest: f.manifest, maps: await evaluateRoles(evaluable(f), n, (p) => decode(f.images.get(p) ?? new Uint8Array())) };
}

// (For the automated tests.)
(window as unknown as { __cwMatFiles?: unknown }).__cwMatFiles = { buildCocoaMat, evaluateRoles, evaluateFile, imageFiles, readCocoaMat, mapPng };
