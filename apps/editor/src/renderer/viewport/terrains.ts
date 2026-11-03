/**
 * Terrains (T1): their voxel grids, loaded from the project (`assets/terrain/<name>.cwvox`, gzip), kept while the
 * project is open, and drawn chunk by chunk with their four layer colours blended by the painted weights.
 * Shared by the editor, Play and exported games.
 */
import { readComponent, type SceneDoc, type TerrainData } from '@cocoaworlds/core';
import { VOXEL_CHUNK, VoxelField, type V3, type VoxelMesh } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { assetUrl } from '../assets';
import { isShown } from '../brush/brushes';
import { sceneMaterial } from './world-render';

// ── The grids ──

const fields = new Map<string, VoxelField>();
const loading = new Map<string, Promise<VoxelField | null>>();
/** Terrains changed since they were last saved (by file). */
export const unsavedTerrains = new Set<string>();
const listeners = new Set<(file: string, chunks: V3[] | null) => void>();

/** A terrain's grid if it's loaded (null while loading or if it can't be read). */
export function terrainField(file: string): VoxelField | null {
  return fields.get(file) ?? null;
}

/** Load a terrain's grid (once). */
export function loadTerrain(file: string): Promise<VoxelField | null> {
  const have = fields.get(file);
  if (have) return Promise.resolve(have);
  let p = loading.get(file);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(await assetUrl(file));
        const raw = new Uint8Array(await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
        const f = VoxelField.fromBytes(raw);
        fields.set(file, f);
        // (Loaded: whatever is built on it, such as its grass, can be now.)
        for (const fn of listeners) fn(file, null);
        return f;
      } catch {
        return null;
      } finally {
        loading.delete(file);
      }
    })();
    loading.set(file, p);
  }
  return p;
}

/** A new terrain's grid (not saved until the scene is). */
export function addTerrainField(file: string, f: VoxelField): void {
  fields.set(file, f);
  unsavedTerrains.add(file);
  changed(file, null);
}

// Chunk meshes, kept until their chunk changes (the game's collisions and the views share them).
const meshCache = new Map<string, Map<string, VoxelMesh>>();

/** A chunk's mesh (worked out once until it changes). */
export function chunkMesh(file: string, f: VoxelField, c: V3): VoxelMesh {
  let byChunk = meshCache.get(file);
  if (!byChunk) meshCache.set(file, (byChunk = new Map()));
  const key = c.join(',');
  let m = byChunk.get(key);
  if (!m) byChunk.set(key, (m = f.meshChunk(c[0], c[1], c[2])));
  return m;
}

/** Every chunk of a terrain, with its mesh (empty ones left out). */
export function terrainChunks(file: string, f: VoxelField): { c: V3; mesh: VoxelMesh }[] {
  const out: { c: V3; mesh: VoxelMesh }[] = [];
  const [cx, cy, cz] = f.chunks;
  for (let z = 0; z < cz; z++)
    for (let y = 0; y < cy; y++)
      for (let x = 0; x < cx; x++) {
        const mesh = chunkMesh(file, f, [x, y, z]);
        if (mesh.indices.length) out.push({ c: [x, y, z], mesh });
      }
  return out;
}

const versions = new Map<string, number>();
/** Goes up each time a terrain changes (so what's built on it knows it's out of date). */
export function terrainVersion(file: string): number {
  return versions.get(file) ?? 0;
}

/** Tell the views a terrain changed (`chunks`: only these; null: all of it). */
export function changed(file: string, chunks: V3[] | null): void {
  unsavedTerrains.add(file);
  versions.set(file, terrainVersion(file) + 1);
  const byChunk = meshCache.get(file);
  if (byChunk) {
    if (chunks) for (const c of chunks) byChunk.delete(c.join(','));
    else meshCache.delete(file);
  }
  for (const fn of listeners) fn(file, chunks);
}

export function onTerrainChange(fn: (file: string, chunks: V3[] | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forget every terrain (another project was opened). */
export function forgetTerrains(): void {
  fields.clear();
  meshCache.clear();
  unsavedTerrains.clear();
}

/** A terrain's file contents: its grid, gzipped. */
export async function packTerrain(f: VoxelField): Promise<Uint8Array> {
  const stream = new Blob([f.toBytes() as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Save every changed terrain into the project. */
export async function saveTerrains(dir: string): Promise<string | null> {
  for (const file of [...unsavedTerrains]) {
    const f = fields.get(file);
    if (!f) continue;
    const name = file.split('/').pop()!;
    const r = await window.cocoa.projects.writeTerrain(dir, name, await packTerrain(f));
    if (!r.ok) return r.error;
    unsavedTerrains.delete(file);
  }
  return null;
}

// ── Drawing ──

const WHITE = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/**
 * The four layers blended by each vertex's weights; lit like any ground. A layer is its colour, or its texture
 * (a project material's picture, or an image) seen from three sides in world space so cliffs don't stretch.
 */
function terrainMaterial(colours: string[], textures: string[], tile: number, onDraw: () => void): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const layers = colours.map((c) => new THREE.Color(c).convertSRGBToLinear());
  const maps = { value: [WHITE, WHITE, WHITE, WHITE] as THREE.Texture[] };
  const has = { value: new THREE.Vector4(0, 0, 0, 0) };
  const sources: THREE.Material[] = [];
  textures.forEach((name, i) => {
    if (!name) return;
    // (The project's own material, as the level uses it; its picture arrives when loaded.)
    const look = (): void => {
      const src = sources[i] as THREE.MeshStandardMaterial | undefined;
      const map = src?.map;
      if (map) {
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.needsUpdate = true;
        maps.value[i] = map;
        has.value.setComponent(i, 1);
        layers[i]!.copy(src.color ?? new THREE.Color(1, 1, 1));
      }
      onDraw();
    };
    sources[i] = sceneMaterial(name, look);
    look();
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLayers = { value: layers };
    sh.uniforms.uMaps = maps;
    sh.uniforms.uHas = has;
    sh.uniforms.uTile = { value: tile };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWeights;\nvarying vec4 vWeights;\nvarying vec3 vCwPos;\nvarying vec3 vCwNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeights = aWeights;\nvCwPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCwNormal = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uLayers[4];
uniform sampler2D uMaps[4];
uniform vec4 uHas;
uniform float uTile;
varying vec4 vWeights;
varying vec3 vCwPos;
varying vec3 vCwNormal;
vec3 cwTri(sampler2D t, vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 cwW = vWeights / max(0.001, vWeights.x + vWeights.y + vWeights.z + vWeights.w);
vec3 cwP = vCwPos / uTile;
vec3 cwN = normalize(vCwNormal);
vec3 cwC = vec3(0.0);
cwC += cwW.x * uLayers[0] * (uHas.x > 0.5 ? cwTri(uMaps[0], cwP, cwN) : vec3(1.0));
cwC += cwW.y * uLayers[1] * (uHas.y > 0.5 ? cwTri(uMaps[1], cwP, cwN) : vec3(1.0));
cwC += cwW.z * uLayers[2] * (uHas.z > 0.5 ? cwTri(uMaps[2], cwP, cwN) : vec3(1.0));
cwC += cwW.w * uLayers[3] * (uHas.w > 0.5 ? cwTri(uMaps[3], cwP, cwN) : vec3(1.0));
diffuseColor.rgb *= cwC;`,
      );
  };
  m.customProgramCacheKey = () => 'cw-terrain-2';
  m.userData.sources = sources;
  return m;
}

function chunkGeometry(m: VoxelMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('aWeights', new THREE.BufferAttribute(m.weights, 4));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

interface Shown {
  file: string;
  holder: THREE.Group;
  material: THREE.MeshStandardMaterial;
  chunks: Map<string, THREE.Mesh>;
  colours: string;
}

/** Draws the scene's terrains; chunks are meshed again only where a terrain changes. */
export class TerrainRenderer {
  readonly group = new THREE.Group();
  private shown = new Map<string, Shown>();
  private off: () => void;

  constructor(private onDraw: () => void = () => {}) {
    this.group.name = 'terrains';
    this.off = onTerrainChange((file, chunks) => {
      for (const s of this.shown.values()) if (s.file === file) this.remesh(s, chunks);
      this.onDraw();
    });
  }

  /** Bring the drawn terrains up to date with the scene (placement, colours; loading any not loaded yet). */
  sync(doc: SceneDoc | null): void {
    const seen = new Set<string>();
    for (const e of doc?.entities ?? []) {
      if (!e.components.terrain || !doc || !isShown(doc, e)) continue;
      const t = readComponent<TerrainData>('terrain', e.components.terrain);
      if (!t.file) continue;
      seen.add(e.id);
      const colours = [t.layer0, t.layer1, t.layer2, t.layer3];
      const textures = [t.texture0, t.texture1, t.texture2, t.texture3].map((x) => x ?? '');
      const look = JSON.stringify([colours, textures, t.tile]);
      let s = this.shown.get(e.id);
      if (s && (s.file !== t.file || s.colours !== look)) {
        this.drop(e.id);
        s = undefined;
      }
      if (!s) {
        const holder = new THREE.Group();
        holder.name = `terrain:${e.id}`;
        holder.userData.terrain = e.id;
        holder.matrixAutoUpdate = false;
        this.group.add(holder);
        s = { file: t.file, holder, material: terrainMaterial(colours, textures, t.tile ?? 128, this.onDraw), chunks: new Map(), colours: look };
        this.shown.set(e.id, s);
        const made = s;
        void loadTerrain(t.file).then((f) => {
          if (f && this.shown.get(e.id) === made) {
            this.remesh(made, null);
            this.onDraw();
          }
        });
      }
      s.holder.matrix.fromArray(doc.worldMatrix(e.id));
      s.holder.matrixWorldNeedsUpdate = true;
    }
    for (const id of [...this.shown.keys()]) if (!seen.has(id)) this.drop(id);
  }

  private remesh(s: Shown, chunks: V3[] | null): void {
    const f = fields.get(s.file);
    if (!f) return;
    const list: V3[] = chunks ?? [];
    if (!chunks) {
      const [cx, cy, cz] = f.chunks;
      for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) list.push([x, y, z]);
    }
    for (const c of list) {
      const key = c.join(',');
      const old = s.chunks.get(key);
      if (old) {
        s.holder.remove(old);
        old.geometry.dispose();
        s.chunks.delete(key);
      }
      const m = chunkMesh(s.file, f, c);
      if (!m.indices.length) continue;
      const mesh = new THREE.Mesh(chunkGeometry(m), s.material);
      mesh.name = `terrain-chunk:${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.terrain = s.holder.userData.terrain;
      s.holder.add(mesh);
      s.chunks.set(key, mesh);
    }
  }

  private drop(id: string): void {
    const s = this.shown.get(id);
    if (!s) return;
    for (const m of s.chunks.values()) m.geometry.dispose();
    for (const src of (s.material.userData.sources as THREE.Material[] | undefined) ?? []) src?.dispose();
    s.material.dispose();
    this.group.remove(s.holder);
    this.shown.delete(id);
  }

  /** The terrain chunk meshes (to pick and to sculpt on). */
  get meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const s of this.shown.values()) out.push(...s.chunks.values());
    return out;
  }

  dispose(): void {
    this.off();
    for (const id of [...this.shown.keys()]) this.drop(id);
  }
}

export { VOXEL_CHUNK };
