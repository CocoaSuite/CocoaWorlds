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
  }
}

function grow(d: PlantDef, seed: number): Builder {
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
      blade(b, root, dir, r(0.05, 1) * d.spread * deg, vary(d.bladeHeight), d.bend * r(0.6, 1.3), (t) => shape(t) * w, tint(c0), tint(c1));
    }
    for (let i = 0; i < d.stalks; i++) {
      const dir = i * 2.39996 + 1.1 + r(-0.4, 0.4);
      const lean = r(0.02, 0.5) * d.spread * deg;
      const len = vary(d.stalkHeight);
      const root = v3(Math.cos(dir), 0, Math.sin(dir)).multiplyScalar(r(0, d.bladeWidth));
      const thick = Math.max(0.6, d.bladeWidth * 0.12);
      blade(b, root, dir, lean, len, d.bend * 0.2, () => thick, tint(c0), tint(c0.clone().lerp(c1, 0.5)), 8);
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
  const H = d.height, top = H * 0.97, sides = 7;
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
      b.idx.push(rings[k]![i]!, rings[k + 1]![j]!, rings[k + 1]![i]!, rings[k]![i]!, rings[k]![j]!, rings[k + 1]![j]!);
    }
  // ...and a crown filling its outline.
  const y0 = H * d.trunkClear, cw = d.crownWidth / 2;
  // Spherized normals: every leaf corner lit as a point on the crown's outline (an ellipsoid round its middle),
  // so the whole crown shades as one soft shape.
  const cy = y0 + (top - y0) * 0.5, ry = Math.max(1, (top - y0) / 2), rx = Math.max(1, cw);
  const sph = (q: THREE.Vector3) => v3(q.x / (rx * rx), (q.y - cy) / (ry * ry), q.z / (rx * rx)).normalize();
  for (let i = 0; i < d.leaves; i++) {
    const t = Math.pow(rnd(), d.crown === 'cone' ? 1.25 : 1);
    const y = y0 + (top - y0) * t;
    const rad = crownRadius(d.crown, t) * cw * (d.foliage === 'lumps' ? r(0.55, 0.95) : Math.sqrt(r(0.15, 1)));
    const a = rnd() * Math.PI * 2;
    const p = v3(Math.cos(a) * rad, y, Math.sin(a) * rad);
    // Lit as part of one soft crown: normals point out from its middle (and a little up).
    const n = sph(p);
    const shade = 0.25 + 0.75 * t;
    const c = tint(c0.clone().lerp(c1, Math.min(1, shade * (0.6 + 0.4 * rnd()))));
    const s = vary(d.leafSize);
    if (d.foliage === 'cards') {
      // A leaf card: a quad facing roughly out, tipped at random.
      const f = n.clone().add(v3(r(-0.6, 0.6), r(-0.4, 0.6), r(-0.6, 0.6))).normalize();
      const u = v3(0, 1, 0).cross(f).normalize();
      if (u.lengthSq() < 0.1) u.set(1, 0, 0);
      const w = f.clone().cross(u).normalize();
      const q = [u.clone().multiplyScalar(-s / 2).addScaledVector(w, -s / 2), u.clone().multiplyScalar(s / 2).addScaledVector(w, -s / 2), u.clone().multiplyScalar(s / 2).addScaledVector(w, s / 2), u.clone().multiplyScalar(-s / 2).addScaledVector(w, s / 2)];
      const ids = q.map((o) => {
        const at = p.clone().add(o);
        return vert(b, at, sph(at), c);
      });
      b.idx.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
    } else {
      // A soft lump: the chosen shape, stretched, its corners jittered, turned at random about the up axis.
      const shape = d.lumpShape ?? 'diamond';
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
        b.idx.push(vert(b, at, sph(at), c));
      }
    }
  }
  return b;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** A plant's mesh (kept: the same recipe and seed give the same one). Its root is at the origin. */
export function plantGeometry(d: PlantDef, seed = d.seed): THREE.BufferGeometry {
  const key = JSON.stringify([d, seed]);
  let g = cache.get(key);
  if (!g) {
    const b = grow(d, seed);
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

/** The material plants are drawn with: their own colours, both sides, lit softly. */
export const PLANT_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

/** Draws the scene's Plant objects (editor and game). */
export class PlantRenderer {
  readonly group = new THREE.Group();
  private shown = new Map<string, { key: string; mesh: THREE.Mesh }>();
  private last: SceneDoc | null = null;
  private off = onPlantsChange(() => this.sync(this.last));

  constructor(private onDraw: () => void = () => {}) {
    this.group.name = 'plants';
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
        if (s) this.group.remove(s.mesh);
        const mesh = new THREE.Mesh(plantGeometry(def, p.seed), PLANT_MATERIAL);
        mesh.name = `plant:${e.id}`;
        mesh.userData.entityId = e.id;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        s = { key, mesh };
        this.shown.set(e.id, s);
      }
      s.mesh.matrix.fromArray(doc.worldMatrix(e.id));
      s.mesh.matrixWorldNeedsUpdate = true;
    }
    for (const [id, s] of [...this.shown]) {
      if (seen.has(id)) continue;
      this.group.remove(s.mesh);
      this.shown.delete(id);
    }
    this.onDraw();
  }

  get meshes(): THREE.Mesh[] {
    return [...this.shown.values()].map((s) => s.mesh);
  }

  dispose(): void {
    this.off();
    this.group.clear();
    this.shown.clear();
  }
}
