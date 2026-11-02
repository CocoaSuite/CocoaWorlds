/**
 * Triplanar mapping (CM2): a material's images come from three projections (along X, Y and Z), blended by which
 * way the surface faces, instead of from the faces' or the model's texture coordinates. "World" projects from
 * the world, so neighbouring pieces line up; "object" from the object itself, so the pattern sticks to it when
 * it moves. Every map is projected, normal maps with the right tangents for each projection.
 */
import * as THREE from 'three';

export type Mapping = 'face' | 'world' | 'object';

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

/** Switch a material between face (texture coordinates) and triplanar mapping. `tile`: units per repeat. */
export function setMapping(m: THREE.MeshStandardMaterial, mapping: Mapping, tile: number): void {
  const was = (m.userData.mapping as Mapping | undefined) ?? 'face';
  const scale = (m.userData.triScale ??= { value: 1 / 128 }) as { value: number };
  scale.value = 1 / Math.max(1, tile);
  if (was === mapping) return;
  m.userData.mapping = mapping;
  if (mapping === 'face') {
    m.onBeforeCompile = () => {};
    m.customProgramCacheKey = () => '';
  } else {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.triScale = scale;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
        .replace(
          '#include <project_vertex>',
          mapping === 'world'
            ? 'vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTriNormal = normalize(mat3(modelMatrix) * objectNormal);\n#include <project_vertex>'
            : 'vTriPos = transformed;\nvTriNormal = normalize(objectNormal);\n#include <project_vertex>',
        );
      let f = shader.fragmentShader.replace('#include <common>', `#include <common>\n${mapping === 'world' ? '#define TRI_WORLD' : ''}\n${HELPERS}`);
      for (const c of ['map_fragment', 'roughnessmap_fragment', 'metalnessmap_fragment', 'emissivemap_fragment', 'alphamap_fragment', 'aomap_fragment'])
        f = f.replace(`#include <${c}>`, projected(c));
      shader.fragmentShader = f.replace('#include <normal_fragment_maps>', NORMALS);
    };
    m.customProgramCacheKey = () => `tri-${mapping}`;
  }
  m.needsUpdate = true;
}
