/** Screen-space sun shafts from the scene's existing depth buffer. No extra geometry or shadow passes. */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Perspective projection of the direction toward a sun, independent of camera translation.
 * Returns zero behind the camera or well outside the view; fades smoothly at the edges. */
export function projectRaySun(cam: THREE.Camera, direction: THREE.Vector3, uv: THREE.Vector2, view = new THREE.Vector3()): number {
  if (!(cam as THREE.PerspectiveCamera).isPerspectiveCamera) return 0;
  cam.updateWorldMatrix(true, false);
  view.copy(direction).transformDirection(cam.matrixWorldInverse);
  if (view.z >= -0.05) return 0;
  const m = cam.projectionMatrix.elements;
  uv.set((m[0]! * view.x / -view.z - m[8]!) * 0.5 + 0.5,
    (m[5]! * view.y / -view.z - m[9]!) * 0.5 + 0.5);
  const edge = Math.max(Math.abs(uv.x - 0.5), Math.abs(uv.y - 0.5));
  return 1 - THREE.MathUtils.smoothstep(edge, 0.45, 0.83);
}

const SHAFTS = `
uniform sampler2D tDepth;
uniform vec2 sun;
uniform float aspect;
varying vec2 vUv;
float visibleSky(vec2 uv) {
  if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return 0.;
  // The sky draws at the far plane without writing depth. Geometry masks the sun.
  return step(1., texture2D(tDepth, uv).r);
}
void main() {
  vec2 delta = (sun - vUv) * 0.85;
  float sum = 0.;
  float weight = 0.;
  for (int i = 0; i < 20; i++) {
    float t = (float(i) + 0.5) / 20.;
    vec2 p = vUv + delta * t;
    vec2 q = (p - sun) * vec2(aspect, 1.);
    float w = (1. - t * 0.35) * exp(-dot(q, q) * 9.);
    sum += visibleSky(p) * w;
    weight += w;
  }
  vec2 q = (vUv - sun) * vec2(aspect, 1.);
  float falloff = exp(-dot(q, q) * 2.5);
  float shafts = sum / max(weight, 0.001) * falloff;
  // Prefer the shafts across silhouettes rather than washing the entire clear sky.
  shafts *= mix(1., 0.32, visibleSky(vUv));
  gl_FragColor = vec4(clamp(shafts, 0., 1.), 0., 0., 1.);
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
    uniforms: { tDepth: { value: null }, sun: { value: new THREE.Vector2() }, aspect: { value: 1 } },
    vertexShader: VERTEX, fragmentShader: SHAFTS, depthTest: false, depthWrite: false,
  });
  private composite = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, tRays: { value: this.target.texture }, tint: { value: new THREE.Color() }, strength: { value: 0 } },
    vertexShader: VERTEX, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
  });
  private quad = new FullScreenQuad(this.shafts);
  private direction = new THREE.Vector3();
  private targetPosition = new THREE.Vector3();
  private view = new THREE.Vector3();
  depth: THREE.Texture | null = null;

  override setSize(w: number, h: number): void {
    // Quarter resolution on each axis, capped at 480 pixels on the longer side.
    const scale = Math.min(0.25, 480 / Math.max(1, w, h));
    this.target.setSize(Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale)));
    this.shafts.uniforms.aspect!.value = w / Math.max(1, h);
  }

  update(cam: THREE.Camera, sun: THREE.DirectionalLight | null, enabled: boolean): void {
    this.enabled = false;
    if (!enabled || !sun || sun.intensity <= 0) return;
    sun.getWorldPosition(this.direction).sub(sun.target.getWorldPosition(this.targetPosition)).normalize();
    const fade = projectRaySun(cam, this.direction, this.shafts.uniforms.sun!.value, this.view);
    if (fade <= 0) return;
    this.composite.uniforms.tint!.value.copy(sun.color);
    this.composite.uniforms.strength!.value = fade * Math.min(2, sun.intensity) * 0.22;
    this.enabled = true;
  }

  override render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
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
