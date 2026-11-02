/**
 * Shader additions for project materials:
 *
 * - Triplanar mapping (CM2): images come from three projections (along X, Y and Z), blended by which way the
 *   surface faces, instead of from texture coordinates. "World" projects from the world (neighbouring pieces
 *   line up); "object" from the object (the pattern sticks to it). Normal maps get each projection's tangents.
 * - Wear (CM3): a second look shown on outer edges, in creases and on upward faces, broken up by noise. Brush
 *   faces carry exact distances to their edges and creases (an inset ring, attribute `aWear`); other meshes
 *   (models) use an estimate of how the surface curves. The wear's images are always projected (triplanar).
 */
import type { WearDef } from '@cocoaworlds/core';
import * as THREE from 'three';

export type Mapping = 'face' | 'world' | 'object';
export type WearRole = 'wearColor' | 'wearRoughness' | 'wearMetal' | 'wearNoise';

const HELPERS = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNormal;
uniform float triScale;
vec3 triWeights() { vec3 w = pow(abs(normalize(vTriNormal)), vec3(4.0)); return w / (w.x + w.y + w.z); }
// (Rows go down the image: world up is towards the top of the picture.)
vec2 triX(vec3 p) { return vec2(p.z, -p.y); }
vec2 triY(vec3 p) { return vec2(p.x, p.z); }
vec2 triZ(vec3 p) { return vec2(p.x, -p.y); }
vec4 tri(sampler2D t) {
  vec3 p = vTriPos * triScale; vec3 w = triWeights();
  return texture2D(t, triX(p)) * w.x + texture2D(t, triY(p)) * w.y + texture2D(t, triZ(p)) * w.z;
}
`;

const WEAR = /* glsl */ `
varying vec2 vWear;
varying vec3 vWearPos;
varying vec3 vWearN;
uniform vec3 wearColor;
uniform vec4 wearParams;   // edge, crease, up, width
uniform vec3 wearMat;      // roughness, metalness, noise
uniform vec4 wearHas;      // colour, roughness, metal, noise images
uniform sampler2D wearColorMap;
uniform sampler2D wearRoughnessMap;
uniform sampler2D wearMetalMap;
uniform sampler2D wearNoiseMap;
float wearHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wearValueNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wearHash(i), wearHash(i + vec3(1, 0, 0)), f.x), mix(wearHash(i + vec3(0, 1, 0)), wearHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wearHash(i + vec3(0, 0, 1)), wearHash(i + vec3(1, 0, 1)), f.x), mix(wearHash(i + vec3(0, 1, 1)), wearHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float wearMask() {
  float w = max(wearParams.w, 0.001);
  float raw = 0.0;
  if (vWear.x > 0.5) {
    // Exact distances (stored plus one) to the face's outer edges and its creases.
    raw = max(raw, wearParams.x * (1.0 - smoothstep(0.0, w, vWear.x - 1.0)));
    raw = max(raw, wearParams.y * (1.0 - smoothstep(0.0, w, vWear.y - 1.0)));
  } else {
    // No edge data (models): how fast the surface turns, outwards (edges) or inwards (creases).
    vec3 n = normalize(vWearN); vec3 dx = dFdx(vWearPos), dy = dFdy(vWearPos);
    float k = (dot(dFdx(n), dx) + dot(dFdy(n), dy)) / max(dot(dx, dx) + dot(dy, dy), 1e-6);
    raw = max(raw, wearParams.x * clamp(k * w * 4.0, 0.0, 1.0));
    raw = max(raw, wearParams.y * clamp(-k * w * 4.0, 0.0, 1.0));
  }
  raw = max(raw, wearParams.z * smoothstep(0.55, 0.95, normalize(vWearN).y));
  float nz = wearHas.w > 0.5 ? tri(wearNoiseMap).r : wearValueNoise(vWearPos / max(w * 1.5, 1.0));
  return smoothstep(0.35, 0.65, raw - (nz - 0.5) * wearMat.z * 1.6);
}
`;

const NORMALS = /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
  {
    vec3 p = vTriPos * triScale; vec3 w = triWeights(); vec3 n = normalize(vTriNormal);
    vec3 a = texture2D(normalMap, triX(p)).xyz * 2.0 - 1.0; a.xy *= normalScale;
    vec3 b = texture2D(normalMap, triY(p)).xyz * 2.0 - 1.0; b.xy *= normalScale;
    vec3 c = texture2D(normalMap, triZ(p)).xyz * 2.0 - 1.0; c.xy *= normalScale;
    // Each projection's own frame: along its picture's across and down, and out of the surface.
    vec3 nx = vec3(0.0, 0.0, 1.0) * a.x + vec3(0.0, -1.0, 0.0) * a.y + vec3(sign(n.x), 0.0, 0.0) * a.z;
    vec3 ny = vec3(1.0, 0.0, 0.0) * b.x + vec3(0.0, 0.0, 1.0) * b.y + vec3(0.0, sign(n.y), 0.0) * b.z;
    vec3 nz = vec3(1.0, 0.0, 0.0) * c.x + vec3(0.0, -1.0, 0.0) * c.y + vec3(0.0, 0.0, sign(n.z)) * c.z;
    vec3 tn = normalize(nx * w.x + ny * w.y + nz * w.z);
    #ifdef TRI_WORLD
      normal = normalize((viewMatrix * vec4(tn, 0.0)).xyz);
    #else
      normal = normalize(normalMatrix * tn);
    #endif
  }
#elif defined( USE_BUMPMAP )
  normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif
`;

/** The map chunks, reading through the projections instead of texture coordinates. */
function projected(chunk: string): string {
  return THREE.ShaderChunk[chunk as keyof typeof THREE.ShaderChunk].replace(/texture2D\(\s*(\w+)\s*,\s*v\w+Uv\s*\)/g, 'tri( $1 )');
}

let blank: THREE.Texture | null = null;
const blankTexture = () => (blank ??= Object.assign(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), { needsUpdate: true }));

interface Uniforms {
  triScale: { value: number };
  wearColor: { value: THREE.Color };
  wearParams: { value: THREE.Vector4 };
  wearMat: { value: THREE.Vector3 };
  wearHas: { value: THREE.Vector4 };
  wearColorMap: { value: THREE.Texture };
  wearRoughnessMap: { value: THREE.Texture };
  wearMetalMap: { value: THREE.Texture };
  wearNoiseMap: { value: THREE.Texture };
}

function uniformsOf(m: THREE.Material): Uniforms {
  return (m.userData.shading ??= {
    triScale: { value: 1 / 128 },
    wearColor: { value: new THREE.Color() },
    wearParams: { value: new THREE.Vector4() },
    wearMat: { value: new THREE.Vector3() },
    wearHas: { value: new THREE.Vector4() },
    wearColorMap: { value: blankTexture() },
    wearRoughnessMap: { value: blankTexture() },
    wearMetalMap: { value: blankTexture() },
    wearNoiseMap: { value: blankTexture() },
  }) as Uniforms;
}

const WEAR_SLOT: Record<WearRole, { key: 'wearColorMap' | 'wearRoughnessMap' | 'wearMetalMap' | 'wearNoiseMap'; has: 'x' | 'y' | 'z' | 'w' }> = {
  wearColor: { key: 'wearColorMap', has: 'x' },
  wearRoughness: { key: 'wearRoughnessMap', has: 'y' },
  wearMetal: { key: 'wearMetalMap', has: 'z' },
  wearNoise: { key: 'wearNoiseMap', has: 'w' },
};

/** Give the wear layer one of its images (null: none, the wear settings' value is used). */
export function setWearTexture(m: THREE.Material, role: WearRole, tex: THREE.Texture | null): void {
  const u = uniformsOf(m);
  const s = WEAR_SLOT[role];
  u[s.key].value = tex ?? blankTexture();
  u.wearHas.value[s.has] = tex ? 1 : 0;
}

/** Wear textures in use (to let go of them). */
export function wearTextures(m: THREE.Material): THREE.Texture[] {
  const u = m.userData.shading as Uniforms | undefined;
  return u ? [u.wearColorMap.value, u.wearRoughnessMap.value, u.wearMetalMap.value, u.wearNoiseMap.value].filter((t) => t !== blank) : [];
}

/**
 * Set a material's mapping (face or triplanar), size in the world (`tile`, units per repeat) and wear layer.
 * The shader is rebuilt only when the mapping or whether there is wear changes.
 */
export function setShading(m: THREE.MeshStandardMaterial, mapping: Mapping, tile: number, wear: WearDef | null): void {
  const u = uniformsOf(m);
  u.triScale.value = 1 / Math.max(1, tile);
  if (wear) {
    u.wearColor.value.set(wear.color);
    u.wearParams.value.set(wear.edge, wear.crease, wear.up, Math.min(32, Math.max(0.5, wear.width)));
    u.wearMat.value.set(wear.roughness, wear.metalness, wear.noise);
  }
  const key = `${mapping}|${wear ? 'wear' : ''}`;
  if ((m.userData.shadingKey ?? 'face|') === key) return;
  m.userData.shadingKey = key;
  m.needsUpdate = true;
  if (mapping === 'face' && !wear) {
    m.onBeforeCompile = () => {};
    m.customProgramCacheKey = () => '';
    return;
  }
  // Wear images are always projected: from the world unless the material is mapped from the object.
  const project = mapping === 'face' ? 'world' : mapping;
  m.customProgramCacheKey = () => `shade-${key}`;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;${wear ? '\nattribute vec2 aWear;\nvarying vec2 vWear;\nvarying vec3 vWearPos;\nvarying vec3 vWearN;' : ''}`,
      )
      .replace(
        '#include <project_vertex>',
        (project === 'world'
          ? 'vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTriNormal = normalize(mat3(modelMatrix) * objectNormal);\n'
          : 'vTriPos = transformed;\nvTriNormal = normalize(objectNormal);\n') +
          (wear ? 'vWear = aWear;\nvWearPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWearN = normalize(mat3(modelMatrix) * objectNormal);\n' : '') +
          '#include <project_vertex>',
      );
    let f = shader.fragmentShader.replace('#include <common>', `#include <common>\n${project === 'world' ? '#define TRI_WORLD' : ''}\n${HELPERS}\n${wear ? WEAR : ''}`);
    // Each map chunk: projected when triplanar, as it was otherwise; the wear blends in after colour, roughness
    // and metal are read.
    const chunk = (c: string) => (mapping !== 'face' ? projected(c) : THREE.ShaderChunk[c as keyof typeof THREE.ShaderChunk]);
    const after: Record<string, string> = wear
      ? {
          alphamap_fragment: 'float wearM = wearMask();\ndiffuseColor.rgb = mix(diffuseColor.rgb, wearColor * (wearHas.x > 0.5 ? tri(wearColorMap).rgb : vec3(1.0)), wearM);',
          roughnessmap_fragment: 'roughnessFactor = mix(roughnessFactor, wearHas.y > 0.5 ? tri(wearRoughnessMap).g : wearMat.x, wearM);',
          metalnessmap_fragment: 'metalnessFactor = mix(metalnessFactor, wearHas.z > 0.5 ? tri(wearMetalMap).b : wearMat.y, wearM);',
        }
      : {};
    for (const c of ['map_fragment', 'roughnessmap_fragment', 'metalnessmap_fragment', 'emissivemap_fragment', 'alphamap_fragment', 'aomap_fragment'])
      if (mapping !== 'face' || after[c]) f = f.replace(`#include <${c}>`, `${chunk(c)}\n${after[c] ?? ''}`);
    if (mapping !== 'face') f = f.replace('#include <normal_fragment_maps>', NORMALS);
    shader.fragmentShader = f;
  };
}

/** Face or triplanar mapping only (no wear). */
export function setMapping(m: THREE.MeshStandardMaterial, mapping: Mapping, tile: number): void {
  setShading(m, mapping, tile, null);
}
