/**
 * Ground blending: surfaces whose material has "Blend into ground" fade into whatever they stand in (a terrain,
 * a floor, another mesh) where they meet it, as if buried in it, with a noisy edge. Each frame (only when such a
 * material is on screen) the scene is drawn once more at half size without them, keeping its colour and depth;
 * their shader then takes that colour wherever what's behind them is within the blend distance.
 */
import * as THREE from 'three';

/** Shared by every blending material. */
export const GROUND_BLEND = {
  gbColour: { value: null as THREE.Texture | null },
  gbDepth: { value: null as THREE.Texture | null },
  gbRes: { value: new THREE.Vector2(1, 1) },
  /** near, far, orthographic (1), on (1). */
  gbCam: { value: new THREE.Vector4(1, 1000, 0, 0) },
};

/** The shader's part (fragment): declarations, and what goes after the final colour is worked out. */
export const GROUND_BLEND_DECL = `
uniform sampler2D gbColour;
uniform sampler2D gbDepth;
uniform vec2 gbRes;
uniform vec4 gbCam;
uniform vec3 blendParams;
varying vec3 vBlendPos;
// (Depth to distance from the camera, for a perspective or orthographic view.)
float gbDist(float d) {
  return gbCam.z > 0.5 ? gbCam.x + d * (gbCam.y - gbCam.x) : (gbCam.x * gbCam.y) / (gbCam.y - d * (gbCam.y - gbCam.x));
}
float gbNoise(vec3 p) {
  float a = sin(p.x * 1.7 + sin(p.z * 1.3) * 1.5) * sin(p.z * 1.9 + sin(p.y * 1.1) * 1.5);
  float b = sin(p.y * 3.3 + p.x * 2.1) * sin(p.z * 2.7 - p.y * 1.6);
  return (a + 0.5 * b) / 1.5;
}`;

export const GROUND_BLEND_APPLY = `
if (gbCam.w > 0.5 && blendParams.x > 0.0) {
  vec2 gbUv = gl_FragCoord.xy / gbRes;
  float gbBg = texture2D(gbDepth, gbUv).x;
  if (gbBg < 0.99999) {
    float gbZ = gbDist(gbBg);
    // How far behind this point the surface it stands in is (along the view).
    float gap = gbZ - vViewPosition.z;
    float n = gbNoise(vBlendPos / max(1.0, blendParams.z));
    float t = gap / blendParams.x + n * blendParams.y * 0.7;
    float b = (1.0 - smoothstep(0.0, 1.0, t)) * step(-2.0, gap);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(gbColour, gbUv).rgb, b);
  }
}`;

export class GroundBlend {
  private target: THREE.WebGLRenderTarget | null = null;
  private hidden: THREE.Material[] = [];

  /** Draw the scene without blending surfaces (if any are shown), for their shader to blend into. */
  prepare(r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, helpers: THREE.Object3D[] = []): void {
    const mats = new Set<THREE.Material>();
    const glass = new Set<THREE.Material>();
    // (Editor aids, lines and points aren't ground: left out of what's blended into.)
    const aids: THREE.Object3D[] = [];
    scene.traverseVisible((o) => {
      if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) aids.push(o);
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) {
        if (x.userData.groundBlend && x.visible) mats.add(x);
        // (Glass would make this pass draw the scene behind it again: left out, it isn't ground.)
        if ((x as THREE.MeshPhysicalMaterial).transmission > 0 && x.visible) glass.add(x);
      }
    });
    GROUND_BLEND.gbCam.value.w = mats.size ? 1 : 0;
    if (!mats.size) return;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x / 2)), h = Math.max(1, Math.floor(size.y / 2));
    if (!this.target) this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h) });
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    this.hidden = [...mats, ...glass];
    for (const m of this.hidden) m.visible = false;
    const off = [...aids, ...helpers.filter((h) => h.visible)];
    for (const o of off) o.visible = false;
    // (Last frame's shadows, which they're still in: no second shadow pass. No fog: the real frame adds it.)
    const auto = r.shadowMap.autoUpdate, fog = scene.fog, was = r.getRenderTarget();
    r.shadowMap.autoUpdate = false;
    scene.fog = null;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(was);
    scene.fog = fog;
    r.shadowMap.autoUpdate = auto;
    for (const m of this.hidden) m.visible = true;
    for (const o of off) o.visible = true;
    this.hidden = [];
    GROUND_BLEND.gbColour.value = this.target.texture;
    GROUND_BLEND.gbDepth.value = this.target.depthTexture;
    GROUND_BLEND.gbRes.value.copy(size);
    const c = cam as THREE.PerspectiveCamera;
    GROUND_BLEND.gbCam.value.set(c.near, c.far, (cam as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0, 1);
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
  }
}
