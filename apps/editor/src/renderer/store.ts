/**
 * Editor state. Scene data lives in a SceneDoc and changes only through History commands;
 * this store holds everything around it (session, selection, tools, view, logs) and exposes actions.
 */
import {
  History,
  SceneDoc,
  addEntitiesCmd,
  deleteEntitiesCmd,
  newEntity,
  renameCmd,
  reparentCmd,
  setComponentCmd,
  setFlagCmd,
  setTransformCmd,
  type Command,
  type EntityData,
  type ProjectFile,
  type Transform,
} from '@cocoaworlds/core';
import {
  bakeSubtract,
  bounds,
  fitSurface,
  justifySurface,
  setSurface,
  type SurfacePatch,
  hollowBox,
  type HollowDirection,
  mergeAll,
  translate,
  validate,
  type Brush,
  type BrushRole,
} from '@cocoaworlds/geometry';
import { create } from 'zustand';
import { brushComponent, brushOf, isLocked, isShown, newBrushEntity, shapeBrushes, shapeName, worldBrushes, type ShapeOptions } from './brush/brushes';
import { useShallow } from 'zustand/react/shallow';
import type { OpenedProject } from '../shared/api';
import { DEV_TEXTURE_SIZE } from './brush/materials';
import type { FaceRef } from './viewport/world-render';
import type { LiveChange } from './viewport/engine';
import { cloneSnapshot, isGroup, rootsOf, snapshotSubtrees } from './scene-ops';
import { getLang, setLang, t, type Lang } from './i18n';

export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'brush' | 'face' | 'paint';
export type { FaceRef };
export type Justify = 'left' | 'right' | 'top' | 'bottom' | 'center';
export type ViewMode = 'perspective' | 'top' | 'front' | 'side';
export type AddKind = 'empty' | 'pointLight' | 'spotLight' | 'sun' | 'spawn';
export interface LogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  text: string;
}

interface Session {
  dir: string;
  project: ProjectFile;
  scenePath: string;
}

interface State {
  lang: Lang;
  session: Session | null;
  doc: SceneDoc | null;
  history: History;
  rev: number;
  selection: string[];
  tool: Tool;
  view: ViewMode;
  showGrid: boolean;
  showStats: boolean;
  showBottom: boolean;
  snap: boolean;
  dirty: boolean;
  saving: boolean;
  logs: LogEntry[];
  toast: { text: string; n: number } | null;
  recovery: OpenedProject['recovery'];
  renaming: string | null;
  focusRequest: number;
  /** Settings for the brush tool. */
  brushOptions: ShapeOptions;
  brushRole: BrushRole;
  /** Faces chosen with the face tool. */
  faceSelection: FaceRef[];
  /** Material the paint tool applies. */
  paintMaterial: string;
  /** Snap moves and brush drawing to nearby brush corners. */
  vertexSnap: boolean;
  /** The group the user has stepped into: clicks in the view pick objects inside it. */
  enteredGroup: string | null;
  /** Whether something has been copied (for menu state). */
  canPaste: boolean;
}

interface Actions {
  setLang(l: Lang): void;
  openSession(o: OpenedProject): void;
  closeSession(): void;
  log(level: LogEntry['level'], source: string, text: string): void;
  notify(text: string): void;
  select(ids: string[], mode?: 'replace' | 'toggle' | 'add'): void;
  selectAll(): void;
  setTool(t: Tool): void;
  setView(v: ViewMode): void;
  toggle(k: 'showGrid' | 'showStats' | 'showBottom' | 'snap' | 'vertexSnap'): void;
  execute(cmd: Command): void;
  begin(label: string): void;
  commit(): void;
  undo(): void;
  redo(): void;
  add(kind: AddKind, at?: [number, number, number]): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  rename(id: string, name: string): void;
  setTransform(id: string, tr: Transform, mergeKey?: string): void;
  setFlag(id: string, flag: 'visible' | 'locked', v: boolean): void;
  startRename(id: string | null): void;
  frameSelection(): void;
  save(): Promise<boolean>;
  autosave(): Promise<void>;
  recover(accept: boolean): Promise<void>;
  // brushes
  setBrushOptions(o: Partial<ShapeOptions>): void;
  setBrushRole(r: BrushRole): void;
  createBrushes(min: [number, number, number], max: [number, number, number]): void;
  setBrush(id: string, brush: Brush, mergeKey?: string, label?: string): void;
  changeBrushRole(id: string, role: BrushRole): void;
  applySubtract(ids: string[]): void;
  makeHollow(id: string, thickness: number, direction?: HollowDirection): void;
  mergeSelection(): void;
  // faces
  selectFace(ref: FaceRef | null, mode?: 'replace' | 'toggle' | 'brush', cut?: boolean): void;
  selectAllFaces(): void;
  setFaces(patch: SurfacePatch, mergeKey?: string, label?: string): void;
  fitFaces(repeat?: [number, number]): void;
  justifyFaces(side: Justify): void;
  setPaintMaterial(id: string): void;
  // multi-object editing, groups, clipboard
  applyLive(changes: LiveChange[]): void;
  clickSelect(id: string | null, additive: boolean, deep: boolean): void;
  groupSelection(): void;
  ungroupSelection(): void;
  enterGroup(): void;
  stepOut(): boolean;
  copySelection(): void;
  cutSelection(): void;
  paste(): void;
}

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

let unsubDoc: (() => void) | null = null;
/** Copied objects. Lives for the whole app session, so it also pastes into another project. */
let clipboard: { entities: EntityData[]; pastes: number } | null = null;
let unsubHist: (() => void) | null = null;

/** A short name for new brush entities: block, block_2, … */
function uniqueName(doc: SceneDoc, base: string): string {
  const names = new Set(doc.entities.map((e) => e.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export const useEditor = create<State & Actions>()((set, get) => ({
  lang: getLang(),
  session: null,
  doc: null,
  history: new History(),
  rev: 0,
  selection: [],
  tool: 'select',
  view: 'perspective',
  showGrid: true,
  showStats: true,
  showBottom: true,
  snap: true,
  dirty: false,
  saving: false,
  logs: [],
  toast: null,
  recovery: null,
  renaming: null,
  focusRequest: 0,
  brushOptions: { shape: 'box', sides: 16, steps: 8, facing: 0 },
  brushRole: 'solid',
  faceSelection: [],
  paintMaterial: 'dev/wall',
  vertexSnap: true,
  enteredGroup: null,
  canPaste: false,

  setLang(l) {
    setLang(l);
    set({ lang: l });
  },

  openSession(o) {
    unsubDoc?.();
    unsubHist?.();
    const doc = new SceneDoc(o.scene);
    const history = new History();
    unsubDoc = doc.subscribe((c) => {
      // Drop selected ids that no longer exist.
      if (c.kind === 'removed') set((s) => ({ selection: s.selection.filter((id) => doc.get(id)) }));
      set((s) => {
        const keep = s.faceSelection.filter((r) => r.face < (brushOf(doc.get(r.id))?.brush.faces.length ?? 0));
        return keep.length === s.faceSelection.length ? {} : { faceSelection: keep };
      });
      set((s) => ({ rev: s.rev + 1 }));
    });
    unsubHist = history.subscribe(() => {
      const dirty = history.isDirty;
      if (dirty !== get().dirty) window.cocoa.window.setDirty(dirty);
      set({ dirty });
    });
    set({
      session: { dir: o.dir, project: o.project, scenePath: o.scenePath },
      doc,
      history,
      selection: [],
      faceSelection: [],
      enteredGroup: null,
      tool: 'select',
      dirty: false,
      recovery: o.recovery,
      rev: get().rev + 1,
      logs: [],
    });
    window.cocoa.window.setTitle(`${o.project.name} — ${o.scene.name} — CocoaWorlds`);
    get().log('info', 'Project', `Opened ${o.project.name} (${o.dir})`);
    if (o.migrated) get().notify(t('toast.migrated'));
  },

  closeSession() {
    unsubDoc?.();
    unsubHist?.();
    unsubDoc = unsubHist = null;
    window.cocoa.window.setDirty(false);
    window.cocoa.window.setTitle('CocoaWorlds');
    set({ session: null, doc: null, selection: [], faceSelection: [], dirty: false, recovery: null, history: new History() });
  },

  log(level, source, text) {
    set((s) => ({ logs: [...s.logs.slice(-499), { at: now(), level, source, text }] }));
  },

  notify(text) {
    set((s) => ({ toast: { text, n: (s.toast?.n ?? 0) + 1 } }));
  },

  select(ids, mode = 'replace') {
    const cur = get().selection;
    let next: string[];
    if (mode === 'replace') next = ids;
    else if (mode === 'add') next = [...new Set([...cur, ...ids])];
    else next = ids.reduce((acc, id) => (acc.includes(id) ? acc.filter((x) => x !== id) : [...acc, id]), cur);
    set({ selection: next });
  },

  selectAll() {
    const doc = get().doc;
    if (doc) set({ selection: doc.entities.filter((e) => isShown(doc, e) && !isLocked(doc, e)).map((e) => e.id) });
  },

  setTool: (tool) => set((s) => (tool === 'face' || s.tool !== 'face' ? { tool } : { tool, faceSelection: [] })),
  setView: (view) => set({ view }),
  toggle: (k) => set((s) => ({ [k]: !s[k] }) as Partial<State>),

  execute(cmd) {
    get().history.execute(cmd);
  },
  begin(label) {
    get().history.begin(label);
  },
  commit() {
    get().history.commit();
  },
  undo() {
    const h = get().history;
    const label = h.undoLabel;
    if (h.undo() && label) get().log('info', 'Edit', `Undo ${label}`);
  },
  redo() {
    const h = get().history;
    const label = h.redoLabel;
    if (h.redo() && label) get().log('info', 'Edit', `Redo ${label}`);
  },

  add(kind, at = [0, 0, 0]) {
    const doc = get().doc;
    if (!doc) return;
    const base = (name: string, components: EntityData['components'], y = 0) =>
      newEntity(name, components, { position: [at[0], at[1] + y, at[2]] });
    const e: EntityData = {
      empty: () => base('object', {}),
      pointLight: () => base('point_light', { light: { kind: 'point', color: '#ffe8c4', intensity: 1.5, range: 512, castShadows: false } }, 128),
      spotLight: () => base('spot_light', { light: { kind: 'spot', color: '#ffffff', intensity: 2, range: 768, angle: 40, castShadows: true } }, 192),
      sun: () => base('sun', { light: { kind: 'directional', color: '#fff4e0', intensity: 2, castShadows: true } }, 512),
      spawn: () => base('player_spawn', { playerSpawn: {} }),
    }[kind]();
    get().execute(addEntitiesCmd(doc, [e], `Add ${e.name}`));
    set({ selection: [e.id] });
    get().log('info', 'Scene', `Added ${e.name}`);
  },

  deleteSelection() {
    const { doc, selection } = get();
    if (!doc || !selection.length) return;
    const ids = selection.filter((id) => !isLocked(doc, doc.get(id)));
    if (!ids.length) return;
    get().execute(deleteEntitiesCmd(doc, ids));
  },

  duplicateSelection() {
    const { doc, selection } = get();
    if (!doc || !selection.length) return;
    const g = get().session?.project.settings.gridSize ?? 16;
    const { copies, roots } = cloneSnapshot(doc, snapshotSubtrees(doc, rootsOf(doc, selection)), [g, 0, g]);
    get().execute(addEntitiesCmd(doc, copies, 'Duplicate'));
    set({ selection: roots });
  },


  rename(id, name) {
    const doc = get().doc;
    const clean = name.trim();
    if (!doc || !clean || doc.get(id)?.name === clean) return;
    get().execute(renameCmd(doc, id, clean));
  },

  setTransform(id, tr, mergeKey) {
    const doc = get().doc;
    const cur = doc?.get(id)?.transform;
    // Ignore no-op edits so they never create empty undo steps.
    if (!doc || !cur || JSON.stringify(cur) === JSON.stringify(tr)) return;
    get().execute(setTransformCmd(doc, id, tr, mergeKey));
  },

  setFlag(id, flag, v) {
    const doc = get().doc;
    if (doc) get().execute(setFlagCmd(doc, id, flag, v));
  },

  startRename: (id) => set({ renaming: id }),
  frameSelection: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),

  async save() {
    const { session, doc, history } = get();
    if (!session || !doc) return false;
    set({ saving: true });
    const r = await window.cocoa.projects.saveScene(session.dir, session.scenePath, doc.toFile());
    set({ saving: false });
    if (!r.ok) {
      get().log('error', 'Save', `${r.error}${r.details?.length ? ` — ${r.details.join('; ')}` : ''}`);
      get().notify(`${t('error.save')}: ${r.error}`);
      return false;
    }
    history.markSaved();
    get().log('info', 'Save', `Saved ${session.scenePath} (${doc.entities.length} objects)`);
    get().notify(t('toast.saved'));
    return true;
  },

  async autosave() {
    const { session, doc, dirty } = get();
    if (!session || !doc || !dirty) return;
    const r = await window.cocoa.projects.autosave(session.dir, session.scenePath, doc.toFile());
    if (!r.ok) get().log('warn', 'Autosave', r.error);
  },

  async recover(accept) {
    const { session, recovery, doc, history } = get();
    if (!session || !recovery || !doc) return set({ recovery: null });
    if (accept) {
      // Apply the autosave as one undoable change: replace all entities.
      const before = doc.toFile().entities;
      const after = recovery.scene.entities;
      history.execute({
        label: 'Recover autosave',
        apply: () => {
          doc.remove(doc.entities.map((e) => e.id));
          doc.insert(after);
        },
        revert: () => {
          doc.remove(doc.entities.map((e) => e.id));
          doc.insert(before);
        },
      });
      get().notify(t('toast.recovered'));
      get().log('info', 'Recovery', `Recovered autosave from ${new Date(recovery.savedAt).toLocaleString()}`);
    } else {
      await window.cocoa.projects.discardRecovery(session.dir, session.scenePath);
      get().log('info', 'Recovery', 'Autosave discarded');
    }
    set({ recovery: null });
  },

  setBrushOptions(o) {
    set((s) => ({ brushOptions: { ...s.brushOptions, ...o } }));
  },
  setBrushRole: (brushRole) => set({ brushRole }),

  createBrushes(min, max) {
    const { doc, brushOptions, brushRole } = get();
    if (!doc) return;
    const brushes = shapeBrushes(brushOptions, min, max, brushRole);
    const problems = brushes.flatMap((b) => validate(b));
    if (problems.length) {
      get().notify(`The brush is too small to build (${problems[0]}).`);
      return;
    }
    const base = brushRole === 'subtract' ? 'cut' : shapeName[brushOptions.shape];
    const ents = brushes.map((b) => newBrushEntity(uniqueName(doc, base), b, brushRole));
    // Give each a unique name even within one batch (stairs).
    const used = new Set(doc.entities.map((e) => e.name));
    for (const e of ents) {
      let n = e.name, i = 2;
      while (used.has(n)) n = `${base}_${i++}`;
      e.name = n;
      used.add(n);
    }
    get().execute(addEntitiesCmd(doc, ents, `Create ${base}`));
    set({ selection: ents.map((e) => e.id) });
    const [x, y, z] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((n) => Math.abs(Math.round(n * 100) / 100));
    get().log('info', 'Brush', `Created ${ents.length > 1 ? `${ents.length} ${base} brushes` : ents[0]!.name} (${x} × ${y} × ${z})`);
  },

  setBrush(id, brush, mergeKey, label = 'Edit brush') {
    const doc = get().doc;
    const cur = brushOf(doc?.get(id));
    if (!doc || !cur) return;
    get().execute(setComponentCmd(doc, id, 'brush', brushComponent(brush, cur.role) as never, label, mergeKey));
  },

  changeBrushRole(id, role) {
    const doc = get().doc;
    const cur = brushOf(doc?.get(id));
    if (!doc || !cur || cur.role === role) return;
    get().execute(setComponentCmd(doc, id, 'brush', brushComponent(cur.brush, role) as never, role === 'subtract' ? 'Make subtract' : 'Make solid'));
  },

  applySubtract(ids) {
    const doc = get().doc;
    if (!doc) return;
    const subs = ids.filter((id) => brushOf(doc.get(id))?.role === 'subtract');
    if (!subs.length) return;
    const { replace } = bakeSubtract(worldBrushes(doc), subs);
    const h = get().history;
    h.begin('Apply cut');
    const added: string[] = [];
    for (const [solidId, pieces] of replace) {
      const src = doc.get(solidId)!;
      const ents = pieces.map((p, i) => {
        const e = newBrushEntity(`${src.name}${pieces.length > 1 ? `_${i + 1}` : ''}`, p, 'solid');
        e.parent = src.parent;
        return e;
      });
      h.execute(deleteEntitiesCmd(doc, [solidId]));
      h.execute(addEntitiesCmd(doc, ents));
      added.push(...ents.map((e) => e.id));
    }
    h.execute(deleteEntitiesCmd(doc, subs));
    h.commit();
    set({ selection: added });
    get().log('info', 'Brush', `Applied ${subs.length} cut(s): ${replace.size} brush(es) replaced by ${added.length} piece(s)`);
  },

  makeHollow(id, thickness, direction = 'inward') {
    const doc = get().doc;
    const e = doc?.get(id);
    const b = brushOf(e);
    if (!doc || !e || !b || b.role !== 'solid') return;
    const bb = bounds(b.brush);
    if (!bb) return;
    let walls: Brush[];
    try {
      walls = hollowBox(bb.min, bb.max, thickness, b.brush.faces[0]?.surface, direction);
    } catch (err) {
      get().notify((err as Error).message);
      return;
    }
    const names = ['floor', 'ceiling', 'wall_west', 'wall_east', 'wall_north', 'wall_south'];
    const group = newEntity(e.name, { group: {} });
    group.parent = e.parent;
    const ents = walls.map((w, i) => {
      const x = newBrushEntity(names[i] ?? `wall_${i}`, w, 'solid');
      x.parent = group.id;
      return x;
    });
    const h = get().history;
    h.begin('Make hollow');
    h.execute(deleteEntitiesCmd(doc, [id]));
    h.execute(addEntitiesCmd(doc, [group, ...ents]));
    h.commit();
    set({ selection: ents.map((x) => x.id) });
    get().log('info', 'Brush', `Hollowed ${e.name} into 6 walls ${thickness} units thick (${direction})`);
  },

  mergeSelection() {
    const { doc, selection } = get();
    if (!doc) return;
    const solids = selection.map((id) => ({ id, b: brushOf(doc.get(id)) })).filter((x) => x.b?.role === 'solid');
    if (solids.length < 2) return;
    const merged = mergeAll(solids.map((x) => x.b!.brush));
    if (merged.length === solids.length) {
      get().notify('These brushes don’t form a convex shape together, so they stay separate.');
      return;
    }
    const first = doc.get(solids[0]!.id)!;
    const ents = merged.map((m, i) => {
      const e = newBrushEntity(merged.length > 1 ? `${first.name}_${i + 1}` : first.name, m, 'solid');
      e.parent = first.parent;
      return e;
    });
    const h = get().history;
    h.begin('Merge');
    h.execute(deleteEntitiesCmd(doc, solids.map((x) => x.id)));
    h.execute(addEntitiesCmd(doc, ents));
    h.commit();
    set({ selection: ents.map((e) => e.id) });
    get().log('info', 'Brush', `Merged ${solids.length} brushes into ${merged.length}`);
  },

  selectFace(ref, mode = 'replace', cut = false) {
    const st = get();
    const doc = st.doc;
    if (!doc) return;
    if (st.tool === 'paint') {
      if (!ref) {
        if (cut) st.notify(t('face.cutSurface'));
        return;
      }
      const b = brushOf(doc.get(ref.id));
      if (!b) return;
      if (mode === 'toggle') {
        // Ctrl+click picks up the material under the cursor.
        const m = b.brush.faces[ref.face]?.surface.material;
        if (m) set({ paintMaterial: m });
        return;
      }
      st.setBrush(ref.id, setSurface(b.brush, { material: st.paintMaterial }, mode === 'brush' ? undefined : [ref.face]), undefined, 'Paint');
      return;
    }
    if (!ref) {
      if (cut) st.notify(t('face.cutSurface'));
      if (mode === 'replace') set({ faceSelection: [], selection: [] });
      return;
    }
    const same = (a: FaceRef, b: FaceRef) => a.id === b.id && a.face === b.face;
    let next: FaceRef[];
    if (mode === 'brush') {
      const n = brushOf(doc.get(ref.id))?.brush.faces.length ?? 0;
      const all = Array.from({ length: n }, (_, face) => ({ id: ref.id, face }));
      next = [...st.faceSelection.filter((r) => r.id !== ref.id), ...all];
    } else if (mode === 'toggle') {
      next = st.faceSelection.some((r) => same(r, ref)) ? st.faceSelection.filter((r) => !same(r, ref)) : [...st.faceSelection, ref];
    } else {
      next = [ref];
    }
    set({ faceSelection: next, selection: [...new Set(next.map((r) => r.id))] });
  },

  selectAllFaces() {
    const st = get();
    const doc = st.doc;
    if (!doc) return;
    const ids = st.selection.length ? st.selection : [...new Set(st.faceSelection.map((r) => r.id))];
    const next: FaceRef[] = [];
    for (const id of ids) {
      const b = brushOf(doc.get(id));
      if (b) for (let face = 0; face < b.brush.faces.length; face++) next.push({ id, face });
    }
    set({ faceSelection: next, selection: [...new Set(next.map((r) => r.id))] });
  },

  setFaces(patch, mergeKey, label = 'Edit faces') {
    applyToFaces(get, (b, faces) => setSurface(b, patch, faces), label, mergeKey);
  },

  fitFaces(repeat = [1, 1]) {
    applyToFaces(get, (b, faces) => fitSurface(b, faces, DEV_TEXTURE_SIZE, repeat), 'Fit texture');
  },

  justifyFaces(side) {
    applyToFaces(get, (b, faces) => justifySurface(b, faces, side, DEV_TEXTURE_SIZE), 'Align texture');
  },

  setPaintMaterial(id) {
    set({ paintMaterial: id });
  },

  applyLive(changes) {
    const doc = get().doc;
    if (!doc || !changes.length) return;
    const cmds: Command[] = [];
    for (const c of changes) {
      const e = doc.get(c.id);
      if (!e) continue;
      if (c.brush) {
        const cur = brushOf(e);
        if (cur) cmds.push(setComponentCmd(doc, c.id, 'brush', brushComponent(c.brush, cur.role) as never, 'Transform'));
      } else if (c.transform) {
        cmds.push(setTransformCmd(doc, c.id, c.transform));
      }
    }
    if (!cmds.length) return;
    get().execute({
      label: 'Transform',
      mergeKey: 'gizmo',
      apply: () => cmds.forEach((c) => c.apply()),
      revert: () => [...cmds].reverse().forEach((c) => c.revert()),
    });
  },

  clickSelect(id, additive, deep) {
    const st = get();
    const doc = st.doc;
    if (!doc) return;
    if (!id) {
      if (!additive) set({ selection: [] });
      return;
    }
    let pick = id;
    let entered = st.enteredGroup;
    if (deep) {
      // Double-click steps into the groups around the object and picks the object itself.
      const parent = doc.get(id)?.parent ?? null;
      entered = parent && isGroup(doc, doc.get(parent)) ? parent : entered;
    } else {
      // A click picks the outermost group around the object, unless the user has stepped inside it.
      for (let a = doc.get(id)?.parent ?? null; a; a = doc.get(a)?.parent ?? null) {
        if (a === entered) break;
        if (isGroup(doc, doc.get(a))) pick = a;
      }
      if (entered && !doc.isAncestor(entered, id)) entered = null;
    }
    set({ enteredGroup: entered });
    st.select([pick], additive ? 'toggle' : 'replace');
  },

  groupSelection() {
    const { doc, selection } = get();
    if (!doc || !selection.length) return;
    const roots = rootsOf(doc, selection);
    const parents = new Set(roots.map((id) => doc.get(id)?.parent ?? null));
    const parent = parents.size === 1 ? [...parents][0]! : null;
    const names = new Set(doc.entities.map((e) => e.name));
    let name = 'group', i = 2;
    while (names.has(name)) name = `group_${i++}`;
    const group = newEntity(name, { group: {} });
    group.parent = parent;
    const h = get().history;
    h.begin('Group');
    h.execute(addEntitiesCmd(doc, [group], 'Group'));
    for (const id of roots) h.execute(reparentCmd(doc, id, group.id));
    h.commit();
    set({ selection: [group.id] });
    get().log('info', 'Edit', `Grouped ${roots.length} object(s) into ${name}`);
  },

  ungroupSelection() {
    const { doc, selection } = get();
    if (!doc) return;
    const groups = selection.filter((id) => isGroup(doc, doc.get(id)));
    if (!groups.length) return;
    const freed: string[] = [];
    const h = get().history;
    h.begin('Ungroup');
    for (const g of groups) {
      const parent = doc.get(g)?.parent ?? null;
      for (const c of doc.children(g)) {
        h.execute(reparentCmd(doc, c.id, parent));
        freed.push(c.id);
      }
      h.execute(deleteEntitiesCmd(doc, [g]));
    }
    h.commit();
    set({ selection: freed, enteredGroup: null });
  },

  enterGroup() {
    const { doc, selection } = get();
    if (!doc || selection.length !== 1 || !isGroup(doc, doc.get(selection[0]!))) return;
    const g = selection[0]!;
    set({ enteredGroup: g, selection: doc.children(g).map((c) => c.id) });
  },

  stepOut() {
    const { doc, enteredGroup } = get();
    if (!doc || !enteredGroup) return false;
    let outer: string | null = null;
    for (let a = doc.get(enteredGroup)?.parent ?? null; a; a = doc.get(a)?.parent ?? null) {
      if (isGroup(doc, doc.get(a))) {
        outer = a;
        break;
      }
    }
    set({ enteredGroup: outer, selection: doc.get(enteredGroup) ? [enteredGroup] : [] });
    return true;
  },

  copySelection() {
    const { doc, selection } = get();
    if (!doc || !selection.length) return;
    clipboard = { entities: snapshotSubtrees(doc, rootsOf(doc, selection)), pastes: 0 };
    set({ canPaste: true });
    get().notify(t('toast.copied').replace('{n}', String(rootsOf(doc, selection).length)));
  },

  cutSelection() {
    const { doc, selection } = get();
    if (!doc || !selection.length) return;
    const roots = rootsOf(doc, selection).filter((id) => !isLocked(doc, doc.get(id)));
    if (!roots.length) return;
    // A cut pastes back in place the first time.
    clipboard = { entities: snapshotSubtrees(doc, roots), pastes: -1 };
    set({ canPaste: true });
    const h = get().history;
    h.begin('Cut');
    h.execute(deleteEntitiesCmd(doc, roots));
    h.commit();
  },

  paste() {
    const doc = get().doc;
    if (!doc || !clipboard) return;
    const g = get().session?.project.settings.gridSize ?? 16;
    clipboard.pastes++;
    const k = clipboard.pastes * g;
    const { copies, roots } = cloneSnapshot(doc, clipboard.entities, [k, 0, k]);
    get().execute(addEntitiesCmd(doc, copies, 'Paste'));
    set({ selection: roots });
  },
}));

const selectedEntities = (s: State): EntityData[] =>
  s.doc ? (s.selection.map((id) => s.doc!.get(id)).filter(Boolean) as EntityData[]) : [];

/** The selected entities. Re-renders when the selection or the scene changes. */
export function useSelectedEntities(): EntityData[] {
  useEditor((s) => s.rev);
  return useEditor(useShallow(selectedEntities));
}

/** Change the selected faces on every brush they belong to, as one undo step (merging with `mergeKey` while scrubbing). */
function applyToFaces(get: () => State & Actions, fn: (b: Brush, faces: number[]) => Brush, label: string, mergeKey?: string): void {
  const st = get();
  const doc = st.doc;
  if (!doc || !st.faceSelection.length) return;
  const byId = new Map<string, number[]>();
  for (const r of st.faceSelection) byId.set(r.id, [...(byId.get(r.id) ?? []), r.face]);
  const cmds: Command[] = [];
  for (const [id, faces] of byId) {
    const cur = brushOf(doc.get(id));
    if (!cur || isLocked(doc, doc.get(id))) continue;
    cmds.push(setComponentCmd(doc, id, 'brush', brushComponent(fn(cur.brush, faces), cur.role) as never, label));
  }
  if (!cmds.length) return;
  st.execute({
    label,
    mergeKey,
    apply: () => cmds.forEach((c) => c.apply()),
    revert: () => [...cmds].reverse().forEach((c) => c.revert()),
  });
}
