/**
 * Particles (A1): soft round sprites that fly, fall or rise, grow and fade. One pool for glowing ones (fire,
 * sparks: added to what is behind) and one for the rest (smoke, steam, dust). Emitters (the Particles
 * component) and weapon effects (sparks, dust, fireballs) both put particles in.
 */
import * as THREE from 'three';

export type ParticleKind = 'smoke' | 'fire' | 'sparks' | 'steam' | 'dust';

/** How each kind looks and moves. */
interface Look {
  glow: boolean;
  color: [THREE.Color, THREE.Color];
  /** Pulled down (units/s², negative rises). */
  gravity: number;
  /** Speed lost each second (0–1). */
  drag: number;
  /** Size at the end, as a multiple of the start. */
  grow: number;
  alpha: number;
}

const LOOKS: Record<ParticleKind, Look> = {
  smoke: { glow: false, color: [new THREE.Color('#6b6b6b'), new THREE.Color('#2e2e2e')], gravity: -30, drag: 0.6, grow: 3, alpha: 0.55 },
  fire: { glow: true, color: [new THREE.Color('#ffd27a'), new THREE.Color('#d6401a')], gravity: -120, drag: 1.2, grow: 0.4, alpha: 0.9 },
  sparks: { glow: true, color: [new THREE.Color('#fff2b8'), new THREE.Color('#ff8a2a')], gravity: 600, drag: 0.4, grow: 0.5, alpha: 1 },
  steam: { glow: false, color: [new THREE.Color('#f2f4f6'), new THREE.Color('#c8ccd0')], gravity: -60, drag: 1, grow: 4, alpha: 0.4 },
  dust: { glow: false, color: [new THREE.Color('#a0968a'), new THREE.Color('#7c746a')], gravity: 40, drag: 2.5, grow: 2.5, alpha: 0.5 },
};

export interface Burst {
  kind: ParticleKind;
  at: THREE.Vector3;
  /** The main direction (unit vector), the spread around it (degrees) and the speed. */
  dir: THREE.Vector3;
  spread: number;
  speed: number;
  size: number;
  life: number;
  /** A colour that replaces the kind's own (null: the kind's). */
  tint?: THREE.Color | null;
}

const VERT = `
attribute float alpha;
attribute float size;
attribute vec3 tint;
uniform float scale;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vTint, vAlpha * (1.0 - d) * (1.0 - d));
}`;

class Pool {
  readonly points: THREE.Points;
  private n = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size0: Float32Array;
  private kind: Uint8Array;
  private colA: Float32Array;
  private colB: Float32Array;
  private alpha: Float32Array;
  private size: Float32Array;
  private tint: Float32Array;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;

  constructor(
    private max: number,
    glow: boolean,
  ) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.colA = new Float32Array(max * 3);
    this.colB = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.tint = new Float32Array(max * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.attrs = ['position', 'alpha', 'size', 'tint'].map((name) => this.geo.getAttribute(name) as THREE.BufferAttribute);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { scale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    const size = new THREE.Vector2();
    this.points.onBeforeRender = (r, _s, cam) => {
      r.getDrawingBufferSize(size);
      this.mat.uniforms.scale!.value = (size.y * (cam as THREE.PerspectiveCamera).projectionMatrix.elements[5]!) / 2;
    };
  }

  add(b: Burst, kindIndex: number, look: Look): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    // A direction within `spread` of `dir`.
    const d = b.dir.clone();
    if (b.spread > 0) {
      const a = THREE.MathUtils.degToRad(b.spread) * Math.sqrt(Math.random());
      const side = new THREE.Vector3(1, 0, 0);
      if (Math.abs(d.x) > 0.9) side.set(0, 1, 0);
      const u = side.cross(d).normalize();
      const v = d.clone().cross(u);
      const t = Math.random() * Math.PI * 2;
      d.multiplyScalar(Math.cos(a)).addScaledVector(u, Math.sin(a) * Math.cos(t)).addScaledVector(v, Math.sin(a) * Math.sin(t));
    }
    const speed = b.speed * (0.6 + Math.random() * 0.6);
    this.pos.set([b.at.x, b.at.y, b.at.z], i * 3);
    this.vel.set([d.x * speed, d.y * speed, d.z * speed], i * 3);
    this.age[i] = 0;
    this.life[i] = b.life * (0.7 + Math.random() * 0.6);
    this.size0[i] = b.size * (0.7 + Math.random() * 0.6);
    this.kind[i] = kindIndex;
    const [c0, c1] = b.tint ? [b.tint, b.tint.clone().multiplyScalar(0.6)] : look.color;
    this.colA.set([c0.r, c0.g, c0.b], i * 3);
    this.colB.set([c1.r, c1.g, c1.b], i * 3);
  }

  step(dt: number, looks: Look[]): void {
    let i = 0;
    while (i < this.n) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) {
        this.swap(i, --this.n);
        continue;
      }
      const look = looks[this.kind[i]!]!;
      const k = this.age[i]! / this.life[i]!;
      const drag = Math.max(0, 1 - look.drag * dt);
      const o = i * 3;
      this.vel[o]! *= drag;
      this.vel[o + 1] = this.vel[o + 1]! * drag - look.gravity * dt;
      this.vel[o + 2]! *= drag;
      this.pos[o]! += this.vel[o]! * dt;
      this.pos[o + 1]! += this.vel[o + 1]! * dt;
      this.pos[o + 2]! += this.vel[o + 2]! * dt;
      // Fades in quickly, out slowly; grows or shrinks; colour moves from the first to the second.
      this.alpha[i] = look.alpha * Math.min(1, k * 8) * (1 - k);
      this.size[i] = this.size0[i]! * (1 + (look.grow - 1) * k);
      for (let c = 0; c < 3; c++) this.tint[o + c] = this.colA[o + c]! + (this.colB[o + c]! - this.colA[o + c]!) * k;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    // (Only the live part goes up to the graphics card, and nothing at all while there are none.)
    if (!this.n && !this.shown) return;
    this.shown = this.n;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (this.n) a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = this.n > 0;
    }
  }

  /** Particles uploaded last step. */
  private shown = 0;
  private attrs: THREE.BufferAttribute[] = [];

  get count(): number {
    return this.n;
  }

  private swap(a: number, b: number): void {
    if (a === b) return;
    const copy = (arr: Float32Array | Uint8Array, w: number) => {
      for (let c = 0; c < w; c++) arr[a * w + c] = arr[b * w + c]!;
    };
    copy(this.pos, 3);
    copy(this.vel, 3);
    copy(this.age, 1);
    copy(this.life, 1);
    copy(this.size0, 1);
    copy(this.kind, 1);
    copy(this.colA, 3);
    copy(this.colB, 3);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const KINDS: ParticleKind[] = ['smoke', 'fire', 'sparks', 'steam', 'dust'];

export class Particles {
  readonly group = new THREE.Group();
  private glow = new Pool(4000, true);
  private soft = new Pool(4000, false);
  private looks = KINDS.map((k) => LOOKS[k]);

  constructor() {
    this.group.name = 'particles';
    this.group.add(this.soft.points, this.glow.points);
  }

  burst(b: Burst, count: number): void {
    const look = LOOKS[b.kind];
    const pool = look.glow ? this.glow : this.soft;
    for (let i = 0; i < count; i++) pool.add(b, KINDS.indexOf(b.kind), look);
  }

  step(dt: number): void {
    this.glow.step(dt, this.looks);
    this.soft.step(dt, this.looks);
  }

  get count(): number {
    return this.glow.count + this.soft.count;
  }

  dispose(): void {
    this.glow.dispose();
    this.soft.dispose();
  }
}

/** Defaults for an emitter of each kind (speed u/s, size u, life s). */
export const EMITTER_DEFAULTS: Record<ParticleKind, { speed: number; size: number; life: number; spread: number }> = {
  smoke: { speed: 40, size: 24, life: 4, spread: 15 },
  fire: { speed: 30, size: 20, life: 0.8, spread: 20 },
  sparks: { speed: 220, size: 3, life: 0.8, spread: 40 },
  steam: { speed: 120, size: 12, life: 1.5, spread: 8 },
  dust: { speed: 20, size: 16, life: 3, spread: 90 },
};
