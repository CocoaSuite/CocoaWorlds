/**
 * Frame times while playing, for the bench (`tools/bench`) and the status line: the time between frames, the game's
 * tick (the world's step plus moving what is drawn), the world's step alone, the drawing (CPU side: what it takes
 * to send the frame to the graphics card), draw calls and triangles. Kept in a ring of the last few thousand
 * frames; nothing is made per frame.
 */

/** Numbers kept per frame, in this order. */
export const FRAME_FIELDS = ['interval', 'tick', 'world', 'draw', 'draws', 'triangles'] as const;

const N = FRAME_FIELDS.length;

export class FrameLog {
  private data: Float64Array;
  private next = 0;
  private count = 0;

  constructor(private size = 8192) {
    this.data = new Float64Array(size * N);
  }

  add(interval: number, tick: number, world: number, draw: number, draws: number, triangles: number): void {
    const o = this.next * N, d = this.data;
    d[o] = interval;
    d[o + 1] = tick;
    d[o + 2] = world;
    d[o + 3] = draw;
    d[o + 4] = draws;
    d[o + 5] = triangles;
    this.next = (this.next + 1) % this.size;
    this.count = Math.min(this.size, this.count + 1);
  }

  /** The frames kept, oldest first, one array per field (and forget them). */
  take(): Record<(typeof FRAME_FIELDS)[number], number[]> {
    const out = Object.fromEntries(FRAME_FIELDS.map((f) => [f, [] as number[]])) as Record<(typeof FRAME_FIELDS)[number], number[]>;
    const start = (this.next - this.count + this.size) % this.size;
    for (let k = 0; k < this.count; k++) {
      const o = ((start + k) % this.size) * N;
      FRAME_FIELDS.forEach((f, i) => out[f].push(this.data[o + i]!));
    }
    this.count = 0;
    return out;
  }
}
