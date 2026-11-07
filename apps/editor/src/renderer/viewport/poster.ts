/**
 * How a poster or painting looks (component `poster`): a scroll lying along its width while rolled up, or a flat
 * sheet (picture on +Z, frame colour on the edges and the back). The editor and the game draw it the same way.
 */
import { posterScrollRadius, type PosterData } from '@cocoaworlds/core';
import * as THREE from 'three';
import { projectMaterial, releaseMaterial } from './project-materials';

export interface PosterObject {
  object: THREE.Group;
  /** The rolled-up look (null for a painting, which never rolls). */
  scroll: THREE.Mesh | null;
  flat: THREE.Mesh;
  /** Show it hung (flat) or loose (rolled, if it rolls). */
  setHung(hung: boolean): void;
  dispose(): void;
}

export function buildPoster(data: PosterData, onUpdate: () => void = () => {}): PosterObject {
  const object = new THREE.Group();
  object.name = 'poster';
  const back = new THREE.MeshStandardMaterial({ color: data.frame, roughness: 0.85 });
  const picture = data.picture ? projectMaterial(data.picture, onUpdate, { modelUv: true }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const depth = Math.max(0.5, data.thickness);
  // (Box faces: +X, −X, +Y, −Y, +Z, −Z; the picture is on +Z.)
  const flat = new THREE.Mesh(new THREE.BoxGeometry(data.width, data.height, depth), [back, back, back, back, picture, back]);
  flat.castShadow = flat.receiveShadow = true;
  object.add(flat);
  let scroll: THREE.Mesh | null = null;
  if (data.rolls) {
    const r = posterScrollRadius(data);
    scroll = new THREE.Mesh(new THREE.CylinderGeometry(r, r, data.width, 20).rotateZ(Math.PI / 2), back);
    scroll.castShadow = scroll.receiveShadow = true;
    object.add(scroll);
  }
  const setHung = (hung: boolean) => {
    flat.visible = hung || !scroll;
    if (scroll) scroll.visible = !hung;
  };
  setHung(data.hungAtStart);
  return {
    object,
    scroll,
    flat,
    setHung,
    dispose: () => {
      flat.geometry.dispose();
      scroll?.geometry.dispose();
      back.dispose();
      if (data.picture) releaseMaterial(picture);
      picture.dispose();
    },
  };
}
