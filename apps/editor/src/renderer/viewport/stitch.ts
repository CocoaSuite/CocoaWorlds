/**
 * Stitching build pieces: touching boxes (along the world axes) of one look made into one mesh, with no faces
 * between them and each flat side as few large rectangles, so a material runs across walls and floors without
 * seams, and edge wear lands only on the outer edges.
 */
import * as THREE from 'three';
import { DEV_TEXTURE_SIZE } from '../brush/materials';

type V3 = [number, number, number];
export interface Box {
  min: V3;
  max: V3;
}

const EPS = 0.01;
const touch = (a: Box, b: Box) => [0, 1, 2].every((k) => a.min[k]! <= b.max[k]! + EPS && b.min[k]! <= a.max[k]! + EPS);
const q = (v: number) => Math.round(v * 1000) / 1000;

/** Groups of boxes that touch (each group is stitched on its own, so far-apart bases stay small). */
function clusters(boxes: Box[]): Box[][] {
  const up = boxes.map((_, i) => i);
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i]!)));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (touch(boxes[i]!, boxes[j]!)) up[find(i)] = find(j);
  const out = new Map<number, Box[]>();
  boxes.forEach((b, i) => {
    const r = find(i);
    if (!out.has(r)) out.set(r, []);
    out.get(r)!.push(b);
  });
  return [...out.values()];
}

/** One mesh of the outside of touching boxes (position, normal, uv). */
export function stitch(boxes: Box[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const group of clusters(boxes)) {
    const cs = [0, 1, 2].map((k) => [...new Set(group.flatMap((b) => [q(b.min[k]!), q(b.max[k]!)]))].sort((a, b) => a - b));
    const n = cs.map((c) => c.length - 1) as V3;
    const occ = new Uint8Array(n[0] * n[1] * n[2]);
    const at = (i: number, j: number, k: number) => (i * n[1] + j) * n[2] + k;
    const range = (k: number, b: Box) => [cs[k]!.indexOf(q(b.min[k]!)), cs[k]!.indexOf(q(b.max[k]!))];
    for (const b of group) {
      const [x0, x1] = range(0, b), [y0, y1] = range(1, b), [z0, z1] = range(2, b);
      for (let i = x0!; i < x1!; i++) for (let j = y0!; j < y1!; j++) for (let k = z0!; k < z1!; k++) occ[at(i, j, k)] = 1;
    }
    const filled = (c: number[]) => c.every((v, k) => v >= 0 && v < n[k]!) && occ[at(c[0]!, c[1]!, c[2]!)] === 1;
    for (let a = 0; a < 3; a++) {
      const u = (a + 1) % 3, v = (a + 2) % 3;
      for (let p = 0; p <= n[a]!; p++) {
        for (const side of [1, -1]) {
          // Where this plane is the outside: filled behind (along the normal's opposite), empty in front.
          const mask = new Uint8Array(n[u]! * n[v]!);
          for (let i = 0; i < n[u]!; i++)
            for (let j = 0; j < n[v]!; j++) {
              const back = [0, 0, 0], front = [0, 0, 0];
              back[a] = side > 0 ? p - 1 : p;
              front[a] = side > 0 ? p : p - 1;
              back[u] = front[u] = i;
              back[v] = front[v] = j;
              if (filled(back) && !filled(front)) mask[i * n[v]! + j] = 1;
            }
          // As few rectangles as will cover it.
          for (let i = 0; i < n[u]!; i++)
            for (let j = 0; j < n[v]!; j++) {
              if (!mask[i * n[v]! + j]) continue;
              let w = 1;
              while (j + w < n[v]! && mask[i * n[v]! + j + w]) w++;
              let h = 1;
              grow: while (i + h < n[u]!) {
                for (let x = 0; x < w; x++) if (!mask[(i + h) * n[v]! + j + x]) break grow;
                h++;
              }
              for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[(i + y) * n[v]! + j + x] = 0;
              const u0 = cs[u]![i]!, u1 = cs[u]![i + h]!, v0 = cs[v]![j]!, v1 = cs[v]![j + w]!, d = cs[a]![p]!;
              const corner = (cu: number, cv: number): V3 => {
                const c: V3 = [0, 0, 0];
                c[a] = d;
                c[u] = cu;
                c[v] = cv;
                return c;
              };
              const quad = side > 0 ? [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)] : [corner(u0, v0), corner(u0, v1), corner(u1, v1), corner(u1, v0)];
              const base = pos.length / 3;
              const nn: V3 = [0, 0, 0];
              nn[a] = side;
              for (const c of quad) {
                pos.push(...c);
                nor.push(...nn);
                // (Texture coordinates from the world, as brush faces: a material lines up across pieces.)
                const [tu, tv] = a === 0 ? [c[2], c[1]] : a === 1 ? [c[0], c[2]] : [c[0], c[1]];
                uv.push(tu / DEV_TEXTURE_SIZE, tv / DEV_TEXTURE_SIZE);
              }
              idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
