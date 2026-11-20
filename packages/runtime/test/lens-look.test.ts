// Camera lens blocks (fade a setting, a look, focus, back to the scene's look) and “When the player looks at / away”.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { compileScript, type Expr, type LookMode, type Script, type Statement } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const spawn = () => newEntity('start', { playerSpawn: {} }, { position: [0, 0, 0], rotation: [0, 0, 0] });
const floor = () => brush('floor', [-2048, -16, -2048], [2048, 0, 2048]);
function scene(settings: Record<string, unknown>, ...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  Object.assign(s.settings, settings);
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
let k = 0;
const id = () => `b${k++}`;
const n = (value: number): Expr => ({ id: id(), kind: 'number', value });
const text = (value: string): Expr => ({ id: id(), kind: 'text', value });
const log = (t: string): Statement => ({ id: id(), kind: 'log', text: text(t) });
/** An object with a script: these stacks. */
const scripted = (e: EntityData, handlers: Script['handlers']): EntityData => ({ ...e, components: { ...e.components, script: { version: 1, variables: [], handlers } satisfies Script } });
const onStart = (body: Statement[]) => ({ id: id(), event: { id: id(), kind: 'start' as const }, body });
const onMessage = (message: string, body: Statement[]) => ({ id: id(), event: { id: id(), kind: 'message' as const, message }, body });
const send = (w: GameWorld, message: string) => (w as unknown as { runner: { dispatch(e: unknown): void } }).runner.dispatch({ type: 'message', message, to: null, from: null });
const logs = (w: GameWorld) => w.drainLogs().map((l) => l.text);

describe('camera lens blocks', () => {
  it('fade a setting over the scene’s own, then back to the scene’s look', () => {
    const rules = scripted(newEntity('rules', {}), [
      onStart([{ id: id(), kind: 'setLens', prop: 'vignette', value: n(0.8), seconds: n(1) }]),
      onMessage('back', [{ id: id(), kind: 'lensReset', seconds: n(0.5) }]),
    ]);
    const w = GameWorld.create(scene({ lens: { vignette: 0.2, grain: 0.1 } }, floor(), spawn(), rules));
    run(w, 0.5);
    const mid = w.lensNow().vignette;
    expect(mid).toBeGreaterThan(0.35);
    expect(mid).toBeLessThan(0.65);
    expect(w.lensNow().grain).toBeCloseTo(0.1);
    run(w, 0.7);
    expect(w.lensNow().vignette).toBeCloseTo(0.8);
    send(w, 'back');
    run(w, 0.25);
    expect(w.lensNow().vignette).toBeGreaterThan(0.2);
    expect(w.lensNow().vignette).toBeLessThan(0.8);
    run(w, 0.5);
    expect(w.lensNow()).toEqual({ ...w.lensNow(), vignette: 0.2, grain: 0.1 });
    expect((w as unknown as { lensFades: Map<string, unknown> }).lensFades.size).toBe(0);
    w.dispose();
  });

  it('blur turns depth of field on; effects show even when the scene’s lens is switched off', () => {
    const rules = scripted(newEntity('rules', {}), [onStart([{ id: id(), kind: 'setLens', prop: 'blur', value: n(0.6), seconds: n(0) }])]);
    const w = GameWorld.create(scene({ lens: { enabled: false, vignette: 0.9 } }, floor(), spawn(), rules));
    run(w, 0.1);
    const l = w.lensNow();
    expect(l).toMatchObject({ enabled: true, dof: true, blur: 0.6, vignette: 0 });
    w.dispose();
  });

  it('a look fades in; values read back; numbers stay in range', () => {
    const rules = scripted(newEntity('rules', {}), [
      onStart([
        { id: id(), kind: 'lensLook', look: 'vhs', seconds: n(0) },
        { id: id(), kind: 'setLens', prop: 'distortion', value: n(-5), seconds: n(0) },
        { id: id(), kind: 'if', condition: { id: id(), kind: 'compare', op: '=', a: { id: id(), kind: 'lensValue', prop: 'scanlines' }, b: n(0.35) }, then: [log('vhs')], otherwise: null },
      ]),
    ]);
    const w = GameWorld.create(scene({}, floor(), spawn(), rules));
    run(w, 0.1);
    expect(w.lensNow()).toMatchObject({ scanlines: 0.35, aberration: 0.7, grainColor: true, distortion: -1 });
    expect(logs(w)).toContain('vhs');
    w.dispose();
  });

  it('an unknown look is a script error, not a crash', () => {
    const rules = scripted(newEntity('rules', {}), [onStart([{ id: id(), kind: 'lensLook', look: 'nope', seconds: n(0) }])]);
    const w = GameWorld.create(scene({}, floor(), spawn(), rules));
    run(w, 0.1);
    expect(w.lensNow().scanlines).toBe(0);
    w.dispose();
  });

  it('focus follows an object, and goes back to the middle', () => {
    const target = brush('target', [-16, 0, -416], [16, 32, -384]);
    const rules = scripted(newEntity('rules', {}), [
      onStart([{ id: id(), kind: 'lensFocus', at: { entity: target.id } }]),
      onMessage('middle', [{ id: id(), kind: 'lensFocus', at: null }]),
    ]);
    const w = GameWorld.create(scene({ lens: { dof: true } }, floor(), spawn(), target, rules));
    run(w, 0.1);
    const l = w.lensNow();
    expect(l.autoFocus).toBe(false);
    expect(l.focus).toBeGreaterThan(380);
    expect(l.focus).toBeLessThan(420);
    send(w, 'middle');
    run(w, 0.1);
    expect(w.lensNow().autoFocus).toBe(true);
    w.dispose();
  });

  it('a kept world keeps what blocks set', () => {
    const rules = scripted(newEntity('rules', {}), [onStart([{ id: id(), kind: 'setLens', prop: 'grain', value: n(0.4), seconds: n(10) }, { id: id(), kind: 'lensFocus', at: { aim: true } }])]);
    const sc = scene({}, floor(), spawn(), rules);
    const w = GameWorld.create(sc);
    run(w, 0.2);
    const saved = (w as unknown as { saveScene(p: boolean): { lens?: { set: Record<string, number>; focus?: unknown } } }).saveScene(true);
    w.dispose();
    expect(saved.lens?.set.grain).toBe(0.4);
    expect(saved.lens?.focus).toBe('aim');
    const w2 = GameWorld.create(scene({}, floor(), spawn()));
    run(w2, 0.1);
    (w2 as unknown as { loadScene(s: unknown, p: boolean): void }).loadScene(saved, true);
    expect(w2.lensNow().grain).toBeCloseTo(0.4);
    w2.dispose();
  });
});

describe('looking at things', () => {
  const watcher = (e: EntityData, mode: LookMode, reach = 2048) =>
    scripted(e, [
      { id: id(), event: { id: id(), kind: 'looks', mode, reach: n(reach) }, body: [log(`${e.name} looked`)] },
      { id: id(), event: { id: id(), kind: 'looksAway', mode, reach: n(reach) }, body: [log(`${e.name} away`)] },
    ]);
  const turn = (w: GameWorld, deg: number) => {
    w.player!.input.yaw = (deg * Math.PI) / 180;
    w.player!.input.pitch = 0;
  };

  it('with the crosshair: starts when it is on the object, stops when it leaves (once each)', () => {
    // A tall statue straight ahead (the player looks along −Z at the start).
    const statue = watcher(brush('statue', [-32, 0, -320], [32, 128, -288]), 'aim');
    const w = GameWorld.create(scene({}, floor(), spawn(), statue));
    run(w, 0.3);
    expect(logs(w)).toEqual(['statue looked']);
    run(w, 0.3);
    expect(logs(w)).toEqual([]);
    turn(w, 90);
    run(w, 0.2);
    expect(logs(w)).toEqual(['statue away']);
    turn(w, 0);
    run(w, 0.2);
    expect(logs(w)).toEqual(['statue looked']);
    w.dispose();
  });

  it('with the crosshair: too far is not looking', () => {
    const statue = watcher(brush('statue', [-32, 0, -320], [32, 128, -288]), 'aim', 200);
    const w = GameWorld.create(scene({}, floor(), spawn(), statue));
    run(w, 0.3);
    expect(logs(w)).toEqual([]);
    w.dispose();
  });

  it('anywhere in view: off to one side still counts, behind a wall doesn’t', () => {
    const statue = watcher(brush('statue', [-32, 0, -320], [32, 128, -288]), 'view');
    const w = GameWorld.create(scene({}, floor(), spawn(), statue));
    run(w, 0.1);
    turn(w, 20);
    run(w, 0.2);
    expect(logs(w)).toContain('statue looked');
    turn(w, 60);
    run(w, 0.2);
    expect(logs(w)).toContain('statue away');
    w.dispose();
    const wall = brush('wall', [-256, 0, -160], [256, 256, -144]);
    const hidden = watcher(brush('statue', [-32, 0, -320], [32, 128, -288]), 'view');
    const w2 = GameWorld.create(scene({}, floor(), spawn(), wall, hidden));
    run(w2, 0.3);
    expect(logs(w2)).toEqual([]);
    expect(w2.lookingAtForTest(hidden.id, 'view', 2048)).toBe(false);
    w2.dispose();
  });

  it('the value block, and the checker', () => {
    const statue = brush('statue', [-32, 0, -320], [32, 128, -288]);
    const rules = scripted(newEntity('rules', {}), [
      { id: id(), event: { id: id(), kind: 'every', seconds: n(0.1) }, body: [{ id: id(), kind: 'if', condition: { id: id(), kind: 'looking', target: { entity: statue.id }, mode: 'aim', reach: n(1000) }, then: [log('yes')], otherwise: null }] },
    ]);
    const w = GameWorld.create(scene({}, floor(), spawn(), statue, rules));
    run(w, 0.5);
    expect(logs(w)).toContain('yes');
    w.dispose();
    const bad: Script = { version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'looks', mode: 'aim', reach: { id: 'r', kind: 'number', value: 0 } }, body: [] }] };
    expect(compileScript('o', bad, { objects: new Map() }).problems.map((p) => p.block)).toEqual(['r']);
  });
});
