/**
 * How a decal looks (component `decal`): the poster's picture on one plane facing +Z, pulled just in front of the
 * surface behind it. The editor and the game draw it the same way.
 */
import type { DecalData } from '@cocoaworlds/core';
import * as THREE from 'three';
import { projectMaterial, releaseMaterial } from './project-materials';

export interface DecalObject {
  object: THREE.Mesh;
  dispose(): void;
}

/** How far in front of its surface it sits (u); the depth offset does the rest. */
const LIFT = 0.05;

export function buildDecal(data: DecalData, onUpdate: () => void = () => {}): DecalObject {
  const picture = data.picture ? projectMaterial(data.picture, onUpdate, { modelUv: true }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, transparent: true, opacity: 0.5 });
  // (Not touched by the material's restyling, so it holds through edits.)
  picture.polygonOffset = true;
  picture.polygonOffsetFactor = -2;
  picture.polygonOffsetUnits = -4;
  const geo = new THREE.PlaneGeometry(Math.max(1, data.width), Math.max(1, data.height)).translate(0, 0, LIFT);
  // (Picture textures aren't flipped on load, so V runs the other way.)
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const object = new THREE.Mesh(geo, picture);
  object.name = 'decal';
  object.receiveShadow = true;
  object.castShadow = false;
  // (Drawn after the surfaces it lies on, so a see-through one blends over them.)
  object.renderOrder = 1;
  return {
    object,
    dispose: () => {
      geo.dispose();
      if (data.picture) releaseMaterial(picture);
      picture.dispose();
    },
  };
}
