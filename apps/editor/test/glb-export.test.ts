// Selected brushes and groups written as a .glb: hierarchy, live subtract, tool faces left out, units and origin.
import { beforeAll, describe, expect, it } from 'vitest';
import { SceneDoc, newEntity, newScene, type EntityData } from '@cocoaworlds/core';
import { box, defaultSurface, toData, type V3 } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildExportScene, exportedBrushIds, glbFileName, toGlb, type GlbOptions } from '../src/renderer/viewport/glb-export';

// GLTFExporter reads its blobs with FileReader, which Node doesn't have.
beforeAll(() => {
  const g = globalThis as unknown as { FileReader?: unknown };
  if (g.FileReader) return;
  g.FileReader = class {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(b: Blob) {
      void b.arrayBuffer().then((a) => {
        this.result = a;
        this.onloadend?.();
      });
    }
    readAsDataURL(b: Blob) {
      void b.arrayBuffer().then((a) => {
        this.result = `data:${b.type};base64,${Buffer.from(a).toString('base64')}`;
        this.onloadend?.();
      });
    }
  };
});

const brush = (name: string, min: V3, max: V3, role = 'solid', material = 'dev/grid') =>
  newEntity(name, { brush: { role, faces: toData(box(min, max, defaultSurface(material))).faces } as never });

function scene() {
  const s = newScene('yard');
  const shed = newEntity('Shed', { group: {} });
  const floor = brush('Floor', [0, 0, 0], [128, 16, 128]);
  const wall = brush('Wall', [0, 16, 0], [128, 128, 16], 'solid', 'dev/orange');
  const roofs = newEntity('Roofs', { group: {} });
  const roof = brush('Roof', [0, 128, 0], [128, 144, 128]);
  const col = brush('Collider', [0, 0, 0], [16, 16, 16], 'solid', 'tool/col');
  const door = brush('Doorway', [32, 16, -8], [64, 96, 24], 'subtract', 'dev/subtract');
  const elsewhere = brush('Elsewhere', [1000, 0, 0], [1064, 64, 64]);
  floor.parent = wall.parent = roofs.parent = col.parent = shed.id;
  roof.parent = roofs.id;
  s.entities = [shed, floor, wall, roofs, roof, col, door, elsewhere];
  return { doc: new SceneDoc(s), shed, floor, wall, roof, col, door, elsewhere };
}

const opts = (o: Partial<GlbOptions> = {}): GlbOptions => ({ units: 'units', origin: 'scene', merge: false, ...o });
const meshes = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse((x) => x instanceof THREE.Mesh && out.push(x));
  return out;
};
const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);

describe('export brushes as GLB', () => {
  it('writes the solid brushes under a group, as a tree of its groups', () => {
    const { doc, shed, col } = scene();
    expect(exportedBrushIds(doc, [shed.id]).length).toBe(3); // floor, wall, roof; not the all-COL collider
    const root = buildExportScene(doc, [shed.id], opts());
    expect(root.name).toBe('Shed');
    expect(root.children.map((c) => c.name)).toEqual(['Floor', 'Wall', 'Roofs']);
    expect(root.children[2]!.children.map((c) => c.name)).toEqual(['Roof']);
    expect(meshes(root).some((m) => m.name === col.name)).toBe(false);
  });

  it('cuts with live subtract brushes and leaves zones out', () => {
    const { doc, wall } = scene();
    const root = buildExportScene(doc, [wall.id], opts());
    const [m] = meshes(root);
    // A wall with a doorway has more than a box's 12 triangles, and no subtract faces.
    expect(m!.geometry.index!.count / 3).toBeGreaterThan(12);
    expect((m!.material as THREE.Material[]).map((x) => x.name)).toEqual(['dev/orange']);
  });

  it('scales to metres and puts the bottom centre at the origin', () => {
    const { doc, floor } = scene();
    const b = boxOf(buildExportScene(doc, [floor.id], opts({ units: 'metres', origin: 'selection' })));
    expect(b.min.y).toBeCloseTo(0);
    expect(b.min.x).toBeCloseTo(-64 / 39.37, 3);
    expect(b.max.x).toBeCloseTo(64 / 39.37, 3);
    expect(b.max.y).toBeCloseTo(16 / 39.37, 3);
  });

  it('merges into one mesh when asked, dropping faces hidden between brushes', () => {
    const { doc, shed } = scene();
    const apart = meshes(buildExportScene(doc, [shed.id], opts())).reduce((n, m) => n + m.geometry.index!.count, 0);
    const merged = meshes(buildExportScene(doc, [shed.id], opts({ merge: true })));
    expect(merged.length).toBe(1);
    expect(merged[0]!.geometry.index!.count).toBeLessThan(apart);
  });

  it('several objects selected sit side by side under one root', () => {
    const { doc, roof, elsewhere } = scene();
    const root = buildExportScene(doc, [roof.id, elsewhere.id], opts());
    expect(root.children.map((c) => c.name)).toEqual(['Roof', 'Elsewhere']);
  });

  it('refuses when nothing selected can be written', () => {
    const { doc, col, door } = scene();
    expect(() => buildExportScene(doc, [col.id, door.id], opts())).toThrow(/Nothing to export/);
    expect(() => buildExportScene(doc, [], opts())).toThrow(/Nothing to export/);
  });

  it('writes a valid GLB with every node and material', async () => {
    const { doc, shed } = scene();
    const bytes = await toGlb(buildExportScene(doc, [shed.id], opts({ units: 'metres', origin: 'selection' })));
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(v.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
    expect(v.getUint32(4, true)).toBe(2);
    expect(v.getUint32(8, true)).toBe(bytes.byteLength);
    const jsonLen = v.getUint32(12, true);
    expect(v.getUint32(16, true)).toBe(0x4e4f534a); // 'JSON'
    const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as {
      nodes: { name: string }[];
      meshes: { primitives: { attributes: { POSITION: number } }[] }[];
      materials: { name: string }[];
      accessors: { min?: number[]; max?: number[]; type: string }[];
    };
    expect(gltf.nodes.map((n) => n.name).sort()).toEqual(['Floor', 'Roof', 'Roofs', 'Shed', 'Wall']);
    expect(gltf.meshes.length).toBe(3);
    expect(gltf.materials.map((m) => m.name).sort()).toEqual(['dev/grid', 'dev/orange']);
    const ys = gltf.meshes.flatMap((m) => m.primitives.map((p) => gltf.accessors[p.attributes.POSITION]!.min![1]!));
    expect(Math.min(...ys)).toBeCloseTo(0);
  });

  it('reads back with the same shape', async () => {
    const { doc, shed } = scene();
    const made = buildExportScene(doc, [shed.id], opts({ units: 'metres', origin: 'selection' }));
    const bytes = await toGlb(made);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
    const a = boxOf(made);
    const b = boxOf(gltf.scene);
    expect(b.min.distanceTo(a.min)).toBeLessThan(1e-4);
    expect(b.max.distanceTo(a.max)).toBeLessThan(1e-4);
    expect(gltf.scene.getObjectByName('Roof')).toBeTruthy();
  });

  it("leaves the view's shader data and unloaded maps out of the file", async () => {
    const { doc, floor } = scene();
    const view = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const loop: Record<string, unknown> = { tex: new THREE.Texture() };
    loop.self = loop;
    view.userData = { shading: loop };
    view.map = new THREE.Texture(); // still loading: no image
    const root = buildExportScene(doc, [floor.id], opts(), () => view);
    const m = (meshes(root)[0]!.material as THREE.MeshStandardMaterial[])[0]!;
    expect(m).not.toBe(view);
    expect(m.map).toBeNull();
    expect(m.userData).toEqual({});
    expect(view.userData.shading).toBe(loop);
    expect(view.map).not.toBeNull();
    const bytes = await toGlb(root);
    expect(new TextDecoder().decode(bytes)).not.toContain('extras');
  });

  it('names the file after the one object chosen, or the scene', () => {
    const { doc, shed, floor } = scene();
    expect(glbFileName(doc, [shed.id], 'yard')).toBe('Shed.glb');
    expect(glbFileName(doc, [shed.id, floor.id], 'yard')).toBe('yard.glb');
    const odd = newEntity('a/b:c', {}) as EntityData;
    doc.insert([odd]);
    expect(glbFileName(doc, [odd.id], 'yard')).toBe('a_b_c.glb');
  });
});
