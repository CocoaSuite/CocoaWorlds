/**
 * Glass casts no shadow: light goes through it. Glass is a physical material with transmission, and a material
 * can turn into glass (or stop being glass) at any time when its refraction is edited, and the level's glass faces
 * are only one material group of the level mesh. So instead of turning off `castShadow` per mesh, glass materials
 * are hidden for the shadow pass alone: Three.js skips a hidden material (or material group) when it draws the
 * shadow map, and everything else about the mesh still casts.
 */
import * as THREE from 'three';

/** Whether this material is glass (what's behind it shows through). */
export const isGlass = (m: THREE.Material): boolean => (m as THREE.MeshPhysicalMaterial).transmission > 0;

/** The visible glass materials in `scene`. */
export function glassIn(scene: THREE.Object3D): THREE.Material[] {
  const glass = new Set<THREE.Material>();
  scene.traverseVisible((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) for (const x of Array.isArray(m) ? m : [m]) if (x.visible && isGlass(x)) glass.add(x);
  });
  return [...glass];
}

const hooked = new WeakSet<THREE.WebGLShadowMap>();

/** Make glass cast no shadow in everything this renderer draws. */
export function glassCastsNoShadow(r: THREE.WebGLRenderer): void {
  const sm = r.shadowMap;
  if (hooked.has(sm)) return;
  hooked.add(sm);
  const render = sm.render.bind(sm);
  sm.render = (lights, scene, camera) => {
    // (Only when the shadow map will actually be drawn, so frames that keep it cost nothing extra.)
    if (!sm.enabled || (!sm.autoUpdate && !sm.needsUpdate) || lights.length === 0) return render(lights, scene, camera);
    const glass = glassIn(scene);
    for (const m of glass) m.visible = false;
    try {
      render(lights, scene, camera);
    } finally {
      for (const m of glass) m.visible = true;
    }
  };
}
