import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { splitCollision } from '../src/renderer/viewport/models';

const cube = (name: string, x = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  m.name = name;
  m.position.x = x;
  return m;
};

describe('collision meshes in a model file', () => {
  const build = () => {
    const scene = new THREE.Group();
    const seat = cube('Seat');
    const group = new THREE.Group();
    group.name = 'hitbox';
    group.add(cube('Cube'));
    const bone = new THREE.Bone();
    bone.name = 'Lid';
    bone.add(cube('col_lid'));
    scene.add(seat, cube('collision_seat', 2), group, cube('COL_MESH_floor'), bone);
    const clip = new THREE.AnimationClip('open', 1, [new THREE.VectorKeyframeTrack('collision_seat.position', [0, 1], [2, 0, 0, 2, 1, 0])]);
    return { scene, parts: splitCollision(scene, [clip]) };
  };

  it('takes them out of the drawn model, keeping an empty node in each place', () => {
    const { scene, parts } = build();
    const meshes: string[] = [];
    scene.traverse((o) => void ((o as THREE.Mesh).isMesh && meshes.push(o.name)));
    expect(meshes).toEqual(['Seat']);
    expect(parts).toHaveLength(4);
    expect(scene.getObjectByName('collision_seat')!.position.x).toBe(2);
  });

  it('notes which are exact and which move, in model space', () => {
    const { parts } = build();
    expect(parts.map((p) => p.exact)).toEqual([false, false, true, false]);
    expect(parts.map((p) => p.moves)).toEqual([true, false, false, true]);
    expect(Math.min(...parts[0]!.positions.filter((_, i) => i % 3 === 0))).toBeCloseTo(1.5);
  });

  it('finds each one again in a copy', () => {
    const { scene, parts } = build();
    const copy = scene.clone();
    const node = parts[0]!.path.reduce<THREE.Object3D>((o, i) => o.children[i]!, copy);
    expect(node.name).toBe('collision_seat');
  });
});
