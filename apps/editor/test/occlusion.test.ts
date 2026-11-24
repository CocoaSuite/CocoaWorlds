import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { box, buildMesh } from '@cocoaworlds/geometry';
import { CameraOcclusion, blockingFaces } from '../src/renderer/viewport/occlusion';

describe('camera occlusion overlay', () => {
  it('outlines only hidden draws, keeps shadows, and clears immediately on movement or toggle', () => {
    const c = new CameraOcclusion();
    const wall = box([-40,-40,-52], [40,40,-50]);
    const material = new THREE.MeshStandardMaterial();
    c.faces = blockingFaces([wall], buildMesh([wall]), [material]);
    const camera = new THREE.PerspectiveCamera(90, 1, 1, 1000);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(4,4,4), material);
    prop.position.z = -100;
    let overlays = 0;
    const renderer = {
      autoClear: true,
      render(scene: THREE.Scene) { overlays += scene.children.filter(o => o.visible).length; },
      shadowMap: { render() { expect(prop.layers.mask).toBe(1); } },
    };
    function frame(debug: boolean, hidden: boolean) {
      c.begin(camera);
      if (c.ready) c.consider(prop, camera, debug);
      c.draw(renderer as unknown as THREE.WebGLRenderer, camera, debug, () => {
        expect(prop.layers.mask).toBe(hidden ? 0 : 1);
        renderer.shadowMap.render();
      });
      expect(prop.layers.mask).toBe(1);
    }
    frame(true, true);
    frame(false, true);
    prop.position.x = 80; // One edge peeks out.
    frame(true, false);
    prop.position.x = 0;
    material.transparent = true;
    frame(true, false);
    expect(overlays).toBe(1);
    c.dispose();
  });
});
