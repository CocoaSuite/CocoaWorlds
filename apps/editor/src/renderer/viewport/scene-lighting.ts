/**
 * The scene's own lighting (Phase 7 / benchmark B3): its Light objects (bulbs, spotlights, suns, with shadows
 * where switched on), its ambient light, fog, and a gradient sky. Play always uses it; the editor shows it when
 * “Game lighting” is on, and its flat preview lights otherwise.
 *
 * Units: brightness 1 is a plain light; bulbs and spotlights fade with distance (1/d, so rooms stay readable)
 * and stop at their reach.
 */
import { dayOf, readComponent, sceneSettings, skyOf, type DayCycle, type EntityData, type SceneDoc, type SceneSettings } from '@cocoaworlds/core';
import { MOON, dayLook } from './day';
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
      // A much wider, softer view of the shadow's edge (two rings of looks around this point), so the band
      // spreads well into the shadow.
      vec2 cwT = 1.0 / directionalLightShadow.shadowMapSize;
      float cwW = cwOn ? ( getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( 8.000, 0.000 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( 4.000, 6.928 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( -4.000, 6.928 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( -8.000, 0.000 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( -4.000, -6.928 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( 4.000, -6.928 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( 16.579, 7.010 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( 6.767, 16.680 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( -7.010, 16.579 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( -16.680, 6.767 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( -16.579, -7.010 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( -6.767, -16.680 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( 7.010, -16.579 ), 0.0, 0.0 ) ) +
        getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, cwSc + vec4( cwT * vec2( 16.680, -6.767 ), 0.0, 0.0 ) ) ) / 14.0 : 1.0;
      // Strongest just inside the shadow, fading softly deeper in.
      float cwBand = clamp( cwW * ( 1.0 - cwW ) * 4.0, 0.0, 1.0 ) * ( 1.0 - 0.8 * cwSh );
      vec3 cwC = directLight.color;
      float cwL = dot( cwC, vec3( 0.2126, 0.7152, 0.0722 ) );
      // Its colour: the sky's (the sky-tinted ambient light), made more saturated, as bright as the sun allows.
      vec3 cwSky = vec3( 1.0, 0.75, 0.45 );
      #if NUM_HEMI_LIGHTS > 0
        cwSky = hemisphereLights[ 0 ].skyColor;
      #endif
      cwSky /= max( max( cwSky.r, max( cwSky.g, cwSky.b ) ), 1e-3 );
      vec3 cwVivid = max( mix( vec3( dot( cwSky, vec3( 0.2126, 0.7152, 0.0722 ) ) ), cwSky, 2.2 ), 0.0 ) * cwL;
      directLight.color = cwC * cwSh + cwVivid * cwBand * 0.5;
    }`,
  );

const AHEAD = new THREE.Vector3();

/** A cloud colour at an hour: as set by day, warmed at dawn and dusk, dark at night. */
const cloudAt = (day: string, night: string, dusk: string, look: { day: number; dusk: number }) =>
  new THREE.Color(night).lerp(new THREE.Color(day), look.day).lerp(new THREE.Color(dusk), look.dusk * 0.5);

/** A bulb of brightness 1 lights a wall this far away about as much as the sun does (units). */
const FALLOFF = 96;

/** How bright a colour looks. */
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export class SceneLighting {
  readonly group = new THREE.Group();
  private key = '';
  private boundsKey = '';
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private suns: THREE.DirectionalLight[] = [];
  /** The lights by object id, with how much brighter the light is than its Brightness (Play changes them). */
  readonly lights = new Map<string, { light: THREE.Light; falloff: number }>();
  /** With day and night on: the daytime look to change from, and what changes. */
  private day: { cycle: DayCycle; settings: SceneSettings; sun: THREE.DirectionalLight; sunColour: string; sunIntensity: number; noon: THREE.Vector3; center: THREE.Vector3; radius: number; hemi: THREE.HemisphereLight } | null = null;

  constructor() {
    this.group.name = 'scene-lighting';
    this.skyMat = skyMaterial();
    this.sky = skyMesh(this.skyMat);
  }

  /**
   * Rebuild from the scene when its lights or settings changed. `worldOf` gives an entity's world matrix,
   * `levelBounds` the level's extent (for the sun's shadows). `still`: the doc never changes (an exported game), so
   * once built for it only a change of the bounds builds again (nothing is compared each frame).
   */
  update(doc: SceneDoc, worldOf: (id: string) => number[], levelBounds: THREE.Box3, scene: THREE.Scene, still = false): void {
    const bKey = levelBounds.isEmpty() ? '' : [...levelBounds.min.toArray(), ...levelBounds.max.toArray()].map(Math.round).join(',');
    if (still && doc === this.stillDoc && bKey === this.boundsKey && this.key) return;
    this.stillDoc = still ? doc : null;
    const shown = (e: EntityData) => {
      for (let x: EntityData | undefined = e; x; x = x.parent ? doc.get(x.parent) : undefined) if (!x.visible) return false;
      return true;
    };
    const lights = doc.entities.filter((e) => e.components.light && shown(e));
    const settings = sceneSettings(doc.settings);
    const key = JSON.stringify([settings, lights.map((e) => [e.components.light, worldOf(e.id)])]);
    if (key === this.key && bKey === this.boundsKey) return;
    this.key = key;
    this.boundsKey = bKey;
    this.clear();

    // Ambient: sky-tinted from above, darker from below, so shapes read even out of direct light.
    // (Or from the sky, when it's set to light the scene.)
    const fromSky = !!settings.sky?.enabled && !!settings.sky.lightFromSky;
    const skyLight = skyAmbient(settings.sky);
    const amb = fromSky ? skyLight.above : new THREE.Color(settings.ambientColor);
    const hemi = new THREE.HemisphereLight(amb, fromSky ? skyLight.below : amb.clone().multiplyScalar(0.35), settings.ambientIntensity * 2.2);
    this.group.add(hemi);
    let firstSun: { colour: string; intensity: number; forward: THREE.Vector3 } | null = null;
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
        firstSun ??= { colour: l.color, intensity: l.intensity, forward: forward.clone() };
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
      this.lights.set(e.id, { light, falloff: l.kind === 'directional' ? 1 : FALLOFF });
      this.group.add(light);
    }

    // Day and night: the first Sun goes round (one is made if there is none).
    const cycle = dayOf(doc.settings);
    this.day = null;
    if (cycle.enabled) {
      let sun = this.suns[0];
      if (!sun) {
        sun = new THREE.DirectionalLight('#fff4e0', 2);
        sun.target.position.copy(center);
        this.group.add(sun.target, sun);
        const cam = sun.shadow.camera;
        cam.left = cam.bottom = -radius;
        cam.right = cam.top = radius;
        cam.near = 1;
        cam.far = radius * 4;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.bias = -0.0005;
        sun.shadow.normalBias = 2.5;
        sun.castShadow = true;
        this.suns.push(sun);
      }
      const f = firstSun?.forward ?? new THREE.Vector3(-0.35, -0.6, -0.45);
      this.day = { cycle, settings, sun, sunColour: firstSun?.colour ?? '#fff4e0', sunIntensity: firstSun?.intensity ?? 2, noon: new THREE.Vector3(-f.x, 0, -f.z), center, radius, hemi };
      this.lightSig = null;
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
    this.anyShadows = false;
    this.group.traverse((o) => {
      if ((o as THREE.Light).isLight && (o as THREE.Light).castShadow) this.anyShadows = true;
    });
  }

  private stillDoc: SceneDoc | null = null;
  private anyShadows = false;

  /** Show the hour (null: the hour the game starts at) when day and night is on. */
  setDay(hour: number | null): void {
    const d = this.day;
    if (!d) return;
    const h = hour ?? d.cycle.startHour;
    const st = d.settings;
    const sky = skyOf(st.sky);
    const look = dayLook(h, d.noon, { top: sky.top, horizon: sky.horizon, sun: d.sunColour, ambient: st.ambientColor }, d.cycle.night);
    const moonUp = look.moon > look.sun * d.sunIntensity;
    d.sun.position.copy(d.center).addScaledVector(moonUp ? look.toward.clone().negate() : look.toward, d.radius * 2);
    d.sun.color.copy(moonUp ? MOON : look.sunColour);
    d.sun.intensity = moonUp ? look.moon : look.sun * d.sunIntensity;
    const hex = (c: THREE.Color) => `#${c.getHexString()}`;
    const fromSky = !!st.sky?.enabled && !!st.sky.lightFromSky;
    const above = fromSky ? look.top.clone().lerp(look.horizon, 0.45) : look.ambient;
    d.hemi.color.copy(above);
    d.hemi.groundColor.copy(fromSky ? new THREE.Color(sky.ground).multiplyScalar(0.4 + 0.6 * look.day).lerp(above, 0.25) : above.clone().multiplyScalar(0.35));
    d.hemi.intensity = st.ambientIntensity * 2.2 * look.ambientScale;
    const sunSeen = sunSkyColour(hex(look.sunColour), d.sunIntensity).multiplyScalar(look.sun);
    applySky(this.skyMat, { ...sky, top: hex(look.top), horizon: hex(look.horizon), ground: hex(new THREE.Color(sky.ground).multiplyScalar(0.3 + 0.7 * look.day)), stars: Math.max(sky.stars, look.night), cloudColour: hex(cloudAt(sky.cloudColour, '#2a3246', '#ffb48c', look)), cloudShade: hex(cloudAt(sky.cloudShade, '#121724', '#8a5a6e', look)) }, { dir: look.toward, colour: sunSeen });
    if (this.fog) this.fog.color.copy(fromSky ? look.horizon : new THREE.Color(st.fog.color).lerp(look.horizon, 1 - look.day));
    this.background.copy(look.horizon);
    // (Reflections are drawn again only once the light has changed a little: drawing them is slow.)
    const sig = [d.sun.intensity, d.hemi.intensity * lum(d.hemi.color), lum(look.horizon), lum(look.top)];
    if (!this.lightSig || sig.some((v, i) => Math.abs(v - this.lightSig![i]!) > 0.004 + 0.03 * Math.abs(this.lightSig![i]!))) {
      this.lightSig = sig;
      this.dayVersion++;
      setReflection(hex(look.top), hex(look.horizon), hex(new THREE.Color(sky.ground).multiplyScalar(0.3 + 0.7 * look.day)));
    }
  }

  /** The light at the last reflection update, and a count that goes up at each (probes capture again then). */
  private lightSig: number[] | null = null;
  dayVersion = 0;

  private background = new THREE.Color('#1f1f1f');
  private fog: THREE.Fog | null = null;

  /** Put the background and fog on the scene (the lights live in `group`). */
  applyTo(scene: THREE.Scene): void {
    scene.background = this.background;
    scene.fog = this.fog;
  }

  /** Whether any light casts shadows (the renderer only draws shadow maps then). */
  get shadows(): boolean {
    return this.anyShadows;
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
    this.lights.clear();
  }

  /** Put a light where it is now, as scripts set it (off: no light, kept in place so nothing recompiles). */
  drive(id: string, s: { on: boolean; intensity: number; range: number; angle: number; color: number[] }, world: THREE.Matrix4 | null): void {
    const e = this.lights.get(id);
    if (!e) return;
    const l = e.light;
    l.intensity = s.on ? s.intensity * e.falloff : 0;
    l.color.setRGB(s.color[0]!, s.color[1]!, s.color[2]!);
    if (l instanceof THREE.PointLight || l instanceof THREE.SpotLight) {
      l.distance = s.range;
      l.shadow.camera.far = Math.max(8, s.range);
    }
    if (l instanceof THREE.SpotLight) l.angle = THREE.MathUtils.degToRad(Math.min(170, Math.max(1, s.angle)) / 2);
    if (world && !(l instanceof THREE.DirectionalLight)) {
      l.position.setFromMatrixPosition(world);
      if (l instanceof THREE.SpotLight) l.target.position.copy(l.position).add(AHEAD.set(0, 0, -1).transformDirection(world));
    }
  }

  dispose(): void {
    this.clear();
    this.sky.geometry.dispose();
    this.skyMat.dispose();
  }
}
