/**
 * glTF/GLB models from the project: loaded once per file, then cloned (skinned meshes properly) for each object
 * that shows them, in the editor and in Play.
 */
import type { ModelData } from '@cocoaworlds/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assetUrl } from '../assets';

/** Units per metre (as in the runtime; not imported from it so the editor doesn't load physics up front). */
const UNITS_PER_METRE = 39.37;

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const cache = new Map<string, Promise<LoadedModel>>();
const loader = new GLTFLoader();

/** Load a model file (cached). */
export function loadModel(path: string): Promise<LoadedModel> {
  let p = cache.get(path);
  if (!p) {
    p = (async () => {
      const url = await assetUrl(path);
      const bytes = await (await fetch(url)).arrayBuffer();
      const gltf = await loader.parseAsync(bytes, '');
      return { scene: gltf.scene, animations: gltf.animations };
    })();
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

/** Forget every loaded model (another project was opened). */
export function forgetModels(): void {
  cache.clear();
}

export interface ModelInstance {
  object: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  /** Play an animation by name (looping or once); returns false if the model has none by that name. */
  play(name: string, loop: boolean): boolean;
  /** Its size in world units (after the unit scale), for picking boxes. */
  size: THREE.Vector3;
  center: THREE.Vector3;
}

/** A copy of a model for one object, scaled to game units, with its animation playing if one is set. */
export async function modelInstance(data: ModelData): Promise<ModelInstance> {
  const m = await loadModel(data.model);
  const root = new THREE.Group();
  root.name = 'model';
  const inner = cloneSkinned(m.scene) as THREE.Group;
  const k = data.units === 'units' ? 1 : UNITS_PER_METRE;
  inner.scale.setScalar(k);
  inner.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = data.castShadows;
      o.receiveShadow = true;
    }
  });
  root.add(inner);
  const box = new THREE.Box3().setFromObject(root);
  const mixer = m.animations.length ? new THREE.AnimationMixer(inner) : null;
  const play = (name: string, loop: boolean) => {
    const clip = m.animations.find((a) => a.name === name);
    if (!clip || !mixer) return false;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.reset().play();
    return true;
  };
  if (data.animation) play(data.animation, true);
  return { object: root, mixer, play, size: box.isEmpty() ? new THREE.Vector3(16, 16, 16) : box.getSize(new THREE.Vector3()), center: box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()) };
}
