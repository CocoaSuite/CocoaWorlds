/**
 * What weapons look like while playing: bullet tracers, flying projectiles, blasts (a flash of light, a
 * fireball, smoke), bullet holes and scorch marks stuck to what was hit, sparks and dust. Shared by Play in
 * the editor and exported games; it only draws what the game world announces.
 */
import * as THREE from 'three';
import { Particles } from './particles';

/** Most marks kept at once (the oldest go first). */
const MAX_DECALS = 160;

let decalTex: THREE.Texture | null = null;
/** A soft dark round mark with a darker middle (a bullet hole; scaled up, a scorch). */
function decalTexture(): THREE.Texture {
  if (decalTex) return decalTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(10,10,10,1)');
  grad.addColorStop(0.25, 'rgba(20,18,16,0.95)');
  grad.addColorStop(0.55, 'rgba(30,26,22,0.45)');
  grad.addColorStop(1, 'rgba(30,26,22,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  decalTex = new THREE.CanvasTexture(c);
  decalTex.colorSpace = THREE.SRGBColorSpace;
  return decalTex;
}

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
  readonly particles = new Particles();
  private decals: THREE.Mesh[] = [];
  private decalGeo = new THREE.PlaneGeometry(1, 1);
  private decalMat = new THREE.MeshBasicMaterial({ map: decalTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

  constructor() {
    this.group.name = 'effects';
    this.group.add(this.particles.group);
  }

  /**
   * A mark on a surface at `at` facing `normal`, `size` across, stuck to `parent` (an object that moves) or the
   * level.
   */
  decal(at: V3, normal: V3, size: number, parent: THREE.Object3D | null): void {
    const m = new THREE.Mesh(this.decalGeo, this.decalMat);
    const n = new THREE.Vector3(...normal).normalize();
    const p = new THREE.Vector3(...at).addScaledVector(n, 0.3);
    m.position.copy(p);
    m.lookAt(p.clone().add(n));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size);
    m.renderOrder = 5;
    if (parent) {
      parent.updateMatrixWorld();
      parent.add(m);
      // (Placed in world space: into the parent's own space.)
      m.applyMatrix4(parent.matrixWorld.clone().invert());
    } else this.group.add(m);
    this.decals.push(m);
    if (this.decals.length > MAX_DECALS) this.decals.shift()!.removeFromParent();
  }

  /** A bullet or a swing hitting a surface: a mark, sparks and a puff of dust. */
  impact(at: V3, normal: V3, melee: boolean, parent: THREE.Object3D | null): void {
    this.decal(at, normal, melee ? 6 : 4, parent);
    const p = new THREE.Vector3(...at), n = new THREE.Vector3(...normal);
    this.particles.burst({ kind: 'sparks', at: p, dir: n, spread: 60, speed: 260, size: 2.5, life: 0.35 }, melee ? 3 : 6);
    this.particles.burst({ kind: 'dust', at: p, dir: n, spread: 30, speed: 50, size: 6, life: 0.8 }, 3);
  }

  /** A bullet's path: a bright line that lasts a moment, starting a little below and right of the eye. */
  tracer(from: V3, to: V3, fromEye: boolean, right: V3 | null): void {
    const start = fromEye && right ? new THREE.Vector3(from[0] + right[0] * 6, from[1] - 6, from[2] + right[2] * 6) : new THREE.Vector3(...from);
    const g = new THREE.BufferGeometry().setFromPoints([start, new THREE.Vector3(...to)]);
    const line = new THREE.Line(g, this.tracerMat.clone());
    this.add(line, 0.06, (k) => ((line.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - k)));
  }

  /** A blast: a fireball growing and fading, with a flash of light, then smoke; a scorch on what was hit. */
  explosion(at: V3, radius: number, normal?: V3 | null): void {
    const p = new THREE.Vector3(...at);
    const up = new THREE.Vector3(...(normal ?? [0, 1, 0]));
    this.particles.burst({ kind: 'fire', at: p, dir: up, spread: 90, speed: radius * 1.6, size: radius * 0.35, life: 0.5 }, 24);
    this.particles.burst({ kind: 'smoke', at: p, dir: up, spread: 70, speed: radius * 0.5, size: radius * 0.25, life: 2.5 }, 14);
    this.particles.burst({ kind: 'sparks', at: p, dir: up, spread: 80, speed: radius * 3, size: 3, life: 0.7 }, 20);
    if (normal) this.decal(at, normal, radius * 0.6, null);
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
    this.particles.step(dt);
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
    this.particles.dispose();
    for (const d of this.decals) d.removeFromParent();
    this.decals = [];
    this.decalGeo.dispose();
    this.decalMat.dispose();
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
