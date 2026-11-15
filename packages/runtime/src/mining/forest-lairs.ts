/**
 * What stands in the twilit forest: trees, the glade camp, small ruins, and each region's lair with its boss.
 * Built into volumes of blocks (KEEP: left to the ground).
 */
import { KEEP, rand, Vol } from './structures';

export interface Pal {
  (name: string): number;
}

export interface Built {
  vol: Vol;
  /** Boss spot (in the volume), if any. */
  boss?: [number, number, number];
  /** How far below the ground the volume's floor starts. */
  sink: number;
  label: string;
}

// ── Trees: [dx, dy, dz, id] from the trunk's foot. ──

export type Tree = [number, number, number, number][];

function blob(t: Tree, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, id: number, r: () => number, holes = 0.12) {
  for (let y = Math.floor(-ry); y <= Math.ceil(ry); y++)
    for (let z = Math.floor(-rz); z <= Math.ceil(rz); z++)
      for (let x = Math.floor(-rx); x <= Math.ceil(rx); x++) {
        const d = (x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2;
        if (d <= 1 && !(d > 0.6 && r() < holes)) t.push([cx + x, cy + y, cz + z, id]);
      }
}

export function tree(kind: string, seed: number, p: Pal): Tree {
  const r = rand(seed), t: Tree = [];
  const trunk = (h: number, id: number) => {
    for (let y = 0; y < h; y++) t.push([0, y, 0, id]);
  };
  if (kind === 'dusk') {
    const h = 5 + Math.floor(r() * 3);
    blob(t, 0, h, 0, 2.6, 2.2, 2.6, p('dusk_leaves'), r);
    trunk(h, p('dusk_log'));
  } else if (kind === 'firefly') {
    t.push([0, 0, 0, p('firefly_bush')]);
    if (r() < 0.4) t.push([1, 0, 0, p('firefly_bush')]);
  } else if (kind === 'giant') {
    // A hollow giant: a ring of bark with a doorway, roots, a wide canopy; something left inside.
    const h = 20 + Math.floor(r() * 9), B = p('giant_bark');
    blob(t, 0, h + 2, 0, 9, 4, 9, p('canopy_leaves'), r, 0.2);
    for (const [bx, bz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) for (let i = 3; i < 8; i++) t.push([bx * i, h - 1 + Math.floor(i / 3), bz * i, B]);
    for (let y = 0; y < h; y++)
      for (let z = -3; z <= 3; z++)
        for (let x = -3; x <= 3; x++) {
          const d = Math.hypot(x, z);
          if (d > 3.4) continue;
          const door = y < 3 && z === -3 && Math.abs(x) <= 1;
          t.push([x, y, z, d < 2.2 || door ? 0 : B]);
        }
    for (const [bx, bz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) for (let i = 3; i < 6; i++) t.push([bx * i, i < 5 ? 0 : -1, bz * i, B]);
    if (r() < 0.6) t.push([1, 0, 1, p('chest')]);
    t.push([0, 4, 1, p('lantern')]);
  } else if (kind === 'willow') {
    const h = 4 + Math.floor(r() * 3), L = p('willow_leaves');
    blob(t, 0, h, 0, 3.2, 1.6, 3.2, L, r);
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2, x = Math.round(Math.cos(a) * 3), z = Math.round(Math.sin(a) * 3), n = 2 + Math.floor(r() * 3);
      for (let k = 1; k <= n; k++) t.push([x, h - k, z, L]);
    }
    trunk(h, p('willow_log'));
  } else if (kind === 'mushroom' || kind === 'glowcap') {
    const big = kind === 'mushroom', h = big ? 5 + Math.floor(r() * 5) : 3 + Math.floor(r() * 2), R = big ? 3 + Math.floor(r() * 2) : 2;
    const cap = p(big && r() < 0.8 ? 'red_cap' : 'glow_cap');
    for (let z = -R; z <= R; z++)
      for (let x = -R; x <= R; x++) {
        const d = Math.hypot(x, z);
        if (d > R + 0.3) continue;
        t.push([x, h, z, cap]);
        if (d < R - 1) t.push([x, h + 1, z, cap]);
        else if (big) t.push([x, h - 1, z, cap]);
      }
    trunk(h, p('mushroom_stem'));
  } else if (kind === 'pine') {
    const h = 9 + Math.floor(r() * 6), N = p('pine_needles');
    for (let y = 3; y <= h + 1; y++) {
      const R = Math.max(0, Math.round(((h + 1 - y) / (h - 2)) * 3.4 - ((y - 3) % 2) * 0.8));
      for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) if (Math.abs(x) + Math.abs(z) <= R + 0.5) t.push([x, y, z, N]);
    }
    trunk(h, p('pine_log'));
  } else if (kind === 'charred') {
    const h = 4 + Math.floor(r() * 4), C = p('char_log');
    trunk(h, C);
    const dx = r() < 0.5 ? 1 : -1;
    t.push([dx, h - 2, 0, C], [dx * 2, h - 1, 0, C]);
    if (r() < 0.5) t.push([0, h - 3, 1, C], [0, h - 2, 2, C]);
  }
  return t;
}

// ── The glade camp: a ring of six pedestals round a fire. ──

export const PEDESTALS: [number, number][] = Array.from({ length: 6 }, (_, i) => [Math.round(Math.cos((i / 6) * Math.PI * 2) * 6), Math.round(Math.sin((i / 6) * Math.PI * 2) * 6)]);

export function camp(p: Pal): Built {
  const v = new Vol(19, 6, 19), P = p('planks'), L = p('lantern');
  v.ellipsoid(9.5, 0, 9.5, 9.5, 5.5, 9.5, (_, x, y, z) => (y === 0 ? (Math.hypot(x - 9, z - 9) < 8 ? P : KEEP) : 0));
  v.box(8, 1, 8, 10, 1, 10, p('stone'));
  v.set(9, 2, 9, L);
  for (const [x, z] of PEDESTALS) v.set(9 + x, 1, 9 + z, p('pedestal'));
  return { vol: v, sink: 1, label: 'Lantern Glade' };
}

// ── Ruins: a broken tower, a buried crypt, a hollow hill; walls of the region's bricks. ──

export function ruin(kind: number, seed: number, brick: number, p: Pal): Built {
  const r = rand(seed), C = p('chest'), L = p('lantern'), W = p('web');
  if (kind === 0) {
    const v = new Vol(11, 16, 11), h = 9 + Math.floor(r() * 6);
    for (let y = 0; y < h; y++)
      for (let z = 0; z < 11; z++)
        for (let x = 0; x < 11; x++) {
          const d = Math.hypot(x - 5, z - 5);
          if (d > 5.4) continue;
          // (Broken off unevenly at the top.)
          if (y > h - 4 && r() < (y - h + 4) * 0.25) continue;
          v.set(x, y, z, d > 4.2 ? brick : y === 0 || y === 7 ? brick : 0);
        }
    v.box(5, 1, 0, 5, 3, 1, 0);
    for (let s = 0; s < 6; s++) v.set(5 + Math.round(Math.cos(s) * 3), 1 + s, 5 + Math.round(Math.sin(s) * 3), brick);
    v.box(4, 7, 4, 6, 7, 6, 0);
    v.set(3, 8, 5, C);
    v.set(7, 3, 7, L);
    return { vol: v, sink: 1, label: 'Ruined tower' };
  }
  if (kind === 1) {
    const v = new Vol(15, 10, 15);
    v.room(1, 0, 1, 13, 6, 13, brick);
    for (let s = 1; s <= 7; s++) {
      v.box(6, 7 - s, 15 - s, 8, 7 - s, 15 - s, brick);
      v.box(6, 8 - s, 15 - s, 8, 10 - s, 15 - s, 0);
    }
    v.set(3, 1, 3, C);
    if (r() < 0.5) v.set(11, 1, 3, C);
    v.set(7, 5, 3, L);
    for (let i = 0; i < 18; i++) {
      const x = 2 + Math.floor(r() * 11), y = 1 + Math.floor(r() * 5), z = 2 + Math.floor(r() * 7);
      if (v.get(x, y, z) === 0) v.set(x, y, z, W);
    }
    return { vol: v, sink: 8, label: 'Buried crypt' };
  }
  const v = new Vol(17, 9, 17);
  v.ellipsoid(8.5, 0, 8.5, 8.5, 8, 8.5, (d, x, y, z) => (d > 0.82 ? (y === 0 ? brick : p('dirt')) : y === 0 ? brick : 0));
  v.box(8, 1, 0, 8, 3, 3, 0);
  v.pillar(8, 8, 1, 6, brick);
  v.set(4, 1, 8, C);
  v.set(12, 1, 8, C);
  v.set(8, 5, 6, L);
  return { vol: v, sink: 1, label: 'Hollow hill' };
}

// ── Lairs ──

function rootHall(seed: number, p: Pal): Built {
  // A dead giant stump above; inside it, a stair winds down to a pillared hall of roots.
  const r = rand(seed), v = new Vol(41, 36, 41), B = p('giant_bark'), R = p('root_bricks'), L = p('lantern'), C = p('chest');
  const g = 20;
  for (let y = g; y < g + 15; y++)
    for (let z = 0; z < 41; z++)
      for (let x = 0; x < 41; x++) {
        const d = Math.hypot(x - 20, z - 20);
        const top = g + 9 + Math.floor(hashy(x, z, seed) * 6);
        if (d < 9.5 && y < top) v.set(x, y, z, d > 7.5 ? B : 0);
      }
  v.box(19, g, 11, 21, g + 3, 12, 0);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] as const)
    for (let i = 9; i < 17; i++) v.set(Math.round(20 + dx * i), g + Math.max(0, 3 - Math.floor((i - 9) / 2)), Math.round(20 + dz * i), B);
  // The hall below.
  v.room(2, 2, 2, 38, 16, 38, R);
  for (const [px, pz] of [[10, 10], [30, 10], [10, 30], [30, 30], [20, 8], [20, 32], [8, 20], [32, 20]] as const) v.pillar(px, pz, 3, 15, B, R);
  for (const [lx, lz] of [[10, 12], [30, 12], [10, 28], [30, 28]] as const) v.set(lx, 8, lz, L);
  // The stair: round the stump's inside, down through the hall's roof.
  for (let s = 0; s <= g - 3; s++) {
    const a = s * 0.42;
    const x = Math.round(20 + Math.cos(a) * 5.5), z = Math.round(20 + Math.sin(a) * 5.5), y = g - s;
    v.box(x - 1, y, z - 1, x + 1, y, z + 1, R);
    v.box(x - 1, y + 1, z - 1, x + 1, y + 3, z + 1, 0);
  }
  v.box(14, 16, 14, 26, 19, 26, 0);
  // Side rooms with chests.
  for (const [x0, z0] of [[3, 3], [33, 3], [3, 33], [33, 33]] as const) {
    v.box(x0, 3, z0, x0 + 3, 5, z0 + 3, 0);
    if (r() < 0.75) v.set(x0 + 1, 3, z0 + 1, C);
  }
  v.set(20, 3, 36, p('vault'));
  return { vol: v, boss: [20, 3, 24], sink: g, label: 'Root Hall' };
}

function drownedTemple(seed: number, p: Pal): Built {
  // A temple half sunk in its own lake: colonnades, a flooded hall, a pool at the heart.
  const r = rand(seed), v = new Vol(46, 18, 46), D = p('drowned_bricks'), Wt = p('water'), L = p('lantern'), C = p('chest'), Wl = p('willow_leaves');
  v.ellipsoid(23, 3, 23, 23, 4, 23, (d, x, y) => (y <= 2 ? Wt : 0));
  v.box(6, 0, 6, 39, 2, 39, D);
  v.box(6, 3, 6, 39, 3, 39, Wt);
  v.room(8, 3, 8, 37, 15, 37, D);
  // Broken roof, open to the dusk in places.
  for (let i = 0; i < 40; i++) {
    const x = 9 + Math.floor(r() * 28), z = 9 + Math.floor(r() * 28);
    v.box(x, 15, z, x + 1, 15, z + 1, 0);
  }
  v.box(9, 3, 9, 36, 3, 36, Wt);
  for (let x = 12; x <= 34; x += 5) {
    v.pillar(x, 12, 4, 14, D);
    v.pillar(x, 33, 4, 14, D);
  }
  v.box(21, 4, 8, 24, 7, 8, 0);
  v.box(20, 0, 2, 25, 2, 8, D);
  for (let s = 0; s < 3; s++) v.box(20, 3 + s, 2 + s, 25, 3 + s, 3 + s, D);
  // The pool where it waits, and its strongbox past it.
  v.ellipsoid(23, 3, 22, 7, 2, 7, (_, x, y) => (y === 3 ? Wt : y < 3 ? D : null));
  v.box(21, 4, 35, 25, 4, 36, D);
  v.set(23, 5, 36, p('vault'));
  for (const [x, z] of [[11, 11], [34, 11], [11, 34], [34, 34]] as const) {
    v.set(x, 8, z, L);
    if (r() < 0.7) v.set(x, 4, z === 11 ? 10 : 35, C);
  }
  for (let i = 0; i < 30; i++) {
    const x = 9 + Math.floor(r() * 28), z = 9 + Math.floor(r() * 28);
    for (let k = 0; k < 3; k++) v.set(x, 14 - k, z, Wl);
  }
  return { vol: v, boss: [23, 4, 22], sink: 3, label: 'Drowned Temple' };
}

function sporeSpire(seed: number, p: Pal): Built {
  // A mushroom the height of a hill: a ramp winds up inside its stem to a hall under the cap.
  const r = rand(seed), v = new Vol(49, 62, 49), S = p('mushroom_stem'), Cp = p('red_cap'), G = p('glow_cap'), Br = p('spore_bricks'), C = p('chest');
  const c = 24, top = 44;
  for (let y = 0; y < top; y++)
    for (let z = 0; z < 49; z++)
      for (let x = 0; x < 49; x++) {
        const d = Math.hypot(x - c, z - c), R = 7 + Math.max(0, 6 - y) * 0.6;
        if (d < R) v.set(x, y, z, d > R - 1.6 ? S : 0);
      }
  v.box(c - 1, 0, c - 11, c + 1, 3, c - 5, 0);
  const step = (s: number): [number, number] => [Math.round(c + Math.cos(s * 0.33) * 4), Math.round(c + Math.sin(s * 0.33) * 4)];
  for (let s = 0; s <= top; s++) {
    const a = s * 0.33, x = Math.round(c + Math.cos(a) * 4), z = Math.round(c + Math.sin(a) * 4);
    v.box(x - 1, s, z - 1, x + 1, s, z + 1, Br);
    if (s % 12 === 6) {
      v.set(x, s + 1, z, r() < 0.7 ? C : 0);
      v.set(Math.round(c + Math.cos(a) * 6), s + 3, Math.round(c + Math.sin(a) * 6), G);
    }
  }
  // The cap and the hall beneath it.
  v.ellipsoid(c, top + 4, c, 24, 9, 24, (d, x, y) => (y < top ? null : d > 0.75 ? Cp : 0));
  v.ellipsoid(c, top, c, 18, 1, 18, (_, x, y) => (y === top ? Br : null));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    v.set(Math.round(c + Math.cos(a) * 15), top + 1, Math.round(c + Math.sin(a) * 15), G);
  }
  for (let s = top - 4; s < top; s++) {
    const [x, z] = step(s);
    v.box(x - 1, s + 1, z - 1, x + 1, Math.min(top, s + 3), z + 1, 0);
  }
  v.set(c, top + 1, c + 14, p('vault'));
  return { vol: v, boss: [c, top + 1, c], sink: 0, label: 'Spore Spire' };
}

function rimeKeep(seed: number, p: Pal): Built {
  // An ice keep: walls and four towers round a snowy yard, the stag's hall within.
  const r = rand(seed), v = new Vol(48, 26, 48), K = p('rime_bricks'), I = p('ice'), Sn = p('snow'), L = p('lantern'), C = p('chest');
  v.box(0, 0, 0, 47, 0, 47, K);
  v.box(1, 1, 1, 46, 20, 46, 0);
  v.box(1, 1, 1, 46, 10, 2, K);
  v.box(1, 1, 45, 46, 10, 46, K);
  v.box(1, 1, 1, 2, 10, 46, K);
  v.box(45, 1, 1, 46, 10, 46, K);
  for (let x = 1; x <= 46; x += 2) {
    v.set(x, 11, 1, K);
    v.set(x, 11, 46, K);
    v.set(1, 11, x, K);
    v.set(46, 11, x, K);
  }
  v.box(22, 1, 1, 25, 6, 2, 0);
  for (const [tx, tz] of [[4, 4], [43, 4], [4, 43], [43, 43]] as const) {
    v.ellipsoid(tx, 8, tz, 4, 12, 4, (d) => (d > 0.7 ? K : 0));
    v.box(tx - 3, 0, tz - 3, tx + 3, 0, tz + 3, K);
    v.set(tx, 1, tz, r() < 0.8 ? C : 0);
    v.set(tx, 5, tz, L);
  }
  v.box(3, 1, 3, 44, 1, 44, Sn);
  // The hall.
  v.room(10, 1, 14, 37, 18, 42, K, I);
  v.box(22, 2, 14, 25, 8, 14, 0);
  for (const [px, pz] of [[15, 20], [32, 20], [15, 30], [32, 30], [15, 38], [32, 38]] as const) v.pillar(px, pz, 2, 17, I, K);
  for (const [lx, lz] of [[12, 18], [35, 18], [12, 38], [35, 38]] as const) v.set(lx, 9, lz, L);
  v.set(23, 2, 40, p('vault'));
  return { vol: v, boss: [23, 2, 28], sink: 1, label: 'Rime Keep' };
}

function cinderForge(seed: number, p: Pal): Built {
  // A small volcano: a tunnel leads in to the forge hall at its root, lava running in channels.
  const r = rand(seed), v = new Vol(64, 34, 64), Ba = p('basalt'), F = p('forge_bricks'), Lv = p('lava'), C = p('chest'), L = p('lantern');
  const c = 32;
  for (let y = 0; y < 34; y++)
    for (let z = 0; z < 64; z++)
      for (let x = 0; x < 64; x++) {
        const d = Math.hypot(x - c, z - c), R = 31 - y * 0.8;
        if (d < R) v.set(x, y, z, d < 5 + y * 0.12 && y > 22 ? (y < 26 ? Lv : 0) : Ba);
      }
  v.room(14, 1, 14, 50, 15, 50, F);
  v.box(c - 2, 2, 0, c + 2, 6, 14, 0);
  v.box(c - 2, 1, 0, c + 2, 1, 14, F);
  for (const x of [20, 44]) v.box(x, 1, 16, x + 1, 1, 48, Lv);
  for (const z of [22, 42]) v.box(23, 1, z, 41, 1, z, Lv);
  for (const [px, pz] of [[18, 18], [46, 18], [18, 46], [46, 46]] as const) v.pillar(px, pz, 2, 14, F, Ba);
  for (const [lx, lz] of [[16, 26], [48, 26], [16, 40], [48, 40]] as const) v.set(lx, 7, lz, L);
  v.set(17, 2, 47, r() < 0.8 ? C : 0);
  v.set(47, 2, 47, C);
  v.set(c, 2, 48, p('vault'));
  return { vol: v, boss: [c, 2, 32], sink: 1, label: 'Cinder Forge' };
}

function moonCourt(seed: number, p: Pal): Built {
  // A stair tower climbs to a court floating over the ground, colonnade and throne at its edge.
  const v = new Vol(46, 70, 46), M = p('moon_bricks'), S = p('moon_stone'), St = p('star_block'), C = p('chest');
  const c = 23, top = 52;
  // The floating court: a disc of moonstone, hanging beneath it in a cone.
  v.ellipsoid(c, top, c, 22, 14, 22, (d, x, y, z) => {
    if (y > top) return null;
    const rr = Math.hypot(x - c, z - c), depth = (22 - rr) * 0.6;
    return y >= top - depth ? S : null;
  });
  for (let y = 0; y < top; y++)
    for (let z = 0; z < 46; z++)
      for (let x = 0; x < 46; x++) {
        const d = Math.hypot(x - c, z - c);
        if (d < 6) v.set(x, y, z, d > 4.8 ? M : 0);
      }
  v.box(c - 1, 1, c - 6, c + 1, 3, c - 5, 0);
  for (let s = 0; s < top; s++) {
    const a = s * 0.45, x = Math.round(c + Math.cos(a) * 3), z = Math.round(c + Math.sin(a) * 3);
    v.box(x - 1, s, z - 1, x, s, z, M);
    if (s % 10 === 5) v.set(Math.round(c + Math.cos(a) * 4.6), s + 2, Math.round(c + Math.sin(a) * 4.6), St);
  }
  {
    const a = (top - 1) * 0.45, x = Math.round(c + Math.cos(a) * 3), z = Math.round(c + Math.sin(a) * 3);
    v.box(x - 1, top, z - 1, x + 1, top, z + 1, 0);
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, x = Math.round(c + Math.cos(a) * 19), z = Math.round(c + Math.sin(a) * 19);
    v.box(x, top + 1, z, x, top + 7, z, M);
    if (i % 2 === 0) v.set(x, top + 8, z, St);
  }
  v.box(c - 3, top + 1, c + 15, c + 3, top + 1, c + 18, M);
  v.box(c - 1, top + 2, c + 17, c + 1, top + 5, c + 18, M);
  v.set(c, top + 2, c + 16, p('vault'));
  v.set(c - 8, top + 1, c - 14, C);
  v.set(c + 8, top + 1, c - 14, C);
  return { vol: v, boss: [c, top + 1, c + 4], sink: 0, label: 'Moon Court' };
}

const hashy = (x: number, z: number, s: number) => (((Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ s) >>> 0) % 1000) / 1000;

export const LAIRS: Record<string, (seed: number, p: Pal) => Built> = {
  root_hall: rootHall,
  drowned_temple: drownedTemple,
  spore_spire: sporeSpire,
  rime_keep: rimeKeep,
  cinder_forge: cinderForge,
  moon_court: moonCourt,
};
