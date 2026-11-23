import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GodRaysPass, projectRaySun } from '../src/renderer/viewport/god-rays';

describe('screen-space god rays', () => {
  it('projects a directional sun independently of camera position', () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 1, 10000);
    const uv = new THREE.Vector2();
    expect(projectRaySun(camera, new THREE.Vector3(0, 0, -1), uv)).toBe(1);
    expect(uv.toArray()).toEqual([0.5, 0.5]);
    camera.position.set(100, 200, 300);
    expect(projectRaySun(camera, new THREE.Vector3(0, 0, -1), uv)).toBe(1);
    expect(uv.toArray()).toEqual([0.5, 0.5]);
    expect(projectRaySun(camera, new THREE.Vector3(0, 0, 1), uv)).toBe(0);
    expect(projectRaySun(camera, new THREE.Vector3(1, 0, -0.1), uv)).toBe(0);
    expect(projectRaySun(new THREE.OrthographicCamera(), new THREE.Vector3(0, 0, -1), uv)).toBe(0);
  });
  it('skips the pass when disabled, unlit or offscreen', () => {
    const camera = new THREE.PerspectiveCamera(70, 1, 1, 10000);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(0, 0, -10);
    const pass = new GodRaysPass();
    try {
      pass.update(camera, sun, true);
      expect(pass.enabled).toBe(true);
      pass.update(camera, sun, false);
      expect(pass.enabled).toBe(false);
      pass.update(camera, null, true);
      expect(pass.enabled).toBe(false);
      sun.intensity = 0;
      pass.update(camera, sun, true);
      expect(pass.enabled).toBe(false);
      sun.intensity = 1;
      sun.position.set(0, 0, 10);
      pass.update(camera, sun, true);
      expect(pass.enabled).toBe(false);
    } finally {
      pass.dispose();
    }
  });
});
