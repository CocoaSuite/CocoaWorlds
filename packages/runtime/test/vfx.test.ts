// VFX: effects from the VFX workspace play the same way every time; bursts, streams, shapes and loops.
import { beforeAll, describe, expect, it } from 'vitest';
import { VFX_PRESETS, cloneEffect, isEffect, newEffect, newEmitter, newEntity, newScene, newShapeAnim, sampleCurve, sampleGradient, sampleKeys } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { compileScript, type Script, type Statement } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics, type GameEvent } from '../src';
import { VfxPlayer } from '../src/vfx';

const preset = (key: string) => cloneEffect(VFX_PRESETS.find((p) => p.key === key)!.effect, key, key);

describe('vfx data', () => {
  it('samples curves, gradients and keys', () => {
    expect(sampleCurve([[0, 0], [1, 2]], 0.5)).toBeCloseTo(1);
    expect(sampleCurve([[0.2, 3]], 0)).toBe(3);
    expect(sampleCurve([], 0.5)).toBe(1);
    const c = sampleGradient([{ t: 0, colour: '#000000' }, { t: 1, colour: '#ffffff' }], 0.5);
    expect(c[0]).toBeCloseTo(0.5);
    const s = newShapeAnim({ duration: 1, keys: [{ t: 0, size: 0, colour: '#ffffff', opacity: 1, rotation: 0, rise: 0, ease: 'linear' }, { t: 1, size: 10, colour: '#ffffff', opacity: 0, rotation: 90, rise: 4, ease: 'linear' }] });
    expect(sampleKeys(s, 0.5)?.size).toBeCloseTo(5);
    expect(sampleKeys(s, 2)).toBeNull();
  });

  it('presets are valid effects', () => {
    for (const p of VFX_PRESETS) expect(isEffect(cloneEffect(p.effect, p.key, p.key))).toBe(true);
    expect(isEffect({ id: 'x' })).toBe(false);
  });
});

describe('vfx player', () => {
  it('a burst spawns its count once and everything finishes', () => {
    const fx = newEffect('t', { duration: 1, layers: [newEmitter({ spawn: 'burst', count: 12, life: [0.4, 0.5] })] });
    const p = new VfxPlayer(fx);
    p.step(0);
    expect(p.count).toBe(12);
    for (let i = 0; i < 30; i++) p.step(1 / 30);
    expect(p.count).toBe(12 - 12);
    for (let i = 0; i < 30; i++) p.step(1 / 30);
    expect(p.done).toBe(true);
  });

  it('a stream spawns about rate × duration', () => {
    const fx = newEffect('t', { duration: 2, layers: [newEmitter({ spawn: 'rate', rate: 50, start: 0, duration: 1, life: [5, 5] })] });
    const p = new VfxPlayer(fx);
    for (let i = 0; i < 120; i++) p.step(1 / 60);
    expect(p.count).toBeGreaterThanOrEqual(49);
    expect(p.count).toBeLessThanOrEqual(51);
  });

  it('seeking is repeatable (scrubbing shows the same frame)', () => {
    const p = new VfxPlayer(preset('dust'), 7);
    p.seek(0.4);
    const a = Array.from(p.layers[0]!.pos.slice(0, p.layers[0]!.n * 3));
    p.seek(0.9);
    p.seek(0.4);
    expect(Array.from(p.layers[0]!.pos.slice(0, p.layers[0]!.n * 3))).toEqual(a);
  });

  it('gravity pulls particles down and the origin moves them', () => {
    const fx = newEffect('t', { layers: [newEmitter({ spawn: 'burst', count: 1, speed: [0, 0], gravity: 100, drag: 0, life: [2, 2] })] });
    const p = new VfxPlayer(fx);
    p.setOrigin([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);
    p.step(0);
    expect(Array.from(p.layers[0]!.pos.slice(0, 3))).toEqual([10, 20, 30]);
    for (let i = 0; i < 10; i++) p.step(0.05);
    expect(p.layers[0]!.pos[1]!).toBeLessThan(20);
  });

  it('shape layers follow their keys and loops restart bursts', () => {
    const p = new VfxPlayer(preset('impact'));
    p.seek(0.2);
    const ring = p.layers[0]!;
    expect(ring.n).toBe(1);
    expect(ring.srf[0]!).toBeGreaterThan(8);
    p.seek(0.45);
    expect(ring.n).toBe(0);

    const fx = newEffect('t', { duration: 0.5, loop: true, layers: [newEmitter({ spawn: 'burst', count: 3, life: [0.1, 0.1] })] });
    const q = new VfxPlayer(fx);
    q.step(0);
    for (let i = 0; i < 11; i++) q.step(0.05);
    expect(q.pass).toBe(1);
    expect(q.count).toBe(3);
    expect(q.done).toBe(false);
  });

  it('turned off: nothing new, and it ends', () => {
    const p = new VfxPlayer(preset('smoke'));
    for (let i = 0; i < 30; i++) p.step(1 / 30);
    p.on = false;
    for (let i = 0; i < 200; i++) p.step(1 / 30);
    expect(p.done).toBe(true);
  });
});

describe('effects in play', () => {
  beforeAll(async () => {
    await initPhysics();
  });
  const onStart = (body: Statement[]): Script => ({ version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'start' }, body }] });
  const scene = (body: Statement[]) => {
    const s = newScene('fx');
    const floor = newEntity('floor', { brush: { role: 'solid', faces: toData(box([-512, -16, -512], [512, 0, 512])).faces } as never });
    const torch = newEntity('torch', { vfx: { effect: 'fx_1', on: true, loop: true, offset: [0, 0, 0] }, script: onStart(body) as never }, { position: [10, 20, 30], rotation: [0, 0, 0] });
    s.entities = [floor, newEntity('start', { playerSpawn: {} }), torch];
    return { s, torch: torch.id };
  };

  it('the Play effect block announces the effect where the object is', () => {
    const { s } = scene([{ id: 'p', kind: 'playEffect', effect: 'fx_1', at: { self: true }, follow: false }]);
    const w = GameWorld.create(s);
    const seen: GameEvent[] = [];
    w.bus.on('vfx', (e) => void seen.push(e));
    for (let i = 0; i < 5; i++) w.step(1 / 60);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'vfx', effect: 'fx_1', at: [10, 20, 30] });
  });

  it('Turn off stops an Effect component', () => {
    const { s, torch } = scene([{ id: 'o', kind: 'turnOff', target: { self: true } }]);
    const w = GameWorld.create(s);
    for (let i = 0; i < 5; i++) w.step(1 / 60);
    expect(w.switchedOn(w.bodyOf(torch)!)).toBe(false);
  });

  it('a Play effect block with no effect picked is a problem', () => {
    const info = { objects: new Map([['x', { name: 'x', isZone: false }]]) };
    const r = compileScript('x', onStart([{ id: 'p', kind: 'playEffect', effect: '', at: { self: true }, follow: false }]), info);
    expect(r.problems.map((p) => p.message)).toContain('Pick an effect (make one in the VFX workspace).');
    expect(compileScript('x', onStart([{ id: 'p', kind: 'playEffect', effect: 'fx', at: { self: true }, follow: true }]), info).problems).toEqual([]);
  });
});
