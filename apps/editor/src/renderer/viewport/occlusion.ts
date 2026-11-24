import * as THREE from 'three';
import { polygons, type Brush, type BrushMesh } from '@cocoaworlds/geometry';

interface Face {
  points: THREE.Vector3[];
  center: THREE.Vector3;
  front: THREE.Plane;
  sides: THREE.Plane[];
  material: THREE.Material;
  area: number;
}

// Only convex brush faces that actually contributed triangles to the finished level.
export function blockingFaces(pieces: Brush[], mesh: BrushMesh, materials: THREE.Material[]): Face[] {
  const drawn = pieces.map(() => new Map<number, THREE.Material>());
  mesh.groups.forEach((g, i) => {
    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++)
      drawn[mesh.triangleBrushes[t]!]!.set(mesh.triangleFaces[t]!, materials[i]!);
  });
  const faces: Face[] = [];
  pieces.forEach((piece, i) => {
    if (piece.mesh) return; // Editable polygon meshes can be concave.
    for (const poly of polygons(piece)) {
      const material = drawn[i]!.get(poly.face);
      if (!material) continue;
      const points = poly.points.map(p => new THREE.Vector3(...p));
      const center = new THREE.Vector3();
      for (const p of points) center.add(p);
      center.divideScalar(points.length);
      const front = new THREE.Plane(new THREE.Vector3(...poly.plane.n), -poly.plane.d);
      let area = 0;
      for (let j = 1; j + 1 < points.length; j++)
        area += new THREE.Triangle(points[0], points[j], points[j + 1]).getArea();
      if (area >= 256) faces.push({ points, center, front, material, area, sides: points.map(() => new THREE.Plane()) });
    }
  });
  return faces.sort((a, b) => b.area - a.area).slice(0, 192);
}

export class CameraOcclusion {
  faces: Face[] = [];
  private active: Face[] = [];
  private view = new THREE.Frustum();
  private projection = new THREE.Matrix4();
  private eye = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private spare = new THREE.Vector3();
  private bounds = new THREE.Box3();
  private skipped: { mesh: THREE.Mesh; mask: number }[] = [];
  private overlay = new THREE.Scene();

  begin(camera: THREE.Camera): void {
    camera.updateWorldMatrix(true, false);
    this.view.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldDirection(this.direction);
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    this.active.length = 0;
    for (const f of this.faces) {
      const m = f.material as THREE.MeshPhysicalMaterial;
      if (!m.visible || m.transparent || m.opacity < 1 || m.alphaTest || m.alphaHash || m.transmission || m.wireframe ||
          m.displacementMap || !m.depthWrite || !m.colorWrite || m.side === THREE.BackSide || m.clippingPlanes?.length) continue;
      if (ortho ? f.front.normal.dot(this.direction) >= -0.0001 : f.front.distanceToPoint(this.eye) <= 0.01) continue;
      if (f.points.some(p => this.view.planes[5]!.distanceToPoint(p) <= 0.01)) continue;
      if (this.view.planes.some(plane => f.points.every(p => plane.distanceToPoint(p) < 0))) continue;
      for (let i = 0; i < f.points.length; i++) {
        const a = f.points[i]!, b = f.points[(i + 1) % f.points.length]!;
        const side = f.sides[i]!.setFromCoplanarPoints(a, b, ortho ? this.spare.copy(a).add(this.direction) : this.eye);
        if (side.distanceToPoint(f.center) < 0) side.negate();
      }
      this.active.push(f);
      if (this.active.length === 24) break;
    }
  }

  get ready(): boolean { return this.active.length > 0; }

  consider(mesh: THREE.Mesh, camera: THREE.Camera, debug: boolean): void {
    if (!mesh.layers.test(camera.layers) || !mesh.frustumCulled || (mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences) return;
    for (let o: THREE.Object3D | null = mesh; o; o = o.parent) if (!o.visible) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!mats.some(m => m.visible) || mats.some(m => !m.depthTest || (m as THREE.MeshStandardMaterial).displacementMap || (m as THREE.ShaderMaterial).isShaderMaterial)) return;
    const inst = mesh as THREE.InstancedMesh;
    const shape = inst.isInstancedMesh ? inst : mesh.geometry;
    if (!shape.boundingBox) shape.computeBoundingBox();
    mesh.updateWorldMatrix(true, false);
    const box = this.bounds.copy(shape.boundingBox!).applyMatrix4(mesh.matrixWorld);
    if (box.isEmpty() || !this.view.intersectsBox(box)) return;
    // The least distance over the entire box must clear every silhouette edge.
    const minimum = (p: THREE.Plane) => p.distanceToPoint(this.spare.set(
      p.normal.x >= 0 ? box.min.x : box.max.x, p.normal.y >= 0 ? box.min.y : box.max.y, p.normal.z >= 0 ? box.min.z : box.max.z));
    if (!this.active.some(f => -maximumDistance(f.front, box) > 0.1 && f.sides.every(p => minimum(p) > 0.1))) return;
    if (debug) {
      const i = this.skipped.length;
      let helper = this.overlay.children[i] as THREE.Box3Helper | undefined;
      if (!helper) {
        helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xff3099));
        (helper.material as THREE.LineBasicMaterial).depthTest = false;
        this.overlay.add(helper);
      }
      helper.box.copy(box);
      helper.visible = true;
    }
    this.skipped.push({ mesh, mask: mesh.layers.mask });
    mesh.layers.mask = 0;
  }

  draw(renderer: THREE.WebGLRenderer, camera: THREE.Camera, debug: boolean, drawScene: () => void): void {
    const shadow = renderer.shadowMap;
    const renderShadow = shadow.render;
    const masks = (restore: boolean) => { for (const s of this.skipped) s.mesh.layers.mask = restore ? s.mask : 0; };
    if (this.skipped.length) shadow.render = (...args) => {
      masks(true);
      try { renderShadow.apply(shadow, args); } finally { masks(false); }
    };
    try {
      drawScene();
    } finally {
      masks(true);
      shadow.render = renderShadow;
      this.skipped.length = 0;
    }
    if (debug && this.overlay.children.some(o => o.visible)) {
      const clear = renderer.autoClear;
      renderer.autoClear = false;
      try { renderer.render(this.overlay, camera); } finally { renderer.autoClear = clear; }
    }
    for (const helper of this.overlay.children) helper.visible = false;
  }

  dispose(): void {
    for (const helper of this.overlay.children) (helper as THREE.Box3Helper).dispose();
  }
}

function maximumDistance(p: THREE.Plane, b: THREE.Box3): number {
  return p.constant + p.normal.x * (p.normal.x >= 0 ? b.max.x : b.min.x)
    + p.normal.y * (p.normal.y >= 0 ? b.max.y : b.min.y) + p.normal.z * (p.normal.z >= 0 ? b.max.z : b.min.z);
}
