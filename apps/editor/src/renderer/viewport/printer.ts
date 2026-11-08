/**
 * How a 3D printer prints (component `printer`). Its Model is the printer; the parts named in its settings move
 * like a fixed-bed printer: the lift climbs one layer at a time, the gantry slides front-back on it, the head
 * slides left-right on the gantry (each with the moving parts it is inside). The nozzle is the head's lowest point.
 *
 * A print under way is drawn cut off at the layer being laid: every mesh of the copy gets a copy of its material
 * that drops what is above the cut, shades the layer lines and tints the fresh layer; its back faces are drawn
 * in the filament's colour so the cut looks solid. The head goes round the copy's outline at the cut (a slice of
 * its triangles) and a zig-zag fill at its own pace.
 */
import type { PrinterData } from '@cocoaworlds/core';
import * as THREE from 'three';

/** The head's speed along a layer for a tiny print (u/s); it drops as prints get bigger. */
const HEAD_SPEED = 150;

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
  private lift: THREE.Object3D | null = null;
  private headRest = new THREE.Vector3();
  private gantryRest = new THREE.Vector3();
  private liftRest = new THREE.Vector3();
  /** Where the nozzle's tip is with the parts at rest, in the printer's space (the plate's middle without a head). */
  private tip = new THREE.Vector3();
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
  setParts(head: THREE.Object3D | null, gantry: THREE.Object3D | null, lift: THREE.Object3D | null = null): void {
    this.head = head;
    this.gantry = gantry;
    this.lift = lift;
    if (head) this.headRest.copy(head.position);
    if (gantry) this.gantryRest.copy(gantry.position);
    if (lift) this.liftRest.copy(lift.position);
    this.tip.fromArray(this.data.bed);
    if (head) this.findTip(head);
  }

  /** The nozzle: the head's lowest point (the middle of its corners within half a unit of the lowest). */
  private findTip(head: THREE.Object3D): void {
    this.root.updateWorldMatrix(true, true);
    const toPrinter = tmpM.copy(this.root.matrixWorld).invert();
    const pts: number[] = [];
    let low = Infinity;
    const v = new THREE.Vector3(), m = new THREE.Matrix4();
    head.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const pos = mesh.isMesh ? (mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined;
      if (!pos) return;
      m.multiplyMatrices(toPrinter, mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        pts.push(v.x, v.y, v.z);
        low = Math.min(low, v.y);
      }
    });
    let x = 0, z = 0, n = 0;
    for (let i = 0; i < pts.length; i += 3)
      if (pts[i + 1]! < low + 0.5) {
        x += pts[i]!;
        z += pts[i + 2]!;
        n++;
      }
    if (n) this.tip.set(x / n, low, z / n);
  }

  /** One frame: `print` is the print on this printer (null: idle) and `meshes` what draws its copy. */
  update(dt: number, print: (PrintState & { copy: string }) | null, meshes: THREE.Mesh[]): void {
    if (!print || print.copy !== this.copy) this.finish();
    // (Resting: the nozzle over the plate's middle, a quarter of the print space up.)
    const [bx, by, bz] = this.data.bed;
    const target = new THREE.Vector3(bx, by + this.data.size[1] * 0.25 + 4, bz).sub(this.tip);
    if (print) {
      this.copy = print.copy;
      let added = false;
      for (const m of meshes) if (!this.patched.has(m)) added = this.patch(m) || added;
      if (added || !this.boundsOk) this.measure();
      if (this.boundsOk) {
        this.printAt(dt, print.done, target);
        // (Never jumped: across the plate at most a few times its printing pace, up to the next layer eased.)
        const dx = target.x - this.offset.x, dz = target.z - this.offset.z;
        const d = Math.hypot(dx, dz), max = this.speed * 3 * dt;
        if (d > max) {
          this.offset.x += (dx / d) * max;
          this.offset.z += (dz / d) * max;
        } else {
          this.offset.x = target.x;
          this.offset.z = target.z;
        }
        this.offset.y += (target.y - this.offset.y) * Math.min(1, dt * 8);
      } else this.offset.lerp(target, Math.min(1, dt * 3));
    } else this.offset.lerp(target, Math.min(1, dt * 3));
    this.moveParts();
  }

  /** How far along this layer's path the head is (u), and how fast it goes there (u/s; slower for bigger prints). */
  private along = 0;
  private speed = 60;

  /** Where the cut is and where the head is headed, `done` (0–1) through the print; `out`: the head's offset. */
  private printAt(dt: number, done: number, out: THREE.Vector3): void {
    const lh = Math.max(0.01, this.data.layerHeight);
    const b = this.bounds;
    const layers = Math.max(1, Math.ceil((b.max.y - b.min.y) / lh));
    const layer = Math.floor(Math.min(layers - 1e-6, done * layers));
    const top = b.min.y + (layer + 1) * lh;
    this.uniforms.uPrintTop.value = top;
    this.uniforms.uPrintLayer.value = lh;
    const t = this.tip;
    if (layer !== this.layer) {
      this.layer = layer;
      this.slice(b.min.y + (layer + 0.5) * lh, layer);
      // (The new layer's path is taken up where the head is now, not from its start.)
      this.along = this.nearestAlong(this.offset.x + t.x, this.offset.z + t.z);
    }
    // The head goes round and round the layer's path at its own pace, its nozzle at the top of the layer.
    const n = this.path.length / 2;
    const total = n ? this.lengths[n - 1]! : 0;
    if (total > 0) this.along = (this.along + this.speed * dt) % total;
    const local = this.toPrinter(new THREE.Vector3(0, top, 0));
    const p = this.pointAt(this.along);
    out.set(p ? p[0] - t.x : this.offset.x, local.y - t.y, p ? p[1] - t.z : this.offset.z);
  }

  /** A point of this layer's path, `s` u along it (outline first, then the fill). */
  private pointAt(s: number): [number, number] | null {
    const n = this.path.length / 2;
    if (!n) return null;
    if (n === 1) return [this.path[0]!, this.path[1]!];
    let i = 1;
    while (i < n - 1 && this.lengths[i]! < s) i++;
    const s0 = this.lengths[i - 1]!, s1 = this.lengths[i]!;
    const t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
    return [this.path[(i - 1) * 2]! + (this.path[i * 2]! - this.path[(i - 1) * 2]!) * t, this.path[(i - 1) * 2 + 1]! + (this.path[i * 2 + 1]! - this.path[(i - 1) * 2 + 1]!) * t];
  }

  /** How far along this layer's path its point nearest to (x, z) is. */
  private nearestAlong(x: number, z: number): number {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.path.length; i += 2) {
      const d = (this.path[i]! - x) ** 2 + (this.path[i + 1]! - z) ** 2;
      if (d < bestD) (bestD = d), (best = this.lengths[i / 2]!);
    }
    return best;
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
    // How far each part moves in all (the lift rises, the gantry also slides front-back, the head also left-right);
    // each is moved by what that adds to the moving part it is inside.
    const parts: [THREE.Object3D | null, THREE.Vector3, THREE.Vector3][] = [
      [this.lift, this.liftRest, new THREE.Vector3(0, o.y, 0)],
      [this.gantry, this.gantryRest, new THREE.Vector3(0, o.y, o.z)],
      [this.head, this.headRest, o.clone()],
    ];
    for (const [part, rest, total] of parts) {
      if (!part) continue;
      let carried = new THREE.Vector3();
      for (let x = part.parent; x; x = x.parent) {
        const carrier = parts.find(([p]) => p === x);
        if (carrier) {
          carried = carrier[2];
          break;
        }
      }
      place(part, rest, total.clone().sub(carried));
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
    // Bigger prints: a slower head (u/s), as a bigger nozzle laying more at a time would be.
    const size = this.boundsOk ? this.bounds.getSize(tmpV).length() : 0;
    this.speed = HEAD_SPEED / (1 + size / 24);
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
    this.along = 0;
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
