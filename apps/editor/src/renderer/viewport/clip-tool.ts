/**
 * Clip tool (Hammer's clipper): draw a line across the selected brushes in any view; the cut runs through
 * that line and straight along the view's depth. The preview shows what stays (blue) and what goes (red).
 */
import { clipBrush, clipPlane, type Brush, type Plane, type V3 } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { edgeLines } from './world-render';

export type ClipKeep = 'both' | 'front' | 'back';

export interface ClipState {
  a: V3;
  b: V3;
  ready: boolean;
}

export class ClipTool {
  readonly group = new THREE.Group();
  a: V3 | null = null;
  b: V3 | null = null;
  keep: ClipKeep = 'both';
  /** Depth direction of the view the line was drawn in. */
  private along: V3 = [0, 1, 0];
  private brushes: { id: string; brush: Brush }[] = [];
  private keepMat = new THREE.LineBasicMaterial({ color: 0x4b9cff, depthTest: false, transparent: true });
  private dropMat = new THREE.LineBasicMaterial({ color: 0xff8a73, depthTest: false, transparent: true, opacity: 0.85 });
  private lineMat = new THREE.LineBasicMaterial({ color: 0xff5b8a, depthTest: false, transparent: true });
  private dotMat = new THREE.PointsMaterial({ color: 0xff5b8a, size: 9, sizeAttenuation: false, depthTest: false, transparent: true });

  constructor() {
    this.group.renderOrder = 25;
  }

  setBrushes(list: { id: string; brush: Brush }[]): void {
    this.brushes = list;
    this.redraw();
  }

  start(p: V3, along: V3): void {
    this.a = [...p];
    this.b = [...p];
    this.along = along;
    this.redraw();
  }

  moveEnd(p: V3): void {
    if (!this.a) return;
    this.b = [...p];
    this.redraw();
  }

  clear(): void {
    this.a = this.b = null;
    this.redraw();
  }

  plane(): Plane | null {
    return this.a && this.b ? clipPlane(this.a, this.b, this.along) : null;
  }

  get state(): ClipState | null {
    return this.a && this.b ? { a: this.a, b: this.b, ready: !!this.plane() } : null;
  }

  cycleKeep(): void {
    this.keep = this.keep === 'both' ? 'front' : this.keep === 'front' ? 'back' : 'both';
    this.redraw();
  }

  setKeep(k: ClipKeep): void {
    this.keep = k;
    this.redraw();
  }

  redraw(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c instanceof THREE.Line || c instanceof THREE.Points) c.geometry.dispose();
    }
    if (!this.a || !this.b) return;
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...this.a), new THREE.Vector3(...this.b)]);
    const ends = new THREE.Points(g.clone(), this.dotMat);
    const line = new THREE.Line(g, this.lineMat);
    for (const o of [line, ends]) {
      o.renderOrder = 26;
      o.frustumCulled = false;
      this.group.add(o);
    }
    const p = this.plane();
    if (!p) return;
    for (const { brush } of this.brushes) {
      const r = clipBrush(brush, p);
      if (!r.cut) continue;
      for (const [piece, side] of [[r.front, 'front'], [r.back, 'back']] as const) {
        if (!piece) continue;
        const kept = this.keep === 'both' || this.keep === side;
        const l = edgeLines(piece, kept ? this.keepMat : this.dropMat, true);
        l.renderOrder = 26;
        this.group.add(l);
      }
    }
  }

  dispose(): void {
    this.clear();
    for (const m of [this.keepMat, this.dropMat, this.lineMat, this.dotMat]) m.dispose();
  }
}
