/**
 * The scene's own lighting (Phase 7 / benchmark B3): its Light objects (bulbs, spotlights, suns, with shadows
 * where switched on), its ambient light, fog, and a gradient sky. Play always uses it; the editor shows it when
 * “Game lighting” is on, and its flat preview lights otherwise.
 *
 * Units: brightness 1 is a plain light; bulbs and spotlights fade with distance (1/d, so rooms stay readable)
 * and stop at their reach.
 */
import { readComponent, sceneSettings, type EntityData, type SceneDoc } from '@cocoaworlds/core';
import * as THREE from 'three';
import { setReflection } from './project-materials';

type LightData = {
  kind: 'point' | 'spot' | 'directional';
  color: string;
  intensity: number;
  range: number;
  angle: number;
  castShadows: boolean;
};

/** A bulb of brightness 1 lights a wall this far away about as much as the sun does (units). */
const FALLOFF = 96;

export class SceneLighting {
  readonly group = new THREE.Group();
  private key = '';
  private boundsKey = '';
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private suns: THREE.DirectionalLight[] = [];

  constructor() {
    this.group.name = 'scene-lighting';
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // on the far plane: always behind everything
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 c = y >= 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon, ground, pow(-y, 0.4));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    // Follows the camera, so it never gets nearer.
    this.sky.onBeforeRender = (_r, _s, cam) => {
      this.sky.position.copy(cam.position);
      this.sky.scale.setScalar(1000);
      this.sky.updateMatrixWorld();
    };
  }

  /**
   * Rebuild from the scene when its lights or settings changed. `worldOf` gives an entity's world matrix,
   * `levelBounds` the level's extent (for the sun's shadows).
   */
  update(doc: SceneDoc, worldOf: (id: string) => number[], levelBounds: THREE.Box3, scene: THREE.Scene): void {
    const shown = (e: EntityData) => {
      for (let x: EntityData | undefined = e; x; x = x.parent ? doc.get(x.parent) : undefined) if (!x.visible) return false;
      return true;
    };
    const lights = doc.entities.filter((e) => e.components.light && shown(e));
    const settings = sceneSettings(doc.settings);
    const key = JSON.stringify([settings, lights.map((e) => [e.components.light, worldOf(e.id)])]);
    const bKey = levelBounds.isEmpty() ? '' : [...levelBounds.min.toArray(), ...levelBounds.max.toArray()].map(Math.round).join(',');
    if (key === this.key && bKey === this.boundsKey) return;
    this.key = key;
    this.boundsKey = bKey;
    this.clear();

    // Ambient: sky-tinted from above, darker from below, so shapes read even out of direct light.
    const amb = new THREE.Color(settings.ambientColor);
    this.group.add(new THREE.HemisphereLight(amb, amb.clone().multiplyScalar(0.35), settings.ambientIntensity * 2.2));

    const center = levelBounds.isEmpty() ? new THREE.Vector3() : levelBounds.getCenter(new THREE.Vector3());
    const radius = levelBounds.isEmpty() ? 1024 : Math.max(256, levelBounds.getSize(new THREE.Vector3()).length() / 2);
    for (const e of lights) {
      const l = readComponent<LightData>('light', e.components.light);
      const m = new THREE.Matrix4().fromArray(worldOf(e.id));
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      const forward = new THREE.Vector3(0, 0, -1).transformDirection(m);
      const color = new THREE.Color(l.color);
      let light: THREE.Light;
      if (l.kind === 'directional') {
        const sun = new THREE.DirectionalLight(color, l.intensity);
        sun.position.copy(center).addScaledVector(forward, -radius * 2);
        sun.target.position.copy(center);
        this.group.add(sun.target);
        if (l.castShadows) {
          const cam = sun.shadow.camera;
          cam.left = cam.bottom = -radius;
          cam.right = cam.top = radius;
          cam.near = 1;
          cam.far = radius * 4;
          sun.shadow.mapSize.set(2048, 2048);
          sun.shadow.bias = -0.0002;
          sun.shadow.normalBias = 0.35;
        }
        this.suns.push(sun);
        light = sun;
      } else if (l.kind === 'spot') {
        const spot = new THREE.SpotLight(color, l.intensity * FALLOFF, l.range, THREE.MathUtils.degToRad(Math.min(170, l.angle) / 2), 0.35, 1);
        spot.position.copy(pos);
        spot.target.position.copy(pos).add(forward);
        this.group.add(spot.target);
        if (l.castShadows) {
          spot.shadow.mapSize.set(1024, 1024);
          spot.shadow.camera.near = 4;
          spot.shadow.camera.far = l.range;
          spot.shadow.bias = -0.0003;
          spot.shadow.normalBias = 0.3;
        }
        light = spot;
      } else {
        const bulb = new THREE.PointLight(color, l.intensity * FALLOFF, l.range, 1);
        bulb.position.copy(pos);
        if (l.castShadows) {
          bulb.shadow.mapSize.set(512, 512);
          bulb.shadow.camera.near = 4;
          bulb.shadow.camera.far = l.range;
          bulb.shadow.bias = -0.001;
          bulb.shadow.normalBias = 0.3;
        }
        light = bulb;
      }
      light.castShadow = l.castShadows;
      light.name = e.id;
      this.group.add(light);
    }

    // Sky, background and fog.
    const sky = settings.sky!;
    this.skyMat.uniforms.top!.value.set(sky.top);
    this.skyMat.uniforms.horizon!.value.set(sky.horizon);
    this.skyMat.uniforms.ground!.value.set(sky.ground);
    if (sky.enabled) this.group.add(this.sky);
    // What shiny and metal project materials reflect: the sky, or the ambient light without one.
    const a = amb.clone().multiplyScalar(Math.min(1.5, settings.ambientIntensity * 2.2));
    if (sky.enabled) setReflection(sky.top, sky.horizon, sky.ground);
    else setReflection(`#${a.getHexString()}`, `#${a.clone().multiplyScalar(0.7).getHexString()}`, `#${a.clone().multiplyScalar(0.3).getHexString()}`);
    this.background = new THREE.Color(settings.backgroundColor);
    this.fog = settings.fog.enabled ? new THREE.Fog(settings.fog.color, settings.fog.near, settings.fog.far) : null;
    this.applyTo(scene);
  }

  private background = new THREE.Color('#1f1f1f');
  private fog: THREE.Fog | null = null;

  /** Put the background and fog on the scene (the lights live in `group`). */
  applyTo(scene: THREE.Scene): void {
    scene.background = this.background;
    scene.fog = this.fog;
  }

  /** Whether any light casts shadows (the renderer only draws shadow maps then). */
  get shadows(): boolean {
    let any = false;
    this.group.traverse((o) => {
      if ((o as THREE.Light).isLight && (o as THREE.Light).castShadow) any = true;
    });
    return any;
  }

  /** Force a rebuild on the next update (for example when the level bounds changed a lot). */
  invalidate(): void {
    this.key = '';
  }

  private clear(): void {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      if ((o as THREE.Light).isLight) (o as THREE.Light & { shadow?: THREE.LightShadow }).shadow?.dispose?.();
    }
    this.suns = [];
  }

  dispose(): void {
    this.clear();
    this.sky.geometry.dispose();
    this.skyMat.dispose();
  }
}
