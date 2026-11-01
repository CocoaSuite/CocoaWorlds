import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { newEvent, newStatement, num, recipe, type Handler, type Script, type Statement } from '@cocoaworlds/scripting';
import { GameWorld, fallDamage, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const spawn = (at: Vec3 = [0, 0, 0]) => newEntity('start', { playerSpawn: {} }, { position: at });
const floor = () => brush('floor', [-1024, -16, -1024], [1024, 0, 1024]);
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
const script = (handlers: Handler[]): Script => ({ version: 1, variables: [], handlers });
const on = (kind: 'start' | 'die', body: Statement[]): Handler => ({ id: kind, event: newEvent(kind), body });
const hurt = (n: number): Statement => ({ ...newStatement('hurt'), amount: num(n) }) as Statement;
const log = (text: string): Statement => ({ ...newStatement('log'), text: { id: 'x', kind: 'text', value: text } }) as Statement;

function apply(id: string, target: EntityData, min: Vec3, max: Vec3): EntityData[] {
  const r = recipe(id)!;
  const t = { id: target.id, name: target.name, min, max };
  const z = r.zone?.(t);
  const zone = z ? brush(z.name, z.min, z.max, { trigger: { detects: z.detects, once: z.once } }) : null;
  const out = r.build(t, zone?.id ?? null);
  target.components.script = { version: 1, variables: out.variables, handlers: out.handlers } as never;
  return zone ? [target, zone] : [target];
}

describe('health and score', () => {
  it('falls hurt only above the safe speed, and a fall at the fatal speed takes everything', () => {
    expect(fallDamage(300)).toBe(0);
    expect(fallDamage(526.5)).toBe(0);
    expect(fallDamage(724.5)).toBe(50);
    expect(fallDamage(922.5)).toBe(100);
  });

  it('“Hurt the player” takes health; at 0 the player dies, “When the player dies” runs, and they start again', () => {
    const logic = newEntity('logic', { script: script([on('start', [hurt(30)]), on('die', [log('Game over')])]) as never });
    const w = GameWorld.create(scene(floor(), spawn(), logic));
    run(w, 0.1);
    expect(w.playerStatus()!.health).toBe(70);
    expect(w.playerStatus()!.sinceHurt).toBeLessThan(0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.5);
    expect(w.player!.feetPosition.z).toBeLessThan(-30);
    w.hurt(500, 'a test');
    run(w, 0.1);
    const s = w.playerStatus()!;
    expect(s.health).toBe(100);
    expect(s.deaths).toBe(1);
    expect(w.drainLogs().map((l) => l.text)).toEqual(['Game over']);
    // Back at the start (and still walking from there).
    expect(w.player!.feetPosition.z).toBeGreaterThan(-30);
    w.dispose();
  });

  it('healing never goes above full health; the score shows only once something uses it', () => {
    const w = GameWorld.create(scene(floor(), spawn()));
    run(w, 0.1);
    w.hurt(40);
    w.heal(25);
    expect(w.playerStatus()!.health).toBe(85);
    w.heal(1000);
    expect(w.playerStatus()!.health).toBe(100);
    expect(w.playerStatus()!.showScore).toBe(false);
    w.addScore(5);
    expect(w.playerStatus()).toMatchObject({ score: 5, showScore: true });
    w.dispose();
  });

  it('a long fall hurts; a jump does not', () => {
    const w = GameWorld.create(scene(floor(), spawn([0, 400, 0])));
    run(w, 2);
    const h = w.playerStatus()!.health;
    // About 800 u/s on landing → about 69 damage.
    expect(h).toBeGreaterThan(20);
    expect(h).toBeLessThan(45);
    w.setPlayerInput({ jump: true });
    run(w, 0.1);
    w.setPlayerInput({ jump: false });
    run(w, 1.5);
    expect(w.playerStatus()!.health).toBe(h);
    w.dispose();
  });

  it('falling out of the world counts as dying', () => {
    const w = GameWorld.create(scene(brush('ledge', [-64, -16, -64], [64, 0, 64]), spawn()));
    w.setPlayerInput({ forward: 1 });
    run(w, 1);
    w.setPlayerInput({ forward: 0 });
    run(w, 6);
    expect(w.playerStatus()!.deaths).toBe(1);
    w.dispose();
  });

  it('coin: walking into it adds 1 to the score and hides it', () => {
    const coin = brush('coin', [-8, 16, -96], [8, 48, -88]);
    const w = GameWorld.create(scene(floor(), spawn(), ...apply('coin', coin, [-8, 16, -96], [8, 48, -88])));
    run(w, 0.2);
    expect(w.playerStatus()).toMatchObject({ score: 0, showScore: true });
    w.setPlayerInput({ forward: 1 });
    run(w, 1.2);
    expect(w.playerStatus()!.score).toBe(1);
    expect(w.isVisible(coin.id)).toBe(false);
    w.dispose();
  });

  it('health pack: left alone at full health, taken when hurt', () => {
    const pack = brush('pack', [-8, 0, -96], [8, 16, -80]);
    const w = GameWorld.create(scene(floor(), spawn(), ...apply('health-pickup', pack, [-8, 0, -96], [8, 16, -80])));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 1.2);
    w.setPlayerInput({ forward: -1 });
    run(w, 0.6);
    w.setPlayerInput({ forward: 0 });
    run(w, 0.5);
    expect(w.isVisible(pack.id)).toBe(true);
    w.hurt(50);
    w.setPlayerInput({ forward: 1 });
    run(w, 1.2);
    expect(w.playerStatus()!.health).toBe(75);
    expect(w.isVisible(pack.id)).toBe(false);
    w.dispose();
  });

  it('hurt zone: 10 health every half second while inside, nothing after leaving', () => {
    const fire = brush('fire', [-64, 0, -64], [64, 4, 64]);
    const w = GameWorld.create(scene(floor(), spawn(), ...apply('hurt-zone', fire, [-64, 0, -64], [64, 4, 64])));
    run(w, 1.1);
    // Hurt on entering, at 0.5 s and at 1 s.
    expect(w.playerStatus()!.health).toBe(70);
    w.setPlayerInput({ forward: 1 });
    run(w, 1.5);
    w.setPlayerInput({ forward: 0 });
    const after = w.playerStatus()!.health;
    run(w, 2);
    expect(w.playerStatus()!.health).toBe(after);
    w.dispose();
  });

  it('deadly: touching it kills the player, who starts again', () => {
    const lava = brush('lava', [-128, 0, -256], [128, 4, -160]);
    const w = GameWorld.create(scene(floor(), spawn(), ...apply('deadly', lava, [-128, 0, -256], [128, 4, -160])));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 1.4);
    w.setPlayerInput({ forward: 0 });
    run(w, 0.1);
    expect(w.playerStatus()).toMatchObject({ deaths: 1, health: 100 });
    expect(w.player!.feetPosition.z).toBeGreaterThan(-160);
    w.dispose();
  });
});
