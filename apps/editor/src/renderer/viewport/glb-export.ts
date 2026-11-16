/**
 * Selected brushes and groups out to a `.glb` (glTF binary) for other tools (Blender, CocoaSuite apps, other
 * engines), or back into the project as a model. What is written is what the level shows: solid brushes after
 * live subtract (every shown subtract brush still cuts them), tool faces (COL, NOGRASS) and zones (triggers,
 * water, ladders, No Render, subtract volumes) left out. See docs/export.md, "Brushes as a model".
 *
 * The scene graph follows the hierarchy: each group (or brush with things inside it) is a node named after it,
 * each brush a mesh. Nodes carry no transform; the geometry is placed in the file's space directly. With
 * `merge`, everything is one mesh and faces hidden where brushes touch are dropped (as in the level).
 */
import type { EntityData, SceneDoc } from '@cocoaworlds/core';
import { buildMesh, buildWorld, bounds, type Brush, type BrushMesh, type V3, type WorldBrush } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { worldBrushes } from '../brush/brushes';
import { DEV_TEXTURE_SIZE, devMaterial } from '../brush/materials';
import { UNITS_PER_METRE } from './models';

export interface GlbOptions {
  /** Metres (1 m = 39.37 u, as models are imported) or game units as they are. */
  units: 'metres' | 'units';
  /** `selection`: the bottom centre of what is exported is the file's origin. `scene`: keep scene positions. */
  origin: 'selection' | 'scene';
  /** One mesh for everything (hidden faces between brushes dropped) instead of one mesh per brush. */
  merge: boolean;
}

export const DEFAULT_GLB_OPTIONS: GlbOptions = { units: 'metres', origin: 'selection', merge: false };

/** The Three.js material for a face material (and tint). The editor hands in the view's own, already loaded. */
export type MaterialSource = (name: string, tint?: string) => THREE.Material;

let viewMaterials: MaterialSource | null = null;
/** The 3D view registers its materials, so exports look as the view does (null when it goes away). */
export function setExportMaterials(fn: MaterialSource | null): void {
  viewMaterials = fn;
}

/** Faces with these materials are never written: invisible colliders, grass clearers. */
const isToolMaterial = (name: string) => !!devMaterial(name)?.tool;

/** The solid brushes under the given objects (themselves, or anything inside them) that would be written. */
export function exportedBrushIds(doc: SceneDoc, ids: readonly string[]): string[] {
  const under = new Set<string>();
  for (const id of ids) for (const e of doc.get(id) ? doc.subtree(id) : []) under.add(e.id);
  return worldBrushes(doc)
    .filter((b) => b.role === 'solid' && under.has(b.id) && b.brush.faces.some((f) => !isToolMaterial(f.surface.material)))
    .map((b) => b.id);
}

/** A name for the file from the selection: the one object's name, or the scene's. */
export function glbFileName(doc: SceneDoc, ids: readonly string[], fallback: string): string {
  const one = ids.length === 1 ? doc.get(ids[0]!)?.name : undefined;
  const stem = (one || fallback || 'brushes').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120) || 'brushes';
  return `${stem}.glb`;
}

/** Plain stand-in materials (tests, or no 3D view): a colour per material name. */
export const plainMaterials: MaterialSource = (name, tint) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = new THREE.Color().setHSL((h % 360) / 360, 0.25, 0.55);
  if (tint) c.multiply(new THREE.Color(tint));
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  m.name = name;
  return m;
};

/**
 * The Three.js scene to write: groups as nodes, brushes as meshes, in the file's space. Throws when nothing
 * under `ids` can be written.
 */
export function buildExportScene(doc: SceneDoc, ids: readonly string[], opts: GlbOptions, source: MaterialSource = viewMaterials ?? plainMaterials, label: (name: string) => string = (n) => n): THREE.Object3D {
  const chosen = new Set(exportedBrushIds(doc, ids));
  if (!chosen.size) throw new Error('Nothing to export: select brushes, or groups with brushes in them.');
  const all = worldBrushes(doc);
  // Chosen solids, cut by every shown subtract brush (as the level is).
  const job: WorldBrush[] = all.filter((b) => (b.role === 'solid' && chosen.has(b.id)) || b.role === 'subtract');
  const built = buildWorld(job);
  const piecesOf = new Map(built.solids.map((s) => [s.id, s.pieces]));
  const smoothOf = new Map(job.filter((b) => (b.smooth ?? 0) > 0).map((b) => [b.id, b.smooth!]));

  // Where the file's origin is, and how big a unit is.
  const k = opts.units === 'metres' ? 1 / UNITS_PER_METRE : 1;
  let origin: V3 = [0, 0, 0];
  if (opts.origin === 'selection') {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const ps of piecesOf.values()) for (const p of ps) {
      const bb = bounds(p);
      if (!bb) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, bb.min[i]!);
        max[i] = Math.max(max[i]!, bb.max[i]!);
      }
    }
    if (Number.isFinite(min[0])) origin = [(min[0]! + max[0]!) / 2, min[1]!, (min[2]! + max[2]!) / 2];
  }

  // One material per face material and tint, copied so the file gets readable names and no half-loaded maps.
  const mats = new Map<string, THREE.Material>();
  const materialFor = (name: string, tint?: string): THREE.Material => {
    const key = tint ? `${name}\u0000${tint}` : name;
    let m = mats.get(key);
    if (!m) {
      m = exportable(source(name, tint));
      m.name = tint ? `${label(name)} ${tint}` : label(name);
      mats.set(key, m);
    }
    return m;
  };

  const meshOf = (pieces: Brush[], smooth: ((i: number) => { group: string; angle: number } | null) | undefined, name: string): THREE.Mesh | null => {
    if (!pieces.length) return null;
    const m = buildMesh(pieces, { cullTouchingFaces: true, smooth });
    const geo = toExportGeometry(m, origin, k);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo.geometry, geo.groups.map((g) => materialFor(g.material, g.tint)));
    mesh.name = name;
    return mesh;
  };

  const root = new THREE.Group();
  root.name = ids.length === 1 ? (doc.get(ids[0]!)?.name ?? 'brushes') : 'brushes';

  if (opts.merge) {
    const pieces: Brush[] = [];
    const owners: string[] = [];
    for (const s of built.solids) for (const p of s.pieces) {
      pieces.push(p);
      owners.push(s.id);
    }
    const smooth = smoothOf.size ? (i: number) => (smoothOf.has(owners[i]!) ? { group: owners[i]!, angle: smoothOf.get(owners[i]!)! } : null) : undefined;
    const mesh = meshOf(pieces, smooth, root.name);
    if (mesh) root.add(mesh);
  } else {
    // Mirror the hierarchy from the top-most chosen objects down, keeping only what leads to a written brush.
    const roots = ids.filter((id) => doc.get(id) && !ids.some((o) => o !== id && doc.isAncestor(o, id)));
    const nodeOf = (e: EntityData): THREE.Object3D | null => {
      const kids = doc.children(e.id).map(nodeOf).filter((n): n is THREE.Object3D => !!n);
      let self: THREE.Object3D | null = null;
      if (chosen.has(e.id)) {
        const sm = smoothOf.get(e.id);
        self = meshOf(piecesOf.get(e.id) ?? [], sm ? () => ({ group: e.id, angle: sm }) : undefined, e.name);
      }
      if (!kids.length) return self;
      const node = self ?? new THREE.Group();
      node.name = e.name;
      node.add(...kids);
      return node;
    };
    const tops = roots.map((id) => nodeOf(doc.get(id)!)).filter((n): n is THREE.Object3D => !!n);
    // One object selected: it is the file's root.
    if (tops.length === 1) return tops[0]!;
    root.add(...tops);
  }
  if (!root.children.length) throw new Error('Nothing to export: the selected brushes have no visible faces.');
  return root;
}

/** The mesh's triangles without tool faces, moved to the origin and scaled, with texture repeats as UVs. */
function toExportGeometry(m: BrushMesh, origin: V3, k: number): { geometry: THREE.BufferGeometry; groups: { material: string; tint?: string }[] } | null {
  const keep = m.groups.filter((g) => g.count > 0 && !isToolMaterial(g.material));
  if (!keep.length) return null;
  // Only the vertices kept faces use, in a fresh order.
  const remap = new Int32Array(m.positions.length / 3).fill(-1);
  const index: number[] = [];
  let n = 0;
  const groups: { start: number; count: number }[] = [];
  for (const g of keep) {
    const start = index.length;
    for (let i = g.start; i < g.start + g.count; i++) {
      const v = m.indices[i]!;
      if (remap[v] === -1) remap[v] = n++;
      index.push(remap[v]!);
    }
    groups.push({ start, count: index.length - start });
  }
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let v = 0; v < remap.length; v++) {
    const to = remap[v]!;
    if (to < 0) continue;
    for (let a = 0; a < 3; a++) {
      pos[to * 3 + a] = (m.positions[v * 3 + a]! - origin[a]!) * k;
      nor[to * 3 + a] = m.normals[v * 3 + a]!;
    }
    // Texel coordinates → texture repeats (as the view draws them).
    uv[to * 2] = m.uvs[v * 2]! / DEV_TEXTURE_SIZE;
    uv[to * 2 + 1] = m.uvs[v * 2 + 1]! / DEV_TEXTURE_SIZE;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(index), 1) : new THREE.BufferAttribute(new Uint16Array(index), 1));
  groups.forEach((g, i) => geometry.addGroup(g.start, g.count, i));
  return { geometry, groups: keep.map((g) => (g.tint ? { material: g.material, tint: g.tint } : { material: g.material })) };
}

/** A copy of a view material fit for a file: maps that haven't loaded yet are left off, reflections and shader data dropped. */
function exportable(src: THREE.Material): THREE.Material {
  // (The view keeps shader uniforms, textures among them, in userData: a copy would serialise them, and the
  // exporter would write them into the file as extras.)
  const keep = src.userData;
  src.userData = {};
  let m: THREE.Material;
  try {
    m = src.clone();
  } finally {
    src.userData = keep;
  }
  const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'] as const;
  const r = m as unknown as Record<string, unknown>;
  for (const s of slots) {
    const t = r[s] as THREE.Texture | null | undefined;
    if (t && !ready(t)) r[s] = null;
  }
  if ('envMap' in r) r.envMap = null;
  m.onBeforeCompile = () => {};
  return m;
}

const ready = (t: THREE.Texture): boolean => {
  const img = t.image as { width?: number; height?: number } | null | undefined;
  return !!img && (img.width ?? 0) > 0 && (img.height ?? 0) > 0;
};

/** Write the scene as glTF binary. */
export async function toGlb(scene: THREE.Object3D): Promise<Uint8Array> {
  const out = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false });
  if (!(out instanceof ArrayBuffer)) throw new Error('The model could not be written.');
  return new Uint8Array(out);
}

/** The objects under `ids` as a `.glb` file's bytes. */
export async function exportGlb(doc: SceneDoc, ids: readonly string[], opts: GlbOptions, label?: (name: string) => string): Promise<Uint8Array> {
  const scene = buildExportScene(doc, ids, opts, undefined, label);
  try {
    return await toGlb(scene);
  } finally {
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of o.material as THREE.Material[]) m.dispose();
      }
    });
  }
}
