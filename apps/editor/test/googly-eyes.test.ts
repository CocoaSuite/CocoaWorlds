import { describe, expect, it } from 'vitest';
import { defaultComponent, type GooglyEyesData } from '@cocoaworlds/core';
import * as THREE from 'three';
import { buildGooglyEyes, eyeGeometry } from '../src/renderer/viewport/googly-eyes';

const data = (over: Partial<GooglyEyesData> = {}): GooglyEyesData => ({ ...(defaultComponent('googlyEyes') as GooglyEyesData), ...over });

/** Eyes on an object at the origin of a little world; `step` moves the object and runs a frame. */
function rig(over: Partial<GooglyEyesData> = {}) {
  const root = new THREE.Group();
  const eyes = buildGooglyEyes(data(over));
  root.add(eyes.object);
  const frame = (dt = 1 / 60) => {
    root.updateMatrixWorld(true);
    return eyes.update(dt);
  };
  return { root, eyes, frame };
}

const reachOf = (pupil = 0.5) => 0.88 - pupil * 0.88;

describe('googly eyes', () => {
  it('the dome bulges out towards −Z with its front facing that way', () => {
    const g = eyeGeometry();
    expect(g.getAttribute('position').getZ(0)).toBeLessThan(0);
    expect(g.getAttribute('normal').getZ(0)).toBeLessThan(-0.99);
    expect(g.boundingSphere!.radius).toBeLessThanOrEqual(1.05);
  });

  it('two eyes by default, one when asked, apart and turned out as set', () => {
    expect(rig().eyes.object.children).toHaveLength(2);
    expect(rig({ count: 'one' }).eyes.object.children).toHaveLength(1);
    const { eyes } = rig({ spacing: 20, splay: 45, size: 10 });
    const [l, r] = eyes.object.children as THREE.Mesh[];
    expect(l!.position.x).toBeCloseTo(-10);
    expect(r!.position.x).toBeCloseTo(10);
    expect(l!.scale.x).toBeCloseTo(5);
    // The left eye looks out to −X, the right one to +X.
    const look = (m: THREE.Object3D) => new THREE.Vector3(0, 0, -1).applyEuler(m.rotation);
    expect(look(l!).x).toBeLessThan(-0.5);
    expect(look(r!).x).toBeGreaterThan(0.5);
  });

  it('upright, the pupils start fallen to the bottom and lie still', () => {
    const { eyes, frame } = rig();
    frame();
    for (const [x, y] of eyes.pupils()) {
      expect(x).toBeCloseTo(0, 5);
      expect(y).toBeCloseTo(-reachOf(), 5);
    }
    expect(frame()).toBe(false);
  });

  it('facing up there is nothing to pull them: they stay in the middle', () => {
    const { root, eyes, frame } = rig();
    root.rotation.x = -Math.PI / 2;
    frame();
    for (const [x, y] of eyes.pupils()) expect(Math.hypot(x, y)).toBeLessThan(1e-6);
    expect(frame()).toBe(false);
  });

  it('a sudden start throws them back, they never leave the eye, and they settle again', () => {
    const { root, eyes, frame } = rig({ count: 'one' });
    frame();
    // Off along +X fast, then a hard stop.
    let maxX = 0, minX = 0;
    for (let i = 0; i < 20; i++) {
      root.position.x += 10;
      frame();
      const [x, y] = eyes.pupils()[0]!;
      minX = Math.min(minX, x);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(reachOf() + 1e-6);
    }
    for (let i = 0; i < 30; i++) {
      frame();
      maxX = Math.max(maxX, eyes.pupils()[0]![0]);
    }
    // Starting off to +X leaves the pupil behind (towards −X); stopping throws it forwards (+X).
    expect(minX).toBeLessThan(-0.05);
    expect(maxX).toBeGreaterThan(0.05);
    let still = false;
    for (let i = 0; i < 600 && !still; i++) still = !frame();
    expect(still).toBe(true);
    const [x, y] = eyes.pupils()[0]!;
    expect(x).toBeCloseTo(0, 1);
    expect(y).toBeCloseTo(-reachOf(), 2);
  });

  it('stays put in the world while the eye spins round it', () => {
    const { root, eyes, frame } = rig({ count: 'one', loose: 1 });
    frame();
    // A quarter turn about the way it looks, at once: the pupil is still at the bottom in the world, so in
    // the eye's own axes it has moved round to the side.
    root.rotation.z = Math.PI / 2;
    frame(1 / 240);
    const [x] = eyes.pupils()[0]!;
    expect(Math.abs(x)).toBeGreaterThan(reachOf() * 0.8);
  });

  it('a teleport is not a shove', () => {
    const { root, eyes, frame } = rig({ count: 'one' });
    frame();
    root.position.set(5000, 0, 0);
    frame();
    frame();
    const [x, y] = eyes.pupils()[0]!;
    expect(x).toBeCloseTo(0, 3);
    expect(y).toBeCloseTo(-reachOf(), 3);
  });

  it('stiff eyes are thrown about less than loose ones', () => {
    const swing = (loose: number) => {
      const { root, eyes, frame } = rig({ count: 'one', loose });
      frame();
      let most = 0;
      for (let i = 0; i < 60; i++) {
        root.position.x = Math.sin(i * 0.5) * 12;
        frame();
        most = Math.max(most, Math.abs(eyes.pupils()[0]![0]));
      }
      return most;
    };
    expect(swing(0)).toBeLessThan(swing(1));
  });
});
