// Plain stand-ins for power things that have no model of their own (outlets, power sources, extension cords,
// string-light coils), shared by the editor and the game so they look the same in both. Flat, simple shapes.
import * as THREE from 'three';
import { readComponent, type ColliderData, type ComponentData, type StringLightsData } from '@cocoaworlds/core';

export interface PowerStandIn {
  object: THREE.Group;
  /** A power source's lamp (green on, red off). */
  lamp?: THREE.MeshBasicMaterial;
  /** The size it fills (for picking in the editor). */
  size: THREE.Vector3;
  center: THREE.Vector3;
  dispose(): void;
}

const DEFAULT_SIZE: Record<string, [number, number, number]> = {
  outlet: [8, 12, 2],
  powerSource: [32, 24, 24],
  extender: [16, 6, 10],
  stringLights: [12, 8, 12],
};

/** A stand-in for an object's power component, or null (it has a model, or isn't a power thing). */
export function powerStandIn(components: Record<string, ComponentData | undefined>): PowerStandIn | null {
  if (components.model || components.brush) return null;
  const kind = (['outlet', 'powerSource', 'extender', 'stringLights'] as const).find((k) => components[k]);
  if (!kind) return null;
  const c = readComponent<ColliderData>('collider', components.collider ?? { size: DEFAULT_SIZE[kind] });
  const [w, h, d] = c.size;
  const o = new THREE.Vector3(...c.offset);
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, at: [number, number, number] = [0, 0, 0]) => {
    geos.push(geo);
    if (!mats.includes(mat)) mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(o.x + at[0], o.y + at[1], o.z + at[2]);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const dark = new THREE.MeshBasicMaterial({ color: 0x2c2c2a });
  let lamp: THREE.MeshBasicMaterial | undefined;
  if (kind === 'outlet') {
    mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 }));
    const slot = new THREE.BoxGeometry(Math.max(0.4, w * 0.08), h * 0.22, 0.2);
    for (const x of [-w * 0.18, w * 0.18]) mesh(slot, dark, [x, 0, d / 2 + 0.1]);
  } else if (kind === 'powerSource') {
    mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x5f5e5a, roughness: 0.8 }));
    lamp = new THREE.MeshBasicMaterial({ color: 0x888780 });
    mesh(new THREE.BoxGeometry(w * 0.12, h * 0.12, 0.4), lamp, [w * 0.3, h * 0.3, d / 2 + 0.2]);
  } else if (kind === 'extender') {
    // A power strip: a pale block with a row of dark sockets on top.
    mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0xd3d1c7, roughness: 0.7 }));
    const n = 3;
    const sock = new THREE.BoxGeometry(Math.min(w / (n + 1.5), d * 0.5), 0.2, d * 0.45);
    for (let i = 0; i < n; i++) mesh(sock, dark, [(i - (n - 1) / 2) * (w / (n + 0.5)), h / 2 + 0.1, 0]);
  } else {
    // A coil of string lights: a flat ring of wire with a few bulbs on it.
    const data = readComponent<StringLightsData>('stringLights', components.stringLights);
    const r = Math.max(2, Math.min(w, d) / 2 - 1.5);
    const turns = Math.max(1, Math.round(h / 3));
    const wire = new THREE.MeshStandardMaterial({ color: 0x2c2c2a, roughness: 0.6 });
    for (let i = 0; i < turns; i++) {
      const ring = mesh(new THREE.TorusGeometry(r - (i % 2) * 0.8, 0.9, 6, 20), wire, [0, -h / 2 + 1 + (i * (h - 2)) / Math.max(1, turns - 1), 0]);
      ring.rotation.x = Math.PI / 2;
    }
    const bulb = new THREE.MeshStandardMaterial({ color: new THREE.Color(data.color), roughness: 0.5 });
    const bg = new THREE.IcosahedronGeometry(1.4, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      mesh(bg, bulb, [Math.cos(a) * r, h / 2 - 1.5, Math.sin(a) * r]);
    }
  }
  mats.push(dark);
  return {
    object: group,
    lamp,
    size: new THREE.Vector3(w, h, d),
    center: o,
    dispose() {
      for (const g of new Set(geos)) g.dispose();
      for (const m of new Set(mats)) m.dispose();
    },
  };
}
