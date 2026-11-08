// The acoustics bench: a big level of rooms joined by doorways, many sounds, the ears walking through it.
// Plain functions, so the bench (acoustics.mjs) and the tests can both use them.
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, defaultSurface, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, type AcousticVoice } from '@cocoaworlds/runtime';

const MAT = 'mat/aaaaaaaaaaaaaaaa';
const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max, { ...defaultSurface(), material: MAT })).faces } as never });

/** `n` × `n` rooms of `size` u, every inner wall with a doorway, under one ceiling (`floors` storeys, joined by a stairwell hole). */
export function roomsScene(n: number, size = 256, floors = 1): SceneFile {
  const H = 192, e: EntityData[] = [];
  const span = n * size;
  for (let f = 0; f < floors; f++) {
    const y = f * (H + 16);
    // Floor (with a stairwell hole in the first room above the ground floor) and walls round the outside.
    if (f === 0) e.push(brush(`floor${f}`, [-16, y - 16, -16], [span + 16, y, span + 16]));
    else {
      e.push(brush(`floor${f}a`, [-16, y - 16, 128], [span + 16, y, span + 16]));
      e.push(brush(`floor${f}b`, [128, y - 16, -16], [span + 16, y, 128]));
    }
    e.push(brush(`wx0-${f}`, [-16, y, -16], [0, y + H, span + 16]), brush(`wx1-${f}`, [span, y, -16], [span + 16, y + H, span + 16]));
    e.push(brush(`wz0-${f}`, [0, y, -16], [span, y + H, 0]), brush(`wz1-${f}`, [0, y, span], [span, y + H, span + 16]));
    for (let i = 1; i < n; i++)
      for (let j = 0; j < n; j++) {
        e.push(brush(`x${f}-${i}-${j}a`, [i * size - 8, y, j * size], [i * size + 8, y + H, j * size + 96]));
        e.push(brush(`x${f}-${i}-${j}b`, [i * size - 8, y, j * size + 160], [i * size + 8, y + H, (j + 1) * size]));
        e.push(brush(`z${f}-${i}-${j}a`, [j * size, y, i * size - 8], [j * size + 96, y + H, i * size + 8]));
        e.push(brush(`z${f}-${i}-${j}b`, [j * size + 160, y, i * size - 8], [(j + 1) * size, y + H, i * size + 8]));
      }
  }
  e.push(brush('roof', [-16, floors * (H + 16) - 16, -16], [span + 16, floors * (H + 16), span + 16]));
  const s = newScene('acoustics-bench');
  s.entities = e;
  return s;
}

export interface AcousticsRun {
  sources: number;
  rooms: number;
  frames: number;
  avg: number;
  p50: number;
  p99: number;
  peak: number;
  /** Frames over 1 ms, and how many of those had a garbage collection in them. */
  over1: number;
  over1gc: number;
  warmup: number;
  updates: number;
  rays: number;
  gridRays: number;
  gridBytes: number;
  floods: number;
  behind: number;
  round: number;
  /** Longest time in each part of a frame (ms): sounds, flood, room echo, measuring. */
  phases: number[];
}

/**
 * Play a scene for `seconds` with `sources` sounds: the ears walk corner to corner. `gcAt` (optional) tells
 * whether a garbage collection happened between two performance.now() times.
 */
export async function runAcoustics(scene: SceneFile, sources: number, seconds = 20, gcAt?: (a: number, b: number) => boolean): Promise<AcousticsRun> {
  await initPhysics();
  const w = GameWorld.create(scene, {});
  w.step(1 / 60);
  const a = w.acoustics;
  const x = (w as unknown as { extent: { min: number[]; max: number[] } }).extent;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const voices: AcousticVoice[] = [];
  for (let k = 0; k < sources; k++) voices.push(a.add({ x: x.min[0]! + rnd() * (x.max[0]! - x.min[0]!), y: 32 + rnd() * 96, z: x.min[2]! + rnd() * (x.max[2]! - x.min[2]!) }, 1024 + rnd() * 1024));
  const frames = Math.round(seconds * 60), warm = 120;
  const times: number[] = [], starts: number[] = [];
  const t0 = performance.now();
  let warmup = 0;
  for (let f = 0; f < frames; f++) {
    const t = f / 60, k = f / frames;
    const ears = { x: x.min[0]! + 128 + k * (x.max[0]! - x.min[0]! - 256), y: 64, z: x.min[2]! + 128 + k * (x.max[2]! - x.min[2]! - 256) };
    for (let q = 0; q < Math.min(16, voices.length); q++) voices[q]!.x += Math.sin(t + q) * 2;
    const s = performance.now();
    a.frame(ears, t);
    const ms = performance.now() - s;
    if (f === warm) {
      warmup = performance.now() - t0;
      a.stats.phase.fill(0);
    }
    if (f >= warm) {
      times.push(ms);
      starts.push(s);
    }
  }
  const sorted = [...times].sort((p, q) => p - q);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  let over1 = 0, over1gc = 0;
  times.forEach((ms, i) => {
    if (ms <= 1) return;
    over1++;
    if (gcAt?.(starts[i]!, starts[i]! + ms)) over1gc++;
  });
  const g = (a as unknown as { grid: { stats: { rays: number; floods: number }; memory: { bytes: number } } | null }).grid;
  return {
    sources,
    rooms: 0,
    frames: times.length,
    avg: times.reduce((s, v) => s + v, 0) / times.length,
    p50: pick(0.5),
    p99: pick(0.99),
    peak: sorted[sorted.length - 1]!,
    over1,
    over1gc,
    warmup,
    updates: a.stats.updates,
    rays: a.stats.rays,
    gridRays: g?.stats.rays ?? 0,
    gridBytes: g?.memory.bytes ?? 0,
    floods: g?.stats.floods ?? 0,
    behind: voices.filter((v) => v.audible && v.occluded).length,
    round: voices.filter((v) => v.bent).length,
    phases: [...a.stats.phase],
  };
}
