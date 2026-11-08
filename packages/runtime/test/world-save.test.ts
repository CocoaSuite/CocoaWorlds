// Keeping the world (saveWorld): every object's place, copies, what was taken away, creatures and the player
// come back in the next session.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics, type SavedProgress } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
const n = (value: number) => ({ id: Math.random().toString(36), kind: 'number' as const, value });
const send = (w: GameWorld, message: string) => {
  (w as unknown as { runner: { dispatch(e: unknown): void } }).runner.dispatch({ type: 'message', message, to: null, from: null });
  run(w, 0.1);
};
/** Saved as the game stores it (through JSON). */
const store = (w: GameWorld): SavedProgress => JSON.parse(JSON.stringify(w.progress()));

function scene(): { s: SceneFile; crate: EntityData; door: EntityData; junk: EntityData; spot: EntityData } {
  const s = newScene('yard');
  const crate = brush('crate', [-16, 0, -96], [16, 32, -64], { rigidBody: { motion: 'dynamic', mass: 10 } });
  const door = brush('door', [200, 0, 0], [208, 96, 64]);
  const junk = brush('junk', [-300, 0, 0], [-280, 20, 20], { rigidBody: { motion: 'dynamic', mass: 5 } });
  const spot = newEntity('spot');
  spot.transform.position = [400, 40, 400];
  const script: Script = {
    version: 1,
    variables: [],
    handlers: [
      { id: 'h1', event: { id: 'e1', kind: 'message', message: 'open' }, body: [{ id: 'm', kind: 'move', target: { entity: door.id }, direction: 'up', distance: n(64), seconds: n(0.2) }] },
      { id: 'h2', event: { id: 'e2', kind: 'message', message: 'tidy' }, body: [{ id: 'r', kind: 'remove', target: { entity: junk.id } }] },
      { id: 'h3', event: { id: 'e3', kind: 'message', message: 'copy' }, body: [{ id: 'c', kind: 'spawn', template: { entity: crate.id }, at: { entity: spot.id } }] },
    ],
  };
  s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }), crate, door, junk, spot, newEntity('brain', { script: script as never })];
  return { s, crate, door, junk, spot };
}

describe('keeping the world', () => {
  it('a carried crate, a moved door, a removed object, a copy and the player all come back', () => {
    const { s, crate, door, junk } = scene();
    const w1 = GameWorld.create(s, { rules: { saveWorld: true } });
    w1.setPlayerInput({ pitch: -0.45 });
    run(w1, 0.2);
    // Carry the crate off to one side and drop it.
    w1.use();
    run(w1, 0.4);
    expect(w1.holding).toBe(crate.id);
    w1.setPlayerInput({ pitch: 0, yaw: Math.PI / 2 });
    run(w1, 0.5);
    w1.use();
    run(w1, 1.5);
    send(w1, 'open');
    send(w1, 'tidy');
    send(w1, 'copy');
    run(w1, 1);
    w1.setPlayerInput({ forward: 1 });
    run(w1, 0.5);
    w1.setPlayerInput({ forward: 0 });
    run(w1, 0.5);
    const crateAt = w1.positionOf(crate.id)!;
    const doorAt = w1.positionOf(door.id)!;
    const copyId = `${crate.id}#1`;
    const copyAt = w1.positionOf(copyId)!;
    const feet = w1.playerView()!.feet;
    expect(Math.abs(crateAt[0])).toBeGreaterThan(30);
    expect(w1.positionOf(junk.id)).toBeNull();
    const saved = store(w1);
    expect(saved.scene).toBe('yard');
    w1.dispose();

    const w2 = GameWorld.create(s, { rules: { saveWorld: true }, saved });
    run(w2, 0.1);
    const near = (a: number[], b: number[], d = 2) => a.forEach((x, i) => expect(Math.abs(x - b[i]!)).toBeLessThan(d));
    near(w2.positionOf(crate.id)!, crateAt);
    near(w2.positionOf(door.id)!, doorAt);
    near(w2.positionOf(copyId)!, copyAt);
    expect(w2.positionOf(junk.id)).toBeNull();
    near(w2.playerView()!.feet, feet, 3);
    // The door doesn't slide back; nothing is copied twice.
    run(w2, 1);
    near(w2.positionOf(door.id)!, doorAt);
    expect(w2.positionOf(`${crate.id}#2`)).toBeNull();
    // A new copy takes the next number.
    send(w2, 'copy');
    expect(w2.positionOf(`${crate.id}#2`)).not.toBeNull();
    w2.dispose();
  });

  it('copies the start blocks make are made again by them, not twice, and keep where they were moved', () => {
    const s = newScene('start');
    const crate = brush('crate', [-16, 0, -96], [16, 32, -64], { rigidBody: { motion: 'dynamic', mass: 10 } });
    const spot = newEntity('spot');
    spot.transform.position = [300, 40, 0];
    const script: Script = { version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'start' }, body: [{ id: 'c', kind: 'spawn', template: { entity: crate.id }, at: { entity: spot.id } }] }] };
    s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), crate, spot, newEntity('brain', { script: script as never })];
    const w1 = GameWorld.create(s, { rules: { saveWorld: true } });
    run(w1, 1);
    const id = `${crate.id}#1`;
    expect(w1.positionOf(id)).not.toBeNull();
    // Moved by hand (as if carried).
    const b = (w1 as unknown as { bodies: Map<string, { body: { setTranslation(t: unknown, wake: boolean): void } }> }).bodies.get(id)!;
    b.body.setTranslation({ x: -500, y: 16, z: 500 }, true);
    run(w1, 1);
    const at = w1.positionOf(id)!;
    const saved = store(w1);
    expect(saved.world!.start!.copies).toEqual([]);
    w1.dispose();
    const w2 = GameWorld.create(s, { rules: { saveWorld: true }, saved });
    run(w2, 0.2);
    expect(w2.positionOf(`${crate.id}#2`)).toBeNull();
    const now = w2.positionOf(id)!;
    expect(Math.abs(now[0] - at[0]) + Math.abs(now[2] - at[2])).toBeLessThan(2);
    w2.dispose();
  });

  it('is off unless the game keeps the world; forgetting progress stops keeping it', () => {
    const { s } = scene();
    const off = GameWorld.create(s);
    expect(off.progress()).toBeNull();
    off.dispose();
    const w = GameWorld.create(s, { rules: { saveWorld: true } });
    run(w, 0.1);
    expect(w.progress()!.world).toBeDefined();
    w.forgetProgress();
    expect(w.progress()!.world).toBeUndefined();
    w.dispose();
  });

  it('with a “Save the game” block, the game is kept only as of that block', () => {
    const { s, door } = scene();
    const brain = s.entities.find((e) => e.name === 'brain')!;
    const script = brain.components.script as unknown as Script;
    script.handlers.push({ id: 'h9', event: { id: 'e9', kind: 'message', message: 'save' }, body: [{ id: 'sv', kind: 'saveGame' }] });
    const w1 = GameWorld.create(s, { rules: { saveWorld: true } });
    run(w1, 0.1);
    expect(w1.progress()).toBeNull();
    send(w1, 'save');
    send(w1, 'open');
    run(w1, 0.5);
    const saved = store(w1);
    w1.dispose();
    const w2 = GameWorld.create(s, { rules: { saveWorld: true }, saved });
    run(w2, 0.1);
    // Saved before the door opened.
    expect(w2.positionOf(door.id)![1]).toBeLessThan(60);
    w2.dispose();
  });

  it('the save menu: the game saves only when asked; scripts can block saving and loading', () => {
    const { s, door } = scene();
    const brain = s.entities.find((e) => e.name === 'brain')!;
    const script = brain.components.script as unknown as Script;
    script.handlers.push({ id: 'hb', event: { id: 'eb', kind: 'message', message: 'block' }, body: [{ id: 'b1', kind: 'blockSaving' }] });
    script.handlers.push({ id: 'ha', event: { id: 'ea', kind: 'message', message: 'allow' }, body: [{ id: 'a1', kind: 'allowSaving' }] });
    const w = GameWorld.create(s, { rules: { saveWorld: true, saveMenu: true }, clock: () => 1000 });
    run(w, 0.1);
    expect(w.progress()).toBeNull();
    w.saveNow();
    expect(w.progress()!.at).toBe(1_000_000);
    send(w, 'open');
    run(w, 0.5);
    // Not saved again by itself.
    expect(w.progress()!.world!.yard!.bodies[door.id]).toBeUndefined();
    send(w, 'block');
    expect(w.savingBlocked).toBe(true);
    send(w, 'allow');
    expect(w.savingBlocked).toBe(false);
    w.dispose();
  });

  it('a scene left this session comes back as it was left', () => {
    const { s, crate } = scene();
    const other = newScene('cellar');
    other.entities = [brush('floor', [-512, -16, -512], [512, 0, 512]), newEntity('start', { playerSpawn: {} })];
    const w1 = GameWorld.create(s, { rules: { saveWorld: true } });
    run(w1, 0.1);
    const b = (w1 as unknown as { bodies: Map<string, { body: { setTranslation(t: unknown, wake: boolean): void } }> }).bodies.get(crate.id)!;
    b.body.setTranslation({ x: 700, y: 16, z: -700 }, true);
    run(w1, 1);
    w1.changeScene('cellar');
    const t1 = w1.travel!;
    w1.dispose();
    const w2 = GameWorld.create(other, { rules: { saveWorld: true }, arrive: t1 });
    run(w2, 0.1);
    w2.changeScene('yard');
    const t2 = w2.travel!;
    w2.dispose();
    const w3 = GameWorld.create(s, { rules: { saveWorld: true }, arrive: t2 });
    run(w3, 0.1);
    expect(Math.abs(w3.positionOf(crate.id)![0] - 700)).toBeLessThan(2);
    w3.dispose();
  });

  it('stacks that ran “only once” or “once a day” stay spent after loading', () => {
    const make = () => {
      const s = newScene('yard');
      const box = newEntity('box', {});
      box.id = 'box';
      const stack = (id: string, limit: 'once' | 'day', what: string) => ({ id, event: { id: `e${id}`, kind: 'message', message: 'ring', limit }, body: [{ id: `c${id}`, kind: 'change', variable: what, by: n(1) }] });
      box.components.script = { version: 1, variables: [{ name: 'a', type: 'number', initial: 0 }, { name: 'b', type: 'number', initial: 0 }], handlers: [stack('h1', 'once', 'a'), stack('h2', 'day', 'b')] } as Script as never;
      s.entities = [brush('floor', [-512, -16, -512], [512, 0, 512]), newEntity('start', { playerSpawn: {} }), box];
      return s;
    };
    const w1 = GameWorld.create(make(), { rules: { saveWorld: true } });
    run(w1, 0.1);
    send(w1, 'ring');
    const saved = store(w1);
    expect(saved.world?.yard?.spent?.box).toBeDefined();
    const w2 = GameWorld.create(make(), { rules: { saveWorld: true }, saved });
    run(w2, 0.1);
    const vars = () => (w2 as unknown as { runner: { instances: { program: { owner: string }; vars: number[] }[] } }).runner.instances.find((i) => i.program.owner === 'box')!.vars;
    send(w2, 'ring');
    expect(vars()).toEqual([0, 0]);
    (w2 as unknown as { day: number }).day++;
    send(w2, 'ring');
    expect(vars()).toEqual([0, 1]);
  });
});

