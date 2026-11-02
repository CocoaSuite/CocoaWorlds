/**
 * The brush tool's in-progress shape: draw a footprint on a plane, then pull up the height, then confirm.
 * The draft is an axis-aligned box in world space; the chosen shape (box, cylinder, wedge, stairs) is built inside it.
 */
import { buildMesh, convexHull2D, type V3 } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { shapeBrushes, type DrawRole, type Outline, type ShapeOptions } from '../brush/brushes';
import type { ViewKind } from './camera';
import { edgeLines, toGeometry } from './world-render';

export type DraftStage = 'footprint' | 'height';

export interface DraftState {
  stage: DraftStage;
  min: V3;
  max: V3;
  /** Polygon drafts: corners placed so far (footprint stage). */
  corners?: number;
}

/** Axes for a view: the footprint lies on axes a and b, height goes along e. */
export function draftAxes(view: ViewKind): { a: 0 | 1 | 2; b: 0 | 1 | 2; e: 0 | 1 | 2 } {
  if (view === 'front') return { a: 0, b: 1, e: 2 };
  if (view === 'side') return { a: 2, b: 1, e: 0 };
  return { a: 0, b: 2, e: 1 };
}

export class BrushDraft {
  readonly group = new THREE.Group();
  stage: DraftStage = 'footprint';
  private axes: ReturnType<typeof draftAxes>;
  private start: V3;
  private end: V3;
  height: number;
  private fill = new THREE.MeshBasicMaterial({ color: 0x4b9cff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  private line = new THREE.LineBasicMaterial({ color: 0x4b9cff, depthTest: false, transparent: true });
  private closeLine = new THREE.LineBasicMaterial({ color: 0x4b9cff, depthTest: false, transparent: true, opacity: 0.35 });
  private dots = new THREE.PointsMaterial({ color: 0x4b9cff, size: 8, sizeAttenuation: false, depthTest: false, transparent: true });

  constructor(view: ViewKind, at: V3, defaultHeight: number) {
    this.axes = draftAxes(view);
    this.start = [...at];
    this.end = [...at];
    this.height = defaultHeight;
    this.group.renderOrder = 12;
  }

  /** Polygon mode: corners on the footprint plane (axes a, b); `cursor` is the corner being placed. */
  points: [number, number][] | null = null;
  private cursor: [number, number] | null = null;

  /** Start a polygon outline at `p`. */
  startPolygon(p: V3): void {
    const { a, b } = this.axes;
    this.points = [[p[a]!, p[b]!]];
    this.cursor = null;
  }

  addPoint(p: V3): void {
    const { a, b } = this.axes;
    this.points?.push([p[a]!, p[b]!]);
  }

  setCursor(p: V3 | null): void {
    const { a, b } = this.axes;
    this.cursor = p ? [p[a]!, p[b]!] : null;
  }

  removeLastPoint(): boolean {
    if (!this.points || this.points.length <= 1) return false;
    this.points.pop();
    return true;
  }

  /** Enough corners for a solid outline (three not in a line). */
  get canClose(): boolean {
    return !!this.points && convexHull2D(this.points).length >= 3;
  }

  /** Finish the outline and go to the height stage. */
  closePolygon(): boolean {
    if (!this.canClose) return false;
    this.points = convexHull2D(this.points!);
    this.cursor = null;
    this.stage = 'height';
    return true;
  }

  /** The outline for building (polygon drafts in the height stage). */
  outline(): Outline | null {
    return this.points && this.stage === 'height' ? { points: this.points.map((q) => [...q] as [number, number]), axes: this.axes } : null;
  }

  setEnd(p: V3): void {
    this.end = [...p];
    this.end[this.axes.e] = this.start[this.axes.e]!;
  }

  /** True when the footprint has area on both axes. */
  get hasArea(): boolean {
    const { a, b } = this.axes;
    return Math.abs(this.end[a]! - this.start[a]!) > 1e-6 && Math.abs(this.end[b]! - this.start[b]!) > 1e-6;
  }

  bounds(): { min: V3; max: V3 } {
    const { e } = this.axes;
    if (this.points) {
      const { a, b } = this.axes;
      const pts = this.cursor && this.stage === 'footprint' ? [...this.points, this.cursor] : this.points;
      const min: V3 = [...this.start], max: V3 = [...this.start];
      min[a] = Math.min(...pts.map((q) => q[0]));
      max[a] = Math.max(...pts.map((q) => q[0]));
      min[b] = Math.min(...pts.map((q) => q[1]));
      max[b] = Math.max(...pts.map((q) => q[1]));
      if (this.stage === 'height') {
        min[e] = Math.min(this.start[e]!, this.start[e]! + this.height);
        max[e] = Math.max(this.start[e]!, this.start[e]! + this.height);
      }
      return { min, max };
    }
    const p = [...this.end] as V3;
    if (this.stage === 'height') p[e] = this.start[e]! + this.height;
    const min: V3 = [Math.min(this.start[0], p[0]), Math.min(this.start[1], p[1]), Math.min(this.start[2], p[2])];
    const max: V3 = [Math.max(this.start[0], p[0]), Math.max(this.start[1], p[1]), Math.max(this.start[2], p[2])];
    return { min, max };
  }

  /** Replace the box with typed numbers from the panel. */
  setBounds(min: V3, max: V3): void {
    const { e } = this.axes;
    if (this.points && this.stage === 'height') {
      // Stretch the outline into the typed box so the shape is kept.
      const { a, b } = this.axes;
      const old = this.bounds();
      const map = (v: number, ax: number) => {
        const span = old.max[ax]! - old.min[ax]!;
        return span ? min[ax]! + ((v - old.min[ax]!) / span) * (max[ax]! - min[ax]!) : min[ax]!;
      };
      this.points = this.points.map((q) => [map(q[0], a), map(q[1], b)]);
      this.start[e] = min[e]!;
      this.height = max[e]! - min[e]!;
      return;
    }
    this.start = [...min];
    this.end = [...max];
    this.end[e] = min[e]!;
    this.height = max[e]! - min[e]!;
    this.stage = 'height';
  }

  state(): DraftState {
    const { min, max } = this.bounds();
    return { stage: this.stage, min, max, corners: this.points?.length };
  }

  /** Rebuild the preview for the current shape options and role. */
  update(opts: ShapeOptions, role: DrawRole): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const color = role === 'subtract' ? 0xff8a73 : role === 'trigger' ? 0xf0a442 : role === 'collider' ? 0xc04ad0 : role === 'water' ? 0x4fb3e0 : role === 'ladder' ? 0x7fcf5a : 0x4b9cff;
    this.fill.color.setHex(color);
    this.line.color.setHex(color);
    const { min, max } = this.bounds();
    if (this.points && this.stage === 'footprint') {
      // Outline so far, plus the rubber band to the cursor and back to the first corner.
      const { a, b, e } = this.axes;
      const at = (q: [number, number]) => {
        const v = new THREE.Vector3();
        v.setComponent(a, q[0]);
        v.setComponent(b, q[1]);
        v.setComponent(e, this.start[e]!);
        return v;
      };
      const pts = this.cursor ? [...this.points, this.cursor] : this.points;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(at)), this.line);
      this.group.add(line);
      if (pts.length >= 3) {
        const close = new THREE.Line(new THREE.BufferGeometry().setFromPoints([at(pts[pts.length - 1]!), at(pts[0]!)]), this.closeLine);
        this.group.add(close);
      }
      const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(this.points.map(at)), this.dots);
      this.group.add(dots);
      return;
    }
    const flat = [0, 1, 2].some((i) => Math.abs(max[i]! - min[i]!) < 1e-6);
    if (flat) {
      // Footprint only: draw its rectangle.
      const { a, b } = this.axes;
      const r = [min, [...min], max, [...min]] as V3[];
      r[1]![a] = max[a]!;
      r[3]![b] = max[b]!;
      const g = new THREE.BufferGeometry().setFromPoints([r[0]!, r[1]!, r[1]!, r[2]!, r[2]!, r[3]!, r[3]!, r[0]!].map((p) => new THREE.Vector3(...p)));
      this.group.add(new THREE.LineSegments(g, this.line));
      return;
    }
    try {
      const brushes = shapeBrushes(opts, min, max, role, this.outline() ?? undefined);
      const m = buildMesh(brushes);
      this.group.add(new THREE.Mesh(toGeometry(m), this.fill));
      for (const b of brushes) {
        const l = edgeLines(b, this.line, true);
        this.group.add(l);
      }
    } catch {
      /* shape not buildable at this size yet */
    }
  }

  dispose(): void {
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
    this.fill.dispose();
    this.line.dispose();
    this.closeLine.dispose();
    this.dots.dispose();
  }
}
