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

/**
 * `prepare` gets the scroll model ready to draw before it replaces the cylinder (in the game: its shaders compiled
 * in the background), so it doesn't hold a frame up when it appears.
 */
export function buildPoster(data: PosterData, onUpdate: () => void = () => {}, prepare: (o: THREE.Object3D) => Promise<unknown> = () => Promise.resolve()): PosterObject {
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
        .then(async (inst) => {
          if (gone) return inst.dispose();
          await prepare(inst.object).catch(() => {});
          if (gone) return inst.dispose();
          model = inst;
          const k = data.scrollScale > 0 ? data.scrollScale : 1;
          inst.object.scale.multiplyScalar(k);
          inst.object.position.copy(inst.center).multiplyScalar(-k);
          holder.remove(cylinder!);
          holder.add(inst.object);
          setHung(hungNow);
          onUpdate();
        })
        .catch(() => {});
    }
  }
  // The unused look is moved to a layer no camera draws instead of being hidden: hidden things aren't prepared
  // ahead, so hanging a poster stalled the game while its picture's shader was built.
  let hungNow = data.hungAtStart;
  const setHung = (hung: boolean) => {
    hungNow = hung;
    flat.traverse((o) => o.layers.set(hung || !scroll ? 0 : UNSEEN));
    scroll?.traverse((o) => o.layers.set(hung ? UNSEEN : 0));
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

const UNSEEN = 31;

/**
 * Gets `obj` fully ready to draw before it shows, drawn yet or not (on a hidden layer too): its shaders, the
 * shadow shaders of its cut-out materials, and its textures on the GPU. Without this, the first frame a poster
 * hung (its picture's shader, the picture's own shadow shader, the picture uploaded) stalled the game.
 */
export function prepareToDraw(r: THREE.WebGLRenderer, obj: THREE.Object3D, cam: THREE.Camera, scene: THREE.Scene, viaTarget: boolean): Promise<unknown> {
  const done = asDrawn(r, viaTarget, () => r.compileAsync(obj, cam, scene));
  compileShadows(r, obj, cam, scene);
  return done.then(() => uploadTextures(r, obj));
}

/** The same, at once (before the game's first frame). */
export function prepareToDrawNow(r: THREE.WebGLRenderer, obj: THREE.Object3D, cam: THREE.Camera, scene: THREE.Scene, viaTarget: boolean): void {
  asDrawn(r, viaTarget, () => r.compile(obj, cam, scene));
  compileShadows(r, obj, cam, scene);
  uploadTextures(r, obj);
}

/**
 * Compiles as the game draws: a shader's settings include where it draws to (the screen, or occlusion and bloom's
 * render target: no tone mapping, linear colour), so one compiled for the other is never used.
 */
function asDrawn<T>(r: THREE.WebGLRenderer, viaTarget: boolean, compile: () => T): T {
  if (!viaTarget) return compile();
  const prev = r.getRenderTarget();
  r.setRenderTarget((compileTarget ??= new THREE.WebGLRenderTarget(1, 1)));
  try {
    return compile();
  } finally {
    r.setRenderTarget(prev);
  }
}

let compileTarget: THREE.WebGLRenderTarget | null = null;

// Three.js draws a cut-out material's shadow (a map or an opacity map, with alpha test) with a depth material of
// its own, made and compiled at its first shadow; `compile` doesn't do it. Shadow shaders with the same settings
// are shared, so compiling one stand-in for each kind (kept, so the shared shader stays) readies them all.
const SHADOW_SIDE: Record<number, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const shadowStandIns = new Map<string, THREE.Mesh>();

function compileShadows(r: THREE.WebGLRenderer, obj: THREE.Object3D, cam: THREE.Camera, scene: THREE.Scene): void {
  if (!r.shadowMap.enabled) return;
  const group = new THREE.Group();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow || (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const cut = m as THREE.MeshStandardMaterial;
      if (!(cut.alphaTest > 0) || !(cut.map || cut.alphaMap)) continue;
      const side = cut.shadowSide ?? SHADOW_SIDE[cut.side] ?? THREE.BackSide;
      for (const kind of ['depth', 'distance'] as const) {
        const key = [kind, side, cut.map?.channel ?? '-', cut.alphaMap?.channel ?? '-', m.vertexColors].join('|');
        if (shadowStandIns.has(key)) continue;
        const sm = kind === 'depth' ? new THREE.MeshDepthMaterial() : new THREE.MeshDistanceMaterial();
        sm.side = side;
        sm.map = cut.map;
        sm.alphaMap = cut.alphaMap;
        sm.alphaTest = cut.alphaTest;
        const standIn = new THREE.Mesh(mesh.geometry, sm);
        shadowStandIns.set(key, standIn);
        group.add(standIn);
      }
    }
  });
  if (!group.children.length) return;
  // (Compiled as shadows are drawn: into a render target, so not tone-mapped.)
  asDrawn(r, true, () => r.compile(group, cam, scene));
  // (Kept for their shaders only: nothing of the real objects held.)
  for (const c of group.children) {
    const sm = (c as THREE.Mesh).material as THREE.MeshDepthMaterial;
    sm.map = sm.alphaMap = null;
    (c as THREE.Mesh).geometry = PLACEHOLDER;
  }
}

const PLACEHOLDER = new THREE.BufferGeometry();

/** Sends the textures of everything in `obj`, drawn yet or not, to the GPU now (not at its first frame). */
export function uploadTextures(r: THREE.WebGLRenderer, obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) for (const v of Object.values(x)) if ((v as THREE.Texture)?.isTexture && (v as THREE.Texture).image) r.initTexture(v as THREE.Texture);
  });
}
