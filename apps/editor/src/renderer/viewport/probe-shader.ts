/**
 * What shiny materials reflect when scene reflections are on: one atlas of captured probes, each kept as
 * octahedral pictures blurred for six roughnesses. Slot 0 is the capture round the camera (for outdoors);
 * slots 1.. are box probes (rooms). A surface inside (or right by) a probe's box reflects that probe, the
 * reflection direction fitted to the box so walls and floors are reflected where they are; near two boxes, both
 * are blended (doorways), and away from all boxes it reflects slot 0.
 */
import * as THREE from 'three';

export const PROBE_SLOTS = 16;
export const PROBE_LEVELS = 6;
export const PROBE_TILE = 128;
/** Box probes at most (slot 0 is the camera's). */
export const MAX_BOX_PROBES = PROBE_SLOTS - 1;

const v3s = () => Array.from({ length: MAX_BOX_PROBES }, () => new THREE.Vector3());

/** Shared by every patched material: set once, seen by all. */
export const PROBES = {
  cwProbeAtlas: { value: null as THREE.Texture | null },
  cwProbeOn: { value: 0 },
  cwProbeCount: { value: 0 },
  cwProbeMin: { value: v3s() },
  cwProbeMax: { value: v3s() },
  cwProbeAt: { value: v3s() },
};

/** Octahedral layout, Y up: the same in the capture pass and the lookup. */
export const OCT_GLSL = /* glsl */ `
vec2 cwOct(vec3 d) {
  d /= abs(d.x) + abs(d.y) + abs(d.z);
  vec2 p = d.xz;
  if (d.y < 0.0) p = (1.0 - abs(p.yx)) * vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  return p * 0.5 + 0.5;
}
vec3 cwOctDir(vec2 f) {
  f = f * 2.0 - 1.0;
  vec3 n = vec3(f.x, 1.0 - abs(f.x) - abs(f.y), f.y);
  float t = max(-n.y, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.z += n.z >= 0.0 ? -t : t;
  return normalize(n);
}`;

const PARS = /* glsl */ `
#ifdef USE_ENVMAP
uniform sampler2D cwProbeAtlas;
uniform float cwProbeOn;
uniform int cwProbeCount;
uniform vec3 cwProbeMin[${MAX_BOX_PROBES}];
uniform vec3 cwProbeMax[${MAX_BOX_PROBES}];
uniform vec3 cwProbeAt[${MAX_BOX_PROBES}];
varying vec3 cwWorldPos;
${OCT_GLSL}
vec3 cwSlot(float slot, vec3 dir, float rough) {
  vec2 uv = (cwOct(normalize(dir)) * ${(PROBE_TILE - 1).toFixed(1)} + 0.5) / ${PROBE_TILE.toFixed(1)};
  float lv = clamp(rough, 0.0, 1.0) * ${(PROBE_LEVELS - 1).toFixed(1)};
  float l0 = floor(lv);
  float l1 = min(l0 + 1.0, ${(PROBE_LEVELS - 1).toFixed(1)});
  float v = (slot + uv.y) / ${PROBE_SLOTS.toFixed(1)};
  vec3 a = texture2D(cwProbeAtlas, vec2((l0 + uv.x) / ${PROBE_LEVELS.toFixed(1)}, v)).rgb;
  vec3 b = texture2D(cwProbeAtlas, vec2((l1 + uv.x) / ${PROBE_LEVELS.toFixed(1)}, v)).rgb;
  return mix(a, b, lv - l0);
}
// Where the reflection ray leaves the box, as seen from the probe's capture point.
vec3 cwBoxDir(int i, vec3 dir) {
  vec3 mn = cwProbeMin[i];
  vec3 mx = cwProbeMax[i];
  vec3 p = clamp(cwWorldPos, mn, mx);
  vec3 d = vec3(dir.x >= 0.0 ? max(dir.x, 1e-5) : min(dir.x, -1e-5), dir.y >= 0.0 ? max(dir.y, 1e-5) : min(dir.y, -1e-5), dir.z >= 0.0 ? max(dir.z, 1e-5) : min(dir.z, -1e-5));
  vec3 tf = max((mx - p) / d, (mn - p) / d);
  float t = min(min(tf.x, tf.y), tf.z);
  return p + dir * t - cwProbeAt[i];
}
vec4 cwProbeEnv(vec3 dir, float rough) {
  float w1 = 0.0;
  float w2 = 0.0;
  int i1 = -1;
  int i2 = -1;
  for (int i = 0; i < ${MAX_BOX_PROBES}; i++) {
    if (i >= cwProbeCount) break;
    vec3 o = max(max(cwProbeMin[i] - cwWorldPos, cwWorldPos - cwProbeMax[i]), 0.0);
    // (Full strength in the box and a little past it: boxes are found to the nearest cell.)
    float w = 1.0 - clamp((length(o) - 8.0) / 24.0, 0.0, 1.0);
    if (w > w1) { w2 = w1; i2 = i1; w1 = w; i1 = i; }
    else if (w > w2) { w2 = w; i2 = i; }
  }
  vec3 c = vec3(0.0);
  if (w1 < 1.0) c = cwSlot(0.0, dir, rough);
  if (i1 >= 0 && w1 > 0.0) {
    vec3 a = cwSlot(float(i1 + 1), cwBoxDir(i1, dir), rough);
    if (i2 >= 0 && w2 > 0.0) a = (a * w1 + cwSlot(float(i2 + 1), cwBoxDir(i2, dir), rough) * w2) / (w1 + w2);
    c = mix(c, a, w1);
  }
  return vec4(c, 1.0);
}
#endif
`;

const VERT = /* glsl */ `{
  vec4 cwP = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    cwP = batchingMatrix * cwP;
  #endif
  #ifdef USE_INSTANCING
    cwP = instanceMatrix * cwP;
  #endif
  cwWorldPos = (modelMatrix * cwP).xyz;
}
`;

function patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, PROBES);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 cwWorldPos;').replace('#include <project_vertex>', `${VERT}#include <project_vertex>`);
  const env = THREE.ShaderChunk.envmap_physical_pars_fragment
    .replace('textureLod( envMap, envMapRotation * worldNormal, ENVMAP_MAX_LOD )', '( cwProbeOn > 0.5 ? cwProbeEnv( worldNormal, 1.0 ) : textureLod( envMap, envMapRotation * worldNormal, ENVMAP_MAX_LOD ) )')
    .replace('textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) )', '( cwProbeOn > 0.5 ? cwProbeEnv( reflectVec, roughness ) : textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) ) )');
  shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', `${PARS}\n${env}`);
}

type Patched = THREE.Material['onBeforeCompile'] & { cwProbes?: true };

/** Make a lit material reflect the probes (call again after anything replaces its onBeforeCompile). */
export function withProbes(m: THREE.Material): void {
  if ((m.onBeforeCompile as Patched).cwProbes) return;
  const inner = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  const f: Patched = (shader, r) => {
    inner(shader, r);
    patch(shader);
  };
  f.cwProbes = true;
  m.onBeforeCompile = f;
  m.customProgramCacheKey = () => `${key()}|cwprobe`;
  m.needsUpdate = true;
}
