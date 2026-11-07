/**
 * Base building, drawn: every build site's boxes (built parts solid, what's still to build as a flat ghost) and
 * the ghost a plan in hand would place. Boxes are kept by key and moved in place, so pouring or a door swinging
 * makes nothing new.
 */
import * as THREE from 'three';
import type { BaseSystem, DrawnPart } from '@cocoaworlds/runtime';

const unit = new THREE.BoxGeometry(1, 1, 1);

export class BaseView {
  readonly group = new THREE.Group();
  private boxes = new Map<string, THREE.Mesh>();
  private solids = new Map<string, THREE.Material>();
  private ghosts = new Map<string, THREE.Material>();
  private version = -1;

  constructor(private material: (name: string) => THREE.Material) {
    this.group.name = 'base';
  }

  private materialOf(p: DrawnPart): THREE.Material {
    if (p.ghost) {
      let m = this.ghosts.get(p.color);
      if (!m) {
        // Flat and see-through: no lighting, no glow.
        m = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.28, depthWrite: false });
        this.ghosts.set(p.color, m);
      }
      return m;
    }
    if (p.material) return this.material(p.material);
    let m = this.solids.get(p.color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9, metalness: 0 });
      this.solids.set(p.color, m);
    }
    return m;
  }

  /** Bring the boxes up to date with the base (cheap when nothing changed). */
  sync(base: BaseSystem): void {
    if (base.version === this.version) return;
    this.version = base.version;
    const seen = new Set<string>();
    for (const p of base.parts()) {
      const key = `${p.key}${p.ghost ? '~' : ''}`;
      seen.add(key);
      let mesh = this.boxes.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(unit, this.materialOf(p));
        mesh.castShadow = mesh.receiveShadow = !p.ghost;
        mesh.renderOrder = p.ghost ? 2 : 0;
        this.boxes.set(key, mesh);
        this.group.add(mesh);
      }
      mesh.material = this.materialOf(p);
      mesh.position.set(...p.center);
      mesh.rotation.set(0, p.yaw, 0);
      mesh.scale.set(...p.size);
    }
    for (const [key, mesh] of this.boxes)
      if (!seen.has(key)) {
        mesh.removeFromParent();
        this.boxes.delete(key);
      }
  }

  dispose(): void {
    for (const m of [...this.solids.values(), ...this.ghosts.values()]) m.dispose();
    this.group.removeFromParent();
  }
}
