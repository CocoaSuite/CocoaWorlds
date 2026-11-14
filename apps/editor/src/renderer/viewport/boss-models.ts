/**
 * Bosses, drawn: each a figure of pixel blocks (16 to a mine block), jointed at hips, shoulders and neck, moved in
 * code. Their weapons glow while an attack winds up: gold for one that can be parried, red for one that can't.
 */
import * as THREE from 'three';
import type { Boss } from '@cocoaworlds/runtime';

type Kind = 'lit' | 'glow' | 'eye';
/** [group, w, h, d, x, y, z (centre, in the group), colour, kind]. */
type Part = [string, number, number, number, number, number, number, number, string, Kind?];
/** Joints: name → [parent, x, y, z]. */
type Joints = Record<string, [string, number, number, number]>;

const PARRY = new THREE.Color(0xffd84a), HEAVY = new THREE.Color(0xff3020);

const texCache = new Map<string, THREE.DataTexture>();

/** A colour as a small noisy pixel tile. */
function tile(colour: string, w: number, h: number): THREE.DataTexture {
  const tw = Math.max(2, Math.min(16, Math.round(w))), th = Math.max(2, Math.min(16, Math.round(h))), key = `${colour}:${tw}:${th}`;
  let t = texCache.get(key);
  if (t) return t;
  const c = new THREE.Color(colour), data = new Uint8Array(tw * th * 4);
  let s = tw * 31 + th * 17 + Math.round(c.r * 255);
  for (let i = 0; i < tw * th; i++) {
    s = (s * 16807) % 2147483647;
    const k = 0.88 + ((s % 1000) / 1000) * 0.2;
    data.set([Math.min(255, c.r * 255 * k), Math.min(255, c.g * 255 * k), Math.min(255, c.b * 255 * k), 255], i * 4);
  }
  t = new THREE.DataTexture(data, tw, th, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

/** `h`: height in pixels (it's scaled to the boss's height). */
const MODELS: Record<string, { h: number; joints: Joints; parts: Part[]; spider?: boolean }> = {
  foreman: {
    h: 40,
    joints: { legL: ['root', -4, 14, 0], legR: ['root', 4, 14, 0], body: ['root', 0, 14, 0], head: ['body', 0, 14, 0], armL: ['body', -11.5, 13, 0], armR: ['body', 11.5, 13, 0], tool: ['armR', 0, -14, 0] },
    parts: [
      ['legL', 6, 14, 6, 0, -7, 0, 0, '#3b3a46'], ['legL', 7, 3, 8, 0, -12.5, -1, 0, '#2a201a'],
      ['legR', 6, 14, 6, 0, -7, 0, 0, '#3b3a46'], ['legR', 7, 3, 8, 0, -12.5, -1, 0, '#2a201a'],
      ['body', 18, 14, 11, 0, 7, 0, 0, '#8a5a33'], ['body', 19, 2, 12, 0, 2, 0, 0, '#2a1d14'], ['body', 3, 2, 1, 0, 2, -6.2, 0, '#d0b060'],
      ['head', 11, 10, 10, 0, 5, 0, 0, '#d9a37a'], ['head', 8, 2, 1, 0, 3, -5.2, 0, '#3a2a1c'], ['head', 2, 1, 1, -2.5, 6, -5.1, 0, '#1a1a1a'], ['head', 2, 1, 1, 2.5, 6, -5.1, 0, '#1a1a1a'],
      ['head', 13, 4, 12, 0, 11, 0, 0, '#e8b21e'], ['head', 15, 1, 14, 0, 8.6, 0, 0, '#c99410'], ['head', 4, 3, 2, 0, 10.5, -6.6, 0, '#fff2a8', 'eye'],
      ['armL', 5, 13, 5, 0, -6, 0, 0, '#8a5a33'], ['armL', 5, 4, 5, 0, -14, 0, 0, '#d9a37a'],
      ['armR', 5, 13, 5, 0, -6, 0, 0, '#8a5a33'], ['armR', 5, 4, 5, 0, -14, 0, 0, '#d9a37a'],
      ['tool', 2, 24, 2, 0, -8, 0, 0, '#6b4a2a'], ['tool', 4, 4, 18, 0, -20, 0, 0, '#9aa0a8', 'glow'],
    ],
  },
  forge_king: {
    h: 47,
    joints: { legL: ['root', -6, 10, 0], legR: ['root', 6, 10, 0], body: ['root', 0, 10, 0], head: ['body', 0, 18, 0], armL: ['body', -16.5, 16, 0], armR: ['body', 16.5, 16, 0], tool: ['armR', 0, -17, 0] },
    parts: [
      ['legL', 8, 10, 8, 0, -5, 0, 0, '#4a3326'], ['legL', 9, 3, 10, 0, -8.5, -1, 0, '#2a1a10'],
      ['legR', 8, 10, 8, 0, -5, 0, 0, '#4a3326'], ['legR', 9, 3, 10, 0, -8.5, -1, 0, '#2a1a10'],
      ['body', 26, 18, 16, 0, 9, 0, 0, '#7a2b1e'], ['body', 27, 2, 17, 0, 1, 0, 0, '#f2c14e'], ['body', 27, 2, 17, 0, 17, 0, 0, '#c99410'],
      ['body', 16, 14, 3, 0, 12, -9, 0, '#e07a2a'], ['body', 10, 6, 3, 0, 3, -9, 0, '#c8621e'],
      ['head', 14, 12, 12, 0, 6, 0, 0, '#d8a07a'], ['head', 12, 2, 1, 0, 9, -6.2, 0, '#e07a2a'], ['head', 3, 2, 1, -3, 7, -6.2, 0, '#ff8a2a', 'eye'], ['head', 3, 2, 1, 3, 7, -6.2, 0, '#ff8a2a', 'eye'],
      ['head', 15, 3, 13, 0, 13, 0, 0, '#f2c14e'], ['head', 3, 4, 3, -5, 16.5, -5, 0, '#f2c14e'], ['head', 3, 4, 3, 5, 16.5, -5, 0, '#f2c14e'], ['head', 3, 5, 3, 0, 17, -5, 0, '#f2c14e'], ['head', 3, 4, 3, -5, 16.5, 5, 0, '#f2c14e'], ['head', 3, 4, 3, 5, 16.5, 5, 0, '#f2c14e'],
      ['armL', 7, 16, 7, 0, -7, 0, 0, '#7a2b1e'], ['armL', 7, 6, 7, 0, -17, 0, 0, '#d8a07a'],
      ['armR', 7, 16, 7, 0, -7, 0, 0, '#7a2b1e'], ['armR', 7, 6, 7, 0, -17, 0, 0, '#d8a07a'],
      ['tool', 3, 28, 3, 0, -10, 0, 0, '#5a3a24'], ['tool', 16, 11, 11, 0, -26, 0, 0, '#3c3c44', 'glow'],
    ],
  },
  crystal_golem: {
    h: 50,
    joints: { legL: ['root', -10, 18, 0], legR: ['root', 10, 18, 0], body: ['root', 0, 18, 0], head: ['body', 0, 20, -6], armL: ['body', -23.5, 20, 0], armR: ['body', 23.5, 20, 0] },
    parts: [
      ['legL', 12, 18, 12, 0, -9, 0, 0, '#59657a'], ['legR', 12, 18, 12, 0, -9, 0, 0, '#59657a'],
      ['body', 36, 22, 22, 0, 12, 0, 0, '#6f7d92'], ['body', 8, 8, 2, 0, 13, -11.5, 0, '#8fe3ff', 'eye'],
      ['body', 5, 14, 5, -12, 27, 2, 0.3, '#8fe3ff', 'eye'], ['body', 5, 14, 5, 12, 27, 2, -0.3, '#8fe3ff', 'eye'], ['body', 4, 10, 4, -5, 26, 6, -0.2, '#bff0ff', 'eye'], ['body', 4, 11, 4, 5, 26, 7, 0.2, '#bff0ff', 'eye'], ['body', 5, 12, 5, 0, 26, 9, 0, '#8fe3ff', 'eye'],
      ['head', 14, 11, 12, 0, 4, -4, 0, '#59657a'], ['head', 3, 2, 1, -3.5, 4.5, -10.2, 0, '#8fe3ff', 'eye'], ['head', 3, 2, 1, 3.5, 4.5, -10.2, 0, '#8fe3ff', 'eye'],
      ['armL', 11, 24, 11, 0, -10, 0, 0, '#6f7d92'], ['armL', 15, 12, 15, 0, -26, 0, 0, '#59657a', 'glow'],
      ['armR', 11, 24, 11, 0, -10, 0, 0, '#6f7d92'], ['armR', 15, 12, 15, 0, -26, 0, 0, '#59657a', 'glow'],
    ],
  },
  broodmother: {
    h: 31,
    spider: true,
    joints: { body: ['root', 0, 14, 0], head: ['body', 0, 0, -16], armL: ['head', -3, -3, -6], armR: ['head', 3, -3, -6] },
    parts: [
      ['body', 22, 12, 20, 0, 0, -4, 0, '#5e4c6c'], ['body', 30, 22, 32, 0, 6, 22, 0, '#4a3a58'], ['body', 6, 1, 10, 0, 17.2, 22, 0, '#c0302a', 'eye'],
      ['head', 14, 10, 10, 0, 0, -3, 0, '#5e4c6c'],
      ['head', 2, 2, 1, -2, 2, -8.2, 0, '#ff3a3a', 'eye'], ['head', 2, 2, 1, 2, 2, -8.2, 0, '#ff3a3a', 'eye'], ['head', 2, 2, 1, -5, 3, -8.2, 0, '#ff3a3a', 'eye'], ['head', 2, 2, 1, 5, 3, -8.2, 0, '#ff3a3a', 'eye'], ['head', 1, 1, 1, -3.5, 0, -8.2, 0, '#ff3a3a', 'eye'], ['head', 1, 1, 1, 3.5, 0, -8.2, 0, '#ff3a3a', 'eye'],
      ['armL', 2, 7, 2, 0, -3.5, 0, 0, '#e8e0d0', 'glow'], ['armR', 2, 7, 2, 0, -3.5, 0, 0, '#e8e0d0', 'glow'],
    ],
  },
};

export class BossModel {
  readonly root = new THREE.Group();
  private joints = new Map<string, THREE.Group>();
  private lit: THREE.MeshBasicMaterial[] = [];
  private glow: { m: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];
  private eyes: THREE.MeshBasicMaterial[] = [];
  private legs: { g: THREE.Group; s: number; i: number }[] = [];
  private spider: boolean;
  private walk = 0;
  private last = new THREE.Vector3();

  constructor(
    readonly boss: Boss,
    B: number,
  ) {
    const def = MODELS[boss.def.id] ?? MODELS.foreman!;
    this.spider = !!def.spider;
    this.joints.set('root', this.root);
    const inner = new THREE.Group();
    this.root.add(inner);
    this.joints.set('root', inner);
    for (const [name, [parent, x, y, z]] of Object.entries(def.joints)) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      this.joints.get(parent)!.add(g);
      this.joints.set(name, g);
    }
    if (this.spider)
      for (let i = 0; i < 4; i++)
        for (const s of [-1, 1]) {
          const g = new THREE.Group(), knee = new THREE.Group();
          g.position.set(s * 10, 0, -12 + i * 6);
          g.rotation.z = s * 0.45;
          knee.position.set(s * 18, 0, 0);
          knee.rotation.z = -s * 0.7;
          g.add(knee);
          this.joints.get('body')!.add(g);
          this.part(g, 18, 3, 3, s * 9, 0, 0, 0, '#4a3a58', 'lit');
          this.part(knee, 3, 24, 3, 0, -11, 0, 0, '#5e4c6c', 'lit');
          this.legs.push({ g, s, i });
        }
    const tool = this.joints.get('tool');
    if (tool) tool.rotation.x = 1.4;
    for (const [j, w, h, d, x, y, z, rz, colour, kind] of def.parts) this.part(this.joints.get(j)!, w, h, d, x, y, z, rz, colour, kind ?? 'lit');
    inner.scale.setScalar((boss.h * B) / def.h);
    this.root.traverse((o) => (o.userData.noAo = true));
  }

  private part(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, rz: number, colour: string, kind: Kind): void {
    const m = new THREE.MeshBasicMaterial({ map: tile(colour, Math.max(w, d), h) });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    parent.add(mesh);
    if (kind === 'eye') this.eyes.push(m);
    else if (kind === 'glow') this.glow.push({ m, base: new THREE.Color(1, 1, 1) });
    else this.lit.push(m);
  }

  private j(name: string): THREE.Group {
    return this.joints.get(name) ?? this.root;
  }

  /** Pose for this moment. `light`: how lit it is where it stands (0…1). */
  animate(world: [number, number, number], time: number, dt: number, light: number): void {
    const b = this.boss, st = b.state, c = b.charge(time), ease = c * c * (3 - 2 * c);
    this.root.position.set(...world);
    this.root.rotation.y = b.yaw;
    const moved = this.last.distanceTo(this.root.position) / Math.max(dt, 1e-3);
    this.last.copy(this.root.position);
    this.walk += dt * Math.min(12, moved / 8);
    const sw = Math.sin(this.walk) * Math.min(1, moved / 60);
    const body = this.j('body'), head = this.j('head'), aL = this.j('armL'), aR = this.j('armR'), lL = this.j('legL'), lR = this.j('legR');
    body.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    aL.rotation.set(0, 0, 0);
    aR.rotation.set(0, 0, 0);
    lL.rotation.set(sw * 0.6, 0, 0);
    lR.rotation.set(-sw * 0.6, 0, 0);
    if (!this.spider) {
      aL.rotation.x = -sw * 0.4;
      aR.rotation.x = sw * 0.4 + 0.2;
    }
    const inner = this.j('root');
    inner.rotation.set(0, 0, 0);
    inner.position.y = 0;
    const a = b.attack;
    if (st === 'sleep') {
      body.rotation.x = 0.35;
      head.rotation.x = 0.3;
    } else if (st === 'windup') {
      if (a === 'swing') aR.rotation.x = ease * 2.8;
      else if (a === 'slam') {
        aL.rotation.x = aR.rotation.x = ease * 2.9;
        body.rotation.x = -ease * 0.2;
      } else if (a === 'charge') {
        body.rotation.x = ease * 0.35;
        inner.position.y = -ease * 2;
      } else if (a === 'volley') {
        aR.rotation.x = ease * 1.5;
        head.rotation.x = -ease * 0.3;
      } else {
        aL.rotation.z = -ease * 1.3;
        aR.rotation.z = ease * 1.3;
        head.rotation.x = -ease * 0.4;
      }
    } else if (st === 'strike') {
      if (a === 'swing') aR.rotation.x = 0.9;
      else if (a === 'slam') {
        aL.rotation.x = aR.rotation.x = 0.6;
        body.rotation.x = 0.35;
      } else if (a === 'charge') body.rotation.x = 0.35;
      else if (a === 'volley') aR.rotation.x = 1.6;
    } else if (st === 'stagger') {
      body.rotation.x = -0.35 + Math.sin(time * 14) * 0.05;
      head.rotation.z = Math.sin(time * 9) * 0.25;
      aL.rotation.z = -0.6;
      aR.rotation.z = 0.6;
    } else if (st === 'dead') {
      const k = Math.min(1, (time - b.diedAt) * 1.5);
      inner.rotation.z = k * (Math.PI / 2);
      inner.position.y = -k * 4;
    }
    // (The spider: legs step in turn; the front pair rears up for an attack.)
    for (const l of this.legs) {
      const phase = Math.sin(this.walk * 1.5 + l.i * 1.6 + (l.s > 0 ? Math.PI : 0)) * Math.min(1, moved / 60);
      l.g.rotation.y = phase * 0.35;
      let up = 0.45 + Math.max(0, phase) * 0.2;
      if (l.i === 0 && (st === 'windup' || st === 'strike')) up += st === 'windup' ? ease * 0.9 : -0.2;
      if (st === 'stagger') up += Math.sin(time * 16 + l.i) * 0.15;
      if (st === 'dead') up = -0.2;
      l.g.rotation.z = l.s * up;
    }
    if (this.spider && st === 'windup') body.rotation.x = -ease * 0.25;
    // Light: rock-lit like the blocks; a hit flashes; the weapon glows through the windup.
    const flash = time - b.hitAt < 0.1 ? 1.8 : 0, k = Math.max(0.35, light) + flash;
    for (const m of this.lit) m.color.setScalar(k);
    const tele = a === 'slam' ? HEAVY : PARRY, hot = st === 'windup' ? 0.25 + ease * 0.75 : st === 'strike' ? 0.7 : 0;
    for (const g of this.glow) g.m.color.setScalar(k).lerp(tele, hot).multiplyScalar(1 + hot);
    const eye = st === 'dead' ? 0.15 : st === 'sleep' ? 0.35 : 1;
    for (const m of this.eyes) m.color.setScalar(eye);
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }
}
