/**
 * Stylized water: clear and light where it's shallow, deep blue where it's deep; white foam with holes along every
 * shore and round everything standing in it, bands of foam rolling in, rippling light below and twinkling glints.
 *
 * It all comes from how much water there is behind each pixel: the scene is drawn once without water into a depth
 * picture (`WaterDepth`), and the water compares its own depth with what's behind it. The water is lit like any
 * surface, so shadows fall on it.
 */
import { readComponent, type SceneDoc, type WaterData } from '@cocoaworlds/core';
import * as THREE from 'three';

export interface WaterLook {
  shallow: string;
  deep: string;
  /** How deep (u) the water has to be to show its deep colour. */
  depth: number;
  foam: boolean;
}

export const DEFAULT_WATER_LOOK: WaterLook = { shallow: '#7fd8e6', deep: '#1f4fb0', depth: 192, foam: true };

/** Shared by every water material: the depth picture, the camera's range, the screen size and the clock. */
export const WATER_UNIFORMS = {
  tDepth: { value: null as THREE.Texture | null },
  uNear: { value: 1 },
  uFar: { value: 1000 },
  uOrtho: { value: 0 },
  uRes: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uHasDepth: { value: 0 },
};

const NOISE = /* glsl */ `
float cwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 cwHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float cwNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cwHash(i), cwHash(i + vec2(1, 0)), u.x), mix(cwHash(i + vec2(0, 1)), cwHash(i + vec2(1, 1)), u.x), u.y);
}
// Distance to the nearest cell centre (x) and to the cell's edge (y), cells drifting with time.
vec2 cwCells(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = cwHash2(i + g);
    o = 0.5 + 0.4 * sin(t + 6.2831 * o);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return vec2(d1, d2 - d1);
}
`;

/** A water material with this look (one per water body; the shared uniforms keep them in step). */
export function waterMaterial(look: WaterLook = DEFAULT_WATER_LOOK): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.name = 'cw-water';
  const shallow = new THREE.Color(look.shallow).convertSRGBToLinear();
  const deep = new THREE.Color(look.deep).convertSRGBToLinear();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WATER_UNIFORMS, {
      uShallow: { value: shallow },
      uDeep: { value: deep },
      uDepth: { value: Math.max(8, look.depth) },
      uFoamOn: { value: look.foam ? 1 : 0 },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCwWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
#include <packing>
uniform sampler2D tDepth;
uniform float uNear, uFar, uOrtho, uTime, uHasDepth, uDepth, uFoamOn;
uniform vec2 uRes;
uniform vec3 uShallow, uDeep;
varying vec3 vCwWorld;
${NOISE}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// How much water is behind this pixel (u along the view), from the scene drawn without water.
float cwD = 1e4;
if (uHasDepth > 0.5) {
  float z = texture2D(tDepth, gl_FragCoord.xy / uRes).x;
  float sceneZ = uOrtho > 0.5 ? orthographicDepthToViewZ(z, uNear, uFar) : perspectiveDepthToViewZ(z, uNear, uFar);
  cwD = z >= 1.0 ? 1e4 : max(0.0, -vViewPosition.z - sceneZ);
}
vec2 cwP = vCwWorld.xz;
float cwT = smoothstep(0.0, uDepth, cwD);
vec3 cwCol = mix(uShallow, uDeep, pow(cwT, 0.7));
// Rippling light below the surface: soft, warped, and patchy (strong in some places, gone in others), where shallow-ish.
vec2 cwWarp = vec2(cwNoise(cwP / 60.0 + uTime * 0.05), cwNoise(cwP / 60.0 + 17.3 - uTime * 0.04)) - 0.5;
vec2 cwC = cwCells(cwP / 85.0 + cwWarp * 1.4, uTime * 0.45);
float cwPatch = smoothstep(0.35, 0.8, cwNoise(cwP / 160.0 + uTime * 0.02));
cwCol += (1.0 - smoothstep(0.0, 0.22, cwC.y)) * 0.06 * cwPatch * (1.0 - cwT);
// Waves sweeping across the open water: broad soft swells, bent and broken up, a few with white crests.
vec2 cwDir = normalize(vec2(0.8, 0.6));
float cwSw = dot(cwP, cwDir) / 420.0 + (cwNoise(cwP / 260.0) - 0.5) * 1.1 + (cwNoise(cwP / 60.0 + uTime * 0.08) - 0.5) * 0.18;
float cwSwell = 0.5 + 0.5 * sin(6.2831 * (cwSw - uTime * 0.09));
float cwOpen = smoothstep(1.5, 4.0, cwD / 18.0);
cwCol += smoothstep(0.55, 1.0, cwSwell) * 0.045 * cwOpen;
float cwCrest = smoothstep(0.988, 0.998, cwSwell) * step(0.72, cwNoise(cwP / 70.0 + vec2(uTime * 0.05, 0.0))) * cwOpen;
// Foam: a blobby band with holes along every shore and round anything in the water...
float cwEdge = cwD / 18.0;
vec2 cwH = cwCells(cwP / 11.0 + vec2(uTime * 0.05, 0.0), uTime * 0.8);
float cwShore = 1.0 - smoothstep(0.5, 0.58, cwEdge + cwH.x * 0.55);
// ...bands rolling in towards it, wobbling off the straight (big slow bends and small kinks), broken up...
float cwBend = (cwNoise(cwP / 55.0 + uTime * 0.04) - 0.5) * 1.6 + (cwNoise(cwP / 17.0 - uTime * 0.07) - 0.5) * 0.6;
float cwBand = fract((cwEdge + cwBend) * 0.35 - uTime * 0.18);
float cwLine = smoothstep(0.0, 0.05, cwBand) * (1.0 - smoothstep(0.05, 0.13, cwBand));
cwLine *= step(0.45, cwNoise(cwP / 14.0 + uTime * 0.1)) * (1.0 - smoothstep(1.2, 3.2, cwEdge));
// ...and glints twinkling on the open water.
vec2 cwG = floor(cwP / 9.0);
float cwSpark = step(0.985, cwHash(cwG)) * step(length(fract(cwP / 9.0) - 0.5), 0.12) * step(0.55, sin(uTime * 2.5 + cwHash(cwG + 7.0) * 6.2831));
float cwFoam = clamp(cwShore + cwLine * 0.9 + cwSpark + cwCrest * 0.8, 0.0, 1.0) * uFoamOn;
cwCol = mix(cwCol, vec3(1.0), cwFoam);
diffuseColor.rgb = cwCol;
// Clear where shallow (the bottom shows through), solid where deep or foaming.
diffuseColor.a = max(mix(0.45, 0.94, cwT), cwFoam);`,
      )
      // A little of its own light, so the colours stay bright in shade as in a painting.
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.35;');
  };
  m.customProgramCacheKey = () => 'cw-water';
  m.userData.cwWater = true;
  return m;
}

/**
 * The scene's depth without water, drawn each frame before the scene when there's water to show. Objects whose
 * material is water are hidden for it.
 */
export class WaterDepth {
  private target: THREE.WebGLRenderTarget | null = null;
  private plain = new THREE.MeshBasicMaterial({ colorWrite: false });
  private hidden: THREE.Object3D[] = [];

  /** Draw the depth picture (false: no water in view, nothing done). */
  prepare(r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera): boolean {
    WATER_UNIFORMS.uTime.value = performance.now() / 1000;
    const waters: THREE.Object3D[] = [];
    scene.traverseVisible((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (mat && (Array.isArray(mat) ? mat.some((x) => x.userData.cwWater) : mat.userData.cwWater)) waters.push(o);
    });
    WATER_UNIFORMS.uHasDepth.value = 0;
    if (!waters.length) return false;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (!this.target || this.target.width !== size.x || this.target.height !== size.y) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(size.x, size.y, { depthTexture: new THREE.DepthTexture(size.x, size.y), depthBuffer: true });
    }
    // Without the water itself (and without anything see-through, which doesn't hide the bottom).
    scene.traverseVisible((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (mat && !(Array.isArray(mat) ? mat : [mat]).some((x) => !x.transparent || x.depthWrite) && !waters.includes(o)) waters.push(o);
    });
    for (const w of waters) {
      w.visible = false;
      this.hidden.push(w);
    }
    const before = { target: r.getRenderTarget(), override: scene.overrideMaterial, bg: scene.background };
    scene.overrideMaterial = this.plain;
    scene.background = null;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(before.target);
    scene.overrideMaterial = before.override;
    scene.background = before.bg;
    for (const w of this.hidden) w.visible = true;
    this.hidden = [];
    const c = cam as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    WATER_UNIFORMS.tDepth.value = this.target.depthTexture;
    WATER_UNIFORMS.uNear.value = c.near;
    WATER_UNIFORMS.uFar.value = c.far;
    WATER_UNIFORMS.uOrtho.value = (c as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    WATER_UNIFORMS.uRes.value.copy(size);
    WATER_UNIFORMS.uHasDepth.value = 1;
    return true;
  }

  dispose(): void {
    this.target?.dispose();
    this.plain.dispose();
  }
}

/** A water body's look, from its Water component. */
export function waterLookOf(doc: SceneDoc | null, id: string): WaterLook {
  const c = doc?.get(id)?.components.water;
  if (!c) return DEFAULT_WATER_LOOK;
  const w = readComponent<WaterData>('water', c);
  return { shallow: w.shallow ?? DEFAULT_WATER_LOOK.shallow, deep: w.deep ?? DEFAULT_WATER_LOOK.deep, depth: w.depthLook ?? DEFAULT_WATER_LOOK.depth, foam: w.foam ?? true };
}

const shared = new Map<string, THREE.MeshLambertMaterial>();
/** One material per look, shared by every water body that looks the same. */
export function waterMaterialFor(look: WaterLook): THREE.MeshLambertMaterial {
  const key = JSON.stringify(look);
  let m = shared.get(key);
  if (!m) shared.set(key, (m = waterMaterial(look)));
  return m;
}

