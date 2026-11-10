/**
 * Ambient occlusion (GTAO, screen space): corners, creases and the ground under things darken. Drawn through a
 * composer for one camera at a time; used by the editor (Lighting: Game), Play and exported games alike.
 */
import { aoOf, bloomOf, type AoSettings, type BloomSettings } from '@cocoaworlds/core';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Every pixel finite and in range: NaN and infinity become black, the rest is capped. */
const FINITE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  if (any(isnan(c)) || any(isinf(c))) c = vec4(0., 0., 0., 1.);
  gl_FragColor = vec4(clamp(c.rgb, 0., 1000.), clamp(c.a, 0., 1.));
}`,
};

export class AoRenderer {
  private c: { composer: EffectComposer; pass: GTAOPass; bloom: UnrealBloomPass; scene: THREE.Scene; cam: THREE.Camera; w: number; h: number } | null = null;

  /** Software rendering (no graphics card): occlusion would slow everything down, so it is left out. */
  readonly software: boolean;

  constructor(private r: THREE.WebGLRenderer) {
    const gl = r.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.software = /swiftshader|llvmpipe|software/i.test(name);
  }

  /** Whether `render` draws the scene into a render target (occlusion or bloom on), not straight to the screen. */
  active(settings: { ao?: AoSettings; bloom?: BloomSettings } | undefined): boolean {
    const s = aoOf(settings);
    const b = bloomOf(settings);
    return (s.enabled && s.strength > 0 && !this.software) || (b.enabled && b.strength > 0);
  }

  /** Draw `scene` from `cam` with occlusion and bloom, if either is on. False: nothing drawn (draw it plainly). */
  render(scene: THREE.Scene, cam: THREE.Camera, settings: { ao?: AoSettings; bloom?: BloomSettings } | undefined): boolean {
    const s = aoOf(settings);
    const b = bloomOf(settings);
    const aoOn = s.enabled && s.strength > 0 && !this.software;
    const bloomOn = b.enabled && b.strength > 0;
    if (!aoOn && !bloomOn) return false;
    const size = this.r.getSize(new THREE.Vector2());
    if (!this.c || this.c.cam !== cam || this.c.scene !== scene) {
      this.dispose();
      // (The picture keeps its depth, so occlusion can be left off wherever grass or a plant is in front.)
      const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
      const composer = new EffectComposer(this.r, target);
      composer.addPass(new RenderPass(scene, cam));
      const pass = new GTAOPass(scene, cam, size.x, size.y);
      // Objects marked `noAo` (grass) are left out of what the occlusion is measured from, so they get only the
      // little the ground under them gets: barely any.
      const p = pass as unknown as { _overrideVisibility(): void; _restoreVisibility(): void; _visibilityCache: THREE.Object3D[] };
      const hide = p._overrideVisibility.bind(p);
      const show = p._restoreVisibility.bind(p);
      // (Glass is left out too: it would make this pass draw the scene behind it once more.)
      const glass: THREE.Material[] = [];
      p._overrideVisibility = () => {
        hide();
        scene.traverse((o) => {
          // (Sprites too: drawn with this pass's own material they become flat black squares.)
          if ((o.userData.noAo || (o as THREE.Sprite).isSprite) && o.visible) {
            o.visible = false;
            p._visibilityCache.push(o);
          }
          const m = (o as THREE.Mesh).material;
          if (m) for (const x of Array.isArray(m) ? m : [m]) if ((x as THREE.MeshPhysicalMaterial).transmission > 0 && x.visible) {
            x.visible = false;
            glass.push(x);
          }
        });
      };
      p._restoreVisibility = () => {
        show();
        for (const x of glass) x.visible = true;
        glass.length = 0;
      };
      // Occlusion is measured without them, then multiplied over the finished picture: so where one is in front, the
      // darkening belongs to what's hidden behind it (the crease at a bush's foot, a wall's corner) and painted dark
      // ghosts over grass and bushes. Wherever the picture's depth is nearer than the depth occlusion was measured
      // at, something left out is in front: no occlusion there.
      const blend = pass.blendMaterial;
      Object.assign(blend.uniforms, { tSceneDepth: { value: null }, tAoDepth: { value: null }, cameraNear: { value: 1 }, cameraFar: { value: 1000 }, isOrtho: { value: 0 } });
      blend.fragmentShader = `#include <packing>
uniform float intensity;
uniform sampler2D tDiffuse;
uniform sampler2D tSceneDepth;
uniform sampler2D tAoDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float isOrtho;
varying vec2 vUv;
float viewZ(float d) {
  return isOrtho > 0.5 ? orthographicDepthToViewZ(d, cameraNear, cameraFar) : perspectiveDepthToViewZ(d, cameraNear, cameraFar);
}
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float near = -viewZ(texture2D(tSceneDepth, vUv).x);
  float measured = -viewZ(texture2D(tAoDepth, vUv).x);
  float inFront = smoothstep(0.5, 2.0, measured - near);
  gl_FragColor = vec4(mix(mix(vec3(1.), texel.rgb, intensity), vec3(1.), inFront), texel.a);
}`;
      blend.needsUpdate = true;
      const draw = pass.render.bind(pass);
      pass.render = (r, write, read, dt, mask) => {
        const u = blend.uniforms;
        u.tSceneDepth!.value = read.depthTexture;
        u.tAoDepth!.value = pass.depthTexture;
        const c = cam as THREE.PerspectiveCamera;
        u.cameraNear!.value = c.near;
        u.cameraFar!.value = c.far;
        u.isOrtho!.value = (cam as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
        draw(r, write, read, dt, mask);
      };
      composer.addPass(pass);
      // Clean-up before bloom: a single NaN or overflowed pixel (a broken normal, a light right against a surface going
      // past half-float's range) is blurred by bloom over the whole screen and greys it out for as long as it is in
      // view. Such pixels become black, and anything absurdly bright is capped.
      composer.addPass(new ShaderPass(FINITE));
      // Bloom: bright parts, blurred down a few halvings and added back (cheap: it starts at half size).
      const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), b.strength, b.radius, b.threshold);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.c = { composer, pass, bloom, scene, cam, w: 0, h: 0 };
    }
    const c = this.c;
    if (c.w !== size.x || c.h !== size.y) {
      c.composer.setPixelRatio(this.r.getPixelRatio());
      c.composer.setSize(size.x, size.y);
      c.w = size.x;
      c.h = size.y;
    }
    c.pass.enabled = aoOn;
    c.bloom.enabled = bloomOn;
    c.bloom.strength = Math.min(3, b.strength);
    c.bloom.radius = Math.max(0, Math.min(1, b.radius));
    c.bloom.threshold = Math.max(0, b.threshold);
    c.pass.blendIntensity = Math.min(2, s.strength);
    c.pass.updateGtaoMaterial({ radius: s.radius, thickness: s.radius * 0.5, distanceExponent: 1.5, scale: 1, samples: 16 });
    c.composer.render();
    return true;
  }

  dispose(): void {
    this.c?.composer.dispose();
    this.c?.pass.dispose();
    this.c?.bloom.dispose();
    this.c = null;
  }
}
