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

/** Tracers and blasts drawn at once at most (the oldest is reused). */
const MAX_TRACERS = 24;
const MAX_BLASTS = 8;

interface Tracer {
  line: THREE.Line;
  pos: THREE.BufferAttribute;
  mat: THREE.LineBasicMaterial;
  age: number;
}

interface Blast {
  ball: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  light: THREE.PointLight | null;
  radius: number;
  age: number;
}

/**
 * Everything is made once and reused, so firing never makes or throws away a material (which would compile a
 * shader, or drop one that the next shot compiles again) and never adds or removes a light (which would compile
 * every lit material again).
 */
export class Effects {
  readonly group = new THREE.Group();
  private projectiles = new Map<number, THREE.Mesh>();
  private seen = new Set<number>();
  private tracers: Tracer[] = [];
  private tracerNext = 0;
  private blasts: Blast[] = [];
  private blastNext = 0;
  private ballGeo = new THREE.SphereGeometry(1, 16, 12);
  private projGeo = new THREE.SphereGeometry(4, 10, 8);
  private projMat = new THREE.MeshStandardMaterial({ color: 0x3d4239, roughness: 0.6, metalness: 0.3 });
  private rocketMat = new THREE.MeshBasicMaterial({ color: 0xffb04a });
  readonly particles = new Particles();
  private decals: THREE.Mesh[] = [];
  private decalGeo = new THREE.PlaneGeometry(1, 1);
  private decalMat = new THREE.MeshBasicMaterial({ map: decalTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  private m4 = new THREE.Matrix4();

  /** `blastLights`: how many blasts can light their surroundings at once (lights always there, dark when unused). */
  constructor(blastLights = 0) {
    this.group.name = 'effects';
    this.group.add(this.particles.group);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const pos = new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', pos);
      const mat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9 });
      const line = new THREE.Line(g, mat);
      // (Its ends change each shot: never culled by a stale bounding sphere.)
      line.frustumCulled = false;
      line.visible = false;
      this.group.add(line);
      this.tracers.push({ line, pos, mat, age: Infinity });
    }
    for (let i = 0; i < MAX_BLASTS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffa340, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
      const ball = new THREE.Mesh(this.ballGeo, mat);
      ball.visible = false;
      this.group.add(ball);
      this.blasts.push({ ball, mat, light: null, radius: 1, age: Infinity });
    }
    for (let i = 0; i < Math.min(blastLights, MAX_BLASTS); i++) {
      const light = new THREE.PointLight(0xffa04a, 0, 1, 1);
      light.name = 'blast-light';
      this.group.add(light);
      this.blasts[i]!.light = light;
    }
  }

  /**
   * A mark on a surface at `at` facing `normal`, `size` across, stuck to `parent` (an object that moves) or the
   * level.
   */
  decal(at: V3, normal: V3, size: number, parent: THREE.Object3D | null): void {
    // (The oldest mark is moved here once there are enough.)
    const m = this.decals.length >= MAX_DECALS ? this.decals.shift()! : new THREE.Mesh(this.decalGeo, this.decalMat);
    m.removeFromParent();
    m.position.set(0, 0, 0);
    m.quaternion.identity();
    m.scale.set(1, 1, 1);
    m.updateMatrix();
    const n = this.n.set(...normal).normalize();
    const p = this.v.set(...at).addScaledVector(n, 0.3);
    m.position.copy(p);
    m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size);
    m.renderOrder = 5;
    if (parent) {
      parent.updateMatrixWorld();
      parent.add(m);
      // (Placed in world space: into the parent's own space.)
      m.applyMatrix4(this.m4.copy(parent.matrixWorld).invert());
    } else this.group.add(m);
    this.decals.push(m);
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
    const t = this.tracers[this.tracerNext]!;
    this.tracerNext = (this.tracerNext + 1) % this.tracers.length;
    const a = t.pos.array as Float32Array;
    if (fromEye && right) a.set([from[0] + right[0] * 6, from[1] - 6, from[2] + right[2] * 6], 0);
    else a.set(from, 0);
    a.set(to, 3);
    t.pos.needsUpdate = true;
    t.age = 0;
    t.mat.opacity = 0.9;
    t.line.visible = true;
  }

  /** A blast: a fireball growing and fading, with a flash of light, then smoke; a scorch on what was hit. */
  explosion(at: V3, radius: number, normal?: V3 | null): void {
    const p = new THREE.Vector3(...at);
    const up = new THREE.Vector3(...(normal ?? [0, 1, 0]));
    this.particles.burst({ kind: 'fire', at: p, dir: up, spread: 90, speed: radius * 1.6, size: radius * 0.35, life: 0.5 }, 24);
    this.particles.burst({ kind: 'smoke', at: p, dir: up, spread: 70, speed: radius * 0.5, size: radius * 0.25, life: 2.5 }, 14);
    this.particles.burst({ kind: 'sparks', at: p, dir: up, spread: 80, speed: radius * 3, size: 3, life: 0.7 }, 20);
    if (normal) this.decal(at, normal, radius * 0.6, null);
    // (A blast that has a light, if one is free; else the next ball.)
    let b = this.blasts.find((x) => x.light && x.age >= BLAST_LIFE);
    if (!b) {
      b = this.blasts[this.blastNext]!;
      this.blastNext = (this.blastNext + 1) % this.blasts.length;
    }
    b.ball.position.set(...at);
    b.light?.position.set(...at);
    b.radius = radius;
    b.age = 0;
    this.showBlast(b, 0);
  }

  private showBlast(b: Blast, k: number): void {
    const on = k < 1;
    b.ball.visible = on;
    b.ball.scale.setScalar(b.radius * (0.25 + 0.5 * Math.sqrt(k)));
    b.mat.opacity = 0.9 * (1 - k);
    if (b.light) {
      b.light.distance = b.radius * 4;
      b.light.intensity = on ? 6 * (1 - k) * (1 - k) : 0;
    }
  }

  /** Where projectiles are now (new ones appear, gone ones vanish). */
  syncProjectiles(list: { id: number; at: V3; arc: boolean }[]): void {
    if (!list.length && !this.projectiles.size) return;
    const seen = this.seen;
    seen.clear();
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
    for (const t of this.tracers) {
      if (t.age >= TRACER_LIFE) continue;
      t.age += dt;
      const k = Math.min(1, t.age / TRACER_LIFE);
      t.mat.opacity = 0.9 * (1 - k);
      if (k >= 1) t.line.visible = false;
    }
    for (const b of this.blasts) {
      if (b.age >= BLAST_LIFE) continue;
      b.age += dt;
      this.showBlast(b, Math.min(1, b.age / BLAST_LIFE));
    }
  }

  dispose(): void {
    this.particles.dispose();
    for (const d of this.decals) d.removeFromParent();
    this.decals = [];
    this.decalGeo.dispose();
    this.decalMat.dispose();
    for (const t of this.tracers) {
      t.line.geometry.dispose();
      t.mat.dispose();
    }
    for (const b of this.blasts) b.mat.dispose();
    this.ballGeo.dispose();
    this.projGeo.dispose();
    this.projMat.dispose();
    this.rocketMat.dispose();
  }
}

const TRACER_LIFE = 0.06;
const BLAST_LIFE = 0.45;
