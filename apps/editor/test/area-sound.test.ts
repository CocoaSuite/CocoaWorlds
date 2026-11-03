import { describe, expect, it } from 'vitest';
import { SOUND_EFFECTS } from '@cocoaworlds/core';
import { EFFECTS, echoSamples, effectLevels } from '../src/renderer/viewport/area-sound';

describe('area sound effects', () => {
  it('has settings for every effect a Sound area offers', () => {
    for (const e of SOUND_EFFECTS) expect(EFFECTS[e]).toBeDefined();
  });

  it('amount 0 is no effect, 1 the full one', () => {
    for (const e of SOUND_EFFECTS) {
      expect(effectLevels(e, 0)).toEqual({ wet: 0, dry: 1, lowpass: 20000 });
      const full = effectLevels(e, 1);
      expect(full.wet).toBeCloseTo(EFFECTS[e].wet);
      expect(full.dry).toBeCloseTo(EFFECTS[e].dry);
      expect(full.lowpass).toBeCloseTo(EFFECTS[e].lowpass);
    }
  });

  it('under water is muffled; caves echo more than rooms; outdoors is dry', () => {
    expect(effectLevels('underwater', 1).lowpass).toBeLessThan(1000);
    expect(effectLevels('cave', 1).wet).toBeGreaterThan(effectLevels('room', 1).wet);
    expect(EFFECTS.cave.echo).toBeGreaterThan(EFFECTS.hall.echo);
    expect(EFFECTS.hall.echo).toBeGreaterThan(EFFECTS.room.echo);
    expect(effectLevels('outdoors', 1)).toEqual({ wet: 0, dry: 1, lowpass: 20000 });
  });

  it('half the amount muffles half-way in pitch', () => {
    const half = effectLevels('underwater', 0.5).lowpass;
    expect(half).toBeCloseTo(Math.sqrt(20000 * 650), 0);
  });

  it('echoes die away, and are the same every time', () => {
    const [l, r] = echoSamples(1, 3, 8000);
    expect(l.length).toBe(8000);
    const loud = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((s, x) => s + Math.abs(x), 0);
    expect(loud(l, 0, 1000)).toBeGreaterThan(loud(l, 7000, 8000) * 10);
    expect(l).not.toEqual(r);
    expect(echoSamples(1, 3, 8000)[0]).toEqual(l);
    for (const x of l) expect(Math.abs(x)).toBeLessThanOrEqual(1);
  });
});
