/**
 * Scene reflections: a reflection probe that captures the level around the camera into a cube map (6 small
 * renders), blurred by roughness (PMREM), which shiny and metal project materials then reflect: real walls,
 * floors and sky instead of a painted sky gradient. Captured again when the camera has moved a fair way or the
 * level changed (never more than twice a second); not parallax-corrected, so near things reflect approximately.
 */
import * as THREE from 'three';
import { setSceneReflection } from './project-materials';

/** How far (u) the camera may move before the scene is captured again. */
const MOVE = 192;

export class SceneReflections {
  private cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  private cam = new THREE.CubeCamera(1, 40000, this.cube);
  private pmrem: THREE.PMREMGenerator;
  private env: THREE.WebGLRenderTarget | null = null;
  private at = new THREE.Vector3(Infinity, Infinity, Infinity);
  private last = 0;
  private on = false;
  /** Set when the level changed: capture again at the next chance. */
  dirty = true;

  constructor(private r: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(r);
  }

  /** Capture if due (camera at `eye`); `helpers` are editor aids left out of the picture. */
  update(scene: THREE.Scene, eye: THREE.Vector3, enabled: boolean, helpers: THREE.Object3D[] = []): void {
    if (!enabled) {
      if (this.on) {
        this.on = false;
        setSceneReflection(null);
      }
      return;
    }
    const now = performance.now();
    if (this.on && !this.dirty && this.at.distanceTo(eye) < MOVE) return;
    if (now - this.last < 500) return;
    this.last = now;
    this.dirty = false;
    this.at.copy(eye);
    // (No editor aids, no second shadow pass.)
    const aids: THREE.Object3D[] = [...helpers.filter((h) => h.visible)];
    scene.traverseVisible((o) => {
      if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Object3D & { isTransformControlsRoot?: boolean }).isTransformControlsRoot) aids.push(o);
    });
    for (const o of aids) o.visible = false;
    // (Glass is left out of the capture: it would draw the scene behind it again for each of the six views.)
    const glass = new Set<THREE.Material>();
    scene.traverseVisible((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) if ((x as THREE.MeshPhysicalMaterial).transmission > 0 && x.visible) glass.add(x);
    });
    for (const m of glass) m.visible = false;
    const auto = this.r.shadowMap.autoUpdate;
    this.r.shadowMap.autoUpdate = false;
    this.cam.position.copy(eye);
    this.cam.updateMatrixWorld(true);
    this.cam.update(this.r, scene);
    this.r.shadowMap.autoUpdate = auto;
    for (const o of aids) o.visible = true;
    for (const m of glass) m.visible = true;
    const next = this.pmrem.fromCubemap(this.cube.texture);
    setSceneReflection(next.texture);
    this.env?.dispose();
    this.env = next;
    this.on = true;
  }

  dispose(): void {
    if (this.on) setSceneReflection(null);
    this.env?.dispose();
    this.cube.dispose();
    this.pmrem.dispose();
  }
}
