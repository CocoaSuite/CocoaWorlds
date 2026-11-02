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

/**
 * A model's triangles in the file's own units (every mesh, placed as the file places it), for collisions.
 * Cached with the model.
 */
export async function modelGeometry(path: string): Promise<{ positions: Float32Array; indices: Uint32Array }> {
  const m = await loadModel(path);
  const hit = geometryCache.get(m);
  if (hit) return hit;
  const pos: number[] = [], idx: number[] = [];
  m.scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  m.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
    const g = mesh.geometry;
    const p = g.attributes.position!;
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      pos.push(v.x, v.y, v.z);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  });
  const out = { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  geometryCache.set(m, out);
  return out;
}
const geometryCache = new WeakMap<LoadedModel, { positions: Float32Array; indices: Uint32Array }>();

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
  // One animation at a time, blending from the last over a moment (a walk eases into a peck).
  let current: THREE.AnimationAction | null = null;
  const played = new Set<THREE.AnimationAction>();
  const play = (name: string, loop: boolean) => {
    const clip = m.animations.find((a) => a.name === name);
    if (!clip || !mixer) return false;
    const action = mixer.clipAction(clip);
    const from = current;
    // (Everything older than the one fading out stops now.)
    for (const a of played) if (a !== from && a !== action) a.stop();
    played.add(action);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.reset();
    action.setEffectiveWeight(1);
    action.play();
    if (from && from !== action) action.crossFadeFrom(from, 0.15, false);
    current = action;
    return true;
  };
  if (data.animation) play(data.animation, true);
  return { object: root, mixer, play, size: box.isEmpty() ? new THREE.Vector3(16, 16, 16) : box.getSize(new THREE.Vector3()), center: box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()) };
}
