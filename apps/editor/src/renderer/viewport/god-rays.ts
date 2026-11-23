/** Volumetric sun shafts use the same directional shadow map as the scene surfaces. */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Integrate illuminated air between the camera and the first opaque surface.
// The directional shadow projection is orthographic, so its coordinates
// interpolate linearly along each world-space step.
const SHAFTS = `
uniform sampler2D tDepth;
uniform highp sampler2DShadow sunDepth;
uniform mat4 inverseProjection;
uniform mat4 viewToShadow;
varying vec2 vUv;
void main() {
  vec4 surface = inverseProjection * vec4(vUv * 2. - 1., texture2D(tDepth, vUv).r * 2. - 1., 1.);
  vec3 end = surface.xyz / surface.w;
  float distanceToEnd = min(length(end), 960.);
  const int steps = 32;
  float stride = distanceToEnd / float(steps);
  vec3 delta = (viewToShadow * vec4(normalize(end) * stride, 0.)).xyz;
  // Fixed per-pixel jitter breaks up marching bands without animated noise.
  float offset = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 p = viewToShadow[3].xyz + delta * offset;
  float lit = 0.;
  for (int i = 0; i < steps; i++) {
    if (all(greaterThanEqual(p, vec3(0.))) && all(lessThanEqual(p, vec3(1.)))) {
      lit += texture(sunDepth, p);
    }
    p += delta;
  }
  gl_FragColor = vec4(1. - exp(-lit * stride / 420.), 0., 0., 1.);
}`;

const COMPOSITE = `
uniform sampler2D tDiffuse;
uniform sampler2D tRays;
uniform vec3 tint;
uniform float strength;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(base.rgb + tint * texture2D(tRays, vUv).r * strength, base.a);
}`;

export class GodRaysPass extends Pass {
  private target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  private shafts = new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: null }, sunDepth: { value: null }, inverseProjection: { value: new THREE.Matrix4() }, viewToShadow: { value: new THREE.Matrix4() } },
    vertexShader: VERTEX, fragmentShader: SHAFTS, depthTest: false, depthWrite: false,
  });
  private composite = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, tRays: { value: this.target.texture }, tint: { value: new THREE.Color() }, strength: { value: 0 } },
    vertexShader: VERTEX, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
  });
  private quad = new FullScreenQuad(this.shafts);
  private camera: THREE.Camera | null = null;
  private sun: THREE.DirectionalLight | null = null;
  depth: THREE.Texture | null = null;

  get hasShadowMap(): boolean {
    return !!this.sun?.shadow.map?.depthTexture;
  }

  override setSize(w: number, h: number): void {
    // Quarter resolution on each axis, capped at 480 pixels on the longer side.
    const scale = Math.min(0.25, 480 / Math.max(1, w, h));
    this.target.setSize(Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale)));
  }

  update(cam: THREE.Camera, sun: THREE.DirectionalLight | null, enabled: boolean): void {
    this.camera = cam;
    this.sun = sun;
    this.enabled = enabled && !!sun?.castShadow && sun.intensity > 0 && !!(cam as THREE.PerspectiveCamera).isPerspectiveCamera;
  }

  override render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const sun = this.sun!;
    const camera = this.camera!;
    // The scene pass creates the shadow map and refreshes both camera matrices.
    this.shafts.uniforms.sunDepth!.value = sun.shadow.map!.depthTexture;
    this.shafts.uniforms.inverseProjection!.value.copy(camera.projectionMatrixInverse);
    this.shafts.uniforms.viewToShadow!.value.multiplyMatrices(sun.shadow.matrix, camera.matrixWorld);
    this.composite.uniforms.tint!.value.copy(sun.color);
    this.composite.uniforms.strength!.value = Math.min(2, sun.intensity) * 0.32;
    this.shafts.uniforms.tDepth!.value = this.depth;
    this.quad.material = this.shafts;
    r.setRenderTarget(this.target);
    this.quad.render(r);
    this.composite.uniforms.tDiffuse!.value = read.texture;
    this.quad.material = this.composite;
    r.setRenderTarget(this.renderToScreen ? null : write);
    this.quad.render(r);
  }

  override dispose(): void {
    this.target.dispose();
    this.shafts.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}
