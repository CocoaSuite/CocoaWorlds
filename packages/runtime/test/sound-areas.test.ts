// Background sound and Sound areas: which effect the player hears, and which background plays.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, type GameEvent } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const area = (name: string, min: Vec3, max: Vec3, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => brush(name, min, max, { soundArea: data, ...extra });
function scene(entities: EntityData[], settings: Record<string, unknown> = {}): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  Object.assign(s.settings, settings);
  return s;
}
const at = (x: number, y: number, z: number) => ({ x, y, z });

describe('hearing', () => {
  const cave = () => area('cave', [-512, 0, -512], [512, 256, 512], { effect: 'cave', mix: 0.8, sound: 'sounds/drips.ogg', volume: 0.5 });
  const room = () => area('room', [-64, 0, -64], [64, 128, 64], { effect: 'room' });

  it('is plain outside every area, with the scene’s background sound', () => {
    const w = GameWorld.create(scene([cave()], { backgroundSound: { sound: 'sounds/wind.ogg', volume: 0.7 } }));
    expect(w.hearing(at(2000, 50, 0))).toEqual({ area: null, effect: 'none', mix: 1, background: { sound: 'sounds/wind.ogg', volume: 0.7 }, underwater: false });
  });

  it('takes the area’s effect, mix and background inside it', () => {
    const w = GameWorld.create(scene([cave()], { backgroundSound: { sound: 'sounds/wind.ogg', volume: 0.7 } }));
    const h = w.hearing(at(0, 50, 300));
    expect(h.area).toBe(w['doc'].entities[0]!.id);
    expect(h).toMatchObject({ effect: 'cave', mix: 0.8, background: { sound: 'sounds/drips.ogg', volume: 0.5 } });
  });

  it('keeps the scene’s background in an area without its own; none at all without either', () => {
    expect(GameWorld.create(scene([room()], { backgroundSound: { sound: 'sounds/wind.ogg', volume: 1 } })).hearing(at(0, 50, 0)).background).toEqual({ sound: 'sounds/wind.ogg', volume: 1 });
    expect(GameWorld.create(scene([room()])).hearing(at(0, 50, 0)).background).toBeNull();
  });

  it('the smallest of overlapping areas wins, whichever comes first', () => {
    for (const order of [[cave(), room()], [room(), cave()]]) {
      const w = GameWorld.create(scene(order));
      expect(w.hearing(at(0, 50, 0)).effect).toBe('room');
      // Out of the room, still in the cave (and its background comes back).
      expect(w.hearing(at(200, 50, 0))).toMatchObject({ effect: 'cave', background: { sound: 'sounds/drips.ogg' } });
    }
  });

  it('under water is muffled, in an area or not', () => {
    const water = brush('water', [-1024, -256, -1024], [1024, -8, 1024], { water: { tint: '#28607a', clearness: 640, drowns: false } });
    const w = GameWorld.create(scene([water, area('deep', [-128, -256, -128], [128, 256, 128], { effect: 'hall' })]));
    expect(w.hearing(at(500, -100, 0))).toMatchObject({ effect: 'underwater', mix: 1, underwater: true, area: null });
    expect(w.hearing(at(0, -100, 0))).toMatchObject({ effect: 'underwater', underwater: true });
    expect(w.hearing(at(0, 50, 0))).toMatchObject({ effect: 'hall', underwater: false });
  });

  it('a sound area is not part of the level: nothing collides with it', () => {
    const w = GameWorld.create(scene([brush('floor', [-512, -16, -512], [512, 0, 512]), room()]));
    expect(w.levelIds.size).toBe(1);
  });

  it('can be a trigger zone too', () => {
    const events: GameEvent[] = [];
    const w = GameWorld.create(scene([brush('floor', [-512, -16, -512], [512, 0, 512]), area('room', [-64, 0, -64], [64, 128, 64], { effect: 'room' }, { trigger: { detects: 'player', once: false } }), newEntity('start', { playerSpawn: {} }, { position: [0, 0, 0] })]));
    w.bus.on('trigger.enter', (e) => void events.push(e));
    for (let t = 0; t < 0.5; t += 1 / 60) w.step(1 / 60);
    expect(events.length).toBe(1);
    expect(w.hearing(at(0, 50, 0)).effect).toBe('room');
  });
});

describe('sounds and areas', () => {
  it('a Sound component says whether areas change it', () => {
    const on = newEntity('hum', { sound: { sound: 'sounds/hum.ogg' } });
    const off = newEntity('music', { sound: { sound: 'sounds/music.ogg', areaEffects: false } });
    const w = GameWorld.create(scene([on, off]));
    const got: Record<string, boolean | undefined> = {};
    w.bus.on('sound', (e) => void (got[e.sound] = e.areaEffects));
    w.step(1 / 60);
    expect(got).toEqual({ 'sounds/hum.ogg': true, 'sounds/music.ogg': false });
  });
});
