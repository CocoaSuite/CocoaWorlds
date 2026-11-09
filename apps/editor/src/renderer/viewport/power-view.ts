// Power while playing: hung string lights (wire, bulbs, the light they cast), cables from plugs to sockets, and
// plain stand-ins for outlets and power sources that have no model of their own.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { readComponent, type SceneDoc, type StringLightsData } from '@cocoaworlds/core';
import { powerStandIn, type PowerStandIn } from './power-props';
import { along, bulbPoints, dropOf, wirePoints, type GameWorld, type P3 } from '@cocoaworlds/runtime';

/** Point lights' brightness in the game's units (as scene lights). */
const FALLOFF = 96;
/** Most cables drawn, and points along each. */
const MAX_CABLES = 64;
const CABLE_SEGS = 16;
/** Cables and wires: this many pixels thick, whatever the distance. */
const CABLE_PX = 3;
/** How far out from what the lights hang on their light comes from (u). */
const LIGHT_OUT = 56;
const size = new THREE.Vector2();

interface StringView {
  version: number;
  lit: boolean | null;
  wire: Line2;
  bulbs: THREE.InstancedMesh | null;
  mat: THREE.MeshStandardMaterial;
  lights: THREE.PointLight[];
  data: StringLightsData;
}

export class PowerView {
  readonly group = new THREE.Group();
  private strings = new Map<string, StringView>();
  private wireMat = new LineMaterial({ color: 0x2a2a2a, linewidth: CABLE_PX });
  private bulbGeo = new THREE.IcosahedronGeometry(2, 0);
  private cables: LineSegments2;
  private cablePos = new Float32Array(MAX_CABLES * CABLE_SEGS * 6);
  private lastCables: P3[][] = [];
  /** (Line thickness is in pixels of the view drawn into.) */
  private fitLines = (r: THREE.WebGLRenderer) => {
    r.getSize(size);
    this.wireMat.resolution.copy(size);
  };
  private sources: { id: string; lamp: THREE.MeshBasicMaterial; on: boolean | null }[] = [];
  private standIns: PowerStandIn[] = [];

  constructor(
    private world: GameWorld,
    doc: SceneDoc,
  ) {
    this.cables = new LineSegments2(new LineSegmentsGeometry(), this.wireMat);
    this.cables.frustumCulled = false;
    this.cables.visible = false;
    this.cables.onBeforeRender = this.fitLines;
    this.group.add(this.cables);
    // (String lights' lights made now, dark, so lighting one up later compiles nothing.)
    for (const e of doc.entities) if (e.components.stringLights) this.stringView(e.id, readComponent<StringLightsData>('stringLights', e.components.stringLights));
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
    const wire = new Line2(new LineGeometry(), this.wireMat);
    wire.frustumCulled = false;
    wire.visible = false;
    wire.onBeforeRender = this.fitLines;
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
    if (shapes.length !== this.lastCables.length || shapes.some((x, i) => x !== this.lastCables[i])) {
      this.lastCables = shapes;
      let n = 0;
      const p = this.cablePos;
      for (const pts of shapes)
        for (let i = 0; i + 1 < pts.length && n + 6 <= p.length; i++) {
          const a = pts[i]!, b = pts[i + 1]!;
          p.set([a[0], a[1], a[2], b[0], b[1], b[2]], n);
          n += 6;
        }
      this.cables.visible = n > 0;
      if (n > 0) {
        this.cables.geometry.dispose();
        this.cables.geometry = new LineSegmentsGeometry().setPositions(p.subarray(0, n));
      }
    }
    for (const s of this.sources) {
      const on = this.world.powerOn(s.id);
      if (on === s.on) continue;
      s.on = on;
      s.lamp.color.set(on ? 0x5dcaa5 : 0xe24b4a);
    }
  }

  /** The wire, bulbs and lights where the string hangs now (hidden when it is a coil). */
  private reshape(v: StringView, ends: [P3, P3] | null, out: P3, moving: boolean): void {
    if (!ends) {
      v.wire.visible = false;
      if (v.bulbs) v.bulbs.visible = false;
      return;
    }
    const [a, b] = ends;
    const drop = dropOf(a, b, v.data.sag);
    const pts = wirePoints(a, b, drop, 24);
    v.wire.geometry.dispose();
    v.wire.geometry = new LineGeometry().setPositions(pts.flat());
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
    this.wireMat.dispose();
    this.bulbGeo.dispose();
    this.cables.geometry.dispose();
    for (const v of this.strings.values()) {
      v.wire.geometry.dispose();
      v.bulbs?.dispose();
      v.mat.dispose();
    }
    for (const h of this.standIns) h.dispose();
  }
}
