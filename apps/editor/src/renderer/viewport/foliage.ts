/**
 * Foliage (A2b): grass tufts drawn over the upward-facing surfaces of brushes that have a Foliage component.
 * Only the component is saved; the tufts are placed when the scene is shown or played, and kept until the brush
 * or its settings change. Shared by the editor and play mode.
 */
import { SceneDoc, readComponent, type ScatterData } from '@cocoaworlds/core';
import { COLLIDER_MATERIAL, TUFT_STRIDE, bounds as brushBoxOf, buildMesh, coverAt, coverMinUp, isNoGrassBrush, scatterOnMesh, seededRandom, type Tufts } from '@cocoaworlds/geometry';
import { onTerrainChange, terrainChunks, terrainField, terrainVersion } from './terrains';
import { onPlantsChange, plantById, plantGeometry } from './plants';
import { applyMat4, type EntityData, type ModelData, type TerrainData } from '@cocoaworlds/core';
import { UNITS_PER_METRE, loadModel } from './models';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { brushOf } from '../brush/brushes';
import * as THREE from 'three';
import { isShown, worldBrushOf } from '../brush/brushes';

/** Shared wind clock for every foliage material (seconds); the view sets it each frame. */
export const FOLIAGE_TIME = { value: 0 };

/** Detail levels: full blades up close, plain single-triangle blades further out, a few broad ones far away. */
const LEVELS = [
  { blades: 14, plain: false, widen: 1 },
  { blades: 8, plain: true, widen: 1.35 },
  { blades: 4, plain: true, widen: 2 },
];
/** How far (u, from the camera to a chunk's edge) each level is drawn (the last, however far). */
export const FOLIAGE_LOD_DISTANCES = [320, 960, Infinity];
/** At most this many tufts on one terrain (a brush gets TUFT_MAX). */
const TERRAIN_TUFT_MAX = 80000;

/** Objects narrower than this (u, their widest side across the ground) leave the grass alone. */
export const GRASS_CLEAR_MIN = 24;
/** The last part of each level's range where it blends into the next (a share of that distance). */
const BLEND = 0.2;
/** Grass is drawn in square chunks this wide, each at its own level (and skipped when out of view). */
const CHUNK = 256;

/**
 * One tuft: a clump of leaf-shaped blades fanning out from the middle and leaning outwards, dark at the root and
 * bright at the tips, wide enough that neighbouring tufts overlap and hide the ground. One unit tall, one wide.
 * Further levels have fewer, wider blades, each a single triangle.
 */
function tuftGeometry(level: number, part: 'all' | 'blades' | 'disc' = 'all'): THREE.BufferGeometry {
  const L = LEVELS[level]!;
  const pos: number[] = [];
  const col: number[] = [];
  const rnd = seededRandom(17);
  for (let i = 0; i < (part === 'disc' ? 0 : L.blades); i++) {
    const a = i * 2.39996 + rnd() * 0.4; // golden angle: evenly round
    // (The first few stand up in the middle; the rest fan out low, covering the ground round the clump.)
    const upright = i < Math.max(1, Math.round(L.blades / 5));
    const lean = (upright ? 8 + rnd() * 14 : 34 + rnd() * 36) * (Math.PI / 180);
    const h = 0.75 + rnd() * 0.25;
    const w = (0.24 + rnd() * 0.1) * L.widen;
    const out = { x: Math.cos(a), z: Math.sin(a) };
    const side = { x: -out.z, z: out.x };
    const r0 = 0.04 + rnd() * 0.08;
    // Along the blade: base, a wider middle, and the tip (drooping a little further out).
    const at = (t: number, droop: number) => {
      const r = r0 + Math.sin(lean) * h * t + droop;
      return { x: out.x * r, y: Math.cos(lean) * h * t, z: out.z * r };
    };
    const b = at(0, 0), m = at(0.5, 0.03 * h), tip = at(1, 0.12 * h);
    const half = [w * 0.3, w * 0.5];
    const v = (p: { x: number; y: number; z: number }, off: number, shade: number) => {
      pos.push(p.x + side.x * off, p.y, p.z + side.z * off);
      col.push(shade, shade, shade);
    };
    if (L.plain) {
      // One triangle: the base, out to the tip.
      v(b, -half[1]!, 0.55); v(b, half[1]!, 0.55); v(tip, 0, 1.1);
    } else {
      // Two quads up to the middle, then a point.
      v(b, -half[0]!, 0.55); v(b, half[0]!, 0.55); v(m, half[1]!, 0.85);
      v(b, -half[0]!, 0.55); v(m, half[1]!, 0.85); v(m, -half[1]!, 0.85);
      v(m, -half[1]!, 0.85); v(m, half[1]!, 0.85); v(tip, 0, 1.12);
    }
  }
  // A root-coloured disc on the ground under the clump: neighbouring discs overlap, so no bare ground shows
  // between tufts, yet where grass is cleared (or the field ends) the floor shows as it is. With the grass layer
  // under them, only tufts at the edge of the field have one (a disc of its own geometry).
  const sides = part === 'blades' ? 0 : level === 0 ? 8 : 6, R = 0.72, lift = 0.03;
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
    pos.push(0, lift, 0, Math.cos(a1) * R, lift, Math.sin(a1) * R, Math.cos(a0) * R, lift, Math.sin(a0) * R);
    col.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // (Replaced by the floor's normal in the shader.)
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/**
 * Which tufts stand at the edge of the field (1) rather than inside it (0). Inside: the grass layer shows fully all
 * round its disc, and there are other tufts within three spacings on every side (each quarter round it).
 */
function edgeTufts(t: Tufts, sc: ScatterData): Uint8Array {
  const cell = Math.max(1, sc.spacing * 3, sc.size), r2 = cell * cell;
  const grid = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < t.count; i++) {
    const k = key(t.data[i * TUFT_STRIDE]!, t.data[i * TUFT_STRIDE + 2]!);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }
  const out = new Uint8Array(t.count);
  for (let i = 0; i < t.count; i++) {
    const o = i * TUFT_STRIDE, x = t.data[o]!, y = t.data[o + 1]!, z = t.data[o + 2]!;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let sides = 0;
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gz = cz - 1; gz <= cz + 1; gz++)
        for (const j of grid.get(`${gx},${gz}`) ?? []) {
          if (j === i) continue;
          const p = j * TUFT_STRIDE, dx = t.data[p]! - x, dz = t.data[p + 2]! - z;
          // (Grass on a floor above or below is not a neighbour.)
          if (dx * dx + dz * dz > r2 || Math.abs(t.data[p + 1]! - y) > cell) continue;
          sides |= 1 << ((dx >= 0 ? 1 : 0) + (dz >= 0 ? 2 : 0));
        }
    const r = 0.72 * t.data[o + 4]!, ny = t.data[o + 6]!;
    let full = sides === 15;
    for (let k = 0; k < 4 && full; k++) full = coverAt(ny, x + r * Math.cos(k * 1.571), z + r * Math.sin(k * 1.571), sc) > 0.95;
    out[i] = full ? 0 : 1;
  }
  return out;
}

/**
 * The grass shades like the floor it grows on: every vertex takes the floor's normal (a per-tuft attribute), so it
 * lights flat with no shading of its own, and it sways in the wind (more towards the tips).
 */
function foliageShader(m: THREE.Material, fade: Fade): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = FOLIAGE_TIME;
    sh.uniforms.uFade = fade.amount;
    sh.uniforms.uFadeSide = fade.side;
    sh.uniforms.uWind = fade.wind ?? { value: 1 };
    // Blending between levels: a screen-door dissolve. The level going away keeps the pixels whose dither is under
    // its share; the one coming in keeps exactly the others, so nothing is drawn twice and nothing goes missing.
    sh.fragmentShader = sh.fragmentShader.replace(
      'void main() {',
      `uniform float uFade;
      uniform float uFadeSide;
      void main() {
        float cwDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (uFadeSide < 0.5 ? cwDither >= uFade : cwDither < 1.0 - uFade) discard;`,
    );
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFloor;\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = aFloor;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
        vec2 at = instanceMatrix[3].xz;
        #else
        vec2 at = vec2(0.0);
        #endif
        float sway = position.y * position.y * uWind;
        transformed.x += sin(uTime * 1.6 + at.x * 0.021 + at.y * 0.013) * 0.07 * sway;
        transformed.z += cos(uTime * 1.25 + at.y * 0.019) * 0.05 * sway;`,
      );
  };
  const flat = (sh: { fragmentShader: string }) => {
    // Both sides of a blade face the same way as the floor (no dark backs).
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    before.call(m, sh, r);
    flat(sh);
  };
  m.customProgramCacheKey = () => 'cw-foliage';
}

/** A mesh's share of a blend between levels: how much it keeps, and which side of the dither it keeps. */
interface Fade {
  amount: { value: number };
  side: { value: number };
  /** How strongly it sways (1 normal). */
  wind?: { value: number };
}

/** A chunk of one brush's grass: the same tufts at each level, only one shown at a time. */
interface Chunk {
  centre: THREE.Vector3;
  radius: number;
  meshes: THREE.InstancedMesh[];
  count: number;
  /** How many tufts have a root disc (the first ones). */
  edges: number;
}

interface Entry {
  key: string;
  chunks: Chunk[];
  /** The grass layer painted over the surface (Grass on top). */
  cover?: THREE.Mesh;
}

/** A surface in world space. */
interface Surface {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/**
 * Grass on top: a layer over the surface's material wherever it faces (world) up, fading out with the slope and
 * broken into patches exactly as the tufts are (coverAt in the geometry package; mirrored here), mottled so it
 * reads as grass seen from above rather than paint. Drawn just in front of the surface it lies on.
 */
const COVER_GLSL = `
uniform vec4 uCover;
varying vec3 vCoverPos;
varying vec3 vCoverN;
float coverPatch(vec2 p, float size) {
  float f = 6.2831853 / max(1.0, size);
  float a = sin(p.x * f + 1.7 * sin(p.y * f * 0.73)) * sin(p.y * f * 1.13 + 1.9 * sin(p.x * f * 0.61));
  float b = sin(p.x * f * 3.1 + p.y * f * 1.7) * sin(p.y * f * 2.9 - p.x * f * 0.8);
  return (a + 0.35 * b) / 1.35;
}
float coverHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

function coverMaterial(sc: ScatterData): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: sc.coverColour ?? '#3f7f2e', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  const deg = Math.PI / 180, e = (sc.edge ?? 14) / 2;
  const u = { value: new THREE.Vector4(Math.cos(Math.min(90, sc.slope + e) * deg), Math.cos(Math.max(0, sc.slope - e) * deg), (sc.patches ?? 0) * 0.45, sc.patchSize ?? 320) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCover = u;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCoverPos;\nvarying vec3 vCoverN;')
      .replace('#include <project_vertex>', 'vCoverPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCoverN = normalize(mat3(modelMatrix) * objectNormal);\n#include <project_vertex>');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${COVER_GLSL}`).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float v = normalize(vCoverN).y + uCover.z * coverPatch(vCoverPos.xz, uCover.w);
        float t = clamp((v - uCover.x) / max(1e-4, uCover.y - uCover.x), 0.0, 1.0);
        diffuseColor.a *= t * t * (3.0 - 2.0 * t);
        // Mottled: broad lighter and darker drifts, and fine speckle like blades seen from above.
        float drift = 0.5 + 0.5 * coverPatch(vCoverPos.xz + 517.0, 70.0);
        float fine = coverHash(floor(vCoverPos.xz * 0.7));
        diffuseColor.rgb *= (0.86 + 0.24 * drift) * (0.92 + 0.14 * fine);
      }`,
    );
  };
  m.customProgramCacheKey = () => 'cw-grass-cover';
  return m;
}

/** The surface's triangles that can show some of the layer, as their own mesh. */
function coverMesh(surface: Surface, sc: ScatterData, keep?: (t: number) => boolean): THREE.Mesh | null {
  const P = surface.positions, N = surface.normals, I = surface.indices;
  const minUp = Math.max(0.02, coverMinUp(sc));
  const pos: number[] = [], nor: number[] = [];
  for (let t = 0; t + 2 < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const nx = N[a]! + N[b]! + N[c]!, ny = N[a + 1]! + N[b + 1]! + N[c + 1]!, nz = N[a + 2]! + N[b + 2]! + N[c + 2]!;
    if (ny / (Math.hypot(nx, ny, nz) || 1) < minUp) continue;
    if (keep && !keep(t)) continue;
    for (const k of [a, b, c]) {
      pos.push(P[k]!, P[k + 1]!, P[k + 2]!);
      nor.push(N[k]!, N[k + 1]!, N[k + 2]!);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, coverMaterial(sc));
  mesh.name = 'grass-cover';
  mesh.receiveShadow = true;
  mesh.userData.noAo = true;
  return mesh;
}

/** Models' surfaces in the file's own space, merged (null: still loading, or none). */
const modelSurfaces = new Map<string, Surface | null>();
function modelSurface(path: string): Surface | null {
  if (modelSurfaces.has(path)) return modelSurfaces.get(path)!;
  modelSurfaces.set(path, null);
  void loadModel(path)
    .then((m) => {
      m.scene.updateMatrixWorld(true);
      const P: number[] = [], N: number[] = [], I: number[] = [];
      const v = new THREE.Vector3(), nm = new THREE.Matrix3();
      m.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const g = mesh.isMesh ? (mesh.geometry as THREE.BufferGeometry) : null;
        const pos = g?.getAttribute('position');
        if (!g || !pos) return;
        // Where each corner really is (posed, for rigged models), and normals worked out from that shape.
        const posed = new THREE.BufferGeometry();
        const at = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) mesh.getVertexPosition(i, v).toArray(at, i * 3);
        posed.setAttribute('position', new THREE.BufferAttribute(at, 3));
        if (g.getIndex()) posed.setIndex(g.getIndex());
        posed.computeVertexNormals();
        const nrm = posed.getAttribute('normal');
        nm.getNormalMatrix(o.matrixWorld);
        const base = P.length / 3;
        for (let i = 0; i < pos.count; i++) {
          v.fromArray(at, i * 3).applyMatrix4(o.matrixWorld);
          P.push(v.x, v.y, v.z);
          v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
          N.push(v.x, v.y, v.z);
        }
        const idx = g.getIndex();
        if (idx) for (let i = 0; i < idx.count; i++) I.push(base + idx.getX(i));
        else for (let i = 0; i < pos.count; i++) I.push(base + i);
      });
      if (!I.length) return;
      modelSurfaces.set(path, { positions: Float32Array.from(P), normals: Float32Array.from(N), indices: Uint32Array.from(I) });
      for (const w of modelWaiters) w();
    })
    .catch(() => undefined);
  return null;
}

/** A surface moved into world space by `m`. */
function placed(s: Surface, m: THREE.Matrix4): Surface {
  const P = new Float32Array(s.positions.length), N = new Float32Array(s.normals.length);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < P.length; i += 3) {
    v.set(s.positions[i]!, s.positions[i + 1]!, s.positions[i + 2]!).applyMatrix4(m).toArray(P, i);
    v.set(s.normals[i]!, s.normals[i + 1]!, s.normals[i + 2]!).applyMatrix3(nm).normalize().toArray(N, i);
  }
  return { positions: P, normals: N, indices: s.indices };
}

/** Smooth value noise, 0…1 (for patches). */
function noise(x: number, z: number): number {
  const h = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Patches: rounded areas of a very slightly different hue, from world-space noise (so they carry on across
 * brushes). One kind leans warm (yellower), the other cool; elsewhere it's the grass's own colour.
 */
export function patchTint(x: number, z: number, seed: number, out: THREE.Color): THREE.Color {
  const o = seed * 137.1;
  const n1 = noise((x + o) / 200, (z - o) / 200) * 0.7 + noise((x + o) / 80, (z + o) / 80) * 0.3;
  const n2 = noise((x - o + 911) / 230, (z + o + 377) / 230) * 0.7 + noise((x - o) / 90, (z - o) / 90) * 0.3;
  const warm = smooth(0.56, 0.66, n1), cool = smooth(0.58, 0.68, n2) * (1 - warm);
  return out.setRGB(1 + 0.16 * warm - 0.12 * cool, 1 + 0.07 * warm + 0.02 * cool, 1 - 0.3 * warm + 0.14 * cool);
}

/** Something standing on grass: where it clears it, and a key that changes when it moves or changes shape. */
interface Blocker {
  min: number[];
  max: number[];
  inside(x: number, y: number, z: number): boolean;
  key: string;
}

/** A model's shape for clearing grass: its box and its convex hull (planes), in the file's own space. */
interface ModelShape {
  box: THREE.Box3;
  planes: { n: THREE.Vector3; c: number }[];
}

/** Models' shapes, worked out from their files as they are first needed (null: none, or still loading). */
const modelShapes = new Map<string, ModelShape | null>();
const modelWaiters = new Set<() => void>();
function modelShape(path: string): ModelShape | null {
  if (modelShapes.has(path)) return modelShapes.get(path)!;
  modelShapes.set(path, null);
  void loadModel(path)
    .then((m) => {
      m.scene.updateMatrixWorld(true);
      const pts: THREE.Vector3[] = [];
      const v = new THREE.Vector3();
      m.scene.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        const pos = (o as THREE.Mesh).isMesh ? g?.getAttribute('position') : undefined;
        if (!pos) return;
        // (A few thousand corners are plenty for a hull.)
        const step = Math.max(1, Math.floor(pos.count / 4000));
        for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
      });
      if (pts.length < 4) return;
      const hull = new ConvexHull().setFromPoints(pts);
      modelShapes.set(path, { box: new THREE.Box3().setFromPoints(pts), planes: hull.faces.map((f) => ({ n: f.normal.clone(), c: f.constant })) });
      for (const w of modelWaiters) w();
    })
    .catch(() => undefined);
  return null;
}

/**
 * Whether an object clears grass under it: as set in the Inspector, or by default yes, except for creatures,
 * things that move (Physics other than fixed) and COL brushes (invisible colliders). NOGRASS brushes always do.
 */
export function clearsGrass(e: EntityData): boolean {
  const b = brushOf(e);
  if (b && isNoGrassBrush(b.brush)) return true;
  if (typeof e.keepsGrass === 'boolean') return !e.keepsGrass;
  const c = e.components;
  if (c.npc) return false;
  if (c.rigidBody && (c.rigidBody as { motion?: string }).motion !== 'fixed') return false;
  if (b && b.brush.faces.every((f) => f.surface.material === COLLIDER_MATERIAL)) return false;
  return true;
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * What clears grass: visible solid brushes and models, at least GRASS_CLEAR_MIN across, unless set to let grass
 * grow under them. A tuft is cleared when a point just above its root is inside one (exactly for brushes; within the
 * box for models, which must also reach down to about the ground).
 */
function blockersOf(doc: SceneDoc, skip: string, spread: number, tall: number): Blocker[] {
  const out: Blocker[] = [];
  for (const e of doc.entities) {
    if (e.id === skip || !clearsGrass(e) || !isShown(doc, e)) continue;
    const c = e.components;
    if (c.trigger || c.water || c.ladder || c.levelChange) continue;
    const wb = c.brush ? worldBrushOf(doc, e) : null;
    if (wb) {
      if (wb.role !== 'solid') continue;
      const box = brushBoxOf(wb.brush);
      // (NOGRASS brushes are there to clear grass: any size.)
      if (!box || (!isNoGrassBrush(wb.brush) && Math.max(box.max[0]! - box.min[0]!, box.max[2]! - box.min[2]!) < GRASS_CLEAR_MIN)) continue;
      // Blades leaning into something taller than the grass are hidden by it; only lower things (slabs, paths)
      // need the grass kept back by a tuft's spread, or it pokes through their top.
      const margin = box.max[1]! - box.min[1]! < tall ? spread : 0;
      const planes = wb.brush.mesh ? null : wb.brush.faces.map((f) => f.plane);
      out.push({
        min: [box.min[0]! - margin, box.min[1]!, box.min[2]! - margin],
        max: [box.max[0]! + margin, box.max[1]!, box.max[2]! + margin],
        // Inside a convex brush (behind every face's plane), with its sides pushed out by `margin`, so tufts just
        // outside don't lean their blades through it. Edited meshes go by their box.
        inside: planes
          ? (x, y, z) => planes.every((p) => p.n[0] * x + p.n[1] * y + p.n[2] * z <= p.d + 0.01 + margin * Math.hypot(p.n[0], p.n[2]))
          : (x, y, z) => x >= box.min[0]! - margin && x <= box.max[0]! + margin && y >= box.min[1]! && y <= box.max[1]! && z >= box.min[2]! - margin && z <= box.max[2]! + margin,
        key: [box.min, box.max].flat().map(round).join(','),
      });
    } else if (c.model) {
      const data = readComponent<ModelData>('model', c.model);
      const shape = data.model ? modelShape(data.model) : null;
      if (!shape) continue;
      // The world placement of the file's own space (the object's transform times the model's unit scale).
      const u = data.units === 'units' ? 1 : UNITS_PER_METRE;
      const world = new THREE.Matrix4().fromArray(doc.worldMatrix(e.id)).multiply(new THREE.Matrix4().makeScale(u, u, u));
      const local = world.clone().invert();
      const wbox = shape.box.clone().applyMatrix4(world);
      const min = wbox.min.toArray(), max = wbox.max.toArray();
      if (Math.max(max[0]! - min[0]!, max[2]! - min[2]!) < GRASS_CLEAR_MIN) continue;
      const margin = max[1]! - min[1]! < tall ? spread : 0;
      // (The margin in the file's units: world size over the object's scale.)
      const scale = new THREE.Vector3().setFromMatrixColumn(world, 0).length() || 1;
      const m = margin / scale, up = 4 / scale;
      const p = new THREE.Vector3();
      for (const k of [0, 2]) {
        min[k]! -= margin;
        max[k]! += margin;
      }
      // Inside its hull (pushed out by the margin), at the probe or a little above it.
      const inHull = (q: THREE.Vector3) => shape.planes.every((f) => f.n.dot(q) - f.c <= m * Math.hypot(f.n.x, f.n.z) + 0.001);
      out.push({
        min,
        max,
        inside: (x, y, z) => inHull(p.set(x, y, z).applyMatrix4(local)) || inHull(p.set(x, y, z).applyMatrix4(local).setY(p.y + up)),
        key: [min, max].flat().map(round).join(','),
      });
    }
  }
  return out;
}

/** Tufts not cleared by anything standing there. */
function withoutCleared(t: Tufts, blockers: Blocker[]): Tufts {
  if (!blockers.length) return t;
  const keep: number[] = [];
  for (let i = 0; i < t.count; i++) {
    const o = i * TUFT_STRIDE;
    // (Just above the root, so even a thin slab lying on the ground has it inside; one floating overhead doesn't.)
    const x = t.data[o]!, y = t.data[o + 1]! + 0.5, z = t.data[o + 2]!;
    if (!blockers.some((b) => x >= b.min[0]! && x <= b.max[0]! && z >= b.min[2]! && z <= b.max[2]! && b.inside(x, y, z))) keep.push(i);
  }
  const data = new Float32Array(keep.length * TUFT_STRIDE);
  keep.forEach((i, k) => data.set(t.data.subarray(i * TUFT_STRIDE, (i + 1) * TUFT_STRIDE), k * TUFT_STRIDE));
  return { count: keep.length, data };
}

export class FoliageRenderer {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  private geometries = LEVELS.map((_, l) => tuftGeometry(l));
  private blades = LEVELS.map((_, l) => tuftGeometry(l, 'blades'));
  private discs = LEVELS.map((_, l) => tuftGeometry(l, 'disc'));
  private dummy = new THREE.Object3D();

  private lastDoc: SceneDoc | null = null;
  private resync = () => this.lastDoc && this.sync(this.lastDoc);
  private terrainTimer: ReturnType<typeof setTimeout> | null = null;
  private offTerrain: () => void;
  private offPlants: () => void;

  constructor(private onUpdate: () => void = () => {}) {
    this.group.name = 'foliage';
    // A model's shape arrives once its file is read: then the grass under it is cleared.
    modelWaiters.add(this.resync);
    this.offPlants = onPlantsChange(() => {
      this.resync();
      this.onUpdate();
    });
    // A terrain changed: its grass is placed again once the brush rests a moment (not on every dab).
    this.offTerrain = onTerrainChange(() => {
      if (this.terrainTimer) clearTimeout(this.terrainTimer);
      this.terrainTimer = setTimeout(() => {
        this.terrainTimer = null;
        this.resync();
        this.onUpdate();
      }, 350);
    });
  }

  /** Bring the tufts up to date with the scene (only the brushes that changed are placed again). */
  sync(doc: SceneDoc | null): void {
    this.lastDoc = doc;
    const seen = new Set<string>();
    for (const e of doc?.entities ?? []) {
      if (!e.components.scatter || !doc) continue;
      if (e.components.terrain) {
        if (isShown(doc, e) && this.syncTerrain(doc, e)) seen.add(e.id);
        continue;
      }
      if (!isShown(doc, e)) continue;
      // The surface it grows on, in world space: a brush's, or a model's (once its file is read).
      const brush = worldBrushOf(doc, e);
      let model: ModelData | null = null;
      let reach: { min: number[]; max: number[] } | null = null;
      if (brush) reach = brushBoxOf(brush.brush);
      else if (e.components.model) {
        model = readComponent<ModelData>('model', e.components.model);
        const s = model.model ? modelSurface(model.model) : null;
        if (!s) {
          if (model.model) seen.add(e.id);
          continue;
        }
      } else continue;
      seen.add(e.id);
      const sc = readComponent<ScatterData>('scatter', e.components.scatter);
      const key0 = JSON.stringify([sc, sc.plant ? plantById(sc.plant) : null, e.components.brush ?? model, doc.worldMatrix(e.id)]);
      let surface: Surface | null = null;
      if (model) {
        const u = model.units === 'units' ? 1 : UNITS_PER_METRE;
        surface = placed(modelSurface(model.model)!, new THREE.Matrix4().fromArray(doc.worldMatrix(e.id)).multiply(new THREE.Matrix4().makeScale(u, u, u)));
        const box = new THREE.Box3().setFromArray(surface.positions as Float32Array);
        reach = { min: box.min.toArray(), max: box.max.toArray() };
      }
      // (Only what stands within its reach can clear its grass.)
      const blockers = reach
        ? blockersOf(doc, e.id, sc.size * 0.45, (sc.height ?? sc.size) * 1.25).filter((b) => b.max[0]! >= reach.min[0]! && b.min[0]! <= reach.max[0]! && b.max[2]! >= reach.min[2]! && b.min[2]! <= reach.max[2]! && b.max[1]! >= reach.min[1]! && b.min[1]! <= reach.max[1]! + 8)
        : [];
      const key = JSON.stringify([key0, blockers.map((b) => b.key)]);
      if (this.entries.get(e.id)?.key === key) continue;
      this.remove(e.id);
      const entry: Entry = { key, chunks: [] };
      this.entries.set(e.id, entry);
      surface ??= buildMesh([brush!.brush]);
      this.addCover(entry, surface, sc);
      const tufts = withoutCleared(scatterOnMesh(surface, sc), blockers);
      if (!tufts.count) continue;
      this.add(e.id, entry, sc, tufts);
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /**
   * Grass on a terrain: over its upward-facing ground, only where the chosen layer is painted (if one is), cleared
   * under objects standing on it. Placed again (a moment after) whenever the terrain changes. False while the
   * terrain isn't loaded.
   */
  private syncTerrain(doc: SceneDoc, e: EntityData): boolean {
    const file = readComponent<TerrainData>('terrain', e.components.terrain).file;
    const field = file ? terrainField(file) : null;
    if (!field) return false;
    const sc = readComponent<ScatterData>('scatter', e.components.scatter);
    const m = new THREE.Matrix4().fromArray(doc.worldMatrix(e.id));
    // Up to date already? (Checked from the terrain's extent, before building anything.)
    const box = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3((field.n[0] - 1) * field.cell, (field.n[1] - 1) * field.cell, (field.n[2] - 1) * field.cell)).applyMatrix4(m);
    const blockers = blockersOf(doc, e.id, sc.size * 0.45, (sc.height ?? sc.size) * 1.25).filter(
      (b) => b.max[0]! >= box.min.x && b.min[0]! <= box.max.x && b.max[2]! >= box.min.z && b.min[2]! <= box.max.z && b.max[1]! >= box.min.y && b.min[1]! <= box.max.y + 8,
    );
    const key = JSON.stringify([sc, sc.plant ? plantById(sc.plant) : null, file, terrainVersion(file), doc.worldMatrix(e.id), blockers.map((b) => b.key)]);
    if (this.entries.get(e.id)?.key === key) return true;
    // The whole surface in world space (with each corner's layer weights).
    const parts = terrainChunks(file, field);
    let count = 0, tris = 0;
    for (const { mesh } of parts) {
      count += mesh.positions.length / 3;
      tris += mesh.indices.length;
    }
    const P = new Float32Array(count * 3), N = new Float32Array(count * 3), W = new Float32Array(count * 4), I = new Uint32Array(tris);
    let vo = 0, io = 0;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (const { mesh } of parts) {
      const base = vo / 3;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        v.set(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!).applyMatrix4(m).toArray(P, vo + i);
        v.set(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!).applyMatrix3(nm).normalize().toArray(N, vo + i);
      }
      W.set(mesh.weights, (vo / 3) * 4);
      for (let i = 0; i < mesh.indices.length; i++) I[io + i] = mesh.indices[i]! + base;
      vo += mesh.positions.length;
      io += mesh.indices.length;
    }
    this.remove(e.id);
    const entry: Entry = { key, chunks: [] };
    this.entries.set(e.id, entry);
    const layer = sc.layer && sc.layer !== 'all' ? Number(sc.layer) : -1;
    // (A triangle grows grass where its corners are mostly the chosen layer.)
    const keep = layer < 0 ? undefined : (t: number) => W[I[t]! * 4 + layer]! + W[I[t + 1]! * 4 + layer]! + W[I[t + 2]! * 4 + layer]! >= 1.5;
    this.addCover(entry, { positions: P, normals: N, indices: I }, sc, keep);
    const tufts = withoutCleared(scatterOnMesh({ positions: P, normals: N, indices: I }, { ...sc, max: TERRAIN_TUFT_MAX }, keep), blockers);
    if (tufts.count) this.add(e.id, entry, sc, tufts);
    return true;
  }

  /**
   * Show each chunk at the level its distance calls for (none past the last: the ground cover carries on).
   * In a flat (orthographic) view, the level follows the zoom instead.
   */
  update(cam: THREE.Camera, unitsPerPixel = 1): void {
    const ortho = (cam as THREE.OrthographicCamera).isOrthographicCamera;
    const at = cam.getWorldPosition(new THREE.Vector3());
    const show = (m: THREE.InstancedMesh | undefined, amount: number, side: number) => {
      if (!m) return;
      m.visible = amount > 0.001;
      const f = m.material as THREE.Material & { userData: { fade: Fade } };
      f.userData.fade.amount.value = amount;
      f.userData.fade.side.value = side;
    };
    for (const e of this.entries.values()) {
      for (const c of e.chunks) {
        for (const m of c.meshes) m.visible = false;
        if (ortho) {
          show(c.meshes[unitsPerPixel < 0.6 ? 0 : unitsPerPixel < 2 ? 1 : 2], 1, 0);
          continue;
        }
        const d = Math.max(0, at.distanceTo(c.centre) - c.radius);
        const level = FOLIAGE_LOD_DISTANCES.findIndex((max) => d < max);
        if (level < 0) continue;
        // Near the end of its range a level dissolves into the next.
        const end = FOLIAGE_LOD_DISTANCES[level]!;
        const t = Number.isFinite(end) ? Math.min(1, Math.max(0, (d - end * (1 - BLEND)) / (end * BLEND))) : 0;
        show(c.meshes[level], 1 - t, 0);
        if (t > 0) show(c.meshes[level + 1], t, 1);
      }
    }
  }

  private add(id: string, entry: Entry, sc: ScatterData, t: Tufts): void {
    const def = sc.plant ? plantById(sc.plant) : null;
    const plant = def ? [0, 1, 2].map((l) => unitPlant(def, l)) : null;
    const tint = new THREE.Color();
    const rnd = seededRandom(Math.round(sc.seed) + 99);
    // (Grass with the layer under it: only tufts at the edge of the field get a root disc.)
    const edge = !plant && entry.cover ? edgeTufts(t, sc) : null;
    // Tufts by chunk.
    const byChunk = new Map<string, number[]>();
    for (let i = 0; i < t.count; i++) {
      const o = i * TUFT_STRIDE;
      const k = `${Math.floor(t.data[o]! / CHUNK)},${Math.floor(t.data[o + 2]! / CHUNK)}`;
      const list = byChunk.get(k);
      if (list) list.push(i);
      else byChunk.set(k, [i]);
    }
    for (const list of byChunk.values()) {
      // (Edge tufts first: the disc meshes draw only those.)
      if (edge) list.sort((a, b) => edge[b]! - edge[a]!);
      const count = list.length;
      const edges = edge ? list.filter((i) => edge[i]).length : count;
      const matrices = new THREE.InstancedBufferAttribute(new Float32Array(count * 16), 16);
      const colours = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      const floor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      list.forEach((i, k) => {
        const o = i * TUFT_STRIDE;
        const yaw = t.data[o + 3]!;
        this.dummy.position.set(t.data[o]!, t.data[o + 1]!, t.data[o + 2]!);
        this.dummy.rotation.set(0, yaw, 0);
        const tall = (t.data[o + 4]! * (sc.height ?? sc.size)) / sc.size;
        // (A plant keeps its own shape: scaled to the height alone.)
        const w = plant ? tall : t.data[o + 4]!;
        this.dummy.scale.set(w, tall, w);
        this.dummy.updateMatrix();
        this.dummy.matrix.toArray(matrices.array, k * 16);
        // The floor normal in the tuft's own (turned) space, so turning it back gives the floor's. (Scaled by the
        // tuft's stretch: the shader divides normals by it, so a taller tuft still gets the floor's exact normal.)
        const nx = t.data[o + 5]!, ny = t.data[o + 6]!, nz = t.data[o + 7]!;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        floor.setXYZ(k, c * nx - s * nz, (ny * tall) / w, s * nx + c * nz);
        // Its patch's hue, a touch lighter or darker per tuft.
        patchTint(t.data[o]!, t.data[o + 2]!, sc.seed, tint).multiplyScalar(0.97 + rnd() * 0.06);
        colours.setXYZ(k, tint.r, tint.g, tint.b);
      });
      const meshes = (plant ?? (edge ? this.blades : this.geometries)).map((g, l) => {
        const geo = g.clone();
        geo.setAttribute('aFloor', floor);
        const mesh = new THREE.InstancedMesh(geo, this.material(plant ? '#ffffff' : sc.colour, def?.wind ?? 1), count);
        if (edge && edges) {
          // The discs ride on the level's blades: shown, hidden and blended with them.
          const dg = this.discs[l]!.clone();
          dg.setAttribute('aFloor', floor);
          const disc = new THREE.InstancedMesh(dg, mesh.material, edges);
          disc.name = `foliage:${id}:disc${l}`;
          disc.instanceMatrix = matrices;
          disc.instanceColor = colours;
          disc.castShadow = false;
          disc.receiveShadow = true;
          disc.userData.noAo = true;
          disc.computeBoundingSphere();
          mesh.add(disc);
        }
        mesh.name = `foliage:${id}:lod${l}`;
        mesh.instanceMatrix = matrices;
        mesh.instanceColor = colours;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        // Left out of ambient occlusion: measured from its own swaying blades, it smeared dark copies over the grass.
        mesh.userData.noAo = true;
        mesh.visible = l === 0;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
        return mesh;
      });
      const sphere = meshes[0]!.boundingSphere!;
      entry.chunks.push({ centre: sphere.center.clone(), radius: sphere.radius, meshes, count, edges });
    }
  }

  private addCover(entry: Entry, surface: Surface, sc: ScatterData, keep?: (t: number) => boolean): void {
    if (sc.cover === false) return;
    const m = coverMesh(surface, sc, keep);
    if (!m) return;
    entry.cover = m;
    this.group.add(m);
    this.onUpdate();
  }

  private remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.cover) {
      this.group.remove(e.cover);
      e.cover.geometry.dispose();
      (e.cover.material as THREE.Material).dispose();
    }
    for (const c of e.chunks) {
      for (const m of c.meshes) {
        this.group.remove(m);
        for (const d of m.children as THREE.InstancedMesh[]) {
          d.geometry.dispose();
          d.dispose();
        }
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.dispose();
      }
    }
    this.entries.delete(id);
  }

  /**
   * Each mesh has a material of its own, to carry its own share of a blend between levels (they all share one
   * compiled shader).
   */
  private material(colour: string, wind = 1): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ color: colour, vertexColors: true, side: THREE.DoubleSide });
    const fade: Fade = { amount: { value: 1 }, side: { value: 0 }, wind: { value: wind } };
    m.userData.fade = fade;
    foliageShader(m, fade);
    return m;
  }

  /** How many tufts are placed in all (for the statistics line and tests). */
  get count(): number {
    let n = 0;
    for (const e of this.entries.values()) for (const c of e.chunks) n += c.count;
    return n;
  }

  /** How many tufts are drawn at each level right now (for tests). */
  get shown(): number[] {
    const out = LEVELS.map(() => 0);
    for (const e of this.entries.values()) {
      for (const c of e.chunks) {
        // (Mid-blend a chunk counts at the level with the larger share.)
        let best = -1, share = 0;
        c.meshes.forEach((m, l) => {
          const a = (m.material as THREE.Material).userData.fade.amount.value as number;
          if (m.visible && a > share) {
            best = l;
            share = a;
          }
        });
        if (best >= 0) out[best]! += c.count;
      }
    }
    return out;
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
    for (const g of [...this.geometries, ...this.blades, ...this.discs]) g.dispose();
    modelWaiters.delete(this.resync);
    this.offTerrain();
    this.offPlants();
    if (this.terrainTimer) clearTimeout(this.terrainTimer);
  }
}

const units = new Map<string, THREE.BufferGeometry>();
/** A plant's mesh one unit tall (its root at the origin), for growing it as foliage. */
function unitPlant(def: import('@cocoaworlds/core').PlantDef, level = 0): THREE.BufferGeometry {
  const key = JSON.stringify([def, level]);
  let g = units.get(key);
  if (!g) {
    g = plantGeometry(def, def.seed, level).clone();
    // (Every level scaled by the full plant's height, so they line up.)
    const h = Math.max(1, plantGeometry(def).boundingBox?.max.y ?? 1);
    g.scale(1 / h, 1 / h, 1 / h);
    if (units.size > 50) units.clear();
    units.set(key, g);
  }
  return g;
}

