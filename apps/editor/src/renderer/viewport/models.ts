/**
 * glTF/GLB models from the project: loaded once per file, then cloned (skinned meshes properly) for each object
 * that shows them, in the editor and in Play.
 */
import type { ModelData } from '@cocoaworlds/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { computeMikkTSpaceTangents } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as MikkTSpace from 'three/examples/jsm/libs/mikktspace.module.js';
import { assetUrl } from '../assets';
import { projectMaterial, releaseMaterial } from './project-materials';

/** Units per metre (as in the runtime; not imported from it so the editor doesn't load physics up front). */
export const UNITS_PER_METRE = 39.37;

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  /** Its collision meshes, taken out of the scene (an empty node keeps each one's place). */
  collision: CollisionPart[];
}

/** A collision mesh: model space; `path` finds its node again in a copy of the scene. */
export interface CollisionPart {
  positions: Float32Array;
  indices: Uint32Array;
  exact: boolean;
  moves: boolean;
  rest: THREE.Matrix4;
  path: number[];
}

const COLLISION_NAME = /^(collision|hitbox|col_|ucx_)/i;
const EXACT_NAME = /^(collision|hitbox|col)_?mesh/i;

const chain = (o: THREE.Object3D, root: THREE.Object3D): THREE.Object3D[] => {
  const out: THREE.Object3D[] = [];
  for (let x: THREE.Object3D | null = o; x && x !== root; x = x.parent) out.push(x);
  return out;
};

/** Takes the meshes named collision, hitbox or col_ (or under a node named so) out of a model's scene. */
export function splitCollision(scene: THREE.Object3D, animations: THREE.AnimationClip[]): CollisionPart[] {
  scene.updateMatrixWorld(true);
  const animated = new Set(animations.flatMap((a) => a.tracks.map((t) => THREE.PropertyBinding.parseTrackName(t.name).nodeName)));
  const found: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && chain(o, scene).some((x) => COLLISION_NAME.test(x.name))) found.push(o as THREE.Mesh);
  });
  const parts = found.map((mesh) => {
    const names = chain(mesh, scene);
    const g = mesh.geometry, p = g.attributes.position!;
    const positions = new Float32Array(p.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      positions.set([v.x, v.y, v.z], i * 3);
    }
    const indices = g.index ? Uint32Array.from({ length: g.index.count }, (_, i) => g.index!.getX(i)) : Uint32Array.from({ length: p.count }, (_, i) => i);
    return {
      positions,
      indices,
      exact: names.some((x) => EXACT_NAME.test(x.name)),
      moves: names.some((x) => (x as THREE.Bone).isBone || animated.has(x.name) || animated.has(x.uuid)),
      rest: mesh.matrixWorld.clone(),
      path: [] as number[],
    };
  });
  const stands = found.map((mesh) => {
    const stand = new THREE.Object3D();
    stand.name = mesh.name;
    stand.position.copy(mesh.position);
    stand.quaternion.copy(mesh.quaternion);
    stand.scale.copy(mesh.scale);
    const parent = mesh.parent!;
    parent.children[parent.children.indexOf(mesh)] = stand;
    stand.parent = parent;
    mesh.parent = null;
    while (mesh.children.length) stand.add(mesh.children[0]!);
    return stand;
  });
  stands.forEach((stand, i) => {
    for (let x: THREE.Object3D = stand; x !== scene; x = x.parent!) parts[i]!.path.unshift(x.parent!.children.indexOf(x));
  });
  return parts.filter((p) => p.indices.length >= 3);
}

const follow = (root: THREE.Object3D, path: number[]): THREE.Object3D | null => path.reduce<THREE.Object3D | null>((o, i) => o?.children[i] ?? null, root);

/** Drawn over collision meshes when View › Show collisions is on. */
const wireMaterial = new THREE.LineBasicMaterial({ color: 0x4fd1c5, depthTest: false, transparent: true, opacity: 0.85, visible: false });

/** Show collision meshes as outlines on every model, or not (View menu). */
export function setCollisionsVisible(v: boolean): void {
  wireMaterial.visible = v;
}

const cache = new Map<string, Promise<LoadedModel>>();
const loader = new GLTFLoader();

/**
 * Normal maps are baked against Blender's tangents. A file saved without them gets the same ones here, so baked
 * shading has no seams.
 */
async function addTangents(scene: THREE.Object3D): Promise<void> {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mats = mesh.isMesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    const g = mesh.geometry;
    if (mats.some((m) => (m as THREE.MeshStandardMaterial).normalMap) && g && !g.attributes.tangent && g.attributes.normal && g.attributes.uv) meshes.push(mesh);
  });
  if (!meshes.length) return;
  await MikkTSpace.ready;
  const flipped = new Set<THREE.Material>();
  for (const mesh of meshes) {
    computeMikkTSpaceTangents(mesh.geometry, MikkTSpace);
    // The loader flips the normal map's green for its own guessed tangents; real ones don't want that.
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const s = m as THREE.MeshStandardMaterial;
      if (s.normalMap && !flipped.has(m)) {
        flipped.add(m);
        s.normalScale.y = s.normalScale.x;
        m.needsUpdate = true;
      }
    }
  }
}

/** Load a model file (cached). */
export function loadModel(path: string): Promise<LoadedModel> {
  let p = cache.get(path);
  if (!p) {
    p = (async () => {
      const url = await assetUrl(path);
      const bytes = await (await fetch(url)).arrayBuffer();
      const gltf = await loader.parseAsync(bytes, '');
      await addTangents(gltf.scene);
      // Models step back a hair in depth: where one touches a level face flush (a pillar under a beam), the level
      // face is drawn instead of the two flickering. (Blender exports two-sided, so a cap seen from below fights too.)
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          m.polygonOffset = true;
          m.polygonOffsetFactor = 1;
          m.polygonOffsetUnits = 1;
          // A see-through picture (holes in a pole, leaves): cut out, not blended, so it sorts and shadows right.
          const s = m as THREE.MeshStandardMaterial;
          if (s.map && m.transparent && m.opacity >= 1) {
            m.transparent = false;
            m.depthWrite = true;
            m.alphaTest = 0.5;
            m.alphaToCoverage = true;
            m.needsUpdate = true;
          }
        }
      });
      return { scene: gltf.scene, animations: gltf.animations, collision: splitCollision(gltf.scene, gltf.animations) };
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
export async function modelGeometry(path: string): Promise<ModelGeometry> {
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
  const parts = m.collision.map(({ positions, indices, exact, moves }) => ({ positions, indices, exact, moves }));
  const out = { positions: new Float32Array(pos), indices: new Uint32Array(idx), parts };
  geometryCache.set(m, out);
  return out;
}
type ModelGeometry = { positions: Float32Array; indices: Uint32Array; parts: { positions: Float32Array; indices: Uint32Array; exact: boolean; moves: boolean }[] };
const geometryCache = new WeakMap<LoadedModel, ModelGeometry>();

/**
 * The model's material slots, by name, in the order they come in the file. A material with no name is called
 * “Material 1”, “Material 2” … by its place. Materials are what parts of a model are painted with.
 */
export function slotsOf(m: LoadedModel): Map<THREE.Material, string> {
  let out = slotCache.get(m);
  if (out) return out;
  out = new Map();
  const taken = new Set<string>();
  m.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (out!.has(mat)) continue;
      let name = mat.name.trim() || `Material ${out!.size + 1}`;
      for (let i = 2; taken.has(name); i++) name = `${mat.name.trim() || 'Material'} ${i}`;
      taken.add(name);
      out!.set(mat, name);
    }
  });
  slotCache.set(m, out);
  return out;
}
const slotCache = new WeakMap<LoadedModel, Map<THREE.Material, string>>();

/** A model file's material slots (for the Inspector). */
export async function modelSlots(path: string): Promise<string[]> {
  return [...slotsOf(await loadModel(path)).values()];
}

/** Called when a project material on a model has changed its look (the view needs drawing again). */
let redraw: () => void = () => {};
export function onModelMaterialChange(fn: () => void): void {
  redraw = fn;
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
  /** Let go of the project materials it was given. */
  dispose(): void;
  /** Collision meshes its animation moved since last asked: how far from the file's pose (model space). */
  movedParts(): { part: number; d: number[] }[];
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
  // Project materials in place of the file's own, slot by slot (on the model's own texture coordinates).
  // Every mesh notes its slot names, so the Paint tool knows which slot was clicked.
  const slots = slotsOf(m);
  const given = new Map<string, THREE.Material>();
  const swaps = data.materials ?? {};
  // A tint: the file's own materials are copied for this object, with the tint multiplied into their colour.
  const tint = data.tint && /^#[0-9a-f]{6}$/i.test(data.tint) && data.tint.toLowerCase() !== '#ffffff' ? data.tint : undefined;
  const tinted = new Map<THREE.Material, THREE.Material>();
  const ownTinted = (mat: THREE.Material): THREE.Material => {
    const c = (mat as THREE.MeshStandardMaterial).color;
    if (!tint || !(c instanceof THREE.Color)) return mat;
    let t = tinted.get(mat);
    if (!t) {
      t = mat.clone();
      (t as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(tint));
      tinted.set(mat, t);
    }
    return t;
  };
  const swap = (mat: THREE.Material): THREE.Material => {
    const slot = slots.get(mat);
    const id = slot ? swaps[slot] : undefined;
    if (!slot || !id) return ownTinted(mat);
    let pm = given.get(slot);
    if (!pm) given.set(slot, (pm = projectMaterial(id, () => redraw(), { modelUv: true, tint })));
    return pm;
  };
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.userData.slots = mats.map((x) => slots.get(x) ?? '');
    mesh.material = Array.isArray(mesh.material) ? mats.map(swap) : swap(mesh.material);
  });
  root.add(inner);
  // (Skinned meshes are measured through their bones, so the bones' world matrices must be up to date first.)
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const rel = new THREE.Matrix4();
  const moving = m.collision.flatMap((p, part) => {
    const node = follow(inner, p.path);
    if (node) {
      const local = new THREE.Matrix4().copy(p.rest).invert();
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p.positions.slice(), 3)).setIndex(new THREE.BufferAttribute(p.indices, 1));
      geo.applyMatrix4(local);
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), wireMaterial);
      geo.dispose();
      wire.renderOrder = 999;
      wire.raycast = () => {};
      node.add(wire);
    }
    return p.moves && node ? [{ part, node, restInv: new THREE.Matrix4().copy(p.rest).invert(), last: [] as number[] }] : [];
  });
  const movedParts = () =>
    moving.flatMap((x) => {
      rel.identity();
      for (let o: THREE.Object3D | null = x.node; o && o !== inner; o = o.parent) {
        o.updateMatrix();
        rel.premultiply(o.matrix);
      }
      const d = rel.multiply(x.restInv).toArray();
      if (d.every((v, i) => Math.abs(v - (x.last[i] ?? NaN)) < 1e-6)) return [];
      x.last = d;
      return [{ part: x.part, d }];
    });
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
  const dispose = () => {
    for (const pm of given.values()) {
      releaseMaterial(pm);
      pm.dispose();
    }
    given.clear();
    // (Copies share the file's textures: only the copies themselves go.)
    for (const t of tinted.values()) t.dispose();
    tinted.clear();
  };
  return { object: root, mixer, play, dispose, movedParts, size: box.isEmpty() ? new THREE.Vector3(16, 16, 16) : box.getSize(new THREE.Vector3()), center: box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()) };
}
