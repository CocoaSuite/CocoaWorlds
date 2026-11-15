/** Pixel-block figures for the twilit forest's bosses and monsters (16 px to a block, facing −z). */

type Kind = 'lit' | 'glow' | 'eye';
type Part = [string, number, number, number, number, number, number, number, string, Kind?];
type Joints = Record<string, [string, number, number, number]>;
export type Style = 'biped' | 'spider' | 'serpent' | 'quad';

const P = (j: string, w: number, h: number, d: number, x: number, y: number, z: number, c: string, k?: Kind, rz = 0): Part => [j, w, h, d, x, y, z, rz, c, k];
/** The same part on both sides (x mirrored; `j` gets L/R). */
const two = (j: string, w: number, h: number, d: number, x: number, y: number, z: number, c: string, k?: Kind, rz = 0): Part[] => [P(j.replace('*', 'L'), w, h, d, -x, y, z, c, k, rz), P(j.replace('*', 'R'), w, h, d, x, y, z, c, k, -rz)];
const sym = (j: string, w: number, h: number, d: number, x: number, y: number, z: number, c: string, k?: Kind, rz = 0): Part[] => [P(j, w, h, d, -x, y, z, c, k, rz), P(j, w, h, d, x, y, z, c, k, -rz)];
const legs4 = (x: number, y: number, z: number): Joints => ({ legFL: ['root', -x, y, -z], legFR: ['root', x, y, -z], legBL: ['root', -x, y, z], legBR: ['root', x, y, z] });
const quadLegs = (w: number, h: number, c: string, hoof?: string): Part[] =>
  ['legFL', 'legFR', 'legBL', 'legBR'].flatMap((j) => [P(j, w, h, w, 0, -h / 2, 0, c), ...(hoof ? [P(j, w + 1, 3, w + 1, 0, -h + 1.5, 0, hoof)] : [])]);

export const FOREST_MODELS: Record<string, { h: number; style?: Style; joints: Joints; parts: Part[] }> = {
  rootwarden: {
    h: 66,
    joints: { legL: ['root', -6, 16, 0], legR: ['root', 6, 16, 0], body: ['root', 0, 16, 0], head: ['body', 0, 30, -2], armL: ['body', -14, 27, 0], armR: ['body', 14, 27, 0] },
    parts: [
      ...two('leg*', 8, 16, 8, 6, -8, 0, '#5a4632').map((p) => ((p[4] = 0), p)), ...two('leg*', 10, 3, 12, 6, -14.5, -2, '#4a3a2a').map((p) => ((p[4] = 0), p)),
      P('body', 20, 30, 16, 0, 15, 0, '#6e5640'), ...sym('body', 2, 30, 17, 5, 15, 0, '#56422f'), P('body', 12, 6, 2, 0, 9, -8.5, '#4f7a4a'), P('body', 6, 6, 1, 0, 20, -8.2, '#2a1e14'),
      P('head', 14, 12, 12, 0, 6, 0, '#6e5640'), ...sym('head', 3, 2, 1, 3.5, 7, -6.2, '#b8ff6a', 'eye'), P('head', 12, 2, 1, 0, 9.5, -6.3, '#4a3a2a'),
      P('head', 3, 10, 3, -5, 15, 0, '#5a4632', undefined, 0.4), P('head', 3, 12, 3, 4, 16, 1, '#5a4632', undefined, -0.3),
      P('head', 10, 6, 10, -7, 20, 0, '#3f6a44'), P('head', 12, 7, 10, 6, 22, 1, '#4a7a4a'), P('head', 8, 5, 8, 0, 18, 4, '#3f6a44'),
      ...two('arm*', 6, 26, 6, 0, -12, 0, '#5a4632'), ...two('arm*', 10, 10, 10, 0, -27, 0, '#4a7a4a', 'glow'),
    ],
  },
  fenwyrm: {
    h: 62,
    style: 'serpent',
    joints: { body: ['root', 0, 8, 0], neck1: ['body', 0, 8, 4], neck2: ['neck1', 0, 14, -3], head: ['neck2', 0, 14, -4], armL: ['head', 0, -1, -4] },
    parts: [
      P('body', 28, 8, 28, 0, 0, 4, '#2f5e58'), P('body', 22, 7, 22, 0, 7, 4, '#3a7068'), P('body', 20, 2, 20, 0, -4, 4, '#c8c090'),
      P('neck1', 11, 16, 11, 0, 7, 0, '#3a7068'), P('neck1', 7, 16, 1, 0, 7, -5.8, '#c8c090'), P('neck1', 2, 10, 8, 0, 9, 5, '#6fe0c8', 'eye'),
      P('neck2', 10, 16, 10, 0, 7, 0, '#2f5e58'), P('neck2', 6, 16, 1, 0, 7, -5.3, '#c8c090'), P('neck2', 2, 10, 6, 0, 9, 5, '#6fe0c8', 'eye'),
      P('head', 12, 9, 16, 0, 3, -4, '#3a7068'), ...sym('head', 2, 2, 1, 4, 5, -12.2, '#eaff7a', 'eye'), ...sym('head', 2, 8, 8, 5, 8, 0, '#6fe0c8', 'eye', 0.4),
      P('head', 1, 6, 1, 0, 9, -8, '#2f5e58'), P('head', 2, 2, 2, 0, 12, -8, '#bfffef', 'eye'),
      P('armL', 11, 3, 14, 0, -1.5, -3, '#2f5e58', 'glow'), P('armL', 9, 1, 1, 0, 0.5, -9.5, '#f0ead8'),
    ],
  },
  mycelord: {
    h: 58,
    joints: { legL: ['root', -8, 18, 0], legR: ['root', 8, 18, 0], body: ['root', 0, 18, 0], head: ['body', 0, 23, 0], armL: ['body', -15, 20, 0], armR: ['body', 15, 20, 0] },
    parts: [
      P('legL', 10, 18, 10, 0, -9, 0, '#d8ccb0'), P('legR', 10, 18, 10, 0, -9, 0, '#d8ccb0'),
      P('body', 24, 22, 18, 0, 11, 0, '#cfc2a4'), P('body', 8, 3, 6, -12, 14, 4, '#8a5aa8'), P('body', 6, 3, 5, 12, 8, -3, '#8a5aa8'), P('body', 22, 2, 16, 0, 22.5, 0, '#6a4a5a'),
      P('head', 10, 4, 10, 0, 2, 0, '#d8ccb0'), P('head', 34, 8, 34, 0, 8, 0, '#7a3a8a'), P('head', 26, 4, 26, 0, 14, 0, '#8a4a9a'),
      P('head', 4, 1, 4, -8, 16.2, -4, '#e0b0ff', 'eye'), P('head', 3, 1, 3, 6, 16.2, 5, '#e0b0ff', 'eye'), P('head', 3, 1, 3, 9, 12.2, -12, '#e0b0ff', 'eye'), ...sym('head', 3, 2, 1, 4, 1, -5.2, '#ffd0ff', 'eye'),
      ...two('arm*', 7, 22, 7, 0, -10, 0, '#cfc2a4'), ...two('arm*', 12, 12, 12, 0, -25, 0, '#a890c0', 'glow'),
    ],
  },
  rime_stag: {
    h: 62,
    style: 'quad',
    joints: { ...legs4(6, 22, 10), body: ['root', 0, 22, 0], head: ['body', 0, 10, -16] },
    parts: [
      ...quadLegs(5, 22, '#cfe0ee', '#6a7a8a'),
      P('body', 16, 14, 30, 0, 6, 0, '#d8e8f4'), P('body', 14, 2, 26, 0, -1.2, 0, '#a8c0d4'), P('body', 14, 8, 8, 0, 12, -12, '#f4fbff'), P('body', 3, 6, 3, 0, 15, 2, '#bfe8ff', 'eye'), P('body', 3, 5, 3, 0, 14, 8, '#bfe8ff', 'eye'),
      P('head', 8, 14, 8, 0, 4, 2, '#d8e8f4'), P('head', 9, 9, 14, 0, 12, -4, '#e4f0f8'), P('head', 6, 5, 4, 0, 10, -12, '#a8c0d4'), ...sym('head', 2, 2, 1, 4.6, 13, -6, '#7fd8ff', 'eye'),
      ...sym('head', 2, 14, 2, 4, 22, -2, '#bfe8ff', 'glow', -0.3), ...sym('head', 8, 2, 2, 8, 24, -2, '#bfe8ff', 'glow'), ...sym('head', 2, 8, 2, 9, 28, -3, '#bfe8ff', 'glow', -0.2), ...sym('head', 6, 2, 2, 6, 19, -4, '#bfe8ff', 'glow'),
    ],
  },
  cinder_colossus: {
    h: 64,
    joints: { legL: ['root', -9, 22, 0], legR: ['root', 9, 22, 0], body: ['root', 0, 22, 0], head: ['body', 0, 26, -2], armL: ['body', -22, 24, 0], armR: ['body', 22, 24, 0] },
    parts: [
      P('legL', 12, 22, 12, 0, -11, 0, '#3a3436'), P('legR', 12, 22, 12, 0, -11, 0, '#3a3436'), P('legL', 2, 18, 13, 0, -11, 0, '#ff7a2a', 'eye'), P('legR', 2, 18, 13, 0, -11, 0, '#ff7a2a', 'eye'),
      P('body', 34, 26, 22, 0, 13, 0, '#463e40'), P('body', 10, 10, 2, 0, 14, -11.5, '#ffb040', 'eye'), P('body', 2, 20, 23, -8, 12, 0, '#ff7a2a', 'eye'), P('body', 2, 16, 23, 9, 14, 0, '#ff6a20', 'eye'),
      ...sym('body', 12, 8, 14, 19, 26, 0, '#2e2a2c'), ...sym('body', 3, 6, 3, 19, 32, 3, '#ff8a3a', 'eye'),
      P('head', 12, 10, 11, 0, 5, 0, '#3a3436'), ...sym('head', 3, 2, 1, 3, 6, -5.7, '#ffd060', 'eye'), P('head', 6, 1, 1, 0, 2, -5.7, '#ff7a2a', 'eye'),
      ...two('arm*', 11, 26, 11, 0, -12, 0, '#463e40'), ...two('arm*', 15, 13, 15, 0, -30, 0, '#2e2a2c', 'glow'),
    ],
  },
  dusk_sovereign: {
    h: 56,
    joints: { legL: ['root', -4, 14, 0], legR: ['root', 4, 14, 0], body: ['root', 0, 14, 0], head: ['body', 0, 22, 0], armL: ['body', -9, 20, 0], armR: ['body', 9, 20, 0], tool: ['armR', 0, -18, 0] },
    parts: [
      P('legL', 6, 14, 6, 0, -7, 0, '#2a2040'), P('legR', 6, 14, 6, 0, -7, 0, '#2a2040'),
      P('body', 18, 16, 14, 0, -6, 0, '#4a3470'), P('body', 14, 20, 10, 0, 10, 0, '#5a4088'), P('body', 15, 2, 11, 0, 4, 0, '#d8c070'), P('body', 16, 30, 2, 0, 6, 6.5, '#2a1e44'), P('body', 16, 3, 12, 0, 20, 0, '#2a1e44'), P('body', 3, 3, 1, 0, 15, -5.5, '#e8dcff', 'eye'),
      P('head', 9, 10, 9, 0, 5, 0, '#c8c0d8'), ...sym('head', 2, 1, 1, 2, 6, -4.6, '#c8a0ff', 'eye'), P('head', 11, 3, 11, 0, 11, 0, '#e0d090'), ...sym('head', 2, 5, 2, 4, 14, 0, '#d8c8ff', 'eye'), P('head', 2, 6, 2, 0, 14.5, -4, '#d8c8ff', 'eye'), P('head', 14, 1, 14, 0, 18, 0, '#c8a0ff', 'eye'),
      ...two('arm*', 5, 18, 5, 0, -8, 0, '#5a4088'), ...two('arm*', 4, 4, 4, 0, -18, 0, '#c8c0d8'),
      P('tool', 2, 10, 2, 0, -2, 0, '#2a2040'), P('tool', 8, 2, 3, 0, -6, 0, '#e0d090'), P('tool', 3, 30, 1, 0, -20, 0, '#c8a0ff', 'glow'),
    ],
  },
  // ── Monsters ──
  thornling: {
    h: 15,
    joints: { legL: ['root', -3, 4, 0], legR: ['root', 3, 4, 0], body: ['root', 0, 4, 0], armL: ['body', -6, 6, 0], armR: ['body', 6, 6, 0] },
    parts: [
      P('legL', 3, 4, 3, 0, -2, 0, '#3a2a1a'), P('legR', 3, 4, 3, 0, -2, 0, '#3a2a1a'),
      P('body', 12, 10, 12, 0, 5, 0, '#3f6a3a'), P('body', 1, 3, 1, -6, 8, 0, '#a08a5a', undefined, 0.6), P('body', 1, 3, 1, 6, 6, 2, '#a08a5a', undefined, -0.6), P('body', 1, 3, 1, 2, 10.5, -3, '#a08a5a'), ...sym('body', 2, 2, 1, 2.5, 6, -6.2, '#f0e070', 'eye'),
      ...two('arm*', 2, 6, 2, 0, -3, 0, '#5a4632'),
    ],
  },
  barkback: {
    h: 9,
    style: 'quad',
    joints: { ...legs4(6, 3, 6), body: ['root', 0, 3, 0], head: ['body', 0, 2, -12] },
    parts: [...quadLegs(2, 3, '#3a2a1a'), P('body', 16, 6, 22, 0, 3, 0, '#5a4030'), P('body', 1, 6.2, 22, 0, 3, 0, '#3a2a1e'), P('body', 2, 4, 2, 0, 7, -10, '#d0c090'), P('head', 8, 5, 5, 0, 1, 0, '#4a3426'), ...sym('head', 1, 1, 1, 2.5, 2, -2.6, '#9aff6a', 'eye')],
  },
  bog_lurker: {
    h: 22,
    joints: { legL: ['root', -3, 8, 0], legR: ['root', 3, 8, 0], body: ['root', 0, 8, 0], head: ['body', 0, 12, -2], armL: ['body', -6.5, 11, 0], armR: ['body', 6.5, 11, 0] },
    parts: [
      P('legL', 4, 8, 4, 0, -4, 0, '#3e3a28'), P('legR', 4, 8, 4, 0, -4, 0, '#3e3a28'),
      P('body', 10, 12, 7, 0, 6, 1, '#4e5a38'), P('body', 1, 6, 1, -3, 15, 0, '#8a9a5a'), P('body', 1, 5, 1, 2, 14, 1, '#8a9a5a'),
      P('head', 8, 7, 7, 0, 3, -1, '#5a6440'), ...sym('head', 2, 1, 1, 2, 4, -4.6, '#e8f0c0', 'eye'),
      ...two('arm*', 3, 12, 3, 0, -6, 0, '#4e5a38'), ...two('arm*', 4, 2, 4, 0, -12.5, 0, '#2e2a1a'),
    ],
  },
  spitter_toad: {
    h: 10,
    style: 'quad',
    joints: { ...legs4(6, 2, 5), body: ['root', 0, 3, 0], head: ['body', 0, 4, -6] },
    parts: [
      ...quadLegs(3, 3, '#5a6a32'),
      P('body', 14, 8, 14, 0, 3, 0, '#6a7a3a'), P('body', 3, 1, 3, -3, 7.2, 2, '#4a5a2a'), P('body', 2, 1, 2, 3, 7.2, -2, '#4a5a2a'), P('body', 12, 2, 12, 0, -1.2, 0, '#c8c890'),
      P('head', 12, 3, 4, 0, 0, -2, '#5a6a32'), ...sym('head', 3, 3, 3, 4, 3, -1, '#e0e060', 'eye'),
    ],
  },
  shroomling: {
    h: 15,
    joints: { legL: ['root', -2, 3, 0], legR: ['root', 2, 3, 0], body: ['root', 0, 3, 0], head: ['body', 0, 7, 0], armL: ['body', -4.5, 5, 0], armR: ['body', 4.5, 5, 0] },
    parts: [
      P('legL', 3, 3, 3, 0, -1.5, 0, '#cfc2a4'), P('legR', 3, 3, 3, 0, -1.5, 0, '#cfc2a4'),
      P('body', 7, 7, 7, 0, 3.5, 0, '#e0d4b8'), ...sym('body', 1, 2, 1, 1.8, 5, -3.6, '#1a1020'),
      P('head', 13, 5, 13, 0, 2.5, 0, '#8a4a9a'), P('head', 2, 1, 2, -3, 5.2, 2, '#e0c0f0'), P('head', 2, 1, 2, 3, 5.2, -3, '#e0c0f0'),
      ...two('arm*', 2, 4, 2, 0, -2, 0, '#e0d4b8'),
    ],
  },
  sporecap: {
    h: 21,
    joints: { legL: ['root', -2, 5, 0], legR: ['root', 2, 5, 0], body: ['root', 0, 5, 0], head: ['body', 0, 10, 0], armL: ['body', -4, 9, 0], armR: ['body', 4, 9, 0] },
    parts: [
      P('legL', 3, 5, 3, 0, -2.5, 0, '#d8ccb0'), P('legR', 3, 5, 3, 0, -2.5, 0, '#d8ccb0'),
      P('body', 6, 10, 6, 0, 5, 0, '#d8ccb0'), ...sym('body', 1, 2, 1, 1.6, 8, -3.1, '#101020'),
      P('head', 12, 5, 12, 0, 2.5, 0, '#2a5a8a'), P('head', 2, 1, 2, -3, 5.2, 1, '#9ae0ff', 'eye'), P('head', 2, 1, 2, 3, 5.2, -2, '#9ae0ff', 'eye'), P('head', 2, 1, 2, 0, 5.2, 3, '#9ae0ff', 'eye'),
      ...two('arm*', 2, 7, 2, 0, -3.5, 0, '#d8ccb0'),
    ],
  },
  frost_wolf: {
    h: 13,
    style: 'quad',
    joints: { ...legs4(3, 6, 6), body: ['root', 0, 6, 0], head: ['body', 0, 5, -10] },
    parts: [
      ...quadLegs(3, 6, '#c8d8e8'),
      P('body', 8, 7, 18, 0, 3, 0, '#dce8f4'), P('body', 10, 8, 5, 0, 4, -7, '#f4f8fc'), P('body', 3, 3, 8, 0, 5, 12, '#c8d8e8'),
      P('head', 7, 6, 7, 0, 1, -2, '#dce8f4'), P('head', 4, 3, 4, 0, 0, -7, '#a8bcd0'), ...sym('head', 2, 3, 1, 2, 5, -1, '#a8bcd0'), ...sym('head', 1, 1, 1, 2, 2, -5.6, '#6fd8ff', 'eye'),
    ],
  },
  ice_imp: {
    h: 18,
    joints: { legL: ['root', -2, 5, 0], legR: ['root', 2, 5, 0], body: ['root', 0, 5, 0], head: ['body', 0, 7, 0], armL: ['body', -4.5, 6, 0], armR: ['body', 4.5, 6, 0] },
    parts: [
      P('legL', 3, 5, 3, 0, -2.5, 0, '#8ab8d8'), P('legR', 3, 5, 3, 0, -2.5, 0, '#8ab8d8'),
      P('body', 7, 7, 5, 0, 3.5, 0, '#a8d0ec'), ...sym('body', 1, 6, 7, 3, 5, 4, '#d8f0ff', undefined, 0.5),
      P('head', 7, 6, 6, 0, 3, 0, '#bfe0f4'), ...sym('head', 1, 4, 1, 3, 8, 0, '#e8f8ff', 'eye', 0.4), ...sym('head', 1, 1, 1, 1.6, 3.5, -3.1, '#1a5a9a', 'eye'),
      ...two('arm*', 2, 6, 2, 0, -3, 0, '#a8d0ec'),
    ],
  },
  cinder_hound: {
    h: 14,
    style: 'quad',
    joints: { ...legs4(3, 6, 6), body: ['root', 0, 6, 0], head: ['body', 0, 5, -10] },
    parts: [
      ...quadLegs(3, 6, '#2a2426'),
      P('body', 9, 7, 18, 0, 3, 0, '#3a3234'), P('body', 1, 7.2, 14, 0, 3, 0, '#ff7a2a', 'eye'), P('body', 8, 4, 6, 0, 8, -6, '#ff9a3a', 'eye'), P('body', 2, 2, 8, 0, 5, 12, '#ff7a2a', 'eye'),
      P('head', 7, 6, 7, 0, 1, -2, '#3a3234'), P('head', 4, 3, 4, 0, 0, -7, '#2a2426'), ...sym('head', 1, 1, 1, 2, 2, -5.6, '#ffd060', 'eye'),
    ],
  },
  magma_crawler: {
    h: 9,
    style: 'quad',
    joints: { ...legs4(7, 3, 6), body: ['root', 0, 3, 0], head: ['body', 0, 2, -12] },
    parts: [
      ...quadLegs(3, 3, '#3a2018'),
      P('body', 14, 6, 24, 0, 3, 0, '#4a2a22'), P('body', 10, 2, 4, 0, 6.6, -6, '#ff6a20', 'eye'), P('body', 10, 2, 4, 0, 6.6, 2, '#ff6a20', 'eye'), P('body', 8, 2, 4, 0, 6.6, 9, '#ff6a20', 'eye'), P('body', 5, 4, 10, 0, 2, 16, '#4a2a22'),
      P('head', 8, 5, 6, 0, 1, -2, '#5a3228'), ...sym('head', 1, 1, 1, 2.5, 2, -5.1, '#ffd060', 'eye'),
    ],
  },
  duskguard: {
    h: 25,
    joints: { legL: ['root', -3, 9, 0], legR: ['root', 3, 9, 0], body: ['root', 0, 9, 0], head: ['body', 0, 11, 0], armL: ['body', -7.5, 10, 0], armR: ['body', 7.5, 10, 0], tool: ['armR', 0, -10, 0] },
    parts: [
      P('legL', 4, 9, 4, 0, -4.5, 0, '#3a3450'), P('legR', 4, 9, 4, 0, -4.5, 0, '#3a3450'),
      P('body', 12, 11, 7, 0, 5.5, 0, '#5a5478'), P('body', 13, 1, 8, 0, 1, 0, '#2a2440'), P('body', 6, 8, 1, 0, 4, -3.8, '#6a4a9a'),
      P('head', 8, 8, 8, 0, 4, 0, '#6a6488'), P('head', 6, 1, 1, 0, 4, -4.2, '#c8a0ff', 'eye'), P('head', 2, 4, 6, 0, 9, 1, '#8a5ac8'),
      ...two('arm*', 3, 10, 3, 0, -5, 0, '#5a5478'), P('tool', 2, 14, 1, 0, -6, 0, '#b8b0d8'),
    ],
  },
  star_archer: {
    h: 24,
    joints: { legL: ['root', -2, 8, 0], legR: ['root', 2, 8, 0], body: ['root', 0, 8, 0], head: ['body', 0, 10, 0], armL: ['body', -6, 9, 0], armR: ['body', 6, 9, 0] },
    parts: [
      P('legL', 3, 8, 3, 0, -4, 0, '#2a2440'), P('legR', 3, 8, 3, 0, -4, 0, '#2a2440'),
      P('body', 10, 12, 7, 0, 4, 0, '#3a2e5a'), P('body', 11, 1, 8, 0, 6, 0, '#d8c070'),
      P('head', 8, 8, 8, 0, 4, 0, '#2a2048'), P('head', 4, 3, 1, 0, 4, -4.1, '#e8dcff', 'eye'),
      ...two('arm*', 2, 9, 2, 0, -4.5, 0, '#3a2e5a'), P('armL', 1, 14, 2, 0, -9, -2, '#c8a0ff', 'glow'),
    ],
  },
};
