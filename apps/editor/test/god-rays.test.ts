import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GodRaysPass } from '../src/renderer/viewport/god-rays';

describe('volumetric god rays', () => {
  it('keeps a shadow-casting sun active across camera rotations, even behind the viewer', () => {
    const camera = new THREE.PerspectiveCamera();
    const sun = new THREE.DirectionalLight();
    sun.castShadow = true;
    sun.position.set(0, 0, 10);
    const pass = new GodRaysPass();
    try {
      for (const yaw of [0, Math.PI / 2, Math.PI]) {
        camera.rotation.y = yaw;
        camera.updateMatrixWorld();
        pass.update(camera, sun, true);
        expect(pass.enabled).toBe(true);
      }
      pass.update(camera, sun, false);
      expect(pass.enabled).toBe(false);
      sun.castShadow = false;
      pass.update(camera, sun, true);
      expect(pass.enabled).toBe(false);
    } finally {
      pass.dispose();
    }
  });
});
