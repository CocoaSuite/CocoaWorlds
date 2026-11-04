/**
 * Hiding spots as a hunter sees them: only what can be observed (signs of use, noise from it, having seen it
 * used), never whether someone is inside. Suspicion = weighted evidence, clamped to 0…1.
 */
import type { HidingSpotKind } from '@cocoaworlds/core';
import type { HunterSettings } from './settings';
import type { V } from './stimuli';

/** What the world tells about a hiding spot. */
export interface SpotInfo {
  id: string;
  kind: HidingSpotKind;
  /** Its middle. */
  at: V;
  /** Where to stand to check it (in front of its entrance, on the floor). */
  front: V;
  /** The entrance is moving or ajar (someone is getting in or out right now). */
  open: boolean;
  /** When someone last got in or out (−Infinity: never). */
  usedAt: number;
  /** When it last made a noise. */
  noiseAt: number;
}

/** What one hunter has noticed about spots. */
export class SpotMemory {
  /** When it saw a spot being used, heard a noise from it, last checked it. */
  seenUsed = new Map<string, number>();
  heard = new Map<string, number>();
  checked = new Map<string, number>();
  /** Spots it decided to leave alone in this search. */
  passed = new Set<string>();
  /** The spot it saw the player get into. */
  witnessed: string | null = null;

  forget(id: string): void {
    this.seenUsed.delete(id);
    this.heard.delete(id);
  }
}

const decay = (since: number, memory: number) => (Number.isFinite(since) && memory > 0 ? Math.max(0, 1 - since / memory) : 0);

/** Evidence 0…1 each: signs of use (when close enough to see them), noise heard from it, a hint's sureness, seen in use. */
export function evidence(spot: SpotInfo, mem: SpotMemory, now: number, cfg: HunterSettings, hint: { at: V; confidence: number } | null, close: boolean) {
  const use = close || spot.open ? decay(now - spot.usedAt, cfg.useMemory) : 0;
  const noise = decay(now - (mem.heard.get(spot.id) ?? -Infinity), cfg.noiseMemory);
  const seen = decay(now - (mem.seenUsed.get(spot.id) ?? -Infinity), cfg.seenMemory);
  const near = hint ? Math.max(0, 1 - Math.hypot(spot.at.x - hint.at.x, spot.at.z - hint.at.z) / Math.max(1, cfg.searchLimit)) : 0;
  return { use, noise, hint: hint ? hint.confidence * near : 0, seen };
}

export function suspicion(spot: SpotInfo, mem: SpotMemory, now: number, cfg: HunterSettings, hint: { at: V; confidence: number } | null, close: boolean): number {
  if (mem.witnessed === spot.id) return 1;
  const e = evidence(spot, mem, now, cfg, hint, close);
  return Math.max(0, Math.min(1, e.use * cfg.wUse + e.noise * cfg.wNoise + e.hint * cfg.wHint + e.seen * cfg.wSeen));
}

export type Reaction = 'ignore' | 'glance' | 'medium' | 'high';

/** What to do about a spot: below Knocks from it is mostly ignored; then knocked on (by chance); then opened. */
export function react(level: number, cfg: HunterSettings, roll: number): Reaction {
  if (level >= cfg.highAt) return 'high';
  if (level >= cfg.mediumAt) return roll < cfg.mediumChance ? 'medium' : 'ignore';
  return roll < cfg.lowChance ? 'glance' : 'ignore';
}
