/**
 * The editor viewport: draws the scene, grid and gizmos, handles camera navigation, picking and transform dragging.
 * Renders on demand (only after something changes) so an idle editor costs no GPU time.
 */
import type { EntityData, SceneDoc, Transform, Vec3 } from '@cocoaworlds/core';
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CameraRig, type ViewKind } from './camera';
import { EditorGrid } from './grid';
import { buildMarker, disposeMarker, markerKey, setMarkerSelected, type Marker } from './markers';

export interface ViewportCallbacks {
  select(ids: string[], mode: 'replace' | 'toggle'): void;
  beginEdit(label: string): void;
  liveTransform(id: string, t: Transform): void;
  endEdit(): void;
  contextMenu(clientX: number, clientY: number, ground: Vec3 | null): void;
  stats(s: ViewportStats): void;
  setFlying(active: boolean): void;
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
  private markers = new Map<string, { m: Marker; key: string }>();
  private gizmo: TransformControls;
  private axisScene = new THREE.Scene();
  private axisCam = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, -10, 10);
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private raf = 0;
  private lastTick = performance.now();
  private keys = new Set<string>();
  private drag: { button: number; x: number; y: number; moved: boolean; mode: 'look' | 'pan' | 'orbit' | 'click' } | null = null;
  private spaceHeld = false;
  private doc: SceneDoc | null = null;
  private selection: string[] = [];
  private gridSize = 16;
  private snap = true;
  private gizmoMode: GizmoMode = 'none';
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
    this.renderer.domElement.className = 'cw-canvas';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '3D viewport');
    host.prepend(this.renderer.domElement);

    this.scene.add(this.grid.object);
    this.scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x2a2622, 1.2));

    this.gizmo = new TransformControls(this.rig.camera, this.renderer.domElement);
    this.gizmo.setSpace('world');
    this.gizmo.setSize(0.9);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('change', () => this.invalidate());
    this.gizmo.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      if (dragging) this.cb.beginEdit(this.gizmoMode === 'rotate' ? 'Rotate' : this.gizmoMode === 'scale' ? 'Scale' : 'Move');
      else this.cb.endEdit();
    });
    this.gizmo.addEventListener('objectChange', () => {
      const o = this.gizmo.object;
      const id = o?.userData.entityId as string | undefined;
      if (!o || !id) return;
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
    this.syncAll();
  }

  /** Re-read entities from the doc (called after any scene change). */
  syncAll(): void {
    const doc = this.doc;
    const seen = new Set<string>();
    if (doc) {
      for (const e of doc.entities) {
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
    this.rig.setView(kind);
    this.gizmo.camera = this.rig.camera;
    this.grid.orient(kind);
    this.grid.update(this.gridSize, this.rig.unitsPerPixel);
    this.invalidate();
  }

  frameSelection(): void {
    const box = new THREE.Box3();
    for (const id of this.selection) {
      const rec = this.markers.get(id);
      if (rec) box.expandByObject(rec.m.group);
    }
    if (box.isEmpty()) for (const { m } of this.markers.values()) box.expandByObject(m.group);
    this.rig.frame(box);
    this.grid.update(this.gridSize, this.rig.unitsPerPixel);
    this.invalidate();
  }

  invalidate(): void {
    this.needsRender = true;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.unbindInput();
    this.gizmo.detach();
    this.gizmo.dispose();
    for (const { m } of this.markers.values()) disposeMarker(m);
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
    // Don't fight the gizmo while it is dragging this object.
    if (!(this.gizmo.dragging && this.gizmo.object === g)) {
      const t = e.transform;
      g.position.set(...t.position);
      g.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG, 'YXZ');
      g.scale.set(...t.scale);
    }
    // Parenting is shown in the hierarchy; world placement uses each entity's own transform until Phase 4 adds nested transforms.
    g.visible = e.visible;
    g.userData.locked = e.locked;
  }

  private applySelection(): void {
    for (const [id, { m }] of this.markers) setMarkerSelected(m, this.selection.includes(id));
    const only = this.selection.length === 1 ? this.markers.get(this.selection[0]!) : undefined;
    const target = only && only.m.group.visible && !only.m.group.userData.locked && this.gizmoMode !== 'none' ? only.m.group : null;
    if (target) {
      if (this.gizmo.object !== target) this.gizmo.attach(target);
      this.gizmo.setMode(this.gizmoMode === 'none' ? 'translate' : this.gizmoMode);
    } else if (this.gizmo.object) {
      this.gizmo.detach();
    }
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
    // Axis indicator in the bottom-left corner.
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

  /** Where the cursor meets the ground plane (or the view plane in ortho views), snapped to the grid. */
  private groundPoint(e: { clientX: number; clientY: number }): Vec3 | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const k = this.rig.kind;
    const plane =
      k === 'front' ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) : k === 'side' ? new THREE.Plane(new THREE.Vector3(1, 0, 0), 0) : new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!p) return null;
    const g = this.snap ? this.gridSize : 1;
    return [Math.round(p.x / g) * g, Math.round(p.y / g) * g, Math.round(p.z / g) * g];
  }

  private pick(e: { clientX: number; clientY: number }): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const targets: THREE.Object3D[] = [];
    for (const { m } of this.markers.values()) if (m.group.visible && !m.group.userData.locked) targets.push(m.pick);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return (hit?.object.userData.entityId as string | undefined) ?? null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const el = this.renderer.domElement;
    el.focus();
    if (this.gizmo.dragging || (this.gizmo as unknown as { axis: string | null }).axis) return; // gizmo handles it
    const persp = this.rig.kind === 'perspective';
    let mode: 'look' | 'pan' | 'orbit' | 'click';
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) mode = 'pan';
    else if (e.button === 2) mode = persp ? 'look' : 'pan';
    else if (e.button === 0 && e.altKey && persp) mode = 'orbit';
    else if (e.button === 0) mode = 'click';
    else return;
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false, mode };
    el.setPointerCapture(e.pointerId);
    if (mode === 'look') this.cb.setFlying(true);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
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
    if (d.moved) return;
    if (d.mode === 'click') {
      const id = this.pick(e);
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      this.cb.select(id ? [id] : [], additive ? 'toggle' : 'replace');
    } else if (d.button === 2) {
      const id = this.pick(e);
      if (id && !this.selection.includes(id)) this.cb.select([id], 'replace');
      this.cb.contextMenu(e.clientX, e.clientY, this.groundPoint(e));
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.drag?.mode === 'look') {
      // While flying, the wheel changes fly speed.
      this.rig.flySpeed = THREE.MathUtils.clamp(this.rig.flySpeed * Math.exp(-e.deltaY * 0.002), 32, 8192);
      return;
    }
    this.rig.wheel(e.deltaY, this.ndc(e));
    this.grid.update(this.gridSize, this.rig.unitsPerPixel);
    this.invalidate();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !this.isTyping(e)) {
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
