// A1: creatures — enemies that hunt and attack, friends that follow, neutral ones, scripted walks, deaths.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, newWeapon, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import type { Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const floor = () => brush('floor', [-4096, -16, -4096], [4096, 0, 4096]);
const spawn = (at: Vec3 = [0, 0, 0], yawDeg = 0) => newEntity('start', { playerSpawn: {} }, { position: at, rotation: [0, yawDeg, 0] });
/** A creature at `at`, facing +Z (towards the player at the origin when it stands at negative Z). */
const npc = (name: string, at: Vec3, data: Record<string, unknown> = {}) => newEntity(name, { npc: { side: 'hostile', ...data } }, { position: at, rotation: [0, 180, 0] });
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  s.settings.ui = { screens: [], items: [{ name: 'Pistol', icon: '', weapon: { ...newWeapon('pistol'), ammo: '', spread: 0 } }] } as never;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
const state = (w: GameWorld, id: string) => w.npcStates().find((n) => n.id === id)!;

describe('creatures', () => {
  it('an enemy that sees the player comes for them and bites', () => {
    const z = npc('zombie', [0, 0, -400], { speed: 150, attack: 'melee', damage: 10, rate: 1 });
    const w = GameWorld.create(scene(floor(), spawn(), z));
    run(w, 1);
    expect(state(w, z.id).state).toBe('chase');
    expect(state(w, z.id).feet[2]).toBeGreaterThan(-300);
    run(w, 3);
    expect(state(w, z.id).state).toBe('attack');
    expect(w.playerStatus()!.health).toBeLessThan(100);
    w.dispose();
  });

  it('an enemy facing away, or behind a wall, does not notice the player', () => {
    const away = newEntity('away', { npc: { side: 'hostile' } }, { position: [0, 0, -400], rotation: [0, 0, 0] });
    const walled = npc('walled', [300, 0, -400]);
    const wall = brush('wall', [200, 0, -300], [400, 200, -280]);
    const w = GameWorld.create(scene(floor(), spawn(), away, walled, wall));
    run(w, 2);
    expect([state(w, away.id).state, state(w, walled.id).state]).toEqual(['idle', 'idle']);
    w.dispose();
  });

  it('a shooter stays back and shoots; shots that hit hurt the player', () => {
    const soldier = npc('soldier', [0, 0, -500], { attack: 'shoot', damage: 5, rate: 2, spread: 0 });
    const w = GameWorld.create(scene(floor(), spawn(), soldier));
    let shots = 0;
    w.bus.on('shot', (e) => void (e.by === soldier.id && shots++));
    run(w, 2);
    expect(shots).toBeGreaterThanOrEqual(3);
    expect(state(w, soldier.id).feet[2]).toBeCloseTo(-500, -1);
    expect(w.playerStatus()!.health).toBeLessThanOrEqual(100 - 5 * 3);
    w.dispose();
  });

  it('the player can shoot one dead: “When this is hit” and “When this creature dies” run', () => {
    const z = npc('zombie', [0, 0, -400], { health: 16, speed: 0, attack: 'none' });
    z.components.script = {
      version: 1,
      variables: [],
      handlers: [
        { id: 'h1', event: { id: 'e1', kind: 'hit' }, body: [{ id: 's1', kind: 'addScore', amount: { id: 'n1', kind: 'number', value: 1 } }] },
        { id: 'h2', event: { id: 'e2', kind: 'dies' }, body: [{ id: 's2', kind: 'addScore', amount: { id: 'n2', kind: 'number', value: 10 } }] },
      ],
    } satisfies Script as never;
    const w = GameWorld.create(scene(floor(), spawn(), z));
    expect(w.scriptProblems).toEqual([]);
    w.giveItem('Pistol', 1);
    run(w, 0.2);
    for (let i = 0; i < 2; i++) {
      w.setPlayerInput({ fire: true, pitch: -0.05 });
      run(w, 0.05);
      w.setPlayerInput({ fire: false });
      run(w, 0.4);
    }
    expect(state(w, z.id).alive).toBe(false);
    expect(w.playerStatus()!.score).toBe(12);
    // Dead: shots pass through where it stood.
    w.dispose();
  });

  it('a friend follows the player once used, and stays when used again', () => {
    const barney = npc('barney', [0, 0, -100], { side: 'friendly' });
    const w = GameWorld.create(scene(floor(), spawn(), barney));
    run(w, 0.3);
    expect(w.usePrompt()).toBe('');
    w.use();
    run(w, 0.1);
    expect(state(w, barney.id).state).toBe('follow');
    // The player walks off (+Z): the friend keeps up.
    w.setPlayerInput({ forward: -1 });
    run(w, 3);
    w.setPlayerInput({ forward: 0 });
    run(w, 2);
    const d = Math.hypot(state(w, barney.id).feet[0] - w.player!.feetPosition.x, state(w, barney.id).feet[2] - w.player!.feetPosition.z);
    expect(d).toBeLessThan(170);
    expect(w.player!.feetPosition.z).toBeGreaterThan(300);
    w.dispose();
  });

  it('a neutral creature fights back once hurt', () => {
    const n = npc('guard', [0, 0, -300], { side: 'neutral', attack: 'melee', health: 100 });
    const w = GameWorld.create(scene(floor(), spawn(), n));
    run(w, 1);
    expect(state(w, n.id).state).toBe('idle');
    w.giveItem('Pistol', 1);
    w.setPlayerInput({ fire: true, pitch: -0.05 });
    run(w, 0.1);
    w.setPlayerInput({ fire: false });
    run(w, 1);
    expect(['chase', 'attack']).toContain(state(w, n.id).state);
    w.dispose();
  });

  it('scripts walk a creature somewhere and wait for it (a scripted scene)', () => {
    const guide = npc('guide', [0, 0, -100], { side: 'friendly' });
    const mark = newEntity('mark', {}, { position: [300, 0, -100] });
    guide.components.script = {
      version: 1,
      variables: [],
      handlers: [{ id: 'h', event: { id: 'e', kind: 'start' }, body: [{ id: 'w', kind: 'walkTo', target: { self: true }, to: { entity: mark.id } }, { id: 's', kind: 'addScore', amount: { id: 'n', kind: 'number', value: 1 } }] }],
    } satisfies Script as never;
    const w = GameWorld.create(scene(floor(), spawn(), guide, mark));
    expect(w.scriptProblems).toEqual([]);
    run(w, 1);
    expect(w.playerStatus()!.score).toBe(0);
    run(w, 2);
    expect(state(w, guide.id).feet[0]).toBeCloseTo(300, -1);
    expect(w.playerStatus()!.score).toBe(1);
    w.dispose();
  });

  it('a scripted scene: the player is held still and the view looks through a camera, then both come back', () => {
    const cam = newEntity('camera', {}, { position: [500, 200, 500], rotation: [-20, 45, 0] });
    const director = newEntity('director', {
      script: {
        version: 1,
        variables: [],
        handlers: [
          {
            id: 'h',
            event: { id: 'e', kind: 'start' },
            body: [
              { id: 'a', kind: 'freezePlayer' },
              { id: 'b', kind: 'viewFrom', target: { entity: cam.id }, seconds: { id: 'n', kind: 'number', value: 1 } },
              { id: 'c', kind: 'unfreezePlayer' },
            ],
          },
        ],
      } satisfies Script as never,
    });
    const w = GameWorld.create(scene(floor(), spawn(), cam, director));
    expect(w.scriptProblems).toEqual([]);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.5);
    expect(w.playerFrozen).toBe(true);
    expect(Math.abs(w.player!.feetPosition.z)).toBeLessThan(1);
    const v = w.playerView()!;
    expect(v.eye).toEqual([500, 200, 500]);
    expect(v.pitch).toBeCloseTo((-20 * Math.PI) / 180, 2);
    run(w, 1);
    expect(w.playerFrozen).toBe(false);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.5);
    expect(w.player!.feetPosition.z).toBeLessThan(-30);
    expect(w.playerView()!.eye[0]).toBeCloseTo(w.player!.feetPosition.x, 0);
    w.dispose();
  });

  it('the chicken: wanders near home pecking the ground, runs off when hurt, stumbles now and then', () => {
    const chicken = npc('chicken', [0, 0, -300], {
      side: 'friendly', attack: 'none', health: 20, speed: 110, wander: true, flee: 'hurt', clumsy: true, height: 56, radius: 14,
      anims: 'idle, walk, peck, die, run, peck, flap',
    });
    const w = GameWorld.create(scene(floor(), spawn(), chicken));
    const anims: string[] = [];
    w.bus.on('anim', (e) => void anims.push(e.name));
    // Wandering: it moves about, pecks, and never strays far from home.
    let far = 0, moved = 0;
    let last = state(w, chicken.id).feet;
    for (let i = 0; i < 20 * 60; i++) {
      w.step(1 / 60);
      const f = state(w, chicken.id).feet;
      moved += Math.hypot(f[0] - last[0], f[2] - last[2]);
      last = f;
      far = Math.max(far, Math.hypot(f[0], f[2] + 300));
    }
    expect(moved).toBeGreaterThan(150);
    expect(far).toBeLessThan(260);
    expect(anims).toContain('peck');
    expect(anims).toContain('walk');
    // Clumsy: it stumbled (flapped) without being hurt.
    expect(anims).toContain('flap');
    // Hurt: away from the player, running.
    const before = Math.hypot(...([0, 2].map((k) => state(w, chicken.id).feet[k]! - [w.player!.feetPosition.x, 0, w.player!.feetPosition.z][k]!) as [number, number]));
    (w as unknown as { weaponDamage(t: string, a: number, b: string, c: string): void }).weaponDamage(chicken.id, 5, 'player', 'a kick');
    run(w, 0.5);
    expect(state(w, chicken.id).state).toBe('flee');
    expect(anims.slice(-3)).toContain('run');
    run(w, 1.5);
    const after = Math.hypot(...([0, 2].map((k) => state(w, chicken.id).feet[k]! - [w.player!.feetPosition.x, 0, w.player!.feetPosition.z][k]!) as [number, number]));
    expect(after).toBeGreaterThan(before + 100);
    w.dispose();
  });

  it('its size comes from the component', () => {
    const small = npc('small', [0, 0, -300], { side: 'neutral', height: 40, radius: 10 });
    const w = GameWorld.create(scene(floor(), spawn(), small));
    const n = (w as unknown as { npcs: Map<string, { height: number; radius: number; eye(): { y: number } }> }).npcs.get(small.id)!;
    expect([n.height, n.radius]).toEqual([40, 10]);
    // (Eyes 8 below the top; it stands 1 above where it was placed until it settles.)
    expect(n.eye().y).toBeCloseTo(33, 0);
    w.dispose();
  });

  it('a script can make a friend an enemy (a nest missing its egg)', () => {
    const hen = npc('hen', [0, 0, -300], { side: 'friendly', attack: 'melee', damage: 5 });
    hen.components.script = {
      version: 1,
      variables: [],
      handlers: [{ id: 'h', event: { id: 'e', kind: 'message', message: 'egg taken' }, body: [{ id: 's', kind: 'setSide', target: { self: true }, side: 'hostile' }] }],
    } satisfies Script as never;
    const w = GameWorld.create(scene(floor(), spawn(), hen));
    expect(w.scriptProblems).toEqual([]);
    run(w, 1);
    expect(state(w, hen.id).state).toBe('idle');
    (w as unknown as { runner: { dispatch(e: unknown): void } }).runner.dispatch({ type: 'message', message: 'egg taken', to: null, from: null });
    run(w, 4);
    expect(['chase', 'attack']).toContain(state(w, hen.id).state);
    expect(w.playerStatus()!.health).toBeLessThan(100);
    w.dispose();
  });
});

describe('animation names', () => {
  it('roles map to the names listed; missing ones fall back', async () => {
    const { npcAnimation } = await import('../src');
    const list = 'idle, walk, peck, die';
    expect(npcAnimation(list, 'attack')).toBe('peck');
    expect(npcAnimation(list, 'run')).toBe('walk');
    expect(npcAnimation(list, 'busy')).toBe('idle');
    expect(npcAnimation(list, 'hurt')).toBe('');
    expect(npcAnimation('idle, walk, peck, die, run, peck, flap', 'hurt')).toBe('flap');
  });
});
