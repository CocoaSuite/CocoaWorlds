/**
 * Drawing effects from the VFX workspace: each layer of a playing effect is one instanced quad mesh, one
 * instance per particle (or one for a shape animation). Shapes are drawn from distance functions, so vector
 * shapes stay crisp at any size and have no glow; the soft style blurs their edge; the texture style draws a
 * project image (or a flipbook cut from it). Unlit: colours are shown as picked. Shared by the VFX workspace's
 * preview, Play in the editor and exported games.
 */
import type { VfxEffect, VfxLook } from '@cocoaworlds/core';
import { VfxPlayer, type VfxLayerOut } from '@cocoaworlds/runtime';
import * as THREE from 'three';
import { assetUrl } from '../assets';

// ── The project's effects (set by the editor from the project, by a game from its data) ──

let effects: VfxEffect[] = [];
const listeners = new Set<() => void>();
export function setProjectEffects(list: VfxEffect[]): void {
  effects = list;
  for (const fn of listeners) fn();
}
export function effectById(id: string): VfxEffect | null {
  return effects.find((e) => e.id === id) ?? null;
}
export function onEffectsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Materials ──

const SHAPES = ['circle', 'square', 'diamond', 'triangle', 'star', 'ring', 'line'] as const;
const STYLES = ['vector', 'soft', 'texture'] as const;

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec3 iSrf;
attribute vec4 iCol;
uniform float uFlat;
uniform float uAlign;
uniform float uAspect;
varying vec2 vUv;
varying vec4 vCol;
varying float vFrame;
void main() {
  vUv = position.xy * 2.0;
  vCol = iCol;
  vFrame = iSrf.z;
  float rot = iSrf.y;
  float stretch = 1.0;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  if (uAlign > 0.5) {
    vec4 a = projectionMatrix * mv;
    vec4 b = projectionMatrix * (modelViewMatrix * vec4(iPos + iVel * 0.03, 1.0));
    vec2 d = b.xy / b.w - a.xy / a.w;
    d.x *= uAspect;
    if (length(d) > 1e-5) rot = atan(d.y, d.x);
    stretch = 1.0 + min(length(iVel) * 0.006, 6.0);
  }
  vec2 p = position.xy * vec2(stretch, 1.0) * iSrf.x;
  float c = cos(rot), s = sin(rot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  if (uFlat > 0.5) gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + vec3(p.x, 0.0, p.y), 1.0);
  else {
    mv.xy += p;
    gl_Position = projectionMatrix * mv;
  }
}`;

const FRAG = /* glsl */ `
uniform int uShape;
uniform int uStyle;
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec2 uGrid;
varying vec2 vUv;
varying vec4 vCol;
varying float vFrame;
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdStar(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994, -0.587785252);
  const vec2 k2 = vec2(-0.809016994, -0.587785252);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float shape(vec2 p) {
  if (uShape == 1) return sdBox(p, vec2(0.8));
  if (uShape == 2) return (abs(p.x) + abs(p.y) - 0.9) * 0.7071;
  if (uShape == 3) return sdTri(vec2(p.x, p.y + 0.15), 0.85);
  if (uShape == 4) return sdStar(p, 0.95, 0.45);
  if (uShape == 5) return abs(length(p) - 0.8) - 0.14;
  if (uShape == 6) return length(vec2(max(abs(p.x) - 0.85, 0.0), p.y)) - 0.15;
  return length(p) - 0.9;
}
void main() {
  vec3 rgb = vCol.rgb;
  float a;
  if (uStyle == 2 && uHasMap > 0.5) {
    vec2 tc = vUv * 0.5 + 0.5;
    float f = floor(vFrame + 0.5);
    float col = mod(f, uGrid.x), row = floor(f / uGrid.x);
    tc = vec2((col + tc.x) / uGrid.x, 1.0 - (row + 1.0 - tc.y) / uGrid.y);
    vec4 t = texture2D(uMap, tc);
    rgb *= t.rgb;
    a = t.a;
  } else {
    float d = shape(vUv);
    if (uStyle == 1) a = 1.0 - smoothstep(-0.6, 0.1, d);
    else {
      float w = max(fwidth(d), 1e-4);
      a = 1.0 - smoothstep(-w, w, d);
    }
  }
  a *= vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(rgb, a);
}`;

const loader = new THREE.TextureLoader();
const textures = new Map<string, Promise<THREE.Texture>>();
function texture(path: string): Promise<THREE.Texture> {
  let p = textures.get(path);
  if (!p) {
    p = assetUrl(path).then((url) => loader.loadAsync(url));
    p.catch(() => textures.delete(path));
    textures.set(path, p);
  }
  return p;
}

const materials = new Map<string, THREE.ShaderMaterial>();
const aspectSize = new THREE.Vector2();

/** The material for a layer's look (shared by every layer that looks the same). */
export function vfxMaterial(look: VfxLook, align: boolean): THREE.ShaderMaterial {
  const key = JSON.stringify([look.style, look.shape, look.texture, look.flipbook?.cols, look.flipbook?.rows, look.blend, look.facing, align]);
  let m = materials.get(key);
  if (m) return m;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uShape: { value: Math.max(0, SHAPES.indexOf(look.shape)) },
      uStyle: { value: Math.max(0, STYLES.indexOf(look.style)) },
      uMap: { value: null },
      uHasMap: { value: 0 },
      uGrid: { value: new THREE.Vector2(Math.max(1, look.flipbook?.cols ?? 1), Math.max(1, look.flipbook?.rows ?? 1)) },
      uFlat: { value: look.facing === 'flat' ? 1 : 0 },
      uAlign: { value: align ? 1 : 0 },
      uAspect: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: look.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  if (look.style === 'texture' && look.texture)
    void texture(look.texture)
      .then((t) => {
        mat.uniforms.uMap!.value = t;
        mat.uniforms.uHasMap!.value = 1;
      })
      .catch(() => {});
  materials.set(key, mat);
  return mat;
}

// ── Playing ──

const quad = new THREE.PlaneGeometry(1, 1);

function layerMesh(out: VfxLayerOut): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index!.clone();
  g.setAttribute('position', quad.getAttribute('position').clone());
  const attr = (a: Float32Array, n: number) => new THREE.InstancedBufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', attr(out.pos, 3));
  g.setAttribute('iVel', attr(out.vel, 3));
  g.setAttribute('iSrf', attr(out.srf, 3));
  g.setAttribute('iCol', attr(out.rgba, 4));
  g.instanceCount = 0;
  const l = out.layer;
  const mesh = new THREE.Mesh(g, vfxMaterial(l.look, l.kind === 'emitter' && l.alignToMotion));
  mesh.frustumCulled = false;
  mesh.renderOrder = 21;
  mesh.userData.out = out;
  mesh.userData.look = JSON.stringify([l.look, l.kind === 'emitter' && l.alignToMotion]);
  mesh.onBeforeRender = (r) => {
    r.getDrawingBufferSize(aspectSize);
    (mesh.material as THREE.ShaderMaterial).uniforms.uAspect!.value = aspectSize.x / Math.max(1, aspectSize.y);
  };
  return mesh;
}

export interface VfxPlayOptions {
  /** Where it plays (world), or the object it moves with (and an offset from its pivot). */
  matrix?: THREE.Matrix4;
  follow?: THREE.Object3D | null;
  offset?: [number, number, number];
  /** Play again after each pass. */
  repeat?: boolean;
  seed?: number;
  /** Kept when finished (the editor's preview); otherwise removed. */
  keep?: boolean;
}

export class VfxHandle {
  readonly player: VfxPlayer;
  readonly group = new THREE.Group();
  meshes: THREE.Mesh[] = [];
  private m = new THREE.Matrix4();
  private off = new THREE.Matrix4();

  constructor(
    effect: VfxEffect,
    readonly opts: VfxPlayOptions,
  ) {
    this.player = new VfxPlayer(effect, opts.seed ?? ((Math.random() * 1e9) | 0), !!opts.repeat);
    if (opts.offset) this.off.makeTranslation(...opts.offset);
    this.place();
    this.sync();
  }

  /** Change the effect (an edit in the VFX workspace). */
  setEffect(effect: VfxEffect): void {
    this.player.setEffect(effect);
    this.sync();
  }

  /** Where the effect is now (from what it follows). */
  place(): void {
    const o = this.opts;
    if (o.follow) {
      o.follow.updateWorldMatrix(true, false);
      this.m.multiplyMatrices(o.follow.matrixWorld, this.off);
    } else if (o.matrix) this.m.copy(o.matrix);
    this.player.setOrigin(this.m.elements);
  }

  /** Meshes for the player's layers, and what they draw this frame. */
  sync(): void {
    const layers = this.player.layers;
    for (let i = 0; i < Math.max(layers.length, this.meshes.length); i++) {
      const out = layers[i];
      let mesh = this.meshes[i];
      const look = out && JSON.stringify([out.layer.look, out.layer.kind === 'emitter' && out.layer.alignToMotion]);
      if (mesh && (!out || mesh.userData.out !== out || mesh.userData.look !== look)) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        mesh = undefined;
      }
      if (!out) continue;
      if (!mesh) {
        mesh = layerMesh(out);
        this.group.add(mesh);
      }
      this.meshes[i] = mesh;
      const g = mesh.geometry as THREE.InstancedBufferGeometry;
      g.instanceCount = out.n;
      for (const [name, w] of [['iPos', 3], ['iVel', 3], ['iSrf', 3], ['iCol', 4]] as const) {
        const a = g.getAttribute(name) as THREE.InstancedBufferAttribute;
        a.clearUpdateRanges();
        a.addUpdateRange(0, Math.max(1, out.n) * w);
        a.needsUpdate = true;
      }
    }
    this.meshes.length = layers.length;
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.meshes = [];
    this.group.clear();
  }
}

/** Every effect playing in a world (or the preview). */
export class VfxRenderer {
  readonly group = new THREE.Group();
  private live = new Set<VfxHandle>();

  constructor() {
    this.group.name = 'vfx';
  }

  play(effect: VfxEffect, opts: VfxPlayOptions = {}): VfxHandle {
    const h = new VfxHandle(effect, opts);
    this.live.add(h);
    this.group.add(h.group);
    return h;
  }

  /** Take an effect away at once. */
  remove(h: VfxHandle): void {
    if (!this.live.delete(h)) return;
    this.group.remove(h.group);
    h.dispose();
  }

  /** Step everything by `dt` seconds (finished effects that aren't kept are taken away). */
  update(dt: number): void {
    for (const h of this.live) {
      h.place();
      h.player.step(dt);
      h.sync();
      if (!h.opts.keep && h.player.done) this.remove(h);
    }
  }

  get size(): number {
    return this.live.size;
  }

  clear(): void {
    for (const h of [...this.live]) this.remove(h);
  }
}
