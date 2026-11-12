/**
 * Scene reflections: probes that capture the level into cube maps (6 small renders each), blurred by roughness
 * (PMREM) and stored in one atlas (see probe-shader.ts) that shiny and metal project materials reflect.
 *
 * Slot 0 follows the camera (captured again when it has moved a fair way or the level changed, at most twice a
 * second): what's reflected outdoors. Box probes (rooms found from the level, and placed Reflection probes) are
 * captured once each, one after another, and again when the level changes; surfaces in their boxes reflect them
 * fitted to the box. A capture is spread over four frames (two views a frame, then the blur), so none stutters.
 */
import { applyMat4, type SceneDoc } from '@cocoaworlds/core';
import { autoProbes, type Brush } from '@cocoaworlds/geometry';
import { MAX_BOX_PROBES, OCT_GLSL, PROBE_LEVELS, PROBE_SLOTS, PROBE_TILE, PROBES } from './probe-shader';
import * as THREE from 'three';
import { setSceneReflection } from './project-materials';

/** How far (u) the camera may move before the scene is captured again. */
const MOVE = 192;

/** How much of a capture made because the light changed goes into what the probe held (the rest eases in later). */
const SOFT = 0.5;

/** Views of a capture drawn a frame (six make a capture; the blur is the frame after the last). */
const FACES_PER_FRAME = 2;

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
    uniforms: { env: { value: null }, slot: { value: 0 }, maxLod: { value: 5 }, share: { value: 1 } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform samplerCube env;
      uniform float slot;
      uniform float maxLod;
      uniform float share;
      ${OCT_GLSL}
      void main() {
        vec2 f = floor(gl_FragCoord.xy);
        float level = floor(f.x / ${PROBE_TILE.toFixed(1)});
        vec2 ij = vec2(mod(f.x, ${PROBE_TILE.toFixed(1)}), f.y - slot * ${PROBE_TILE.toFixed(1)});
        vec3 d = cwOctDir(ij / ${(PROBE_TILE - 1).toFixed(1)});
        float r = level / ${(PROBE_LEVELS - 1).toFixed(1)};
        gl_FragColor = vec4(textureLod(env, d, maxLod * r * (2.0 - r)).rgb, share);
      }`,
    // (Over what the row held, by `share`: a new capture can ease in.)
    blending: THREE.NormalBlending,
    transparent: true,
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
  /** The light changed (day and night): capture everything again, each easing in over what it held. */
  private soft = false;
  private queueSoft = false;

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
    return !!this.job || (this.on && this.queue.length > 0);
  }

  get boxes(): readonly Probe[] {
    return this.probes;
  }

  /**
   * A capture under way. Its six views are drawn over the next frames (a few a frame) and then blurred into its
   * row of the atlas, so a capture never holds one frame up for six drawings of the whole scene and the blur.
   */
  private job: { slot: number; from: THREE.Vector3; face: number; soft?: boolean } | null = null;

  /** The light changed (the time of day): capture again, easing in, so the change has no hard step. */
  relight(): void {
    if (!this.on) return;
    if (!this.dirty) this.soft = true;
    this.dirty = true;
  }

  /** Capture if due (camera at `eye`); `helpers` are editor aids left out of the picture. */
  update(scene: THREE.Scene, eye: THREE.Vector3, enabled: boolean, helpers: THREE.Object3D[] = []): void {
    if (!enabled) {
      this.job = null;
      if (this.on) {
        this.on = false;
        PROBES.cwProbeOn.value = 0;
        setSceneReflection(null);
      }
      return;
    }
    if (this.dirty) {
      // (Rooms still waiting keep their turn: captures again and again as the light changes don't starve the last.)
      for (let i = 0; i < this.probes.length; i++) if (!this.queue.includes(i)) this.queue.push(i);
      this.queueSoft = this.soft;
    }
    if (this.job) return this.go(scene, helpers);
    const now = performance.now();
    const outdoor = !this.on || this.dirty || this.at.distanceTo(eye) >= MOVE;
    if (outdoor && now - this.last >= 500) {
      this.last = now;
      this.dirty = false;
      this.at.copy(eye);
      this.job = { slot: 0, from: eye.clone(), face: 0, soft: this.soft };
      this.soft = false;
      return this.go(scene, helpers);
    }
    // One room after another.
    const i = this.queue.shift();
    if (i === undefined || !this.on) return;
    const p = this.probes[i]!;
    this.job = { slot: i + 1, from: new THREE.Vector3(...p.at), face: 0, soft: this.queueSoft };
    this.go(scene, helpers);
  }

  /**
   * Before a game's first frame: switch reflections on and capture where the camera is, all at once. Materials
   * reflect a captured cube from then on, so the shaders compiled for the game's first frame are the ones it keeps
   * (turning reflections on later would compile every shiny material again in the middle of playing).
   */
  prime(scene: THREE.Scene, eye: THREE.Vector3, enabled: boolean, helpers: THREE.Object3D[] = []): void {
    if (!enabled || this.on) return;
    // (An empty capture to reflect while the first one is drawn: the same kind of map as every later one.)
    this.env ??= this.pmrem.fromCubemap(this.cube.texture);
    setSceneReflection(this.env.texture);
    this.job = null;
    this.dirty = false;
    this.last = performance.now();
    this.at.copy(eye);
    this.draw(scene, { from: eye, face: 0 }, 6, helpers);
    this.store(0);
    this.on = true;
    PROBES.cwProbeAtlas.value = this.atlas.texture;
    PROBES.cwProbeOn.value = 1;
  }

  /**
   * Starts compiling the shaders `prime` will draw `root` with (reflections switched on, into the capture's cube),
   * without waiting for them: drawn before they are ready, each is waited for in turn, the window frozen meanwhile.
   */
  kick(scene: THREE.Scene, eye: THREE.Vector3, enabled: boolean, root: THREE.Object3D, helpers: THREE.Object3D[] = []): void {
    if (!enabled || this.on) return;
    const r = this.r;
    // (What the capture leaves out is hidden here too: lights that hang from it don't count, and how many lights
    // there are is part of a shader.)
    const aids: THREE.Object3D[] = [...helpers.filter((h) => h.visible)];
    scene.traverseVisible((o) => {
      if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Object3D & { isTransformControlsRoot?: boolean }).isTransformControlsRoot) aids.push(o);
    });
    for (const o of aids) o.visible = false;
    this.env ??= this.pmrem.fromCubemap(this.cube.texture);
    setSceneReflection(this.env.texture);
    const cam = this.cam;
    cam.position.copy(eye);
    cam.updateMatrixWorld(true);
    const target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    r.setRenderTarget(this.cube, 0, cam.activeMipmapLevel);
    try {
      r.compile(root, cam.children[0] as THREE.Camera, scene);
    } finally {
      r.setRenderTarget(target, face, mip);
      for (const o of aids) o.visible = true;
    }
  }

  /** Go on with the capture under way: the next views, then (once all six are drawn) its blur. */
  private go(scene: THREE.Scene, helpers: THREE.Object3D[]): void {
    const job = this.job!;
    if (job.face < 6) {
      this.draw(scene, job, FACES_PER_FRAME, helpers);
      return;
    }
    this.job = null;
    this.store(job.slot, job.soft ? SOFT : 1);
    if (job.slot === 0 && !this.on) {
      this.on = true;
      PROBES.cwProbeAtlas.value = this.atlas.texture;
      PROBES.cwProbeOn.value = 1;
      // (The materials need an environment map to reflect at all: the camera's capture.)
      setSceneReflection(this.env!.texture);
    }
    if (job.slot > 0 && !this.queue.length) PROBES.cwProbeCount.value = this.probes.length;
  }

  /** Draw up to `n` more of the six views of the capture under way into the cube. */
  private draw(scene: THREE.Scene, job: { from: THREE.Vector3; face: number }, n: number, helpers: THREE.Object3D[]): void {
    const r = this.r;
    // (No editor aids, no second shadow pass.)
    const aids: THREE.Object3D[] = [...helpers.filter((h) => h.visible)];
    // (Glass is left out of the capture: it would draw the scene behind it again for each of the six views.)
    const glass = new Set<THREE.Material>();
    scene.traverseVisible((o) => {
      if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Object3D & { isTransformControlsRoot?: boolean }).isTransformControlsRoot) aids.push(o);
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) if ((x as THREE.MeshPhysicalMaterial).transmission > 0 && x.visible) glass.add(x);
    });
    for (const o of aids) o.visible = false;
    for (const m of glass) m.visible = false;
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    const cam = this.cam;
    if (job.face === 0) {
      cam.position.copy(job.from);
      cam.updateMatrixWorld(true);
    }
    // (As CubeCamera.update does it, a view at a time.)
    if (cam.coordinateSystem !== r.coordinateSystem) {
      cam.coordinateSystem = r.coordinateSystem;
      cam.updateCoordinateSystem();
    }
    const target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const xr = r.xr.enabled;
    r.xr.enabled = false;
    const tex = this.cube.texture as THREE.Texture & { mipmapsAutoUpdate: boolean };
    const mips = tex.mipmapsAutoUpdate;
    const reversed = (r.state.buffers.depth as { getReversed?: () => boolean }).getReversed?.() ?? false;
    for (let k = 0; k < n && job.face < 6; k++, job.face++) {
      // (Mipmaps are made with the last view, once the whole cube is drawn.)
      tex.mipmapsAutoUpdate = job.face === 5 ? mips : false;
      r.setRenderTarget(this.cube, job.face, cam.activeMipmapLevel);
      if (reversed && r.autoClear === false) r.clearDepth();
      r.render(scene, cam.children[job.face] as THREE.Camera);
    }
    tex.mipmapsAutoUpdate = mips;
    r.setRenderTarget(target, face, mip);
    r.xr.enabled = xr;
    r.shadowMap.autoUpdate = auto;
    for (const o of aids) o.visible = true;
    for (const m of glass) m.visible = true;
  }

  /** Blur the drawn cube and write it into the atlas row `slot`. */
  private store(slot: number, share = 1): void {
    const r = this.r;
    this.env = this.pmrem.fromCubemap(this.cube.texture, this.env ?? undefined);
    // Into the atlas row.
    const prev = r.getRenderTarget();
    const u = this.pass.mat.uniforms;
    u.env!.value = this.env.texture;
    u.slot!.value = slot;
    u.share!.value = share;
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
