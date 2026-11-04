// The Hunter mind: wandering, investigating sounds and hints, searching, chasing, checking hiding spots.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script, Statement } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics, type Npc } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const floor = () => brush('floor', [-2048, -16, -2048], [2048, 0, 2048]);
const spawn = () => newEntity('start', { playerSpawn: {} }, { position: [0, 0, 0], rotation: [0, 0, 0] });
const hunter = (at: Vec3, yawDeg: number, data: Record<string, unknown> = {}, script?: Script) =>
  newEntity('hunter', { npc: { side: 'hostile', mind: 'hunter', speed: 250, attack: 'melee', damage: 10, rate: 1, pull: 0.3, ...data }, ...(script ? { script } : {}) }, { position: at, rotation: [0, yawDeg, 0] });
const score = (n: number): Statement => ({ id: `s${n}`, kind: 'addScore', amount: { id: `n${n}`, kind: 'number', value: n } }) as Statement;
const scriptOf = (...handlers: Script['handlers']): Script => ({ version: 1, variables: [], handlers });
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
/** A seeded 0…1, so runs repeat. */
function seeded(seed = 7): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function make(...entities: EntityData[]): GameWorld {
  const w = GameWorld.create(scene(...entities));
  w.random = seeded();
  return w;
}
const npc = (w: GameWorld) => [...(w as never as { npcs: Map<string, Npc> }).npcs.values()][0]!;
/** Runs, noting each state the creature passes through (in order, without repeats). */
function run(w: GameWorld, seconds: number, until?: () => boolean): string[] {
  const states: string[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    w.step(1 / 60);
    const s = npc(w).state;
    if (states[states.length - 1] !== s) states.push(s);
    if (until?.()) break;
  }
  return states;
}
/** A locker just in front of the player, its door (Look from) facing them. */
function locker(kind = 'locker', script?: Script): EntityData[] {
  const eye = newEntity('locker eye', {}, { position: [0, 50, -55], rotation: [0, 180, 0] });
  const l = brush('locker', [-30, 0, -70], [30, 100, -40], { hidingSpot: { kind, view: eye.id }, ...(script ? { script } : {}) });
  return [l, eye];
}

describe('the Hunter mind', () => {
  it('wanders, stopping now and then for an odd move', () => {
    const h = hunter([0, 0, -1500], 0, { idleChance: 1, waitMin: 0.5, waitMax: 1 }, scriptOf({ id: 'h', event: { id: 'e', kind: 'does', what: '' }, body: [score(1)] }));
    const w = make(floor(), spawn(), h);
    const states = run(w, 20);
    expect(states).toContain('wander');
    expect(states).toContain('idle');
    expect(Math.hypot(npc(w).feet.x, npc(w).feet.z + 1500)).toBeGreaterThan(64);
    expect(w.playerStatus()!.score).toBeGreaterThan(0);
    w.dispose();
  });

  it('a sound breaks off its wandering: it investigates, searches, gives up and wanders again', () => {
    const w = make(floor(), spawn(), hunter([0, 0, -1500], 0, { searchMin: 3, searchMax: 3 }));
    run(w, 1);
    w.noise({ x: 400, y: 0, z: -1500 }, 1);
    const states = run(w, 25);
    const i = states.indexOf('investigate'), s = states.indexOf('search'), back = states.lastIndexOf('wander');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(s).toBeGreaterThan(i);
    expect(back).toBeGreaterThan(s);
    expect(npc(w).mind!.bb.searching).toBe(false);
    w.dispose();
  });

  it('an idle move is cut short the moment something worth looking into is heard', () => {
    const w = make(floor(), spawn(), hunter([0, 0, -1500], 0, { idleChance: 1, moves: 'stare=stare 30; scratch=s 30; tilt=t 30; lookAround=l 30; cluck=c 30; headShake=h 30; twitch=w 30; crouch=c 30' }));
    run(w, 30, () => npc(w).state === 'idle' && npc(w).mind!.plan?.moment != null);
    expect(npc(w).mind!.plan.moment).not.toBeNull();
    w.noise({ x: 300, y: 0, z: -1500 }, 1.5);
    run(w, 2 / 60);
    expect(npc(w).state).toBe('investigate');
    w.dispose();
  });

  it('a sound too far away (or too quiet) is not heard', () => {
    const w = make(floor(), spawn(), hunter([0, 0, -1500], 0));
    run(w, 0.5);
    w.noise({ x: 1500, y: 0, z: 1500 }, 0.3);
    expect(npc(w).mind!.bb.shouldInvestigate).toBe(false);
    w.dispose();
  });

  it('hears within its range times the loudness; a looping sound with loudness calls it', () => {
    const w = make(floor(), spawn(), hunter([0, 0, -1500], 0, { hears: 500 }));
    run(w, 0.5);
    w.noise({ x: 600, y: 0, z: -1500 }, 1);
    expect(npc(w).mind!.bb.shouldInvestigate).toBe(false);
    w.noise({ x: 600, y: 0, z: -1500 }, 2);
    expect(npc(w).mind!.bb.shouldInvestigate).toBe(true);
    w.dispose();

    const radio = newEntity('radio', { sound: { sound: 'radio.ogg', loop: true, loudness: 3 } }, { position: [800, 0, -1500] });
    const w2 = make(floor(), spawn(), radio, hunter([0, 0, -1500], 0, { hears: 500 }));
    const states = run(w2, 4);
    expect(states).toContain('investigate');
    w2.dispose();
  });

  it('a Director hint sends it to look, never at the exact place', () => {
    const w = make(floor(), spawn(), hunter([0, 0, -1500], 0));
    run(w, 0.5);
    w.hint({ x: 300, y: 0, z: -800 }, 0, 1, 'event');
    const s = npc(w).mind!.bb.investigation!;
    const off = Math.hypot(s.at.x - 300, s.at.z + 800);
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThanOrEqual(64);
    expect(run(w, 1)).toContain('investigate');
    w.dispose();
  });

  it('weak or stale news is ignored; fresher, stronger news takes over', () => {
    const w = make(floor(), spawn(), hunter([0, 0, -1500], 0, { notice: 0.4 }));
    run(w, 0.5);
    const m = npc(w).mind!;
    m.offer({ at: { x: 500, y: 0, z: -1500 }, confidence: 0.3, time: w.time, kind: 'sound' });
    expect(m.bb.shouldInvestigate).toBe(false);
    m.offer({ at: { x: 500, y: 0, z: -1500 }, confidence: 1, time: w.time - 100, kind: 'sighting' });
    expect(m.bb.shouldInvestigate).toBe(false);
    m.offer({ at: { x: 500, y: 0, z: -1500 }, confidence: 0.9, time: w.time, kind: 'event' });
    const key = m.bb.investigationKey;
    m.offer({ at: { x: -500, y: 0, z: -1200 }, confidence: 1, time: w.time, kind: 'sighting' });
    expect(m.bb.investigation!.at.x).toBe(-500);
    expect(m.bb.investigationKey).toBe(key + 1);
    w.dispose();
  });

  it('seeing the player: a snap of the head, a chase, an attack', () => {
    const w = make(floor(), spawn(), hunter([0, 0, -600], 180));
    const states = run(w, 5);
    expect(states).toContain('chase');
    expect(states).toContain('attack');
    expect(w.playerStatus()!.health).toBeLessThan(100);
    w.dispose();
  });

  it('losing sight: it goes to where it last saw the player and searches round there', () => {
    const wall = brush('wall', [-400, 0, 900], [400, 300, 940]);
    const w = make(floor(), spawn(), wall, hunter([0, 0, -900], 180, { speed: 60 }));
    run(w, 1);
    expect(npc(w).mind!.bb.hasVisual).toBe(true);
    w.player!.teleport({ x: 0, y: 0, z: 1500 });
    const states = run(w, 30, () => npc(w).state === 'search');
    expect(states).toContain('investigate');
    expect(states[states.length - 1]).toBe('search');
    const last = npc(w).mind!.bb.searchCenter!;
    expect(Math.hypot(last.x, last.z)).toBeLessThan(400);
    w.dispose();
  });

  it('searching, it opens a suspicious hiding spot and pulls out the player inside', () => {
    const found = scriptOf({ id: 'h', event: { id: 'e', kind: 'found' }, body: [score(10)] }, { id: 'h2', event: { id: 'e2', kind: 'does', what: 'open' }, body: [score(1)] });
    const w = make(floor(), spawn(), ...locker('locker', found), hunter([0, 0, -1500], 0, { mediumAt: 0, highAt: 0, spotRange: 2000, searchMin: 30, searchMax: 30 }));
    run(w, 0.1);
    w.use();
    run(w, 0.5);
    expect(w.hidingIn).not.toBeNull();
    expect(npc(w).mind!.bb.shouldInvestigate).toBe(false);
    w.noise({ x: 0, y: 0, z: -300 }, 3);
    run(w, 40, () => w.hidingIn === null);
    expect(w.hidingIn).toBeNull();
    expect(w.playerStatus()!.score).toBe(11);
    expect(w.player!.feetPosition.y).toBeLessThan(10);
    run(w, 3);
    expect(w.playerStatus()!.health).toBeLessThan(100);
    w.dispose();
  });

  it('it can walk past an occupied spot without noticing', () => {
    const w = make(floor(), spawn(), ...locker(), hunter([0, 0, -1500], 0, { mediumAt: 1, highAt: 1, lowChance: 0, spotRange: 2000, searchMin: 4, searchMax: 4 }));
    run(w, 0.1);
    w.use();
    run(w, 0.5);
    w.noise({ x: 0, y: 0, z: -300 }, 3);
    const states = run(w, 25);
    expect(states).toContain('search');
    expect(states).not.toContain('inspect');
    expect(w.hidingIn).not.toBeNull();
    w.dispose();
  });

  it('knocking and listening: a noise from inside makes it open up', () => {
    const knock = scriptOf({ id: 'h', event: { id: 'e', kind: 'does', what: 'knock' }, body: [{ id: 'n', kind: 'noise', at: { self: true }, loudness: { id: 'r', kind: 'number', value: 0.6 } } as Statement] });
    const w = make(floor(), spawn(), ...locker('cabinet', knock), hunter([0, 0, -1500], 0, { mediumAt: 0, highAt: 0.99, mediumChance: 1, spotRange: 2000, searchMin: 30, searchMax: 30 }));
    run(w, 0.1);
    w.use();
    run(w, 0.5);
    w.noise({ x: 0, y: 0, z: -300 }, 3);
    run(w, 40, () => w.hidingIn === null);
    expect(w.hidingIn).toBeNull();
    w.dispose();
  });

  it('seen getting in, the player is pulled straight out', () => {
    const w = make(floor(), spawn(), ...locker(), hunter([400, 0, -400], 180));
    run(w, 0.1);
    w.use();
    run(w, 0.3);
    expect(w.hidingIn).not.toBeNull();
    run(w, 10, () => w.hidingIn === null);
    expect(w.hidingIn).toBeNull();
    w.dispose();
  });
});
