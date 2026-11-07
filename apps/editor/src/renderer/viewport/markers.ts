/**
 * Editor-only visuals for entities that have no geometry of their own yet (spawn points, lights, empties).
 * Each marker has an invisible pick volume so it can be clicked.
 */
import { posterOf, posterScrollRadius, readComponent, type EntityData, type GooglyEyesData, type ModelData, type SignData } from '@cocoaworlds/core';
import { modelInstance, onModelMaterialChange } from './models';

/** Called when a marker's model has loaded (the view needs a redraw). */
let markerLoaded: () => void = () => {};
export function onMarkerLoaded(fn: () => void): void {
  markerLoaded = fn;
  // (Project materials on models draw again as their images arrive.)
  onModelMaterialChange(fn);
}
import * as THREE from 'three';
import { buildSign } from './sign';
import { buildPoster } from './poster';
import { buildGooglyEyes, type GooglyEyes } from './googly-eyes';

export const COLORS = {
  idle: 0xb8b8b8,
  spawn: 0x8fb04a,
  light: 0xffd36b,
  probe: 0x5fd4e8,
  selected: 0x4b9cff,
};

export interface Marker {
  group: THREE.Group;
  lines: THREE.LineSegments[];
  pick: THREE.Mesh;
  baseColor: number;
  /** A box round the whole model, shown only while selected (models are too busy to outline). */
  box?: THREE.LineSegments;
  /** Googly eyes on it (their pupils are moved on every frame by the view). */
  eyes?: GooglyEyes;
}

const pickMat = new THREE.MeshBasicMaterial({ visible: false });

function lineMat(color: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, depthTest: true, transparent: true, opacity: 0.95 });
}

function segs(points: number[][], color: number): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  return new THREE.LineSegments(g, lineMat(color));
}

function circle(r: number, axis: 'x' | 'y' | 'z', n = 32): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a: number) => {
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      return axis === 'y' ? [c, 0, s] : axis === 'x' ? [0, c, s] : [c, s, 0];
    };
    out.push(p(a0), p(a1));
  }
  return out;
}

/** A standing player: 32 wide, 72 tall, with an arrow showing which way they face (−Z). */
function spawnLines(): number[][] {
  const pts: number[][] = [];
  const r = 16;
  for (const y of [0, 72]) pts.push(...circle(r, 'y', 24).map((p) => [p[0]!, p[1]! + y, p[2]!]));
  for (const [x, z] of [
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ] as const)
    pts.push([x, 0, z], [x, 72, z]);
  pts.push([0, 64, 0], [0, 64, -36], [0, 64, -36], [-8, 64, -26], [0, 64, -36], [8, 64, -26]);
  return pts;
}

function bulbLines(): number[][] {
  return [...circle(8, 'x', 16), ...circle(8, 'y', 16), ...circle(8, 'z', 16)];
}

export function buildMarker(e: EntityData): Marker {
  const group = new THREE.Group();
  group.name = e.name;
  group.userData.entityId = e.id;
  group.rotation.order = 'YXZ';
  const lines: THREE.LineSegments[] = [];
  let pick: THREE.Mesh;
  // (Made below, once the marker's own parts are in; a model that loads later carries them on a bone.)
  let eyes: GooglyEyes | undefined;
  let box: THREE.LineSegments | undefined;
  let baseColor = COLORS.idle;
  const light = e.components.light as { kind?: string; range?: number; angle?: number } | undefined;

  const model = e.components.model ? readComponent<ModelData>('model', e.components.model) : null;
  if (e.components.poster) {
    // The poster as it starts (rolled, or flat on its wall), plus a small cross at its origin for selection colour.
    const data = posterOf(e.components);
    const poster = buildPoster(data, () => markerLoaded());
    group.add(poster.object);
    group.userData.dispose = poster.dispose;
    lines.push(segs([[-6, 0, 0], [6, 0, 0], [0, -6, 0], [0, 6, 0], [0, 0, 0], [0, 0, 8]], baseColor));
    const d = poster.flat.visible ? data.thickness : posterScrollRadius(data) * 2;
    pick = new THREE.Mesh(new THREE.BoxGeometry(Math.max(8, data.width), Math.max(8, poster.flat.visible ? data.height : d), Math.max(8, d)), pickMat);
  } else if (model?.model) {
    // The model itself (once loaded), a small cross at the origin for selection colour, and a pick box that
    // grows to fit the model.
    lines.push(
      segs(
        [
          [-8, 0, 0],
          [8, 0, 0],
          [0, -8, 0],
          [0, 8, 0],
          [0, 0, -8],
          [0, 0, 8],
        ],
        baseColor,
      ),
    );
    pick = new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), pickMat);
    const p = pick;
    const b = (box = new THREE.LineSegments(boxEdges(new THREE.Vector3(24, 24, 24), new THREE.Vector3()), new THREE.LineBasicMaterial({ color: COLORS.selected })));
    b.name = 'selection-box';
    b.visible = false;
    group.add(b);
    void modelInstance(model)
      .then((inst) => {
        if (group.userData.disposed) return inst.dispose();
        group.add(inst.object);
        // (Googly eyes ride on its head bone, if they should and it has one.)
        eyes?.rideModel(inst.object);
        group.userData.dispose = inst.dispose;
        p.geometry.dispose();
        p.geometry = new THREE.BoxGeometry(Math.max(8, inst.size.x), Math.max(8, inst.size.y), Math.max(8, inst.size.z)).translate(inst.center.x, inst.center.y, inst.center.z);
        b.geometry.dispose();
        b.geometry = boxEdges(inst.size, inst.center);
        markerLoaded();
      })
      .catch(() => {
        // A missing or broken model: a pink box like a missing texture.
        if (group.userData.disposed) return;
        const box = new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: 0xff00dc, wireframe: true }));
        box.name = 'model-missing';
        group.add(box);
        markerLoaded();
      });
  } else if (e.components.sign) {
    // The sign itself, plus a small cross at the object's origin for selection colour.
    const sign = buildSign(readComponent<SignData>('sign', e.components.sign));
    group.add(sign.object);
    group.userData.dispose = sign.dispose;
    lines.push(
      segs(
        [
          [-6, 0, 0],
          [6, 0, 0],
          [0, -6, 0],
          [0, 6, 0],
        ],
        baseColor,
      ),
    );
    pick = new THREE.Mesh(new THREE.BoxGeometry(Math.max(8, sign.width), Math.max(8, sign.height), 4), pickMat);
  } else if (e.components.npc) {
    // A creature: a standing figure like the Player start, red for enemies, blue for friends, grey for others.
    const side = (e.components.npc as { side?: string }).side;
    baseColor = side === 'friendly' ? 0x5a84b6 : side === 'neutral' ? 0x9a9a92 : 0xd06a5e;
    lines.push(segs(spawnLines(), baseColor));
    pick = new THREE.Mesh(new THREE.BoxGeometry(32, 72, 32).translate(0, 36, 0), pickMat);
  } else if (e.components.reflectionProbe) {
    // A reflection probe: a small cross where it captures from, and its box (faint).
    baseColor = COLORS.probe;
    lines.push(segs([[-10, 0, 0], [10, 0, 0], [0, -10, 0], [0, 10, 0], [0, 0, -10], [0, 0, 10]], baseColor));
    const size = ((e.components.reflectionProbe as { size?: number[] }).size ?? [256, 128, 256]) as [number, number, number];
    const l = new THREE.LineSegments(boxEdges(new THREE.Vector3(...size), new THREE.Vector3()), new THREE.LineBasicMaterial({ color: baseColor, transparent: true, opacity: 0.35 }));
    lines.push(l);
    pick = new THREE.Mesh(new THREE.SphereGeometry(12, 8, 6), pickMat);
  } else if (e.components.playerSpawn) {
    baseColor = COLORS.spawn;
    lines.push(segs(spawnLines(), baseColor));
    pick = new THREE.Mesh(new THREE.BoxGeometry(32, 72, 32).translate(0, 36, 0), pickMat);
  } else if (light) {
    baseColor = COLORS.light;
    lines.push(segs(bulbLines(), baseColor));
    if (light.kind === 'point') {
      const r = light.range ?? 512;
      const l = segs([...circle(r, 'y', 64)], baseColor);
      (l.material as THREE.LineBasicMaterial).opacity = 0.18;
      lines.push(l);
    } else if (light.kind === 'spot') {
      const len = Math.min(light.range ?? 512, 256);
      const rad = Math.tan(THREE.MathUtils.degToRad((light.angle ?? 40) / 2)) * len;
      const ring = circle(rad, 'z', 32).map((p) => [p[0]!, p[1]!, -len]);
      const spokes = [
        [rad, 0],
        [-rad, 0],
        [0, rad],
        [0, -rad],
      ].flatMap(([x, y]) => [
        [0, 0, 0],
        [x!, y!, -len],
      ]);
      const l = segs([...ring, ...spokes], baseColor);
      (l.material as THREE.LineBasicMaterial).opacity = 0.35;
      lines.push(l);
    } else {
      // Directional light: a short ray along its −Z axis.
      const l = segs(
        [
          [0, 0, 0],
          [0, 0, -96],
          [0, 0, -96],
          [-8, 0, -84],
          [0, 0, -96],
          [8, 0, -84],
        ],
        baseColor,
      );
      lines.push(l);
    }
    pick = new THREE.Mesh(new THREE.SphereGeometry(14, 8, 6), pickMat);
  } else {
    lines.push(
      segs(
        [
          [-16, 0, 0],
          [16, 0, 0],
          [0, -16, 0],
          [0, 16, 0],
          [0, 0, -16],
          [0, 0, 16],
        ],
        baseColor,
      ),
    );
    pick = new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), pickMat);
  }
  for (const l of lines) group.add(l);
  pick.userData.entityId = e.id;
  group.add(pick);
  if (e.components.googlyEyes) {
    eyes = buildGooglyEyes(readComponent<GooglyEyesData>('googlyEyes', e.components.googlyEyes));
    group.add(eyes.object);
  }
  return { group, lines, pick, baseColor, box, eyes };
}

/** The 12 edges of a box of `size` round `center` (a hair bigger, so it isn't hidden in the model's surface). */
function boxEdges(size: THREE.Vector3, center: THREE.Vector3): THREE.BufferGeometry {
  const pad = 1.02;
  const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(8, size.x) * pad, Math.max(8, size.y) * pad, Math.max(8, size.z) * pad));
  return g.translate(center.x, center.y, center.z);
}

export function setMarkerSelected(m: Marker, selected: boolean): void {
  for (const l of m.lines) (l.material as THREE.LineBasicMaterial).color.setHex(selected ? COLORS.selected : m.baseColor);
  if (m.box) m.box.visible = selected;
}

export function disposeMarker(m: Marker): void {
  m.group.userData.disposed = true;
  (m.group.userData.dispose as (() => void) | undefined)?.();
  m.eyes?.dispose();
  m.group.traverse((o) => {
    // (Signs dispose of themselves; googly eyes share one dome and dispose of their own materials.)
    if (o.name === 'sign' || o.name === 'googly-eye') return;
    for (let x: THREE.Object3D | null = o; x; x = x.parent) if (x.name === 'poster') return;
    // (Model meshes share geometry with the loaded file; only the clone's tree is dropped.)
    for (let x: THREE.Object3D | null = o; x; x = x.parent) if (x.name === 'model') return;
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const mat = o.material as THREE.Material;
      if (mat !== pickMat) mat.dispose();
    }
  });
}

/** Stable key for "does this marker need rebuilding" (shape-affecting data only). */
export function markerKey(e: EntityData): string {
  return JSON.stringify([e.components.light ?? null, !!e.components.playerSpawn, e.components.sign ?? null, e.components.poster ?? null, e.components.model ?? null, (e.components.npc as { side?: string } | undefined)?.side ?? null, e.components.reflectionProbe ?? null, e.components.googlyEyes ?? null]);
}
