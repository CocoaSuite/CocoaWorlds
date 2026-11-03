/**
 * Ambient occlusion (GTAO, screen space): corners, creases and the ground under things darken. Drawn through a
 * composer for one camera at a time; used by the editor (Lighting: Game), Play and exported games alike.
 */
import { aoOf, type AoSettings } from '@cocoaworlds/core';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

export class AoRenderer {
  private c: { composer: EffectComposer; pass: GTAOPass; scene: THREE.Scene; cam: THREE.Camera; w: number; h: number } | null = null;

  /** Software rendering (no graphics card): occlusion would slow everything down, so it is left out. */
  readonly software: boolean;

  constructor(private r: THREE.WebGLRenderer) {
    const gl = r.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.software = /swiftshader|llvmpipe|software/i.test(name);
  }

  /** Draw `scene` from `cam` with occlusion, if it is on. False: nothing drawn (draw it plainly). */
  render(scene: THREE.Scene, cam: THREE.Camera, settings: { ao?: AoSettings } | undefined): boolean {
    const s = aoOf(settings);
    if (!s.enabled || s.strength <= 0 || this.software) return false;
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
          if (o.userData.noAo && o.visible) {
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
      composer.addPass(new OutputPass());
      this.c = { composer, pass, scene, cam, w: 0, h: 0 };
    }
    const c = this.c;
    if (c.w !== size.x || c.h !== size.y) {
      c.composer.setPixelRatio(this.r.getPixelRatio());
      c.composer.setSize(size.x, size.y);
      c.w = size.x;
      c.h = size.y;
    }
    c.pass.blendIntensity = Math.min(2, s.strength);
    c.pass.updateGtaoMaterial({ radius: s.radius, thickness: s.radius * 0.5, distanceExponent: 1.5, scale: 1, samples: 16 });
    c.composer.render();
    return true;
  }

  dispose(): void {
    this.c?.composer.dispose();
    this.c?.pass.dispose();
    this.c = null;
  }
}
