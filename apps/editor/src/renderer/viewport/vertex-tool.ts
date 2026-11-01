/**
 * Vertex tool: shows the corners and edge midpoints of the selected brushes, lets the user pick corners
 * (click, Ctrl+click, box), and moves the picked corners with the gizmo. Picking an edge midpoint picks both
 * of its corners, which is how edges are edited. Bent faces split into triangles (decision G2); moves that
 * would dent or flatten a brush are refused and the last good position is kept.
 */
import { edges, moveVertices, vertices, type Brush, type V3 } from '@cocoaworlds/geometry';
import * as THREE from 'three';

const PICK_PX = 9;
const same = (a: V3, b: V3) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3;

export interface VertexBrush {
  id: string;
  brush: Brush;
}

export type ScreenFn = (p: V3) => { x: number; y: number; z: number };

export class VertexTool {
  readonly group = new THREE.Group();
  private brushes: VertexBrush[] = [];
  /** Picked corners per brush id (world positions). */
  private picked = new Map<string, V3[]>();
  private corners: THREE.Points;
  private pickedPts: THREE.Points;
  private mids: THREE.Points;
  /** During a drag: the brushes as they were, and the last move that worked. */
  private drag: { originals: VertexBrush[]; good: V3 } | null = null;
  lastRefusal: 'collapsed' | null = null;
  /** The last drag turned a normal brush into an edited mesh (G4). */
  madeMesh = false;

  constructor() {
    const mat = (color: number, size: number) => new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, transparent: true });
    this.corners = new THREE.Points(new THREE.BufferGeometry(), mat(0xececec, 8));
    this.pickedPts = new THREE.Points(new THREE.BufferGeometry(), mat(0x4b9cff, 10));
    this.mids = new THREE.Points(new THREE.BufferGeometry(), mat(0x8f8f8f, 6));
    for (const p of [this.mids, this.corners, this.pickedPts]) {
      p.frustumCulled = false;
      p.renderOrder = 30;
      this.group.add(p);
    }
    this.pickedPts.renderOrder = 31;
  }

  /** The brushes being edited (the selected, visible, unlocked brushes). Keeps picks that still exist. */
  setBrushes(list: VertexBrush[]): void {
    this.brushes = list;
    if (this.drag) return this.redraw();
    const next = new Map<string, V3[]>();
    for (const b of list) {
      const vs = vertices(b.brush);
      const keep = (this.picked.get(b.id) ?? []).filter((p) => vs.some((v) => same(v, p)));
      if (keep.length) next.set(b.id, keep);
    }
    this.picked = next;
    this.redraw();
  }

  get count(): number {
    let n = 0;
    for (const v of this.picked.values()) n += v.length;
    return n;
  }

  clearPicks(): void {
    this.picked.clear();
    this.redraw();
  }

  /** Corners of every edited brush, and edge midpoints with the two corners each stands for. */
  private handles(): { id: string; at: V3; corners: V3[] }[] {
    const out: { id: string; at: V3; corners: V3[] }[] = [];
    for (const b of this.brushes) {
      for (const v of vertices(b.brush)) out.push({ id: b.id, at: v, corners: [v] });
      const { verts, edges: es } = edges(b.brush);
      for (const [i, j] of es) {
        const a = verts[i]!, c = verts[j]!;
        out.push({ id: b.id, at: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], corners: [a, c] });
      }
    }
    return out;
  }

  /** Pick the handle under a client point. Returns false when nothing is there. */
  pickAt(x: number, y: number, additive: boolean, screen: ScreenFn): boolean {
    let best: { id: string; corners: V3[] } | null = null;
    let bestD = PICK_PX;
    for (const h of this.handles()) {
      const s = screen(h.at);
      if (s.z >= 1) continue;
      // Corners win over midpoints at the same spot.
      const d = Math.hypot(s.x - x, s.y - y) + (h.corners.length > 1 ? 0.5 : 0);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (!best) return false;
    if (!additive) this.picked.clear();
    const list = this.picked.get(best.id) ?? [];
    const allIn = best.corners.every((c) => list.some((p) => same(p, c)));
    const next = additive && allIn ? list.filter((p) => !best!.corners.some((c) => same(c, p))) : [...list, ...best.corners.filter((c) => !list.some((p) => same(p, c)))];
    if (next.length) this.picked.set(best.id, next);
    else this.picked.delete(best.id);
    this.redraw();
    return true;
  }

  /** Pick every corner inside a client-space rectangle. */
  pickBox(r: { x0: number; y0: number; x1: number; y1: number }, additive: boolean, screen: ScreenFn): void {
    if (!additive) this.picked.clear();
    for (const b of this.brushes) {
      const list = this.picked.get(b.id) ?? [];
      for (const v of vertices(b.brush)) {
        const s = screen(v);
        if (s.z >= 1 || s.x < r.x0 || s.x > r.x1 || s.y < r.y0 || s.y > r.y1) continue;
        if (!list.some((p) => same(p, v))) list.push(v);
      }
      if (list.length) this.picked.set(b.id, list);
    }
    this.redraw();
  }

  /** Centre of the picked corners (where the gizmo goes). */
  centre(): V3 | null {
    const all = [...this.picked.values()].flat();
    if (!all.length) return null;
    const c: V3 = [0, 0, 0];
    for (const p of all) for (let i = 0; i < 3; i++) c[i]! += p[i]! / all.length;
    return c;
  }

  /** Picked corners (snap sources) and every other brush corner in the scene except the edited brushes' own. */
  pickedPoints(): V3[] {
    return [...this.picked.values()].flat();
  }

  beginDrag(): void {
    this.drag = { originals: this.brushes.map((b) => ({ ...b })), good: [0, 0, 0] };
    this.lastRefusal = null;
    this.madeMesh = false;
  }

  /** Brushes with the picked corners moved by `delta`; if any brush refuses, the last good move is used. */
  dragTo(delta: V3): VertexBrush[] {
    const d = this.drag;
    if (!d) return [];
    let made = false;
    const attempt = (t: V3): VertexBrush[] | null => {
      made = false;
      const out: VertexBrush[] = [];
      for (const b of d.originals) {
        const picks = this.picked.get(b.id);
        if (!picks?.length) continue;
        const vs = vertices(b.brush);
        const moves = new Map<number, V3>();
        vs.forEach((v, i) => {
          if (picks.some((p) => same(p, v))) moves.set(i, [v[0] + t[0], v[1] + t[1], v[2] + t[2]]);
        });
        const r = moveVertices(b.brush, moves, 'split');
        if (!r.ok) {
          this.lastRefusal = r.reason;
          return null;
        }
        out.push({ id: b.id, brush: r.brush });
        if (r.mesh && !b.brush.mesh) made = true;
      }
      return out;
    };
    const ok = attempt(delta);
    if (ok) {
      d.good = delta;
      this.madeMesh = made;
      return ok;
    }
    return attempt(d.good) ?? d.originals;
  }

  /** Finish a drag: the picks follow the corners to where they ended up. */
  endDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const t = d.good;
    for (const [id, list] of this.picked) this.picked.set(id, list.map((p) => [p[0] + t[0], p[1] + t[1], p[2] + t[2]] as V3));
  }

  /** The current offset of the picks during a drag (for drawing them). */
  private get offset(): V3 {
    return this.drag?.good ?? [0, 0, 0];
  }

  private redraw(): void {
    const corners: number[] = [], mids: number[] = [], picked: number[] = [];
    for (const h of this.handles()) (h.corners.length > 1 ? mids : corners).push(...h.at);
    const o = this.offset;
    for (const p of this.picked.values()) for (const v of p) picked.push(v[0] + o[0], v[1] + o[1], v[2] + o[2]);
    const set = (pts: THREE.Points, arr: number[]) => {
      pts.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      pts.geometry = g;
    };
    set(this.corners, corners);
    set(this.mids, mids);
    set(this.pickedPts, picked);
  }

  dispose(): void {
    for (const p of [this.corners, this.pickedPts, this.mids]) {
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
  }
}
