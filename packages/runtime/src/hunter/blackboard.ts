import type { Stimulus, StimulusKind, V } from './stimuli';

/** What a hunter knows and is doing, shared by its behaviour tree's nodes. */
export interface Blackboard {
  /** Who it is after (the player while seen; null otherwise). */
  target: 'player' | null;
  hasVisual: boolean;
  lastKnown: V | null;
  lastSeenAt: number;
  /** The news it is following up, and a count that changes when that news is replaced. */
  investigation: Stimulus | null;
  investigationKey: number;
  shouldInvestigate: boolean;
  lastStimulusTime: number;
  stimulusKind: StimulusKind | null;
  searching: boolean;
  searchUntil: number;
  searchCenter: V | null;
  searchRadius: number;
  currentSpot: string | null;
  suspicion: number;
  patrolPoint: V | null;
  state: string;
  interacting: boolean;
}

export const newBlackboard = (): Blackboard => ({
  target: null,
  hasVisual: false,
  lastKnown: null,
  lastSeenAt: -Infinity,
  investigation: null,
  investigationKey: 0,
  shouldInvestigate: false,
  lastStimulusTime: -Infinity,
  stimulusKind: null,
  searching: false,
  searchUntil: 0,
  searchCenter: null,
  searchRadius: 0,
  currentSpot: null,
  suspicion: 0,
  patrolPoint: null,
  state: 'wander',
  interacting: false,
});

/** Done with a search (found nothing, or found the player). */
export function endSearch(bb: Blackboard): void {
  bb.searching = false;
  bb.searchCenter = null;
  bb.investigation = null;
  bb.shouldInvestigate = false;
  bb.currentSpot = null;
  bb.suspicion = 0;
  bb.interacting = false;
}
