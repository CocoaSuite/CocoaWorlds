// Power while playing: hung string lights (wire, bulbs, the light they cast), cables from plugs to sockets, and
// plain stand-ins for outlets and power sources that have no model of their own.
import * as THREE from 'three';
import { defaultComponent, readComponent, type ModelData, type SceneDoc, type StringLightsData } from '@cocoaworlds/core';
import { modelInstance, type ModelInstance } from './models';
import { powerStandIn, type PowerStandIn } from './power-props';
import { along, bulbPoints, dropOf, wirePoints, type GameWorld, type P3 } from '@cocoaworlds/runtime';

/** Point lights' brightness in the game's units (as scene lights). */
const FALLOFF = 96;
/** Most cables drawn. */
const MAX_CABLES = 64;
/** How far out from what the lights hang on their light comes from (u). */
const LIGHT_OUT = 56;
/** Cables and wires: a real cable's thickness (u), shaded by the scene's light and shadow like anything else. */
const CABLE_R = 0.6;

interface StringView {
  version: number;
  lit: boolean | null;
  wire: THREE.Mesh;
  bulbs: THREE.InstancedMesh | null;
  mat: THREE.MeshStandardMaterial;
  lights: THREE.PointLight[];
  data: StringLightsData;
}

export class PowerView {
  readonly group = new THREE.Group();
  private strings = new Map<string, StringView>();
  private wireMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
  private bulbGeo = new THREE.IcosahedronGeometry(2, 0);
  /** One tube per cable, and the shapes they were made from (rebuilt only when the world changes one). */
  private cables: THREE.Mesh[] = [];
  private lastCables: P3[][] = [];

  private sources: { id: string; lamp: THREE.MeshBasicMaterial; on: boolean | null }[] = [];
  private standIns: PowerStandIn[] = [];
  /** Each plug drawn (its model, or a plain stand-in), by the object it belongs to. */
  private plugs = new Map<string, { obj: THREE.Group; inst: ModelInstance | null }>();
  private plugModel = new Map<string, string>();

  constructor(
    private world: GameWorld,
    doc: SceneDoc,
  ) {
    // (String lights' lights made now, dark, so lighting one up later compiles nothing.)
    for (const e of doc.entities) if (e.components.stringLights) this.stringView(e.id, readComponent<StringLightsData>('stringLights', e.components.stringLights));
    for (const e of doc.entities) {
      const m = ((e.components.extender ?? e.components.stringLights) as { plug?: unknown } | undefined)?.plug;
      if (typeof m === 'string' && m) this.plugModel.set(e.id, m);
    }
    // Outlets and power sources without a model: a plate, a box with a lamp (as the editor shows them).
    for (const e of doc.entities) {
      if (!e.components.outlet && !e.components.powerSource) continue;
      // (A loose one is drawn by the play session, moving with it.)
      if ((e.components.rigidBody as { motion?: string } | undefined)?.motion === 'dynamic') continue;
      const s = powerStandIn(e.components);
      if (!s) continue;
      s.object.matrixAutoUpdate = false;
      s.object.matrix.fromArray(doc.worldMatrix(e.id));
      this.group.add(s.object);
      this.standIns.push(s);
      if (s.lamp) this.sources.push({ id: e.id, lamp: s.lamp, on: null });
    }
  }

  private stringView(id: string, data: StringLightsData): StringView {
    let v = this.strings.get(id);
    if (v) return v;
    const wire = new THREE.Mesh(new THREE.BufferGeometry(), this.wireMat);
    wire.receiveShadow = true;
    wire.visible = false;
    this.group.add(wire);
    const lights: THREE.PointLight[] = [];
    for (let i = 0; i < Math.max(0, Math.min(4, Math.round(data.lights))); i++) {
      const l = new THREE.PointLight(new THREE.Color(data.color), 0, data.range, 1);
      l.castShadow = false;
      this.group.add(l);
      lights.push(l);
    }
    const c = new THREE.Color(data.color);
    // (Its own material, lit by the world when off; on, it glows. Switching changes a number, compiling nothing.)
    const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0, roughness: 0.5 });
    v = { version: -1, lit: null, wire, bulbs: null, mat, lights, data };
    this.strings.set(id, v);
    return v;
  }

  update(): void {
    const view = this.world.powerView();
    const seen = new Set<string>();
    for (const s of view.strings) {
      seen.add(s.id);
      const v = this.stringView(s.id, s.data);
      // (While one end is being hung the other follows the coil: redrawn every frame.)
      if (v.version !== s.version || s.version % 1 !== 0) this.reshape(v, s.ends, s.out, s.version % 1 !== 0);
      v.version = s.version;
      const lit = s.lit && !!s.ends && s.version % 1 === 0;
      if (lit !== v.lit) {
        v.lit = lit;
        v.mat.emissiveIntensity = lit ? 2 : 0;
        for (const l of v.lights) l.intensity = lit ? s.data.intensity * FALLOFF : 0;
      }
    }
    for (const [id, v] of this.strings) if (!seen.has(id)) {
      v.wire.visible = false;
      if (v.bulbs) v.bulbs.visible = false;
      for (const l of v.lights) l.intensity = 0;
    }
    // Cables (rebuilt only when one changed: the world keeps a cable's shape while its ends stay put).
    const shapes = view.cables.slice(0, MAX_CABLES).map((c) => c.points);
    for (let i = 0; i < shapes.length; i++) {
      if (shapes[i] === this.lastCables[i]) continue;
      let m = this.cables[i];
      if (!m) {
        m = new THREE.Mesh(new THREE.BufferGeometry(), this.wireMat);
        m.receiveShadow = true;
        this.group.add(m);
        this.cables.push(m);
      }
      m.geometry.dispose();
      m.geometry = tube(shapes[i]!);
      m.visible = true;
    }
    for (let i = shapes.length; i < this.cables.length; i++) this.cables[i]!.visible = false;
    this.lastCables = shapes;
    // Plugs: in their sockets, in the hand, or lying at the end of their cable.
    const shown = new Set<string>();
    for (const p of view.plugs) {
      // (No way to point it, or anywhere to put it: not drawn, rather than drawn as NaN.)
      if (Math.hypot(...p.dir) < 1e-6 || ![...p.at, ...p.dir, ...p.up].every(Number.isFinite)) continue;
      shown.add(p.id);
      const v = this.plugView(p.id);
      // (Its prongs along `dir`; its own −Z is the way its prongs point.)
      const z = new THREE.Vector3(-p.dir[0], -p.dir[1], -p.dir[2]).normalize();
      const x = new THREE.Vector3(...p.up).cross(z);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0).cross(z);
      x.normalize();
      const y = z.clone().cross(x);
      v.obj.matrix.makeBasis(x, y, z).setPosition(...p.at);
      v.obj.visible = true;
    }
    for (const [id, v] of this.plugs) if (!shown.has(id)) v.obj.visible = false;
    for (const s of this.sources) {
      const on = this.world.powerOn(s.id);
      if (on === s.on) continue;
      s.on = on;
      s.lamp.color.set(on ? 0x5dcaa5 : 0xe24b4a);
    }
  }

  private plugView(id: string): { obj: THREE.Group; inst: ModelInstance | null } {
    const base = id.split('#')[0]!;
    let v = this.plugs.get(id);
    if (v) return v;
    const obj = new THREE.Group();
    obj.matrixAutoUpdate = false;
    this.group.add(obj);
    v = { obj, inst: null };
    this.plugs.set(id, v);
    const model = this.plugModel.get(base);
    const standIn = () => obj.add(plainPlug());
    if (!model) standIn();
    else
      void modelInstance({ ...(defaultComponent('model') as ModelData), model, units: 'metres' })
        .then((inst) => {
          if (this.disposed) return inst.dispose();
          inst.object.traverse((o) => {
            if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
          });
          obj.add(inst.object);
          v!.inst = inst;
        })
        .catch(standIn);
    return v;
  }
  private disposed = false;

  /** The wire, bulbs and lights where the string hangs now (hidden when it is a coil). */
  private reshape(v: StringView, ends: [P3, P3] | null, out: P3, moving: boolean): void {
    if (!ends || !ends.flat().every(Number.isFinite)) {
      v.wire.visible = false;
      if (v.bulbs) v.bulbs.visible = false;
      return;
    }
    const [a, b] = ends;
    const drop = dropOf(a, b, v.data.sag);
    const pts = wirePoints(a, b, drop, 24);
    v.wire.geometry.dispose();
    v.wire.geometry = tube(pts);
    v.wire.visible = true;
    const bulbs = bulbPoints(a, b, v.data);
    if (!v.bulbs || v.bulbs.count < bulbs.length) {
      if (v.bulbs) {
        this.group.remove(v.bulbs);
        v.bulbs.dispose();
      }
      v.bulbs = new THREE.InstancedMesh(this.bulbGeo, v.mat, Math.max(8, bulbs.length * 2));
      v.bulbs.frustumCulled = false;
      this.group.add(v.bulbs);
    }
    const m = new THREE.Matrix4();
    bulbs.forEach((q, i) => v.bulbs!.setMatrixAt(i, m.makeTranslation(q[0], q[1] - 1.6, q[2])));
    v.bulbs.count = bulbs.length;
    v.bulbs.instanceMatrix.needsUpdate = true;
    v.bulbs.visible = true;
    v.lights.forEach((l, i) => {
      const q = along(a, b, drop, (i + 0.5) / v.lights.length);
      // (Out in the room, away from the wall or ceiling it hangs on: a soft wash, no bright spot on the surface.)
      l.position.set(q[0] + out[0] * LIGHT_OUT, q[1] + out[1] * LIGHT_OUT - 8, q[2] + out[2] * LIGHT_OUT);
    });
    // (Not lit while it is being hung.)
    if (moving) for (const l of v.lights) l.intensity = 0;
  }

  dispose(): void {
    this.disposed = true;
    for (const v of this.plugs.values()) {
      v.inst?.dispose();
      v.obj.traverse((o) => {
        if (o instanceof THREE.Mesh && !v.inst) o.geometry.dispose();
      });
    }
    this.wireMat.dispose();
    this.bulbGeo.dispose();
    for (const c of this.cables) c.geometry.dispose();
    for (const v of this.strings.values()) {
      v.wire.geometry.dispose();
      v.bulbs?.dispose();
      v.mat.dispose();
    }
    for (const h of this.standIns) h.dispose();
  }
}

/**
 * A thin tube along points. (Points on top of each other are dropped first: a zero-length piece gives the tube
 * NaN normals, and one NaN pixel through bloom greys out the whole view.)
 */
function tube(pts: P3[]): THREE.BufferGeometry {
  const clean: THREE.Vector3[] = [];
  for (const p of pts) {
    if (!p.every(Number.isFinite)) continue;
    const v = new THREE.Vector3(...p);
    if (!clean.length || clean[clean.length - 1]!.distanceToSquared(v) > 0.01) clean.push(v);
  }
  if (clean.length < 2) return new THREE.BufferGeometry();
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i + 1 < clean.length; i++) path.add(new THREE.LineCurve3(clean[i]!, clean[i + 1]!));
  const geo = new THREE.TubeGeometry(path, (clean.length - 1) * 2, CABLE_R, 5, false);
  // (Belt and braces: anything not a number left in it, and it isn't drawn.)
  const a = geo.getAttribute('normal').array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) return new THREE.BufferGeometry();
  return geo;
}

const plugMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.7 });
const prongMat = new THREE.MeshStandardMaterial({ color: 0xb4b2a9, metalness: 0.8, roughness: 0.3 });
/** A plain plug (no model): a round body behind the prongs' base, two prongs along −Z. */
function plainPlug(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 3.9, 8).rotateX(Math.PI / 2).translate(0, 0, 1.95), plugMat);
  g.add(body);
  for (const x of [-1.2, 1.2]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 4.5, 6).rotateX(Math.PI / 2).translate(x, 0, -2.25), prongMat);
    g.add(p);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}
