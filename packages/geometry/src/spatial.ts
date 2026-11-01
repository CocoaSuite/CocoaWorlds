/**
 * A static bounding-box tree (BVH) for "which brushes are near this box?" questions: hidden-face removal,
 * live subtract, and later picking and culling. Built in O(n log n) by splitting on the longest axis at the
 * median; queries visit only the branches whose boxes touch the query box.
 */
import type { V3 } from './vec';

export interface Aabb {
  min: V3;
  max: V3;
}

interface Node {
  min: V3;
  max: V3;
  /** Leaf: item indices. Inner: undefined. */
  items?: number[];
  left?: Node;
  right?: Node;
}

const LEAF = 4;

/** Boxes touch when they overlap or meet within `eps` on every axis. */
export function boxesTouch(a: Aabb, b: Aabb, eps = 0): boolean {
  return (
    a.min[0] <= b.max[0] + eps && a.max[0] >= b.min[0] - eps &&
    a.min[1] <= b.max[1] + eps && a.max[1] >= b.min[1] - eps &&
    a.min[2] <= b.max[2] + eps && a.max[2] >= b.min[2] - eps
  );
}

export class AabbTree {
  private root: Node | null;

  constructor(private readonly boxes: (Aabb | null)[]) {
    const idx: number[] = [];
    boxes.forEach((b, i) => {
      if (b) idx.push(i);
    });
    this.root = idx.length ? this.build(idx) : null;
  }

  private build(idx: number[]): Node {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const i of idx) {
      const b = this.boxes[i]!;
      for (let k = 0; k < 3; k++) {
        if (b.min[k]! < min[k]!) min[k] = b.min[k]!;
        if (b.max[k]! > max[k]!) max[k] = b.max[k]!;
      }
    }
    if (idx.length <= LEAF) return { min, max, items: idx };
    const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const axis = ext[0]! >= ext[1]! && ext[0]! >= ext[2]! ? 0 : ext[1]! >= ext[2]! ? 1 : 2;
    const c = (i: number) => this.boxes[i]!.min[axis]! + this.boxes[i]!.max[axis]!;
    const sorted = [...idx].sort((a, b) => c(a) - c(b));
    const half = sorted.length >> 1;
    return { min, max, left: this.build(sorted.slice(0, half)), right: this.build(sorted.slice(half)) };
  }

  /** Call `fn` with the index of every box touching `q` (within `eps`). */
  query(q: Aabb, fn: (i: number) => void, eps = 0): void {
    const stack: Node[] = this.root ? [this.root] : [];
    while (stack.length) {
      const n = stack.pop()!;
      if (!boxesTouch(n, q, eps)) continue;
      if (n.items) {
        for (const i of n.items) if (boxesTouch(this.boxes[i]!, q, eps)) fn(i);
      } else {
        stack.push(n.left!, n.right!);
      }
    }
  }

  /** Indices of every box touching `q`. */
  near(q: Aabb, eps = 0): number[] {
    const out: number[] = [];
    this.query(q, (i) => out.push(i), eps);
    return out;
  }
}
