/**
 * Scene reflections: probes that capture the level into cube maps (6 small renders each), blurred by roughness
 * (PMREM) and stored in one atlas (see probe-shader.ts) that shiny and metal project materials reflect.
 *
 * Slot 0 follows the camera (captured again when it has moved a fair way or the level changed, at most twice a
 * second): what's reflected outdoors. Box probes (rooms found from the level, and placed Reflection probes) are
 * captured once each, one a frame, and again when the level changes; surfaces in their boxes reflect them fitted
 * to the box.
 */
import { applyMat4, type SceneDoc } from '@cocoaworlds/core';
import { autoProbes, type Brush } from '@cocoaworlds/geometry';
import { MAX_BOX_PROBES, OCT_GLSL, PROBE_LEVELS, PROBE_SLOTS, PROBE_TILE, PROBES } from './probe-shader';
import * as THREE from 'three';
import { setSceneReflection } from './project-materials';

/** How far (u) the camera may move before the scene is captured again. */
const MOVE = 192;

export interface Probe {
  min: [number, number, number];
  max: [number, number, number];
  at: [number, number, number];
}

/**
 * The probes of a scene: its placed Reflection probes (boxes round them), then, when `auto`, the rooms found from
 * the level's solid pieces (left out where a placed probe already covers the room's middle).
 */
export function sceneProbes(doc: SceneDoc, pieces: Brush[], auto: boolean): Probe[] {
  const placed: Probe[] = [];
  for (const e of doc.entities) {
    const c = e.components.reflectionProbe as { size?: [number, number, number] } | undefined;
    if (!c) continue;
    const p = applyMat4(doc.worldMatrix(e.id), [0, 0, 0]);
    const s = c.size ?? [256, 128, 256];
    placed.push({ min: [p[0] - s[0] / 2, p[1] - s[1] / 2, p[2] - s[2] / 2], max: [p[0] + s[0] / 2, p[1] + s[1] / 2, p[2] + s[2] / 2], at: [p[0], p[1], p[2]] });
  }
  const covered = (b: Probe) => {
    const m = [0, 1, 2].map((k) => (b.min[k]! + b.max[k]!) / 2);
    return placed.some((p) => m.every((v, k) => v >= p.min[k]! && v <= p.max[k]!));
  };
  const found = auto ? (autoProbes(pieces, { max: MAX_BOX_PROBES }) as Probe[]).filter((b) => !covered(b)) : [];
  return [...placed, ...found].slice(0, MAX_BOX_PROBES);
}

/** Writes one probe's blurred cube into its row of the atlas. */
function atlasPass(): { scene: THREE.Scene; cam: THREE.Camera; mat: THREE.ShaderMaterial } {
  const mat = new THREE.ShaderMaterial({
    uniforms: { env: { value: null }, slot: { value: 0 }, maxLod: { value: 5 } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform samplerCube env;
      uniform float slot;
      uniform float maxLod;
      ${OCT_GLSL}
      void main() {
        vec2 f = floor(gl_FragCoord.xy);
        float level = floor(f.x / ${PROBE_TILE.toFixed(1)});
        vec2 ij = vec2(mod(f.x, ${PROBE_TILE.toFixed(1)}), f.y - slot * ${PROBE_TILE.toFixed(1)});
        vec3 d = cwOctDir(ij / ${(PROBE_TILE - 1).toFixed(1)});
        float r = level / ${(PROBE_LEVELS - 1).toFixed(1)};
        gl_FragColor = vec4(textureLod(env, d, maxLod * r * (2.0 - r)).rgb, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, cam: new THREE.Camera(), mat };
}

export class SceneReflections {
  private cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  private cam = new THREE.CubeCamera(1, 40000, this.cube);
  private pmrem: THREE.PMREMGenerator;
  private env: THREE.WebGLCubeRenderTarget | null = null;
  private atlas = new THREE.WebGLRenderTarget(PROBE_LEVELS * PROBE_TILE, PROBE_SLOTS * PROBE_TILE, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  private pass = atlasPass();
  private at = new THREE.Vector3(Infinity, Infinity, Infinity);
  private last = 0;
  private on = false;
  private probes: Probe[] = [];
  private probesKey = '';
  /** Box probes still to capture (indices into `probes`). */
  private queue: number[] = [];
  /** Set when the level changed: capture again at the next chance. */
  dirty = true;

  constructor(private r: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(r);
  }

  /** The box probes (at most 15 are used); captured again only when they changed. */
  setProbes(list: Probe[]): void {
    const probes = list.slice(0, MAX_BOX_PROBES);
    const key = JSON.stringify(probes);
    if (key === this.probesKey) return;
    this.probesKey = key;
    this.probes = probes;
    probes.forEach((p, i) => {
      PROBES.cwProbeMin.value[i]!.set(...p.min);
      PROBES.cwProbeMax.value[i]!.set(...p.max);
      PROBES.cwProbeAt.value[i]!.set(...p.at);
    });
    // (Shown once captured.)
    PROBES.cwProbeCount.value = 0;
    this.queue = probes.map((_, i) => i);
  }

  /** Captures still to do (render again soon). */
  get busy(): boolean {
    return this.on && this.queue.length > 0;
  }

  get boxes(): readonly Probe[] {
    return this.probes;
  }

  /** Capture if due (camera at `eye`); `helpers` are editor aids left out of the picture. */
  update(scene: THREE.Scene, eye: THREE.Vector3, enabled: boolean, helpers: THREE.Object3D[] = []): void {
    if (!enabled) {
      if (this.on) {
        this.on = false;
        PROBES.cwProbeOn.value = 0;
        setSceneReflection(null);
      }
      return;
    }
    if (this.dirty) this.queue = this.probes.map((_, i) => i);
    const now = performance.now();
    const outdoor = !this.on || this.dirty || this.at.distanceTo(eye) >= MOVE;
    if (outdoor && now - this.last >= 500) {
      this.last = now;
      this.dirty = false;
      this.at.copy(eye);
      this.capture(scene, eye, 0, helpers);
      if (!this.on) {
        this.on = true;
        PROBES.cwProbeAtlas.value = this.atlas.texture;
        PROBES.cwProbeOn.value = 1;
        // (The materials need an environment map to reflect at all: the camera's capture.)
        setSceneReflection(this.env!.texture);
      }
      return;
    }
    // One room a frame.
    const i = this.queue.shift();
    if (i === undefined || !this.on) return;
    const p = this.probes[i]!;
    this.capture(scene, new THREE.Vector3(...p.at), i + 1, helpers);
    if (!this.queue.length) PROBES.cwProbeCount.value = this.probes.length;
  }

  private capture(scene: THREE.Scene, from: THREE.Vector3, slot: number, helpers: THREE.Object3D[]): void {
    const r = this.r;
    // (No editor aids, no second shadow pass.)
    const aids: THREE.Object3D[] = [...helpers.filter((h) => h.visible)];
    scene.traverseVisible((o) => {
      if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Object3D & { isTransformControlsRoot?: boolean }).isTransformControlsRoot) aids.push(o);
    });
    for (const o of aids) o.visible = false;
    // (Glass is left out of the capture: it would draw the scene behind it again for each of the six views.)
    const glass = new Set<THREE.Material>();
    scene.traverseVisible((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) if ((x as THREE.MeshPhysicalMaterial).transmission > 0 && x.visible) glass.add(x);
    });
    for (const m of glass) m.visible = false;
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    this.cam.position.copy(from);
    this.cam.updateMatrixWorld(true);
    this.cam.update(r, scene);
    r.shadowMap.autoUpdate = auto;
    for (const o of aids) o.visible = true;
    for (const m of glass) m.visible = true;
    this.env = this.pmrem.fromCubemap(this.cube.texture, this.env ?? undefined);
    // Into the atlas row.
    const prev = r.getRenderTarget();
    const u = this.pass.mat.uniforms;
    u.env!.value = this.env.texture;
    u.slot!.value = slot;
    u.maxLod!.value = Math.max(0, this.env.texture.mipmaps.length - 1);
    this.atlas.viewport.set(0, slot * PROBE_TILE, PROBE_LEVELS * PROBE_TILE, PROBE_TILE);
    this.atlas.scissor.copy(this.atlas.viewport);
    this.atlas.scissorTest = true;
    r.setRenderTarget(this.atlas);
    r.render(this.pass.scene, this.pass.cam);
    r.setRenderTarget(prev);
  }

  dispose(): void {
    if (this.on) {
      PROBES.cwProbeOn.value = 0;
      setSceneReflection(null);
    }
    this.env?.dispose();
    this.cube.dispose();
    this.pmrem.dispose();
    this.atlas.dispose();
    this.pass.mat.dispose();
  }
}
