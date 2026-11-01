/**
 * The editor viewport: draws the level, grid and gizmos, handles camera navigation, picking, transform dragging
 * and the brush tool. Renders on demand (only after something changes) so an idle editor costs no GPU time.
 */
import type { EntityData, SceneDoc, Transform, Vec3 } from '@cocoaworlds/core';
import { bounds, center, composeM4, faceAt, transform as transformBrush, translate, type Brush, type V3 } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { brushOf, worldBrushes, type ShapeOptions } from '../brush/brushes';
import { BrushDraft, draftAxes, type DraftState } from './brush-draft';
import { CameraRig, type ViewKind } from './camera';
import { EditorGrid } from './grid';
import { buildMarker, disposeMarker, markerKey, setMarkerSelected, type Marker } from './markers';
import { WorldRenderer, type FaceRef } from './world-render';

export interface ViewportCallbacks {
  select(ids: string[], mode: 'replace' | 'toggle'): void;
  beginEdit(label: string): void;
  liveTransform(id: string, t: Transform): void;
  liveBrush(id: string, brush: Brush): void;
  endEdit(): void;
  contextMenu(clientX: number, clientY: number, ground: Vec3 | null): void;
  stats(s: ViewportStats): void;
  setFlying(active: boolean): void;
  draft(state: DraftState | null): void;
  createBrush(min: V3, max: V3): void;
  cancelTool(): void;
  /** Face tool click: `null` clicks empty space; `cut` is a surface made by a live cut (not editable). */
  selectFace(ref: FaceRef | null, mode: 'replace' | 'toggle' | 'brush', cut?: boolean): void;
}

export interface ViewportStats {
  frameMs: number;
  draws: number;
  triangles: number;
  view: ViewKind;
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
  /** Stand-in object the gizmo drags when a brush is selected (brush geometry lives in world space). */
  private brushProxy = new THREE.Object3D();
  private brushDrag: { id: string; original: Brush; pivot: V3 } | null = null;
  private axisScene = new THREE.Scene();
  private axisCam = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, -10, 10);
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private raf = 0;
  private lastTick = performance.now();
  private keys = new Set<string>();
  private drag: { button: number; x: number; y: number; moved: boolean; mode: 'look' | 'pan' | 'orbit' | 'click' | 'draw' | 'height' } | null = null;
  private spaceHeld = false;
  private doc: SceneDoc | null = null;
  private selection: string[] = [];
  private gridSize = 16;
  private snap = true;
  private gizmoMode: GizmoMode = 'none';
  private brushTool = false;
  private faceTool = false;
  private shapeOpts: ShapeOptions = { shape: 'box', sides: 16, steps: 8, facing: 0 };
  private brushRole: 'solid' | 'subtract' = 'solid';
  private draft: BrushDraft | null = null;
  private lastHeight = 128;
  private worldKey = '';
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

    this.scene.add(this.grid.object, this.world.group, this.brushProxy);
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
        this.cb.beginEdit(this.gizmoMode === 'rotate' ? 'Rotate' : this.gizmoMode === 'scale' ? 'Scale' : 'Move');
        if (this.gizmo.object === this.brushProxy) {
          const id = this.selection[0]!;
          const b = brushOf(this.doc?.get(id));
          if (b) this.brushDrag = { id, original: b.brush, pivot: [this.brushProxy.position.x, this.brushProxy.position.y, this.brushProxy.position.z] };
        }
      } else {
        this.brushDrag = null;
        this.cb.endEdit();
        this.placeBrushProxy();
      }
    });
    this.gizmo.addEventListener('objectChange', () => {
      const o = this.gizmo.object;
      if (!o) return;
      if (o === this.brushProxy) return this.onBrushGizmo();
      const id = o.userData.entityId as string | undefined;
      if (!id) return;
      this.cb.liveTransform(id, {
        position: [r3(o.position.x), r3(o.position.y), r3(o.position.z)],
        rotation: [r3(o.rotation.x / DEG), r3(o.rotation.y / DEG), r3(o.rotation.z / DEG)],
        scale: [r3(o.scale.x), r3(o.scale.y), r3(o.scale.z)],
      });
    });

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
    const seen = new Set<string>();
    if (doc) {
      for (const e of doc.entities) {
        if (e.components.brush) continue;
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
    const key = wb.map((b) => `${b.id}:${b.role}:${faceKey(doc!.get(b.id)!)}`).join('|');
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

  setBrushTool(active: boolean, opts: ShapeOptions, role: 'solid' | 'subtract'): void {
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
    this.cancelDraft();
    this.cb.createBrush(min, max);
  }

  cancelDraft(): void {
    if (!this.draft) return;
    this.scene.remove(this.draft.group);
    this.draft.dispose();
    this.draft = null;
    this.drag = null;
    this.cb.draft(null);
    this.invalidate();
  }

  setSnap(enabled: boolean, gridSize: number): void {
    this.snap = enabled;
    this.gridSize = gridSize;
    this.gizmo.setTranslationSnap(enabled ? gridSize : null);
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

  frameSelection(): void {
    const box = new THREE.Box3();
    const addBrush = (id: string) => {
      const bb = bounds(this.world.brush(id)?.brush ?? { faces: [] });
      if (bb) box.expandByPoint(new THREE.Vector3(...bb.min)).expandByPoint(new THREE.Vector3(...bb.max));
    };
    for (const id of this.selection) {
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
    this.gizmo.detach();
    this.gizmo.dispose();
    for (const { m } of this.markers.values()) disposeMarker(m);
    this.world.dispose();
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
      const t = e.transform;
      g.position.set(...t.position);
      g.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG, 'YXZ');
      g.scale.set(...t.scale);
    }
    g.visible = e.visible;
    g.userData.locked = e.locked;
  }

  private applySelection(): void {
    for (const [id, { m }] of this.markers) setMarkerSelected(m, this.selection.includes(id));
    this.world.setSelection(this.selection);
    const id = this.selection.length === 1 ? this.selection[0]! : null;
    const ent = id ? this.doc?.get(id) : undefined;
    let target: THREE.Object3D | null = null;
    if (ent && ent.visible && !ent.locked && this.gizmoMode !== 'none' && !this.brushTool && !this.faceTool) {
      if (ent.components.brush) {
        if (!this.brushDrag) this.placeBrushProxy();
        target = this.brushProxy;
      } else {
        target = this.markers.get(ent.id)?.m.group ?? null;
      }
    }
    if (target) {
      if (this.gizmo.object !== target) this.gizmo.attach(target);
      this.gizmo.setMode(this.gizmoMode === 'none' ? 'translate' : this.gizmoMode);
    } else if (this.gizmo.object) {
      this.gizmo.detach();
    }
  }

  /** Put the gizmo stand-in at the centre of the selected brush, unrotated and unscaled. */
  private placeBrushProxy(): void {
    const id = this.selection.length === 1 ? this.selection[0]! : null;
    const b = id ? brushOf(this.doc?.get(id)) : null;
    if (!b) return;
    const c = center(b.brush);
    this.brushProxy.position.set(...c);
    this.brushProxy.rotation.set(0, 0, 0);
    this.brushProxy.scale.set(1, 1, 1);
    this.brushProxy.updateMatrixWorld();
  }

  /** Turn the stand-in's movement into a new brush, always computed from the brush as it was when the drag began. */
  private onBrushGizmo(): void {
    const d = this.brushDrag;
    if (!d) return;
    const p = this.brushProxy;
    const delta: V3 = [p.position.x - d.pivot[0], p.position.y - d.pivot[1], p.position.z - d.pivot[2]];
    let next: Brush;
    if (this.gizmoMode === 'translate') {
      next = translate(d.original, delta);
    } else {
      const rot: V3 = [p.rotation.x / DEG, p.rotation.y / DEG, p.rotation.z / DEG];
      const s: V3 = [Math.max(0.01, Math.abs(p.scale.x)), Math.max(0.01, Math.abs(p.scale.y)), Math.max(0.01, Math.abs(p.scale.z))];
      next = transformBrush(d.original, composeM4(delta, rot, s, d.pivot));
    }
    this.cb.liveBrush(d.id, next);
  }

  // ── rendering ──

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
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
    });
  };

  private render(): void {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    r.clear();
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
    return out;
  }

  /** Ground point for "add here" menus. */
  private groundPoint(e: { clientX: number; clientY: number }): Vec3 | null {
    return this.drawPoint(e);
  }

  private pick(e: { clientX: number; clientY: number }): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const targets: THREE.Object3D[] = [];
    for (const { m } of this.markers.values()) if (m.group.visible && !m.group.userData.locked) targets.push(m.pick);
    const markerHit = this.raycaster.intersectObjects(targets, false)[0];
    const worldHit = this.world.pick(this.raycaster);
    const locked = (id: string) => !!this.doc?.get(id)?.locked;
    const w = worldHit && !locked(worldHit.entityId) ? worldHit : null;
    if (markerHit && (!w || markerHit.distance <= w.distance)) return (markerHit.object.userData.entityId as string) ?? null;
    return w?.entityId ?? null;
  }

  /** The brush face under the cursor (level brushes only; markers are ignored in the face tool). */
  private pickFace(e: { clientX: number; clientY: number }): { ref: FaceRef | null; cut: boolean } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    // Subtract volumes never appear in the level, so the face tools click straight through them.
    const hit = this.world.pick(this.raycaster, true);
    if (!hit || this.doc?.get(hit.entityId)?.locked) return null;
    const wb = this.world.brush(hit.entityId);
    if (!wb) return null;
    const face = faceAt(wb.brush, [hit.point.x, hit.point.y, hit.point.z], [hit.normal.x, hit.normal.y, hit.normal.z], 0.05);
    return face < 0 ? { ref: null, cut: true } : { ref: { id: hit.entityId, face }, cut: false };
  }

  private onPointerDown = (e: PointerEvent): void => {
    const el = this.renderer.domElement;
    el.focus();
    if (this.gizmo.dragging || (this.gizmo as unknown as { axis: string | null }).axis) return;
    const persp = this.rig.kind === 'perspective';
    let mode: NonNullable<typeof this.drag>['mode'];
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) mode = 'pan';
    else if (e.button === 2) mode = persp ? 'look' : 'pan';
    else if (e.button === 0 && e.altKey && persp) mode = 'orbit';
    else if (e.button === 0 && this.brushTool) mode = this.draft?.stage === 'height' ? 'height' : 'draw';
    else if (e.button === 0) mode = 'click';
    else return;

    if (mode === 'height') {
      // Second click confirms the brush.
      this.confirmDraft();
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
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false, mode };
    el.setPointerCapture(e.pointerId);
    if (mode === 'look') this.cb.setFlying(true);
  };

  private heightAnchor: { y: number; h: number } | null = null;

  private onPointerMove = (e: PointerEvent): void => {
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
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
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
    if (d.mode === 'draw') {
      const dr = this.draft;
      if (!dr || !dr.hasArea) return this.cancelDraft();
      dr.stage = 'height';
      this.heightAnchor = null;
      dr.update(this.shapeOpts, this.brushRole);
      this.cb.draft(dr.state());
      this.invalidate();
      return;
    }
    if (d.moved) return;
    if (d.mode === 'click' && this.faceTool) {
      const mode = e.shiftKey ? 'brush' : e.ctrlKey || e.metaKey ? 'toggle' : 'replace';
      const hit = this.pickFace(e);
      this.cb.selectFace(hit?.ref ?? null, mode, hit?.cut);
    } else if (d.mode === 'click') {
      const id = this.pick(e);
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      this.cb.select(id ? [id] : [], additive ? 'toggle' : 'replace');
    } else if (d.button === 2) {
      if (this.draft) return this.cancelDraft();
      const id = this.pick(e);
      if (id && !this.selection.includes(id)) this.cb.select([id], 'replace');
      this.cb.contextMenu(e.clientX, e.clientY, this.groundPoint(e));
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
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
    if (this.isTyping(e)) return;
    if (this.draft && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') this.confirmDraft();
      else this.cancelDraft();
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
    if (e.code === 'Space') this.spaceHeld = false;
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.spaceHeld = false;
  };

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onContext = (e: Event): void => e.preventDefault();

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  private unbindInput(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
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
