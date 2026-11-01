/**
 * Draws level brushes: solids (after live subtract) as one lit mesh per material, subtract brushes as orange
 * see-through volumes, and outlines for selected brushes. Rebuilt whenever brushes change.
 */
import { buildMesh, buildWorld, edges, polygons, samePlane, type Brush, type BrushMesh, type WorldBrush } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { DEV_TEXTURE_SIZE, devMaterial, paintDevTexture } from '../brush/materials';

const TEX_SIZE = DEV_TEXTURE_SIZE;

function devTexture(base: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = TEX_SIZE;
  paintDevTexture(c.getContext('2d')!, base, TEX_SIZE);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A selected face: the brush entity and the index of the face in its saved face list. */
export interface FaceRef {
  id: string;
  face: number;
}

function hashColor(name: string): THREE.Color {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.25, 0.55);
}

export interface WorldPick {
  entityId: string;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

export class WorldRenderer {
  readonly group = new THREE.Group();
  private solidMesh: THREE.Mesh | null = null;
  private triangleOwner: string[] = [];
  private subtractGroup = new THREE.Group();
  private outlineGroup = new THREE.Group();
  private faceGroup = new THREE.Group();
  private faceFillMat = new THREE.MeshBasicMaterial({ color: 0x4b9cff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private faceEdgeMat = new THREE.LineBasicMaterial({ color: 0x4b9cff, transparent: true, opacity: 1, depthTest: false });
  /** Rendered pieces (after live subtract) of each solid, for highlighting faces as they are seen. */
  private piecesById = new Map<string, Brush[]>();
  private faceRefs: FaceRef[] = [];
  private materials = new Map<string, THREE.Material>();
  private subtractMat = new THREE.MeshBasicMaterial({ color: 0xf0a442, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  private subtractEdgeMat = new THREE.LineBasicMaterial({ color: 0xf0a442, transparent: true, opacity: 0.9 });
  private selectedEdgeMat = new THREE.LineBasicMaterial({ color: 0x4b9cff, transparent: true, opacity: 0.95 });
  private selectedHiddenMat = new THREE.LineBasicMaterial({ color: 0x4b9cff, transparent: true, opacity: 0.3, depthTest: false });
  private brushes: WorldBrush[] = [];
  private brushById = new Map<string, WorldBrush>();
  /** Statistics from the last rebuild. */
  stats = { solids: 0, pieces: 0, subtracts: 0, droppedSlivers: 0 };

  constructor() {
    this.group.name = 'world';
    this.group.add(this.subtractGroup, this.outlineGroup, this.faceGroup);
    this.outlineGroup.renderOrder = 10;
    this.faceGroup.renderOrder = 12;
  }

  private material(name: string): THREE.Material {
    let m = this.materials.get(name);
    if (m) return m;
    const dev = devMaterial(name);
    if (dev) {
      m = new THREE.MeshStandardMaterial({ map: devTexture(dev.base), roughness: 0.9, metalness: 0 });
    } else {
      m = new THREE.MeshStandardMaterial({ color: hashColor(name), roughness: 0.9 });
    }
    this.materials.set(name, m);
    return m;
  }

  rebuild(brushes: WorldBrush[]): void {
    this.brushes = brushes;
    this.brushById = new Map(brushes.map((b) => [b.id, b]));
    const world = buildWorld(brushes);
    const pieces: Brush[] = [];
    const owners: string[] = [];
    this.piecesById = new Map();
    for (const s of world.solids) {
      this.piecesById.set(s.id, s.pieces);
      for (const p of s.pieces) {
        pieces.push(p);
        owners.push(s.id);
      }
    }
    this.stats = {
      solids: world.solids.length,
      pieces: pieces.length,
      subtracts: brushes.filter((b) => b.role === 'subtract').length,
      droppedSlivers: world.droppedSlivers,
    };

    if (this.solidMesh) {
      this.group.remove(this.solidMesh);
      this.solidMesh.geometry.dispose();
      this.solidMesh = null;
    }
    if (pieces.length) {
      const m = buildMesh(pieces, { cullTouchingFaces: true });
      this.solidMesh = new THREE.Mesh(toGeometry(m), m.groups.map((g) => this.material(g.material)));
      this.solidMesh.name = 'world-solids';
      this.solidMesh.castShadow = this.solidMesh.receiveShadow = false;
      this.group.add(this.solidMesh);
      this.triangleOwner = Array.from(m.triangleBrushes, (bi) => owners[bi]!);
    } else {
      this.triangleOwner = [];
    }

    clear(this.subtractGroup);
    for (const b of brushes) {
      if (b.role !== 'subtract') continue;
      const m = buildMesh([b.brush]);
      const mesh = new THREE.Mesh(toGeometry(m), this.subtractMat);
      mesh.userData.entityId = b.id;
      this.subtractGroup.add(mesh, edgeLines(b.brush, this.subtractEdgeMat));
    }
    this.setFaceSelection(this.faceRefs);
  }

  /** Highlight faces: the parts of each face that are actually visible (a cut wall shows its doorway). */
  setFaceSelection(refs: FaceRef[]): void {
    this.faceRefs = refs;
    clear(this.faceGroup);
    for (const r of refs) {
      const wb = this.brushById.get(r.id);
      const face = wb?.brush.faces[r.face];
      if (!wb || !face) continue;
      const sources = wb.role === 'solid' ? (this.piecesById.get(r.id) ?? [wb.brush]) : [wb.brush];
      for (const piece of sources) {
        for (const poly of polygons(piece)) {
          if (!samePlane(poly.plane, face.plane)) continue;
          const pts = poly.points;
          const pos = new Float32Array(pts.length * 3);
          pts.forEach((p, i) => pos.set(p, i * 3));
          const idx: number[] = [];
          for (let i = 1; i + 1 < pts.length; i++) idx.push(0, i, i + 1);
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          g.setIndex(idx);
          const fill = new THREE.Mesh(g, this.faceFillMat);
          fill.renderOrder = 12;
          const lg = new THREE.BufferGeometry();
          lg.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
          const line = new THREE.LineLoop(lg, this.faceEdgeMat);
          line.renderOrder = 13;
          this.faceGroup.add(fill, line);
        }
      }
    }
  }

  setSelection(ids: string[]): void {
    clear(this.outlineGroup);
    for (const id of ids) {
      const b = this.brushById.get(id);
      if (!b) continue;
      // Draw selected outlines twice: bright where visible, faint through walls.
      this.outlineGroup.add(edgeLines(b.brush, this.selectedHiddenMat), edgeLines(b.brush, this.selectedEdgeMat, true));
    }
  }

  /** Nearest brush under the ray (solids and, unless `solidsOnly`, subtract volumes). */
  pick(ray: THREE.Raycaster, solidsOnly = false): WorldPick | null {
    let best: WorldPick | null = null;
    if (this.solidMesh) {
      const hit = ray.intersectObject(this.solidMesh, false)[0];
      if (hit && hit.faceIndex != null) {
        const id = this.triangleOwner[hit.faceIndex];
        if (id) best = { entityId: id, point: hit.point, normal: hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0), distance: hit.distance };
      }
    }
    if (!solidsOnly) for (const o of this.subtractGroup.children) {
      if (!(o instanceof THREE.Mesh)) continue;
      const hit = ray.intersectObject(o, false)[0];
      if (hit && (!best || hit.distance < best.distance)) {
        best = { entityId: o.userData.entityId as string, point: hit.point, normal: hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0), distance: hit.distance };
      }
    }
    return best;
  }

  brush(id: string): WorldBrush | undefined {
    return this.brushById.get(id);
  }

  get all(): WorldBrush[] {
    return this.brushes;
  }

  dispose(): void {
    this.solidMesh?.geometry.dispose();
    clear(this.subtractGroup);
    clear(this.outlineGroup);
    clear(this.faceGroup);
    for (const m of this.materials.values()) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
  }
}

export function toGeometry(m: BrushMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  // Texel coordinates → texture repeats.
  const uv = new Float32Array(m.uvs.length);
  for (let i = 0; i < uv.length; i++) uv[i] = m.uvs[i]! / TEX_SIZE;
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  m.groups.forEach((gr, i) => g.addGroup(gr.start, gr.count, i));
  g.computeBoundingSphere();
  return g;
}

export function edgeLines(b: Brush, mat: THREE.LineBasicMaterial, onTop = false): THREE.LineSegments {
  const { verts, edges: es } = edges(b);
  const pos = new Float32Array(es.length * 6);
  es.forEach(([a, c], i) => {
    pos.set(verts[a]!, i * 6);
    pos.set(verts[c]!, i * 6 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(g, mat);
  if (onTop) l.renderOrder = 11;
  return l;
}

function clear(g: THREE.Group): void {
  for (const c of [...g.children]) {
    g.remove(c);
    if (c instanceof THREE.Mesh || c instanceof THREE.Line) c.geometry.dispose();
  }
}
