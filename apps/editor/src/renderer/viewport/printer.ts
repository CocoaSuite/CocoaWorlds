/**
 * How a 3D printer looks and prints (component `printer`). The built-in printer is a box frame with a build
 * plate, a gantry that rises with the layers and slides front-back, and a head that slides along it; a printer
 * with a Model of its own moves the parts named in its settings the same way.
 *
 * A print under way is drawn cut off at the layer being laid: every mesh of the copy gets a copy of its material
 * that drops what is above the cut, shades the layer lines and tints the fresh layer; its back faces are drawn
 * in the filament's colour so the cut looks solid. The head traces the copy's outline at the cut (a slice of its
 * triangles), then fills it in with a zig-zag. The editor and the game draw the printer the same way.
 */
import { PRINTER_NOZZLE, printerFrame, type PrinterData } from '@cocoaworlds/core';
import * as THREE from 'three';

export interface PrinterObject {
  object: THREE.Group;
  head: THREE.Object3D;
  gantry: THREE.Object3D;
  dispose(): void;
}

const FRAME = 0x3a3a38, POST = 0x5f5e5a, PLATE = 0x888780, HEAD = 0xd85a30, NOZZLE = 0xba7517;
const NOZZLE_LEN = PRINTER_NOZZLE;

/** The built-in printer, in the printer's own space (its plate's top middle at `bed`). */
export function buildPrinter(data: PrinterData): PrinterObject {
  const object = new THREE.Group();
  object.name = 'printer';
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mat = (color: number) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
    mats.push(m);
    return m;
  };
  const frameM = mat(FRAME), postM = mat(POST), plateM = mat(PLATE), headM = mat(HEAD), nozzleM = mat(NOZZLE);
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = object) => {
    const g = new THREE.BoxGeometry(Math.max(0.1, w), Math.max(0.1, h), Math.max(0.1, d));
    geos.push(g);
    const b = new THREE.Mesh(g, m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    parent.add(b);
    return b;
  };
  const [bx, by, bz] = data.bed;
  const margin = 6, post = 3;
  const halfW = data.size[0] / 2 + margin;
  const color = { base: frameM, plate: plateM, post: postM, top: postM };
  for (const f of printerFrame(data)) box(f.size[0], f.size[1], f.size[2], color[f.part], f.center[0], f.center[1], f.center[2]);
  // The gantry: a bar across, with a block at each end riding the sides; the head rides the bar.
  const gantry = new THREE.Group();
  gantry.name = 'printer-gantry';
  object.add(gantry);
  const barY = by + NOZZLE_LEN + 7;
  box(halfW * 2 - post, 2.5, 2.5, frameM, bx, barY, bz + 5, gantry);
  for (const sx of [-1, 1]) box(4, 6, 8, postM, bx + sx * (halfW - post / 2 - 2), barY, bz + 3, gantry);
  const head = new THREE.Group();
  head.name = 'printer-head';
  gantry.add(head);
  box(8, 10, 8, headM, bx, by + NOZZLE_LEN + 5, bz, head);
  const cone = new THREE.ConeGeometry(1.2, NOZZLE_LEN, 8);
  geos.push(cone);
  const nozzle = new THREE.Mesh(cone, nozzleM);
  nozzle.rotation.x = Math.PI;
  nozzle.position.set(bx, by + NOZZLE_LEN / 2, bz);
  head.add(nozzle);
  return {
    object,
    head,
    gantry,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

/** A print under way, as the game says: how far along it is (0–1). */
export interface PrintState {
  done: number;
}

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpN = new THREE.Matrix3();

/** One mesh of a copy being printed: what it was drawn with, and its triangles in the world (they don't move while it prints). */
interface PatchedMesh {
  mesh: THREE.Mesh;
  material: THREE.Material | THREE.Material[];
  castShadow: boolean;
  noAo: unknown;
  clones: THREE.Material[];
  cap: THREE.Mesh | null;
  tris: Float32Array;
}

/**
 * Drives one printer: its moving parts (built-in or its own model's) and the print on it. Call `parts` when the
 * model's parts are known, and `update` every frame with the meshes of the copy being printed (or none).
 */
export class PrinterRig {
  private head: THREE.Object3D | null = null;
  private gantry: THREE.Object3D | null = null;
  private headRest = new THREE.Vector3();
  private gantryRest = new THREE.Vector3();
  /** The head's offset from rest in the printer's space now (eased back to resting when idle). */
  private offset = new THREE.Vector3();
  private patched = new Map<THREE.Mesh, PatchedMesh>();
  private uniforms = { uPrintTop: { value: 1e9 }, uPrintLayer: { value: 1 }, uPrintFresh: { value: new THREE.Color() } };
  private capMat: THREE.MeshBasicMaterial;
  private bounds = new THREE.Box3();
  private boundsOk = false;
  private layer = -1;
  /** The path the head takes in this layer: points across the plate (printer space x, z), and the running length to each. */
  private path: number[] = [];
  private lengths: number[] = [];
  private infillFrom = 0;
  private copy: string | null = null;

  constructor(
    private data: PrinterData,
    /** What places the printer in the world (its matrix is the printer's). */
    private root: THREE.Object3D,
  ) {
    this.uniforms.uPrintFresh.value.set(data.filament).lerp(new THREE.Color(0xffffff), 0.45);
    this.capMat = clipMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(data.filament).multiplyScalar(0.7), side: THREE.BackSide }), this.uniforms, false);
  }

  /** The parts that move (null: that one doesn't). Their resting place is taken now. */
  setParts(head: THREE.Object3D | null, gantry: THREE.Object3D | null): void {
    this.head = head;
    this.gantry = gantry;
    if (head) this.headRest.copy(head.position);
    if (gantry) this.gantryRest.copy(gantry.position);
  }

  /** One frame: `print` is the print on this printer (null: idle) and `meshes` what draws its copy. */
  update(dt: number, print: (PrintState & { copy: string }) | null, meshes: THREE.Mesh[]): void {
    if (!print || print.copy !== this.copy) this.finish();
    const target = new THREE.Vector3(0, this.data.size[1] * 0.25 + 4, 0);
    if (print) {
      this.copy = print.copy;
      let added = false;
      for (const m of meshes) if (!this.patched.has(m)) added = this.patch(m) || added;
      if (added || !this.boundsOk) this.measure();
      if (this.boundsOk) this.printAt(print.done, target);
      this.offset.copy(target);
    } else this.offset.lerp(target, Math.min(1, dt * 3));
    this.moveParts();
  }

  /** Where the cut is and where the head is, `done` (0–1) through the print; `out`: the head's offset. */
  private printAt(done: number, out: THREE.Vector3): void {
    const lh = Math.max(0.01, this.data.layerHeight);
    const b = this.bounds;
    const layers = Math.max(1, Math.ceil((b.max.y - b.min.y) / lh));
    const k = Math.min(layers - 1e-6, done * layers);
    const layer = Math.floor(k);
    const f = k - layer;
    const top = b.min.y + (layer + 1) * lh;
    this.uniforms.uPrintTop.value = top;
    this.uniforms.uPrintLayer.value = lh;
    if (layer !== this.layer) {
      this.layer = layer;
      this.slice(b.min.y + (layer + 0.5) * lh, layer);
    }
    // Head: along the outline, then the zig-zag fill; its nozzle at the top of the layer.
    const [bx, by, bz] = this.data.bed;
    const local = this.toPrinter(new THREE.Vector3(0, top, 0));
    const p = this.pointAt(f);
    out.set(p ? p[0] - bx : 0, local.y - by, p ? p[1] - bz : 0);
  }

  /** A point of this layer's path, `f` (0–1) along it in time (outline first, then the fill). */
  private pointAt(f: number): [number, number] | null {
    const n = this.path.length / 2;
    if (!n) return null;
    if (n === 1) return [this.path[0]!, this.path[1]!];
    const total = this.lengths[n - 1]!;
    const s = Math.min(1, Math.max(0, f)) * total;
    let i = 1;
    while (i < n - 1 && this.lengths[i]! < s) i++;
    const s0 = this.lengths[i - 1]!, s1 = this.lengths[i]!;
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    return [this.path[(i - 1) * 2]! + (this.path[i * 2]! - this.path[(i - 1) * 2]!) * t, this.path[(i - 1) * 2 + 1]! + (this.path[i * 2 + 1]! - this.path[(i - 1) * 2 + 1]!) * t];
  }

  /** This layer's path: the copy's triangles cut at height `y` (world), chained into an outline, then a zig-zag over it. */
  private slice(y: number, layer: number): void {
    const segs: number[] = [];
    for (const p of this.patched.values()) {
      const t = p.tris;
      for (let i = 0; i < t.length; i += 9) {
        let n = 0;
        const hit: number[] = [];
        for (let e = 0; e < 3; e++) {
          const a = i + e * 3, c = i + ((e + 1) % 3) * 3;
          const ya = t[a + 1]!, yc = t[c + 1]!;
          if ((ya - y) * (yc - y) >= 0 || ya === yc) continue;
          const u = (y - ya) / (yc - ya);
          hit.push(t[a]! + (t[c]! - t[a]!) * u, t[a + 2]! + (t[c + 2]! - t[a + 2]!) * u);
          n++;
        }
        if (n === 2) segs.push(hit[0]!, hit[1]!, hit[2]!, hit[3]!);
      }
    }
    // (World x, z to the printer's own plane.)
    const pts: number[] = [];
    const v = new THREE.Vector3();
    const keep = Math.max(1, Math.floor(segs.length / 4 / 400));
    for (let i = 0; i < segs.length; i += 4 * keep) {
      for (const j of [0, 2]) {
        this.toPrinter(v.set(segs[i + j]!, y, segs[i + j + 1]!));
        pts.push(v.x, v.z);
      }
    }
    // Chained: from each segment's end to the nearest unused segment.
    const count = pts.length / 4;
    const used = new Uint8Array(count);
    const path: number[] = [];
    let cx = count ? pts[0]! : 0, cz = count ? pts[1]! : 0;
    for (let k = 0; k < count; k++) {
      let best = -1, bestD = Infinity, flip = false;
      for (let s = 0; s < count; s++) {
        if (used[s]) continue;
        const d0 = (pts[s * 4]! - cx) ** 2 + (pts[s * 4 + 1]! - cz) ** 2;
        const d1 = (pts[s * 4 + 2]! - cx) ** 2 + (pts[s * 4 + 3]! - cz) ** 2;
        if (d0 < bestD) (bestD = d0), (best = s), (flip = false);
        if (d1 < bestD) (bestD = d1), (best = s), (flip = true);
      }
      used[best] = 1;
      const a = flip ? 2 : 0, c = flip ? 0 : 2;
      path.push(pts[best * 4 + a]!, pts[best * 4 + a + 1]!, pts[best * 4 + c]!, pts[best * 4 + c + 1]!);
      cx = pts[best * 4 + c]!;
      cz = pts[best * 4 + c + 1]!;
    }
    this.infillFrom = path.length / 2;
    // The fill: lines across the outline's box, along x on even layers and z on odd ones, inset a little.
    if (path.length >= 4) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < path.length; i += 2) {
        x0 = Math.min(x0, path[i]!);
        x1 = Math.max(x1, path[i]!);
        z0 = Math.min(z0, path[i + 1]!);
        z1 = Math.max(z1, path[i + 1]!);
      }
      const inset = Math.min((x1 - x0) * 0.15, (z1 - z0) * 0.15, 2);
      x0 += inset;
      x1 -= inset;
      z0 += inset;
      z1 -= inset;
      const lines = 6;
      for (let l = 0; l <= lines; l++) {
        const q = l / lines;
        if (layer % 2) {
          const z = z0 + (z1 - z0) * q;
          path.push(l % 2 ? x1 : x0, z, l % 2 ? x0 : x1, z);
        } else {
          const x = x0 + (x1 - x0) * q;
          path.push(x, l % 2 ? z1 : z0, x, l % 2 ? z0 : z1);
        }
      }
    }
    const lengths: number[] = [];
    let s = 0;
    for (let i = 0; i < path.length; i += 2) {
      if (i) s += Math.hypot(path[i]! - path[i - 2]!, path[i + 1]! - path[i - 1]!);
      lengths.push(s);
    }
    this.path = path;
    this.lengths = lengths;
  }

  /** A world point in the printer's own space. */
  private toPrinter(v: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return v.applyMatrix4(tmpM.copy(this.root.matrixWorld).invert());
  }

  /** Put the gantry and the head where the offset says (in the printer's space, from rest). */
  private moveParts(): void {
    const o = this.offset;
    this.root.updateWorldMatrix(true, false);
    tmpN.setFromMatrix4(this.root.matrixWorld);
    const place = (part: THREE.Object3D, rest: THREE.Vector3, d: THREE.Vector3) => {
      part.position.copy(rest);
      if (!part.parent) return;
      part.updateWorldMatrix(true, false);
      const world = part.getWorldPosition(tmpV).add(d.clone().applyMatrix3(tmpN));
      part.position.copy(part.parent.worldToLocal(world));
    };
    if (this.gantry) place(this.gantry, this.gantryRest, new THREE.Vector3(0, o.y, o.z));
    if (this.head) {
      let onGantry = false;
      for (let x = this.head.parent; x; x = x.parent) if (x === this.gantry) onGantry = true;
      place(this.head, this.headRest, onGantry ? new THREE.Vector3(o.x, 0, 0) : o.clone());
    }
  }

  /** Draw a mesh of the copy cut at the layer. False: it isn't a mesh that can be (it is hidden until done). */
  private patch(mesh: THREE.Mesh): boolean {
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return false;
    mesh.updateWorldMatrix(true, false);
    const index = geo.getIndex();
    const n = index ? index.count : pos.count;
    const tris = new Float32Array(Math.floor(n / 3) * 9);
    const v = new THREE.Vector3();
    for (let i = 0; i < tris.length / 3; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      tris[i * 3] = v.x;
      tris[i * 3 + 1] = v.y;
      tris[i * 3 + 2] = v.z;
    }
    const original = mesh.material;
    const clones: THREE.Material[] = [];
    const cut = (m: THREE.Material) => {
      // (Raw shaders can't take the cut: they are drawn as they are.)
      if ((m as THREE.RawShaderMaterial).isRawShaderMaterial) return m;
      const copy = m.clone();
      copy.onBeforeCompile = m.onBeforeCompile;
      copy.customProgramCacheKey = m.customProgramCacheKey;
      const c = clipMaterial(copy, this.uniforms, true);
      c.side = THREE.FrontSide;
      clones.push(c);
      return c;
    };
    mesh.material = Array.isArray(original) ? original.map(cut) : cut(original);
    let cap: THREE.Mesh | null = null;
    if (!(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      cap = new THREE.Mesh(geo, this.capMat);
      cap.name = 'print-cap';
      cap.raycast = () => {};
      mesh.add(cap);
    }
    this.patched.set(mesh, { mesh, material: original, castShadow: mesh.castShadow, noAo: mesh.userData.noAo, clones, cap, tris });
    // (Shadows and occlusion are measured from the whole mesh, not the cut: the part not yet printed would show in them.)
    mesh.castShadow = false;
    mesh.userData.noAo = true;
    return true;
  }

  /** The copy's box in the world (from every mesh drawn so far). */
  private measure(): void {
    this.bounds.makeEmpty();
    for (const p of this.patched.values()) {
      const t = p.tris;
      for (let i = 0; i < t.length; i += 3) this.bounds.expandByPoint(tmpV.set(t[i]!, t[i + 1]!, t[i + 2]!));
    }
    this.boundsOk = !this.bounds.isEmpty();
    this.layer = -1;
  }

  /** The print is done (or gone): its meshes are drawn as they are again. */
  private finish(): void {
    for (const p of this.patched.values()) {
      p.mesh.material = p.material;
      p.mesh.castShadow = p.castShadow;
      if (p.noAo === undefined) delete p.mesh.userData.noAo;
      else p.mesh.userData.noAo = p.noAo;
      if (p.cap) p.mesh.remove(p.cap);
      for (const c of p.clones) c.dispose();
    }
    this.patched.clear();
    this.boundsOk = false;
    this.layer = -1;
    this.path = [];
    this.lengths = [];
    this.copy = null;
    this.uniforms.uPrintTop.value = 1e9;
  }

  dispose(): void {
    this.finish();
    this.capMat.dispose();
  }
}

/**
 * A material cut at a height: fragments above `uPrintTop` (world) are dropped. `lines`: layer lines shaded and the
 * fresh layer tinted. Works on Three's own materials (and anything else built from their shader chunks).
 */
export function clipMaterial<T extends THREE.Material>(m: T, u: { uPrintTop: { value: number }; uPrintLayer: { value: number }; uPrintFresh: { value: THREE.Color } }, lines: boolean): T {
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
    shader.uniforms.uPrintTop = u.uPrintTop;
    shader.uniforms.uPrintLayer = u.uPrintLayer;
    shader.uniforms.uPrintFresh = u.uPrintFresh;
    shader.vertexShader = 'varying float vPrintY;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvPrintY = (modelMatrix * vec4(transformed, 1.0)).y;');
    let frag = 'varying float vPrintY;\nuniform float uPrintTop;\nuniform float uPrintLayer;\nuniform vec3 uPrintFresh;\n' + shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/, (s) => `${s}\n  if (vPrintY > uPrintTop) discard;`);
    if (lines)
      frag = frag.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  float printL = fract(vPrintY / uPrintLayer);\n  diffuseColor.rgb *= 0.84 + 0.16 * sin(printL * 3.14159);\n  if (vPrintY > uPrintTop - uPrintLayer) diffuseColor.rgb = mix(diffuseColor.rgb, uPrintFresh, 0.55);',
      );
    shader.fragmentShader = frag;
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|print${lines ? 'L' : ''}`;
  m.needsUpdate = true;
  return m;
}
