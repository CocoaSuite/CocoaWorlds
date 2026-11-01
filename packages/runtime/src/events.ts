/**
 * The game's event bus: systems announce what happened, scripts (Phase 5) listen. Events are plain data so
 * they can be logged, recorded for debugging, and shown in the editor console.
 *
 * Listeners run in the order they subscribed. A listener that throws is reported and skipped; it never stops
 * the others or the game.
 */
export type GameEvent =
  | { type: 'trigger.enter'; trigger: string; other: string; time: number }
  | { type: 'trigger.exit'; trigger: string; other: string; time: number }
  | { type: 'use'; target: string; by: string; time: number }
  | { type: 'player.hurt'; amount: number; health: number; cause: string; time: number }
  | { type: 'player.die'; cause: string; time: number }
  | { type: 'score'; score: number; by: number; time: number }
  | { type: 'message'; name: string; from: string | null; time: number; data?: unknown };

export type EventType = GameEvent['type'];
type Of<T extends EventType> = Extract<GameEvent, { type: T }>;

export class EventBus {
  private listeners = new Map<string, Set<(e: GameEvent) => void>>();
  /** Errors thrown by listeners, for the console. */
  readonly errors: { event: EventType; message: string }[] = [];

  /** Listen to one kind of event, or `*` for all. Returns a function that stops listening. */
  on<T extends EventType>(type: T | '*', fn: (e: Of<T>) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn as (e: GameEvent) => void);
    this.listeners.set(type, set);
    return () => set.delete(fn as (e: GameEvent) => void);
  }

  emit(e: GameEvent): void {
    for (const key of [e.type, '*']) {
      for (const fn of [...(this.listeners.get(key) ?? [])]) {
        try {
          fn(e);
        } catch (err) {
          this.errors.push({ event: e.type, message: (err as Error)?.message ?? String(err) });
        }
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
