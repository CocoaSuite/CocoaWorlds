import type { NpcData } from '@cocoaworlds/core';
import type { StimulusKind } from './stimuli';

/** A Hunter's settings: from the Creature component (Hunting groups), with these defaults. */
export interface HunterSettings {
  hearing: number;
  feel: number;
  notice: number;
  fresh: number;
  old: number;
  wanderRadius: number;
  waitMin: number;
  waitMax: number;
  idleChance: number;
  slow: number;
  searchMin: number;
  searchMax: number;
  searchRadius: number;
  searchGrow: number;
  searchLimit: number;
  spotRange: number;
  wUse: number;
  wNoise: number;
  wHint: number;
  wSeen: number;
  mediumAt: number;
  highAt: number;
  lowChance: number;
  mediumChance: number;
  spotCooldown: number;
  moves: string;
  /** How much each kind of news counts. */
  importance: Record<StimulusKind, number>;
  /** How long signs of use, noise from a spot and a spot seen in use stay telling (s). */
  useMemory: number;
  noiseMemory: number;
  seenMemory: number;
  /** How long it waits and listens at a spot it knocked on (s). */
  listen: number;
  /** Lost sight of the player this long ago: it goes to where it last saw them (s). */
  sightMemory: number;
}

export const HUNTER_DEFAULTS: HunterSettings = {
  hearing: 1,
  feel: 48,
  notice: 0.25,
  fresh: 5,
  old: 20,
  wanderRadius: 800,
  waitMin: 1.5,
  waitMax: 5,
  idleChance: 0.5,
  slow: 0.7,
  searchMin: 20,
  searchMax: 40,
  searchRadius: 400,
  searchGrow: 150,
  searchLimit: 1200,
  spotRange: 500,
  wUse: 0.4,
  wNoise: 0.3,
  wHint: 0.2,
  wSeen: 0.1,
  mediumAt: 0.3,
  highAt: 0.65,
  lowChance: 0.15,
  mediumChance: 0.7,
  spotCooldown: 30,
  moves: '',
  importance: { sighting: 1, event: 0.8, sound: 0.6 },
  useMemory: 30,
  noiseMemory: 20,
  seenMemory: 60,
  listen: 1.5,
  sightMemory: 0.4,
};

export function hunterSettings(data: NpcData): HunterSettings {
  const out = { ...HUNTER_DEFAULTS, importance: { ...HUNTER_DEFAULTS.importance } };
  for (const k of Object.keys(HUNTER_DEFAULTS) as (keyof HunterSettings)[]) {
    const v = data[k];
    if (k === 'moves') out.moves = typeof v === 'string' ? v : '';
    else if (typeof v === 'number' && Number.isFinite(v) && typeof out[k] === 'number') (out as unknown as Record<string, number>)[k] = Math.max(0, v);
  }
  out.waitMax = Math.max(out.waitMin, out.waitMax);
  out.searchMax = Math.max(out.searchMin, out.searchMax);
  out.old = Math.max(out.fresh + 0.1, out.old);
  out.highAt = Math.max(out.mediumAt, out.highAt);
  return out;
}
