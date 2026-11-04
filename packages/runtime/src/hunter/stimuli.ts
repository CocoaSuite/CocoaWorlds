/**
 * News of the player: heard sounds, sightings, and hints from the Director (the game's own scripts). A hunter
 * weighs them by kind, sureness and age; it never gets the player's exact place from a hint.
 */
import type { HunterSettings } from './settings';

export type V = { x: number; y: number; z: number };
export type StimulusKind = 'sound' | 'sighting' | 'event';

export interface Stimulus {
  /** Roughly where. */
  at: V;
  /** 0…1. */
  confidence: number;
  /** When it happened (game time). */
  time: number;
  kind: StimulusKind;
}

/** 1 while fresh, down to 0.3 at old, then on down to 0.1 at three times old. */
export function freshness(s: Stimulus, now: number, cfg: HunterSettings): number {
  const age = Math.max(0, now - s.time);
  if (age <= cfg.fresh) return 1;
  if (age <= cfg.old) return 1 - (0.7 * (age - cfg.fresh)) / (cfg.old - cfg.fresh);
  return Math.max(0.1, 0.3 - (0.2 * (age - cfg.old)) / (cfg.old * 2));
}

/** How much it matters now: kind × sureness × freshness. */
export function weigh(s: Stimulus, now: number, cfg: HunterSettings): number {
  return (cfg.importance[s.kind] ?? 0.5) * Math.max(0, Math.min(1, s.confidence)) * freshness(s, now, cfg);
}

/** How it acts on news of this age: go there, look around it, or search the area. */
export function ageBand(s: Stimulus, now: number, cfg: HunterSettings): 'fresh' | 'old' | 'stale' {
  const age = now - s.time;
  return age <= cfg.fresh ? 'fresh' : age <= cfg.old ? 'old' : 'stale';
}

/** How far around the place to look: wider the older and the less sure. */
export function spreadOf(s: Stimulus, now: number, cfg: HunterSettings): number {
  const age = Math.max(0, now - s.time);
  return Math.min(cfg.searchLimit, 64 + (age / cfg.old) * 300 + (1 - Math.max(0, Math.min(1, s.confidence))) * 200);
}

/** Whether new news should replace what it is working on. */
export function better(next: Stimulus, current: Stimulus | null, now: number, cfg: HunterSettings): boolean {
  const w = weigh(next, now, cfg);
  if (w < cfg.notice) return false;
  if (!current) return true;
  const near = Math.hypot(next.at.x - current.at.x, next.at.z - current.at.z) < 128;
  return near ? next.time >= current.time : w >= weigh(current, now, cfg) * 0.8;
}
