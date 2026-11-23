import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, IsometricPlayCamera } from '../src/renderer/viewport/camera';
import { inputFromKeys } from '../src/renderer/game/controls';

describe('isometric cameras', () => {
  it('looks down from above, foreshortening all three axes equally', () => {
    const rig = new CameraRig();
    rig.resize(800, 600);
    rig.setView('isometric');
    const direction = rig.camera.getWorldDirection(new THREE.Vector3());
    expect(rig.camera).toBe(rig.ortho);
    expect(rig.camera.position.y).toBeGreaterThan(rig.target.y);
    expect(direction.y).toBeLessThan(0);
    expect(Math.abs(direction.x)).toBeCloseTo(Math.abs(direction.y));
    expect(Math.abs(direction.z)).toBeCloseTo(Math.abs(direction.y));
  });

  it('pans and zooms in the actual view plane', () => {
    const rig = new CameraRig();
    rig.resize(800, 600);
    rig.setView('isometric');
    const p = rig.target;
    rig.pan(0, 50);
    expect(p.project(rig.camera).y).toBeCloseTo(-100 / 600);
    const ndc = new THREE.Vector2(0.3, -0.4);
    const world = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(rig.camera);
    rig.wheel(-150, ndc);
    const point = world.project(rig.camera);
    expect(point.x).toBeCloseTo(ndc.x);
    expect(point.y).toBeCloseTo(ndc.y);
  });

  it('follows the player at a fixed angle and resizes without stretching', () => {
    const cam = new IsometricPlayCamera();
    cam.resize(1200, 600);
    const target = new THREE.Vector3(400, 64, -160);
    cam.follow(target.x, target.y, target.z);
    const offset = cam.position.clone().sub(target);
    expect(offset.y).toBeGreaterThan(0);
    expect(cam.right / cam.top).toBe(2);
    expect(target.clone().project(cam).length()).toBeLessThanOrEqual(1);
    const next = target.clone().add(new THREE.Vector3(100, 50, 200));
    cam.follow(next.x, next.y, next.z);
    expect(cam.position.clone().sub(next).distanceTo(offset)).toBeLessThan(1e-6);
    expect(next.clone().project(cam).x).toBeCloseTo(0);
    expect(next.clone().project(cam).y).toBeCloseTo(0);
  });

  it('maps keys to fixed screen movement, faces the travel direction, and leaves 3D input unchanged', () => {
    const cam = new IsometricPlayCamera();
    cam.follow(0, 0, 0);
    const screen = (key: string) => {
      const input = inputFromKeys(new Set([key]), true);
      const yaw = input.movementYaw!;
      const movement = new THREE.Vector3(-Math.sin(yaw) * input.forward! + Math.cos(yaw) * input.right!, 0, -Math.cos(yaw) * input.forward! - Math.sin(yaw) * input.right!);
      expect(movement.dot(new THREE.Vector3(-Math.sin(input.yaw!), 0, -Math.cos(input.yaw!)))).toBeCloseTo(1);
      return movement.project(cam);
    };
    expect(screen('KeyW').y).toBeGreaterThan(0);
    expect(screen('ArrowRight').x).toBeGreaterThan(0);
    expect(screen('KeyS').y).toBeLessThan(0);
    expect(screen('KeyA').x).toBeLessThan(0);
    expect(inputFromKeys(new Set(), true).yaw).toBeUndefined();
    expect(inputFromKeys(new Set(['KeyW']))).not.toHaveProperty('movementYaw');
    expect(inputFromKeys(new Set(['KeyW']))).not.toHaveProperty('yaw');
  });
});
