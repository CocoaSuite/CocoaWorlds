/**
 * Primitive brushes. Every function returns brushes whose planes come from exact corner coordinates,
 * so primitives drawn on the grid have integer vertices.
 * Axis convention: Y is up. Footprints are drawn on the XZ plane.
 */
import { cloneSurface, defaultSurface, type Brush, type BrushFace, type FaceSurface } from './brush';
import { planeFromPoints, type Plane } from './plane';
import { type V3 } from './vec';

function face(a: V3, b: V3, c: V3, s: FaceSurface): BrushFace {
  const plane = planeFromPoints(a, b, c);
  if (!plane) throw new Error('Degenerate face in primitive.');
  return { plane, surface: cloneSurface(s) };
}

const axisPlane = (n: V3, d: number): Plane => ({ n, d });

/** Axis-aligned box between two corners (any order). */
export function box(a: V3, b: V3, surface: FaceSurface = defaultSurface()): Brush {
  const min: V3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  const max: V3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
  const s = () => cloneSurface(surface);
  return {
    faces: [
      { plane: axisPlane([1, 0, 0], max[0]), surface: s() },
      { plane: axisPlane([-1, 0, 0], -min[0]), surface: s() },
      { plane: axisPlane([0, 1, 0], max[1]), surface: s() },
      { plane: axisPlane([0, -1, 0], -min[1]), surface: s() },
      { plane: axisPlane([0, 0, 1], max[2]), surface: s() },
      { plane: axisPlane([0, 0, -1], -min[2]), surface: s() },
    ],
  };
}

/**
 * Prism from a convex footprint on the XZ plane, extruded from y0 to y1.
 * The footprint may be given in either winding order; it must be convex.
 */
export function prism(footprint: [number, number][], y0: number, y1: number, surface: FaceSurface = defaultSurface()): Brush {
  if (footprint.length < 3) throw new Error('A footprint needs at least three points.');
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  // Make the footprint counter-clockwise when seen from above (+Y): signed area in XZ with (x, z) → (x, -z).
  let area = 0;
  for (let i = 0; i < footprint.length; i++) {
    const [x0, z0] = footprint[i]!, [x1, z1] = footprint[(i + 1) % footprint.length]!;
    area += x0 * z1 - x1 * z0;
  }
  // Positive area in (x, z) means the outward side normal of edge (dx, dz) is (dz, −dx); otherwise reverse.
  const pts = area < 0 ? [...footprint].reverse() : [...footprint];
  const faces: BrushFace[] = [
    { plane: axisPlane([0, 1, 0], hi), surface: cloneSurface(surface) },
    { plane: axisPlane([0, -1, 0], -lo), surface: cloneSurface(surface) },
  ];
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i]!, [x1, z1] = pts[(i + 1) % pts.length]!;
    faces.push(face([x0, lo, z0], [x0, hi, z0], [x1, hi, z1], surface));
  }
  return { faces };
}

/** Upright cylinder approximated with `sides` flat sides, fitted inside the given footprint rectangle. */
export function cylinder(min: V3, max: V3, sides = 16, surface: FaceSurface = defaultSurface()): Brush {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  const rx = Math.abs(max[0] - min[0]) / 2, rz = Math.abs(max[2] - min[2]) / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n; // flat side facing each axis for even counts
    pts.push([round(cx + Math.cos(a) * rx), round(cz + Math.sin(a) * rz)]);
  }
  return prism(pts, min[1], max[1], surface);
}

/**
 * Wedge (ramp): a box whose top slopes down from the back (−Z side) to the front (+Z side).
 * `facing` rotates which side is low: 0 = +Z, 90 = +X, 180 = −Z, 270 = −X.
 */
export function wedge(min: V3, max: V3, facing: 0 | 90 | 180 | 270 = 0, surface: FaceSurface = defaultSurface()): Brush {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  // Profile in the plane perpendicular to the slope, then extruded.
  const corners: Record<number, { low: [V3, V3]; high: [V3, V3] }> = {
    0: { low: [[x0, y0, z1], [x1, y0, z1]], high: [[x0, y1, z0], [x1, y1, z0]] },
    180: { low: [[x1, y0, z0], [x0, y0, z0]], high: [[x1, y1, z1], [x0, y1, z1]] },
    90: { low: [[x1, y0, z1], [x1, y0, z0]], high: [[x0, y1, z1], [x0, y1, z0]] },
    270: { low: [[x0, y0, z0], [x0, y0, z1]], high: [[x1, y1, z0], [x1, y1, z1]] },
  };
  const c = corners[facing]!;
  const b = box(min, max, surface);
  // Replace the top and the high-side wall with the slope: keep bottom, the two side walls and the back wall.
  const slope = face(c.low[0], c.low[1], c.high[1], surface);
  const keep = b.faces.filter((f) => {
    const n = f.plane.n;
    if (n[1] > 0.5) return false; // top
    const lowSideNormal: V3 = facing === 0 ? [0, 0, 1] : facing === 180 ? [0, 0, -1] : facing === 90 ? [1, 0, 0] : [-1, 0, 0];
    return !(n[0] === lowSideNormal[0] && n[2] === lowSideNormal[2]);
  });
  return { faces: [...keep, slope] };
}

/**
 * A flight of stairs as separate, non-overlapping box brushes (one column per step, each standing on the floor).
 * By default the stairs rise toward −Z; `facing` turns the low end as for `wedge`.
 */
export function stairs(min: V3, max: V3, steps: number, facing: 0 | 90 | 180 | 270 = 0, surface: FaceSurface = defaultSurface()): Brush[] {
  const n = Math.max(1, Math.round(steps));
  const out: Brush[] = [];
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  for (let i = 0; i < n; i++) {
    const top = round(y0 + ((y1 - y0) * (i + 1)) / n);
    // Column i runs from fraction t0 to t1 of the run, measured from the low end.
    const t0 = i / n, t1 = (i + 1) / n;
    const along = (lo: number, hi: number, fromHigh: boolean): [number, number] =>
      fromHigh ? [round(hi - (hi - lo) * t1), round(hi - (hi - lo) * t0)] : [round(lo + (hi - lo) * t0), round(lo + (hi - lo) * t1)];
    let a: V3, b: V3;
    if (facing === 0 || facing === 180) {
      const [za, zb] = along(z0, z1, facing === 0);
      a = [x0, y0, za];
      b = [x1, top, zb];
    } else {
      const [xa, xb] = along(x0, x1, facing === 90);
      a = [xa, y0, z0];
      b = [xb, top, z1];
    }
    out.push(box(a, b, surface));
  }
  return out;
}

/** Round to 1/1024 unit to keep generated coordinates clean. */
function round(n: number): number {
  const r = Math.round(n * 1024) / 1024;
  return r === 0 ? 0 : r;
}
