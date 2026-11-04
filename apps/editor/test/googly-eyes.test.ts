import { describe, expect, it } from 'vitest';
import { defaultComponent, type GooglyEyesData } from '@cocoaworlds/core';
import * as THREE from 'three';
import { CHICKEN_EYES, buildGooglyEyes, eyeGeometry, findBone } from '../src/renderer/viewport/googly-eyes';

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

  it('look up or down as set', () => {
    const { eyes } = rig({ count: 'one', tilt: 30 });
    const look = new THREE.Vector3(0, 0, -1).applyEuler(eyes.object.children[0]!.rotation);
    expect(look.y).toBeCloseTo(Math.sin(Math.PI / 6));
  });
});

/** A little rigged model: root › body › neck › head (named like a glTF file's, after loading). */
function model() {
  const root = new THREE.Bone(); root.name = 'root';
  const body = new THREE.Bone(); body.name = 'body'; body.position.y = 30;
  const neck = new THREE.Bone(); neck.name = 'neckBone'; neck.position.set(0, 15, -8);
  const head = new THREE.Bone(); head.name = 'Head'; head.position.set(0, 12, -6);
  root.add(body); body.add(neck); neck.add(head);
  const object = new THREE.Group(); object.name = 'model';
  object.add(root);
  return { object, root, body, neck, head };
}

describe('googly eyes on bones', () => {
  it('finds the head by default, any bone by name (any case, dots and spaces aside), and nothing that isn\'t there', () => {
    const m = model();
    expect(findBone(m.object, '')).toBe(m.head);
    expect(findBone(m.object, 'Neck.Bone')).toBe(m.neck);
    expect(findBone(m.object, 'BODY')).toBe(m.body);
    expect(findBone(m.object, 'tail')).toBeNull();
  });

  it('ride on the head where they were put, and go with it as it turns', () => {
    const m = model();
    const object = new THREE.Group();
    object.add(m.object);
    const eyes = buildGooglyEyes(data({ offset: [0, 57, -16] }));
    object.add(eyes.object);
    object.updateMatrixWorld(true);
    const before = eyes.object.getWorldPosition(new THREE.Vector3());
    expect(eyes.rideModel(m.object)).toBe(m.head);
    expect(eyes.object.parent).toBe(m.head);
    object.updateMatrixWorld(true);
    expect(eyes.object.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-6);
    // The neck bends forward (a peck): the eyes go down and forward with the head.
    m.neck.rotation.x = -1;
    object.updateMatrixWorld(true);
    const after = eyes.object.getWorldPosition(new THREE.Vector3());
    expect(after.y).toBeLessThan(before.y - 3);
    expect(after.z).toBeLessThan(before.z - 3);
  });

  it('a peck throws the pupils about', () => {
    const m = model();
    const object = new THREE.Group();
    object.add(m.object);
    const eyes = buildGooglyEyes(data({ count: 'one', offset: [0, 57, -16] }));
    object.add(eyes.object);
    object.updateMatrixWorld(true);
    eyes.rideModel(m.object);
    eyes.update(1 / 60);
    const rest = eyes.pupils()[0]!;
    let most = 0;
    for (let i = 1; i <= 20; i++) {
      m.neck.rotation.x = -Math.sin((i / 20) * Math.PI) * 1.2;
      object.updateMatrixWorld(true);
      eyes.update(1 / 60);
      const [x, y] = eyes.pupils()[0]!;
      most = Math.max(most, Math.hypot(x - rest[0], y - rest[1]));
    }
    expect(most).toBeGreaterThan(0.1);
  });

  it('stay on the object when told not to ride, or when the model has no such bone', () => {
    for (const over of [{ followBone: false }, { bone: 'tail' }]) {
      const m = model();
      const object = new THREE.Group();
      object.add(m.object);
      const eyes = buildGooglyEyes(data(over));
      object.add(eyes.object);
      expect(eyes.rideModel(m.object)).toBeNull();
      expect(eyes.object.parent).toBe(object);
    }
  });

  it('the chicken\'s ride on its head, looking out to the sides', () => {
    expect(CHICKEN_EYES.followBone).toBe(true);
    expect(CHICKEN_EYES.bone).toBe('');
    expect(CHICKEN_EYES.count).toBe('two');
    expect(CHICKEN_EYES.splay).toBeGreaterThan(60);
  });
});
