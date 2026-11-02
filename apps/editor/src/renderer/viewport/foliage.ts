/**
 * Foliage (A2b): grass tufts drawn over the upward-facing surfaces of brushes that have a Foliage component.
 * Only the component is saved; the tufts are placed when the scene is shown or played, and kept until the brush
 * or its settings change. Shared by the editor and play mode.
 */
import { SceneDoc, readComponent, type ScatterData } from '@cocoaworlds/core';
import { TUFT_STRIDE, grassCover, scatterTufts, seededRandom, type Brush, type Tufts } from '@cocoaworlds/geometry';
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
/** How far (u, from the camera to a chunk's edge) each level is drawn; past the last, only the ground cover. */
export const FOLIAGE_LOD_DISTANCES = [320, 960, 2400];
/** Grass is drawn in square chunks this wide, each at its own level (and skipped when out of view). */
const CHUNK = 256;

/**
 * One tuft: a clump of leaf-shaped blades fanning out from the middle and leaning outwards, dark at the root and
 * bright at the tips, wide enough that neighbouring tufts overlap and hide the ground. One unit tall, one wide.
 * Further levels have fewer, wider blades, each a single triangle.
 */
function tuftGeometry(level: number): THREE.BufferGeometry {
  const L = LEVELS[level]!;
  const pos: number[] = [];
  const col: number[] = [];
  const rnd = seededRandom(17);
  for (let i = 0; i < L.blades; i++) {
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // (Replaced by the floor's normal in the shader.)
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/**
 * The grass shades like the floor it grows on: every vertex takes the floor's normal (a per-tuft attribute), so it
 * lights flat with no shading of its own, and it sways in the wind (more towards the tips).
 */
function foliageShader(m: THREE.Material): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = FOLIAGE_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFloor;\nuniform float uTime;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = aFloor;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
        vec2 at = instanceMatrix[3].xz;
        #else
        vec2 at = vec2(0.0);
        #endif
        float sway = position.y * position.y;
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

/** A chunk of one brush's grass: the same tufts at each level, only one shown at a time. */
interface Chunk {
  centre: THREE.Vector3;
  radius: number;
  meshes: THREE.InstancedMesh[];
  count: number;
}

interface Entry {
  key: string;
  chunks: Chunk[];
  cover?: THREE.Mesh;
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

export class FoliageRenderer {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  private geometries = LEVELS.map((_, l) => tuftGeometry(l));
  private materials = new Map<string, THREE.MeshLambertMaterial>();
  private dummy = new THREE.Object3D();

  constructor() {
    this.group.name = 'foliage';
  }

  /** Bring the tufts up to date with the scene (only the brushes that changed are placed again). */
  sync(doc: SceneDoc | null): void {
    const seen = new Set<string>();
    for (const e of doc?.entities ?? []) {
      if (!e.components.scatter || !doc) continue;
      const brush = worldBrushOf(doc, e);
      if (!brush || !isShown(doc, e)) continue;
      seen.add(e.id);
      const sc = readComponent<ScatterData>('scatter', e.components.scatter);
      const key = JSON.stringify([sc, e.components.brush, doc.worldMatrix(e.id)]);
      if (this.entries.get(e.id)?.key === key) continue;
      this.remove(e.id);
      const entry: Entry = { key, chunks: [] };
      this.entries.set(e.id, entry);
      const tufts = scatterTufts(brush.brush, sc);
      if (!tufts.count) continue;
      this.add(e.id, entry, sc, tufts);
      this.addCover(entry, e.id, brush.brush, sc);
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /**
   * Show each chunk at the level its distance calls for (none past the last: the ground cover carries on).
   * In a flat (orthographic) view, the level follows the zoom instead.
   */
  update(cam: THREE.Camera, unitsPerPixel = 1): void {
    const ortho = (cam as THREE.OrthographicCamera).isOrthographicCamera;
    const at = cam.getWorldPosition(new THREE.Vector3());
    for (const e of this.entries.values()) {
      for (const c of e.chunks) {
        let level: number;
        if (ortho) level = unitsPerPixel < 0.6 ? 0 : unitsPerPixel < 2 ? 1 : 2;
        else {
          const d = Math.max(0, at.distanceTo(c.centre) - c.radius);
          level = FOLIAGE_LOD_DISTANCES.findIndex((max) => d < max);
          if (level < 0) level = LEVELS.length;
        }
        c.meshes.forEach((m, l) => (m.visible = l === level));
      }
    }
  }

  private add(id: string, entry: Entry, sc: ScatterData, t: Tufts): void {
    const mat = this.material(sc.colour);
    const tint = new THREE.Color();
    const rnd = seededRandom(Math.round(sc.seed) + 99);
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
      const count = list.length;
      const matrices = new THREE.InstancedBufferAttribute(new Float32Array(count * 16), 16);
      const colours = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      const floor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      list.forEach((i, k) => {
        const o = i * TUFT_STRIDE;
        const yaw = t.data[o + 3]!;
        this.dummy.position.set(t.data[o]!, t.data[o + 1]!, t.data[o + 2]!);
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.setScalar(t.data[o + 4]!);
        this.dummy.updateMatrix();
        this.dummy.matrix.toArray(matrices.array, k * 16);
        // The floor normal in the tuft's own (turned) space, so turning it back gives the floor's.
        const nx = t.data[o + 5]!, ny = t.data[o + 6]!, nz = t.data[o + 7]!;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        floor.setXYZ(k, c * nx - s * nz, ny, s * nx + c * nz);
        // Its patch's hue, a touch lighter or darker per tuft.
        patchTint(t.data[o]!, t.data[o + 2]!, sc.seed, tint).multiplyScalar(0.97 + rnd() * 0.06);
        colours.setXYZ(k, tint.r, tint.g, tint.b);
      });
      const meshes = this.geometries.map((g, l) => {
        const geo = g.clone();
        geo.setAttribute('aFloor', floor);
        const mesh = new THREE.InstancedMesh(geo, mat, count);
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
      entry.chunks.push({ centre: sphere.center.clone(), radius: sphere.radius, meshes, count });
    }
  }

  /** The ground under the grass, painted the colour of its roots. */
  private addCover(entry: Entry, id: string, brush: Brush, sc: ScatterData): void {
    const tri = grassCover(brush, sc.slope);
    if (!tri.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tri, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(sc.colour).multiplyScalar(0.55) });
    const cover = new THREE.Mesh(g, mat);
    cover.name = `foliage-cover:${id}`;
    cover.receiveShadow = true;
    this.group.add(cover);
    entry.cover = cover;
  }

  private remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    for (const c of e.chunks) {
      for (const m of c.meshes) {
        this.group.remove(m);
        m.geometry.dispose();
        m.dispose();
      }
    }
    if (e.cover) {
      this.group.remove(e.cover);
      e.cover.geometry.dispose();
      (e.cover.material as THREE.Material).dispose();
    }
    this.entries.delete(id);
  }

  private material(colour: string): THREE.MeshLambertMaterial {
    let m = this.materials.get(colour);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: colour, vertexColors: true, side: THREE.DoubleSide });
      foliageShader(m);
      this.materials.set(colour, m);
    }
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
    for (const e of this.entries.values()) for (const c of e.chunks) c.meshes.forEach((m, l) => m.visible && (out[l]! += c.count));
    return out;
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
