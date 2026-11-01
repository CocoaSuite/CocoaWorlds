/**
 * The editor viewport: draws the level, grid and gizmos, handles camera navigation, picking, transform dragging
 * and the brush tool. Renders on demand (only after something changes) so an idle editor costs no GPU time.
 */
import type { EntityData, SceneDoc, Transform, Vec3 } from '@cocoaworlds/core';
import { bounds, faceAt, loopCut, nearestEdge, transform as transformBrush, translate, vertices, type Brush, type Plane, type V3 } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { brushBounds, brushOf, isLocked, isShown, worldBrushOf, worldBrushes, worldMatrices, type DrawRole, type Outline, type ShapeOptions } from '../brush/brushes';
import { rootsOf } from '../scene-ops';
import { isGroup } from '../scene-ops';
import { PIVOT, applyMat4, mat4Key, pivotOf, type Mat4 } from '@cocoaworlds/core';
import { BrushDraft, draftAxes, type DraftState } from './brush-draft';
import { CameraRig, type ViewKind } from './camera';
import { EditorGrid } from './grid';
import { buildMarker, disposeMarker, markerKey, setMarkerSelected, type Marker } from './markers';
import { WorldRenderer, type FaceRef } from './world-render';
import { VertexTool } from './vertex-tool';
import { ClipTool, type ClipKeep, type ClipState } from './clip-tool';
import type { PlayFrame, PlayInfo, PlaySession } from './play-session';
import type { SceneFile } from '@cocoaworlds/core';

export interface ViewportCallbacks {
  select(ids: string[], mode: 'replace' | 'toggle'): void;
  /** A click in the view: the store resolves groups (`deep` = double-click, pick the object itself). */
  clickSelect(id: string | null, additive: boolean, deep: boolean): void;
  beginEdit(label: string): void;
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
  /** Loop cut tool: how many cuts, and whether the cursor is on a brush where a loop fits (null = not on a brush). */
  loopCutState(cuts: number, fits: boolean | null): void;
  /** Loop cut tool: replace this brush (world space) with the cut one. */
  applyLoopCut(id: string, brush: Brush): void;
  /** Edit pivot mode: the pivot was dragged to this world position. */
  livePivot(id: string, world: V3): void;
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
  private axisScene = new THREE.Scene();
  private axisCam = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, -10, 10);
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private raf = 0;
  private lastTick = performance.now();
  private keys = new Set<string>();
  private drag: { button: number; x: number; y: number; moved: boolean; mode: 'look' | 'pan' | 'orbit' | 'click' | 'draw' | 'height' | 'box' | 'clip'; sx: number; sy: number } | null = null;
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
    // Editor preview lighting (scene lights take over when lighting lands in Phase 7).
    this.scene.add(new THREE.HemisphereLight(0xe8eef5, 0x3a3530, 1.4));
    const key = new THREE.DirectionalLight(0xfff6ea, 1.6);
    key.position.set(0.45, 1, 0.3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    fill.position.set(-0.6, 0.4, -0.8);
    this.scene.add(fill);

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

  setDoc(doc: SceneDoc | null): void {
    this.doc = doc;
    this.worldKey = '';
    this.syncAll();
  }

  /** Re-read entities from the doc (called after any scene change). */
  syncAll(): void {
    const doc = this.doc;
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
    // Rebuild level geometry only when brushes actually changed.
    const wb = doc ? worldBrushes(doc) : [];
    // Faces and where each brush sits (a moved group moves its brushes without touching their faces).
    const key = wb.map((b) => `${b.id}:${b.role}:${faceKey(doc!.get(b.id)!)}:${mat4Key(this.mats.get(b.id) ?? [])}`).join('|');
    if (key !== this.worldKey) {
      this.worldKey = key;
      this.world.rebuild(wb);
    }
    this.applySelection();
    this.invalidate();
  }

  setSelection(ids: string[]): void {
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

  get playing(): boolean {
    return !!this.play;
  }

  /** Build a game world from a scene snapshot and show it instead of the editor's scene. */
  async startPlay(scene: SceneFile): Promise<PlayInfo> {
    this.stopPlay();
    const token = ++this.playToken;
    // Physics (and its WebAssembly) loads on first Play, so opening the editor stays quick.
    const { PlaySession } = await import('./play-session');
    const session = await PlaySession.start(scene, (name) => this.world.material(name));
    if (token !== this.playToken || this.disposed) {
      // Stopped while loading.
      session.dispose();
      return session.info;
    }
    this.play = session;
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
    if (session.info.player) {
      this.gameKeys.clear();
      this.cb.playerLock(false);
      this.lockPointer();
    }
    this.invalidate();
    return session.info;
  }

  stopPlay(): void {
    this.playToken++;
    const p = this.play;
    if (!p) return;
    this.play = null;
    this.gameKeys.clear();
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
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
    if (this.asPlayer) this.lockPointer();
  }

  private lockPointer(): void {
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

  private onLockChange = (): void => {
    if (!this.asPlayer) return;
    if (!this.locked) {
      this.gameKeys.clear();
      this.sendInput();
    }
    this.cb.playerLock(this.locked);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.asPlayer || !this.locked || !this.play) return;
    const k = 0.0022;
    const { yaw, pitch } = this.play.look;
    const limit = Math.PI / 2 - 0.01;
    this.play.setInput({ yaw: yaw - e.movementX * k, pitch: Math.max(-limit, Math.min(limit, pitch - e.movementY * k)) });
  };

  /** Keys the game uses while the mouse is captured (they never reach the editor's shortcuts). */
  private static GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ControlLeft', 'ControlRight', 'KeyC', 'ShiftLeft', 'ShiftRight', 'KeyE']);

  private sendInput(): void {
    const k = this.gameKeys;
    const on = (...c: string[]) => c.some((x) => k.has(x));
    this.play?.setInput({
      forward: (on('KeyW', 'ArrowUp') ? 1 : 0) - (on('KeyS', 'ArrowDown') ? 1 : 0),
      right: (on('KeyD', 'ArrowRight') ? 1 : 0) - (on('KeyA', 'ArrowLeft') ? 1 : 0),
      jump: on('Space'),
      crouch: on('ControlLeft', 'ControlRight', 'KeyC'),
      walk: on('ShiftLeft', 'ShiftRight'),
    });
  }

  /** Returns true when the key was the game's. */
  private gameKey(e: KeyboardEvent, down: boolean): boolean {
    if (!this.asPlayer || !this.locked) return false;
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
    if (!ViewportEngine.GAME_KEYS.has(e.code)) return true;
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

  dispose(): void {
    this.disposed = true;
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
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
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
      if (frame.events.length || frame.logs.length || frame.errors.length || frame.uses.length) this.cb.playFrame(frame, this.play.info.names);
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
    if (!this.needsRender) return;
    this.needsRender = false;
    const t0 = performance.now();
    this.renderer.info.reset();
    this.render();
    this.cb.stats({
      frameMs: performance.now() - t0,
      draws: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      view: this.rig.kind,
      building: this.world.building,
      buildMs: this.world.stats.buildMs,
    });
  };

  private render(): void {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    r.clear();
    if (this.pivotMarker.visible) this.showPivotMarker();
    if (this.play?.placeCamera(this.fpCam)) {
      r.render(this.scene, this.fpCam);
      return;
    }
    this.grid.setCamera(this.rig.camera.position);
    r.render(this.scene, this.rig.camera);
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

  private buildAxisGizmo(): void {
    const axes: [THREE.Vector3, number, string][] = [
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
    const w = worldHit && !locked(worldHit.entityId) ? worldHit : null;
    if (markerHit && (!w || markerHit.distance <= w.distance)) return (markerHit.object.userData.entityId as string) ?? null;
    return w?.entityId ?? null;
  }

  /** The brush face under the cursor (level brushes only; markers are ignored in the face tool). */
  private pickFace(e: { clientX: number; clientY: number }): { ref: FaceRef | null; cut: boolean } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    // Subtract volumes never appear in the level, so the face tools click straight through them.
    const hit = this.world.pick(this.raycaster, true);
    if (!hit || !this.doc || isLocked(this.doc, this.doc.get(hit.entityId))) return null;
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
      if (!this.locked && e.button === 0) this.lockPointer();
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
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, mode };
    el.setPointerCapture(e.pointerId);
    if (mode === 'look') this.cb.setFlying(true);
  };

  private heightAnchor: { y: number; h: number } | null = null;

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
  };

  private onPointerMove = (e: PointerEvent): void => {
    // Polygon outline: the next corner follows the cursor.
    if (!this.drag && this.draft?.points && this.draft.stage === 'footprint') {
      const p = this.drawPoint(e, this.draft.bounds().min[draftAxes(this.rig.kind).e]);
      this.draft.setCursor(p);
      this.draft.update(this.shapeOpts, this.brushRole);
      this.invalidate();
      return;
    }
    // Height stage follows the mouse without a button held (perspective only; ortho views type the depth).
    if (!this.drag && this.draft?.stage === 'height' && this.rig.kind === 'perspective') {
      if (!this.heightAnchor) this.heightAnchor = { y: e.clientY, h: this.draft.height };
      const dh = (this.heightAnchor.y - e.clientY) * this.rig.unitsPerPixel;
      const g = this.snap ? this.gridSize : 1;
      let h = Math.round((this.heightAnchor.h + dh) / g) * g;
      if (Math.abs(h) < g) h = h < 0 ? -g : g;
      if (h !== this.draft.height) {
        this.draft.height = h;
        this.draft.update(this.shapeOpts, this.brushRole);
        this.cb.draft(this.draft.state());
        this.invalidate();
      }
      return;
    }
    if (!this.drag && this.editTool === 'loopcut' && !this.play) {
      this.updateLoop(e);
      return;
    }
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
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
      return;
    }
    e.preventDefault();
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
    if (this.isTyping(e)) return;
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
