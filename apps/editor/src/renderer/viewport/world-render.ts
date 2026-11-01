/**
 * Draws level brushes: solids (after live subtract) as one lit mesh per material, subtract brushes as orange
 * see-through volumes, and outlines for selected brushes. Rebuilt whenever brushes change.
 */
import { buildMesh, buildWorld, edges, type Brush, type BrushMesh, type WorldBrush } from '@cocoaworlds/geometry';
import * as THREE from 'three';

const TEX_SIZE = 256;

/** The built-in "dev/grid" texture: light grey with a line every 16 units and a stronger edge every 64 (at 0.25 u/texel). */
function devGridTexture(base: string, minor: string, major: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = TEX_SIZE;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  g.fillStyle = minor;
  for (let i = 0; i < TEX_SIZE; i += 64) {
    g.fillRect(i, 0, 2, TEX_SIZE);
    g.fillRect(0, i, TEX_SIZE, 2);
  }
  g.fillStyle = major;
  g.fillRect(0, 0, 4, TEX_SIZE);
  g.fillRect(0, 0, TEX_SIZE, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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
    this.group.add(this.subtractGroup, this.outlineGroup);
    this.outlineGroup.renderOrder = 10;
  }

  private material(name: string): THREE.Material {
    let m = this.materials.get(name);
    if (m) return m;
    if (name === 'dev/grid') {
      const tex = devGridTexture('#a3a3a3', '#8c8c8c', '#7a7a7a');
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
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
    for (const s of world.solids) for (const p of s.pieces) {
      pieces.push(p);
      owners.push(s.id);
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

  /** Nearest brush under the ray (solids and subtract volumes). */
  pick(ray: THREE.Raycaster): WorldPick | null {
    let best: WorldPick | null = null;
    if (this.solidMesh) {
      const hit = ray.intersectObject(this.solidMesh, false)[0];
      if (hit && hit.faceIndex != null) {
        const id = this.triangleOwner[hit.faceIndex];
        if (id) best = { entityId: id, point: hit.point, normal: hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0), distance: hit.distance };
      }
    }
    for (const o of this.subtractGroup.children) {
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
    if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) c.geometry.dispose();
  }
}
