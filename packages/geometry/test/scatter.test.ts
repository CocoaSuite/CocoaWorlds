// A2b: foliage placement — tufts on upward-facing surfaces only, seeded, spread out, capped.
import { describe, expect, it } from 'vitest';
import { TUFT_MAX, box, scatterTufts, type ScatterOptions } from '../src';

const opts = (o: Partial<ScatterOptions> = {}): ScatterOptions => ({ spacing: 12, density: 1, size: 24, slope: 40, seed: 1, ...o });

describe('foliage placement', () => {
  it('tufts stand on the top of a block, and not on its sides or underside', () => {
    const t = scatterTufts(box([-256, -16, -256], [256, 0, 256]), opts());
    expect(t.count).toBeGreaterThan(1000);
    for (let i = 0; i < t.count; i++) {
      const x = t.data[i * 5]!, y = t.data[i * 5 + 1]!, z = t.data[i * 5 + 2]!;
      expect(y).toBeCloseTo(0, 3);
      expect(Math.abs(x)).toBeLessThanOrEqual(256 + 1e-3);
      expect(Math.abs(z)).toBeLessThanOrEqual(256 + 1e-3);
    }
  });

  it('a tall, thin wall gets tufts only on its top, none on its sides', () => {
    const t = scatterTufts(box([0, 0, 0], [8, 200, 400]), opts());
    expect(t.count).toBeGreaterThan(0);
    for (let i = 0; i < t.count; i++) expect(t.data[i * 5 + 1]).toBeCloseTo(200, 3);
  });

  it('the same seed gives the same spots; another seed gives others', () => {
    const b = box([-128, -8, -128], [128, 0, 128]);
    const a1 = scatterTufts(b, opts({ seed: 7 })).data;
    const a2 = scatterTufts(b, opts({ seed: 7 })).data;
    const a3 = scatterTufts(b, opts({ seed: 8 })).data;
    expect(Array.from(a1)).toEqual(Array.from(a2));
    expect(Array.from(a1)).not.toEqual(Array.from(a3));
  });

  it('density sets how many spots get a tuft, and the cap holds', () => {
    const b = box([-512, -8, -512], [512, 0, 512]);
    const full = scatterTufts(b, opts({ spacing: 8, density: 1 })).count;
    const half = scatterTufts(b, opts({ spacing: 8, density: 0.5 })).count;
    expect(half).toBeLessThan(full);
    expect(full).toBeLessThanOrEqual(TUFT_MAX);
    expect(scatterTufts(b, opts({ spacing: 4, density: 1 })).count).toBeLessThanOrEqual(TUFT_MAX);
    expect(scatterTufts(b, opts({ density: 0 })).count).toBe(0);
  });

  it('no two tufts share a cell of the spacing (they spread out)', () => {
    const t = scatterTufts(box([-256, -8, -256], [256, 0, 256]), opts({ spacing: 16 }));
    const cells = new Set<string>();
    for (let i = 0; i < t.count; i++) {
      cells.add([Math.floor(t.data[i * 5]! / 16), Math.floor(t.data[i * 5 + 1]! / 16), Math.floor(t.data[i * 5 + 2]! / 16)].join(','));
    }
    expect(cells.size).toBe(t.count);
  });
});
