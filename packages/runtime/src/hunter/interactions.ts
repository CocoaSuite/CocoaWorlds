/**
 * How a hunter checks each kind of hiding spot: the moves it makes, in order. `reveal` is the moment it would
 * find someone inside. A knock is followed by listening: noise from the spot then makes it open up.
 */
import type { HidingSpotKind } from '@cocoaworlds/core';

export interface Step {
  moment: string;
  reveal?: boolean;
  /** Listening: noise from the spot during it raises the check to an opening. */
  listen?: boolean;
}

interface Checks {
  glance: Step[];
  /** One of these, at random. */
  medium: Step[][];
  high: Step[];
}

const listen: Step = { moment: 'listen', listen: true };
const door = (open: string): Checks => ({
  glance: [{ moment: 'lookAround' }],
  medium: [
    [{ moment: 'knock' }, listen],
    [{ moment: 'rattle' }, listen],
  ],
  high: [{ moment: open }, { moment: 'lookIn', reveal: true }],
});

export const CHECKS: Record<HidingSpotKind, Checks> = {
  locker: door('open'),
  wardrobe: door('openSlow'),
  cabinet: { ...door('open'), medium: [[{ moment: 'knock' }, listen]] },
  under: { glance: [{ moment: 'crouch' }], medium: [[listen]], high: [{ moment: 'lookUnder', reveal: true }] },
  box: { glance: [{ moment: 'stare' }], medium: [[{ moment: 'knock' }, listen]], high: [{ moment: 'kick', reveal: true }] },
  other: { ...door('open'), medium: [[{ moment: 'knock' }, listen]] },
};

export function stepsFor(kind: HidingSpotKind, level: 'glance' | 'medium' | 'high', roll: number): Step[] {
  const c = CHECKS[kind] ?? CHECKS.other;
  if (level === 'medium') return c.medium[Math.min(c.medium.length - 1, Math.floor(roll * c.medium.length))]!;
  return c[level];
}
