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
import { applySky, skyAmbient, skyMaterial, skyMesh, sunSkyColour } from './sky';

type LightData = {
  kind: 'point' | 'spot' | 'directional';
  color: string;
  intensity: number;
  range: number;
  angle: number;
  castShadows: boolean;
};

/**
 * Where sunlight meets shadow, a band of warmer, more saturated light (as painters do): strongest in the soft edge
 * of the shadow and fading into it. One change to Three.js's lighting chunk, so every lit material gets it.
 */
const SUN_LINE = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
if (THREE.ShaderChunk.lights_fragment_begin.includes(SUN_LINE))
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    SUN_LINE,
    `{
      bool cwOn = directLight.visible && receiveShadow;
      vec4 cwSc = vDirectionalShadowCoord[ i ];
      float cwSh = cwOn ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc ) : 1.0;
      // A wider view of the shadow's edge (four looks a few texels out), so the band has room.
      vec2 cwT = 7.0 / directionalLightShadow.shadowMapSize;
      float cwW = cwOn ? 0.25 * (
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT.x, cwT.y, 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( -cwT.x, -cwT.y, 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT.x, -cwT.y, 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( -cwT.x, cwT.y, 0.0, 0.0 ) ) ) : 1.0;
      // Strongest just inside the shadow, fading softly deeper in.
      float cwBand = clamp( cwW * ( 1.0 - cwW ) * 4.0, 0.0, 1.0 ) * ( 1.0 - 0.75 * cwSh );
      vec3 cwC = directLight.color;
      vec3 cwVivid = max( mix( vec3( dot( cwC, vec3( 0.2126, 0.7152, 0.0722 ) ) ), cwC, 2.4 ), 0.0 ) * vec3( 1.15, 0.8, 0.45 );
      directLight.color = cwC * cwSh + cwVivid * cwBand * 0.45;
    }`,
  );

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
    this.skyMat = skyMaterial();
    this.sky = skyMesh(this.skyMat);
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
    // (Or from the sky, when it's set to light the scene.)
    const fromSky = !!settings.sky?.enabled && !!settings.sky.lightFromSky;
    const skyLight = skyAmbient(settings.sky);
    const amb = fromSky ? skyLight.above : new THREE.Color(settings.ambientColor);
    this.group.add(new THREE.HemisphereLight(amb, fromSky ? skyLight.below : amb.clone().multiplyScalar(0.35), settings.ambientIntensity * 2.2));
    let sunForSky: { dir: THREE.Vector3; colour: THREE.Color } | null = null;

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
        // (The sky shows the first sun, where it shines from.)
        sunForSky ??= { dir: forward.clone().negate(), colour: sunSkyColour(l.color, l.intensity) };
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
          sun.shadow.bias = -0.0005;
          // (In world units: about a shadow-map texel at this scale, so curved meshes don't stripe themselves.)
          sun.shadow.normalBias = 2.5;
          // (A wider soft edge, where the saturated band shows.)
          sun.shadow.radius = 1.5;
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
          spot.shadow.normalBias = 1.5;
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
          bulb.shadow.normalBias = 1.5;
        }
        light = bulb;
      }
      light.castShadow = l.castShadows;
      light.name = e.id;
      this.group.add(light);
    }

    // Sky, background and fog.
    const sky = settings.sky!;
    applySky(this.skyMat, sky, sunForSky);
    if (sky.enabled) this.group.add(this.sky);
    // What shiny and metal project materials reflect: the sky, or the ambient light without one.
    const a = amb.clone().multiplyScalar(Math.min(1.5, settings.ambientIntensity * 2.2));
    if (sky.enabled) setReflection(sky.top, sky.horizon, sky.ground);
    else setReflection(`#${a.getHexString()}`, `#${a.clone().multiplyScalar(0.7).getHexString()}`, `#${a.clone().multiplyScalar(0.3).getHexString()}`);
    this.background = new THREE.Color(settings.backgroundColor);
    this.fog = settings.fog.enabled ? new THREE.Fog(fromSky ? skyLight.fog : settings.fog.color, settings.fog.near, settings.fog.far) : null;
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
