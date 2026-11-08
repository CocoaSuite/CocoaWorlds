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
  | { type: 'pickup'; target: string; by: string; time: number }
  | { type: 'drop'; target: string; by: string; time: number }
  /** A poster or painting stuck to a wall, or was taken down. */
  | { type: 'poster.hang'; target: string; time: number }
  | { type: 'poster.takeDown'; target: string; time: number }
  /** A prop stuck into the ground, or was pulled out. */
  | { type: 'stake.stick'; target: string; time: number }
  | { type: 'stake.pull'; target: string; time: number }
  | { type: 'player.hurt'; amount: number; health: number; cause: string; time: number }
  | { type: 'player.die'; cause: string; time: number }
  | { type: 'score'; score: number; by: number; time: number }
  | { type: 'spawn'; template: string; copy: string; time: number }
  /** A 3D printer started printing a copy of an object, or finished it. */
  | { type: 'print.start'; printer: string; copy: string; template: string; time: number }
  | { type: 'print.done'; printer: string; copy: string; time: number }
  | { type: 'break'; target: string; time: number }
  /**
   * A sound starts. `at` is where (null: everywhere, not in 3D); `follow` is a moving object it travels with;
   * `source` is the object making it (for stopping); `range` is how far it carries (units); `areaEffects`
   * false: Sound areas and water don't change it (music, interface sounds; missing: they do).
   */
  | { type: 'sound'; sound: string; at: [number, number, number] | null; follow: string | null; volume: number; loop: boolean; range: number; source: string; areaEffects?: boolean; ambient?: boolean; time: number }
  /** A footstep, landing or jump of the player on a surface (volume 0–1). */
  | { type: 'step'; kind: 'step' | 'land' | 'jump'; surface: string; at: [number, number, number]; volume: number; time: number }
  /** Something hit something: `source` is what moved, `surface` what it sounds like (volume 0–1; `hard`: a big hit). */
  | { type: 'hit'; source: string; surface: string; at: [number, number, number]; volume: number; hard: boolean; time: number }
  | { type: 'sound.stop'; source: string; time: number }
  /** An effect from the VFX workspace plays at a place (`follow`: a moving body it travels with, or 'player'). */
  | { type: 'vfx'; effect: string; at: [number, number, number]; follow: string | null; time: number }
  /** Play an animation of an object's model (the game world has no models; whoever draws them plays it). */
  | { type: 'anim'; target: string; name: string; loop: boolean; time: number }
  | { type: 'message'; name: string; from: string | null; time: number; data?: unknown }
  /** Weapons (A1): a bullet's line or a swing, where it hit, and blasts. */
  | { type: 'shot'; from: [number, number, number]; to: [number, number, number]; by: string; weapon: string; time: number }
  | { type: 'impact'; at: [number, number, number]; normal: [number, number, number]; target: string | null; melee: boolean; time: number }
  /** A creature died. */
  | { type: 'npc.die'; target: string; time: number }
  /** The player is leaving for another scene (a level change). */
  | { type: 'travel'; scene: string; landmark: string; time: number }
  | { type: 'explosion'; at: [number, number, number]; radius: number; normal: [number, number, number] | null; time: number }
  /** A light was switched on or off. */
  | { type: 'light'; target: string; on: boolean; time: number }
  /** Base building: a blueprint placed, a prop put into it, finished, removed (E held), a finished piece knocked down. */
  | { type: 'base.placed'; site: string; piece: string; time: number }
  | { type: 'base.progress'; site: string; piece: string; filled: number; count: number; time: number }
  | { type: 'base.built'; site: string; piece: string; time: number }
  | { type: 'base.removed'; site: string; piece: string; time: number }
  | { type: 'base.broken'; site: string; piece: string; time: number }
  | { type: 'base.door'; site: string; open: boolean; time: number };

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
