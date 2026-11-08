/**
 * How a poster or painting looks (component `poster`): a scroll lying along its width while rolled up, or a flat
 * sheet (picture on +Z, frame colour on the edges and the back). The editor and the game draw it the same way.
 */
import { posterScrollRadius, type PosterData } from '@cocoaworlds/core';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { projectMaterial, releaseMaterial } from './project-materials';
import { modelInstance, type ModelInstance } from './models';

export interface PosterObject {
  object: THREE.Group;
  /** The rolled-up look: a plain cylinder or the scroll model (null for a painting, which never rolls). */
  scroll: THREE.Object3D | null;
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
  // A poster is a sheet (front and back planes against the wall); a painting is a box.
  const geo = data.rolls ? sheet(data.width, data.height, Math.max(0.25, depth / 2)) : new THREE.BoxGeometry(data.width, data.height, depth);
  // (Picture textures aren't flipped on load, so V runs the other way.)
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const flat = new THREE.Mesh(geo, data.rolls ? [picture, back] : [back, back, back, back, picture, back]);
  flat.castShadow = flat.receiveShadow = true;
  object.add(flat);
  let scroll: THREE.Group | null = null;
  let cylinder: THREE.Mesh | null = null;
  let model: ModelInstance | null = null;
  let gone = false;
  if (data.rolls) {
    scroll = new THREE.Group();
    const r = posterScrollRadius(data);
    cylinder = new THREE.Mesh(new THREE.CylinderGeometry(r, r, data.width, 20).rotateZ(Math.PI / 2), back);
    cylinder.castShadow = cylinder.receiveShadow = true;
    scroll.add(cylinder);
    object.add(scroll);
    if (data.scrollModel) {
      // The scroll model in place of the cylinder once it has loaded: centred, at its own scale.
      const holder = scroll;
      void modelInstance({ model: data.scrollModel, units: data.scrollUnits ?? 'metres', animation: '', castShadows: true, collision: 'none' })
        .then((inst) => {
          if (gone) return inst.dispose();
          model = inst;
          const k = data.scrollScale > 0 ? data.scrollScale : 1;
          inst.object.scale.multiplyScalar(k);
          inst.object.position.copy(inst.center).multiplyScalar(-k);
          holder.remove(cylinder!);
          holder.add(inst.object);
          onUpdate();
        })
        .catch(() => {});
    }
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
      gone = true;
      flat.geometry.dispose();
      cylinder?.geometry.dispose();
      model?.dispose();
      back.dispose();
      if (data.picture) releaseMaterial(picture);
      picture.dispose();
    },
  };
}

/** Two planes back to back near the wall side (z = -half): the front (group 0) faces +Z, the back (group 1) faces -Z. */
function sheet(w: number, h: number, half: number): THREE.BufferGeometry {
  const front = new THREE.PlaneGeometry(w, h).translate(0, 0, -half + 0.02);
  const backside = new THREE.PlaneGeometry(w, h).rotateY(Math.PI).translate(0, 0, -half + 0.01);
  const g = mergeGeometries([front, backside], true);
  front.dispose();
  backside.dispose();
  return g;
}
