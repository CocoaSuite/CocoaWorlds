import { describe, expect, it } from 'vitest';
import { box, clipBrush, clipPlane, containsPoint, defaultSurface, setSurface, validate, volume } from '../src';

describe('clipPlane', () => {
  it('is the vertical plane through two points drawn in the top view', () => {
    const p = clipPlane([0, 0, 0], [0, 0, 100], [0, 1, 0])!;
    expect(Math.abs(p.n[0])).toBeCloseTo(1);
    expect(p.d).toBeCloseTo(0);
  });
  it('is null for a zero-length line', () => {
    expect(clipPlane([5, 5, 5], [5, 5, 5], [0, 1, 0])).toBeNull();
  });
});

describe('clipBrush', () => {
  const wall = box([0, 0, 0], [256, 128, 16]);

  it('cuts a wall diagonally into two valid pieces that add up', () => {
    const p = clipPlane([0, 0, 0], [256, 128, 0], [0, 0, 1])!;
    const { front, back, cut } = clipBrush(wall, p);
    expect(cut).toBe(true);
    expect(validate(front!)).toEqual([]);
    expect(validate(back!)).toEqual([]);
    expect(volume(front!) + volume(back!)).toBeCloseTo(volume(wall), 3);
    expect(volume(front!)).toBeCloseTo(volume(wall) / 2, 3);
  });

  it('keeps sides apart: each piece holds only its side', () => {
    const p = clipPlane([100, 0, 0], [100, 0, 16], [0, 1, 0])!; // x = 100
    const { front, back } = clipBrush(wall, p);
    const sideOf = (b: typeof front, x: number) => containsPoint(b!, [x, 64, 8]);
    const pieceWithLeft = sideOf(front, 50) ? front : back;
    const pieceWithRight = pieceWithLeft === front ? back : front;
    expect(sideOf(pieceWithLeft, 150)).toBe(false);
    expect(sideOf(pieceWithRight, 150)).toBe(true);
  });

  it('cap faces take the material of the face pointing the same way', () => {
    const painted = setSurface(wall, { material: 'dev/red' }, [wall.faces.findIndex((f) => f.plane.n[0] > 0.9)]);
    const p = clipPlane([100, 0, 0], [100, 0, 16], [0, 1, 0])!;
    const { front, back } = clipBrush(painted, p);
    const left = containsPoint(front!, [50, 64, 8]) ? front! : back!;
    // The left piece's new +X cap faces the same way as the red face.
    const cap = left.faces.find((f) => f.plane.n[0] > 0.9 && Math.abs(f.plane.d - 100) < 1e-6)!;
    expect(cap.surface.material).toBe('dev/red');
  });

  it('leaves brushes the plane misses whole on their side', () => {
    const p = clipPlane([300, 0, 0], [300, 0, 16], [0, 1, 0])!;
    const r = clipBrush(wall, p);
    expect(r.cut).toBe(false);
    expect([r.front, r.back].filter(Boolean)).toEqual([wall]);
  });

  it('a plane along a face does not cut', () => {
    const p = clipPlane([0, 0, 0], [0, 0, 16], [0, 1, 0])!;
    expect(clipBrush(wall, p).cut).toBe(false);
  });

  it('uses the default surface type', () => {
    expect(defaultSurface().material).toBe('dev/grid');
  });
});
