/**
 * How each kind of surface treats sound passing through it and bouncing off it. Numbers are tuned for play,
 * not taken from a lab: a real concrete wall stops ~50 dB, which would make every neighbour silent.
 *
 * - `loss`: dB lost going through one wall of it `thick` units thick. Thicker or thinner walls lose more or
 *   less, by the square root of the ratio (so a wall twice as thick loses ~1.4× as much, not 2×).
 * - `absorb`: 0…1, how much of the sound hitting it is soaked up instead of echoing (carpet a lot, tile little).
 */
import type { Surface } from '@cocoaworlds/core';

export interface AcousticMaterial {
  loss: number;
  thick: number;
  absorb: number;
}

export const ACOUSTIC_MATERIALS: Record<Surface, AcousticMaterial> = {
  generic: { loss: 18, thick: 16, absorb: 0.15 },
  wood: { loss: 11, thick: 8, absorb: 0.15 },
  metal: { loss: 16, thick: 4, absorb: 0.05 },
  stone: { loss: 26, thick: 24, absorb: 0.04 },
  concrete: { loss: 24, thick: 16, absorb: 0.03 },
  tile: { loss: 21, thick: 16, absorb: 0.02 },
  dirt: { loss: 30, thick: 32, absorb: 0.35 },
  grass: { loss: 30, thick: 32, absorb: 0.45 },
  gravel: { loss: 28, thick: 32, absorb: 0.4 },
  sand: { loss: 30, thick: 32, absorb: 0.5 },
  snow: { loss: 24, thick: 32, absorb: 0.6 },
  mud: { loss: 30, thick: 32, absorb: 0.4 },
  water: { loss: 14, thick: 32, absorb: 0.05 },
  glass: { loss: 9, thick: 2, absorb: 0.04 },
  carpet: { loss: 8, thick: 4, absorb: 0.6 },
  plastic: { loss: 7, thick: 4, absorb: 0.1 },
  cardboard: { loss: 3, thick: 2, absorb: 0.35 },
  leaves: { loss: 1.5, thick: 8, absorb: 0.5 },
  flesh: { loss: 6, thick: 16, absorb: 0.5 },
};

/** Most a sound can lose through walls (dB): past this it is silent anyway. */
export const MAX_LOSS = 60;

/** dB lost through one wall of a surface and thickness. */
export function wallLoss(surface: Surface, thickness: number): number {
  const m = ACOUSTIC_MATERIALS[surface] ?? ACOUSTIC_MATERIALS.generic;
  return m.loss * Math.max(0.6, Math.min(2.2, Math.sqrt(Math.max(0, thickness) / m.thick)));
}

/** dB to a volume factor (20 dB → 0.1). */
export const dbToGain = (db: number): number => 10 ** (-Math.max(0, db) / 20);

/**
 * How bright what's left is: more loss, lower lowpass (Hz). Walls take the highs first, so even a thin wall
 * sounds dull (~11 dB → ~4 kHz, ~24 dB → ~1.1 kHz, 40 dB+ → a few hundred Hz).
 */
export function lossCutoff(db: number): number {
  return Math.max(160, Math.min(22000, 22000 * 2 ** (-Math.max(0, db) / 4.5)));
}

/** Around corners the highs drop less than through walls: a corner sounds distant, not muffled. */
export function bendCutoff(db: number): number {
  return Math.max(400, Math.min(22000, 22000 * 2 ** (-Math.max(0, db) / 7)));
}
