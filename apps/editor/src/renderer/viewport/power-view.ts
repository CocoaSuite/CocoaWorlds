// Power while playing: hung string lights (wire, bulbs, the light they cast), cables from plugs to sockets, and
// plain stand-ins for outlets and power sources that have no model of their own.
import * as THREE from 'three';
import { readComponent, type ColliderData, type SceneDoc, type StringLightsData } from '@cocoaworlds/core';
import { along, bulbPoints, dropOf, wirePoints, type GameWorld, type P3 } from '@cocoaworlds/runtime';

/** Point lights' brightness in the game's units (as scene lights). */
const FALLOFF = 96;
/** Most cables drawn, and points along each. */
const MAX_CABLES = 64;
const CABLE_SEGS = 12;

interface StringView {
  version: number;
  lit: boolean | null;
  wire: THREE.Line;
  bulbs: THREE.InstancedMesh | null;
  mat: THREE.MeshStandardMaterial;
  lights: THREE.PointLight[];
  data: StringLightsData;
}

export class PowerView {
  readonly group = new THREE.Group();
  private strings = new Map<string, StringView>();
  private wireMat = new THREE.LineBasicMaterial({ color: 0x2a2a2a });
  private bulbGeo = new THREE.IcosahedronGeometry(1.4, 0);
  private cables: THREE.LineSegments;
  private cablePos = new Float32Array(MAX_CABLES * CABLE_SEGS * 6);
  private sources: { id: string; lamp: THREE.MeshBasicMaterial; on: boolean | null }[] = [];
  private standIns: THREE.Object3D[] = [];

  constructor(
    private world: GameWorld,
    doc: SceneDoc,
  ) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.cablePos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.cables = new THREE.LineSegments(g, this.wireMat);
    this.cables.frustumCulled = false;
    this.group.add(this.cables);
    // (String lights' lights made now, dark, so lighting one up later compiles nothing.)
    for (const e of doc.entities) if (e.components.stringLights) this.stringView(e.id, readComponent<StringLightsData>('stringLights', e.components.stringLights));
    // Outlets and power sources without a model: a plate, a box with a lamp.
    for (const e of doc.entities) {
      if (e.components.brush || e.components.model || (!e.components.outlet && !e.components.powerSource)) continue;
      const c = readComponent<ColliderData>('collider', e.components.collider ?? { size: e.components.outlet ? [8, 12, 2] : [32, 24, 24] });
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.fromArray(doc.worldMatrix(e.id));
      const body = new THREE.Mesh(new THREE.BoxGeometry(...c.size), new THREE.MeshStandardMaterial({ color: e.components.outlet ? 0xe8e2d4 : 0x5f5e5a, roughness: 0.8 }));
      body.position.set(...c.offset);
      holder.add(body);
      const [w, h, d] = c.size;
      if (e.components.outlet) {
        const slot = new THREE.BoxGeometry(Math.max(0.4, w * 0.08), h * 0.22, 0.2);
        const dark = new THREE.MeshBasicMaterial({ color: 0x2c2c2a });
        for (const x of [-w * 0.18, w * 0.18]) {
          const s = new THREE.Mesh(slot, dark);
          s.position.set(c.offset[0] + x, c.offset[1], c.offset[2] + d / 2 + 0.1);
          holder.add(s);
        }
      } else {
        const lamp = new THREE.MeshBasicMaterial({ color: 0x888780 });
        const l = new THREE.Mesh(new THREE.BoxGeometry(w * 0.12, h * 0.12, 0.4), lamp);
        l.position.set(c.offset[0] + w * 0.3, c.offset[1] + h * 0.3, c.offset[2] + d / 2 + 0.2);
        holder.add(l);
        this.sources.push({ id: e.id, lamp, on: null });
      }
      holder.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
      });
      this.group.add(holder);
      this.standIns.push(holder);
    }
  }

  private stringView(id: string, data: StringLightsData): StringView {
    let v = this.strings.get(id);
    if (v) return v;
    const wire = new THREE.Line(new THREE.BufferGeometry(), this.wireMat);
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
    // (Its own material: lit and dark differ by a number only, so switching compiles nothing.)
    const mat = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.45), emissive: c, emissiveIntensity: 0, roughness: 0.4 });
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
      if (v.version !== s.version || s.version % 1 !== 0) this.reshape(v, s.ends, s.version % 1 !== 0);
      v.version = s.version;
      const lit = s.lit && !!s.ends && s.version % 1 === 0;
      if (lit !== v.lit) {
        v.lit = lit;
        v.mat.emissiveIntensity = lit ? 2.5 : 0;
        for (const l of v.lights) l.intensity = lit ? s.data.intensity * FALLOFF : 0;
      }
    }
    for (const [id, v] of this.strings) if (!seen.has(id)) {
      v.wire.visible = false;
      if (v.bulbs) v.bulbs.visible = false;
      for (const l of v.lights) l.intensity = 0;
    }
    // Cables.
    let n = 0;
    const p = this.cablePos;
    for (const c of view.cables.slice(0, MAX_CABLES)) {
      // (Slack hangs down, up to a third of the gap.)
      const drop = Math.min(c.slack * 0.5, Math.hypot(c.to[0] - c.from[0], c.to[2] - c.from[2]) * 0.35 + 2);
      let prev = c.from;
      for (let i = 1; i <= CABLE_SEGS; i++) {
        const q = along(c.from, c.to, drop, i / CABLE_SEGS);
        p.set([prev[0], prev[1], prev[2], q[0], q[1], q[2]], n);
        n += 6;
        prev = q;
      }
    }
    const geo = this.cables.geometry;
    geo.setDrawRange(0, n / 3);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    for (const s of this.sources) {
      const on = this.world.powerOn(s.id);
      if (on === s.on) continue;
      s.on = on;
      s.lamp.color.set(on ? 0x5dcaa5 : 0xe24b4a);
    }
  }

  /** The wire, bulbs and lights where the string hangs now (hidden when it is a coil). */
  private reshape(v: StringView, ends: [P3, P3] | null, moving: boolean): void {
    if (!ends) {
      v.wire.visible = false;
      if (v.bulbs) v.bulbs.visible = false;
      return;
    }
    const [a, b] = ends;
    const drop = dropOf(a, b, v.data.sag);
    const pts = wirePoints(a, b, drop, 24);
    v.wire.geometry.setFromPoints(pts.map((q) => new THREE.Vector3(...q)));
    v.wire.geometry.computeBoundingSphere();
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
      l.position.set(q[0], q[1] - 4, q[2]);
    });
    // (Not lit while it is being hung.)
    if (moving) for (const l of v.lights) l.intensity = 0;
  }

  dispose(): void {
    this.wireMat.dispose();
    this.bulbGeo.dispose();
    this.cables.geometry.dispose();
    for (const v of this.strings.values()) {
      v.wire.geometry.dispose();
      v.bulbs?.dispose();
      v.mat.dispose();
    }
    for (const h of this.standIns)
      h.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
  }
}
