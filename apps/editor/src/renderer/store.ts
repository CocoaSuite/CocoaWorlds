/**
 * Editor state. Scene data lives in a SceneDoc and changes only through History commands;
 * this store holds everything around it (session, selection, tools, view, logs) and exposes actions.
 */
import {
  History,
  SceneDoc,
  addEntitiesCmd,
  deleteEntitiesCmd,
  duplicateCmd,
  newEntity,
  renameCmd,
  setFlagCmd,
  setTransformCmd,
  type Command,
  type EntityData,
  type ProjectFile,
  type Transform,
} from '@cocoaworlds/core';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { OpenedProject } from '../shared/api';
import { getLang, setLang, t, type Lang } from './i18n';

export type Tool = 'select' | 'move' | 'rotate' | 'scale';
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
  toggle(k: 'showGrid' | 'showStats' | 'showBottom' | 'snap'): void;
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
}

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

let unsubDoc: (() => void) | null = null;
let unsubHist: (() => void) | null = null;

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
    set({ session: null, doc: null, selection: [], dirty: false, recovery: null, history: new History() });
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
    if (doc) set({ selection: doc.entities.filter((e) => e.visible && !e.locked).map((e) => e.id) });
  },

  setTool: (tool) => set({ tool }),
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
    const ids = selection.filter((id) => !doc.get(id)?.locked);
    if (!ids.length) return;
    get().execute(deleteEntitiesCmd(doc, ids));
  },

  duplicateSelection() {
    const { doc, selection } = get();
    if (!doc || !selection.length) return;
    const g = get().session?.project.settings.gridSize ?? 16;
    // Skip children whose ancestor is also selected; they come along with it.
    const roots = selection.filter((id) => !selection.some((o) => o !== id && doc.isAncestor(o, id)));
    const { cmd, newIds } = duplicateCmd(doc, roots, [g, 0, g]);
    get().execute(cmd);
    set({ selection: newIds });
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
}));

const selectedEntities = (s: State): EntityData[] =>
  s.doc ? (s.selection.map((id) => s.doc!.get(id)).filter(Boolean) as EntityData[]) : [];

/** The selected entities. Re-renders when the selection or the scene changes. */
export function useSelectedEntities(): EntityData[] {
  useEditor((s) => s.rev);
  return useEditor(useShallow(selectedEntities));
}
