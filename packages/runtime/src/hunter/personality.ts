/**
 * The personality layer: which move the hunter makes at each turn of its behaviour, and which animation and
 * how long each move takes. The behaviour only asks for "a reaction to a sound", "an idle move" and so on.
 */
import { CREATURE_MOMENTS, momentOf, parseMoves } from '@cocoaworlds/core';

export type Beat = 'idle' | 'hear' | 'arrive' | 'searchPoint' | 'spotted' | 'lost' | 'empty';

const BEATS: Record<Exclude<Beat, 'idle'>, string[]> = {
  hear: ['hear'],
  arrive: ['lookAround', 'tilt'],
  searchPoint: ['lookAround', 'rummage', 'lookAround'],
  spotted: ['spot'],
  lost: ['lose', 'twitch'],
  empty: ['empty'],
};
const IDLE = CREATURE_MOMENTS.filter((m) => m.idle).map((m) => m.name);

export class Personality {
  private moves: ReturnType<typeof parseMoves>;
  constructor(moves: string, private random: () => number) {
    this.moves = parseMoves(moves);
  }

  /** The move for a turn of behaviour (idle moves at random, never the same twice running). */
  pick(beat: Beat, last = ''): string {
    const list = beat === 'idle' ? IDLE : BEATS[beat];
    const options = list.length > 1 ? list.filter((x) => x !== last) : list;
    return options[Math.floor(this.random() * options.length)] ?? list[0]!;
  }

  seconds(moment: string): number {
    return this.moves.get(moment)?.seconds ?? momentOf(moment)?.seconds ?? 1;
  }
}

/** The animation for a move: from the creature's Moves, else the Animations role it falls back to. */
export function momentAnimation(moves: string, moment: string, roleAnim: (role: string) => string): string {
  return parseMoves(moves).get(moment)?.anim || roleAnim(momentOf(moment)?.role ?? 'idle');
}
