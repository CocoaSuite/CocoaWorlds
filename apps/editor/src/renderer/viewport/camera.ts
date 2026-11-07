/**
 * Editor camera navigation.
 *  Perspective: right-drag looks around (WASD/QE fly while held), Alt+left-drag orbits the focus point,
 *               middle-drag or Space+left-drag pans, the wheel dollies.
 *  Top/Front/Side: orthographic; middle/right-drag or Space+left-drag pans, the wheel zooms at the cursor.
 */
import * as THREE from 'three';

export type ViewKind = 'perspective' | 'top' | 'front' | 'side';

const ORTHO_DIRS: Record<Exclude<ViewKind, 'perspective'>, { dir: THREE.Vector3; up: THREE.Vector3 }> = {
  top: { dir: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, -1) },
  front: { dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  side: { dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
};

export class CameraRig {
  readonly persp = new THREE.PerspectiveCamera(70, 1, 1, 65536);
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -65536, 65536);
  kind: ViewKind = 'perspective';

  // Perspective state
  private yaw = -Math.PI / 4;
  private pitch = -0.45;
  private pos = new THREE.Vector3(-600, 420, 600);
  private focusDist = 900;

  /** The point the camera orbits around (straight ahead at the focus distance). */
  get target(): THREE.Vector3 {
    return this.pos.clone().addScaledVector(this.forward(), this.focusDist);
  }
  flySpeed = 512; // units per second

  // Ortho state per view: centre in view plane and units-per-pixel
  private orthoState: Record<string, { center: THREE.Vector3; upp: number }> = {
    top: { center: new THREE.Vector3(), upp: 2 },
    front: { center: new THREE.Vector3(0, 128, 0), upp: 2 },
    side: { center: new THREE.Vector3(0, 128, 0), upp: 2 },
  };
  private w = 1;
  private h = 1;

  constructor() {
    this.persp.rotation.order = 'YXZ';
    this.applyPersp();
  }

  get camera(): THREE.Camera {
    return this.kind === 'perspective' ? this.persp : this.ortho;
  }

  /** World units per screen pixel, used for gizmo sizing and grid level-of-detail. */
  get unitsPerPixel(): number {
    if (this.kind !== 'perspective') return this.orthoState[this.kind]!.upp;
    return (2 * this.focusDist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2))) / this.h;
  }

  setView(kind: ViewKind): void {
    this.kind = kind;
    if (kind === 'perspective') this.applyPersp();
    else this.applyOrtho();
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.persp.aspect = this.w / this.h;
    this.persp.updateProjectionMatrix();
    this.applyOrtho();
  }

  // ── perspective ──

  look(dx: number, dy: number): void {
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.applyPersp();
  }

  forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyEuler(this.persp.rotation);
  }

  fly(move: THREE.Vector3, dt: number, fast: boolean): void {
    const speed = this.flySpeed * (fast ? 3 : 1) * dt;
    const f = this.forward();
    const r = new THREE.Vector3(1, 0, 0).applyEuler(this.persp.rotation);
    const u = new THREE.Vector3(0, 1, 0);
    this.pos.addScaledVector(f, move.z * speed).addScaledVector(r, move.x * speed).addScaledVector(u, move.y * speed);
    this.applyPersp();
  }

  orbit(dx: number, dy: number): void {
    const focus = this.pos.clone().addScaledVector(this.forward(), this.focusDist);
    this.look(dx, dy);
    this.pos.copy(focus).addScaledVector(this.forward(), -this.focusDist);
    this.applyPersp();
  }

  /** Pan by a screen-space delta in pixels. */
  pan(dx: number, dy: number): void {
    if (this.kind === 'perspective') {
      const k = this.unitsPerPixel;
      const r = new THREE.Vector3(1, 0, 0).applyEuler(this.persp.rotation);
      const u = new THREE.Vector3(0, 1, 0).applyEuler(this.persp.rotation);
      this.pos.addScaledVector(r, -dx * k).addScaledVector(u, dy * k);
      this.applyPersp();
      return;
    }
    const s = this.orthoState[this.kind]!;
    const { right, up } = this.orthoAxes();
    s.center.addScaledVector(right, -dx * s.upp).addScaledVector(up, dy * s.upp);
    this.applyOrtho();
  }

  /** Wheel: dolly in perspective, zoom towards the cursor in ortho. `ndc` is the cursor in -1..1. */
  wheel(deltaY: number, ndc: THREE.Vector2): void {
    const factor = Math.exp(deltaY * 0.0015);
    if (this.kind === 'perspective') {
      // Scrolling down (positive delta) moves back, like zooming out.
      const dist = THREE.MathUtils.clamp(this.focusDist * factor, 16, 40000);
      this.pos.addScaledVector(this.forward(), this.focusDist - dist);
      this.focusDist = dist;
      this.applyPersp();
      return;
    }
    const s = this.orthoState[this.kind]!;
    const { right, up } = this.orthoAxes();
    const before = s.center.clone().addScaledVector(right, (ndc.x * this.w * s.upp) / 2).addScaledVector(up, (ndc.y * this.h * s.upp) / 2);
    s.upp = THREE.MathUtils.clamp(s.upp * factor, 0.02, 64);
    const after = s.center.clone().addScaledVector(right, (ndc.x * this.w * s.upp) / 2).addScaledVector(up, (ndc.y * this.h * s.upp) / 2);
    s.center.add(before.sub(after));
    this.applyOrtho();
  }

  /** Move the camera so the box fills the view. */
  frame(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 64);
    if (this.kind === 'perspective') {
      this.focusDist = size / (2 * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2))) + size * 0.25;
      this.pos.copy(c).addScaledVector(this.forward(), -this.focusDist);
      this.applyPersp();
    } else {
      const s = this.orthoState[this.kind]!;
      s.center.copy(c);
      s.upp = THREE.MathUtils.clamp((size * 1.4) / Math.min(this.w, this.h), 0.02, 64);
      this.applyOrtho();
    }
  }

  private orthoAxes(): { right: THREE.Vector3; up: THREE.Vector3; dir: THREE.Vector3 } {
    const k = (this.kind === 'perspective' ? 'top' : this.kind) as keyof typeof ORTHO_DIRS;
    const { dir, up } = ORTHO_DIRS[k];
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    return { right, up, dir };
  }

  private applyPersp(): void {
    this.persp.position.copy(this.pos);
    this.persp.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.persp.updateMatrixWorld();
  }

  private applyOrtho(): void {
    if (this.kind === 'perspective') return;
    const s = this.orthoState[this.kind]!;
    const { dir, up } = this.orthoAxes();
    const hw = (this.w * s.upp) / 2;
    const hh = (this.h * s.upp) / 2;
    this.ortho.left = -hw;
    this.ortho.right = hw;
    this.ortho.top = hh;
    this.ortho.bottom = -hh;
    this.ortho.position.copy(s.center).addScaledVector(dir, -32768);
    this.ortho.up.copy(up);
    this.ortho.lookAt(s.center);
    this.ortho.updateProjectionMatrix();
    this.ortho.updateMatrixWorld();
  }
}
