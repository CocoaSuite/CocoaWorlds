/**
 * Graph materials in the editor (Cocoa Materials): their graphs, loaded from `materials/….cwmat`, edited as
 * undo steps, saved a moment after each change, evaluated on the graphics card and baked to images.
 *
 * Baking follows the graph wherever it is changed from (the graph editor, or Undo in another workspace): a
 * moment after the last change, every material using the graph gets its maps written to
 * `assets/textures/generated/` and its map fields pointed at them.
 */
import { MAP_FIELDS, materialsOf, newMaterial, type MaterialDef } from '@cocoaworlds/core';
import { GraphEvaluator, SMART_MATERIALS, NODES, OUTPUT_ROLES, withOverrides, newGraph, outputNodes, paramsOf, nodeDef, validateGraph, type MatGraph, type OutputRole } from '@cocoaworlds/materials';
import { create } from 'zustand';
import { assetUrl, forgetAsset } from '../assets';
import { useEditor } from '../store';
import { forgetMaterialImage, refreshLiveMaps, setLiveMaps } from '../viewport/project-materials';

interface GraphsState {
  /** Graphs by file path. */
  graphs: Record<string, MatGraph>;
  /** Graphs that couldn't be read, and why. */
  errors: Record<string, string>;
  /** Baking: what each graph's maps are like now. */
  baking: Record<string, 'waiting' | 'baking' | 'done' | 'failed'>;
}

export const useGraphs = create<GraphsState>(() => ({ graphs: {}, errors: {}, baking: {} }));

// A different project: forget everything.
let projectDir: string | null = null;
useEditor.subscribe((s) => {
  const dir = s.session?.dir ?? null;
  if (dir === projectDir) return;
  projectDir = dir;
  for (const t of saveTimers.values()) clearTimeout(t);
  saveTimers.clear();
  for (const t of bakeTimers.values()) clearTimeout(t);
  bakeTimers.clear();
  useGraphs.setState({ graphs: {}, errors: {}, baking: {} });
});

/** Read a graph file (once). */
export async function loadGraph(path: string): Promise<void> {
  const st = useGraphs.getState();
  if (st.graphs[path] || st.errors[path]) return;
  const dir = useEditor.getState().session?.dir;
  if (!dir) return;
  const r = await window.cocoa.projects.readGraph(dir, path);
  if (useEditor.getState().session?.dir !== dir) return;
  const problem = r.ok ? validateGraph(r.value) : r.error;
  if (problem || !r.ok) useGraphs.setState((s) => ({ errors: { ...s.errors, [path]: problem ?? 'Unreadable.' } }));
  else useGraphs.setState((s) => ({ graphs: { ...s.graphs, [path]: r.value as MatGraph } }));
}

function put(path: string, g: MatGraph): void {
  useGraphs.setState((s) => ({ graphs: { ...s.graphs, [path]: g } }));
  saveSoon(path);
  bakeSoon(path);
}

/** Change a graph as one undo step (merging with the step before while `mergeKey` is the same). */
export function setGraph(path: string, next: MatGraph, label: string, mergeKey?: string): void {
  const before = useGraphs.getState().graphs[path];
  if (!before || before === next) return;
  useEditor.getState().execute({ label, mergeKey, apply: () => put(path, next), revert: () => put(path, before) });
}

// Sliders and drags: one undo step per gesture (changes with the same key join until they rest a moment).
let gesture: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
function endGesture(): void {
  if (!gesture) return;
  clearTimeout(gesture.timer);
  gesture = null;
  useEditor.getState().commit();
}
export function setGraphLive(path: string, next: MatGraph, label: string, key: string): void {
  const st = useEditor.getState();
  if (gesture?.key !== key) {
    endGesture();
    st.begin(label);
  } else clearTimeout(gesture.timer);
  gesture = { key, timer: setTimeout(endGesture, 700) };
  setGraph(path, next, label, key);
}
export { endGesture as endGraphGesture };

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
function saveSoon(path: string): void {
  clearTimeout(saveTimers.get(path));
  saveTimers.set(
    path,
    setTimeout(() => void saveNow(path), 400),
  );
}
async function saveNow(path: string): Promise<void> {
  saveTimers.delete(path);
  const dir = useEditor.getState().session?.dir;
  const g = useGraphs.getState().graphs[path];
  if (!dir || !g) return;
  const r = await window.cocoa.projects.writeGraph(dir, path, g);
  if (!r.ok) useEditor.getState().log('error', 'Materials', r.error);
}

/** Write graphs still waiting (before closing or exporting). */
export async function flushGraphs(): Promise<void> {
  const paths = [...saveTimers.keys()];
  for (const p of paths) clearTimeout(saveTimers.get(p));
  await Promise.all(paths.map(saveNow));
  const bakes = [...bakeTimers.keys()];
  for (const p of bakes) clearTimeout(bakeTimers.get(p));
  bakeTimers.clear();
  for (const p of bakes) await bakeGraph(p);
}

/** A file name made from a material's name: `materials/old_brick.cwmat`. */
export function graphPathFor(name: string): string {
  const stem =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'material';
  return `materials/${stem}.cwmat`;
}

/** Make a new graph material (its graph file is written straight away). */
export async function createGraphMaterial(name: string, smart?: string): Promise<MaterialDef | null> {
  const st = useEditor.getState();
  const dir = st.session?.dir;
  if (!dir) return null;
  const sm = smart ? SMART_MATERIALS.find((s) => s.id === smart) : undefined;
  const g = sm ? sm.graph() : newGraph();
  const r = await window.cocoa.projects.writeGraph(dir, graphPathFor(name), g, true);
  if (!r.ok) {
    st.notify(r.error);
    return null;
  }
  useGraphs.setState((s) => ({ graphs: { ...s.graphs, [r.value]: g } }));
  bakeSoon(r.value, 50);
  return newMaterial(name, { color: '#ffffff', roughness: 1, metalness: 0, graph: r.value, bakeSize: 512, tile: 128, ...(sm?.settings ?? {}) });
}

// ── The graphics card ──

let gl: WebGL2RenderingContext | null = null;
function context(): WebGL2RenderingContext {
  if (gl && !gl.isContextLost()) return gl;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false, alpha: false });
  if (!ctx) throw new Error('This computer’s graphics don’t support WebGL 2, which Cocoa Materials needs.');
  gl = ctx;
  return gl;
}

const bitmaps = new Map<string, Promise<ImageBitmap>>();
function loadBitmap(path: string): Promise<ImageBitmap> {
  let p = bitmaps.get(path);
  if (!p) {
    p = assetUrl(path)
      .then((u) => fetch(u))
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b));
    p.catch(() => bitmaps.delete(path));
    bitmaps.set(path, p);
  }
  return p;
}

function imagesOf(g: MatGraph): string[] {
  const out = new Set<string>();
  for (const n of g.nodes) {
    const params = paramsOf(n);
    for (const p of nodeDef(n.type)?.params ?? []) if (p.kind === 'image' && params[p.id]) out.add(String(params[p.id]));
  }
  return [...out];
}

/**
 * The graph being edited: its node pictures (thumbnails, the 2D preview) and its maps as canvases that the
 * 3D preview and the level show live.
 */
export class LiveGraph {
  private ev: GraphEvaluator;
  private thumbs = new Map<string, Set<HTMLCanvasElement>>();
  private maps = new Map<OutputRole, HTMLCanvasElement>();
  private graph: MatGraph | null = null;
  private size = 512;
  private listeners = new Set<() => void>();

  constructor(
    readonly materialId: string,
    private onImage: () => void,
  ) {
    this.ev = new GraphEvaluator(context(), { loadImage: loadBitmap, onImage: () => this.onImage() });
  }

  /** Draw what changed, then copy it into the thumbnails and maps. */
  run(g: MatGraph, size: number): void {
    this.graph = g;
    this.size = size;
    const drawn = this.ev.evaluate(g, size);
    for (const id of drawn) this.copyThumbs(id);
    const outs = outputNodes(g);
    const roles = new Set(outs.keys());
    let changedSet = roles.size !== this.maps.size || [...roles].some((r) => !this.maps.has(r));
    if (changedSet) {
      this.maps.clear();
      for (const r of roles) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        this.maps.set(r, c);
      }
    }
    for (const [role, n] of outs) {
      const c = this.maps.get(role)!;
      if (c.width !== size) {
        c.width = c.height = size;
        changedSet = true;
      }
      if (!changedSet && !drawn.has(n.id)) continue;
      if (this.ev.present(n.id, size, size)) c.getContext('2d')!.drawImage(this.ev.gl.canvas as HTMLCanvasElement, 0, 0);
    }
    if (changedSet) setLiveMaps(this.materialId, Object.fromEntries(this.maps));
    else if (drawn.size) refreshLiveMaps(this.materialId);
    if (drawn.size) for (const fn of this.listeners) fn();
  }

  /** Something was drawn again (for the 2D preview). */
  onDrawn(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Problems drawing nodes (by id). */
  get errors(): ReadonlyMap<string, string> {
    return this.ev.errors;
  }

  /** Show a node's picture in `c` (kept up to date until released). */
  attachThumb(id: string, c: HTMLCanvasElement): () => void {
    let set = this.thumbs.get(id);
    if (!set) this.thumbs.set(id, (set = new Set()));
    set.add(c);
    this.copyThumb(id, c);
    return () => set.delete(c);
  }

  /** Draw a node's picture into any canvas once. */
  paint(id: string, c: HTMLCanvasElement): boolean {
    return this.copyThumb(id, c);
  }

  private copyThumbs(id: string): void {
    for (const c of this.thumbs.get(id) ?? []) this.copyThumb(id, c);
  }

  private copyThumb(id: string, c: HTMLCanvasElement): boolean {
    const g = c.getContext('2d');
    if (!g || !this.ev.present(id, c.width, c.height)) return false;
    g.drawImage(this.ev.gl.canvas as HTMLCanvasElement, 0, 0);
    return true;
  }

  dispose(): void {
    setLiveMaps(this.materialId, null);
    this.ev.dispose();
    this.thumbs.clear();
    this.listeners.clear();
    void this.graph;
    void this.size;
  }
}

// ── Baking ──

const bakeTimers = new Map<string, ReturnType<typeof setTimeout>>();
function bakeSoon(path: string, ms = 1200): void {
  clearTimeout(bakeTimers.get(path));
  useGraphs.setState((s) => ({ baking: { ...s.baking, [path]: 'waiting' } }));
  bakeTimers.set(
    path,
    setTimeout(() => {
      bakeTimers.delete(path);
      void bakeGraph(path);
    }, ms),
  );
}

let bakeChain: Promise<void> = Promise.resolve();

/** Bake now (the material's size changed, or the user asked). */
export function bakeNow(path: string): Promise<void> {
  clearTimeout(bakeTimers.get(path));
  bakeTimers.delete(path);
  return bakeGraph(path);
}

function bakeGraph(path: string): Promise<void> {
  const run = bakeChain.then(() => bakeOnce(path));
  bakeChain = run.catch(() => {});
  return run;
}

async function pngBytes(px: Uint8Array, size: number): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), size, size), 0, 0);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('The baked map could not be encoded.');
  return new Uint8Array(await blob.arrayBuffer());
}

async function bakeOnce(path: string): Promise<void> {
  const st = useEditor.getState();
  const dir = st.session?.dir;
  const g = useGraphs.getState().graphs[path];
  if (!dir || !g) return;
  const users = materialsOf(st.session!.project.settings).filter((m) => m.graph === path);
  if (!users.length) return;
  useGraphs.setState((s) => ({ baking: { ...s.baking, [path]: 'baking' } }));
  const stem = path.slice('materials/'.length, -'.cwmat'.length);
  try {
    await Promise.all(imagesOf(g).map((p) => loadBitmap(p).catch(() => null)));
    // Each material bakes with its own values for the exposed settings (a graph's only material keeps the
    // graph's name for its maps; variants add a piece of their id).
    for (const m of users) {
      const size = m.bakeSize ?? 512;
      const gm = withOverrides(g, m.overrides);
      const name = users.length === 1 ? stem : `${stem}_${m.id.slice(4, 10)}`;
      const ev = new GraphEvaluator(context(), { loadImage: loadBitmap });
      ev.evaluate(gm, size);
      // (Images arrive a moment after they are asked for.)
      await new Promise((r) => setTimeout(r, 0));
      ev.evaluate(gm, size);
      const patch: Partial<MaterialDef> = {};
      const outs = outputNodes(gm);
      for (const role of OUTPUT_ROLES) {
        const n = outs.get(role);
        const field = MAP_FIELDS[role];
        if (!n) {
          (patch as Record<string, unknown>)[field] = undefined;
          continue;
        }
        const px = ev.read(n.id);
        if (!px) continue;
        const r = await window.cocoa.projects.writeGenerated(dir, `${name}_${role}.png`, await pngBytes(px, size));
        if (!r.ok) throw new Error(r.error);
        forgetAsset(r.value);
        forgetMaterialImage(r.value);
        (patch as Record<string, unknown>)[field] = r.value;
      }
      ev.dispose();
      if (useEditor.getState().session?.dir !== dir) return;
      useEditor.getState().patchMaterialQuietly(m.id, patch);
    }
    useGraphs.setState((s) => ({ baking: { ...s.baking, [path]: bakeTimers.has(path) ? 'waiting' : 'done' } }));
  } catch (e) {
    useGraphs.setState((s) => ({ baking: { ...s.baking, [path]: 'failed' } }));
    useEditor.getState().log('error', 'Materials', `Baking ${stem} failed: ${(e as Error).message}`);
  }
}

/** Bake a graph again a moment from now (a material's own settings changed, or a variant was made). */
export function bakeLater(path: string): void {
  bakeSoon(path);
}

// ── Pictures for the node library ──

let icons: Map<string, string> | null = null;

/**
 * A small picture of what each kind of node makes, with its default settings (nodes that need an input are fed
 * a noise; colour nodes a soft gradient). Drawn once, on first use.
 */
export function nodeIcons(size = 64): Map<string, string> {
  if (icons) return icons;
  icons = new Map();
  try {
    const gl = context();
    const ev = new GraphEvaluator(gl);
    const g: MatGraph = { format: 'cocoaworlds.material', version: 1, nodes: [], links: [] };
    const feed = { id: 'feed', type: 'noise', x: 0, y: 0, params: { scale: 3, octaves: 4 } };
    const bricks = { id: 'bricks', type: 'bricks', x: 0, y: 0, params: { rows: 6, columns: 3 } };
    g.nodes.push(feed, bricks);
    for (const def of NODES) {
      const id = `n_${def.type}`;
      g.nodes.push({ id, type: def.type, x: 0, y: 0, params: {} });
      // (Surface nodes read a height: bricks show them best.)
      def.inputs.forEach((p, i) => g.links.push({ from: def.group === 'surface' || def.type === 'edges' || i > 0 ? bricks.id : feed.id, to: id, input: p.id }));
    }
    ev.evaluate(g, 96);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g2 = c.getContext('2d')!;
    for (const def of NODES) {
      if (!ev.present(`n_${def.type}`, size, size)) continue;
      g2.clearRect(0, 0, size, size);
      g2.drawImage(gl.canvas as HTMLCanvasElement, 0, 0);
      icons.set(def.type, c.toDataURL());
    }
    ev.dispose();
  } catch {
    // (No pictures without WebGL 2: the library shows coloured dots instead.)
  }
  return icons;
}
