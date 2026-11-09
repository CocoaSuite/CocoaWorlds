/**
 * Editor state. Scene data lives in a SceneDoc and changes only through History commands;
 * this store holds everything around it (session, selection, tools, view, logs) and exposes actions.
 */
import type { SavedSky } from '@cocoaworlds/core';
import { saveZUp, savedZUp } from './axes';
import {
  History,
  SceneDoc,
  LINK,
  applyPathToSource,
  diffPaths,
  instantiate,
  linkOf,
  linkTree,
  makePrefab as makePrefabFile,
  replaceEntitiesCmd,
  revertPath,
  type PrefabFile,
  componentDef,
  defaultComponent,
  readComponent,
  type ModelData,
  composeTransform,
  identityTransform,
  type Vec3,
  decomposeMat4,
  identityMat4,
  invertMat4,
  applyMat4,
  PIVOT,
  pivotData,
  multiplyMat4,
  type Mat4,
  addEntitiesCmd,
  deleteEntitiesCmd,
  newEntity,
  renameCmd,
  reparentCmd,
  setComponentCmd,
  setFlagCmd,
  setEmptyClassCmd,
  type EmptyClass,
  setTransformCmd,
  type Command,
  type EntityData,
  type ProjectFile,
  type SceneFile,
  type Transform,
  gameRules,
  type GameRules,
  type GameValue,
  type MaterialDef,
  materialsOf,
  plantsOf,
  effectsOf,
  type VfxEffect,
  type PlantDef,
  type SurfaceSounds,
  type SceneSettings,
  setSceneSettingsCmd,
} from '@cocoaworlds/core';
import {
  bakeSubtract,
  box,
  bounds,
  classify,
  clipBrush,
  type Plane,
  fitSurface,
  justifySurface,
  setSurface,
  type SurfacePatch,
  hotspotSurface,
  hollowBox,
  type HollowDirection,
  mergeAll,
  translate,
  validate,
  type Brush,
  type BrushRole,
  type V3,
  VoxelField,
  type TileSide,
} from '@cocoaworlds/geometry';
import { create } from 'zustand';
import { modelSlots } from './viewport/models';
import { CHICKEN_EYES } from './viewport/googly-eyes';
import { brushBounds, brushComponent, brushOf, isLocked, isShown, movingTree, newBrushEntity, toLocal, toWorld, worldBrushOf, shapeBrushes, shapeName, worldBrushes, type DrawRole, type Outline, type ShapeOptions } from './brush/brushes';
import { useShallow } from 'zustand/react/shallow';
import type { AssetEntry, AssetKind, OpenedProject, PrefabEntry } from '../shared/api';
import { setAssetProject } from './assets';
import { setProjectPlants } from './viewport/plants';
import { setProjectEffects } from './viewport/vfx';
import { setSurfaceSounds } from './viewport/surface-sounds';
import { addTerrainField, forgetTerrains, saveTerrains, terrainField } from './viewport/terrains';
import { besideTile, newTileBeside } from './viewport/terrain-tiles';
import { materialSheet, projectMaterialDef, setProjectMaterials } from './viewport/project-materials';
import { blockId, emptyScript, newEvent, newStatement, num, recipe as findRecipe, type EventBlock, type Script, type Statement } from '@cocoaworlds/scripting';
import { copyRootOf, recordAllChanges, repivot, syncCommands, unlinked } from './prefabs';
import { DEV_TEXTURE_SIZE } from './brush/materials';
import type { FaceRef } from './viewport/world-render';
import type { LiveChange } from './viewport/engine';
import { cloneSnapshot, isGroup, rootsOf, snapshotSubtrees } from './scene-ops';
import { getLang, setLang, t, type Lang } from './i18n';

export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'brush' | 'face' | 'paint' | 'vertex' | 'clip' | 'loopcut' | 'terrain';

/** The Terrain tool's brush: what it does, how big (u), how strong (0…1), and the layer it paints (0…3). */
export interface TerrainBrush {
  mode: 'raise' | 'lower' | 'smooth' | 'flatten' | 'dig' | 'fill' | 'paint';
  radius: number;
  strength: number;
  layer: number;
}
export type { FaceRef };
export type Justify = 'left' | 'right' | 'top' | 'bottom' | 'center';
export type ViewMode = 'perspective' | 'top' | 'front' | 'side';
/** Grid sizes to snap to (u). */
export const GRID_SIZES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

export type AddKind = 'empty' | 'pointLight' | 'spotLight' | 'sun' | 'spawn' | 'sign' | 'reflectionProbe' | 'poster' | 'painting' | 'stake' | 'junk' | 'carpet' | 'outlet' | 'extender' | 'stringLights' | 'generator' | 'lightSwitch' | 'shelf';
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
  terrainBrush: TerrainBrush;
  view: ViewMode;
  showGrid: boolean;
  /** View › Navigation: where creatures can walk. */
  showNav: boolean;
  /** View › Show grass (the editor only; the game always shows it). */
  showGrass: boolean;
  showProbes: boolean;
  showCollisions: boolean;
  /** Z is up in what the editor shows (as in Blender); the engine stays Y-up. */
  zUp: boolean;
  /** The UV editor open beside the 3D view. */
  uvPane: boolean;
  /** Show the scene's own lighting (lights, sky, fog) in the editor instead of the flat preview lights. */
  gameLighting: boolean;
  showStats: boolean;
  /** The “Playing…” bar over the view while playtesting (F6; kept between sessions). */
  showPlayBar: boolean;
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
  brushRole: DrawRole;
  /** Faces chosen with the face tool. */
  faceSelection: FaceRef[];
  /** Material the paint tool applies. */
  paintMaterial: string;
  /** Materials used lately (paint and face edits), newest first. */
  recentMaterials: string[];
  /** Snap moves and brush drawing to nearby brush corners. */
  vertexSnap: boolean;
  /** Edit pivot mode: the move gizmo moves the selected object's pivot instead of the object. */
  pivotEdit: boolean;
  /** The group the user has stepped into: clicks in the view pick objects inside it. */
  enteredGroup: string | null;
  /** Whether something has been copied (for menu state). */
  canPaste: boolean;
  /** Play mode: a snapshot of the scene being played (the editor's scene is untouched). */
  playing: { scene: SceneFile; startedAt: number; rules: GameRules; values: GameValue[] } | null;
  /** The project's prefabs by id, with their file paths. */
  prefabs: Map<string, PrefabEntry>;
  /** The material picked in the Materials workspace (the asset library can open one there). */
  materialPick: string | null;
  /** Where "place" puts new things: the point the view is looking at (set by the viewport). */
  placementPoint: () => [number, number, number] | null;
  /** An open editor dialog. */
  dialog: 'makePrefab' | 'recipes' | null;
  /** The bottom workspace's open tab. */
  bottomTab: 'script' | 'assets' | 'console' | 'problems';
  /** Which workspace fills the window: the scene (3D view and panels) or the screen UI editor. */
  workspace: 'scene' | 'screens' | 'materials' | 'plants' | 'sky' | 'vfx';
  /** While playing: the blocks each object's script is running (for highlighting). */
  activeBlocks: Map<string, string[]>;
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
  setTerrainBrush(b: Partial<TerrainBrush>): void;
  /** Smooth shading on a brush, or off. */
  setSmooth(id: string, on: boolean): void;
  /** A finished terrain stroke, already made: recorded so it can be undone. */
  terrainEdit(cmd: { label: string; apply(): void; revert(): void }): void;
  setView(v: ViewMode): void;
  toggle(k: 'showGrid' | 'showNav' | 'showGrass' | 'showProbes' | 'showCollisions' | 'zUp' | 'uvPane' | 'showStats' | 'showPlayBar' | 'showBottom' | 'snap' | 'vertexSnap' | 'pivotEdit' | 'gameLighting'): void;
  /** Put an object's pivot at a world position (null: back to the default, its middle). */
  setPivot(id: string, world: Vec3 | null, mergeKey?: string): void;
  execute(cmd: Command): void;
  begin(label: string): void;
  commit(): void;
  /** Drop the open edit, undoing what it changed. */
  cancelEdit(): void;
  undo(): void;
  redo(): void;
  add(kind: AddKind, at?: [number, number, number]): void;
  /** Add the ready-made chicken (its model is copied into the project the first time): an enemy or a friend. */
  addChicken(friendly: boolean, at?: [number, number, number]): Promise<void>;
  /** The ready-made 3D printer: its model (with collision boxes and moving lift, gantry and head) and settings to match. */
  addPrinter(at?: [number, number, number]): Promise<void>;
  /** Ready-made power things with their models (copied into the project the first time): an outlet, a light switch, an extension cord, string lights (and their plug). */
  addPower(kind: 'outlet' | 'lightSwitch' | 'extender' | 'stringLights' | 'shelf', at?: [number, number, number]): Promise<void>;
  /** A ready-made ladder: a Repeat group of rail-and-rung segments with a climbing zone in each, and a top cap. */
  addLadder(at?: [number, number, number]): void;
  /** A new terrain: flat ground 2048 u square, 768 u deep, its surface at `at` (T1). */
  addTerrain(at?: [number, number, number]): void;
  /** A new terrain tile beside this one on `side`, its ground carried on from the shared edge (T2). */
  addTerrainTile(id: string, side: TileSide): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  rename(id: string, name: string): void;
  setTransform(id: string, tr: Transform, mergeKey?: string): void;
  setFlag(id: string, flag: 'visible' | 'locked' | 'keepsGrass', v: boolean): void;
  setEmptyClass(id: string, v: EmptyClass | undefined): void;
  startRename(id: string | null): void;
  frameSelection(): void;
  save(): Promise<boolean>;
  autosave(): Promise<void>;
  recover(accept: boolean): Promise<void>;
  // brushes
  setBrushOptions(o: Partial<ShapeOptions>): void;
  setBrushRole(r: DrawRole): void;
  createBrushes(min: [number, number, number], max: [number, number, number], outline?: Outline): void;
  /** `brush` is in world space. */
  setBrush(id: string, brush: Brush, mergeKey?: string, label?: string): void;
  /** Move a brush and what is inside it by `d` (world units). */
  moveBrush(id: string, d: [number, number, number]): void;
  changeBrushRole(id: string, role: BrushRole): void;
  applySubtract(ids: string[]): void;
  makeHollow(id: string, thickness: number, direction?: HollowDirection): void;
  mergeSelection(): void;
  // faces
  selectFace(ref: FaceRef | null, mode?: 'replace' | 'toggle' | 'brush', cut?: boolean): void;
  selectAllFaces(): void;
  setFaces(patch: SurfacePatch, mergeKey?: string, label?: string): void;
  fitFaces(repeat?: [number, number]): void;
  /** Fit the selected faces into their materials' hotspot rectangles. */
  hotspotFaces(): void;
  /** Change several faces' texture settings at once (each its own), as one undo step merging with `mergeKey`. */
  setFaceSurfaces(changes: { id: string; face: number; patch: SurfacePatch }[], label: string, mergeKey?: string): void;
  justifyFaces(side: Justify): void;
  setPaintMaterial(id: string): void;
  /** Star or unstar a material in the pickers (saved with the project). */
  toggleFavouriteMaterial(id: string): void;
  // multi-object editing, groups, clipboard
  applyLive(changes: LiveChange[]): void;
  clickSelect(id: string | null, additive: boolean, deep: boolean): void;
  boxSelect(ids: string[], additive: boolean): void;
  clipSelection(plane: Plane, keep: 'both' | 'front' | 'back'): void;
  groupSelection(): void;
  ungroupSelection(): void;
  enterGroup(): void;
  stepOut(): boolean;
  copySelection(): void;
  cutSelection(): void;
  paste(): void;
  // prefabs
  openDialog(d: State['dialog']): void;
  loadPrefabs(): Promise<void>;
  /** The project's textures, sounds and models. */
  assets: Record<AssetKind, AssetEntry[]>;
  loadAssets(): Promise<void>;
  /** What in this scene and the project still uses an asset (names, for people). */
  assetUsers(path: string): string[];
  /** Delete an asset (into `assets/_deleted/`, undoable). */
  deleteAsset(path: string): void;
  /** Copy files the user picked into the project's assets; returns the new project paths. */
  importAssets(kind: AssetKind, files: File[]): Promise<string[]>;
  makePrefab(name: string): Promise<boolean>;
  placePrefab(prefabId: string): void;
  /** Add an object showing a model file where the view is looking. */
  placeModel(path: string): void;
  /** The Paint tool clicked a part of a model: paint it (Shift: every part; Ctrl: pick its material up). True if painting. */
  paintModelPart(id: string, slot: string, mode: 'replace' | 'toggle' | 'brush'): boolean;
  /** Pick a material in the Materials workspace (and go there when `open`). */
  pickMaterial(id: string | null, open?: boolean): void;
  revertChange(id: string, path: string | null): void;
  applyChange(id: string, path: string | null): Promise<void>;
  unlinkCopy(id: string): void;
  // play mode
  play(): void;
  stopPlaying(): void;
  /** Switch a built-in game system on or off for the whole project (saved to the project file at once). */
  setGameRule(rule: keyof GameRules, on: boolean): Promise<void>;
  /** Each surface kind's footstep and hit sounds (saved to the project file at once). */
  setSurfaceSounds(next: SurfaceSounds): Promise<void>;
  /** Change the scene's settings (lighting, sky, fog, gravity), with undo. */
  setSceneSettings(patch: Partial<SceneSettings>, label: string, mergeKey?: string): void;
  /** The snapping grid's size (u; saved with the project). */
  setGridSize(size: number): void;
  /** Next finer or coarser grid (×½ or ×2). */
  stepGrid(dir: -1 | 1): void;
  /** Replace the project's game values (saved to the project file at once). */
  setGameValues(values: GameValue[], label: string): Promise<boolean>;
  /** Open another scene of the project (saving this one first). */
  goToScene(scenePath: string): Promise<boolean>;
  /** Add a scene to the project and open it. */
  addScene(name: string): Promise<void>;
  /** The scene the game starts in. */
  setStartScene(scenePath: string): Promise<void>;
  /** Replace the project's materials, with undo (saved to the project file a moment later). */
  setMaterials(materials: MaterialDef[], label: string, mergeKey?: string): void;
  /** The project's plants (Plants workspace), as one undo step. */
  setPlants(plants: PlantDef[], label: string, mergeKey?: string): void;
  /** The project's saved skies (Sky workspace), as one undo step. */
  setSkies(skies: SavedSky[], label: string): void;
  /** The project's effects (VFX workspace), as one undo step (edits with the same key merge). */
  setEffects(effects: VfxEffect[], label: string, mergeKey?: string): void;
  /** A plant object where the view is looking. */
  placePlant(id: string): void;
  /** Change a material without an undo step (baked map paths: they follow the graph, not the user). */
  patchMaterialQuietly(id: string, patch: Partial<MaterialDef>): void;
  setBottomTab(tab: State['bottomTab']): void;
  setWorkspace(w: State['workspace']): void;
  /** Change an object's script (the whole `script` component) as one undo step, merging with `mergeKey`. */
  updateScript(id: string, fn: (s: Script) => Script, label: string, mergeKey?: string): void;
  // components
  addComponent(id: string, name: string): void;
  /** Put a ready-made script (V2) on an object, creating the trigger zone it needs. One undo step. */
  applyRecipe(id: string, recipeId: string): void;
  removeComponent(id: string, name: string): void;
  setComponentField(id: string, name: string, key: string, value: unknown, mergeKey?: string): void;
}

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

let unsubDoc: (() => void) | null = null;
/** Copied objects. Lives for the whole app session, so it also pastes into another project. */
let clipboard: { entities: EntityData[]; pastes: number } | null = null;
let unsubHist: (() => void) | null = null;

/** A short name for new brush entities: block, block_2, … */
/** Smooth shading: faces meeting at up to this angle (degrees) shade as one surface. */
export const SMOOTH_ANGLE = 50;

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
  terrainBrush: { mode: 'raise', radius: 96, strength: 0.5, layer: 1 },
  view: 'perspective',
  showGrid: true,
  showNav: false,
  showGrass: true,
  showProbes: false,
  showCollisions: false,
  zUp: savedZUp(),
  uvPane: false,
  gameLighting: false,
  assets: { textures: [], sounds: [], models: [] },
  showStats: true,
  showPlayBar: savedPlayBar(),
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
  recentMaterials: [],
  vertexSnap: true,
  pivotEdit: false,
  enteredGroup: null,
  canPaste: false,
  playing: null,
  prefabs: new Map(),
  materialPick: null,
  placementPoint: () => null,
  dialog: null,
  bottomTab: 'console',
  workspace: 'scene',
  activeBlocks: new Map(),

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
    set({ prefabs: new Map() });
    void get().loadPrefabs();
    setAssetProject(o.dir);
    forgetTerrains();
    set({ assets: { textures: [], sounds: [], models: [] } });
    void get().loadAssets();
  },

  closeSession() {
    void flushProjectSave();
    unsubDoc?.();
    unsubHist?.();
    unsubDoc = unsubHist = null;
    window.cocoa.window.setDirty(false);
    window.cocoa.window.setTitle('CocoaWorlds');
    set({ session: null, doc: null, selection: [], faceSelection: [], playing: null, dirty: false, recovery: null, history: new History() });
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

  setSmooth(id, on) {
    const doc = get().doc;
    if (doc) get().execute(setComponentCmd(doc, id, 'smooth', on ? { angle: SMOOTH_ANGLE } : undefined, on ? 'Smooth shading' : 'Flat shading'));
  },
  setTerrainBrush: (b) => set((s) => ({ terrainBrush: { ...s.terrainBrush, ...b } })),
  terrainEdit(cmd) {
    get().execute(cmd);
  },
  setTool: (tool) => set((s) => (tool === 'face' || s.tool !== 'face' ? { tool } : { tool, faceSelection: [] })),
  setView: (view) => set({ view }),
  toggle: (k) => {
    set((s) => ({ [k]: !s[k] }) as Partial<State>);
    if (k === 'zUp') saveZUp(get().zUp);
    if (k === 'showPlayBar') {
      try {
        localStorage.setItem('cw.playBar', get().showPlayBar ? '1' : '0');
      } catch {
        /* (Not kept.) */
      }
    }
  },

  execute(cmd) {
    get().history.execute(cmd);
  },
  begin(label) {
    get().history.begin(label);
  },
  commit() {
    get().history.commit();
  },
  cancelEdit() {
    get().history.cancel();
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

  add(kind, at = get().placementPoint() ?? [0, 0, 0]) {
    const doc = get().doc;
    if (!doc) return;
    if (kind === 'outlet' || kind === 'lightSwitch' || kind === 'extender' || kind === 'stringLights' || kind === 'shelf') return void get().addPower(kind, at);
    const base = (name: string, components: EntityData['components'], y = 0) =>
      newEntity(name, components, { position: [at[0], at[1] + y, at[2]] });
    const e: EntityData = {
      empty: () => base('object', {}),
      pointLight: () => base('point_light', { light: { kind: 'point', color: '#ffe8c4', intensity: 1.5, range: 512, castShadows: false } }, 128),
      spotLight: () => base('spot_light', { light: { kind: 'spot', color: '#ffffff', intensity: 2, range: 768, angle: 40, castShadows: true } }, 192),
      sun: () => base('sun', { light: { kind: 'directional', color: '#fff4e0', intensity: 2, castShadows: true } }, 512),
      spawn: () => base('player_spawn', { playerSpawn: {} }),
      reflectionProbe: () => base('reflection_probe', { reflectionProbe: { size: [256, 128, 256] } }, 64),
      sign: () => base('sign', { sign: { text: 'Text', size: 16, color: '#ffffff', background: true, faceCamera: false } }, 64),
      poster: () => base('poster', { poster: { picture: '', width: 32, height: 48, rolls: true, scrollModel: '', scrollScale: 1, scrollCollision: 'cylinder', thickness: 0.5, frame: '#e8e2d4', mass: 0.5, hungAtStart: false } }, 8),
      painting: () => base('painting', { poster: { picture: '', width: 48, height: 36, rolls: false, scrollModel: '', scrollScale: 1, scrollCollision: 'cylinder', thickness: 3, frame: '#5a3d25', mass: 4, hungAtStart: false } }, 24),
      junk: () => base('junk', { model: { collision: 'hull' }, rigidBody: { motion: 'dynamic', mass: 8 }, junk: { packed: '' } }, 24),
      carpet: () => base('carpet', { model: { collision: 'hull' }, rigidBody: { motion: 'dynamic', mass: 6 }, junk: { packed: '' } }, 2),
      outlet: () => base('outlet', {}),
      lightSwitch: () => base('light_switch', {}),
      extender: () => base('extension_cord', {}),
      stringLights: () => base('string_lights', {}),
      shelf: () => base('shelf', {}),
      generator: () => base('generator', { collider: { shape: 'box', size: [32, 24, 24] }, powerSource: { on: true } }, 12),
      stake: () => base('stake', { model: {}, rigidBody: { motion: 'dynamic' }, stake: { tip: 'bottom', speed: 160, depth: 6, tilt: 10 } }, 16),
    }[kind]();
    get().execute(addEntitiesCmd(doc, [e], `Add ${e.name}`));
    set({ selection: [e.id] });
    get().log('info', 'Scene', `Added ${e.name}`);
  },

  addTerrain(at = get().placementPoint() ?? [0, 0, 0]) {
    const doc = get().doc;
    if (!doc) return;
    const name = uniqueName(doc, 'terrain');
    const file = `assets/terrain/${name}_${Date.now().toString(36)}.cwvox`;
    // 129 × 49 × 129 grid points, 16 u apart; the ground 256 u up, so there's room to dig as well as to build.
    const field = new VoxelField([129, 49, 129], 16);
    field.fillFlat(256);
    addTerrainField(file, field);
    const e = newEntity(name, { terrain: { ...defaultComponent('terrain'), file } }, { position: [at[0] - 1024, at[1] - 256, at[2] - 1024] });
    get().execute(addEntitiesCmd(doc, [e], `Add ${name}`));
    set({ selection: [e.id] });
    get().log('info', 'Scene', 'Added a terrain: shape it with the Terrain tool (H)');
  },

  addTerrainTile(id, side) {
    const doc = get().doc;
    const src = doc?.get(id);
    const file = (src?.components.terrain as { file?: string } | undefined)?.file;
    const field = file ? terrainField(file) : null;
    const spot = doc && field ? besideTile(id, doc, side) : null;
    if (!doc || !src || !field || !spot) return;
    if (spot.taken) return get().notify(t('terrain.tileTaken'));
    const name = uniqueName(doc, src.name.replace(/_\d+$/, ''));
    const next = `assets/terrain/${name}_${Date.now().toString(36)}.cwvox`;
    addTerrainField(next, newTileBeside(field, side));
    // (Everything else carries on too: layers, textures, grass.)
    const e = newEntity(name, { ...structuredClone(src.components), terrain: { ...structuredClone(src.components.terrain), file: next } }, { position: spot.position, rotation: [...src.transform.rotation], scale: [...src.transform.scale] });
    e.parent = src.parent;
    get().execute(addEntitiesCmd(doc, [e], `Add ${name}`));
    set({ selection: [e.id] });
    get().log('info', 'Scene', `Added a terrain tile beside ${src.name} (${side})`);
  },

  addLadder(at = get().placementPoint() ?? [0, 0, 0]) {
    const doc = get().doc;
    if (!doc) return;
    const root = newEntity(uniqueName(doc, 'ladder'), { group: {}, repeat: { ...defaultComponent('repeat'), length: 128 } }, { position: [at[0], at[1], at[2]] });
    const seg = newEntity('segment', { group: {} });
    const cap = newEntity('top', { group: {} });
    const part = (name: string, parent: EntityData, a: V3, b: V3, extra: Record<string, unknown> = {}) => {
      const e = newBrushEntity(name, box(a, b), 'solid');
      Object.assign(e.components, extra);
      e.parent = parent.id;
      return e;
    };
    seg.parent = cap.parent = root.id;
    const parts = [
      part('rail_left', seg, [-18, 0, -2], [-14, 32, 2]),
      part('rail_right', seg, [14, 0, -2], [18, 32, 2]),
      part('rung', seg, [-14, 14, -1.5], [14, 17, 1.5]),
      part('climb', seg, [-18, 0, 2], [18, 32, 14], { ladder: defaultComponent('ladder') }),
      part('cap_left', cap, [-18, 32, -2], [-14, 48, 2]),
      part('cap_right', cap, [14, 32, -2], [18, 48, 2]),
    ];
    root.components.repeat = { ...(root.components.repeat as object), segment: seg.id, endCap: cap.id } as never;
    get().execute(addEntitiesCmd(doc, [root, seg, cap, ...parts], `Add ${root.name}`));
    set({ selection: [root.id] });
    get().log('info', 'Scene', 'Added a ladder: drag the blue knob at its top (or set Length) to make it taller');
  },

  async addChicken(friendly, at = get().placementPoint() ?? [0, 0, 0]) {
    const { doc, session } = get();
    if (!doc || !session) return;
    const r = await window.cocoa.projects.addSample(session.dir, 'chicken');
    if (!r.ok) return get().notify(r.error);
    void get().loadAssets();
    const e = newEntity(friendly ? 'chicken_friend' : 'chicken', chickenComponents(r.value.path, friendly), { position: [at[0], at[1], at[2]], scale: [0.5, 0.5, 0.5] });
    get().execute(addEntitiesCmd(doc, [e], `Add ${e.name}`));
    set({ selection: [e.id] });
    get().log('info', 'Scene', `Added a chicken (${friendly ? 'a friend: it follows you when you press E' : 'an enemy: it pecks when you come close'})`);
  },

  async addPrinter(at = get().placementPoint() ?? [0, 0, 0]) {
    const { doc, session } = get();
    if (!doc || !session) return;
    const r = await window.cocoa.projects.addSample(session.dir, 'printer');
    if (!r.ok) return get().notify(r.error);
    void get().loadAssets();
    const e = newEntity('3d_printer', { model: { ...defaultComponent('model'), model: r.value.path, units: 'metres', collision: 'auto' }, printer: defaultComponent('printer') }, { position: [at[0], at[1], at[2]] });
    get().execute(addEntitiesCmd(doc, [e], `Add ${e.name}`));
    set({ selection: [e.id] });
    get().log('info', 'Scene', 'Added a 3D printer (the Print block prints on it)');
  },

  async addPower(kind, at = get().placementPoint() ?? [0, 0, 0]) {
    const { doc, session } = get();
    if (!doc || !session) return;
    const sample = async (name: string) => {
      const r = await window.cocoa.projects.addSample(session.dir, name);
      if (!r.ok) {
        get().notify(r.error);
        return null;
      }
      return r.value.path;
    };
    const model = (path: string, collision: string) => ({ ...defaultComponent('model'), model: path, units: 'metres', collision });
    const pos = (y: number) => ({ position: [at[0], at[1] + y, at[2]] as [number, number, number] });
    let e: EntityData | null = null;
    // (The models' sizes and where their sockets and cable are, in game units: see samples/.)
    if (kind === 'outlet') {
      const m = await sample('outlet');
      if (m) e = newEntity('outlet', { model: model(m, 'box'), outlet: { source: '', sockets: [[0, 0, 0.29]] } }, pos(24));
    } else if (kind === 'lightSwitch') {
      const m = await sample('lightSwitch');
      if (m) e = newEntity('light_switch', { model: model(m, 'box'), powerSource: { on: true } }, pos(40));
    } else if (kind === 'extender') {
      const m = await sample('extensionCord'), plug = await sample('plug');
      if (m && plug)
        e = newEntity(
          'extension_cord',
          { model: model(m, 'hull'), rigidBody: { motion: 'dynamic', mass: 1 }, extender: { cable: 256, sockets: [[0, 3.26, -7.72], [0, 3.26, 2.84], [0, 3.26, 13.35]], cableAt: [0, 1.5, -18.6], plug } },
          pos(0),
        );
    } else if (kind === 'shelf') {
      // (A placeholder model: its red back, the side that goes on the wall, is −Z. Swap in your own.)
      const m = await sample('shelf');
      if (m) e = newEntity('shelf', { model: model(m, 'hull'), rigidBody: { motion: 'dynamic', mass: 3 }, shelf: { mountedAtStart: true } }, pos(48));
    } else {
      const plug = await sample('plug');
      if (plug) e = newEntity('string_lights', { collider: { shape: 'box', size: [12, 8, 12] }, rigidBody: { motion: 'dynamic', mass: 1 }, stringLights: { plug } }, pos(4));
    }
    if (!e) return;
    void get().loadAssets();
    get().execute(addEntitiesCmd(doc, [e], `Add ${e.name}`));
    set({ selection: [e.id] });
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
    // Exactly where the originals are (move the copies after), and selected instead of them.
    const { copies, roots } = cloneSnapshot(doc, snapshotSubtrees(doc, rootsOf(doc, selection)), [0, 0, 0]);
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
  setEmptyClass(id, v) {
    const doc = get().doc;
    if (doc) get().execute(setEmptyClassCmd(doc, id, v));
  },

  startRename: (id) => set({ renaming: id }),
  frameSelection: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),

  async save() {
    const { session, doc, history } = get();
    if (!session || !doc) return false;
    set({ saving: true });
    await flushProjectSave();
    const r = await window.cocoa.projects.saveScene(session.dir, session.scenePath, sceneForSaving(doc, get().prefabs));
    // Terrains keep their shape in their own files, saved with the scene.
    const terrainError = r.ok ? await saveTerrains(session.dir) : null;
    set({ saving: false });
    if (terrainError) {
      get().notify(`${t('error.save')}: ${terrainError}`);
      return false;
    }
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
    const r = await window.cocoa.projects.autosave(session.dir, session.scenePath, sceneForSaving(doc, get().prefabs));
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

  createBrushes(min, max, outline) {
    const { doc, brushOptions, brushRole } = get();
    if (!doc) return;
    let brushes: Brush[];
    try {
      brushes = shapeBrushes(brushOptions, min, max, brushRole, outline);
    } catch (err) {
      get().notify((err as Error).message);
      return;
    }
    if (!brushes.length) return;
    // (A plane is one face, with no inside: nothing to check.)
    const problems = brushOptions.shape === 'plane' ? [] : brushes.flatMap((b) => validate(b));
    if (problems.length) {
      get().notify(`The brush is too small to build (${problems[0]}).`);
      return;
    }
    const base = brushRole === 'subtract' ? 'cut' : brushRole === 'trigger' || brushRole === 'water' || brushRole === 'ladder' ? brushRole : brushRole === 'noRender' ? 'norender' : brushRole === 'collider' ? 'col' : shapeName[brushOptions.shape];
    const ents = brushes.map((b) => {
      const ent = newBrushEntity(uniqueName(doc, base), b, brushRole === 'subtract' ? 'subtract' : 'solid');
      // A trigger zone is a brush with a trigger component; it never becomes level geometry.
      if (brushRole === 'trigger' || brushRole === 'water' || brushRole === 'ladder' || brushRole === 'noRender') ent.components[brushRole] = defaultComponent(brushRole);
      // Round shapes start smooth.
      if (brushRole === 'solid' && (brushOptions.shape === 'cylinder' || brushOptions.shape === 'sphere')) ent.components.smooth = { angle: SMOOTH_ANGLE };
      return ent;
    });
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

  moveBrush(id, d) {
    const doc = get().doc;
    const e = doc?.get(id);
    if (!doc || !e) return;
    get().applyLive(movingTree(doc, e).map((x) => {
      const b = worldBrushOf(doc, x);
      if (b) return { id: x.id, brush: translate(b.brush, d) };
      const w = [...doc.worldMatrix(x.id)];
      w[12] = w[12]! + d[0];
      w[13] = w[13]! + d[1];
      w[14] = w[14]! + d[2];
      return { id: x.id, world: w };
    }));
  },

  setBrush(id, brush, mergeKey, label = 'Edit brush') {
    const doc = get().doc;
    const cur = brushOf(doc?.get(id));
    if (!doc || !cur) return;
    // Tools hand over world-space brushes; the scene keeps them in the brush's own space.
    const local = toLocal(brush, doc.worldMatrix(id));
    get().execute(setComponentCmd(doc, id, 'brush', brushComponent(local, cur.role) as never, label, mergeKey));
  },

  changeBrushRole(id, role) {
    const doc = get().doc;
    const cur = brushOf(doc?.get(id));
    if (!doc || !cur || cur.role === role) return;
    if (role === 'subtract' && cur.brush.mesh) {
      get().notify(meshMsg('subtract'));
      return;
    }
    get().execute(setComponentCmd(doc, id, 'brush', brushComponent(cur.brush, role) as never, role === 'subtract' ? 'Make subtract' : 'Make solid'));
  },

  applySubtract(ids) {
    const doc = get().doc;
    if (!doc) return;
    const subs = ids.filter((id) => brushOf(doc.get(id))?.role === 'subtract');
    if (!subs.length) return;
    if (worldBrushes(doc).some((b) => b.role === 'solid' && b.brush.mesh)) get().log('info', 'Brush', meshMsg('cut'));
    const { replace } = bakeSubtract(worldBrushes(doc), subs);
    const h = get().history;
    h.begin('Apply cut');
    const added: string[] = [];
    for (const [solidId, pieces] of replace) {
      const src = doc.get(solidId)!;
      const space = doc.worldMatrix(solidId);
      const ents = pieces.map((p, i) => {
        const e = newBrushEntity(`${src.name}${pieces.length > 1 ? `_${i + 1}` : ''}`, toLocal(p, space), 'solid');
        e.parent = src.parent;
        e.transform = structuredClone(src.transform);
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
    if (b.brush.mesh) {
      get().notify(meshMsg('hollow'));
      return;
    }
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
    // The walls live in the block's own space, which the group takes over.
    group.transform = structuredClone(e.transform);
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
    const solids = selection.map((id) => ({ id, b: worldBrushOf(doc, doc.get(id)) })).filter((x) => x.b?.role === 'solid');
    if (solids.length < 2) return;
    if (solids.some((x) => x.b!.brush.mesh)) {
      get().notify(meshMsg('merge'));
      return;
    }
    const merged = mergeAll(solids.map((x) => x.b!.brush));
    if (merged.length === solids.length) {
      get().notify('These brushes don’t form a convex shape together, so they stay separate.');
      return;
    }
    const first = doc.get(solids[0]!.id)!;
    const space = doc.worldMatrix(first.id);
    const ents = merged.map((m, i) => {
      const e = newBrushEntity(merged.length > 1 ? `${first.name}_${i + 1}` : first.name, toLocal(m, space), 'solid');
      e.parent = first.parent;
      e.transform = structuredClone(first.transform);
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
      const faces = mode === 'brush' ? b.brush.faces.map((_, i) => i) : [ref.face];
      let painted = setSurface(b.brush, { material: st.paintMaterial }, faces);
      // A hotspot material set to map itself: fitted into its rectangles as it's painted.
      if (projectMaterialDef(st.paintMaterial)?.hotspotAuto) painted = hotspotByMaterial(painted, faces);
      st.execute(setComponentCmd(doc, ref.id, 'brush', brushComponent(painted, b.role) as never, 'Paint'));
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
    if (patch.material) set({ recentMaterials: [patch.material, ...get().recentMaterials.filter((x) => x !== patch.material)].slice(0, 16) });
    applyToFaces(get, (b, faces) => setSurface(b, patch, faces), label, mergeKey);
  },

  fitFaces(repeat = [1, 1]) {
    applyToFaces(get, (b, faces) => fitSurface(b, faces, DEV_TEXTURE_SIZE, repeat), 'Fit texture');
  },

  hotspotFaces() {
    applyToFaces(get, (b, faces) => hotspotByMaterial(b, faces), 'Hotspot fit');
  },

  setFaceSurfaces(changes, label, mergeKey) {
    const doc = get().doc;
    if (!doc || !changes.length) return;
    const byId = new Map<string, { face: number; patch: SurfacePatch }[]>();
    for (const c of changes) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
    const cmds: Command[] = [];
    for (const [id, list] of byId) {
      const cur = brushOf(doc.get(id));
      if (!cur || isLocked(doc, doc.get(id))) continue;
      let b = cur.brush;
      for (const c of list) b = setSurface(b, c.patch, [c.face]);
      cmds.push(setComponentCmd(doc, id, 'brush', brushComponent(b, cur.role) as never, label));
    }
    if (!cmds.length) return;
    get().execute({ label, mergeKey, apply: () => cmds.forEach((c) => c.apply()), revert: () => [...cmds].reverse().forEach((c) => c.revert()) });
  },

  justifyFaces(side) {
    applyToFaces(get, (b, faces) => justifySurface(b, faces, side, DEV_TEXTURE_SIZE), 'Align texture');
  },

  setPaintMaterial(id) {
    set({ paintMaterial: id, recentMaterials: [id, ...get().recentMaterials.filter((x) => x !== id)].slice(0, 16) });
  },

  toggleFavouriteMaterial(id) {
    const s = get().session;
    if (!s) return;
    const now = s.project.settings.favouriteMaterials ?? [];
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    set({ session: { ...s, project: { ...s.project, settings: { ...s.project.settings, favouriteMaterials: next } } }, rev: get().rev + 1 });
    saveProjectSoon(get);
  },

  setPivot(id, world, mergeKey) {
    const doc = get().doc;
    const e = doc?.get(id);
    if (!doc || !e) return;
    if (!world) {
      if (e.components[PIVOT]) get().execute(setComponentCmd(doc, id, PIVOT, undefined, 'Reset pivot'));
      return;
    }
    get().execute(setComponentCmd(doc, id, PIVOT, pivotData(doc, id, world, brushBounds) as never, 'Move pivot', mergeKey));
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
        if (cur) cmds.push(setComponentCmd(doc, c.id, 'brush', brushComponent(toLocal(c.brush, doc.worldMatrix(c.id)), cur.role) as never, 'Transform'));
        // A brush's pivot is kept relative to its middle; after a turn or scale, place it where the gizmo took it.
        if (c.pivot && e.components[PIVOT]) {
          const local = toLocal(c.brush, doc.worldMatrix(c.id));
          const bb = bounds(local);
          const inv = invertMat4(doc.worldMatrix(c.id)) ?? identityMat4();
          const p = applyMat4(inv, c.pivot);
          if (bb) {
            const r = (v: number) => Math.round(v * 1024) / 1024;
            const point = [0, 1, 2].map((k) => r(p[k]! - (bb.min[k]! + bb.max[k]!) / 2));
            cmds.push(setComponentCmd(doc, c.id, PIVOT, { point } as never, 'Transform'));
          }
        }
      } else if (c.world) {
        // A new world placement: express it relative to the parent.
        const inv = invertMat4(doc.parentMatrix(c.id)) ?? identityMat4();
        cmds.push(setTransformCmd(doc, c.id, decomposeMat4(multiplyMat4(inv, c.world))));
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
      pick = outermostGroup(doc, id, entered);
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
    for (const id of roots) for (const c of reparentKeepWorld(doc, id, group.id)) h.execute(c);
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
        for (const cmd of reparentKeepWorld(doc, c.id, parent)) h.execute(cmd);
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

  boxSelect(ids, additive) {
    const { doc, enteredGroup } = get();
    if (!doc) return;
    const picked = [...new Set(ids.map((id) => outermostGroup(doc, id, enteredGroup)))];
    if (!additive) set({ selection: picked });
    else set((s) => ({ selection: [...new Set([...s.selection, ...picked])] }));
  },

  clipSelection(plane, keep) {
    const { doc, selection } = get();
    if (!doc) return;
    const ids = new Set<string>();
    for (const id of selection) for (const e of doc.subtree(id)) ids.add(e.id);
    const h = get().history;
    const result: string[] = [];
    let cut = 0;
    let meshes = 0;
    h.begin('Clip');
    for (const id of ids) {
      const e = doc.get(id);
      const b = worldBrushOf(doc, e);
      if (!e || !b || !isShown(doc, e) || isLocked(doc, e)) continue;
      const space = doc.worldMatrix(id);
      const r = clipBrush(b.brush, plane);
      if (b.brush.mesh && classify(b.brush, plane) === 'spanning') meshes++;
      if (!r.cut) {
        result.push(id);
        continue;
      }
      cut++;
      const kept = keep === 'both' ? [r.front, r.back] : [keep === 'front' ? r.front : r.back];
      const pieces = kept.filter((x): x is Brush => !!x);
      if (!pieces.length) {
        h.execute(deleteEntitiesCmd(doc, [id]));
        continue;
      }
      h.execute(setComponentCmd(doc, id, 'brush', brushComponent(toLocal(pieces[0]!, space), b.role) as never, 'Clip'));
      result.push(id);
      if (pieces[1]) {
        const extra = newBrushEntity(uniqueName(doc, `${e.name}_2`), toLocal(pieces[1], space), b.role);
        extra.parent = e.parent;
        extra.transform = structuredClone(e.transform);
        h.execute(addEntitiesCmd(doc, [extra], 'Clip'));
        result.push(extra.id);
      }
    }
    h.commit();
    if (meshes) get().notify(meshMsg('clip'));
    if (!cut) {
      if (!meshes) get().notify(t('clip.missed'));
      return;
    }
    set({ selection: result.filter((id) => doc.get(id)) });
    get().log('info', 'Brush', `Clipped ${cut} brush(es)`);
  },

  addComponent(id, name) {
    const doc = get().doc;
    const e = doc?.get(id);
    if (!doc || !e || e.components[name]) return;
    const label = componentDef(name)?.label.en ?? name;
    const data = name === 'script' ? emptyScript() : defaultComponent(name);
    // Googly eyes on a plain creature figure: on the front of its head; on the ready-made chicken: over its own eyes
    // (on another model, its head is the user's to find).
    const model = (e.components.model as { model?: string } | undefined)?.model;
    if (name === 'googlyEyes' && model && /(^|\/)chicken_rigged(_\d+)?\.glb$/.test(model)) Object.assign(data, CHICKEN_EYES);
    else if (name === 'googlyEyes' && e.components.npc && !model) Object.assign(data, { offset: [0, 60, -17], size: 11, spacing: 13 });
    get().execute(setComponentCmd(doc, id, name, data as never, `Add ${label}`));
    if (name === 'script') set({ bottomTab: 'script', showBottom: true });
  },

  applyRecipe(id, recipeId) {
    const doc = get().doc;
    const e = doc?.get(id);
    const r = findRecipe(recipeId);
    if (!doc || !e || !r) return;
    // The object's world bounds: every brush inside it, or a small box at its place.
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const x of doc.subtree(id)) {
      const wb = worldBrushOf(doc, x);
      const bb = wb && !x.components.trigger ? bounds(wb.brush) : null;
      if (!bb) continue;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, bb.min[k]!);
        max[k] = Math.max(max[k]!, bb.max[k]!);
      }
    }
    if (!Number.isFinite(min[0])) {
      const m = doc.worldMatrix(id);
      for (let k = 0; k < 3; k++) {
        min[k] = m[12 + k]! - 16;
        max[k] = m[12 + k]! + 16;
      }
    }
    const target = { id, name: e.name, min, max };
    const h = get().history;
    h.begin(`Recipe: ${r.name.en}`);
    let zoneId: string | null = null;
    if (r.zone) {
      const z = r.zone(target);
      const space = e.parent ? doc.worldMatrix(e.parent) : composeTransform(identityTransform());
      const zone = newBrushEntity(uniqueName(doc, z.name), toLocal(box(z.min, z.max), space), 'solid');
      zone.parent = e.parent;
      zone.components.trigger = { ...defaultComponent('trigger'), detects: z.detects, once: z.once } as never;
      h.execute(addEntitiesCmd(doc, [zone]));
      zoneId = zone.id;
    }
    if (r.pivot) h.execute(setComponentCmd(doc, id, PIVOT, pivotData(doc, id, r.pivot(target), brushBounds) as never, 'Recipe hinge'));
    const out = r.build(target, zoneId);
    const cur = (doc.get(id)!.components.script as unknown as Script | undefined) ?? emptyScript();
    const next: Script = {
      ...cur,
      variables: [...cur.variables, ...out.variables.filter((v) => !cur.variables.some((c) => c.name === v.name))],
      handlers: [...cur.handlers, ...out.handlers],
    };
    h.execute(setComponentCmd(doc, id, 'script', next as never, 'Recipe'));
    h.commit();
    set({ selection: [id], bottomTab: 'script', showBottom: true });
    get().log('info', 'Script', `Added “${r.name[getLang()]}” to ${e.name}${zoneId ? ` with a zone (${doc.get(zoneId)?.name})` : ''}`);
  },

  setWorkspace(workspace) {
    set({ workspace });
  },

  setBottomTab(bottomTab) {
    set({ bottomTab, showBottom: true });
  },

  updateScript(id, fn, label, mergeKey) {
    const doc = get().doc;
    const cur = doc?.get(id)?.components.script as unknown as Script | undefined;
    if (!doc || !cur) return;
    const next = fn(cur);
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    get().execute(setComponentCmd(doc, id, 'script', next as never, label, mergeKey));
  },

  removeComponent(id, name) {
    const doc = get().doc;
    if (!doc?.get(id)?.components[name]) return;
    const label = componentDef(name)?.label.en ?? name;
    get().execute(setComponentCmd(doc, id, name, undefined, `Remove ${label}`));
  },

  setComponentField(id, name, key, value, mergeKey) {
    const doc = get().doc;
    const cur = doc?.get(id)?.components[name];
    if (!doc || !cur) return;
    if (JSON.stringify(cur[key]) === JSON.stringify(value)) return;
    const label = componentDef(name)?.label.en ?? name;
    get().execute(setComponentCmd(doc, id, name, { ...cur, [key]: value } as never, `Edit ${label}`, mergeKey));
  },

  play() {
    // The game is seen in the scene's 3D view.
    if (get().workspace !== 'scene') set({ workspace: 'scene' });
    const { doc, playing } = get();
    if (!doc || playing) return;
    get().history.commit();
    set({ playing: { scene: doc.toFile(), startedAt: Date.now(), rules: gameRules(get().session?.project.settings), values: get().session?.project.settings.values ?? [] }, tool: 'select' });
  },

  stopPlaying() {
    if (!get().playing) return;
    set({ playing: null, activeBlocks: new Map() });
    get().log('info', 'Play', 'Stopped. The scene is as it was before Play.');
  },

  setSceneSettings(patch, label, mergeKey) {
    const doc = get().doc;
    if (!doc) return;
    get().execute(setSceneSettingsCmd(doc, patch, label, mergeKey));
  },

  async setGameValues(values, label) {
    const session = get().session;
    if (!session) return false;
    const r = await window.cocoa.projects.saveSettings(session.dir, { ...session.project.settings, values });
    if (!r.ok) {
      get().log('error', 'Project', r.error);
      return false;
    }
    set({ session: { ...get().session!, project: r.value }, rev: get().rev + 1 });
    get().log('info', 'Project', label);
    return true;
  },

  async goToScene(scenePath) {
    const st = get();
    const session = st.session;
    if (!session || session.scenePath === scenePath || st.playing) return false;
    if (st.dirty && !(await st.save())) return false;
    await flushProjectSave();
    const r = await window.cocoa.projects.open(session.dir, scenePath);
    if (!r.ok) {
      get().notify(r.error);
      return false;
    }
    get().openSession(r.value);
    return true;
  },

  async addScene(name) {
    const session = get().session;
    if (!session) return;
    if (get().dirty && !(await get().save())) return;
    await flushProjectSave();
    const r = await window.cocoa.projects.createScene(session.dir, name);
    if (!r.ok) return get().notify(r.error);
    set({ session: { ...get().session!, project: r.value.project } });
    await get().goToScene(r.value.scenePath);
    get().log('info', 'Project', `Added scene ${r.value.scenePath}`);
  },

  async setStartScene(scenePath) {
    const session = get().session;
    if (!session) return;
    await flushProjectSave();
    const r = await window.cocoa.projects.setStartScene(session.dir, scenePath);
    if (!r.ok) return get().notify(r.error);
    set({ session: { ...get().session!, project: { ...r.value, settings: get().session!.project.settings } }, rev: get().rev + 1 });
    get().log('info', 'Project', `The game now starts in ${scenePath}`);
  },

  setMaterials(materials, label, mergeKey) {
    const dir = get().session?.dir;
    if (!dir) return;
    const before = materialsOf(get().session!.project.settings);
    const put = (list: MaterialDef[]) => {
      const s = get().session;
      if (s?.dir !== dir) return;
      set({ session: { ...s, project: { ...s.project, settings: { ...s.project.settings, materials: list } } }, rev: get().rev + 1 });
      saveProjectSoon(get);
    };
    get().execute({ label, mergeKey, apply: () => put(materials), revert: () => put(before) });
  },

  setSkies(list, label) {
    const dir = get().session?.dir;
    if (!dir) return;
    const before = get().session!.project.settings.skies ?? [];
    const put = (next: SavedSky[]) => {
      const s = get().session;
      if (s?.dir !== dir) return;
      set({ session: { ...s, project: { ...s.project, settings: { ...s.project.settings, skies: next } } }, rev: get().rev + 1 });
      saveProjectSoon(get);
    };
    get().execute({ label, apply: () => put(list), revert: () => put(before) });
  },

  setEffects(list, label, mergeKey) {
    const dir = get().session?.dir;
    if (!dir) return;
    const before = effectsOf(get().session!.project.settings);
    const put = (next: VfxEffect[]) => {
      const s = get().session;
      if (s?.dir !== dir) return;
      set({ session: { ...s, project: { ...s.project, settings: { ...s.project.settings, effects: next } } }, rev: get().rev + 1 });
      saveProjectSoon(get);
    };
    get().execute({ label, mergeKey, apply: () => put(list), revert: () => put(before) });
  },

  setPlants(list, label, mergeKey) {
    const dir = get().session?.dir;
    if (!dir) return;
    const before = plantsOf(get().session!.project.settings);
    const put = (next: PlantDef[]) => {
      const s = get().session;
      if (s?.dir !== dir) return;
      set({ session: { ...s, project: { ...s.project, settings: { ...s.project.settings, plants: next } } }, rev: get().rev + 1 });
      saveProjectSoon(get);
    };
    get().execute({ label, mergeKey, apply: () => put(list), revert: () => put(before) });
  },

  patchMaterialQuietly(id, patch) {
    const s = get().session;
    if (!s) return;
    const list = materialsOf(s.project.settings).map((m) => {
      if (m.id !== id) return m;
      const next = { ...m, ...patch };
      for (const k of Object.keys(next) as (keyof MaterialDef)[]) if (next[k] === undefined) delete next[k];
      return next;
    });
    set({ session: { ...s, project: { ...s.project, settings: { ...s.project.settings, materials: list } } }, rev: get().rev + 1 });
    saveProjectSoon(get);
  },

  setGridSize(size) {
    const s = get().session;
    if (!s) return;
    const g = Math.min(512, Math.max(1, size));
    set({ session: { ...s, project: { ...s.project, settings: { ...s.project.settings, gridSize: g } } }, rev: get().rev + 1 });
    saveProjectSoon(get);
  },

  stepGrid(dir) {
    const now = get().session?.project.settings.gridSize ?? 16;
    const i = GRID_SIZES.findIndex((g) => g >= now);
    const at = i < 0 ? GRID_SIZES.length - 1 : i;
    get().setGridSize(GRID_SIZES[Math.min(GRID_SIZES.length - 1, Math.max(0, (GRID_SIZES[at] === now ? at : dir > 0 ? at - 1 : at) + dir))]!);
  },

  async setGameRule(rule, on) {
    const session = get().session;
    if (!session) return;
    const settings = { ...session.project.settings, game: { ...gameRules(session.project.settings), [rule]: on } };
    const r = await window.cocoa.projects.saveSettings(session.dir, settings);
    if (!r.ok) {
      get().log('error', 'Project', r.error);
      return;
    }
    set({ session: { ...get().session!, project: r.value }, rev: get().rev + 1 });
    const what = rule === 'health' ? 'Health' : rule === 'score' ? 'Score' : 'The third-person camera';
    get().log('info', 'Project', `${what} is now ${on ? 'on' : 'off'} for this project.`);
  },

  async setSurfaceSounds(next) {
    const session = get().session;
    if (!session) return;
    const r = await window.cocoa.projects.saveSettings(session.dir, { ...session.project.settings, surfaceSounds: next });
    if (!r.ok) return void get().log('error', 'Project', r.error);
    set({ session: { ...get().session!, project: r.value }, rev: get().rev + 1 });
  },

  openDialog(dialog) {
    set({ dialog });
  },

  async loadAssets() {
    const session = get().session;
    if (!session) return;
    const r = await window.cocoa.projects.listAssets(session.dir);
    if (!r.ok) return get().log('error', 'Assets', r.error);
    if (get().session === session) set({ assets: r.value });
  },

  assetUsers(path) {
    const st = get();
    const out: string[] = [];
    // (Anything that names it: a component field, a face's material, a material's map…)
    const uses = (v: unknown): boolean => (typeof v === 'string' ? v === path : Array.isArray(v) ? v.some(uses) : !!v && typeof v === 'object' && Object.values(v).some(uses));
    for (const e of st.doc?.entities ?? []) if (uses(e.components)) out.push(e.name);
    for (const m of st.session?.project.settings.materials ?? []) if (uses(m)) out.push(`${t('assets.material')} ${m.name}`);
    if (uses(st.doc?.settings)) out.push(t('assets.sceneSettings'));
    return out;
  },

  deleteAsset(path) {
    const session = get().session;
    if (!session) return;
    let trashed: string | null = null;
    const name = path.split('/').pop() ?? path;
    get().execute({
      label: `Delete ${name}`,
      apply: () =>
        void window.cocoa.projects.trashAsset(session.dir, path).then((r) => {
          if (!r.ok) return get().notify(r.error);
          trashed = r.value;
          void get().loadAssets();
        }),
      revert: () => {
        if (!trashed) return;
        const from = trashed;
        trashed = null;
        void window.cocoa.projects.restoreAsset(session.dir, from, path).then((r) => {
          if (!r.ok) return get().notify(r.error);
          void get().loadAssets();
        });
      },
    });
    get().log('info', 'Assets', `Deleted ${path} (kept in assets/_deleted)`);
  },

  async importAssets(kind, files) {
    const session = get().session;
    if (!session) return [];
    const added: string[] = [];
    for (const f of files) {
      const r = await window.cocoa.projects.writeAsset(session.dir, kind, f.name, new Uint8Array(await f.arrayBuffer()));
      if (!r.ok) {
        get().log('error', 'Assets', r.error);
        get().notify(r.error);
        continue;
      }
      added.push(r.value.path);
      get().log('info', 'Assets', `Imported ${f.name} as ${r.value.path}`);
    }
    await get().loadAssets();
    return added;
  },

  async loadPrefabs() {
    const session = get().session;
    if (!session) return;
    const r = await window.cocoa.projects.listPrefabs(session.dir);
    if (!r.ok) {
      get().log('error', 'Prefabs', r.error);
      return;
    }
    for (const p of r.value.problems) get().log('warn', 'Prefabs', p);
    const prefabs = new Map(r.value.prefabs.map((p) => [p.prefab.id, p]));
    set({ prefabs });
    // Copies catch up with prefabs changed since this scene was saved (keeping what each copy changed).
    const doc = get().doc;
    if (!doc || get().session !== session) return;
    const h = get().history;
    let updated = 0;
    h.begin('Update from prefabs');
    for (const { prefab } of prefabs.values()) {
      const { cmds, copies } = syncCommands(doc, prefab, null);
      for (const c of cmds) h.execute(c);
      updated += copies;
    }
    h.commit();
    if (updated) get().log('info', 'Prefabs', `Updated ${updated} cop${updated === 1 ? 'y' : 'ies'} from changed prefabs`);
  },

  async makePrefab(name) {
    const { session, doc, selection } = get();
    if (!session || !doc) return false;
    const roots = rootsOf(doc, selection);
    if (roots.length !== 1) {
      get().notify(t('prefab.oneRoot'));
      return false;
    }
    const rootId = roots[0]!;
    if (copyRootOf(doc, rootId)) {
      get().notify(t('prefab.alreadyCopy'));
      return false;
    }
    // Put the origin at the bottom centre of the contents (nothing moves in the world).
    const moved = new Map(repivot(doc, rootId).map((e) => [e.id, e]));
    const tree = doc.subtree(rootId).map((e) => moved.get(e.id) ?? structuredClone(e));
    const prefab = makePrefabFile(name.trim() || doc.get(rootId)!.name, unlinked(tree), rootId);
    const r = await window.cocoa.projects.savePrefab(session.dir, prefab);
    if (!r.ok) {
      get().notify(`${t('prefab.saveFailed')}: ${r.error}`);
      return false;
    }
    // The source becomes the first copy and takes the prefab's name (later copies are name_2, name_3 …).
    const linked = linkTree(tree, prefab, rootId);
    const taken = new Set(doc.entities.filter((e) => e.id !== rootId).map((e) => e.name));
    let rootName = prefab.name, i = 2;
    while (taken.has(rootName)) rootName = `${prefab.name}_${i++}`;
    linked.find((e) => e.id === rootId)!.name = rootName;
    get().execute(replaceEntitiesCmd(doc, linked, 'Make prefab'));
    set((s) => ({ prefabs: new Map(s.prefabs).set(prefab.id, { path: r.value.path, prefab }) }));
    get().log('info', 'Prefabs', `Made prefab ${prefab.name} (${r.value.path}) from ${tree.length} object(s)`);
    get().notify(t('prefab.made').replace('{name}', prefab.name));
    return true;
  },

  placePlant(id) {
    const { doc } = get();
    const def = plantsOf(get().session?.project.settings).find((p) => p.id === id);
    if (!doc || !def) return;
    const at = get().placementPoint() ?? [0, 0, 0];
    const e = newEntity(uniqueName(doc, def.name.toLowerCase().replace(/\W+/g, '_')), { plant: { plant: id, seed: def.seed } }, { position: [at[0], at[1], at[2]] });
    get().execute(addEntitiesCmd(doc, [e], `Place ${def.name}`));
    set({ selection: [e.id], workspace: 'scene' });
  },

  placeModel(path) {
    const { doc } = get();
    if (!doc) return;
    const at = get().placementPoint() ?? [0, 0, 0];
    const base = path.split('/').pop()!.replace(/\.[^.]+$/, '');
    const e = newEntity(uniqueName(doc, base), { model: { ...defaultComponent('model'), model: path } }, { position: [at[0], at[1], at[2]] });
    get().execute(addEntitiesCmd(doc, [e], `Place ${base}`));
    set({ selection: [e.id] });
  },

  paintModelPart(id, slot, mode) {
    const st = get();
    const e = st.doc?.get(id);
    if (st.tool !== 'paint' || !e?.components.model) return false;
    const data = readComponent<ModelData>('model', e.components.model);
    const now = data.materials ?? {};
    if (mode === 'toggle') {
      if (now[slot]) set({ paintMaterial: now[slot] });
      return true;
    }
    const pm = st.paintMaterial;
    if (!pm.startsWith('mat/')) {
      st.notify(t('model.paintNeedsMaterial'));
      return true;
    }
    const apply = (slots: string[]) => {
      const next = { ...now };
      for (const x of slots) next[x] = pm;
      get().setComponentField(id, 'model', 'materials', next);
    };
    if (mode === 'brush') void modelSlots(data.model).then(apply, () => apply([slot]));
    else apply([slot]);
    return true;
  },

  pickMaterial(id, open) {
    set({ materialPick: id });
    if (open) get().setWorkspace('materials');
  },

  placePrefab(prefabId) {
    const { doc, prefabs } = get();
    const entry = prefabs.get(prefabId);
    if (!doc || !entry) return;
    const at = get().placementPoint() ?? [0, 0, 0];
    const names = new Set(doc.entities.map((e) => e.name));
    let name = entry.prefab.name, i = 2;
    while (names.has(name)) name = `${entry.prefab.name}_${i++}`;
    const ents = instantiate(entry.prefab, null, { position: at, rotation: [0, 0, 0], scale: [1, 1, 1] }, name);
    get().execute(addEntitiesCmd(doc, ents, `Place ${entry.prefab.name}`));
    set({ selection: [ents[0]!.id] });
    get().log('info', 'Prefabs', `Placed ${name}`);
  },

  revertChange(id, path) {
    const { doc, prefabs } = get();
    const e = doc?.get(id);
    const link = linkOf(e);
    const src = link && prefabs.get(link.prefab)?.prefab.entities.find((x) => x.id === link.entity);
    if (!doc || !e || !link || !src) return;
    const paths = path ? [path] : diffPaths(e, src, !!link.root);
    let next = e;
    for (const p of paths) next = revertPath(next, src, p, !!link.root);
    get().execute(replaceEntitiesCmd(doc, [next], path ? 'Revert change' : 'Revert all changes'));
  },

  async applyChange(id, path) {
    const { session, doc, prefabs } = get();
    const e = doc?.get(id);
    const link = linkOf(e);
    const entry = link ? prefabs.get(link.prefab) : undefined;
    const src = entry?.prefab.entities.find((x) => x.id === link!.entity);
    if (!session || !doc || !e || !link || !entry || !src) return;
    const paths = path ? [path] : diffPaths(e, src, !!link.root);
    let nextSrc = src;
    for (const p of paths) nextSrc = applyPathToSource(e, nextSrc, p, !!link.root);
    const next: PrefabFile = { ...entry.prefab, entities: entry.prefab.entities.map((x) => (x.id === src.id ? nextSrc : x)) };
    const r = await window.cocoa.projects.savePrefab(session.dir, next, entry.path);
    if (!r.ok) {
      get().notify(`${t('prefab.saveFailed')}: ${r.error}`);
      return;
    }
    set((s) => ({ prefabs: new Map(s.prefabs).set(next.id, { path: entry.path, prefab: next }) }));
    // Every copy in this scene catches up (each keeps what it changed itself).
    const { cmds, copies } = syncCommands(doc, next, entry.prefab);
    const h = get().history;
    h.begin('Apply to prefab');
    for (const c of cmds) h.execute(c);
    h.commit();
    get().log('info', 'Prefabs', `Applied ${paths.length} change(s) to ${next.name}; ${copies} other cop${copies === 1 ? 'y' : 'ies'} updated`);
  },

  unlinkCopy(id) {
    const doc = get().doc;
    const root = doc ? copyRootOf(doc, id) : null;
    if (!doc || !root) return;
    const prefab = linkOf(root)!.prefab;
    const tree = doc.subtree(root.id).filter((e) => linkOf(e)?.prefab === prefab);
    get().execute(replaceEntitiesCmd(doc, unlinked(tree), 'Unlink prefab copy'));
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

/** Fit faces into their own materials' hotspot rectangles (faces whose material has none are left as they are). */
function hotspotByMaterial(b: Brush, faces: number[]): Brush {
  let out = b;
  for (const face of faces) {
    const id = out.faces[face]?.surface.material;
    const rects = id ? projectMaterialDef(id)?.hotspots : undefined;
    if (rects?.length) out = hotspotSurface(out, [face], rects, materialSheet(id!), face + 1);
  }
  return out;
}

/** What a click on `id` selects: the outermost group around it, unless the user has stepped into that group. */
function outermostGroup(doc: SceneDoc, id: string, entered: string | null): string {
  let pick = id;
  for (let a = doc.get(id)?.parent ?? null; a; a = doc.get(a)?.parent ?? null) {
    if (a === entered) break;
    if (isGroup(doc, doc.get(a))) pick = a;
  }
  return pick;
}

/**
 * Move an entity under a new parent without moving it in the world: its transform (or, for brushes, its
 * faces) is re-expressed in the new parent's space. Returns the commands to run, in order.
 */
export function reparentKeepWorld(doc: SceneDoc, id: string, parent: string | null): Command[] {
  const e = doc.get(id);
  if (!e || e.parent === parent) return [];
  const oldParent = doc.parentMatrix(id);
  const newParent: Mat4 = parent ? doc.worldMatrix(parent) : identityMat4();
  const cmds: Command[] = [];
  const b = brushOf(e);
  if (b) {
    // Brushes keep their own transform; their faces move between parent spaces.
    const own = composeTransform(e.transform);
    const world = toWorld(b.brush, multiplyMat4(oldParent, own));
    cmds.push(setComponentCmd(doc, id, 'brush', brushComponent(toLocal(world, multiplyMat4(newParent, own)), b.role) as never, 'Move in hierarchy'));
  } else {
    const inv = invertMat4(newParent) ?? identityMat4();
    cmds.push(setTransformCmd(doc, id, decomposeMat4(multiplyMat4(inv, multiplyMat4(oldParent, composeTransform(e.transform))))));
  }
  cmds.push(reparentCmd(doc, id, parent));
  return cmds;
}

// Project settings changed in quick succession (dragging a colour) are written once, a moment after the last.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: { dir: string; get: () => State & Actions } | null = null;
let saving: Promise<void> = Promise.resolve();

function saveProjectSoon(get: () => State & Actions): void {
  const dir = get().session?.dir;
  if (!dir) return;
  if (saveTimer) clearTimeout(saveTimer);
  pendingSave = { dir, get };
  saveTimer = setTimeout(() => void flushProjectSave(), 300);
}

/** Write any project settings still waiting (before exporting, closing or quitting). */
export function flushProjectSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const p = pendingSave;
  pendingSave = null;
  const s = p?.get().session;
  if (p && s?.dir === p.dir) {
    // (The settings as they are now: the project may be closed before the write runs.)
    const settings = s.project.settings;
    saving = saving.then(async () => {
      const r = await window.cocoa.projects.saveSettings(p.dir, settings);
      if (!r.ok) p.get().log('error', 'Project', r.error);
    });
  }
  return saving;
}

/** The scene as it goes to disk: prefab copies record what they changed. */
function sceneForSaving(doc: SceneDoc, prefabs: Map<string, PrefabEntry>): SceneFile {
  return recordAllChanges(doc.toFile(), new Map([...prefabs.values()].map((p) => [p.prefab.id, p.prefab])));
}

/** Why a brush operation skipped an edited mesh (decision G4). */
function meshMsg(op: 'subtract' | 'hollow' | 'merge' | 'clip' | 'cut'): string {
  return t('mesh.noOp').replace('{op}', t(`mesh.op.${op}` as const));
}

// The 3D view, Play and previews draw project materials from the open project's list.
let shownMaterials: MaterialDef[] | undefined;
useEditor.subscribe((s) => {
  const list = s.session?.project.settings.materials;
  if (list === shownMaterials) return;
  shownMaterials = list;
  setProjectMaterials(list ?? []);
});
let shownSurfaceSounds: SurfaceSounds | undefined;
useEditor.subscribe((s) => {
  const ss = s.session?.project.settings.surfaceSounds;
  if (ss === shownSurfaceSounds) return;
  shownSurfaceSounds = ss;
  setSurfaceSounds(ss);
});
let shownEffects: VfxEffect[] | undefined;
useEditor.subscribe((s) => {
  const list = s.session?.project.settings.effects;
  if (list === shownEffects) return;
  shownEffects = list;
  setProjectEffects(list ?? []);
});
let shownPlants: PlantDef[] | undefined;
useEditor.subscribe((s) => {
  const list = s.session?.project.settings.plants;
  if (list === shownPlants) return;
  shownPlants = list;
  setProjectPlants(list ?? []);
});

/**
 * The ready-made chicken: its model at half size (set on the object's scale) and a Creature that wanders and
 * pecks at the ground, is clumsy, and runs away when hurt. The enemy pecks the player; the friend follows when
 * used. Everything is ordinary component settings, so it's a starting point to change.
 */
export function chickenComponents(model: string, friendly: boolean): EntityData['components'] {
  return {
    model: { ...defaultComponent('model'), model, collision: 'none' },
    npc: {
      ...defaultComponent('npc'),
      side: friendly ? 'friendly' : 'neutral',
      health: 20,
      speed: 110,
      sight: 640,
      attack: friendly ? 'none' : 'melee',
      damage: 4,
      rate: 1.2,
      reach: 24,
      wander: true,
      // (Running away and turning on the player are in its script, where they can be changed.)
      flee: 'never',
      clumsy: true,
      height: 56,
      radius: 14,
      anims: 'idle, walk, peck, die, run, peck, flap',
    },
    script: chickenScript(friendly) as unknown as EntityData['components'][string],
    googlyEyes: { ...defaultComponent('googlyEyes'), ...CHICKEN_EYES },
  };
}

/**
 * The chicken's behaviour as blocks, so it can be read and changed in the Visual script tab. Both run away when
 * hit; the enemy kind is neutral until the player comes close, then pecks, and calms down once they've gone.
 */
export function chickenScript(friendly: boolean): Script {
  const stack = (event: EventBlock, ...body: Statement[]) => ({ id: blockId(), event, body });
  const near = newEvent('near');
  const far = newEvent('far');
  if (near.kind === 'near') near.distance = num(160);
  if (far.kind === 'far') far.distance = num(400);
  const side = (to: 'hostile' | 'neutral'): Statement => ({ ...(newStatement('setSide') as Extract<Statement, { kind: 'setSide' }>), side: to });
  const runAway = (seconds: number): Statement => ({ ...(newStatement('runAway') as Extract<Statement, { kind: 'runAway' }>), seconds: num(seconds) });
  const handlers = friendly ? [stack(newEvent('hit'), runAway(3))] : [stack(near, side('hostile')), stack(far, side('neutral')), stack(newEvent('hit'), runAway(2))];
  return { ...emptyScript(), handlers };
}

// (For the automated tests, as the view is: `window.__cwStore`.)
(window as unknown as { __cwStore?: typeof useEditor }).__cwStore = useEditor;

/** Whether the playtest bar shows (on unless switched off before). */
function savedPlayBar(): boolean {
  try {
    return localStorage.getItem('cw.playBar') !== '0';
  } catch {
    return true;
  }
}
