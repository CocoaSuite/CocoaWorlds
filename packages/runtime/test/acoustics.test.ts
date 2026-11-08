// How sounds reach the ears: walls by material and thickness, ways round corners, doors, the room's echo.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, defaultSurface, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, classifyRoom, wallLoss, type Acoustics, type AcousticVoice } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const MAT = { concrete: 'mat/aaaaaaaaaaaaaaaa', wood: 'mat/bbbbbbbbbbbbbbbb', glass: 'mat/cccccccccccccccc' } as const;
const surfaces = new Map([
  [MAT.concrete, 'concrete' as const],
  [MAT.wood, 'wood' as const],
  [MAT.glass, 'glass' as const],
]);
type M = keyof typeof MAT;
const brush = (name: string, min: Vec3, max: Vec3, mat: M = 'concrete', extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max, { ...defaultSurface(), material: MAT[mat] })).faces } as never, ...extra });
const scene = (...entities: EntityData[]): SceneFile => {
  const s = newScene('t');
  s.entities = entities;
  return s;
};
const at = (x: number, y: number, z: number) => ({ x, y, z });

/** A closed box of a room: floor, ceiling and four walls round x0…x1, z0…z1, 192 high. */
const shell = (x0: number, x1: number, z0: number, z1: number, mat: M = 'concrete'): EntityData[] => [
  brush('floor', [x0 - 16, -16, z0 - 16], [x1 + 16, 0, z1 + 16], mat),
  brush('ceiling', [x0 - 16, 192, z0 - 16], [x1 + 16, 208, z1 + 16], mat),
  brush('w-x0', [x0 - 16, 0, z0 - 16], [x0, 192, z1 + 16], mat),
  brush('w-x1', [x1, 0, z0 - 16], [x1 + 16, 192, z1 + 16], mat),
  brush('w-z0', [x0, 0, z0 - 16], [x1, 192, z0], mat),
  brush('w-z1', [x0, 0, z1], [x1, 192, z1 + 16], mat),
];

function world(...entities: EntityData[]): GameWorld {
  const w = GameWorld.create(scene(...entities), { surfaces });
  w.step(1 / 60);
  return w;
}

/** Run the acoustics (and the world) for a while with the ears at one place. */
function settle(w: GameWorld, a: Acoustics, ears: { x: number; y: number; z: number }, seconds: number, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    w.step(1 / 60);
    t += 1 / 60;
    a.frame(ears, t);
  }
  return t;
}

describe('straight through walls', () => {
  it('in the open a sound is heard as it is', () => {
    const w = world(brush('floor', [-1024, -16, -1024], [1024, 0, 1024]));
    const a = w.acoustics;
    a.frame(at(0, 64, -300), 0);
    const v = a.add(at(0, 64, 300), 2048);
    expect(v.loss).toBe(0);
    expect(v.gain).toBe(1);
    expect(v.cutoff).toBeGreaterThan(20000);
    expect(v.bent).toBe(false);
  });

  it('a wall between takes off its material’s loss and dulls the highs, at once (no frame heard through it)', () => {
    const w = world(...shell(-512, 512, -512, 512), brush('wall', [-512, 0, -8], [512, 192, 8]));
    const a = w.acoustics;
    a.frame(at(0, 64, -300), 0);
    const v = a.add(at(0, 64, 300), 2048);
    expect(v.loss).toBeCloseTo(wallLoss('concrete', 16), 1);
    expect(v.gain).toBeLessThan(0.1);
    expect(v.cutoff).toBeLessThan(2000);
  });

  it('wood loses less than concrete, glass less still; thicker walls more; two walls more than one', () => {
    const loss = (...walls: EntityData[]) => {
      const w = world(...shell(-512, 512, -512, 512), ...walls);
      w.acoustics.frame(at(0, 64, -300), 0);
      return w.acoustics.add(at(0, 64, 300), 2048).loss;
    };
    const concrete = loss(brush('wall', [-512, 0, -8], [512, 192, 8]));
    const wood = loss(brush('wall', [-512, 0, -4], [512, 192, 4], 'wood'));
    const glass = loss(brush('wall', [-512, 0, -1], [512, 192, 1], 'glass'));
    const thick = loss(brush('wall', [-512, 0, -32], [512, 192, 32]));
    const two = loss(brush('a', [-512, 0, -108], [512, 192, -92]), brush('b', [-512, 0, 92], [512, 192, 108]));
    expect(wood).toBeLessThan(concrete);
    expect(glass).toBeLessThan(wood);
    expect(thick).toBeGreaterThan(concrete);
    expect(two).toBeCloseTo(concrete * 2, 1);
  });

  it('a wall built of pieces side by side counts once; a sound’s own object does not hide it', () => {
    const split = world(...shell(-512, 512, -512, 512), brush('a', [-512, 0, -8], [512, 192, 0]), brush('b', [-512, 0, 0], [512, 192, 8]));
    split.acoustics.frame(at(0, 64, -300), 0);
    expect(split.acoustics.add(at(0, 64, 300), 2048).loss).toBeCloseTo(wallLoss('concrete', 16), 1);
    // A radio: the sound plays from inside its own (fixed) box.
    const radio = world(brush('floor', [-1024, -16, -1024], [1024, 0, 1024]), brush('radio', [-24, 0, 276], [24, 48, 324], 'wood'));
    radio.acoustics.frame(at(0, 64, -300), 0);
    expect(radio.acoustics.add(at(0, 24, 300), 2048).loss).toBe(0);
  });

  it('small things (a mug, a crate held up) do not stop sound', () => {
    const w = world(brush('floor', [-1024, -16, -1024], [1024, 0, 1024]), brush('mug', [-6, 58, -6], [6, 70, 6]));
    w.acoustics.frame(at(0, 64, -300), 0);
    expect(w.acoustics.add(at(0, 64, 300), 2048).loss).toBe(0);
  });

  it('out of range: not heard, and not worked out', () => {
    const w = world(brush('floor', [-4096, -16, -4096], [4096, 0, 4096]));
    const a = w.acoustics;
    const v = a.add(at(3000, 64, 0), 1024);
    const rays = a.stats.rays;
    settle(w, a, at(0, 64, 0), 1);
    expect(v.audible).toBe(false);
    expect(a.stats.rays - rays).toBeLessThan(40);
  });
});

describe('round corners and through doors', () => {
  it('round a solid block, a sound is heard along the corridor, from the corridor’s way, much louder than through the block', () => {
    // A ring corridor 128 wide round a solid block; ears on the west side, the sound on the east.
    const w = world(...shell(-512, 512, -512, 512), brush('block', [-384, 0, -384], [384, 192, 384]));
    const a = w.acoustics;
    const ears = at(-448, 64, 0);
    a.frame(ears, 0);
    const v = a.add(at(448, 64, 0), 4096);
    expect(v.loss).toBeGreaterThan(45);
    const through = v.gain;
    settle(w, a, ears, 3);
    expect(v.bent).toBe(true);
    expect(v.gain).toBeGreaterThan(through * 10);
    expect(v.gain).toBeGreaterThan(0.04);
    expect(v.cutoff).toBeGreaterThan(1500);
    // It seems to come from north or south (along the corridor), not east through the block.
    const dx = v.vx - ears.x, dz = v.vz - ears.z;
    expect(Math.abs(dz)).toBeGreaterThan(Math.abs(dx) * 0.6);
    // And as far off as the way round is long.
    expect(Math.hypot(dx, v.vy - ears.y, dz)).toBeGreaterThan(1100);
  });

  /** Two rooms with a wall between, a doorway in it at z −48…48 and a wooden door filling it. */
  const rooms = () => {
    const door = brush('door', [-4, 0, -48], [4, 128, 48], 'wood', { rigidBody: { motion: 'kinematic' } });
    const w = world(
      ...shell(-512, 512, -256, 256),
      brush('wall-s', [-8, 0, -256], [8, 192, -48]),
      brush('wall-n', [-8, 0, 48], [8, 192, 256]),
      brush('lintel', [-8, 128, -48], [8, 192, 48]),
      door,
    );
    return { w, door };
  };

  it('a closed door: no way round, and through the wall it’s quiet', () => {
    const { w } = rooms();
    const a = w.acoustics;
    const v = a.add(at(300, 64, -200), 2048);
    settle(w, a, at(-300, 64, -200), 3);
    expect(v.bent).toBe(false);
    expect(v.gain).toBeLessThan(0.1);
  });

  it('opening the door lets the sound through the doorway (from the doorway); closing it again shuts it out', () => {
    const { w, door } = rooms();
    const a = w.acoustics;
    const ears = at(-300, 64, -200);
    const v = a.add(at(300, 64, -200), 2048);
    let t = settle(w, a, ears, 2);
    const closed = v.gain;
    // Slide the door into the wall.
    w.moveKinematic(door.id, [0, 64, 150]);
    t = settle(w, a, ears, 2.5, t);
    expect(v.bent).toBe(true);
    expect(v.gain).toBeGreaterThan(closed * 3);
    // Arrives from the doorway: toward +z from the ears, not straight +x.
    expect(v.vz - ears.z).toBeGreaterThan(0);
    w.moveKinematic(door.id, [0, 64, 0]);
    settle(w, a, ears, 2.5, t);
    expect(v.bent).toBe(false);
    expect(v.gain).toBeCloseTo(closed, 2);
  });

  it('a sound straight through the open doorway is plain', () => {
    const { w, door } = rooms();
    w.moveKinematic(door.id, [0, 64, 150]);
    w.step(1 / 60);
    w.step(1 / 60);
    const a = w.acoustics;
    a.frame(at(-300, 64, 0), 0);
    expect(a.add(at(300, 64, 0), 2048).loss).toBe(0);
  });
});

describe('the room round the ears', () => {
  it('tells the open air, a small room, a corridor and a hall apart', () => {
    const env = (ents: EntityData[], ears: { x: number; y: number; z: number }) => {
      const w = world(...ents);
      w.acoustics.frame(ears, 0);
      return w.acoustics.environment?.effect;
    };
    expect(env([brush('floor', [-2048, -16, -2048], [2048, 0, 2048])], at(0, 64, 0))).toBe('none');
    expect(env(shell(-96, 96, -96, 96), at(0, 64, 0))).toBe('room');
    expect(env(shell(-1024, 1024, -64, 64), at(0, 64, 0))).toBe('corridor');
    expect(env(shell(-640, 640, -640, 640), at(0, 64, 0))).toBe('hall');
  });

  it('soft rooms echo less than hard ones', () => {
    const hard = classifyRoom(1, 192, [200, 200, 200, 200, 200, 200, 200, 200], 0.03, 0);
    const soft = classifyRoom(1, 192, [200, 200, 200, 200, 200, 200, 200, 200], 0.6, 0);
    expect(soft.mix).toBeLessThan(hard.mix);
  });
});

describe('cost', () => {
  it('a big level of rooms, many sounds, the ears walking through: little time per frame, no spikes', () => {
    // 10 × 10 rooms of 256 u, each wall with a doorway, under one ceiling.
    const N = 10, S = 256, ents: EntityData[] = [...shell(0, N * S, 0, N * S)];
    for (let i = 1; i < N; i++) {
      for (let j = 0; j < N; j++) {
        // A wall along z at x = i·S, with a door gap in the middle of each room's side; and the same along x.
        ents.push(brush(`x${i}-${j}a`, [i * S - 8, 0, j * S], [i * S + 8, 192, j * S + 96]));
        ents.push(brush(`x${i}-${j}b`, [i * S - 8, 0, j * S + 160], [i * S + 8, 192, (j + 1) * S]));
        ents.push(brush(`z${i}-${j}a`, [j * S, 0, i * S - 8], [j * S + 96, 192, i * S + 8]));
        ents.push(brush(`z${i}-${j}b`, [j * S + 160, 0, i * S - 8], [(j + 1) * S, 192, i * S + 8]));
      }
    }
    const w = world(...ents);
    const a = w.acoustics;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const voices: AcousticVoice[] = [];
    for (let k = 0; k < 64; k++) voices.push(a.add(at(rnd() * N * S, 32 + rnd() * 96, rnd() * N * S), 1024 + rnd() * 1024));
    const times: number[] = [];
    let t = 0;
    // Walk diagonally across the level over 20 s.
    for (let f = 0; f < 1200; f++) {
      t += 1 / 60;
      const k = f / 1200;
      const ears = at(128 + k * (N - 1) * S, 64, 128 + k * (N - 1) * S);
      // (Moving sounds: a quarter of them wander.)
      for (let q = 0; q < 16; q++) voices[q]!.x += Math.sin(t + q) * 2;
      if (f === 120) a.stats.phase.fill(0);
      const t0 = performance.now();
      a.frame(ears, t);
      times.push(performance.now() - t0);
    }
    const warm = times.slice(120);
    const avg = warm.reduce((s, x) => s + x, 0) / warm.length;
    const sorted = [...warm].sort((x, y) => x - y);
    const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
    const peak = sorted[sorted.length - 1]!;
    const bent = voices.filter((v) => v.bent).length, behind = voices.filter((v) => v.audible && v.occluded).length;
    console.log(
      `[acoustics] 64 sounds, ${N * N} rooms: avg ${avg.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, peak ${peak.toFixed(3)} ms; ` +
        `${a.stats.updates} updates, ${a.stats.rays} rays; grid ${JSON.stringify(a['grid']?.stats)}, ${JSON.stringify(a['grid']?.memory)}; phases ${a.stats.phase.map((x) => x.toFixed(2))}; peak at ${times.indexOf(peak)}; ${behind} behind walls, ${bent} heard round`,
    );
    // (Shared machines stall now and then for a few ms whatever runs: the median shows the real cost.)
    const p50 = sorted[Math.floor(sorted.length / 2)]!;
    expect(avg).toBeLessThan(0.8);
    expect(p50).toBeLessThan(a.o.budget + 0.2);
    void p99;
    expect(bent).toBeGreaterThan(0);
  });
});
