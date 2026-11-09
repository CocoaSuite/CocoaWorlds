// Power: sources (generators, breakers) feed outlets; plugs (extension cords, string lights) go into sockets
// (outlets and cords); a socket is live when its chain ends at an outlet whose source is on.
import type { StringLightsData } from '@cocoaworlds/core';

export type P3 = [number, number, number];

export class PowerGrid {
  /** Power sources: on or off. */
  readonly sources = new Map<string, boolean>();
  /** Outlets: the source each is wired to ('' or unknown: always live). */
  readonly outlets = new Map<string, string>();
  /** Plugs: how far each reaches, and the socket it is in. */
  readonly plugs = new Map<string, { cable: number; into: string | null }>();
  /** Extension cords (plugs that are sockets too). */
  readonly cords = new Set<string>();

  isSocket(id: string): boolean {
    return this.outlets.has(id) || this.cords.has(id);
  }

  /** Whether a socket has power. */
  live(socket: string | null, seen = new Set<string>()): boolean {
    if (!socket || seen.has(socket)) return false;
    seen.add(socket);
    const src = this.outlets.get(socket);
    if (src !== undefined) return !src || !this.sources.has(src) || this.sources.get(src)!;
    if (!this.cords.has(socket)) return false;
    return this.live(this.plugs.get(socket)?.into ?? null, seen);
  }

  /** Whether `plug` may go into `socket` (not itself, nor into a cord plugged, down the line, into it). */
  canPlug(plug: string, socket: string): boolean {
    if (!this.plugs.has(plug) || !this.isSocket(socket) || plug === socket) return false;
    for (let s: string | null = socket, n = 0; s && n < 64; s = this.plugs.get(s)?.into ?? null, n++) if (s === plug) return false;
    return true;
  }

  /** Plugs in a socket. */
  pluggedInto(socket: string): string[] {
    return [...this.plugs].filter(([, p]) => p.into === socket).map(([id]) => id);
  }
}

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const dist3 = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A point along a hanging wire from `a` to `b` (t 0–1), its middle `drop` u below the straight line. */
export function along(a: P3, b: P3, drop: number, t: number): P3 {
  const d = drop * 4 * t * (1 - t);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - d, a[2] + (b[2] - a[2]) * t];
}

/** How far the middle of a span hangs. */
export function dropOf(a: P3, b: P3, sagPer100: number): number {
  return (sagPer100 * dist3(a, b)) / 100;
}

/** Points along the wire (n + 1 of them). */
export function wirePoints(a: P3, b: P3, drop: number, n: number): P3[] {
  const out: P3[] = [];
  for (let i = 0; i <= n; i++) out.push(along(a, b, drop, i / n));
  return out;
}

/** Where the bulbs hang (spaced along the span, none right at the ends). */
export function bulbPoints(a: P3, b: P3, data: Pick<StringLightsData, 'spacing' | 'sag'>): P3[] {
  const span = dist3(a, b);
  const n = Math.max(1, Math.floor(span / Math.max(2, data.spacing)));
  const drop = dropOf(a, b, data.sag);
  const out: P3[] = [];
  for (let i = 0; i < n; i++) out.push(along(a, b, drop, (i + 0.5) / n));
  return out;
}

/** The nearest a ray (unit `dir`, up to `reach`) comes to a polyline: how far along the ray, and how close. */
export function rayNearLine(origin: P3, dir: P3, pts: P3[], reach: number): { t: number; d: number } | null {
  let best: { t: number; d: number } | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!, q = pts[i + 1]!;
    const u = sub(q, p), w = sub(origin, p);
    const a = dot(dir, dir), b = dot(dir, u), c = dot(u, u), d = dot(dir, w), e = dot(u, w);
    const den = a * c - b * b;
    let s = den > 1e-9 ? (b * e - c * d) / den : 0;
    let r = den > 1e-9 ? (a * e - b * d) / den : c > 0 ? e / c : 0;
    r = Math.max(0, Math.min(1, r));
    s = Math.max(0, Math.min(reach, (b * r - d) / a));
    const x: P3 = [origin[0] + dir[0] * s, origin[1] + dir[1] * s, origin[2] + dir[2] * s];
    const y: P3 = [p[0] + u[0] * r, p[1] + u[1] * r, p[2] + u[2] * r];
    const gap = dist3(x, y);
    if (!best || gap < best.d) best = { t: s, d: gap };
  }
  return best;
}
