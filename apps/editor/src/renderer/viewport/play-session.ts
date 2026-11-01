/**
 * Play mode inside the editor (decision D7): a game world built from a snapshot of the scene, drawn with
 * its own meshes. The editor's scene is never touched; stopping throws all of this away.
 *
 * Until the player arrives (Phase 6) Play is a physics preview watched with the free camera.
 */
import { SceneDoc, readComponent, type ColliderData, type SceneFile } from '@cocoaworlds/core';
import { buildMesh, type WorldBrush } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, type TriggerEvent } from '@cocoaworlds/runtime';
import * as THREE from 'three';
import { worldBrushOf, worldBrushes } from '../brush/brushes';
import { buildLevel } from './world-build';
import { toGeometry } from './world-render';

export interface PlayInfo {
  moving: number;
  triggers: number;
  names: Map<string, string>;
}

export class PlaySession {
  readonly group = new THREE.Group();
  private world: GameWorld;
  /** Objects drawn where their body is: base placement, then the body's motion on top. */
  private movers: { id: string; obj: THREE.Object3D; base: THREE.Matrix4 }[] = [];
  readonly info: PlayInfo;
  private shapeMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.8 });

  static async start(scene: SceneFile, material: (name: string) => THREE.Material): Promise<PlaySession> {
    await initPhysics();
    return new PlaySession(scene, material);
  }

  private constructor(scene: SceneFile, material: (name: string) => THREE.Material) {
    this.group.name = 'play';
    this.world = GameWorld.create(scene);
    const doc = new SceneDoc(structuredClone(scene));
    const bodies = new Set(this.world.movingBodies().map((b) => b.id));
    const fixedBodies = new Set(doc.entities.filter((e) => e.components.rigidBody && !bodies.has(e.id)).map((e) => e.id));

    // The level as players see it: no trigger zones, no subtract volumes, no moving brushes.
    const all = worldBrushes(doc);
    const still: WorldBrush[] = all.filter((b) => b.role !== 'trigger' && !bodies.has(b.id));
    const level = buildLevel({ seq: 0, brushes: still });
    if (level.mesh) {
      const m = level.mesh;
      this.group.add(new THREE.Mesh(toGeometry(m), m.groups.map((g) => material(g.material))));
    }

    for (const id of [...bodies, ...fixedBodies]) {
      const e = doc.get(id);
      if (!e) continue;
      let obj: THREE.Object3D;
      let base = new THREE.Matrix4();
      const wb = worldBrushOf(doc, e);
      if (wb) {
        if (!bodies.has(id)) continue; // fixed brush bodies are already in the level mesh
        const m = buildMesh([wb.brush]);
        obj = new THREE.Mesh(toGeometry(m), m.groups.map((g) => material(g.material)));
      } else {
        // A point object with a collision shape: draw the shape, placed like the entity (scale in the shape).
        const c = readComponent<ColliderData>('collider', e.components.collider);
        const geo =
          c.shape === 'sphere'
            ? new THREE.SphereGeometry(c.size[0] / 2, 24, 16)
            : c.shape === 'capsule'
              ? new THREE.CapsuleGeometry(c.size[0] / 2, Math.max(0, c.size[1] - c.size[0]), 6, 16)
              : new THREE.BoxGeometry(...c.size);
        geo.translate(...c.offset);
        obj = new THREE.Mesh(geo, this.shapeMat);
        base = new THREE.Matrix4().fromArray(doc.worldMatrix(id));
      }
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(base);
      this.group.add(obj);
      if (bodies.has(id)) this.movers.push({ id, obj, base });
    }
    this.info = {
      moving: bodies.size,
      triggers: this.world.stats.triggers,
      names: new Map(doc.entities.map((e) => [e.id, e.name])),
    };
  }

  /** Advance the game and move what moved. Returns trigger events from this frame. */
  tick(dt: number): TriggerEvent[] {
    this.world.step(dt);
    const motion = new THREE.Matrix4();
    for (const m of this.movers) {
      const mm = this.world.motionOf(m.id);
      if (!mm) continue;
      m.obj.matrix.copy(motion.fromArray(mm).multiply(m.base));
      m.obj.matrixWorldNeedsUpdate = true;
    }
    return this.world.drainEvents();
  }

  get time(): number {
    return this.world.time;
  }

  dispose(): void {
    this.world.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.shapeMat.dispose();
  }
}
