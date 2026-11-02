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
      const composer = new EffectComposer(this.r);
      composer.addPass(new RenderPass(scene, cam));
      const pass = new GTAOPass(scene, cam, size.x, size.y);
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
