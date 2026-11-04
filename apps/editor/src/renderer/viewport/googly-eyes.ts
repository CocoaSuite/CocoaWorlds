/**
 * Googly eyes (component `googlyEyes`): stick-on cartoon eyes with loose pupils.
 *
 * Each eye is a shallow plastic dome. Its look is all in the fragment shader of a lit physical material (so it
 * takes the scene's lights, shadows, fog and reflections like anything else): the white, the cup's shading
 * towards the rim, the dark pupil with its soft contact shadow, and the clear rim; the clear coat is the
 * plastic cover. The pupil's place is one uniform per eye, moved each frame by a small simulation in the eye's
 * plane: gravity pulls it down, the eye's own acceleration throws it about (start, stop, turn, bounce), it
 * bounces off the rim and slides round it, and it stays put in the world while the eye spins round it.
 *
 * On a model with bones they can ride on one (the head, by default): placed in the object's space as the model
 * stands still, then moved onto the bone keeping that place, so its animations carry them (`rideModel`).
 *
 * Used by the editor's markers (dragging an object rattles them) and by Play, so both behave the same.
 */
import type { GooglyEyesData } from '@cocoaworlds/core';
import * as THREE from 'three';

/** How far the dome stands out, as a part of the eye's radius. */
const DOME = 0.32;
/** Where the clear rim begins (the pupil stays inside it), as a part of the radius. */
const RIM = 0.88;
/** Gravity in units a second² (32 u = 1 m). */
const GRAVITY = 9.81 * 32;
/** Steps of the simulation are no longer than this (s), so fast bumps stay steady. */
const STEP = 1 / 240;
/** A jump further than this in one frame is a teleport, not motion (u, or eye sizes when bigger). */
const TELEPORT = 200;

let domeGeo: THREE.BufferGeometry | null = null;

/** A unit dome (radius 1) standing out towards −Z, its front faces facing −Z. Shared by every eye. */
export function eyeGeometry(): THREE.BufferGeometry {
  if (domeGeo) return domeGeo;
  const rings = 10;
  const segs = 48;
  const pos: number[] = [0, 0, -DOME];
  for (let r = 1; r <= rings; r++) {
    const rho = r / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * rho, Math.sin(a) * rho, -DOME * (1 - rho * rho));
    }
  }
  const idx: number[] = [];
  const at = (r: number, s: number) => (r === 0 ? 0 : 1 + (r - 1) * segs + (s % segs));
  for (let s = 0; s < segs; s++) idx.push(0, at(1, s + 1), at(1, s));
  for (let r = 1; r < rings; r++)
    for (let s = 0; s < segs; s++) {
      const a = at(r, s), b = at(r, s + 1), c = at(r + 1, s), d = at(r + 1, s + 1);
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // (The front must face −Z: if the winding came out the other way, turn every triangle round.)
  if (g.getAttribute('normal').getZ(0) > 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2]!, idx[i + 1]!];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  g.name = 'googly-eye';
  return (domeGeo = g);
}

/** The eye's look, drawn on the dome. */
const FRAG = /* glsl */ `
vec2 cwP = vCwEye;
float cwR = length(cwP);
float cwAA = max(fwidth(cwR), 1e-4) * 1.2;
float cwPR = uCwPupilR;
float cwPD = length(cwP - uCwPupil);
float cwPupil = 1.0 - smoothstep(cwPR - cwAA, cwPR + cwAA, cwPD);
// The pupil's contact shadow on the white: soft, a little further out from the middle than the pupil.
float cwShadow = 1.0 - smoothstep(cwPR * 0.85, cwPR * 1.45, length(cwP - uCwPupil * 1.1));
// The white sits in a shallow cup: a touch darker towards the rim.
vec3 cwWhite = uCwWhite * (1.0 - 0.2 * smoothstep(0.45, RIM_AT, cwR)) * (1.0 - 0.28 * cwShadow);
// A faint ring where the pupil's edge catches the light.
float cwEdge = smoothstep(cwPR - 4.0 * cwAA, cwPR - cwAA, cwPD) * cwPupil;
vec3 cwCol = mix(cwWhite, uCwBlack + 0.06 * cwEdge, cwPupil);
// The clear plastic rim: the white seen through it, darker, with a dark line where the cup ends.
float cwRim = smoothstep(RIM_AT - cwAA, RIM_AT + cwAA, cwR);
cwCol = mix(cwCol, uCwWhite * 0.62, cwRim);
cwCol *= 1.0 - 0.55 * (smoothstep(RIM_AT - 3.0 * cwAA, RIM_AT, cwR) - smoothstep(RIM_AT, RIM_AT + 3.0 * cwAA, cwR));
// Seen from behind: grey plastic.
if (!gl_FrontFacing) cwCol = vec3(0.32);
diffuseColor.rgb = cwCol;
`;

/** A lit, clear-coated material that draws one eye; its pupil is moved through `uniforms.uCwPupil`. */
function eyeMaterial(data: GooglyEyesData): { material: THREE.MeshPhysicalMaterial; pupil: { value: THREE.Vector2 } } {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide });
  m.name = 'cw-googly-eye';
  const pupil = { value: new THREE.Vector2(0, 0) };
  const uniforms = {
    uCwPupil: pupil,
    uCwPupilR: { value: THREE.MathUtils.clamp(data.pupil, 0.2, 0.8) * RIM },
    uCwWhite: { value: new THREE.Color(data.white || '#ffffff').convertSRGBToLinear() },
    uCwBlack: { value: new THREE.Color(data.pupilColor || '#141414').convertSRGBToLinear() },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCwEye;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCwEye = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define RIM_AT ${RIM.toFixed(3)}\nvarying vec2 vCwEye;\nuniform vec2 uCwPupil;\nuniform float uCwPupilR;\nuniform vec3 uCwWhite, uCwBlack;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG}`)
      // The pupil is a little glossier than the white.
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, cwPupil);');
  };
  m.customProgramCacheKey = () => 'cw-googly-eye';
  return { material: m, pupil };
}

/** One eye's loose pupil: where it is (from the eye's middle, in the world, u) and how it moves. */
interface Pupil {
  mesh: THREE.Mesh;
  uniform: { value: THREE.Vector2 };
  /** The pupil's offset from the eye's middle and its velocity relative to the eye (world, u and u/s). */
  off: THREE.Vector3;
  vel: THREE.Vector3;
  /** The eye's middle and (smoothed) velocity last frame; null until the first frame. */
  at: THREE.Vector3 | null;
  eyeVel: THREE.Vector3;
  asleep: boolean;
}

export interface GooglyEyes {
  object: THREE.Group;
  /** Move the pupils on by `dt` seconds (where the eyes are is worked out afresh). True: they moved. */
  update(dt: number): boolean;
  /** Each pupil's place in its eye (x, y; the eye's radius is 1), as the shader draws it. */
  pupils(): [number, number][];
  /**
   * Ride on the bone of `model` the settings name (the head by default), if they ask for it and it has one. Call it
   * once the model is in the same place as the eyes' object and still in its rest pose. Returns the bone.
   */
  rideModel(model: THREE.Object3D): THREE.Object3D | null;
  dispose(): void;
}

const _m = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _n = new THREE.Vector3();
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Whether a pupil at `off` (from the eye's middle) stays put under the in-plane pull `f`: there is hardly any pull
 * (the eye faces up or down), there is no room to move, or it lies against the rim right where the pull points.
 */
export function restsAt(off: THREE.Vector3, f: THREE.Vector3, reach: number): boolean {
  const pull = f.length();
  if (pull < 0.03 * GRAVITY || reach <= 1e-6) return true;
  const d = off.length();
  if (d < reach * 0.98) return false;
  return off.dot(f) / (d * pull) > 0.995;
}

/**
 * Googly eyes for the ready-made chicken (`chicken_rigged`, in metres): just outside its own eyes, about their size,
 * looking out to the sides and up as they do, riding on its head. (Measured from the eye whites in the model:
 * middles at ±0.187, 2.450, −0.685 m, 0.104 m across, facing 0.897, 0.400, −0.189.)
 */
export const CHICKEN_EYES: Partial<GooglyEyesData> = {
  count: 'two',
  size: 8.5,
  spacing: 15.4,
  offset: [0, 96.6, -27],
  splay: 78,
  tilt: 24,
  pupil: 0.5,
  followBone: true,
  bone: '',
};

/** Names compared loosely: any case, and without the dots and spaces loaders strip (“wing.R” is “wingR”). */
const plainName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The bone of a model called `name`, or with an empty name its head: the first bone with “head” in its name. */
export function findBone(model: THREE.Object3D, name: string): THREE.Object3D | null {
  const want = plainName(name);
  let found: THREE.Object3D | null = null;
  model.traverse((o) => {
    if (found || !(o as THREE.Bone).isBone) return;
    const n = plainName(o.name);
    if (want ? n === want : n.includes('head')) found = o;
  });
  return found;
}

/**
 * Work out `o`'s world matrix afresh from its own and every parent's local matrix (and store them on the way).
 * (`updateWorldMatrix(true, …)` isn't enough: an object that doesn't update its matrix by itself keeps a stale
 * world matrix after its parents moved, until the whole scene is updated from the top.)
 */
export function freshWorld(o: THREE.Object3D): THREE.Matrix4 {
  const chain: THREE.Object3D[] = [];
  for (let x: THREE.Object3D | null = o; x; x = x.parent) chain.push(x);
  for (let i = chain.length - 1; i >= 0; i--) {
    const x = chain[i]!;
    if (x.matrixAutoUpdate) x.updateMatrix();
    if (!x.matrixWorldAutoUpdate) continue;
    if (x.parent) x.matrixWorld.multiplyMatrices(x.parent.matrixWorld, x.matrix);
    else x.matrixWorld.copy(x.matrix);
  }
  return o.matrixWorld;
}

/** Move `object` onto `bone`, keeping where it is in the world now, so the bone carries it from here on. */
export function rideOn(object: THREE.Object3D, bone: THREE.Object3D): void {
  freshWorld(object);
  freshWorld(bone);
  const local = bone.matrixWorld.clone().invert().multiply(object.matrixWorld);
  bone.add(object);
  object.matrixAutoUpdate = false;
  object.matrix.copy(local);
  object.matrixWorldNeedsUpdate = true;
}

/** Build a pair (or one) of googly eyes, placed in the object's own space. */
export function buildGooglyEyes(data: GooglyEyesData): GooglyEyes {
  const object = new THREE.Group();
  object.name = 'googly-eyes';
  const r = Math.max(0.5, data.size / 2);
  const off = (Array.isArray(data.offset) ? data.offset : [0, 0, 0]) as [number, number, number];
  object.position.set(off[0] ?? 0, off[1] ?? 0, off[2] ?? 0);
  const two = data.count !== 'one';
  const splay = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(data.splay || 0, 0, 90));
  const tilt = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(data.tilt || 0, -60, 60));
  const geo = eyeGeometry();
  const pupils: Pupil[] = [];
  const materials: THREE.Material[] = [];
  for (const side of two ? [-1, 1] : [0]) {
    const { material, pupil } = eyeMaterial(data);
    materials.push(material);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'googly-eye';
    mesh.scale.setScalar(r);
    mesh.position.x = (side * Math.max(0, data.spacing)) / 2;
    // Turned out (the left eye, −X, looks towards −X; the right one towards +X), and up or down.
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = -side * splay;
    mesh.rotation.x = tilt;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    object.add(mesh);
    pupils.push({ mesh, uniform: pupil, off: new THREE.Vector3(), vel: new THREE.Vector3(), at: null, eyeVel: new THREE.Vector3(), asleep: false });
  }
  const loose = THREE.MathUtils.clamp(data.loose ?? 0.6, 0, 1);
  // How quickly the pupil's own motion dies away, how much of it a rim bounce keeps, and the rub along the rim.
  const damping = THREE.MathUtils.lerp(16, 1.2, loose);
  const bounce = THREE.MathUtils.lerp(0.1, 0.6, loose);
  const rub = THREE.MathUtils.lerp(12, 1.0, loose);
  // How hard the eye's own acceleration throws the pupil (stiff eyes shrug most of it off).
  const throwK = THREE.MathUtils.lerp(0.35, 1.0, loose);
  const pupilR = THREE.MathUtils.clamp(data.pupil, 0.2, 0.8) * RIM;

  const update = (dt: number): boolean => {
    if (!(dt > 0)) return false;
    let moved = false;
    for (const p of pupils) {
      // (Where the eye really is now: its object may ride on a bone that an animation just moved.)
      const e = freshWorld(p.mesh).elements;
      _m.set(e[12]!, e[13]!, e[14]!);
      _x.set(e[0]!, e[1]!, e[2]!);
      _y.set(e[4]!, e[5]!, e[6]!);
      // The eye's radius in the world, and its plane (x, y) and the way it faces (n).
      const R = _x.length();
      if (!(R > 1e-6)) continue;
      _x.divideScalar(R);
      _y.normalize();
      _n.crossVectors(_x, _y).normalize();
      const reach = Math.max(0, RIM - pupilR) * R;
      if (!p.at) {
        // First frame: the pupil starts where it would rest (fallen to the bottom of the eye).
        p.at = _m.clone();
        p.off.copy(DOWN).addScaledVector(_n, -_n.dot(DOWN));
        if (p.off.lengthSq() > 0.0025) p.off.setLength(reach);
        else p.off.set(0, 0, 0);
        p.vel.set(0, 0, 0);
        p.eyeVel.set(0, 0, 0);
        p.asleep = true;
        moved = true;
      } else {
        // The eye's velocity (smoothed: editor drags arrive in jumps) and its acceleration.
        _v.subVectors(_m, p.at).divideScalar(dt);
        const jump = p.at.distanceTo(_m) > Math.max(TELEPORT, 40 * R);
        p.at.copy(_m);
        // (Kept in the eye as it tilts: on its plane, inside the rim.)
        p.off.addScaledVector(_n, -_n.dot(p.off));
        p.vel.addScaledVector(_n, -_n.dot(p.vel));
        if (p.off.length() > reach) p.off.setLength(reach);
        if (jump) {
          p.eyeVel.set(0, 0, 0);
        } else {
          const k = 1 - Math.exp(-dt * 30);
          _a.copy(p.eyeVel);
          p.eyeVel.lerp(_v, k);
          _a.subVectors(p.eyeVel, _a).divideScalar(dt);
          if (_a.length() > 8000) _a.setLength(8000);
          // What pulls the pupil: gravity, less the eye's acceleration (the eye moves under it).
          _f.copy(DOWN).multiplyScalar(GRAVITY).addScaledVector(_a, -throwK);
          _f.addScaledVector(_n, -_n.dot(_f));
          // Asleep while it lies still where it would rest anyway; woken by anything that moves it.
          if (!(p.asleep && _a.length() < 30 && restsAt(p.off, _f, reach))) {
            p.asleep = false;
            const n = Math.min(40, Math.ceil(dt / STEP));
            const h = dt / n;
            for (let i = 0; i < n; i++) {
              p.vel.addScaledVector(_f, h).multiplyScalar(Math.exp(-damping * h));
              p.off.addScaledVector(p.vel, h);
              const d = p.off.length();
              if (d > reach) {
                // The rim: back inside, the outward part of its speed bounced back (a little), the rest rubbed down.
                p.off.multiplyScalar(reach / d);
                _t.copy(p.off).normalize();
                const out = p.vel.dot(_t);
                if (out > 0) p.vel.addScaledVector(_t, -(1 + bounce) * out);
                p.vel.multiplyScalar(Math.exp(-rub * h));
              }
            }
            moved = true;
            if (p.vel.length() < 0.6 * R && _a.length() < 30) p.asleep = true;
          }
        }
      }
      // Into the eye's own units (radius 1) for the shader. (A still pupil in an eye that turned is drawn anew.)
      const ux = p.off.dot(_x) / R, uy = p.off.dot(_y) / R;
      if (Math.abs(ux - p.uniform.value.x) + Math.abs(uy - p.uniform.value.y) > 1e-4) moved = true;
      p.uniform.value.set(ux, uy);
    }
    return moved;
  };

  return {
    object,
    update,
    pupils: () => pupils.map((p) => [p.uniform.value.x, p.uniform.value.y]),
    rideModel: (model) => {
      if (data.followBone === false) return null;
      const bone = findBone(model, data.bone ?? '');
      if (bone) rideOn(object, bone);
      return bone;
    },
    dispose: () => {
      for (const m of materials) m.dispose();
    },
  };
}
