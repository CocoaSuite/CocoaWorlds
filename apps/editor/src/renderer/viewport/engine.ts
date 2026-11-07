/**
 * The editor viewport: draws the level, grid and gizmos, handles camera navigation, picking, transform dragging
 * and the brush tool. Renders on demand (only after something changes) so an idle editor costs no GPU time.
 */
import { FrameLog } from './frame-log';
import { SceneReflections, sceneProbes } from './reflections';
import { GroundBlend } from './ground-blend';
import { SceneDoc, expandRepeats, ownerOf, type EntityData, type Transform, type Vec3 } from '@cocoaworlds/core';
import { bevelEdges, bounds, faceAt, loopCut, nearestEdge, transform as transformBrush, translate, vertices, type Brush, type Plane, type V3 } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { setCollisionsVisible } from './models';
import { AoRenderer } from './ao';
import { glassCastsNoShadow } from './glass-shadows';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { brushBounds, brushOf, isLocked, isShown, worldBrushOf, worldBrushes, worldMatrices, type DrawRole, type Outline, type ShapeOptions } from '../brush/brushes';
import { rootsOf } from '../scene-ops';
import { isGroup } from '../scene-ops';
import { PIVOT, REPEAT_AXES, applyMat4, mat4Key, pivotOf, repeatEnd, type Mat4 } from '@cocoaworlds/core';
import { BrushDraft, draftAxes, type DraftState } from './brush-draft';
import { CameraRig, type ViewKind } from './camera';
import { EditorGrid } from './grid';
import { buildMarker, disposeMarker, markerKey, onMarkerLoaded, setMarkerSelected, type Marker } from './markers';
import { WorldRenderer, type FaceRef } from './world-render';
import { tickMaterials } from './project-materials';
import { VertexTool } from './vertex-tool';
import { ClipTool, type ClipKeep, type ClipState } from './clip-tool';
import type { PlayFrame, PlayInfo, PlaySession } from './play-session';
import { GameWorld, initPhysics, type NavGrid, type Travel, type UiState } from '@cocoaworlds/runtime';
import { GAME_KEYS, inputFromKeys, isScriptKey, lookFromMouse } from '../game/controls';
import { hudOf, type Hud } from '../ui/Hud';
import { loadProgress, storeProgress } from '../game/progress';
import { SceneLighting } from './scene-lighting';
import { FOLIAGE_TIME, FoliageRenderer } from './foliage';
import { WaterDepth, waterLookOf } from './water-look';
import { PlantRenderer } from './plants';
import { TerrainRenderer, changed as terrainChanged, remeshTerrain, terrainField } from './terrains';
import { editTiles, tileOf } from './terrain-tiles';
import type { VoxelBox, VoxelTile } from '@cocoaworlds/geometry';


export type { Hud } from '../ui/Hud';

import type { GameRules, GameValue, SceneFile } from '@cocoaworlds/core';

/** Path lines in the editor (cyan, like a route on a map). */
const PATH_LINE = new THREE.LineBasicMaterial({ color: 0x4fd0d6, transparent: true, opacity: 0.9, depthTest: false });

/** The Terrain tool's brush, as the store has it. */
export interface TerrainToolBrush {
  mode: 'raise' | 'lower' | 'smooth' | 'flatten' | 'dig' | 'fill' | 'paint';
  radius: number;
  strength: number;
  layer: number;
}

export interface BevelInfo {
  live: boolean;
  width: number;
  segments: number;
  profile: number;
  /** What's being typed for the width (live only). */
  typed: string;
  /** Mouse sets the profile instead of the width (P). */
  profileMode: boolean;
  /** Brushes that couldn't be bevelled (not convex). */
  refused: number;
}

export interface ViewportCallbacks {
  select(ids: string[], mode: 'replace' | 'toggle'): void;
  /** A click in the view: the store resolves groups (`deep` = double-click, pick the object itself). */
  clickSelect(id: string | null, additive: boolean, deep: boolean): void;
  beginEdit(label: string): void;
  /** A finished Terrain tool stroke (already made), to record for undo. */
  terrainEdit?(cmd: { label: string; apply(): void; revert(): void }): void;
  /** The length handle of a Repeat group was dragged. */
  repeatLength?(id: string, length: number): void;
  /** Live result of a gizmo drag for every moving object. */
  liveMany(changes: LiveChange[]): void;
  endEdit(): void;
  contextMenu(clientX: number, clientY: number, ground: Vec3 | null): void;
  stats(s: ViewportStats): void;
  setFlying(active: boolean): void;
  draft(state: DraftState | null): void;
  createBrush(min: V3, max: V3, outline?: Outline): void;
  cancelTool(): void;
  /** Face tool click: `null` clicks empty space; `cut` is a surface made by a live cut (not editable). */
  selectFace(ref: FaceRef | null, mode: 'replace' | 'toggle' | 'brush', cut?: boolean): void;
  /** A part (material slot) of an object's model was clicked in the face tools; true if that was used (painting). */
  modelPart?(id: string, slot: string, mode: 'replace' | 'toggle' | 'brush'): boolean;
  /** Box selection: every object touching the rectangle. */
  boxSelect(ids: string[], additive: boolean): void;
  /** Vertex tool: how many corners are picked. */
  vertexInfo(count: number): void;
  /** Clip tool: the line drawn so far (null = none). */
  clipState(state: ClipState | null, keep: ClipKeep): void;
  clip(plane: Plane, keep: ClipKeep): void;
  /** A short message for the user (e.g. why a vertex move was refused). */
  message(text: string): void;
  /** Play mode: what happened in the game this frame. */
  playFrame(frame: PlayFrame, names: Map<string, string>): void;
  /** Play mode: the blocks scripts are running (sent a few times a second, only when it changes). */
  activeBlocks(blocks: Map<string, string[]>): void;
  /** Play mode as the player: whether the mouse is captured (false = “click to play”). */
  playerLock(locked: boolean): void;
  /** A screen freed the mouse for its buttons (true) or gave it back (false). */
  uiMouse(free: boolean): void;
  /** Health and score changed (only while playing as the player). */
  hud(hud: Hud | null): void;
  /** Loop cut tool: how many cuts, and whether the cursor is on a brush where a loop fits (null = not on a brush). */
  loopCutState(cuts: number, fits: boolean | null): void;
  /** Loop cut tool: replace this brush (world space) with the cut one. */
  applyLoopCut(id: string, brush: Brush): void;
  /** Drop the open edit and undo what it changed live (a cancelled bevel). */
  cancelEdit?(): void;
  /** Bevel: what it's set to now (`live`: being dragged; otherwise the last one, still adjustable), or null. */
  bevelState?(s: BevelInfo | null): void;
  /** Bevel adjusted after it was made: replace it (one undo step) with these brushes (world space). */
  rebevel?(changes: { id: string; brush: Brush }[]): void;
  /** Edit pivot mode: the pivot was dragged to this world position. */
  livePivot(id: string, world: V3): void;
  /** Play mode: the player left for another scene (a level change). */
  travel(t: Travel): void;
}

/** A live gizmo result: a brush in world space, or an entity's new world placement. */
export interface LiveChange {
  id: string;
  brush?: Brush;
  world?: number[];
  /** Where a brush's own pivot went (world), when it has one and the gizmo turned or scaled it. */
  pivot?: V3;
}

/** What a gizmo drag moves: every selected object and its descendants, as they were when the drag began. */
interface DragSet {
  pivot: V3;
  /** Brushes in world space (with their own pivot, if one is set); other objects by their world matrix. */
  items: { id: string; brush?: Brush; world?: Mat4; pivot?: V3 }[];
  /** Edit pivot mode: only this object's pivot moves. */
  pivotOnly?: string;
  /** Vertex snapping: the moving point nearest the cursor when the drag began. */
  grab: V3 | null;
  /** Screen positions of points that don't move (snap targets). */
  targets: { p: V3; x: number; y: number }[];
}

const SNAP_PX = 12;

export interface ViewportStats {
  frameMs: number;
  /** The world's step in the last frame of Play (ms); null outside Play. */
  worldMs: number | null;
  draws: number;
  triangles: number;
  view: ViewKind;
  /** A background level build is running. */
  building: boolean;
  /** How long the last level build took. */
  buildMs: number;
}

export type GizmoMode = 'none' | 'translate' | 'rotate' | 'scale';

const DEG = THREE.MathUtils.DEG2RAD;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class ViewportEngine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig = new CameraRig();
  private grid = new EditorGrid();
  private world = new WorldRenderer();
  private markers = new Map<string, { m: Marker; key: string }>();
  private gizmo: TransformControls;
  /** Stand-in object the gizmo drags; the selection follows it (brush geometry lives in world space). */
  private proxy = new THREE.Object3D();
  private dragSet: DragSet | null = null;
  private vertexSnap = true;
  private lastPointer = { x: 0, y: 0 };
  private snapMarker: THREE.Points;
  /** Edit pivot mode: the move gizmo moves the selected object's pivot. */
  private pivotEdit = false;
  private pivotMarker = new THREE.Mesh(
    new THREE.OctahedronGeometry(1),
    new THREE.MeshBasicMaterial({ color: 0xffc94a, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  /** Repeat groups: the knob at the far end that sets the length. */
  private repeatHandle = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial({ color: 0x4ad7ff, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  private repeatDrag: { id: string; origin: THREE.Vector3; axis: THREE.Vector3; unit: number; length: number; start: number } | null = null;
  private axisScene = new THREE.Scene();
  private axisCam = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, -10, 10);
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private raf = 0;
  private lastTick = performance.now();
  private keys = new Set<string>();
  private drag: { button: number; x: number; y: number; moved: boolean; mode: 'look' | 'pan' | 'orbit' | 'click' | 'draw' | 'height' | 'box' | 'clip' | 'repeat' | 'terrain'; sx: number; sy: number } | null = null;
  private spaceHeld = false;
  private doc: SceneDoc | null = null;
  private selection: string[] = [];
  private gridSize = 16;
  private snap = true;
  private gizmoMode: GizmoMode = 'none';
  private brushTool = false;
  private faceTool = false;
  /** 'vertex' and 'clip' tools work on the selected brushes; 'loopcut' on the brush under the cursor. */
  private editTool: 'none' | 'vertex' | 'clip' | 'loopcut' = 'none';
  private loopCuts = 1;
  private loopHover: { id: string; brush: Brush } | null = null;
  private loopLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffc94a, depthTest: false, transparent: true }),
  );
  private vertexTool = new VertexTool();
  private clipTool = new ClipTool();
  private marquee: HTMLDivElement;
  private play: PlaySession | null = null;
  private playToken = 0;
  private blockFrames = 0;
  private blockKey = '';
  private previewLights = new THREE.Group();
  private lighting = new SceneLighting();
  private gameLighting = false;
  /** Ambient occlusion (with the scene's own lighting): drawn through a composer for the camera in use. */
  private ao: AoRenderer | null = null;
  private hudKey = '';
  private gridWasVisible = true;
  /** First-person camera while playing as the player. */
  private fpCam = new THREE.PerspectiveCamera(74, 1, 2, 65536);
  private gameKeys = new Set<string>();
  private shapeOpts: ShapeOptions = { shape: 'box', sides: 16, steps: 8, facing: 0 };
  private brushRole: DrawRole = 'solid';
  private draft: BrushDraft | null = null;
  private lastHeight = 128;
  private worldKey = '';
  /** World matrix of every entity, refreshed on each scene change. */
  private mats = new Map<string, Mat4>();
  private disposed = false;
  private resizeObs: ResizeObserver;

  constructor(
    private readonly host: HTMLElement,
    private readonly cb: ViewportCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1f1f1f);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    glassCastsNoShadow(this.renderer);
    // (Glass draws what's behind it once more each frame: at half size, which the blur hides.)
    this.renderer.transmissionResolutionScale = 0.5;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false; // count the whole frame, not just the last pass
    this.renderer.domElement.className = 'cw-canvas';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '3D viewport');
    host.prepend(this.renderer.domElement);

    this.world.onUpdate = () => {
      this.applySelection();
      this.invalidate();
    };
    onMarkerLoaded(() => this.invalidate());
    this.scene.add(this.grid.object, this.world.group, this.proxy, this.vertexTool.group, this.clipTool.group);
    this.vertexTool.group.visible = false;
    this.marquee = document.createElement('div');
    this.marquee.className = 'cw-marquee';
    this.marquee.hidden = true;
    host.append(this.marquee);
    {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      this.snapMarker = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff5b8a, size: 11, sizeAttenuation: false, depthTest: false, transparent: true }));
      this.snapMarker.renderOrder = 20;
      this.snapMarker.visible = false;
      this.snapMarker.frustumCulled = false;
      this.scene.add(this.snapMarker);
    }
    this.pivotMarker.renderOrder = 21;
    this.pivotMarker.visible = false;
    this.scene.add(this.pivotMarker);
    this.scene.add(this.foliage.group);
    this.scene.add(this.terrains.group);
    this.scene.add(this.plants.group);
    this.repeatHandle.renderOrder = 21;
    this.repeatHandle.visible = false;
    this.repeatHandle.name = 'repeat-handle';
    this.scene.add(this.repeatHandle);
    // Editor preview lighting: flat and even, for building. The scene's own lighting replaces it in Play and
    // when “Game lighting” is on.
    this.previewLights.add(new THREE.HemisphereLight(0xe8eef5, 0x3a3530, 1.4));
    const key = new THREE.DirectionalLight(0xfff6ea, 1.6);
    key.position.set(0.45, 1, 0.3);
    this.previewLights.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    fill.position.set(-0.6, 0.4, -0.8);
    this.previewLights.add(fill);
    this.scene.add(this.previewLights, this.lighting.group);
    this.lighting.group.visible = false;

    this.gizmo = new TransformControls(this.rig.camera, this.renderer.domElement);
    this.gizmo.setSpace('world');
    this.gizmo.setSize(0.9);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('change', () => this.invalidate());
    this.gizmo.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      if (dragging) {
        if (this.editTool === 'vertex') {
          this.cb.beginEdit('Move corners');
          this.vertexTool.beginDrag();
          this.dragSet = this.buildVertexDragSet();
          return;
        }
        this.dragSet = this.buildDragSet();
        this.cb.beginEdit(this.dragSet?.pivotOnly ? 'Move pivot' : this.gizmoMode === 'rotate' ? 'Rotate' : this.gizmoMode === 'scale' ? 'Scale' : 'Move');
      } else {
        this.dragSet = null;
        this.snapMarker.visible = false;
        if (this.editTool === 'vertex') {
          this.vertexTool.endDrag();
          const why = this.vertexTool.lastRefusal;
          if (why) this.cb.message(why);
          else if (this.vertexTool.madeMesh) this.cb.message('mesh');
        }
        this.cb.endEdit();
        this.placeProxy();
      }
    });
    this.gizmo.addEventListener('objectChange', () => this.onProxyGizmo());

    this.buildAxisGizmo();
    this.bindInput();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.loop();
  }

  // ── public API used by the React wrapper ──

  /** Show the scene's own lighting in the editor (Play always does). */
  setGameLighting(on: boolean): void {
    this.gameLighting = on;
    this.invalidate();
  }

  private boundsKey = '';
  private editBounds = new THREE.Box3();

  /** Scene lighting in Play and with “Game lighting”; flat preview lighting otherwise. */
  private updateLighting(): void {
    const on = !!this.play || this.gameLighting;
    this.previewLights.visible = !on;
    this.lighting.group.visible = on;
    if (!on || !this.doc) {
      this.scene.background = null;
      this.scene.fog = null;
      return;
    }
    // (The extent is measured again only when the level changed; in Play, from what stays put.)
    let bounds: THREE.Box3;
    if (this.play) bounds = this.play.levelBounds();
    else {
      const key = `${this.world.shapeVersion}|${this.world.group.children.length}`;
      if (key !== this.boundsKey) {
        this.boundsKey = key;
        this.editBounds.setFromObject(this.world.group);
      }
      bounds = this.editBounds;
    }
    this.lighting.update(this.doc, (id) => this.mats.get(id) ?? this.doc!.worldMatrix(id), bounds, this.scene);
    this.play?.driveLights(this.lighting);
    this.lighting.setDay(this.play ? this.play.dayHour : null);
    this.lighting.applyTo(this.scene);
  }

  setDoc(doc: SceneDoc | null): void {
    this.doc = doc;
    // (Never the key of any scene, an empty one included: a new doc always rebuilds the level.)
    this.worldKey = '\u0000new';
    this.syncAll();
  }

  /** Re-read entities from the doc (called after any scene change). */
  syncAll(): void {
    // What is shown: the scene with Repeat groups built out (their copies are drawn, never saved).
    const doc = this.doc ? this.shownDoc(this.doc) : null;
    // (Grass follows once a drag ends: placing it again on every step of a drag would hold the drag up.)
    if (!this.dragSet && !this.stroke) this.foliage.sync(doc);
    this.terrains.sync(doc);
    this.plants.sync(doc);
    if (this.navOn) this.queueNav();
    this.mats = doc ? worldMatrices(doc) : new Map();
    const seen = new Set<string>();
    if (doc) {
      for (const e of doc.entities) {
        if (e.components.brush || isGroup(doc, e)) continue;
        seen.add(e.id);
        this.syncEntity(e);
      }
    }
    for (const [id, rec] of this.markers) {
      if (!seen.has(id)) {
        if (this.gizmo.object === rec.m.group) this.gizmo.detach();
        rec.m.group.removeFromParent();
        disposeMarker(rec.m);
        this.markers.delete(id);
      }
    }
    this.syncPaths();
    // Rebuild level geometry only when brushes actually changed.
    const wb = doc ? worldBrushes(doc) : [];
    // Faces and where each brush sits (a moved group moves its brushes without touching their faces).
    // (A water body's look counts too: it's drawn with it.)
    const key = wb.map((b) => `${b.id}:${b.role}:${faceKey(doc!.get(b.id)!)}:${mat4Key(this.mats.get(b.id) ?? [])}${b.role === 'water' ? JSON.stringify(doc!.get(b.id)!.components.water ?? '') : ''}:${b.smooth ?? 0}:${b.cuts?.join(',') ?? '*'}`).join('|');
    if (key !== this.worldKey) {
      this.worldKey = key;
      this.world.waterLookOf = (id) => waterLookOf(doc, id);
      this.world.rebuild(wb);
      if (this.reflections) this.reflections.dirty = true;
    }
    this.applySelection();
    this.invalidate();
  }

  /** The scene as drawn: with Repeat groups' copies (the doc itself when there are none). */
  private shownDoc(doc: SceneDoc): SceneDoc {
    if (!doc.entities.some((e) => e.components.repeat)) return doc;
    return new SceneDoc(expandRepeats(doc.toFile(), brushBounds));
  }

  /** Lines from each path point to the next (arrows halfway), so routes can be seen while editing. */
  private pathLines: THREE.LineSegments | null = null;
  private syncPaths(): void {
    const pts: number[] = [];
    const doc = this.doc;
    for (const e of doc?.entities ?? []) {
      const next = (e.components.pathPoint as { next?: string } | undefined)?.next;
      if (!next || !doc!.get(next)) continue;
      const a = this.mats.get(e.id), b = this.mats.get(next);
      if (!a || !b) continue;
      const [ax, ay, az, bx, by, bz] = [a[12]!, a[13]!, a[14]!, b[12]!, b[13]!, b[14]!];
      pts.push(ax, ay, az, bx, by, bz);
      // An arrowhead in the middle, pointing along the path.
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, by - ay, dz) || 1;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      const ux = dx / len, uz = dz / len, s = 10;
      pts.push(mx, my, mz, mx - ux * s - uz * s * 0.6, my, mz - uz * s + ux * s * 0.6, mx, my, mz, mx - ux * s + uz * s * 0.6, my, mz - uz * s - ux * s * 0.6);
    }
    this.pathLines?.removeFromParent();
    this.pathLines?.geometry.dispose();
    this.pathLines = null;
    if (!pts.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.pathLines = new THREE.LineSegments(g, PATH_LINE);
    this.pathLines.name = 'paths';
    this.pathLines.renderOrder = 9;
    this.scene.add(this.pathLines);
  }

  setSelection(ids: string[]): void {
    if (ids.join() !== this.selection.join() && !this.bevel) this.forgetBevel();
    this.selection = ids;
    this.applySelection();
    this.invalidate();
  }

  setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.applySelection();
    this.invalidate();
  }

  setFaceTool(active: boolean): void {
    if (this.faceTool === active) return;
    this.faceTool = active;
    if (!active) this.world.setFaceSelection([]);
    this.renderer.domElement.style.cursor = active ? 'pointer' : '';
    this.applySelection();
    this.invalidate();
  }

  setFaceSelection(refs: FaceRef[]): void {
    this.world.setFaceSelection(this.faceTool ? refs : []);
    this.invalidate();
  }

  setBrushTool(active: boolean, opts: ShapeOptions, role: DrawRole): void {
    this.brushTool = active;
    this.shapeOpts = opts;
    this.brushRole = role;
    if (!active) this.cancelDraft();
    else if (this.draft) {
      this.draft.update(opts, role);
      this.invalidate();
    }
    this.renderer.domElement.style.cursor = active ? 'crosshair' : '';
    this.applySelection();
  }

  /** Numbers typed into the brush panel. */
  setDraftBounds(min: V3, max: V3): void {
    if (!this.draft) return;
    this.draft.setBounds(min, max);
    this.draft.update(this.shapeOpts, this.brushRole);
    this.cb.draft(this.draft.state());
    this.invalidate();
  }

  confirmDraft(): void {
    const d = this.draft;
    if (!d || d.stage !== 'height') return;
    const { min, max } = d.bounds();
    const e = draftAxes(this.rig.kind).e;
    this.lastHeight = Math.abs(max[e]! - min[e]!) || this.lastHeight;
    const outline = d.outline() ?? undefined;
    this.cancelDraft();
    this.cb.createBrush(min, max, outline);
  }

  cancelDraft(): void {
    if (!this.draft) return;
    this.scene.remove(this.draft.group);
    this.draft.dispose();
    this.draft = null;
    this.drag = null;
    this.showSnap(null);
    this.cb.draft(null);
    this.invalidate();
  }

  // ── Play mode ──

  /** A level change is loading the next scene. */
  private travelling = false;

  /** Go on playing in another scene (a level change): the same game, from where the last scene left the player. */
  travelTo(scene: SceneFile, t: Travel, rules?: GameRules, values?: GameValue[]): Promise<PlayInfo> {
    this.travelling = true;
    return this.startPlay(scene, rules, values, this.saveId ?? undefined, t);
  }

  get playing(): boolean {
    return !!this.play;
  }

  /** Build a game world from a scene snapshot and show it instead of the editor's scene. */
  async startPlay(scene: SceneFile, rules?: GameRules, values?: GameValue[], saveId?: string, arrive?: Travel | null): Promise<PlayInfo> {
    this.stopPlay();
    const token = ++this.playToken;
    // Physics (and its WebAssembly) loads on first Play, so opening the editor stays quick.
    const { PlaySession } = await import('./play-session');
    // Saved progress (kept values and items) carries over from the last Play of this project.
    this.saveId = saveId ?? null;
    this.playArgs = { scene, rules, values };
    const session = await PlaySession.start(scene, (name) => this.world.material(name), rules, values, saveId ? loadProgress(saveId) : null, arrive);
    if (token !== this.playToken || this.disposed) {
      // Stopped while loading.
      session.dispose();
      return session.info;
    }
    this.play = session;
    this.queueNav(0);
    // Heard from where it's seen: the player's eyes, or the editor camera in a physics preview.
    session.setEars(session.info.player ? this.fpCam : this.rig.camera);
    this.cancelDraft();
    this.gizmo.detach();
    this.world.group.visible = false;
    this.vertexTool.group.visible = false;
    this.clipTool.group.visible = false;
    this.snapMarker.visible = false;
    for (const { m } of this.markers.values()) m.group.visible = false;
    this.gridWasVisible = this.grid.object.visible;
    this.grid.object.visible = false;
    this.scene.add(session.group);
    this.lastTick = performance.now();
    if (session.info.player && !arrive) {
      this.gameKeys.clear();
      this.cb.playerLock(false);
      this.lockPointer();
    } else if (arrive) this.sendInput();
    this.travelling = false;
    this.invalidate();
    return session.info;
  }

  stopPlay(): void {
    this.playToken++;
    const p = this.play;
    if (!p) return;
    this.saveProgress();
    this.play = null;
    this.warmed = null;
    this.queueNav(0);
    this.hudKey = '';
    this.cb.hud(null);
    this.gameKeys.clear();
    if (this.uiFree) {
      this.uiFree = false;
      this.cb.uiMouse(false);
    }
    // (A level change keeps the mouse captured: the game goes straight on in the next scene.)
    if (!this.travelling && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.scene.remove(p.group);
    p.dispose();
    this.world.group.visible = true;
    this.grid.object.visible = this.gridWasVisible;
    this.vertexTool.group.visible = this.editTool === 'vertex';
    this.clipTool.group.visible = this.editTool === 'clip';
    this.syncAll();
  }

  // ── Playing as the player ──

  private get asPlayer(): boolean {
    return !!this.play?.info.player;
  }

  private get locked(): boolean {
    return document.pointerLockElement === this.renderer.domElement;
  }

  /** “Click to play”. */
  capturePlayer(): void {
    if (this.uiFree) {
      // Back from the pause Esc gave a menu.
      if (this.uiPaused) {
        this.uiPaused = false;
        this.cb.uiMouse(true);
      }
      return;
    }
    if (this.asPlayer) this.lockPointer();
  }

  /** What Play was started with (Load in the save menu starts it again). */
  private playArgs: { scene: SceneFile; rules?: GameRules; values?: GameValue[] } | null = null;

  /** The save menu: save now (false: scripts block it). */
  saveGame(): boolean {
    const p = this.play;
    if (!p || !this.saveId || p.savingBlocked) return false;
    p.saveNow();
    this.saveProgress();
    return true;
  }

  /** The save menu: back to the save (false: blocked, or there is none). */
  async loadGame(): Promise<boolean> {
    const p = this.play, a = this.playArgs;
    if (!p || !a || !this.saveId || p.savingBlocked || !loadProgress(this.saveId)) return false;
    await this.startPlay(a.scene, a.rules, a.values, this.saveId);
    return true;
  }

  /** When the save was made (ms since 1970), or null. */
  get savedAt(): number | null {
    const p = this.saveId ? loadProgress(this.saveId) : null;
    return p ? (p.at ?? 0) || null : null;
  }

  /** Where Play keeps saved progress (the project's id), and what was kept last. */
  private saveId: string | null = null;
  private savedKey = '';
  private saveAt = 0;

  private saveProgress(): void {
    if (!this.play || !this.saveId) return;
    const p = this.play.progress();
    const key = JSON.stringify(p);
    if (key === this.savedKey) return;
    this.savedKey = key;
    // (Nothing kept: leave what an earlier Play kept alone, in case a value is switched back on.)
    if (p) storeProgress(this.saveId, p);
  }

  /** A shown screen has freed the mouse for its buttons (the view stops turning; keys still move). */
  private uiFree = false;
  /** Esc was pressed while a screen had freed the mouse: paused (“Click to play”); Esc again stops. */
  private uiPaused = false;

  /** Free the mouse when a screen asks for it, and take it back when no screen does. */
  private followUiMouse(free: boolean): void {
    if (!this.asPlayer || free === this.uiFree) return;
    this.uiFree = free;
    this.uiPaused = false;
    this.cb.uiMouse(free);
    if (free) {
      if (this.locked) document.exitPointerLock();
      // (A lock asked for before, still on its way, is let go of when it comes.)
      else this.dropLock = true;
    } else this.lockPointer();
  }

  /** A pointer lock asked for before a screen freed the mouse: let go of it as soon as it arrives. */
  private dropLock = false;

  /** The player clicked a button on screen. */
  clickUi(id: string): void {
    this.play?.clickUi(id);
  }

  /** The player picked a row of a list on screen. */
  pickRow(list: string, row: string): void {
    this.play?.pickRow(list, row);
  }

  private lockPointer(): void {
    this.dropLock = false;
    const el = this.renderer.domElement;
    el.focus();
    try {
      // (Refused without a user gesture, e.g. when Play started from the keyboard; a click then captures it.)
      const r = el.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* not allowed right now */
    }
  }

  private rotating = false;

  private onLockChange = (): void => {
    if (this.locked && this.dropLock) {
      this.dropLock = false;
      document.exitPointerLock();
      return;
    }
    this.rotating = false;
    if (!this.locked) this.play?.setInput({ fire: false });
    if (!this.asPlayer) return;
    if (!this.locked && !this.uiFree) {
      this.gameKeys.clear();
      this.sendInput();
    }
    this.cb.playerLock(this.locked);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.asPlayer || !this.locked || !this.play) return;
    if (this.rotating && this.play.holding) return this.play.rotateHeld(e.movementX, e.movementY);
    const look = lookFromMouse(this.play.look, e.movementX, e.movementY);
    if (look) this.play.setInput(look);
  };

  private sendInput(): void {
    this.play?.setInput(inputFromKeys(this.gameKeys));
  }

  /** Returns true when the key was the game's. */
  private gameKey(e: KeyboardEvent, down: boolean): boolean {
    if (!this.asPlayer || !(this.locked || (this.uiFree && !this.uiPaused && this.play))) return false;
    // (With the mouse freed by a screen there is nothing else to type into, so the keys stay the game's.)
    if (e.key === 'Escape' && !this.locked) {
      // In a menu: the first Esc pauses (as it frees the mouse when it is captured); the next one stops.
      if (!down) return true;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.uiPaused = true;
      this.gameKeys.clear();
      this.sendInput();
      this.cb.uiMouse(false);
      return true;
    }
    if (e.key === 'Escape') {
      // First Esc lets go of the mouse; the next one (or Stop) ends the game.
      e.preventDefault();
      e.stopImmediatePropagation();
      document.exitPointerLock();
      return true;
    }
    // F5 still stops the game.
    if (e.key === 'F5') return false;
    // Otherwise every key belongs to the game (Ctrl+S, Ctrl+Z… would be surprising mid-jump).
    e.preventDefault();
    e.stopImmediatePropagation();
    // 1–9 pick a hotbar slot.
    if (down && /^Digit[1-9]$/.test(e.code)) {
      this.play?.selectSlot(Number(e.code.slice(5)) - 1);
      return true;
    }
    // R held with something in hand: the mouse turns it instead of the view.
    if (e.code === 'KeyR' && (this.rotating || this.play?.holding)) {
      this.rotating = down;
      return true;
    }
    if (!GAME_KEYS.has(e.code)) {
      // Other letters and Tab are for “When the player presses”.
      if (down && !e.repeat && isScriptKey(e.code)) this.play?.pressKey(e.code);
      return true;
    }
    if (down && e.code === 'KeyE' && !e.repeat) this.play?.use();
    if (down) this.gameKeys.add(e.code);
    else this.gameKeys.delete(e.code);
    this.sendInput();
    return true;
  }

  /** Edit pivot mode (O): the move gizmo moves the pivot of the one selected object. */
  setPivotEdit(on: boolean): void {
    this.pivotEdit = on;
    if (!this.dragSet) this.placeProxy();
    this.applySelection();
    this.invalidate();
  }

  /** The object whose pivot the gizmo moves, in edit pivot mode. */
  private pivotTarget(): string | null {
    if (!this.pivotEdit || this.editTool !== 'none' || this.brushTool || this.faceTool || this.play) return null;
    const items = this.movable();
    return items.length === 1 ? items[0]!.id : null;
  }

  private showPivotMarker(): void {
    const id = this.pivotTarget();
    this.pivotMarker.visible = !!id && !!this.doc;
    if (!id || !this.doc) return;
    if (!this.dragSet) this.pivotMarker.position.set(...pivotOf(this.doc, id, brushBounds));
    // About 7 pixels across whatever the zoom.
    const d = this.rig.kind === 'perspective' ? this.pivotMarker.position.distanceTo(this.rig.camera.position) * 0.006 : this.rig.unitsPerPixel * 7;
    this.pivotMarker.scale.setScalar(Math.max(0.5, d));
  }

  /** The selected Repeat group (one, while editing), or null. */
  private repeatTarget(): string | null {
    if (this.play || this.selection.length !== 1 || !this.doc) return null;
    const id = this.selection[0]!;
    return this.doc.get(id)?.components.repeat ? id : null;
  }

  private showRepeatHandle(): void {
    const id = this.repeatTarget();
    const end = id && this.doc ? repeatEnd(this.doc, id, brushBounds) : null;
    this.repeatHandle.visible = !!end;
    if (!end || !id || !this.doc) return;
    this.repeatHandle.position.set(...(applyMat4(this.doc.worldMatrix(id), end) as V3));
    const d = this.rig.kind === 'perspective' ? this.repeatHandle.position.distanceTo(this.rig.camera.position) * 0.005 : this.rig.unitsPerPixel * 5;
    this.repeatHandle.scale.setScalar(Math.max(0.5, d));
  }

  /** Where along the dragged Repeat axis the mouse ray passes closest (world units from the drag origin). */
  private repeatAlong(e: { clientX: number; clientY: number }, r: { origin: THREE.Vector3; axis: THREE.Vector3 }): number {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const a = r.origin.clone().addScaledVector(r.axis, -1e5);
    const b = r.origin.clone().addScaledVector(r.axis, 1e5);
    const on = new THREE.Vector3();
    this.raycaster.ray.distanceSqToSegment(a, b, undefined, on);
    return on.sub(r.origin).dot(r.axis);
  }

  /** Starts a length drag if the mouse is on the Repeat handle. */
  private startRepeatDrag(e: PointerEvent): boolean {
    const id = this.repeatTarget();
    if (!id || !this.doc || !this.repeatHandle.visible) return false;
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    if (!this.raycaster.intersectObject(this.repeatHandle).length) return false;
    const g = this.doc.get(id)!;
    const rep = g.components.repeat as { axis?: keyof typeof REPEAT_AXES; length?: number };
    const m = this.doc.worldMatrix(id);
    const o = applyMat4(m, [0, 0, 0]);
    const tip = applyMat4(m, REPEAT_AXES[rep.axis ?? 'up'] as Vec3);
    const axis = new THREE.Vector3(tip[0] - o[0], tip[1] - o[1], tip[2] - o[2]);
    const unit = axis.length() || 1;
    axis.divideScalar(unit);
    const r = { id, origin: this.repeatHandle.position.clone(), axis, unit, length: rep.length ?? 128, start: 0 };
    r.start = this.repeatAlong(e, r);
    this.repeatDrag = r;
    this.cb.beginEdit('Repeat length');
    return true;
  }

  setVertexSnap(enabled: boolean): void {
    this.vertexSnap = enabled;
  }

  setSnap(enabled: boolean, gridSize: number): void {
    this.snap = enabled;
    this.gridSize = gridSize;
    // Translation snapping is done relative to the drag start in onProxyGizmo.
    this.gizmo.setTranslationSnap(null);
    this.gizmo.setRotationSnap(enabled ? 15 * DEG : null);
    this.gizmo.setScaleSnap(enabled ? 0.25 : null);
    this.grid.update(gridSize, this.rig.unitsPerPixel);
    this.invalidate();
  }

  private navOn = false;
  private navTimer: ReturnType<typeof setTimeout> | null = null;
  private navDraw: THREE.Group | null = null;
  /** Grass tufts (Foliage component). */
  private foliage = new FoliageRenderer(() => this.invalidate());
  /** Voxel terrains (T1). */
  readonly terrains = new TerrainRenderer(() => this.invalidate());
  /** Plant objects. */
  readonly plants = new PlantRenderer(() => this.invalidate());
  /** The scene's depth without water, for the water's look. */
  private waterDepth = new WaterDepth();

  /** View › Navigation: draw where creatures can walk (worked out again a moment after each change). */
  setNavVisible(on: boolean): void {
    this.navOn = on;
    this.queueNav(0);
  }

  private queueNav(delay = 600): void {
    if (this.navTimer) clearTimeout(this.navTimer);
    this.navTimer = null;
    if (!this.navOn) return this.showNav(null);
    this.navTimer = setTimeout(() => void this.buildNav(), delay);
  }

  private async buildNav(): Promise<void> {
    this.navTimer = null;
    let nav: NavGrid | null = null;
    if (this.play) nav = this.play.navigation();
    else if (this.doc) {
      await initPhysics();
      if (!this.doc || this.play) return;
      // (Measured in a throwaway game world built from the scene as it is now.)
      const w = GameWorld.create(expandRepeats(this.doc.toFile(), brushBounds));
      try {
        nav = w.navigation();
      } finally {
        w.dispose();
      }
    }
    if (this.navOn) this.showNav(nav);
  }

  private showNav(nav: NavGrid | null): void {
    if (this.navDraw) {
      this.scene.remove(this.navDraw);
      this.navDraw.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      this.navDraw = null;
    }
    if (nav?.count) {
      const g = new THREE.Group();
      g.name = 'navigation';
      const lift = (a: Float32Array) => {
        for (let i = 1; i < a.length; i += 3) a[i]! += 1;
        return a;
      };
      const pts = new THREE.BufferGeometry();
      pts.setAttribute('position', new THREE.BufferAttribute(lift(nav.xyz.slice()), 3));
      g.add(new THREE.Points(pts, new THREE.PointsMaterial({ color: 0x6fdc8c, size: 3, sizeAttenuation: false })));
      const links = nav.links();
      const seg = new Float32Array(links.length * 6);
      links.forEach(([a, b], k) => {
        seg.set(nav.xyz.subarray(a * 3, a * 3 + 3), k * 6);
        seg.set(nav.xyz.subarray(b * 3, b * 3 + 3), k * 6 + 3);
      });
      const lines = new THREE.BufferGeometry();
      lines.setAttribute('position', new THREE.BufferAttribute(lift(seg), 3));
      g.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x3fae62, transparent: true, opacity: 0.5 })));
      g.userData.spots = nav.count;
      this.navDraw = g;
      this.scene.add(g);
    }
    this.invalidate();
  }

  // ── Terrain tool (T1) ──

  private terrainBrush: TerrainToolBrush | null = null;
  private terrainCursor = (() => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    ring.renderOrder = 22;
    ring.visible = false;
    ring.name = 'terrain-cursor';
    return ring;
  })();
  private stroke: {
    id: string;
    /** The terrains it shapes: the one under the brush, or every tile of its set (a stroke runs across seams). */
    parts: { id: string; file: string; tile: VoxelTile; origin: V3; density: Float32Array; weights: Uint8Array; box: VoxelBox | null }[];
    /** Not a tile: the terrain's own placement (it may be turned). */
    holder: THREE.Object3D | null;
    level: number;
    at: THREE.Vector3 | null;
    timer: ReturnType<typeof setInterval>;
  } | null = null;

  /** The Terrain tool's brush (null: the tool is off). */
  setTerrainTool(brush: TerrainToolBrush | null): void {
    this.terrainBrush = brush;
    if (!this.terrainCursor.parent) this.scene.add(this.terrainCursor);
    if (!brush) this.terrainCursor.visible = false;
    this.invalidate();
  }

  /** The terrain under the cursor: where, its object, and the surface's facing. */
  private terrainHit(e: { clientX: number; clientY: number }): { point: THREE.Vector3; normal: THREE.Vector3; mesh: THREE.Mesh; id: string } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const hit = this.raycaster.intersectObjects(this.terrains.meshes, false)[0];
    const id = hit?.object.userData.terrain as string | undefined;
    if (!hit || !id || (this.doc && isLocked(this.doc, this.doc.get(id)))) return null;
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { point: hit.point.clone(), normal, mesh: hit.object as THREE.Mesh, id };
  }

  /** Show the brush ring on the ground under the cursor. */
  private showTerrainCursor(e: { clientX: number; clientY: number }): void {
    const b = this.terrainBrush;
    const h = b ? this.terrainHit(e) : null;
    this.terrainCursor.visible = !!h;
    if (h && b) {
      this.terrainCursor.position.copy(h.point).addScaledVector(h.normal, 1);
      this.terrainCursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.normal);
      this.terrainCursor.scale.setScalar(b.radius);
      (this.terrainCursor.material as THREE.MeshBasicMaterial).color.set(b.mode === 'dig' || b.mode === 'lower' ? 0xff8a6a : b.mode === 'paint' ? 0xffd27a : 0xffffff);
    }
    this.invalidate();
  }

  /** Begin a stroke where the cursor is on a terrain (false: not on one). */
  private startStroke(e: PointerEvent): boolean {
    const h = this.terrainHit(e);
    if (!h || !this.doc) return false;
    const file = (this.doc.get(h.id)?.components.terrain as { file?: string } | undefined)?.file;
    const field = file ? terrainField(file) : null;
    if (!file || !field) return false;
    const tile = tileOf(h.id);
    const holder = h.mesh.parent!;
    const snap = (t: VoxelTile) => ({ density: t.field.density.slice(), weights: t.field.weights.slice(), box: null });
    const parts = tile
      ? [...tile.set.values()].map((t) => ({ id: t.id, file: t.file, tile: t, origin: t.origin, ...snap(t) }))
      : [{ id: h.id, file, tile: { field, i: 0, j: 0 }, origin: [0, 0, 0] as V3, ...snap({ field, i: 0, j: 0 }) }];
    this.stroke = {
      id: h.id,
      parts,
      holder: tile ? null : holder,
      level: holder.worldToLocal(h.point.clone()).y,
      at: h.point,
      // (Held still, the brush keeps working.)
      timer: setInterval(() => this.stroke?.at && this.dab(this.stroke.at), 50),
    };
    this.dab(h.point);
    return true;
  }

  private strokeMove(e: PointerEvent): void {
    const s = this.stroke;
    if (!s) return;
    this.showTerrainCursor(e);
    const h = this.terrainHit(e);
    // (Digging moves the ground away from under the cursor: keep to where the stroke was if nothing's hit.)
    if (h && s.parts.some((p) => p.id === h.id)) s.at = h.point;
    if (s.at) this.dab(s.at);
  }

  /** One touch of the brush at a world point. */
  private dab(at: THREE.Vector3): void {
    const s = this.stroke, b = this.terrainBrush;
    if (!s || !b) return;
    const c = s.holder ? s.holder.worldToLocal(at.clone()) : at;
    const k = b.strength;
    const boxes = editTiles(
      s.parts,
      [c.x, c.y, c.z],
      (f, p) => (b.mode === 'paint' ? f.paint(b.layer, p, b.radius, k * 0.3) : f.sculpt(b.mode, p, b.radius, b.mode === 'raise' || b.mode === 'lower' ? k * 0.25 : k * 0.5, s.level)),
      (file, f, box) => terrainChanged(file, f.chunksIn(box)),
    );
    for (const p of s.parts) {
      const box = boxes.get(p.tile);
      if (box) p.box = p.box ? { min: p.box.min.map((v, i) => Math.min(v, box.min[i]!)) as V3, max: p.box.max.map((v, i) => Math.max(v, box.max[i]!)) as V3 } : box;
    }
  }

  /** The stroke is done: one undo step for all of it (every tile it shaped). */
  private endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    clearInterval(s.timer);
    const done = s.parts.flatMap((p) => {
      if (!p.box) return [];
      const f = p.tile.field;
      // (A cell's width more: the neighbouring tiles draw these points too.)
      const wide = { min: p.box.min.map((v) => Math.max(0, v - 1)) as V3, max: p.box.max.map((v, i) => Math.min(f.n[i]! - 1, v + 1)) as V3 };
      return [{ f, tile: p.tile, file: p.file, before: f.saveFrom(p.density, p.weights, p.box), after: f.save(p.box), chunks: f.chunksIn(wide) }];
    });
    if (!done.length) return;
    const mode = this.terrainBrush?.mode ?? 'raise';
    const put = (which: 'before' | 'after') => {
      for (const d of done) d.f.restore(d[which]);
      for (const d of done) terrainChanged(d.file, d.chunks);
      // (Tiles beside the ones changed draw a cell's width of them: mesh those again whole.)
      for (const p of s.parts) if (done.some((d) => d.tile !== p.tile && Math.abs(d.tile.i - p.tile.i) <= 1 && Math.abs(d.tile.j - p.tile.j) <= 1)) remeshTerrain(p.file, null);
    };
    this.cb.terrainEdit?.({ label: `Terrain: ${mode}`, apply: () => put('after'), revert: () => put('before') });
  }

  /** View › Show grass: hides the editor's grass (Play still shows it). */
  setGrassVisible(v: boolean): void {
    this.foliage.group.visible = v;
    this.invalidate();
  }

  setGridVisible(v: boolean): void {
    this.grid.object.visible = v;
    this.invalidate();
  }

  setView(kind: ViewKind): void {
    this.cancelDraft();
    this.rig.setView(kind);
    this.gizmo.camera = this.rig.camera;
    this.grid.orient(kind);
    this.grid.update(this.gridSize, this.rig.unitsPerPixel);
    this.invalidate();
  }

  /** Where to place new things: the level surface (or ground) in the middle of the view, on the grid. */
  focusPoint(): [number, number, number] {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = this.drawPoint({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    this.showSnap(null);
    if (p) return p;
    const t = this.rig.target;
    return [this.snapV(t.x), 0, this.snapV(t.z)];
  }

  frameSelection(): void {
    const box = new THREE.Box3();
    const addBrush = (id: string) => {
      const bb = bounds(this.world.brush(id)?.brush ?? { faces: [] });
      if (bb) box.expandByPoint(new THREE.Vector3(...bb.min)).expandByPoint(new THREE.Vector3(...bb.max));
    };
    for (const id of this.expandedSelection()) {
      const rec = this.markers.get(id);
      if (rec) box.expandByObject(rec.m.group);
      else addBrush(id);
    }
    if (box.isEmpty()) {
      for (const { m } of this.markers.values()) box.expandByObject(m.group);
      for (const b of this.world.all) addBrush(b.id);
    }
    this.rig.frame(box);
    this.grid.update(this.gridSize, this.rig.unitsPerPixel);
    this.invalidate();
  }

  /** World statistics for the status overlay. */
  get worldStats() {
    return this.world.stats;
  }

  invalidate(): void {
    this.needsRender = true;
  }

  /** Move the pupils of shown googly eyes on by `dt`. True: some moved (draw again). */
  private tickEyes(dt: number): boolean {
    let moved = false;
    for (const { m } of this.markers.values()) {
      if (!m.eyes || !m.group.visible) continue;
      if (m.eyes.update(dt)) moved = true;
    }
    return moved;
  }

  dispose(): void {
    this.disposed = true;
    this.foliage.dispose();
    this.terrains.dispose();
    this.plants.dispose();
    this.waterDepth.dispose();
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.unbindInput();
    this.cancelDraft();
    this.stopPlay();
    this.gizmo.detach();
    this.gizmo.dispose();
    for (const { m } of this.markers.values()) disposeMarker(m);
    this.world.dispose();
    this.vertexTool.dispose();
    this.clipTool.dispose();
    this.marquee.remove();
    this.grid.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ── scene sync ──

  private syncEntity(e: EntityData): void {
    const key = markerKey(e);
    let rec = this.markers.get(e.id);
    if (!rec || rec.key !== key) {
      if (rec) {
        if (this.gizmo.object === rec.m.group) this.gizmo.detach();
        rec.m.group.removeFromParent();
        disposeMarker(rec.m);
      }
      rec = { m: buildMarker(e), key };
      this.markers.set(e.id, rec);
      this.scene.add(rec.m.group);
    }
    const g = rec.m.group;
    if (!(this.gizmo.dragging && this.gizmo.object === g)) {
      // Markers sit where their whole parent chain puts them.
      const m = new THREE.Matrix4().fromArray(this.mats.get(e.id) ?? new THREE.Matrix4().toArray());
      m.decompose(g.position, g.quaternion, g.scale);
    }
    g.visible = !this.play && isShown(this.doc!, e);
    g.userData.locked = isLocked(this.doc!, e);
  }

  private applySelection(): void {
    const expanded = this.expandedSelection();
    const sel = new Set(expanded);
    for (const [id, { m }] of this.markers) setMarkerSelected(m, sel.has(id));
    this.world.setSelection(expanded);
    this.refreshEditTools();
    let target: THREE.Object3D | null = null;
    if (this.play) {
      this.gizmo.detach();
      return;
    }
    if (this.editTool === 'vertex') {
      if (this.vertexTool.count) {
        if (!this.dragSet) this.placeProxy();
        target = this.proxy;
      }
    } else if (this.editTool === 'none' && this.movable().length && (this.gizmoMode !== 'none' || this.pivotTarget()) && !this.brushTool && !this.faceTool) {
      if (!this.dragSet) this.placeProxy();
      target = this.proxy;
    }
    this.showPivotMarker();
    this.showRepeatHandle();
    if (target) {
      if (this.gizmo.object !== target) this.gizmo.attach(target);
      this.gizmo.setMode(this.editTool === 'vertex' || this.gizmoMode === 'none' || this.pivotTarget() ? 'translate' : this.gizmoMode);
    } else if (this.gizmo.object) {
      this.gizmo.detach();
    }
  }

  /** Put the gizmo stand-in at the centre of the selected brush, unrotated and unscaled. */
  /** Selected ids plus all their descendants (selecting a group selects what's inside it). */
  private expandedSelection(): string[] {
    const doc = this.doc;
    if (!doc) return [];
    const out = new Set<string>();
    for (const id of this.selection) for (const e of doc.subtree(id)) out.add(e.id);
    return [...out];
  }

  /** The objects a gizmo drag would move: visible, unlocked, and actually something in space. */
  /** The top-level selected objects a gizmo drag moves (their contents follow through the hierarchy). */
  private movable(): EntityData[] {
    const doc = this.doc;
    if (!doc) return [];
    return rootsOf(doc, this.selection)
      .map((id) => doc.get(id))
      .filter((e): e is EntityData => !!e && isShown(doc, e) && !isLocked(doc, e) && this.occupiesSpace(e));
  }

  /** Brushes, markers, and groups/parents that contain at least one of those. */
  private occupiesSpace(e: EntityData): boolean {
    return !!this.doc?.subtree(e.id).some((x) => !!x.components.brush || this.markers.has(x.id));
  }

  /** Everything inside the given objects (themselves included). */
  private contents(items: EntityData[]): EntityData[] {
    const doc = this.doc;
    if (!doc) return [];
    const seen = new Map<string, EntityData>();
    for (const e of items) for (const x of doc.subtree(e.id)) if (isShown(doc, x)) seen.set(x.id, x);
    return [...seen.values()];
  }

  private worldPos(e: EntityData): V3 {
    const m = this.mats.get(e.id) ?? this.doc?.worldMatrix(e.id);
    return m ? [m[12]!, m[13]!, m[14]!] : [...e.transform.position];
  }

  private selectionBox(items: EntityData[]): THREE.Box3 {
    const box = new THREE.Box3();
    for (const e of this.contents(items)) {
      const b = this.doc ? worldBrushOf(this.doc, e, this.mats.get(e.id)) : null;
      if (b) {
        const bb = bounds(b.brush);
        if (bb) box.expandByPoint(new THREE.Vector3(...bb.min)).expandByPoint(new THREE.Vector3(...bb.max));
      } else if (this.markers.has(e.id)) {
        box.expandByPoint(new THREE.Vector3(...this.worldPos(e)));
      }
    }
    return box;
  }

  private placeProxy(): void {
    if (this.editTool === 'vertex') {
      const c = this.vertexTool.centre();
      if (!c) return;
      this.proxy.position.set(...c);
      this.proxy.rotation.set(0, 0, 0);
      this.proxy.scale.set(1, 1, 1);
      this.proxy.updateMatrixWorld();
      return;
    }
    const items = this.movable();
    if (!items.length) return;
    // One object: its pivot. Several: the middle of them all.
    const c = items.length === 1 && this.doc ? new THREE.Vector3(...pivotOf(this.doc, items[0]!.id, brushBounds)) : this.selectionBox(items).getCenter(new THREE.Vector3());
    this.proxy.position.copy(c);
    this.proxy.rotation.set(0, 0, 0);
    this.proxy.scale.set(1, 1, 1);
    this.proxy.updateMatrixWorld();
  }

  /** The selected brushes the vertex and clip tools work on. */
  /** Selected brushes (including those inside selected groups) in world space, for the vertex and clip tools. */
  private editBrushes(): { id: string; brush: Brush }[] {
    const doc = this.doc;
    const out: { id: string; brush: Brush }[] = [];
    if (!doc) return out;
    for (const id of this.expandedSelection()) {
      const e = doc.get(id);
      if (!e || !isShown(doc, e) || isLocked(doc, e)) continue;
      const b = worldBrushOf(doc, e, this.mats.get(id));
      if (b) out.push({ id, brush: b.brush });
    }
    return out;
  }

  private refreshEditTools(): void {
    if (this.editTool === 'vertex') {
      this.vertexTool.setBrushes(this.editBrushes());
      this.cb.vertexInfo(this.vertexTool.count);
    } else if (this.editTool === 'clip') {
      this.clipTool.setBrushes(this.editBrushes());
    }
  }

  private buildVertexDragSet(): DragSet {
    const pivot: V3 = [this.proxy.position.x, this.proxy.position.y, this.proxy.position.z];
    const set: DragSet = { pivot, items: [], grab: null, targets: [] };
    if (!this.vertexSnap) return set;
    const picked = this.vertexTool.pickedPoints();
    let best = Infinity;
    for (const p of picked) {
      const sp = this.toScreen(p);
      const d = Math.hypot(sp.x - this.lastPointer.x, sp.y - this.lastPointer.y);
      if (d < best) {
        best = d;
        set.grab = p;
      }
    }
    const isPicked = (p: V3) => picked.some((q) => Math.abs(q[0] - p[0]) < 1e-3 && Math.abs(q[1] - p[1]) < 1e-3 && Math.abs(q[2] - p[2]) < 1e-3);
    const all = (this.doc?.entities ?? []).filter((e) => e.components.brush && isShown(this.doc!, e));
    for (const p of this.pointsOf(all)) {
      if (isPicked(p)) continue;
      const sp = this.toScreen(p);
      if (sp.z < 1) set.targets.push({ p, x: sp.x, y: sp.y });
    }
    return set;
  }

  // ── vertex and clip tools (public) ──

  setEditTool(tool: 'none' | 'vertex' | 'clip' | 'loopcut'): void {
    if (this.editTool === tool) return;
    if (this.bevel) this.endBevel(false);
    this.forgetBevel();
    if (this.editTool === 'loopcut') this.showLoop(null);
    if (this.editTool === 'clip') {
      this.clipTool.clear();
      this.cb.clipState(null, this.clipTool.keep);
    }
    if (this.editTool === 'vertex') this.vertexTool.clearPicks();
    this.editTool = tool;
    this.vertexTool.group.visible = tool === 'vertex';
    this.clipTool.group.visible = tool === 'clip';
    this.renderer.domElement.style.cursor = tool === 'clip' || tool === 'loopcut' ? 'crosshair' : '';
    if (tool === 'loopcut') this.cb.loopCutState(this.loopCuts, null);
    this.applySelection();
    this.invalidate();
  }

  // ── loop cut ──

  /** Preview the ring of new edges for the brush under the pointer. */
  private updateLoop(e: { clientX: number; clientY: number }): void {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const hit = this.world.pick(this.raycaster, true);
    const wb = hit && this.doc && !isLocked(this.doc, this.doc.get(hit.entityId)) ? this.world.brush(hit.entityId) : undefined;
    if (!hit || !wb) {
      this.showLoop(null);
      this.cb.loopCutState(this.loopCuts, null);
      return;
    }
    const edge = nearestEdge(wb.brush, [hit.point.x, hit.point.y, hit.point.z]);
    const r = edge ? loopCut(wb.brush, edge[0], edge[1], this.loopCuts) : null;
    this.showLoop(r ? { id: hit.entityId, brush: r.brush, lines: r.lines } : null);
    this.cb.loopCutState(this.loopCuts, !!r);
  }

  private showLoop(p: { id: string; brush: Brush; lines: [V3, V3][] } | null): void {
    this.loopHover = p ? { id: p.id, brush: p.brush } : null;
    const g = new THREE.BufferGeometry();
    if (p) g.setAttribute('position', new THREE.Float32BufferAttribute(p.lines.flatMap(([a, b]) => [...a, ...b]), 3));
    this.loopLines.geometry.dispose();
    this.loopLines.geometry = g;
    this.loopLines.renderOrder = 10;
    if (p && !this.loopLines.parent) this.scene.add(this.loopLines);
    if (!p) this.scene.remove(this.loopLines);
    this.invalidate();
  }

  setLoopCuts(n: number): void {
    this.loopCuts = Math.max(1, Math.min(32, Math.round(n)));
    if (this.editTool === 'loopcut') {
      if (this.loopHover) this.updateLoop({ clientX: this.lastPointer.x, clientY: this.lastPointer.y });
      else this.cb.loopCutState(this.loopCuts, null);
    }
  }

  setClipKeep(k: ClipKeep): void {
    this.clipTool.setKeep(k);
    this.cb.clipState(this.clipTool.state, k);
    this.invalidate();
  }

  applyClip(): void {
    const p = this.clipTool.plane();
    if (!p) return;
    const keep = this.clipTool.keep;
    this.clipTool.clear();
    this.cb.clipState(null, keep);
    this.cb.clip(p, keep);
    this.invalidate();
  }

  cancelClip(): void {
    this.clipTool.clear();
    this.cb.clipState(null, this.clipTool.keep);
    this.invalidate();
  }

  private buildDragSet(): DragSet | null {
    const items = this.movable();
    if (!items.length) return null;
    const pivot: V3 = [this.proxy.position.x, this.proxy.position.y, this.proxy.position.z];
    const only = this.pivotTarget();
    if (only) {
      // Edit pivot: snap the pivot to any corner, the object's own included (a door's hinge edge).
      const set: DragSet = { pivot, items: [], pivotOnly: only, grab: this.vertexSnap ? pivot : null, targets: [] };
      if (this.vertexSnap) {
        for (const p of this.pointsOf((this.doc?.entities ?? []).filter((e) => isShown(this.doc!, e)))) {
          const sp = this.toScreen(p);
          if (sp.z < 1) set.targets.push({ p, x: sp.x, y: sp.y });
        }
      }
      return set;
    }
    const inside = this.contents(items);
    const moving = new Set(inside.map((e) => e.id));
    const set: DragSet = {
      pivot,
      items: items.map((e) => {
        const b = this.doc ? worldBrushOf(this.doc, e, this.mats.get(e.id)) : null;
        if (!b) return { id: e.id, world: [...(this.mats.get(e.id) ?? this.doc!.worldMatrix(e.id))] };
        return e.components[PIVOT] ? { id: e.id, brush: b.brush, pivot: pivotOf(this.doc!, e.id, brushBounds) } : { id: e.id, brush: b.brush };
      }),
      grab: null,
      targets: [],
    };
    if (this.vertexSnap && this.gizmoMode === 'translate') {
      // The grab point: the moving point nearest the cursor. Targets: every point that stays put.
      let best = Infinity;
      for (const p of this.pointsOf(inside)) {
        const sp = this.toScreen(p);
        const d = Math.hypot(sp.x - this.lastPointer.x, sp.y - this.lastPointer.y);
        if (d < best) {
          best = d;
          set.grab = p;
        }
      }
      const others = (this.doc?.entities ?? []).filter((e) => isShown(this.doc!, e) && !moving.has(e.id));
      for (const p of this.pointsOf(others)) {
        const sp = this.toScreen(p);
        if (sp.z < 1) set.targets.push({ p, x: sp.x, y: sp.y });
      }
    }
    return set;
  }

  /** Brush corners and point-entity positions. */
  private pointsOf(items: EntityData[]): V3[] {
    const out: V3[] = [];
    for (const e of items) {
      const b = this.doc ? worldBrushOf(this.doc, e, this.mats.get(e.id)) : null;
      if (b) out.push(...vertices(b.brush));
      else if (this.markers.has(e.id)) out.push(this.worldPos(e));
    }
    return out;
  }

  /** Client-space pixel position (z > 1 = behind the camera or beyond the far plane). */
  private toScreen(p: V3): { x: number; y: number; z: number } {
    const v = new THREE.Vector3(...p).project(this.rig.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, z: v.z };
  }

  /** The nearest snap target to a client point within SNAP_PX, if any. */
  private nearestTarget(targets: { p: V3; x: number; y: number }[], x: number, y: number): V3 | null {
    let best: V3 | null = null;
    let bestD = SNAP_PX;
    for (const t of targets) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bestD) {
        bestD = d;
        best = t.p;
      }
    }
    return best;
  }

  private showSnap(p: V3 | null): void {
    this.snapMarker.visible = !!p;
    if (p) {
      (this.snapMarker.geometry.getAttribute('position') as THREE.BufferAttribute).set(p).needsUpdate = true;
    }
  }

  private onProxyGizmo(): void {
    const d = this.dragSet;
    if (!d) return;
    const p = this.proxy;
    const changes: LiveChange[] = [];
    if (this.editTool === 'vertex' || this.gizmoMode === 'translate') {
      let delta: V3 = [p.position.x - d.pivot[0], p.position.y - d.pivot[1], p.position.z - d.pivot[2]];
      // Grid snapping is relative to where the drag began, so off-grid objects keep their offset.
      const axes = (this.gizmo as unknown as { axis: string | null }).axis ?? 'XYZ';
      const free = [axes.includes('X'), axes.includes('Y'), axes.includes('Z')];
      if (this.snap) delta = delta.map((v, i) => (free[i] ? Math.round(v / this.gridSize) * this.gridSize : 0)) as V3;
      let snapped: V3 | null = null;
      if (d.grab) {
        const target = this.nearestTarget(d.targets, this.lastPointer.x, this.lastPointer.y);
        if (target) {
          delta = delta.map((v, i) => (free[i] ? target[i]! - d.grab![i]! : v)) as V3;
          snapped = target;
        }
      }
      this.showSnap(snapped);
      p.position.set(d.pivot[0] + delta[0], d.pivot[1] + delta[1], d.pivot[2] + delta[2]);
      if (d.pivotOnly) {
        this.cb.livePivot(d.pivotOnly, [d.pivot[0] + delta[0], d.pivot[1] + delta[1], d.pivot[2] + delta[2]]);
        this.pivotMarker.position.copy(p.position);
        return;
      }
      if (this.editTool === 'vertex') {
        for (const b of this.vertexTool.dragTo(delta)) changes.push({ id: b.id, brush: b.brush });
      }
      for (const it of d.items) {
        if (it.brush) changes.push({ id: it.id, brush: translate(it.brush, delta) });
        else if (it.world) {
          const w = [...it.world];
          w[12] = w[12]! + delta[0];
          w[13] = w[13]! + delta[1];
          w[14] = w[14]! + delta[2];
          changes.push({ id: it.id, world: w });
        }
      }
    } else {
      p.updateMatrixWorld();
      const m = new THREE.Matrix4().copy(p.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(-d.pivot[0], -d.pivot[1], -d.pivot[2]));
      for (const it of d.items) {
        if (it.brush) {
          const pv = it.pivot ? (applyMat4(m.elements as unknown as Mat4, it.pivot) as V3) : undefined;
          changes.push({ id: it.id, brush: transformBrush(it.brush, m.elements as unknown as number[]), pivot: pv });
        } else if (it.world) changes.push({ id: it.id, world: new THREE.Matrix4().fromArray(it.world).premultiply(m).toArray() });
      }
    }
    this.cb.liveMany(changes);
  }


  // ── rendering ──

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
    this.fpCam.aspect = w / h;
    this.fpCam.updateProjectionMatrix();
    this.grid.update(this.gridSize, this.rig.unitsPerPixel);
    this.invalidate();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const interval = now - this.lastTick;
    const dt = Math.min(0.05, interval / 1000);
    this.lastTick = now;
    let tickMs = 0;
    if (this.drag?.mode === 'look' && this.keys.size) {
      const v = new THREE.Vector3(
        (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
        (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0),
        (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
      );
      if (v.lengthSq()) {
        this.rig.fly(v, dt, this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
        this.invalidate();
      }
    }
    if (this.play) {
      const frame = this.play.tick(dt);
      tickMs = performance.now() - now;
      const travel = this.play.travel;
      if (travel && !this.travelling) {
        this.travelling = true;
        this.cb.travel(travel);
      }
      if (frame.events.length || frame.logs.length || frame.errors.length || frame.uses.length || frame.notes.length) this.cb.playFrame(frame, this.play.info.names);
      {
        const hud = hudOf(this.play, this.locked);
        if (now > this.saveAt) {
          this.saveAt = now + 500;
          this.saveProgress();
        }
        this.followUiMouse(hud.ui.freesMouse);
        const key = JSON.stringify(hud);
        if (key !== this.hudKey) {
          this.hudKey = key;
          this.cb.hud(hud);
        }
      }
      if (++this.blockFrames % 6 === 0) {
        const blocks = this.play.activeBlocks();
        const key = JSON.stringify([...blocks]);
        if (key !== this.blockKey) {
          this.blockKey = key;
          this.cb.activeBlocks(blocks);
        }
      }
      this.needsRender = true;
    }
    // Googly eyes' pupils roll on (and the view keeps drawing while they do).
    if (this.tickEyes(dt)) this.needsRender = true;
    // Scrolling materials (water, lava, conveyors) move.
    if (tickMaterials(now)) this.needsRender = true;
    if (!this.needsRender) return;
    this.needsRender = false;
    const t0 = performance.now();
    this.renderer.info.reset();
    this.render();
    const drawMs = performance.now() - t0;
    if (this.play) this.frames.add(interval, tickMs, this.play.stepMs, drawMs, this.renderer.info.render.calls, this.renderer.info.render.triangles);
    this.sendStats({
      frameMs: drawMs,
      worldMs: this.play ? this.play.stepMs : null,
      draws: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      view: this.rig.kind,
      building: this.world.building,
      buildMs: this.world.stats.buildMs,
    });
  };

  private stats: ViewportStats | null = null;

  /** Frame times while playing (read by the bench, `tools/bench`). */
  readonly frames = new FrameLog();
  private statsAt = -Infinity;
  private statsTimer = 0;

  /**
   * The status line's numbers, at most four times a second (each sends the view's panel through React again, which
   * every frame of Play would make stutter), always with the latest once it settles, and at once when what it says
   * changes (a build starts or ends, another view).
   */
  private sendStats(s: ViewportStats): void {
    const last = this.stats;
    this.stats = s;
    const now = performance.now();
    if (!last || last.building !== s.building || last.view !== s.view || last.buildMs !== s.buildMs || now - this.statsAt >= 250) {
      this.statsAt = now;
      this.cb.stats(s);
      return;
    }
    if (this.statsTimer) return;
    this.statsTimer = window.setTimeout(() => {
      this.statsTimer = 0;
      if (this.disposed || !this.stats) return;
      this.statsAt = performance.now();
      this.cb.stats(this.stats);
    }, Math.max(0, 250 - (now - this.statsAt)));
  }

  /** Draw with ambient occlusion when the scene's lighting is shown and it is on. False: draw plainly. */
  private groundBlend = new GroundBlend();
  private reflections: SceneReflections | null = null;
  /** Scene reflections on (the scene's setting; shown with game lighting and in Play). */
  private reflectOn(): boolean {
    return (!!this.play || this.gameLighting) && this.doc?.settings.reflections !== false;
  }

  private probeKey = '';
  private probeWant = '';
  private probeAt = 0;
  private probeLines: THREE.LineSegments | null = null;
  private showProbes = false;

  /** Show models' collision meshes as outlines (View menu). */
  setCollisionsVisible(v: boolean): void {
    setCollisionsVisible(v);
    this.invalidate();
  }

  /** Show the reflection probes' boxes (View menu). */
  setProbesVisible(v: boolean): void {
    this.showProbes = v;
    this.probeLinesUpdate();
    this.invalidate();
  }

  private probeLinesUpdate(): void {
    this.probeLines?.removeFromParent();
    this.probeLines?.geometry.dispose();
    this.probeLines = null;
    const boxes = this.reflections?.boxes ?? [];
    if (!this.showProbes || !boxes.length) return;
    const pts: number[] = [];
    for (const b of boxes) {
      const c = (i: number) => [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
      for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) pts.push(...c(i!), ...c(j!));
      // (A small cross where it captures from.)
      pts.push(b.at[0] - 8, b.at[1], b.at[2], b.at[0] + 8, b.at[1], b.at[2], b.at[0], b.at[1] - 8, b.at[2], b.at[0], b.at[1] + 8, b.at[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.probeLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x5fd4e8, transparent: true, opacity: 0.7, depthTest: false }));
    this.probeLines.name = 'reflection-probes';
    this.probeLines.renderOrder = 10;
    this.scene.add(this.probeLines);
  }

  /** Find the scene's reflection probes again once the level or its probes changed (and edits paused a moment). */
  private syncProbes(): void {
    const doc = this.doc;
    if (!doc || !this.reflections) return;
    const auto = doc.settings.autoProbes !== false;
    let placed = '';
    for (const e of doc.entities) if (e.components.reflectionProbe) placed += `${e.id}:${JSON.stringify(e.components.reflectionProbe)}:${doc.worldMatrix(e.id).join(',')}|`;
    const key = `${this.play ? 'play' : this.world.version}|${auto}|${placed}`;
    const now = performance.now();
    if (key !== this.probeWant) {
      this.probeWant = key;
      this.probeAt = now + (this.play ? 0 : 600);
    }
    if (key === this.probeKey) return;
    if (now < this.probeAt) {
      setTimeout(() => this.invalidate(), this.probeAt - now + 10);
      return;
    }
    this.probeKey = key;
    this.reflections.setProbes(sceneProbes(doc, this.play ? this.play.levelPieces : this.world.solidPieces, auto));
    this.probeLinesUpdate();
  }

  private renderAo(cam: THREE.Camera): boolean {
    if (!(this.play || this.gameLighting)) return false;
    return (this.ao ??= new AoRenderer(this.renderer)).render(this.scene, cam, this.doc?.settings);
  }

  /** The session whose shaders were compiled (all at once, before its first frame). */
  private warmed: PlaySession | null = null;

  /**
   * Before Play's first frame, compile the shaders of everything in the game, shown or not (levels of detail, blasts,
   * objects scripts show later), under the game's own lights and reflections: then nothing compiles in the middle of
   * playing.
   */
  private warmPlay(cam: THREE.Camera, eye: THREE.Vector3): void {
    const play = this.play;
    if (!play || this.warmed === play) return;
    this.warmed = play;
    // (Reflections first: switching them on changes the shaders of shiny materials.)
    this.reflections?.prime(this.scene, eye, this.reflectOn(), [this.grid.object]);
    this.renderer.compile(play.group, cam, this.scene);
    // Models that load later are compiled in the background before they appear.
    play.warm = (o) => this.renderer.compileAsync(o, cam, this.scene);
  }

  private render(): void {
    FOLIAGE_TIME.value = performance.now() / 1000;
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    r.clear();
    if (this.pivotMarker.visible) this.showPivotMarker();
    if (this.repeatHandle.visible) this.showRepeatHandle();
    // (Paths are an editing aid: not shown while playing.)
    if (this.pathLines) this.pathLines.visible = !this.play;
    this.updateLighting();
    if (this.play?.placeCamera(this.fpCam)) {
      this.play.updateFoliage(this.fpCam);
      this.plants.update(this.fpCam);
      this.waterDepth.prepare(r, this.scene, this.fpCam);
      this.reflections ??= new SceneReflections(r);
      if (this.reflectOn()) this.syncProbes();
      this.warmPlay(this.fpCam, this.fpCam.getWorldPosition(new THREE.Vector3()));
      (this.reflections ??= new SceneReflections(r)).update(this.scene, this.fpCam.getWorldPosition(new THREE.Vector3()), this.reflectOn(), [this.grid.object]);
      if (this.reflections.busy) this.invalidate();
      this.groundBlend.prepare(r, this.scene, this.fpCam, [this.grid.object]);
      this.play.applyWater(this.scene, this.fpCam);
      if (!this.renderAo(this.fpCam)) r.render(this.scene, this.fpCam);
      return;
    }
    this.grid.setCamera(this.rig.camera.position);
    this.foliage.update(this.rig.camera, this.rig.unitsPerPixel);
    this.play?.updateFoliage(this.rig.camera, this.rig.unitsPerPixel);
    this.plants.update(this.rig.camera);
    this.waterDepth.prepare(r, this.scene, this.rig.camera);
    // (Captured at eye height above what the view looks at: from up where the editor camera is, floors would only
    // reflect sky.)
    this.reflections ??= new SceneReflections(r);
    if (this.reflectOn()) this.syncProbes();
    this.warmPlay(this.rig.camera, this.rig.target.clone().add(new THREE.Vector3(0, 64, 0)));
    (this.reflections ??= new SceneReflections(r)).update(this.scene, this.rig.target.clone().add(new THREE.Vector3(0, 64, 0)), this.reflectOn(), [this.grid.object]);
    if (this.reflections.busy) this.invalidate();
    this.groundBlend.prepare(r, this.scene, this.rig.camera, [this.grid.object]);
    if (!this.renderAo(this.rig.camera)) r.render(this.scene, this.rig.camera);
    const s = 72;
    this.axisCam.quaternion.copy(this.rig.camera.quaternion);
    this.axisCam.position.set(0, 0, 5).applyQuaternion(this.rig.camera.quaternion);
    this.axisCam.updateMatrixWorld();
    r.clearDepth();
    r.setScissorTest(true);
    r.setScissor(8, 8, s, s);
    r.setViewport(8, 8, s, s);
    r.render(this.axisScene, this.axisCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
  }

  private zUp = true;
  private gizmoFlipped = false;

  /** View › Z is up: the corner axes and the move gizmo's colours show Z up (as in Blender); the engine stays Y-up. */
  setZUp(v: boolean): void {
    this.zUp = v;
    this.buildAxisGizmo();
    this.grid.zUp = v;
    this.grid.orient(this.rig.kind);
    // (Up is the blue axis, depth the green one.)
    this.gizmo.setColors(0xff0000, v ? 0x0000ff : 0x00ff00, v ? 0x00ff00 : 0x0000ff, 0xffff00);
    // Shown +Y is the engine's −Z: the move and scale gizmos' Z arrows (and their grab areas) point that way.
    if (this.gizmoFlipped !== v) {
      this.gizmoFlipped = v;
      const g = (this.gizmo as unknown as { _gizmo?: { gizmo: Record<string, THREE.Object3D>; picker: Record<string, THREE.Object3D> } })._gizmo;
      for (const root of g ? [g.gizmo.translate, g.gizmo.scale, g.picker.translate, g.picker.scale] : [])
        for (const o of root?.children ?? []) if (o.name === 'Z') (o as THREE.Mesh).geometry?.scale(1, 1, -1);
    }
    this.invalidate();
  }

  private buildAxisGizmo(): void {
    for (const o of [...this.axisScene.children]) {
      this.axisScene.remove(o);
      const m = o as THREE.Line | THREE.Sprite;
      m.geometry?.dispose();
      const mat = m.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    // Z up: shown Y points into the screen's depth (−Z inside), shown Z up.
    const axes: [THREE.Vector3, number, string][] = this.zUp
      ? [
          [new THREE.Vector3(1, 0, 0), 0xff6b5b, 'X'],
          [new THREE.Vector3(0, 0, -1), 0x8fd14f, 'Y'],
          [new THREE.Vector3(0, 1, 0), 0x4b9cff, 'Z'],
        ]
      : [
          [new THREE.Vector3(1, 0, 0), 0xff6b5b, 'X'],
          [new THREE.Vector3(0, 1, 0), 0x8fd14f, 'Y'],
          [new THREE.Vector3(0, 0, 1), 0x4b9cff, 'Z'],
        ];
    for (const [dir, color, label] of axes) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir]);
      this.axisScene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color })));
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 32, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      sp.position.copy(dir).multiplyScalar(1.25);
      sp.scale.setScalar(0.5);
      this.axisScene.add(sp);
    }
  }

  // ── input ──

  private ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private snapV(v: number): number {
    const g = this.snap ? this.gridSize : 1;
    return Math.round(v / g) * g;
  }

  /** Where the cursor meets the drawing plane for this view (raised onto a surface under the cursor if it faces the camera's plane). */
  private drawPoint(e: { clientX: number; clientY: number }, fixedBase?: number): V3 | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const { e: ax } = draftAxes(this.rig.kind);
    let base = fixedBase;
    if (base === undefined) {
      base = 0;
      const hit = this.world.pick(this.raycaster);
      if (hit && hit.normal.getComponent(ax) > 0.7) base = this.snapV(hit.point.getComponent(ax));
    }
    const n = new THREE.Vector3();
    n.setComponent(ax, 1);
    const p = this.raycaster.ray.intersectPlane(new THREE.Plane(n, -base), new THREE.Vector3());
    if (!p) return null;
    const out: V3 = [this.snapV(p.x), this.snapV(p.y), this.snapV(p.z)];
    out[ax] = base;
    // Snap the in-plane coordinates to a brush corner near the cursor.
    let snapped: V3 | null = null;
    if (this.vertexSnap && this.doc) {
      const targets: { p: V3; x: number; y: number }[] = [];
      for (const v of this.pointsOf(this.doc.entities.filter((x) => x.components.brush && isShown(this.doc!, x)))) {
        const sp = this.toScreen(v);
        if (sp.z < 1) targets.push({ p: v, x: sp.x, y: sp.y });
      }
      snapped = this.nearestTarget(targets, e.clientX, e.clientY);
      if (snapped) for (let i = 0; i < 3; i++) if (i !== ax) out[i] = snapped[i]!;
    }
    this.showSnap(snapped ? out : null);
    return out;
  }

  /** Ground point for "add here" menus. */
  private groundPoint(e: { clientX: number; clientY: number }): Vec3 | null {
    const p = this.drawPoint(e);
    this.showSnap(null);
    return p;
  }

  private pick(e: { clientX: number; clientY: number }): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const targets: THREE.Object3D[] = [];
    for (const { m } of this.markers.values()) if (m.group.visible && !m.group.userData.locked) targets.push(m.pick);
    const markerHit = this.raycaster.intersectObjects(targets, false)[0];
    const worldHit = this.world.pick(this.raycaster);
    const locked = (id: string) => !!this.doc && isLocked(this.doc, this.doc.get(id));
    let w = worldHit && !locked(worldHit.entityId) ? worldHit : null;
    // Terrain picks its object, when it's nearer than the level.
    const ground = this.raycaster.intersectObjects(this.terrains.meshes, false)[0];
    const groundId = ground?.object.userData.terrain as string | undefined;
    if (ground && groundId && !locked(groundId) && (!w || ground.distance < w.distance)) w = { entityId: groundId, distance: ground.distance } as typeof w;
    // Plants pick their object too.
    const plant = this.raycaster.intersectObjects(this.plants.meshes, false)[0];
    const plantId = plant?.object.userData.entityId as string | undefined;
    if (plant && plantId && !locked(plantId) && (!w || plant.distance < w.distance)) w = { entityId: plantId, distance: plant.distance } as typeof w;
    // (A Repeat group's copies pick the group.)
    if (markerHit && (!w || markerHit.distance <= w.distance)) return markerHit.object.userData.entityId ? ownerOf(markerHit.object.userData.entityId as string) : null;
    return w ? ownerOf(w.entityId) : null;
  }

  /** The model part (material slot) under the cursor, when no level face is in front of it. */
  private pickModelPart(e: { clientX: number; clientY: number }): { id: string; slot: string } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const targets: THREE.Object3D[] = [];
    for (const { m } of this.markers.values()) {
      if (!m.group.visible || m.group.userData.locked) continue;
      const model = m.group.children.find((c) => c.name === 'model');
      if (model) targets.push(model);
    }
    if (!targets.length) return null;
    const hit = this.raycaster.intersectObjects(targets, true).find((h) => (h.object as THREE.Mesh).isMesh);
    if (!hit) return null;
    const level = this.world.pick(this.raycaster, true);
    if (level && level.distance < hit.distance) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && o.userData.entityId === undefined) o = o.parent;
    const slots = (hit.object.userData.slots ?? []) as string[];
    const slot = slots[hit.face?.materialIndex ?? 0] ?? slots[0];
    return o && slot ? { id: o.userData.entityId as string, slot } : null;
  }

  /** The brush face under the cursor (level brushes only; markers are ignored in the face tool). */
  private pickFace(e: { clientX: number; clientY: number }): { ref: FaceRef | null; cut: boolean } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    // Subtract volumes never appear in the level, so the face tools click straight through them.
    const hit = this.world.pick(this.raycaster, true);
    // (Faces of a Repeat group's copies aren't faces of the scene: edit the segment.)
    if (!hit || !this.doc || !this.doc.get(hit.entityId) || isLocked(this.doc, this.doc.get(hit.entityId))) return null;
    const wb = this.world.brush(hit.entityId);
    if (!wb) return null;
    const face = faceAt(wb.brush, [hit.point.x, hit.point.y, hit.point.z], [hit.normal.x, hit.normal.y, hit.normal.z], 0.05);
    return face < 0 ? { ref: null, cut: true } : { ref: { id: hit.entityId, face }, cut: false };
  }

  /** Box selection works in the select/transform tools and the vertex tool. */
  private boxAllowed(): boolean {
    return !this.brushTool && !this.faceTool && this.editTool !== 'clip' && this.editTool !== 'loopcut';
  }

  private drawMarquee(x0: number, y0: number, x1: number, y1: number): void {
    const r = this.host.getBoundingClientRect();
    const m = this.marquee;
    m.hidden = false;
    m.style.left = `${Math.min(x0, x1) - r.left}px`;
    m.style.top = `${Math.min(y0, y1) - r.top}px`;
    m.style.width = `${Math.abs(x1 - x0)}px`;
    m.style.height = `${Math.abs(y1 - y0)}px`;
  }

  /** Objects whose on-screen outline touches the rectangle (hidden, locked and group entities excluded). */
  private objectsInBox(r: { x0: number; y0: number; x1: number; y1: number }): string[] {
    const doc = this.doc;
    if (!doc) return [];
    const out: string[] = [];
    for (const e of doc.entities) {
      if (!isShown(doc, e) || isLocked(doc, e) || isGroup(doc, e)) continue;
      const b = worldBrushOf(doc, e, this.mats.get(e.id));
      if (!b && !this.markers.has(e.id)) continue;
      const pts = b ? vertices(b.brush) : [this.worldPos(e)];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
      for (const p of pts) {
        const s = this.toScreen(p);
        if (s.z >= 1) continue;
        any = true;
        x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
      }
      if (any && x1 >= r.x0 && x0 <= r.x1 && y1 >= r.y0 && y0 <= r.y1) out.push(e.id);
    }
    return out;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const el = this.renderer.domElement;
    el.focus();
    if (this.asPlayer) {
      if (this.locked && e.button === 0) {
        this.play?.useItem();
        this.play?.setInput({ fire: true });
      } else if (!this.locked && !this.uiFree && e.button === 0) this.lockPointer();
      return;
    }
    if (this.bevel) {
      e.preventDefault();
      this.endBevel(e.button === 0);
      return;
    }
    if (this.gizmo.dragging || (this.gizmo as unknown as { axis: string | null }).axis) return;
    const persp = this.rig.kind === 'perspective';
    let mode: NonNullable<typeof this.drag>['mode'];
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) mode = 'pan';
    else if (e.button === 2) mode = persp ? 'look' : 'pan';
    else if (e.button === 0 && e.altKey && persp) mode = 'orbit';
    else if (this.play && e.button === 0) mode = persp ? 'look' : 'pan'; // nothing to edit while playing
    else if (e.button === 0 && this.brushTool) mode = this.draft?.stage === 'height' ? 'height' : 'draw';
    else if (e.button === 0) mode = 'click';
    else return;

    if (mode === 'height') {
      // Second click confirms the brush.
      this.confirmDraft();
      return;
    }
    if (mode === 'draw' && this.shapeOpts.shape === 'polygon') {
      this.polygonClick(e);
      return;
    }
    if (mode === 'draw') {
      const p = this.drawPoint(e);
      if (!p) return;
      this.cancelDraft();
      this.draft = new BrushDraft(this.rig.kind, p, this.lastHeight);
      this.scene.add(this.draft.group);
      this.draft.update(this.shapeOpts, this.brushRole);
      this.cb.draft(this.draft.state());
    }
    if (mode === 'click' && this.editTool === 'loopcut') {
      this.updateLoop(e);
      const h = this.loopHover;
      if (h) {
        this.showLoop(null);
        this.cb.applyLoopCut(h.id, h.brush);
      }
      return;
    }
    if (mode === 'click' && this.editTool === 'clip') {
      const p = this.drawPoint(e);
      if (!p) return;
      this.showSnap(null);
      const along: V3 = [0, 0, 0];
      along[draftAxes(this.rig.kind).e] = 1;
      this.clipTool.start(p, along);
      this.cb.clipState(this.clipTool.state, this.clipTool.keep);
      mode = 'clip';
      this.invalidate();
    }
    if (mode === 'click' && this.editTool === 'none' && this.startRepeatDrag(e)) mode = 'repeat';
    // Terrain tool: a stroke on the ground (elsewhere, a click still selects).
    if (mode === 'click' && this.terrainBrush && !this.play && this.startStroke(e)) mode = 'terrain';
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, mode };
    el.setPointerCapture(e.pointerId);
    if (mode === 'look') this.cb.setFlying(true);
  };

  /** Height stage: the height and the cursor's height on the measuring plane when the stage began. */
  private heightAnchor: { at: number; h: number } | null = null;

  /**
   * How high the cursor is over the footprint: where the mouse ray meets an upright plane through the middle of
   * the footprint, turned to face the camera. The top of the brush then stays under the cursor, however far
   * away the camera is.
   */
  private cursorHeight(e: { clientX: number; clientY: number }): number | null {
    const d = this.draft;
    if (!d) return null;
    const { min, max } = d.bounds();
    const centre = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const cam = this.rig.camera;
    const forward = cam.getWorldDirection(new THREE.Vector3());
    const normal = new THREE.Vector3(forward.x, 0, forward.z);
    // Looking straight down there is no upright plane facing the camera; use the screen's up direction.
    if (normal.lengthSq() < 1e-4) normal.set(0, 0, 1).applyQuaternion(cam.quaternion).setY(0);
    if (normal.lengthSq() < 1e-8) return null;
    normal.normalize();
    this.raycaster.setFromCamera(this.ndc(e), cam);
    const ray = this.raycaster.ray;
    const denom = ray.direction.dot(normal);
    if (Math.abs(denom) < 1e-4) return null;
    const t = centre.clone().sub(ray.origin).dot(normal) / denom;
    if (t <= 0) return null;
    return ray.origin.y + ray.direction.y * t;
  }

  /** The brush height follows the cursor, even over panels and toolbars (perspective view). */
  private onWindowPointerMove = (e: PointerEvent): void => {
    const d = this.draft;
    if (this.drag || this.play || !d || d.stage !== 'height' || this.rig.kind !== 'perspective') return;
    const at = this.cursorHeight(e);
    if (at === null) return;
    if (!this.heightAnchor) this.heightAnchor = { at, h: d.height };
    const g = this.snap ? this.gridSize : 1;
    let h = Math.round((this.heightAnchor.h + at - this.heightAnchor.at) / g) * g;
    if (Math.abs(h) < g) h = h < 0 ? -g : g;
    if (h === d.height) return;
    d.height = h;
    d.update(this.shapeOpts, this.brushRole);
    this.cb.draft(d.state());
    this.invalidate();
  };

  /**
   * While choosing the height, a click anywhere finishes the brush, also over a panel or toolbar the cursor
   * wandered onto (the brush panel itself still works: its fields and buttons).
   */
  private onWindowPointerDown = (e: PointerEvent): void => {
    const d = this.draft;
    if (this.play || !d || d.stage !== 'height' || e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (!t || t === this.renderer.domElement) return; // the viewport's own handler confirms
    if (t.closest('[data-brush-panel], .cw-modal, [role="menu"]')) return;
    e.preventDefault();
    e.stopPropagation();
    this.confirmDraft();
  };

  /** Polygon brushes: each click places a corner; clicking the first corner finishes the outline. */
  private polygonClick(e: PointerEvent): void {
    const d = this.draft;
    const base = d ? d.bounds().min[draftAxes(this.rig.kind).e] : undefined;
    const p = this.drawPoint(e, base);
    if (!p) return;
    if (!d || !d.points) {
      this.cancelDraft();
      this.draft = new BrushDraft(this.rig.kind, p, this.lastHeight);
      this.draft.startPolygon(p);
      this.scene.add(this.draft.group);
    } else {
      const { a, b, e: ax } = draftAxes(this.rig.kind);
      const first = d.points[0]!;
      const fp: V3 = [0, 0, 0];
      fp[a] = first[0];
      fp[b] = first[1];
      fp[ax] = p[ax]!;
      const s = this.toScreen(fp);
      if (Math.hypot(s.x - e.clientX, s.y - e.clientY) < 10 && d.canClose) return this.closePolygon();
      d.addPoint(p);
    }
    const nd = this.draft!;
    nd.update(this.shapeOpts, this.brushRole);
    this.cb.draft(nd.state());
    this.invalidate();
  }

  private closePolygon(): void {
    const d = this.draft;
    if (!d?.closePolygon()) return;
    this.heightAnchor = null;
    this.showSnap(null);
    d.update(this.shapeOpts, this.brushRole);
    this.cb.draft(d.state());
    this.invalidate();
  }

  private onDoubleClick = (e: MouseEvent): void => {
    if (this.play) return;
    if (this.brushTool && this.draft?.points && this.draft.stage === 'footprint') return this.closePolygon();
    if (this.brushTool || this.faceTool || e.button !== 0) return;
    const id = this.pick(e);
    if (id) this.cb.clickSelect(id, false, true);
  };

  private trackPointer = (e: PointerEvent): void => {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (this.bevel) this.updateBevel(e.shiftKey, e.ctrlKey);
  };

  // ── Bevel (vertex tool, Ctrl+B), as in Blender ──

  private bevel: {
    originals: { id: string; brush: Brush }[];
    edges: Map<string, [V3, V3][]>;
    centre: { x: number; y: number };
    /** Screen pixels per world unit at the centre. */
    pxPerUnit: number;
    /** Where the current sensitivity started: the value then and the mouse distance then. */
    base: number;
    from: number;
    fine: boolean;
    width: number;
    segments: number;
    profile: number;
    profileMode: boolean;
    typed: string;
    refused: number;
    /** Wider makes no difference (half the thinnest brush). */
    maxWidth: number;
  } | null = null;
  /** The last bevel made: adjustable (width, segments, profile) until the selection or tool changes. */
  private lastBevel: { originals: { id: string; brush: Brush }[]; edges: Map<string, [V3, V3][]>; width: number; segments: number; profile: number } | null = null;

  /** Ctrl+B: start bevelling the picked edges (both corners of an edge picked). False when there are none. */
  startBevel(): boolean {
    if (this.editTool !== 'vertex' || this.bevel) return false;
    const edges = this.vertexTool.pickedEdges();
    if (!edges.size) return false;
    const originals = this.editBrushes().filter((b) => edges.has(b.id));
    const pts = [...edges.values()].flat(2);
    const c: V3 = [0, 0, 0];
    for (const p of pts) for (let i = 0; i < 3; i++) c[i]! += p[i]! / pts.length;
    const sc = this.toScreen(c);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.rig.camera.quaternion);
    const sr = this.toScreen([c[0] + right.x, c[1] + right.y, c[2] + right.z]);
    const pxPerUnit = Math.max(1e-3, Math.hypot(sr.x - sc.x, sr.y - sc.y));
    const from = Math.hypot(this.lastPointer.x - sc.x, this.lastPointer.y - sc.y);
    const last = this.lastBevel;
    this.forgetBevel();
    let maxWidth = Infinity;
    for (const o of originals) {
      const bb = bounds(o.brush);
      if (bb) maxWidth = Math.min(maxWidth, 0.5 * Math.min(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]));
    }
    this.bevel = { originals, edges, centre: { x: sc.x, y: sc.y }, pxPerUnit, base: 0, from, fine: false, width: 0, segments: last?.segments ?? 1, profile: last?.profile ?? 0.5, profileMode: false, typed: '', refused: 0, maxWidth };
    this.cb.beginEdit('Bevel');
    this.gizmo.detach();
    this.updateBevel(false, false);
    return true;
  }

  private updateBevel(fine: boolean, snap: boolean): void {
    const b = this.bevel;
    if (!b) return;
    const d = Math.hypot(this.lastPointer.x - b.centre.x, this.lastPointer.y - b.centre.y);
    // Shift: ten times finer from here on.
    if (fine !== b.fine) {
      b.base = b.profileMode ? b.profile : b.width;
      b.from = d;
      b.fine = fine;
    }
    const k = fine ? 0.1 : 1;
    if (b.profileMode) b.profile = Math.max(0.25, Math.min(0.99, b.base + ((d - b.from) * k) / 300));
    else if (b.typed) b.width = Math.max(0, Number(b.typed) || 0);
    else {
      b.width = Math.min(b.maxWidth, Math.max(0, b.base + ((d - b.from) * k) / b.pxPerUnit));
      // (Back from past the widest: it grows again as soon as the mouse comes back in.)
      if (b.width >= b.maxWidth && !fine) {
        b.base = b.maxWidth;
        b.from = d;
      }
      // Ctrl: whole units (a tenth of one with Shift).
      if (snap) b.width = fine ? Math.round(b.width * 10) / 10 : Math.round(b.width);
    }
    this.previewBevel();
  }

  private bevelled(originals: { id: string; brush: Brush }[], edges: Map<string, [V3, V3][]>, width: number, segments: number, profile: number): { changes: { id: string; brush: Brush }[]; refused: number } {
    let refused = 0;
    const changes = originals.map((o) => {
      const r = bevelEdges(o.brush, edges.get(o.id) ?? [], width, segments, profile);
      if (!r) refused++;
      return { id: o.id, brush: r ?? o.brush };
    });
    return { changes, refused };
  }

  private previewBevel(): void {
    const b = this.bevel;
    if (!b) return;
    const r = this.bevelled(b.originals, b.edges, b.width, b.segments, b.profile);
    b.refused = r.refused;
    this.cb.liveMany(r.changes);
    this.cb.bevelState?.({ live: true, width: b.width, segments: b.segments, profile: b.profile, typed: b.typed, profileMode: b.profileMode, refused: b.refused });
    this.invalidate();
  }

  /** Finish the bevel: keep it (click, Enter) or put everything back (right-click, Esc). */
  endBevel(keep: boolean): void {
    const b = this.bevel;
    if (!b) return;
    this.bevel = null;
    if (keep && b.width > 0) {
      this.cb.endEdit();
      this.lastBevel = { originals: b.originals, edges: b.edges, width: b.width, segments: b.segments, profile: b.profile };
      this.vertexTool.clearPicks();
      this.cb.vertexInfo(0);
      this.cb.bevelState?.({ live: false, width: b.width, segments: b.segments, profile: b.profile, typed: '', profileMode: false, refused: b.refused });
    } else {
      this.cb.liveMany(b.originals);
      if (this.cb.cancelEdit) this.cb.cancelEdit();
      else this.cb.endEdit();
      this.cb.bevelState?.(null);
    }
    this.applySelection();
    this.invalidate();
  }

  /** Change the bevel just made (the adjust panel): it's made again from the brushes as they were. */
  adjustBevel(patch: { width?: number; segments?: number; profile?: number }): void {
    const l = this.lastBevel;
    if (!l) return;
    Object.assign(l, patch);
    l.width = Math.max(0, l.width);
    l.segments = Math.max(1, Math.min(32, Math.round(l.segments)));
    l.profile = Math.max(0.25, Math.min(0.99, l.profile));
    const r = this.bevelled(l.originals, l.edges, l.width, l.segments, l.profile);
    this.cb.rebevel?.(r.changes);
    this.cb.bevelState?.({ live: false, width: l.width, segments: l.segments, profile: l.profile, typed: '', profileMode: false, refused: r.refused });
  }

  private forgetBevel(): void {
    if (!this.lastBevel) return;
    this.lastBevel = null;
    this.cb.bevelState?.(null);
  }

  /** Keys while bevelling: digits type the width, P switches to the profile, Enter/Esc finish. */
  private bevelKey(e: KeyboardEvent): boolean {
    const b = this.bevel;
    if (!b) return false;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') this.endBevel(true);
    else if (e.key === 'Escape') this.endBevel(false);
    else if (/^[0-9.]$/.test(e.key)) b.typed += e.key;
    else if (e.key === 'Backspace') b.typed = b.typed.slice(0, -1);
    else if (e.key === 'p' || e.key === 'P') {
      b.profileMode = !b.profileMode;
      b.base = b.profileMode ? b.profile : b.width;
      b.from = Math.hypot(this.lastPointer.x - b.centre.x, this.lastPointer.y - b.centre.y);
    } else if (e.key === 'PageUp' || e.key === '+' || e.key === '=') b.segments = Math.min(32, b.segments + 1);
    else if (e.key === 'PageDown' || e.key === '-') b.segments = Math.max(1, b.segments - 1);
    else if (e.key === 'Shift' || e.key === 'Control') {
      this.updateBevel(e.shiftKey, e.ctrlKey);
      return true;
    }
    this.updateBevel(e.shiftKey, e.ctrlKey);
    return true;
  }

  private onPointerMove = (e: PointerEvent): void => {
    // Terrain tool: the brush ring follows the ground under the cursor.
    if (!this.drag && this.terrainBrush && !this.play) this.showTerrainCursor(e);
    // Polygon outline: the next corner follows the cursor.
    if (!this.drag && this.draft?.points && this.draft.stage === 'footprint') {
      const p = this.drawPoint(e, this.draft.bounds().min[draftAxes(this.rig.kind).e]);
      this.draft.setCursor(p);
      this.draft.update(this.shapeOpts, this.brushRole);
      this.invalidate();
      return;
    }
    // (The height stage follows the mouse everywhere: see onWindowPointerMove.)
    if (!this.drag && this.draft?.stage === 'height' && this.rig.kind === 'perspective') return;
    if (!this.drag && this.editTool === 'loopcut' && !this.play) {
      this.updateLoop(e);
      return;
    }
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.mode === 'terrain') {
      this.strokeMove(e);
      d.moved = true;
      return;
    }
    if (d.mode === 'repeat') {
      const r = this.repeatDrag;
      if (!r) return;
      let len = r.length + (this.repeatAlong(e, r) - r.start) / r.unit;
      if (this.snap) len = Math.round(len / this.gridSize) * this.gridSize;
      len = Math.max(this.snap ? this.gridSize : 1, len);
      this.cb.repeatLength?.(r.id, len);
      d.moved = true;
      return;
    }
    if (d.mode === 'draw') {
      const start = this.draft;
      if (!start) return;
      const base = start.bounds().min[draftAxes(this.rig.kind).e]!;
      const p = this.drawPoint(e, base);
      if (p) {
        start.setEnd(p);
        start.update(this.shapeOpts, this.brushRole);
        this.cb.draft(start.state());
        this.invalidate();
      }
      d.moved = true;
      return;
    }
    if (d.mode === 'clip') {
      const base = this.clipTool.a?.[draftAxes(this.rig.kind).e];
      const p = this.drawPoint(e, base);
      if (p) {
        this.clipTool.moveEnd(p);
        this.cb.clipState(this.clipTool.state, this.clipTool.keep);
        this.invalidate();
      }
      d.moved = true;
      return;
    }
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (d.mode === 'click' && this.boxAllowed()) d.mode = 'box';
    if (d.mode === 'box') {
      d.moved = true;
      this.drawMarquee(d.sx, d.sy, e.clientX, e.clientY);
      return;
    }
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.mode === 'look') this.rig.look(dx, dy);
    else if (d.mode === 'orbit') this.rig.orbit(dx, dy);
    else if (d.mode === 'pan') this.rig.pan(dx, dy);
    else return;
    this.grid.update(this.gridSize, this.rig.unitsPerPixel);
    this.invalidate();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.asPlayer && e.button === 0) this.play?.setInput({ fire: false });
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'look') this.cb.setFlying(false);
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (this.play) return;
    if (d.mode === 'terrain') {
      this.endStroke();
      return;
    }
    if (d.mode === 'repeat') {
      this.repeatDrag = null;
      this.cb.endEdit();
      return;
    }
    if (d.mode === 'draw') {
      const dr = this.draft;
      if (!dr || !dr.hasArea) return this.cancelDraft();
      dr.stage = 'height';
      this.heightAnchor = null;
      this.showSnap(null);
      dr.update(this.shapeOpts, this.brushRole);
      this.cb.draft(dr.state());
      this.invalidate();
      return;
    }
    if (d.mode === 'clip') {
      this.showSnap(null);
      if (!this.clipTool.plane()) this.cancelClip();
      return;
    }
    if (d.mode === 'box') {
      this.marquee.hidden = true;
      const r = { x0: Math.min(d.sx, e.clientX), y0: Math.min(d.sy, e.clientY), x1: Math.max(d.sx, e.clientX), y1: Math.max(d.sy, e.clientY) };
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (this.editTool === 'vertex') {
        this.vertexTool.pickBox(r, additive, (p) => this.toScreen(p));
        this.cb.vertexInfo(this.vertexTool.count);
        this.applySelection();
        this.invalidate();
      } else {
        this.cb.boxSelect(this.objectsInBox(r), additive);
      }
      return;
    }
    if (d.moved) return;
    if (d.mode === 'click' && this.editTool === 'vertex') {
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (this.vertexTool.pickAt(e.clientX, e.clientY, additive, (p) => this.toScreen(p))) {
        this.cb.vertexInfo(this.vertexTool.count);
        this.applySelection();
        this.invalidate();
        return;
      }
      // Not on a handle: pick another brush to edit (or clear).
      const id = this.pick(e);
      if (!id && this.vertexTool.count && !additive) {
        this.vertexTool.clearPicks();
        this.cb.vertexInfo(0);
        this.applySelection();
        this.invalidate();
        return;
      }
      this.cb.clickSelect(id, additive, true);
      return;
    }
    if (d.mode === 'click' && this.faceTool) {
      const mode = e.shiftKey ? 'brush' : e.ctrlKey || e.metaKey ? 'toggle' : 'replace';
      // A model in front of the level: its part (the Paint tool paints that part).
      const part = this.pickModelPart(e);
      if (part && this.cb.modelPart?.(part.id, part.slot, mode)) return;
      const hit = this.pickFace(e);
      this.cb.selectFace(hit?.ref ?? null, mode, hit?.cut);
    } else if (d.mode === 'click') {
      const id = this.pick(e);
      this.cb.clickSelect(id, e.ctrlKey || e.metaKey || e.shiftKey, false);
    } else if (d.button === 2) {
      if (this.draft) return this.cancelDraft();
      const id = this.pick(e);
      if (id && !this.selection.includes(id)) this.cb.select([id], 'replace');
      this.cb.contextMenu(e.clientX, e.clientY, this.groundPoint(e));
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.asPlayer) {
      e.preventDefault();
      // The wheel moves along the hotbar.
      if (this.locked && this.play && e.deltaY) this.play.selectSlot(this.play.uiState().slot + Math.sign(e.deltaY));
      return;
    }
    e.preventDefault();
    if (this.bevel) {
      this.bevel.segments = Math.max(1, Math.min(32, this.bevel.segments + (e.deltaY < 0 ? 1 : -1)));
      this.updateBevel(e.shiftKey, e.ctrlKey);
      return;
    }
    if (this.editTool === 'loopcut' && this.loopHover && !this.drag) {
      this.setLoopCuts(this.loopCuts + (e.deltaY < 0 ? 1 : -1));
      return;
    }
    if (this.drag?.mode === 'look') {
      this.rig.flySpeed = THREE.MathUtils.clamp(this.rig.flySpeed * Math.exp(-e.deltaY * 0.002), 32, 8192);
      return;
    }
    this.rig.wheel(e.deltaY, this.ndc(e));
    this.heightAnchor = null;
    this.grid.update(this.gridSize, this.rig.unitsPerPixel);
    this.invalidate();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.gameKey(e, true)) return;
    // Another workspace (Screens) fills the window: the 3D view is hidden and takes no keys.
    if (this.host.offsetParent === null) return;
    if (this.isTyping(e)) return;
    if (this.bevelKey(e)) return;
    if (this.editTool === 'vertex' && (e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B' || e.code === 'KeyB')) {
      e.preventDefault();
      e.stopPropagation();
      if (!this.startBevel()) this.cb.message('bevelNone');
      return;
    }
    if (this.draft?.points && this.draft.stage === 'footprint' && (e.key === 'Enter' || e.key === 'Backspace')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') this.closePolygon();
      else if (this.draft.removeLastPoint()) {
        this.draft.update(this.shapeOpts, this.brushRole);
        this.cb.draft(this.draft.state());
        this.invalidate();
      } else this.cancelDraft();
      return;
    }
    if (this.draft && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') this.confirmDraft();
      else this.cancelDraft();
      return;
    }
    if (this.editTool === 'clip' && this.clipTool.state && ['Enter', 'Escape', 'Tab'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') this.applyClip();
      else if (e.key === 'Escape') this.cancelClip();
      else {
        this.clipTool.cycleKeep();
        this.cb.clipState(this.clipTool.state, this.clipTool.keep);
        this.invalidate();
      }
      return;
    }
    if (this.editTool === 'vertex' && this.vertexTool.count && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.vertexTool.clearPicks();
      this.cb.vertexInfo(0);
      this.applySelection();
      this.invalidate();
      return;
    }
    if (e.code === 'Space') {
      this.spaceHeld = true;
      if (e.target === this.renderer.domElement) e.preventDefault();
    }
    if (this.drag?.mode === 'look') {
      this.keys.add(e.code);
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.gameKey(e, false)) return;
    if (this.bevel && (e.key === 'Shift' || e.key === 'Control')) this.updateBevel(e.shiftKey, e.ctrlKey);
    if (e.code === 'Space') this.spaceHeld = false;
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.gameKeys.clear();
    this.sendInput();
    this.spaceHeld = false;
  };

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onContext = (e: Event): void => e.preventDefault();

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.trackPointer, true);
    el.addEventListener('pointerdown', this.trackPointer, true);
    el.addEventListener('dblclick', this.onDoubleClick);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('pointermove', this.onWindowPointerMove, true);
    window.addEventListener('pointerdown', this.onWindowPointerDown, true);
  }

  private unbindInput(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.trackPointer, true);
    el.removeEventListener('pointerdown', this.trackPointer, true);
    el.removeEventListener('dblclick', this.onDoubleClick);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('pointermove', this.onWindowPointerMove, true);
    window.removeEventListener('pointerdown', this.onWindowPointerDown, true);
  }
}

/** Saved face data is replaced (not mutated) on every edit, so its identity tells us whether a brush changed. */
const faceIds = new WeakMap<object, number>();
let faceSeq = 0;
function faceKey(e: EntityData): string {
  const f = (e.components.brush as { faces: object }).faces;
  let id = faceIds.get(f);
  if (id === undefined) {
    id = ++faceSeq;
    faceIds.set(f, id);
  }
  return String(id);
}
