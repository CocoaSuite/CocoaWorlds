/**
 * Foliage (A2b): grass tufts drawn over the upward-facing surfaces of brushes that have a Foliage component.
 * Only the component is saved; the tufts are placed when the scene is shown or played, and kept until the brush
 * or its settings change. Shared by the editor and play mode.
 */
import { SceneDoc, readComponent, type ScatterData } from '@cocoaworlds/core';
import { scatterTufts, type Tufts } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { isShown, worldBrushOf } from '../brush/brushes';

/** One tuft: three crossed quads, bright at the top, dark at the root. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (ang: number) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const p = (x: number, y: number) => [x * c, y, x * s];
    const tri = [p(-0.5, 0), p(0.5, 0), p(0.12, 1), p(-0.5, 0), p(0.12, 1), p(-0.12, 1)];
    const shade = [0.45, 0.45, 1, 0.45, 1, 1];
    tri.forEach((v, i) => {
      pos.push(v[0]!, v[1]!, v[2]!);
      col.push(shade[i]!, shade[i]!, shade[i]!);
    });
  };
  quad(0);
  quad(Math.PI / 3);
  quad((2 * Math.PI) / 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

interface Entry {
  key: string;
  mesh: THREE.InstancedMesh;
}

export class FoliageRenderer {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  private geometry = tuftGeometry();
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
      if (!doc || !brush || !isShown(doc, e)) continue;
      seen.add(e.id);
      const sc = readComponent<ScatterData>('scatter', e.components.scatter);
      const key = JSON.stringify([sc, e.components.brush, doc.worldMatrix(e.id)]);
      if (this.entries.get(e.id)?.key === key) continue;
      this.remove(e.id);
      const tufts = scatterTufts(brush.brush, sc);
      if (tufts.count) this.add(e.id, key, sc, tufts);
      else this.entries.set(e.id, { key, mesh: null! });
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  private add(id: string, key: string, sc: ScatterData, t: Tufts): void {
    const mat = this.material(sc.colour);
    const mesh = new THREE.InstancedMesh(this.geometry, mat, t.count);
    mesh.name = `foliage:${id}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    for (let i = 0; i < t.count; i++) {
      const o = i * 5;
      this.dummy.position.set(t.data[o]!, t.data[o + 1]!, t.data[o + 2]!);
      this.dummy.rotation.set(0, t.data[o + 3]!, 0);
      this.dummy.scale.setScalar(t.data[o + 4]!);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.entries.set(id, { key, mesh });
  }

  private remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.mesh) {
      this.group.remove(e.mesh);
      e.mesh.dispose();
    }
    this.entries.delete(id);
  }

  private material(colour: string): THREE.MeshLambertMaterial {
    let m = this.materials.get(colour);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: colour, vertexColors: true, side: THREE.DoubleSide });
      this.materials.set(colour, m);
    }
    return m;
  }

  /** How many tufts are placed in all (for the statistics line and tests). */
  get count(): number {
    let n = 0;
    for (const e of this.entries.values()) n += e.mesh?.count ?? 0;
    return n;
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.geometry.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
