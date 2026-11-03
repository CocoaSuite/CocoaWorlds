// Smooth shading: a cylinder's sides share normals where they meet; its rim against the caps stays sharp.
import { expect, it } from 'vitest';
import { box, buildMesh, cylinder } from '../src';

const smooth = () => ({ group: 'a', angle: 50 });

it('a smooth cylinder has round sides and sharp rims; a box stays flat', () => {
  const c = cylinder([-64, 0, -64], [64, 128, 64], 16);
  const flat = buildMesh([c], { wearRing: 32 });
  const round = buildMesh([c], { wearRing: 32, smooth });
  const P = round.positions, N = round.normals;
  let sides = 0, caps = 0;
  for (let i = 0; i < P.length / 3; i++) {
    const n = [N[i * 3]!, N[i * 3 + 1]!, N[i * 3 + 2]!];
    if (Math.abs(n[1]) > 0.999) caps++;
    else {
      sides++;
      // A side normal points straight out from the axis (round), not along a flat face's normal.
      const r = Math.hypot(P[i * 3]!, P[i * 3 + 2]!);
      expect(Math.abs(n[1]!)).toBeLessThan(1e-6);
      expect((n[0]! * P[i * 3]! + n[2]! * P[i * 3 + 2]!) / r).toBeGreaterThan(0.999);
    }
  }
  expect(sides).toBeGreaterThan(0);
  expect(caps).toBeGreaterThan(0);
  // The flat build has side normals off the radial direction at the corners.
  let off = 0;
  for (let i = 0; i < flat.positions.length / 3; i++) {
    const n = [flat.normals[i * 3]!, flat.normals[i * 3 + 2]!], p = [flat.positions[i * 3]!, flat.positions[i * 3 + 2]!];
    if (Math.abs(flat.normals[i * 3 + 1]!) < 0.5 && (n[0]! * p[0]! + n[1]! * p[1]!) / Math.hypot(p[0]!, p[1]!) < 0.99) off++;
  }
  expect(off).toBeGreaterThan(0);
  // A box's faces meet at 90 degrees: nothing is smoothed.
  const b = box([0, 0, 0], [64, 64, 64]);
  expect(Array.from(buildMesh([b], { smooth }).normals)).toEqual(Array.from(buildMesh([b]).normals));
});
