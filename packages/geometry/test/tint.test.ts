import { describe, expect, it } from 'vitest';
import { box, buildMesh, fromData, normalTint, setSurface, toData } from '../src';

describe('tint', () => {
  it('normalises: lower case, white and junk mean none', () => {
    expect(normalTint('#FF8800')).toBe('#ff8800');
    expect(normalTint('#ffffff')).toBeUndefined();
    expect(normalTint('')).toBeUndefined();
    expect(normalTint('red')).toBeUndefined();
  });

  it('is set and cleared on faces, and survives saving', () => {
    const b = setSurface(box([0, 0, 0], [16, 16, 16]), { tint: '#FF0000' }, [0]);
    expect(b.faces[0]!.surface.tint).toBe('#ff0000');
    expect(b.faces[1]!.surface.tint).toBeUndefined();
    expect(fromData(toData(b)).faces.some((f) => f.surface.tint === '#ff0000')).toBe(true);
    expect(setSurface(b, { tint: '' }).faces.every((f) => f.surface.tint === undefined)).toBe(true);
  });

  it('splits mesh groups by tint', () => {
    const b = setSurface(box([0, 0, 0], [16, 16, 16]), { tint: '#00ff00' }, [0, 1]);
    const m = buildMesh([b]);
    expect(m.groups).toHaveLength(2);
    expect(m.groups.filter((g) => g.tint === '#00ff00')).toHaveLength(1);
    expect(new Set(m.groups.map((g) => g.material)).size).toBe(1);
  });
});
