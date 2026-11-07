/**
 * The bench scene: a busy level to measure frame times on (see README.md). Everything is made by the engine's own
 * functions, from a fixed seed, so every run plays the same level.
 *
 * - a 4096 u square of rooms (walls with doorways), lit by bulbs, four of them casting shadows;
 * - 200 physics crates in piles, which blasts throw about;
 * - 40 creatures that wander and hunt the player when they see or hear them (10 with the Hunter mind);
 * - 2,000 plants (grass, leafy clumps, bushes, 100 trees) around and inside the rooms;
 * - a rocket launcher, which the bench fires every few seconds.
 */
import { PLANT_PRESETS, newEntity, newScene, newWeapon, type EntityData, type PlantDef, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';

/** How much of each there is (the README lists the same). */
export const BENCH = { rooms: 8, crates: 200, creatures: 40, hunters: 10, plants: 2000, trees: 100, bulbs: 16, shadowBulbs: 4 };

const ROOM = 512;
const HALF = (BENCH.rooms * ROOM) / 2;

/** A small fixed-seed random number generator (mulberry32), so the level is the same every time. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });

/** The plants the scene uses, for the project's settings (Plants workspace). */
export function benchPlants(): PlantDef[] {
  const pick = (key: string, id: string, name: string): PlantDef => ({ ...PLANT_PRESETS.find((p) => p.key === key)!.def, id, name, preset: key });
  return [pick('grass', 'bench-grass', 'Bench grass'), pick('leafy', 'bench-leafy', 'Bench leafy'), pick('bush', 'bench-bush', 'Bench bush'), pick('poplar', 'bench-poplar', 'Bench poplar')];
}

export function benchScene(): SceneFile {
  const rnd = random(20261107);
  const s = newScene('bench');
  const out: EntityData[] = [...s.entities];
  const spawn = out.find((e) => e.components.playerSpawn)!;
  // The player starts in the middle room's corner, looking into the level.
  spawn.transform.position = [-ROOM / 2 + 64, 0, ROOM / 2 - 64];
  out.push(brush('floor', [-HALF - 2048, -16, -HALF - 2048], [HALF + 2048, 0, HALF + 2048]));

  // Rooms: on each grid line, a wall per cell with a doorway in its middle (two pieces each).
  const H = 192, T = 8, DOOR = 128;
  for (let line = 0; line <= BENCH.rooms; line++) {
    const at = -HALF + line * ROOM;
    for (let cell = 0; cell < BENCH.rooms; cell++) {
      const a = -HALF + cell * ROOM, b = a + ROOM, mid = (a + b) / 2;
      const outer = line === 0 || line === BENCH.rooms;
      for (const [from, to] of outer ? [[a, b]] : [[a, mid - DOOR / 2], [mid + DOOR / 2, b]]) {
        out.push(brush('wall', [from!, 0, at - T], [to!, H, at + T]));
        out.push(brush('wall', [at - T, 0, from!], [at + T, H, to!]));
      }
    }
  }
  // Doorways out of the outer walls on all four sides, so creatures and the player can leave.
  for (const e of out.filter((x) => x.name === 'wall')) {
    const pts = (e.components.brush as { faces: { points: Vec3[] }[] }).faces.flatMap((f) => f.points);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    if ((Math.abs(cx) <= ROOM / 2 && Math.abs(Math.abs(cz) - HALF) < 16) || (Math.abs(cz) <= ROOM / 2 && Math.abs(Math.abs(cx) - HALF) < 16)) e.name = 'gone';
  }
  const level = out.filter((e) => e.name !== 'gone');

  // Bulbs in a ring of rooms; some cast shadows (each is six shadow renders a frame).
  for (let i = 0; i < BENCH.bulbs; i++) {
    const t = (i / BENCH.bulbs) * Math.PI * 2;
    const r = HALF * 0.6;
    level.push(newEntity('bulb', { light: { kind: 'point', color: '#ffe2b0', intensity: 1.5, range: 640, castShadows: i < BENCH.shadowBulbs } }, { position: [Math.cos(t) * r, 160, Math.sin(t) * r] }));
  }

  // Crates in piles of ten, stacked a little off so they topple.
  for (let i = 0; i < BENCH.crates; i++) {
    const pile = Math.floor(i / 10), k = i % 10;
    const px = -HALF + ROOM / 2 + (pile % 5) * ROOM, pz = -HALF + ROOM / 2 + Math.floor(pile / 5) * ROOM;
    const x = px + (rnd() - 0.5) * 24, z = pz + (rnd() - 0.5) * 24, y = k * 34;
    level.push(brush('crate', [x - 16, y, z - 16], [x + 16, y + 32, z + 16], { rigidBody: { motion: 'dynamic' } }));
  }

  // Creatures spread over the level, wandering, all able to see far; a quarter think with the Hunter mind.
  for (let i = 0; i < BENCH.creatures; i++) {
    const x = (rnd() - 0.5) * (HALF * 2 - 128), z = (rnd() - 0.5) * (HALF * 2 - 128);
    level.push(newEntity('creature', { npc: { side: 'hostile', speed: 140, sight: 4096, attack: 'melee', damage: 5, rate: 1, wander: true, mind: i < BENCH.hunters ? 'hunter' : 'simple' } }, { position: [x, 0, z], rotation: [0, rnd() * 360, 0] }));
  }

  // Plants: grass and clumps everywhere, bushes, and trees outside the rooms.
  const plants = benchPlants();
  for (let i = 0; i < BENCH.plants; i++) {
    const tree = i < BENCH.trees;
    let x: number, z: number;
    if (tree) {
      const t = rnd() * Math.PI * 2, r = HALF + 256 + rnd() * 1500;
      x = Math.cos(t) * r;
      z = Math.sin(t) * r;
    } else {
      x = (rnd() - 0.5) * (HALF * 2 + 2048);
      z = (rnd() - 0.5) * (HALF * 2 + 2048);
    }
    const def = tree ? plants[3]! : plants[i % 3]!;
    level.push(newEntity('plant', { plant: { plant: def.id, seed: 1 + (i % 4) } }, { position: [x, 0, z], rotation: [0, rnd() * 360, 0] }));
  }

  s.entities = level;
  s.settings.ui = { screens: [], items: [{ name: 'Launcher', icon: '', weapon: newWeapon('rocket') }, { name: 'Rockets', icon: '' }] } as never;
  return s;
}
