/**
 * Plants (the Plants workspace): a recipe grown into a mesh. A clump is blades (grass, strap or leaf shaped,
 * leaning out and drooping) and stalks with small leaves and a bud; a tree is a tapering trunk and a crown of leaf
 * cards or soft lumps in a round, column, cone or poplar outline. Colours run from the root colour to the tip
 * colour; crowns are lit as one soft shape (normals point out from the middle), which keeps them stylized.
 * The same recipe and seed always grow the same plant.
 */
import { readComponent, type PlantDef, type SceneDoc } from '@cocoaworlds/core';
import { seededRandom } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { isShown } from '../brush/brushes';

// ── The project's plants (set by the editor from the project, by a game from its data) ──

let plants: PlantDef[] = [];
const listeners = new Set<() => void>();
export function setProjectPlants(list: PlantDef[]): void {
  plants = list;
  for (const fn of listeners) fn();
}
export function plantById(id: string): PlantDef | null {
  return plants.find((p) => p.id === id) ?? null;
}
export function onPlantsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Growing ──

/** Lump shapes, as unit triangles (positions, three per corner). */
const LUMPS: Record<NonNullable<PlantDef['lumpShape']>, ArrayLike<number>> = {
  diamond: new THREE.OctahedronGeometry(1, 0).getAttribute('position').array,
  round: new THREE.IcosahedronGeometry(1, 0).getAttribute('position').array,
  blob: new THREE.DodecahedronGeometry(1, 0).getAttribute('position').array,
  spiky: new THREE.IcosahedronGeometry(1, 0).getAttribute('position').array,
};

interface Builder {
  pos: number[];
  nor: number[];
  col: number[];
  idx: number[];
}

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function vert(b: Builder, p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color): number {
  b.pos.push(p.x, p.y, p.z);
  b.nor.push(n.x, n.y, n.z);
  b.col.push(c.r, c.g, c.b);
  return b.pos.length / 3 - 1;
}

/**
 * A blade (or leaf, or stalk) along a curve from `root`: rising at `lean` (radians from upright) towards `dir`,
 * drooping by `bend` towards its tip; `width(t)` its half width along it (0 root … 1 tip).
 */
function blade(b: Builder, root: THREE.Vector3, dir: number, lean: number, len: number, bend: number, width: (t: number) => number, c0: THREE.Color, c1: THREE.Color, segs = 6): void {
  const out = v3(Math.cos(dir), 0, Math.sin(dir));
  const side = v3(-out.z, 0, out.x);
  let p = root.clone();
  const ids: [number, number][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Leaning out more and more as it goes (drooping), from `lean` at the root.
    const a = lean + bend * t * t * 1.4;
    const along = v3().addScaledVector(out, Math.sin(a)).add(v3(0, Math.cos(a), 0));
    // Ground foliage is lit like the floor it grows from: every normal straight up.
    const n = v3(0, 1, 0);
    const c = c0.clone().lerp(c1, t);
    const w = width(t);
    ids.push([vert(b, p.clone().addScaledVector(side, -w), n, c), vert(b, p.clone().addScaledVector(side, w), n, c)]);
    p = p.clone().addScaledVector(along, len / segs);
  }
  for (let i = 0; i < segs; i++) {
    const [a0, a1] = ids[i]!, [b0, b1] = ids[i + 1]!;
    b.idx.push(a0, a1, b1, a0, b1, b0);
  }
}

const SHAPES: Record<PlantDef['bladeShape'], (t: number) => number> = {
  grass: (t) => Math.pow(1 - t, 0.7),
  strap: (t) => (t < 0.8 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 2))),
  leaf: (t) => Math.sin(Math.PI * Math.min(1, t * 1.05)) * (t < 0.1 ? 0.5 + t * 5 : 1),
};

/** The crown's half width at a height through it (0 bottom … 1 top), as a share of its widest. */
function crownRadius(shape: PlantDef['crown'], t: number): number {
  switch (shape) {
    case 'round':
      return Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    case 'column':
      return t < 0.15 ? 0.6 + t * 2.6 : t > 0.85 ? Math.sqrt(Math.max(0, 1 - ((t - 0.85) / 0.15) ** 2)) : 1;
    case 'cone':
      return t < 0.12 ? 0.75 + t * 2 : Math.max(0.04, 1 - (t - 0.12) / 0.88) ** 0.9;
    case 'poplar':
      return Math.sin(Math.PI * Math.min(1, t)) ** 0.8 * (0.75 + 0.25 * Math.sin(Math.PI * t * 0.9));
    case 'oval':
      // An egg: widest a little below the middle.
      return Math.sqrt(Math.max(0, 1 - ((t - 0.42) / (t < 0.42 ? 0.42 : 0.58)) ** 2));
    case 'umbrella':
      // Spreading wide with a flat top (an oak, an acacia).
      return t < 0.35 ? 0.45 + t * 1.57 : Math.sqrt(Math.max(0, 1 - ((t - 0.35) / 0.65) ** 3));
    case 'weeping':
      // A wide curtain from a rounded top (a willow): its leaves hang (see droop).
      return t < 0.7 ? 0.85 + (0.15 * t) / 0.7 : Math.sqrt(Math.max(0, 1 - ((t - 0.7) / 0.3) ** 2));
  }
}

/** Detail levels: how many leaves (and how much bigger each, to keep the crown full), blade segments, trunk sides. */
export const PLANT_LODS = [
  { leaves: 1, size: 1, segs: 6, sides: 7, buds: true },
  { leaves: 0.4, size: 1.35, segs: 3, sides: 6, buds: false },
  { leaves: 0.12, size: 2.1, segs: 2, sides: 5, buds: false },
];

function grow(d: PlantDef, seed: number, level = 0): Builder {
  const lod = PLANT_LODS[level]!;
  const rnd = seededRandom(Math.round(seed) * 7919 + 13);
  const r = (a: number, b: number) => a + (b - a) * rnd();
  const vary = (x: number) => x * (1 + (rnd() * 2 - 1) * d.variation * 0.5);
  const b: Builder = { pos: [], nor: [], col: [], idx: [] };
  const c0 = new THREE.Color(d.colour), c1 = new THREE.Color(d.tipColour), bark = new THREE.Color(d.trunkColour);
  const tint = (c: THREE.Color) => c.clone().multiplyScalar(1 + (rnd() * 2 - 1) * d.variation * 0.25);
  if (d.form === 'clump') {
    const deg = Math.PI / 180;
    for (let i = 0; i < d.blades; i++) {
      const dir = i * 2.39996 + r(-0.3, 0.3);
      const root = v3(Math.cos(dir), 0, Math.sin(dir)).multiplyScalar(r(0, d.bladeWidth * 0.8));
      const shape = SHAPES[d.bladeShape];
      const w = vary(d.bladeWidth) / 2;
      blade(b, root, dir, r(0.05, 1) * d.spread * deg, vary(d.bladeHeight), d.bend * r(0.6, 1.3), (t) => shape(t) * w, tint(c0), tint(c1), lod.segs);
    }
    for (let i = 0; i < d.stalks; i++) {
      const dir = i * 2.39996 + 1.1 + r(-0.4, 0.4);
      const lean = r(0.02, 0.5) * d.spread * deg;
      const len = vary(d.stalkHeight);
      const root = v3(Math.cos(dir), 0, Math.sin(dir)).multiplyScalar(r(0, d.bladeWidth));
      const thick = Math.max(0.6, d.bladeWidth * 0.12);
      blade(b, root, dir, lean, len, d.bend * 0.2, () => thick, tint(c0), tint(c0.clone().lerp(c1, 0.5)), lod.segs + 2);
      if (!lod.buds) continue;
      // Small leaves up the stalk's upper half, turning round it, and a bud at the top.
      const out = v3(Math.cos(dir), 0, Math.sin(dir));
      const at = (t: number) => {
        const a = lean + d.bend * 0.2 * t * t * 1.4;
        // (Close enough to the stalk's curve for leaves set along it.)
        return root.clone().add(v3().addScaledVector(out, Math.sin(a) * len * t).add(v3(0, Math.cos(a) * len * t, 0)));
      };
      for (let k = 0; k < d.buds; k++) {
        const t = 0.45 + (0.5 * k) / Math.max(1, d.buds);
        const ld = dir + k * 2.2 + r(-0.3, 0.3);
        const ls = d.stalkHeight * 0.12 * r(0.8, 1.2);
        blade(b, at(t), ld, 1.0, ls, 0.3, (q) => SHAPES.leaf(q) * ls * 0.3, tint(c1), tint(c1), 3);
      }
      const bs = d.stalkHeight * 0.07;
      blade(b, at(1), dir, 0.2, bs * 1.6, 0, (q) => SHAPES.leaf(q) * bs * 0.55, tint(c1), tint(c1), 3);
    }
    return b;
  }
  // ── Tree: a tapering trunk... ──
  const H = d.height, top = H * 0.97, sides = lod.sides;
  const ring = (y: number, rad: number) =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      return vert(b, v3(Math.cos(a) * rad, y, Math.sin(a) * rad), v3(Math.cos(a), 0.2, Math.sin(a)).normalize(), bark);
    });
  const trunkTop = H * Math.max(0.35, d.trunkClear + 0.5);
  const rings = [ring(0, d.trunkWidth * 0.6), ring(trunkTop * 0.5, d.trunkWidth * 0.45), ring(trunkTop, d.trunkWidth * 0.2)];
  for (let k = 0; k + 1 < rings.length; k++)
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      b.idx.push(rings[k]![i]!, rings[k + 1]![i]!, rings[k + 1]![j]!, rings[k]![i]!, rings[k + 1]![j]!, rings[k]![j]!);
    }
  // ...and a crown filling its outline.
  const y0 = H * d.trunkClear, cw = d.crownWidth / 2;
  // Spherized normals: every leaf corner lit as a point on the crown's outline (an ellipsoid round its middle),
  // so the whole crown shades as one soft shape.
  const cy = y0 + (top - y0) * 0.5, ry = Math.max(1, (top - y0) / 2), rx = Math.max(1, cw);
  const sph = (q: THREE.Vector3) => v3(q.x / (rx * rx), (q.y - cy) / (ry * ry), q.z / (rx * rx)).normalize();
  // (Fewer leaves further away: the same ones, each bigger, so the crown keeps its outline.)
  const count = Math.max(3, Math.round(d.leaves * lod.leaves));
  const droop = d.droop ?? (d.crown === 'weeping' ? 0.8 : 0);
  for (let i = 0; i < count; i++) {
    const t = Math.pow(rnd(), d.crown === 'cone' ? 1.25 : 1);
    const y = y0 + (top - y0) * t;
    const rad = crownRadius(d.crown, t) * cw * (d.foliage === 'lumps' ? r(0.55, 0.95) : Math.sqrt(r(0.15, 1)));
    const a = rnd() * Math.PI * 2;
    // Hanging under their weight: leaves sink more the further out they are (never into the ground).
    const sag = droop * Math.min(1, rad / Math.max(1, cw)) ** 2 * (top - y0) * (d.crown === 'weeping' ? 0.75 : 0.35);
    const p = v3(Math.cos(a) * rad, Math.max(H * 0.04, y - sag * r(0.6, 1.1)), Math.sin(a) * rad);
    // Lit as part of one soft crown: normals point out from its middle (and a little up).
    const n = sph(p);
    const shade = 0.25 + 0.75 * t;
    const c = tint(c0.clone().lerp(c1, Math.min(1, shade * (0.6 + 0.4 * rnd()))));
    // Lumps take their colour from where each corner is (height and a gentle wash), not one colour per lump:
    // where lumps cut into each other both are the same colour there, so no hard seam shows.
    const colourAt = (q: THREE.Vector3) => {
      const h = (q.y - y0) / Math.max(1, top - y0);
      const wash = Math.sin(q.x * 0.013 + q.z * 0.011) * Math.cos(q.y * 0.017 + q.x * 0.007);
      return c0.clone().lerp(c1, Math.min(1, Math.max(0, 0.2 + 0.7 * h + wash * 0.25 * (0.3 + d.variation))));
    };
    const s = vary(d.leafSize) * lod.size;
    if (d.foliage === 'cards') {
      // A leaf card: a quad facing roughly out, tipped at random.
      const f = n.clone().add(v3(r(-0.6, 0.6), r(-0.4, 0.6) - droop * 0.9, r(-0.6, 0.6))).normalize();
      const u = v3(0, 1, 0).cross(f).normalize();
      if (u.lengthSq() < 0.1) u.set(1, 0, 0);
      const w = f.clone().cross(u).normalize();
      // Hanging leaves stretch into long, narrow strands (a willow's curtain).
      u.multiplyScalar(1 - droop * 0.35);
      w.multiplyScalar(1 + droop * 1.8);
      const q = [u.clone().multiplyScalar(-s / 2).addScaledVector(w, -s / 2), u.clone().multiplyScalar(s / 2).addScaledVector(w, -s / 2), u.clone().multiplyScalar(s / 2).addScaledVector(w, s / 2), u.clone().multiplyScalar(-s / 2).addScaledVector(w, s / 2)];
      const ids = q.map((o) => {
        const at = p.clone().add(o);
        return vert(b, at, sph(at), c);
      });
      b.idx.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
    } else {
      // A soft lump: the chosen shape, stretched, its corners jittered, turned at random about the up axis.
      const shape = level > 0 ? 'diamond' : (d.lumpShape ?? 'diamond');
      const t = LUMPS[shape];
      const k = v3(d.lumpX ?? 1, d.lumpY ?? 1.2, d.lumpZ ?? 1).multiplyScalar(s / 2);
      const spin = rnd() * Math.PI * 2, cs = Math.cos(spin), sn = Math.sin(spin);
      const jit = shape === 'spiky' ? 0.55 : 0.2;
      const moved = new Map<string, THREE.Vector3>();
      for (let i = 0; i < t.length; i += 3) {
        const o = v3(t[i]!, t[i + 1]!, t[i + 2]!);
        // (The same corner moves the same way in every face it's in: no cracks.)
        const key = `${o.x.toFixed(3)},${o.y.toFixed(3)},${o.z.toFixed(3)}`;
        let q = moved.get(key);
        if (!q) {
          const j = 1 + (rnd() * 2 - 1) * jit;
          q = v3(o.x * cs - o.z * sn, o.y, o.x * sn + o.z * cs).multiplyScalar(j).multiply(k);
          moved.set(key, q);
        }
        const at = p.clone().add(q);
        b.idx.push(vert(b, at, sph(at), colourAt(at)));
      }
    }
  }
  return b;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** A plant's mesh (kept: the same recipe and seed give the same one). Its root is at the origin. */
export function plantGeometry(d: PlantDef, seed = d.seed, level = 0): THREE.BufferGeometry {
  const key = JSON.stringify([d, seed, level]);
  let g = cache.get(key);
  if (!g) {
    const b = grow(d, seed, level);
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    if (cache.size > 200) cache.clear();
    cache.set(key, g);
  }
  return g;
}

// ── Impostors: a far tree as one picture of itself, facing the camera ──

let bake: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.OrthographicCamera; mesh: THREE.Mesh } | null = null;
const impostors = new Map<string, { map: THREE.Texture; width: number; height: number }>();

/**
 * A picture of the plant from the side (rendered once, with soft light from the front and above), cut out
 * against a clear background, and its size in u.
 */
export function plantImpostor(d: PlantDef, seed = d.seed): { map: THREE.Texture; width: number; height: number } {
  const key = JSON.stringify([d, seed]);
  const have = impostors.get(key);
  if (have) return have;
  if (!bake) {
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setSize(256, 256);
    r.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#f2f6ff', '#7d8a72', 1.7));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(0.4, 1, 1);
    scene.add(sun);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), PLANT_MATERIAL);
    scene.add(mesh);
    bake = { r, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000), mesh };
  }
  const g = plantGeometry(d, seed);
  const box = g.boundingBox!;
  const height = Math.max(1, box.max.y);
  const width = Math.max(1, 2 * Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z));
  const half = Math.max(width, height) / 2;
  // (Square picture; the plant stands on its bottom edge, centred.)
  Object.assign(bake.cam, { left: -half, right: half, top: half * 2, bottom: 0 });
  bake.cam.position.set(0, 0, 5000);
  bake.cam.lookAt(0, 0, 0);
  bake.cam.updateProjectionMatrix();
  bake.mesh.geometry = g;
  bake.r.render(bake.scene, bake.cam);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  c.getContext('2d')!.drawImage(bake.r.domElement, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const out = { map, width: half * 2, height: half * 2 };
  if (impostors.size > 100) impostors.clear();
  impostors.set(key, out);
  return out;
}

/** The material plants are drawn with: their own colours, both sides, lit softly. */
export const PLANT_MATERIAL = fading(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));

/**
 * A plant material that can dissolve into another detail level (a screen-door dither: the two keep
 * complementary pixels), and whose back faces light like its front (no dark undersides).
 */
function fading<M extends THREE.Material>(m: M): M {
  const fade = { amount: { value: 1 }, side: { value: 0 }, sway: { value: 0 }, height: { value: 1 } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFade = fade.amount;
    sh.uniforms.uFadeSide = fade.side;
    sh.uniforms.uSway = fade.sway;
    sh.uniforms.uSwayH = fade.height;
    sh.uniforms.uTime = PLANT_TIME;
    // Wind: the plant sways more towards its top, each one in its own rhythm (from where it stands).
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uSway;\nuniform float uSwayH;\nuniform float uTime;\n#ifdef CW_INSTANCED\nattribute vec2 aFade;\nvarying vec2 vCwFade;\n#endif',
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        {
          vec2 at = modelMatrix[3].xz;
          #ifdef CW_INSTANCED
          // (Batched plants: each its own fade, and its own rhythm from where it stands.)
          vCwFade = aFade;
          at = (modelMatrix * instanceMatrix)[3].xz;
          #endif
          float h = clamp(position.y / uSwayH, 0.0, 1.5);
          float s = h * h * uSway;
          float ph = at.x * 0.013 + at.y * 0.017;
          transformed.x += (sin(uTime * 1.3 + ph) + 0.35 * sin(uTime * 3.1 + ph * 2.0 + position.y * 0.02)) * s;
          transformed.z += cos(uTime * 1.05 + ph * 1.3) * 0.7 * s;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        `uniform float uFade;
uniform float uFadeSide;
#ifdef CW_INSTANCED
varying vec2 vCwFade;
#endif
void main() {
  #ifdef CW_INSTANCED
  float cwFadeA = vCwFade.x, cwFadeS = vCwFade.y;
  #else
  float cwFadeA = uFade, cwFadeS = uFadeSide;
  #endif
  float cwDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (cwFadeS < 0.5 ? cwDither >= cwFadeA : cwDither < 1.0 - cwFadeA) discard;`,
      )
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    // Backlight: looking towards the sun through a plant, light shines through its leaves, brightest round the
    // crown's edge (where the rounded normals turn side-on). Tinted by the leaf's own colour.
    if (!(m as unknown as THREE.SpriteMaterial).isSpriteMaterial) {
      sh.uniforms.uRimDir = PLANT_RIM.dir;
      sh.uniforms.uRimColour = PLANT_RIM.colour;
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform vec3 uRimDir;\nuniform vec3 uRimColour;\nvoid main() {')
        .replace(
          '#include <opaque_fragment>',
          `{
            vec3 toEye = normalize(vViewPosition);
            float towardSun = pow(max(0.0, dot(-toEye, uRimDir)), 3.0);
            float edge = pow(1.0 - abs(dot(normalize(normal), toEye)), 2.0);
            outgoingLight += diffuseColor.rgb * uRimColour * towardSun * (0.1 + 1.0 * edge);
          }
          #include <opaque_fragment>`,
        );
    }
  };
  m.customProgramCacheKey = () => `cw-plant-fade-${m.type}`;
  m.userData.fade = fade;
  return m;
}

/** The sun as plants' backlight sees it: its direction (towards the sun, in view space) and colour × strength. */
export const PLANT_RIM = { dir: { value: new THREE.Vector3(0, 1, 0) }, colour: { value: new THREE.Color(0, 0, 0) } };

/** Point the backlight at the scene's sun for this camera (none: no backlight). */
export function aimRim(root: THREE.Object3D, cam: THREE.Camera): void {
  let sun: THREE.DirectionalLight | null = null;
  root.traverseVisible((o) => {
    if (!sun && (o as THREE.DirectionalLight).isDirectionalLight && o.visible) sun = o as THREE.DirectionalLight;
  });
  const s = sun as THREE.DirectionalLight | null;
  if (!s) {
    PLANT_RIM.colour.value.setRGB(0, 0, 0);
    return;
  }
  const at = s.getWorldPosition(new THREE.Vector3()).sub(s.target.getWorldPosition(new THREE.Vector3())).normalize();
  PLANT_RIM.dir.value.copy(at).transformDirection(cam.matrixWorldInverse);
  PLANT_RIM.colour.value.copy(s.color).multiplyScalar(Math.min(3, s.intensity) * 0.15);
}

/** The wind clock plants sway by (seconds). */
export const PLANT_TIME = { value: 0 };

/** How far a plant's top sways (u) and the height it's measured against, for its material. */
export function setPlantWind(m: THREE.Material, d: PlantDef): void {
  const f = m.userData.fade as { sway: { value: number }; height: { value: number } } | undefined;
  if (!f) return;
  const h = Math.max(1, plantGeometry(d).boundingBox?.max.y ?? 1);
  f.height.value = h;
  f.sway.value = h * (d.form === 'tree' ? 0.012 : 0.05) * (d.wind ?? 1);
}

/** A fresh plant material (its own fade and wind). */
export function plantMaterial(): THREE.MeshLambertMaterial {
  return fading(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

const setFade = (o: THREE.Object3D, amount: number, side: number) => {
  o.visible = amount > 0.001;
  const f = ((o as THREE.Mesh).material as THREE.Material).userData.fade as { amount: { value: number }; side: { value: number } };
  f.amount.value = amount;
  f.side.value = side;
};

interface Shown {
  key: string;
  /** The batch kind (recipe and seed). */
  kind: string;
  def: PlantDef;
  seed: number;
  /** What the editor picks the plant by: its full-detail mesh, never drawn. */
  holder: THREE.Group;
  pick: THREE.Mesh;
  /** A tree's far picture (drawn on its own: a sprite). */
  card: THREE.Sprite | null;
  matrix: THREE.Matrix4;
  /** Where each level hands over to the next (u from the camera). */
  ends: number[];
  at: THREE.Vector3;
  cell: string;
}

/** Plants of one recipe, seed and detail level in one area, drawn together (one draw a pass). */
interface Batch {
  mesh: THREE.InstancedMesh;
  fade: THREE.InstancedBufferAttribute;
  capacity: number;
  /** Plants written this frame. */
  n: number;
  dirty: boolean;
}

/** The last part of each level's range where it dissolves into the next (a share of that distance). */
const BLEND = 0.2;

/**
 * The size of the areas plants are batched by (u). Each batch is culled as a whole (by the camera and each shadow's
 * view), so areas keep what is drawn close to what is seen; bigger areas mean fewer draws.
 */
export const PLANT_CELL = 2048;

const MESH_LEVELS = 3;

/**
 * Draws the scene's Plant objects (editor and game), each at the detail level its distance calls for. Plants of the
 * same recipe, seed and level in the same area are one instanced mesh (one draw call a pass instead of one each);
 * each keeps its own place, wind rhythm and dissolve between levels.
 */
export class PlantRenderer {
  readonly group = new THREE.Group();
  private shown = new Map<string, Shown>();
  private batches = new Map<string, Batch>();
  private materials = new Map<string, THREE.MeshLambertMaterial>();
  private picks = new THREE.Group();
  private last: SceneDoc | null = null;
  private off = onPlantsChange(() => this.sync(this.last));
  private eye = new THREE.Vector3();
  /** Recipe-and-seed|area pairs that have plants (batches elsewhere can go). */
  private areas = new Set<string>();

  constructor(private onDraw: () => void = () => {}) {
    this.group.name = 'plants';
    this.picks.name = 'plant picks';
    // (Sprites and never-drawn pick meshes: nothing here casts a shadow.)
    this.picks.userData.noShadowPass = true;
    // (And sprites are left out of what occlusion is measured from: the whole group at once.)
    this.picks.userData.noAo = true;
    this.group.add(this.picks);
  }

  sync(doc: SceneDoc | null): void {
    this.last = doc;
    const seen = new Set<string>();
    for (const e of doc?.entities ?? []) {
      if (!e.components.plant || !doc || !isShown(doc, e)) continue;
      const p = readComponent<{ plant: string; seed: number }>('plant', e.components.plant);
      const def = p.plant ? plantById(p.plant) : null;
      if (!def) continue;
      seen.add(e.id);
      const key = JSON.stringify([def, p.seed]);
      let s = this.shown.get(e.id);
      if (s?.key !== key) {
        if (s) this.drop(e.id);
        const holder = new THREE.Group();
        holder.name = `plant:${e.id}`;
        holder.matrixAutoUpdate = false;
        // (Placed by hand in `sync`: no render walks into it to place it again.)
        holder.matrixWorldAutoUpdate = false;
        const g0 = plantGeometry(def, p.seed);
        const size = Math.max(32, g0.boundingSphere?.radius ?? 32);
        const pick = new THREE.Mesh(g0, PICK_MATERIAL);
        pick.visible = false;
        pick.userData.entityId = e.id;
        holder.add(pick);
        const ends = [size * 6, size * 16];
        // Trees, very far away: a picture of themselves, always facing the camera (two triangles).
        let card: THREE.Sprite | null = null;
        if (def.form === 'tree') {
          const imp = plantImpostor(def, p.seed);
          card = new THREE.Sprite(fading(new THREE.SpriteMaterial({ map: imp.map, alphaTest: 0.5 })));
          card.center.set(0.5, 0);
          card.scale.set(imp.width, imp.height, 1);
          card.userData.entityId = e.id;
          card.userData.noAo = true;
          card.visible = false;
          holder.add(card);
          ends.push(size * 40);
        }
        // (Only trees' far pictures are drawn from here: other holders stay out of the scene, so no pass walks them.)
        if (card) this.picks.add(holder);
        s = { key, kind: key, def, seed: p.seed, holder, pick, card, matrix: new THREE.Matrix4(), ends, at: new THREE.Vector3(), cell: '' };
        this.shown.set(e.id, s);
      }
      s.holder.matrix.fromArray(doc.worldMatrix(e.id));
      // (Placed by hand: a holder outside the scene is never updated by a render, and picking reads its mesh's place.)
      s.holder.matrixWorld.copy(s.holder.matrix);
      for (const c of s.holder.children) c.updateMatrixWorld(true);
      s.matrix.copy(s.holder.matrix);
      s.at.setFromMatrixPosition(s.matrix);
      s.cell = `${Math.floor(s.at.x / PLANT_CELL)},${Math.floor(s.at.z / PLANT_CELL)}`;
    }
    for (const id of [...this.shown.keys()]) if (!seen.has(id)) this.drop(id);
    this.areas.clear();
    for (const s of this.shown.values()) {
      this.areas.add(`${s.kind}|${s.cell}`);
      // (Made now, not on the first frame: Play compiles every shader before it starts, these batched ones too.)
      this.batch(s, 0);
    }
    this.onDraw();
  }

  /** Show each plant at its level for this camera, dissolving into the next near the end of each range. */
  update(cam: THREE.Camera): void {
    PLANT_TIME.value = performance.now() / 1000;
    let root: THREE.Object3D = this.group;
    while (root.parent) root = root.parent;
    aimRim(root, cam);
    const eye = cam.getWorldPosition(this.eye);
    for (const b of this.batches.values()) b.n = 0;
    for (const s of this.shown.values()) {
      const d = eye.distanceTo(s.at);
      const count = s.ends.length + 1;
      let level = s.ends.findIndex((e) => d < e);
      if (level < 0) level = count - 1;
      const end = s.ends[level];
      const t = end === undefined ? 0 : Math.min(1, Math.max(0, (d - end * (1 - BLEND)) / (end * BLEND)));
      if (s.card) {
        // (The holder too: hidden, no pass steps into it.)
        s.card.visible = false;
        s.holder.visible = false;
      }
      this.put(s, level, 1 - t, 0);
      if (t > 0 && level + 1 < count) this.put(s, level + 1, t, 1);
    }
    for (const [k, b] of this.batches) {
      if (b.mesh.count !== b.n) {
        b.mesh.count = b.n;
        b.dirty = true;
      }
      b.mesh.visible = b.n > 0;
      if (b.dirty) {
        b.mesh.instanceMatrix.needsUpdate = true;
        b.fade.needsUpdate = true;
        b.mesh.boundingSphere = null;
        b.mesh.boundingBox = null;
        b.dirty = false;
      }
      // (Areas left empty for good: let them go.)
      if (!b.n && !this.shownIn(k)) this.dropBatch(k);
    }
  }

  /** Plant `s` at `level` with this fade (`side`: which half of the dither it keeps while dissolving). */
  private put(s: Shown, level: number, amount: number, side: number): void {
    if (amount <= 0.001) return;
    if (level >= MESH_LEVELS) {
      if (s.card) {
        setFade(s.card, amount, side);
        s.holder.visible = true;
      }
      return;
    }
    const b = this.batch(s, level);
    const i = b.n++;
    if (i >= b.capacity) this.grow(b);
    const m = b.mesh.instanceMatrix.array as Float32Array, e = s.matrix.elements, o = i * 16;
    for (let k = 0; k < 16; k++) {
      // (Float32: compare what will be stored.)
      const v = Math.fround(e[k]!);
      if (m[o + k] !== v) {
        m[o + k] = v;
        b.dirty = true;
      }
    }
    const f = b.fade.array as Float32Array;
    const a = Math.fround(amount);
    if (f[i * 2] !== a || f[i * 2 + 1] !== side) {
      f[i * 2] = a;
      f[i * 2 + 1] = side;
      b.dirty = true;
    }
  }

  private batch(s: Shown, level: number): Batch {
    const k = `${s.kind}|${level}|${s.cell}`;
    let b = this.batches.get(k);
    if (!b) {
      b = this.makeBatch(s, level, 16);
      this.batches.set(k, b);
    }
    return b;
  }

  private makeBatch(s: Shown, level: number, capacity: number): Batch {
    const src = plantGeometry(s.def, s.seed, level);
    // (Its own geometry object sharing the plant's buffers: only the per-plant fade is its own.)
    const g = new THREE.BufferGeometry();
    g.index = src.index;
    for (const [name, a] of Object.entries(src.attributes)) g.setAttribute(name, a);
    g.boundingBox = src.boundingBox;
    g.boundingSphere = src.boundingSphere;
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    fade.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFade', fade);
    const mesh = new THREE.InstancedMesh(g, this.material(s), capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    // (A tree's crown is lit by its rounded normals; shadows from its own jagged leaves would stripe it.)
    mesh.receiveShadow = s.def.form === 'clump';
    // (Plants are left out of ambient occlusion: their leaves would cast dark halos on what's behind.)
    mesh.userData.noAo = true;
    mesh.name = `plants:${level}`;
    this.group.add(mesh);
    return { mesh, fade, capacity, n: 0, dirty: true };
  }

  /** Room for twice as many plants (what's written so far is kept). */
  private grow(b: Batch): void {
    const old = b.mesh;
    const capacity = b.capacity * 2;
    const g = old.geometry;
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    fade.setUsage(THREE.DynamicDrawUsage);
    (fade.array as Float32Array).set(b.fade.array as Float32Array);
    g.setAttribute('aFade', fade);
    const mesh = new THREE.InstancedMesh(g, old.material, capacity);
    (mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = old.castShadow;
    mesh.receiveShadow = old.receiveShadow;
    mesh.userData.noAo = true;
    mesh.name = old.name;
    this.group.remove(old);
    old.dispose();
    this.group.add(mesh);
    b.mesh = mesh;
    b.fade = fade;
    b.capacity = capacity;
    b.dirty = true;
  }

  /** One material per recipe and seed: the wind is the recipe's, the fade each plant's own. */
  private material(s: Shown): THREE.MeshLambertMaterial {
    let m = this.materials.get(s.kind);
    if (!m) {
      m = plantMaterial();
      m.defines = { ...m.defines, CW_INSTANCED: '' };
      setPlantWind(m, s.def);
      this.materials.set(s.kind, m);
    }
    return m;
  }

  private shownIn(batchKey: string): boolean {
    const [kind, , cell] = batchKey.split('|');
    return this.areas.has(`${kind}|${cell}`);
  }

  private dropBatch(k: string): void {
    const b = this.batches.get(k);
    if (!b) return;
    this.group.remove(b.mesh);
    b.mesh.dispose();
    this.batches.delete(k);
  }

  private drop(id: string): void {
    const s = this.shown.get(id);
    if (!s) return;
    if (s.card) (s.card.material as THREE.Material).dispose();
    this.picks.remove(s.holder);
    this.shown.delete(id);
  }

  /** What to pick plants by (each its full-detail mesh, never drawn). */
  get meshes(): THREE.Mesh[] {
    return [...this.shown.values()].map((s) => s.pick);
  }

  /** Draw calls a pass that plants make at most (one per batch with plants in it), for tests. */
  get drawn(): number {
    return [...this.batches.values()].filter((b) => b.mesh.visible).length;
  }

  dispose(): void {
    this.off();
    for (const id of [...this.shown.keys()]) this.drop(id);
    for (const k of [...this.batches.keys()]) this.dropBatch(k);
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}

/** Plants' pick meshes are never drawn; raycasting needs a material all the same. */
const PICK_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
