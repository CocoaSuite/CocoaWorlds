/**
 * Camera lens effects and a noise overlay (Scene settings › Camera lens), as passes in the post-processing
 * composer (`ao.ts`): used by the editor (Lighting: Game), Play and exported games alike.
 *
 * - Depth of field (before bloom, in linear light): a 32-tap disc gather sized by each pixel's blur from the depth
 *   the scene was drawn with; auto-focus reads the depth in the middle of the screen.
 * - Lens (after bloom, in linear light): barrel or pincushion distortion, colour fringes towards the edges, vignette.
 * - Noise (after the output pass, in screen colours, so it looks the same whatever the tone mapping): film grain in
 *   cells of a few pixels, more in the dark parts if asked; scanlines; brightness flicker.
 */
import type { LensSettings } from '@cocoaworlds/core';
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Most blur, in pixels (at `blur` 1, before the pixel ratio). */
export const MAX_BLUR_PX = 16;

const DOF = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    cameraNear: { value: 1 },
    cameraFar: { value: 1000 },
    isOrtho: { value: 0 },
    autoFocus: { value: 1 },
    focus: { value: 256 },
    range: { value: 128 },
    maxBlur: { value: 6 },
    texel: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: VERTEX,
  fragmentShader: `#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float isOrtho;
uniform float autoFocus;
uniform float focus;
uniform float range;
uniform float maxBlur;
uniform vec2 texel;
varying vec2 vUv;
float dist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return isOrtho > 0.5 ? -orthographicDepthToViewZ(d, cameraNear, cameraFar) : -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
}
// How blurry (in pixels) something this far away is: sharp within half the range of the focus, then more blur the
// further it is from the focus compared with how far the focus is.
float blurAt(float z, float f) {
  float off = max(0.0, abs(z - f) - range * 0.5);
  return clamp(off / max(f, 16.0) * 2.0, 0.0, 1.0) * maxBlur;
}
void main() {
  // (Auto-focus: the middle of the screen, a few points so a thin pole in the middle doesn't win alone.)
  float f = focus;
  if (autoFocus > 0.5) {
    f = min(min(dist(vec2(0.5)), dist(vec2(0.5, 0.47))), min(dist(vec2(0.5, 0.53)), min(dist(vec2(0.48, 0.5)), dist(vec2(0.52, 0.5)))));
    f = min(f, cameraFar * 0.5);
  }
  vec4 base = texture2D(tDiffuse, vUv);
  float c0 = blurAt(dist(vUv), f);
  if (c0 < 0.5) { gl_FragColor = base; return; }
  vec3 sum = base.rgb;
  float total = 1.0;
  // A golden-angle spiral over the disc of this pixel's blur. A sample counts if its own blur reaches this far, so
  // sharp things don't smear onto what is behind them.
  for (int i = 1; i < 32; i++) {
    float fi = float(i);
    float r = sqrt(fi / 32.0) * c0;
    float a = fi * 2.39996;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * texel;
    float c = blurAt(dist(uv), f);
    float w = smoothstep(r - 1.5, r + 0.5, c);
    sum += texture2D(tDiffuse, uv).rgb * w;
    total += w;
  }
  gl_FragColor = vec4(sum / total, base.a);
}`,
};

const LENS = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    distortion: { value: 0 },
    aberration: { value: 0 },
    vignette: { value: 0 },
    softness: { value: 0.5 },
    aspect: { value: 1 },
  },
  vertexShader: VERTEX,
  fragmentShader: `uniform sampler2D tDiffuse;
uniform float distortion;
uniform float aberration;
uniform float vignette;
uniform float softness;
uniform float aspect;
varying vec2 vUv;
// Where on the drawn picture this screen point looks (distorted around the middle), 0–1.
vec2 warp(vec2 uv, float k) {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float r2 = dot(p, p);
  // Scaled so the edges stay filled: bulging zooms in by what the corners would have moved.
  float corner = 0.25 * (aspect * aspect + 1.0);
  float fit = k > 0.0 ? 1.0 + k * corner : 1.0;
  p = p * (1.0 + k * r2) / fit;
  return p / vec2(aspect, 1.0) + 0.5;
}
vec3 fetch(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(tDiffuse, uv).rgb;
}
void main() {
  float k = distortion * 0.6;
  vec2 uv = warp(vUv, k);
  vec3 c;
  if (aberration > 0.0) {
    // Red and blue land a little apart, more towards the edges (a lens bends colours by different amounts).
    float s = aberration * 0.012;
    c = vec3(fetch(warp(vUv, k + s * 2.0)).r, fetch(uv).g, fetch(warp(vUv, k - s * 2.0)).b);
    vec2 d = (vUv - 0.5);
    c.r = mix(c.r, fetch(uv + d * s).r, 0.5);
    c.b = mix(c.b, fetch(uv - d * s).b, 0.5);
  } else c = fetch(uv);
  if (vignette > 0.0) {
    vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) / (0.5 * sqrt(aspect * aspect + 1.0));
    float d = length(p);
    float inner = mix(0.85, 0.15, softness);
    c *= 1.0 - vignette * smoothstep(inner, 1.1, d);
  }
  gl_FragColor = vec4(c, 1.0);
}`,
};

const NOISE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    grain: { value: 0 },
    cell: { value: 1 },
    seed: { value: 0 },
    colour: { value: 0 },
    shadows: { value: 0.5 },
    scanlines: { value: 0 },
    lineSize: { value: 3 },
    flicker: { value: 0 },
  },
  vertexShader: VERTEX,
  fragmentShader: `uniform sampler2D tDiffuse;
uniform float grain;
uniform float cell;
uniform float seed;
uniform float colour;
uniform float shadows;
uniform float scanlines;
uniform float lineSize;
uniform float flicker;
varying vec2 vUv;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  vec3 c = t.rgb;
  if (grain > 0.0) {
    vec2 at = floor(gl_FragCoord.xy / cell) + vec2(seed * 37.0, seed * 17.0);
    // (Two random numbers make a bell-shaped grain, as film's is, rather than flat static.)
    float g = hash(at) + hash(at + 71.3) - 1.0;
    vec3 n = vec3(g);
    if (colour > 0.5) n = vec3(g, hash(at + 13.1) + hash(at + 5.7) - 1.0, hash(at + 29.9) + hash(at + 41.2) - 1.0);
    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    float w = mix(1.0, 1.6 * (1.0 - clamp(luma, 0.0, 1.0)), shadows);
    c += n * grain * 0.35 * w;
  }
  if (scanlines > 0.0) {
    float l = sin(gl_FragCoord.y * 3.14159265 / lineSize);
    c *= 1.0 - scanlines * 0.6 * (1.0 - l * l);
  }
  if (flicker > 0.0) c *= 1.0 + flicker * 0.18 * (hash(vec2(seed, 3.7)) - 0.5);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), t.a);
}`,
};

const COPY = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: VERTEX,
  fragmentShader: `uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`,
};

/**
 * Depth of field. The composer's two targets take turns, and the one the scene went into (whose depth this reads)
 * can be the one a pass would write to: so it blurs into a target of its own, then copies that back over the
 * picture (reading and writing different targets each time, never the depth it reads).
 */
class DofPass extends Pass {
  readonly material = new THREE.ShaderMaterial({ ...DOF, uniforms: THREE.UniformsUtils.clone(DOF.uniforms), depthTest: false, depthWrite: false });
  readonly uniforms = this.material.uniforms;
  private copy = new THREE.ShaderMaterial({ ...COPY, uniforms: THREE.UniformsUtils.clone(COPY.uniforms), depthTest: false, depthWrite: false });
  private quad = new FullScreenQuad(this.material);
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });

  constructor() {
    super();
    this.needsSwap = false;
  }

  override setSize(w: number, h: number): void {
    this.target.setSize(Math.max(1, w), Math.max(1, h));
  }

  /** The depth the scene was drawn with this frame (known only once the composer has drawn the scene). */
  depth: () => THREE.Texture | null = () => null;

  override render(r: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse!.value = read.texture;
    this.uniforms.tDepth!.value = this.depth();
    this.quad.material = this.material;
    r.setRenderTarget(this.target);
    this.quad.render(r);
    this.copy.uniforms.tDiffuse!.value = this.target.texture;
    this.quad.material = this.copy;
    r.setRenderTarget(this.renderToScreen ? null : read);
    this.quad.render(r);
  }

  override dispose(): void {
    this.material.dispose();
    this.copy.dispose();
    this.quad.dispose();
    this.target.dispose();
  }
}

/** The three passes; `update` sets them from the settings each frame (and switches each one off when unused). */
export class LensPasses {
  readonly dof = new DofPass();
  readonly lens = new ShaderPass(LENS);
  readonly noise = new ShaderPass(NOISE);
  /** The depth the scene was last drawn with (set by the composer's render pass). */
  depth: THREE.Texture | null = null;
  private seedAt = -1;

  constructor() {
    // (They leave depth alone: a full-screen pass writing depth would wipe what depth of field reads.)
    for (const p of [this.lens, this.noise]) p.material.depthTest = p.material.depthWrite = false;
    this.dof.depth = () => this.depth;
  }

  /** Set up for this frame: `w`, `h` in drawing-buffer pixels; `ratio` the pixel ratio; `time` in seconds. */
  update(l: LensSettings, cam: THREE.Camera, w: number, h: number, ratio: number, time: number): void {
    const on = l.enabled;
    const dof = on && l.dof && l.blur > 0;
    this.dof.enabled = dof;
    if (dof) {
      const u = this.dof.uniforms;
      const c = cam as THREE.PerspectiveCamera;
      u.cameraNear!.value = c.near;
      u.cameraFar!.value = c.far;
      u.isOrtho!.value = (cam as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
      u.autoFocus!.value = l.autoFocus ? 1 : 0;
      u.focus!.value = Math.max(1, l.focus);
      u.range!.value = Math.max(0, l.focusRange);
      u.maxBlur!.value = Math.min(1, Math.max(0, l.blur)) * MAX_BLUR_PX * ratio;
      (u.texel!.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
    }
    const lens = on && (l.distortion !== 0 || l.aberration > 0 || l.vignette > 0);
    this.lens.enabled = lens;
    if (lens) {
      const u = this.lens.uniforms;
      u.distortion!.value = Math.max(-1, Math.min(1, l.distortion));
      u.aberration!.value = Math.max(0, Math.min(1, l.aberration));
      u.vignette!.value = Math.max(0, Math.min(1, l.vignette));
      u.softness!.value = Math.max(0, Math.min(1, l.vignetteSoftness));
      u.aspect!.value = w / Math.max(1, h);
    }
    const noise = on && (l.grain > 0 || l.scanlines > 0 || l.flicker > 0);
    this.noise.enabled = noise;
    if (noise) {
      const u = this.noise.uniforms;
      // (A new pattern `grainSpeed` times a second; 0 keeps one still pattern.)
      const step = l.grainSpeed > 0 ? Math.floor(time * Math.min(60, l.grainSpeed)) : 0;
      if (step !== this.seedAt) {
        this.seedAt = step;
        u.seed!.value = (step % 997) + 1;
      }
      u.grain!.value = Math.max(0, Math.min(1, l.grain));
      u.cell!.value = Math.max(1, Math.min(8, l.grainSize)) * ratio;
      u.colour!.value = l.grainColor ? 1 : 0;
      u.shadows!.value = Math.max(0, Math.min(1, l.grainShadows));
      u.scanlines!.value = Math.max(0, Math.min(1, l.scanlines));
      u.lineSize!.value = Math.max(2, Math.min(16, l.scanlineSize)) * ratio;
      u.flicker!.value = Math.max(0, Math.min(1, l.flicker));
    }
  }

  dispose(): void {
    for (const p of [this.dof, this.lens, this.noise]) p.dispose();
  }
}
