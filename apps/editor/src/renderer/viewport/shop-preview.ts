/**
 * Shop previews: an object (with everything inside it) drawn once from above at an angle, as the game shows it
 * (brushes with their materials, models), on a transparent background. Used by the computer's shop.
 */
import { readComponent, type ModelData, type SceneDoc } from '@cocoaworlds/core';
import { buildMesh, type Brush } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { worldBrushOf } from '../brush/brushes';
import { modelInstance, type ModelInstance } from './models';
import { toGeometry } from './world-render';

const SIZE = 256;
let renderer: THREE.WebGLRenderer | null = null;
/** One at a time: they share the renderer. */
let queue: Promise<unknown> = Promise.resolve();

/** The object `id` and everything under it. */
function subtree(doc: SceneDoc, id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of doc.children(out[i]!)) out.push(c.id);
  return out;
}

/** A PNG data URL of the object (''  : nothing to draw, or no WebGL). */
export function renderShopPreview(doc: SceneDoc, id: string, material: (name: string, tint?: string) => THREE.Material): Promise<string> {
  const job = queue.then(() => draw(doc, id, material)).catch(() => '');
  queue = job;
  return job;
}

async function draw(doc: SceneDoc, id: string, material: (name: string, tint?: string) => THREE.Material): Promise<string> {
  const ids = subtree(doc, id);
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const models: ModelInstance[] = [];
  try {
    // Brushes (solid ones: no zones or tool faces), in world space.
    const brushes: Brush[] = [];
    for (const x of ids) {
      const e = doc.get(x);
      if (!e?.components.brush || e.components.trigger || e.components.noRender || e.components.water || e.components.soundArea || e.components.levelChange) continue;
      const b = worldBrushOf(doc, e);
      if (b && b.role === 'solid') brushes.push(b.brush);
    }
    if (brushes.length) {
      const m = buildMesh(brushes);
      const geo = toGeometry(m);
      geos.push(geo);
      group.add(new THREE.Mesh(geo, m.groups.map((g) => material(g.material, g.tint))));
    }
    // Models, placed like their objects.
    await Promise.all(
      ids.map(async (x) => {
        const e = doc.get(x);
        if (!e?.components.model) return;
        const data = readComponent<ModelData>('model', e.components.model);
        if (!data.model) return;
        const inst = await modelInstance(data).catch(() => null);
        if (!inst) return;
        models.push(inst);
        const holder = new THREE.Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.fromArray(doc.worldMatrix(x));
        holder.add(inst.object);
        group.add(holder);
      }),
    );
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return '';

    renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 2, 1.5);
    scene.add(sun, group);
    // Centred, seen from the front-right and above, filling most of the picture.
    const centre = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    const cam = new THREE.PerspectiveCamera(30, 1, r * 0.05, r * 20);
    const dir = new THREE.Vector3(0.9, 0.7, 1.2).normalize();
    cam.position.copy(centre).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05);
    cam.lookAt(centre);
    renderer.render(scene, cam);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    for (const g of geos) g.dispose();
    for (const m of models) m.dispose();
  }
}
