/**
 * Many copies of one model (A2c): still models that share a file and settings are drawn together, one instanced
 * mesh per part of the model per area, instead of one set of meshes per copy. Areas are skipped as a whole when
 * they're out of view. Models that animate (or have bones) are left to be drawn one by one.
 */
import type { ModelData } from '@cocoaworlds/core';
import * as THREE from 'three';
import { modelInstance, type ModelInstance } from './models';

/** Copies are grouped by area this wide (u), so a group out of view is skipped as a whole. */
const AREA = 1024;
/** Fewer copies than this are not worth batching. */
export const BATCH_MIN = 4;

export interface BatchCopy {
  id: string;
  matrix: THREE.Matrix4;
}

/** What makes copies drawable together: the same file, drawn the same way. */
export const batchKey = (d: ModelData): string => JSON.stringify([d.model, d.units, d.castShadows, d.materials ?? {}]);

/** Copies by area, for culling. */
export function byArea(copies: BatchCopy[]): BatchCopy[][] {
  const areas = new Map<string, BatchCopy[]>();
  const p = new THREE.Vector3();
  for (const c of copies) {
    p.setFromMatrixPosition(c.matrix);
    const k = `${Math.floor(p.x / AREA)},${Math.floor(p.y / AREA)},${Math.floor(p.z / AREA)}`;
    const list = areas.get(k);
    if (list) list.push(c);
    else areas.set(k, [c]);
  }
  return [...areas.values()];
}

export class ModelBatches {
  readonly group = new THREE.Group();
  private kept: ModelInstance[] = [];
  private disposed = false;

  constructor() {
    this.group.name = 'model-batches';
  }

  /**
   * Draw these copies of one model together. Calls `alone` for each copy instead if the model animates or has
   * bones (or can't be loaded as a batch).
   */
  async add(data: ModelData, copies: BatchCopy[], alone: (c: BatchCopy) => void): Promise<void> {
    let inst: ModelInstance;
    try {
      inst = await modelInstance(data);
    } catch {
      for (const c of copies) alone(c);
      return;
    }
    if (this.disposed) return inst.dispose();
    let skinned = false;
    inst.object.traverse((o) => void ((o as THREE.SkinnedMesh).isSkinnedMesh && (skinned = true)));
    if (inst.mixer || skinned) {
      inst.dispose();
      for (const c of copies) alone(c);
      return;
    }
    // (Its materials stay in use until the session ends.)
    this.kept.push(inst);
    inst.object.updateMatrixWorld(true);
    const parts: THREE.Mesh[] = [];
    inst.object.traverse((o) => void ((o as THREE.Mesh).isMesh && parts.push(o as THREE.Mesh)));
    const m = new THREE.Matrix4();
    for (const area of byArea(copies)) {
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, area.length);
        mesh.name = `batch:${data.model}`;
        mesh.castShadow = part.castShadow;
        mesh.receiveShadow = part.receiveShadow;
        area.forEach((c, i) => mesh.setMatrixAt(i, m.multiplyMatrices(c.matrix, part.matrixWorld)));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.userData.copies = area.map((c) => c.id);
        this.group.add(mesh);
      }
    }
  }

  /** How many copies are drawn in batches (for tests and statistics). */
  get copies(): number {
    const ids = new Set<string>();
    this.group.traverse((o) => {
      for (const id of (o.userData.copies as string[] | undefined) ?? []) ids.add(id);
    });
    return ids.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const o of [...this.group.children]) (o as THREE.InstancedMesh).dispose?.();
    this.group.clear();
    for (const i of this.kept) i.dispose();
    this.kept = [];
  }
}
