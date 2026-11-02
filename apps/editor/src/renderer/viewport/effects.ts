/**
 * What weapons look like while playing: bullet tracers, flying projectiles and blasts (a flash of light and a
 * fireball). Shared by Play in the editor and exported games; it only draws what the game world announces.
 */
import * as THREE from 'three';

type V3 = [number, number, number];

interface Fading {
  obj: THREE.Object3D;
  age: number;
  life: number;
  update(k: number): void;
}

export class Effects {
  readonly group = new THREE.Group();
  private fading: Fading[] = [];
  private projectiles = new Map<number, THREE.Mesh>();
  private tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9 });
  private ballGeo = new THREE.SphereGeometry(1, 16, 12);
  private projGeo = new THREE.SphereGeometry(4, 10, 8);
  private projMat = new THREE.MeshStandardMaterial({ color: 0x3d4239, roughness: 0.6, metalness: 0.3 });
  private rocketMat = new THREE.MeshBasicMaterial({ color: 0xffb04a });

  constructor() {
    this.group.name = 'effects';
  }

  /** A bullet's path: a bright line that lasts a moment, starting a little below and right of the eye. */
  tracer(from: V3, to: V3, fromEye: boolean, right: V3 | null): void {
    const start = fromEye && right ? new THREE.Vector3(from[0] + right[0] * 6, from[1] - 6, from[2] + right[2] * 6) : new THREE.Vector3(...from);
    const g = new THREE.BufferGeometry().setFromPoints([start, new THREE.Vector3(...to)]);
    const line = new THREE.Line(g, this.tracerMat.clone());
    this.add(line, 0.06, (k) => ((line.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - k)));
  }

  /** A blast: a fireball growing and fading, with a flash of light. */
  explosion(at: V3, radius: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa340, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const ball = new THREE.Mesh(this.ballGeo, mat);
    ball.position.set(...at);
    const light = new THREE.PointLight(0xffa04a, 6, radius * 4, 1);
    ball.add(light);
    this.add(ball, 0.45, (k) => {
      ball.scale.setScalar(radius * (0.25 + 0.5 * Math.sqrt(k)));
      mat.opacity = 0.9 * (1 - k);
      light.intensity = 6 * (1 - k) * (1 - k);
    });
  }

  /** Where projectiles are now (new ones appear, gone ones vanish). */
  syncProjectiles(list: { id: number; at: V3; arc: boolean }[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let m = this.projectiles.get(p.id);
      if (!m) {
        m = new THREE.Mesh(this.projGeo, p.arc ? this.projMat : this.rocketMat);
        this.projectiles.set(p.id, m);
        this.group.add(m);
      }
      m.position.set(...p.at);
    }
    for (const [id, m] of this.projectiles) {
      if (seen.has(id)) continue;
      this.group.remove(m);
      this.projectiles.delete(id);
    }
  }

  /** Age everything by `dt` seconds. */
  tick(dt: number): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i]!;
      f.age += dt;
      const k = Math.min(1, f.age / f.life);
      f.update(k);
      if (k >= 1) {
        this.group.remove(f.obj);
        dispose(f.obj);
        this.fading.splice(i, 1);
      }
    }
  }

  private add(obj: THREE.Object3D, life: number, update: (k: number) => void): void {
    update(0);
    this.group.add(obj);
    this.fading.push({ obj, age: 0, life, update });
  }

  dispose(): void {
    for (const f of this.fading) dispose(f.obj);
    this.fading = [];
    this.ballGeo.dispose();
    this.projGeo.dispose();
    this.projMat.dispose();
    this.rocketMat.dispose();
    this.tracerMat.dispose();
  }
}

function dispose(o: THREE.Object3D): void {
  o.traverse((x) => {
    if (x instanceof THREE.Line) x.geometry.dispose();
    const m = (x as THREE.Mesh).material as THREE.Material | undefined;
    m?.dispose?.();
  });
}
