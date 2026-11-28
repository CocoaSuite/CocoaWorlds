import * as THREE from 'three';
import { isInvisibleMaterial, type MeshGroup } from '@cocoaworlds/geometry';

type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material[]>;
type Span = { start: number; count: number; face: MeshGroup };
type Layer = { mesh: THREE.InstancedMesh; current: THREE.Color; from: THREE.Color };
type BrushView = { source: Mesh; spans: Span[]; layers?: Layer[] };
type Fade = { layers: Layer[]; to: THREE.Color; start: number; duration: number };

/** Keep the original batching until a script changes a brush. Each affected material range
 * then gets its own instance color, while textures and materials stay shared. */
export class BrushLooks {
  private views = new Map<string, BrushView>();
  private owners = new Map<THREE.Object3D, Set<string>>();
  private fades = new Map<string, Fade>();

  constructor(private material: (name: string) => THREE.Material) {}

  track(source: Mesh, groups: MeshGroup[], triangleOwners: string[]): void {
    const ids = new Set<string>();
    for (const face of groups) {
      if (isInvisibleMaterial(face.material)) continue;
      const end = face.start + face.count;
      for (let start = face.start; start < end;) {
        const id = triangleOwners[start / 3]!;
        let next = start + 3;
        while (next < end && triangleOwners[next / 3] === id) next += 3;
        let view = this.views.get(id);
        if (!view) this.views.set(id, view = { source, spans: [] });
        view.spans.push({ start, count: next - start, face });
        ids.add(id);
        start = next;
      }
    }
    this.owners.set(source, ids);
  }

  private layers(id: string): Layer[] {
    const view = this.views.get(id);
    if (!view) return [];
    if (view.layers) return view.layers;
    const { source, spans } = view;
    const geometry = source.geometry;
    // Remove just these ranges from the batched draw. Adjacent brushes, cut faces,
    // UVs, normals and collision retain their original geometry.
    const groups = geometry.groups.slice();
    geometry.clearGroups();
    let i = 0;
    for (const g of groups) {
      const end = g.start + g.count;
      let start = g.start;
      while (i < spans.length && spans[i]!.start < end) {
        const span = spans[i++]!;
        if (start < span.start) geometry.addGroup(start, span.start - start, g.materialIndex);
        start = span.start + span.count;
      }
      if (start < end) geometry.addGroup(start, end - start, g.materialIndex);
    }
    const layers: Layer[] = [];
    for (const span of spans) {
      const part = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(geometry.attributes)) part.setAttribute(name, attr);
      part.setIndex(geometry.index);
      part.setDrawRange(span.start, span.count);
      // The parent bounds cover the whole batch and are conservative for each range.
      part.boundingSphere = geometry.boundingSphere;
      const mesh = new THREE.InstancedMesh(part, this.material(span.face.material), 1);
      const current = new THREE.Color(span.face.tint ?? '#ffffff');
      mesh.setColorAt(0, current);
      mesh.castShadow = source.castShadow;
      mesh.receiveShadow = source.receiveShadow;
      source.add(mesh);
      layers.push({ mesh, current, from: current.clone() });
    }
    return view.layers = layers;
  }

  setMaterial(id: string, name: string): void {
    for (const layer of this.layers(id)) layer.mesh.material = this.material(name);
  }

  tint(id: string, color: string, time: number, duration: number): void {
    const layers = this.layers(id);
    if (!layers.length) return;
    const old = this.fades.get(id);
    if (old) this.sample(old, time);
    for (const layer of layers) layer.from.copy(layer.current);
    const fade = { layers, to: new THREE.Color(color), start: time, duration };
    if (duration > 0) this.fades.set(id, fade);
    else {
      this.sample(fade, time);
      this.fades.delete(id);
    }
  }

  private sample(fade: Fade, time: number): boolean {
    const t = fade.duration ? THREE.MathUtils.clamp((time - fade.start) / fade.duration, 0, 1) : 1;
    for (const layer of fade.layers) {
      layer.current.lerpColors(layer.from, fade.to, t);
      layer.mesh.setColorAt(0, layer.current);
      layer.mesh.instanceColor!.needsUpdate = true;
    }
    return t === 1;
  }

  update(time: number): void {
    for (const [id, fade] of this.fades) if (this.sample(fade, time)) this.fades.delete(id);
  }

  forget(source: THREE.Object3D): void {
    for (const id of this.owners.get(source) ?? []) {
      for (const layer of this.views.get(id)?.layers ?? []) {
        layer.mesh.removeFromParent();
        layer.mesh.dispose();
        layer.mesh.geometry.dispose();
      }
      this.views.delete(id);
      this.fades.delete(id);
    }
    this.owners.delete(source);
  }

  dispose(): void {
    for (const source of this.owners.keys()) this.forget(source);
  }
}
