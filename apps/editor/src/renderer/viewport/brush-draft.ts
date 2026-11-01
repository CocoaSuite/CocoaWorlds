/**
 * The brush tool's in-progress shape: draw a footprint on a plane, then pull up the height, then confirm.
 * The draft is an axis-aligned box in world space; the chosen shape (box, cylinder, wedge, stairs) is built inside it.
 */
import { buildMesh, type V3 } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { shapeBrushes, type ShapeOptions } from '../brush/brushes';
import type { ViewKind } from './camera';
import { edgeLines, toGeometry } from './world-render';

export type DraftStage = 'footprint' | 'height';

export interface DraftState {
  stage: DraftStage;
  min: V3;
  max: V3;
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

  constructor(view: ViewKind, at: V3, defaultHeight: number) {
    this.axes = draftAxes(view);
    this.start = [...at];
    this.end = [...at];
    this.height = defaultHeight;
    this.group.renderOrder = 12;
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
    const p = [...this.end] as V3;
    if (this.stage === 'height') p[e] = this.start[e]! + this.height;
    const min: V3 = [Math.min(this.start[0], p[0]), Math.min(this.start[1], p[1]), Math.min(this.start[2], p[2])];
    const max: V3 = [Math.max(this.start[0], p[0]), Math.max(this.start[1], p[1]), Math.max(this.start[2], p[2])];
    return { min, max };
  }

  /** Replace the box with typed numbers from the panel. */
  setBounds(min: V3, max: V3): void {
    const { e } = this.axes;
    this.start = [...min];
    this.end = [...max];
    this.end[e] = min[e]!;
    this.height = max[e]! - min[e]!;
    this.stage = 'height';
  }

  state(): DraftState {
    const { min, max } = this.bounds();
    return { stage: this.stage, min, max };
  }

  /** Rebuild the preview for the current shape options and role. */
  update(opts: ShapeOptions, role: 'solid' | 'subtract'): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const color = role === 'subtract' ? 0xf0a442 : 0x4b9cff;
    this.fill.color.setHex(color);
    this.line.color.setHex(color);
    const { min, max } = this.bounds();
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
      const brushes = shapeBrushes(opts, min, max, role);
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
  }
}
