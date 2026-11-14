// Mining: the block mine (made from a seed), colliders, monsters' paths, the pickaxe, selling, buying and saving.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene } from '@cocoaworlds/core';
import { AIR, EDGE, findPath, GameWorld, initPhysics, mineConfig, MineBlocks, MineSystem, Mob, oreOf, zoneOf, type MineHost } from '../src';

beforeAll(async () => {
  await initPhysics();
});

describe('the mine', () => {
  const blocks = () => new MineBlocks(mineConfig({ seed: 7, surface: false }), 7);

  it('built-in settings: 12 rock zones (one for each pickaxe), 25 ores, 4 skill branches', () => {
    const c = mineConfig();
    expect(c.zones).toHaveLength(12);
    expect(c.zones.map((z) => z.tier)).toEqual(c.pickaxes.map((_, i) => i));
    expect(c.ores).toHaveLength(25);
    expect(c.pickaxes).toHaveLength(12);
    expect(new Set(c.skills.map((s) => s.branch))).toEqual(new Set(['mining', 'backpack', 'combat', 'vision']));
    for (const s of c.skills) for (const n of s.needs) expect(c.skills.some((d) => d.id === n)).toBe(true);
    expect(new Set(c.skills.map((s) => s.at.join())).size).toBe(c.skills.length);
    // (A game's entries replace by id.)
    expect(mineConfig({ ores: [{ id: 'coal', value: 9 }] }).ores[0]!.value).toBe(9);
  });

  it('the base is a hollow room with rock under it; zones change with distance', () => {
    const b = blocks();
    expect(b.get(0, 0, 0)).toBe(AIR);
    expect(b.get(7, 5, -7)).toBe(AIR);
    expect(b.solid(0, -1, 0)).toBe(true);
    expect(b.solid(8, 0, 0)).toBe(true);
    expect(b.zoneAt(0)).toBe(0);
    expect(b.zoneAt(45)).toBe(2);
    expect(b.zoneAt(10000)).toBe(11);
  });

  it('on the surface: a flat patch of rock, its sides the mine edge down to the crust, rock all round below', () => {
    const b = new MineBlocks(mineConfig({ seed: 7 }), 7);
    expect(b.get(0, 0, 0)).toBe(AIR);
    expect(b.get(20, 5, 0)).toBe(AIR);
    expect(b.solid(8, -1, -8)).toBe(true);
    expect(b.get(8, -1, -8)).not.toBe(EDGE);
    expect(b.get(9, -1, 0)).toBe(EDGE);
    expect(b.get(0, -5, -30)).toBe(EDGE);
    expect(b.get(0, -12, -30)).not.toBe(EDGE);
    expect(b.inBase(3, 0, 3)).toBe(true);
    expect(b.inBase(3, -1, 3)).toBe(false);
  });

  it('caves and ores in sensible amounts', () => {
    const b = blocks();
    let air = 0, ore = 0, n = 0;
    for (let x = 30; x < 70; x++)
      for (let y = -20; y < 20; y++)
        for (let z = 30; z < 60; z++) {
          const id = b.gen(x, y, z);
          n++;
          if (id === AIR) air++;
          else if (oreOf(id) >= 0) ore++;
        }
    expect(air / n).toBeGreaterThan(0.03);
    expect(air / n).toBeLessThan(0.3);
    expect(ore / n).toBeGreaterThan(0.03);
    expect(ore / n).toBeLessThan(0.25);
  });

  it('a chunk collides as boxes that cover exactly its rock', () => {
    const b = blocks();
    const c = b.chunk(2, 0, 1);
    let solid = 0;
    for (const v of c.data) if (v !== AIR) solid++;
    const boxes = b.boxes(c);
    expect(boxes.reduce((s, [x0, y0, z0, x1, y1, z1]) => s + (x1! - x0!) * (y1! - y0!) * (z1! - z0!), 0)).toBe(solid);
    expect(boxes.length).toBeLessThan(solid / 3);
  });

  it('rays find the first rock; dug blocks stay dug', () => {
    const b = blocks();
    const hit = b.raycast(0.5, 1.5, 0.5, 1, 0, 0, 20)!;
    expect(hit).toMatchObject({ x: 8, y: 1, z: 0, n: [-1, 0, 0] });
    b.set(8, 1, 0, AIR);
    expect(b.raycast(0.5, 1.5, 0.5, 1, 0, 0, 20)!.x).toBeGreaterThan(8);
    const saved = b.save();
    const again = blocks();
    again.load(saved);
    expect(again.get(8, 1, 0)).toBe(AIR);
  });

  it('monsters find a way over steps', () => {
    const solid = (x: number, y: number) => y < 0 || (x >= 3 && y < 1);
    const world = { solid: (x: number, y: number) => solid(x, y), player: () => null, hurt: () => {}, sees: () => true, shoot: () => {}, gravity: 20, random: () => 0.5 };
    const path = findPath(world, [0, 0, 0], [6, 1, 0], 2)!;
    expect(path.at(-1)).toEqual([6, 1, 0]);
    expect(path.some(([x, y]) => x === 3 && y === 1)).toBe(true);
  });
});

describe('the pickaxe, the backpack and buying', () => {
  function host(at: [number, number, number] = [0, 0, 0], dir: [number, number, number] = [1, 0, 0]) {
    let t = 0, now = 1_000_000;
    const said: string[] = [];
    const h: MineHost & { feet: [number, number, number]; dir: [number, number, number]; said: string[]; advance(s: number): void; hurtBy: number } = {
      feet: at,
      dir,
      said,
      hurtBy: 0,
      time: () => t,
      now: () => now,
      player: () => ({ feet: h.feet, eye: [h.feet[0], h.feet[1] + 64, h.feet[2]], dir: h.dir }),
      hurt: (n) => void (h.hurtBy += n),
      heal: () => {},
      say: (s) => void said.push(s),
      sound: () => {},
      home: () => void (h.feet = [0, 0, 0]),
      random: () => 0.99,
      advance: (s) => {
        t += s;
        now += s * 1000;
      },
    };
    return h;
  }
  const make = (h: MineHost, over: unknown = {}) => new MineSystem({ seed: 3, maxMobs: 0, block: 40, surface: false, ...(over as object) }, h);

  it('swings break blocks; ores go in the backpack and sell at the base', () => {
    const h = host([6 * 40, 0, 0]);
    const m = make(h);
    // (A coal block in front of the player, at eye height.)
    m.blocks.set(8, 1, 0, 1 + 0 * 64 + 1);
    for (let i = 0; i < 40 && m.blocks.get(8, 1, 0) !== AIR; i++) {
      h.advance(1 / 60);
      m.tick(1 / 60, true);
      h.advance(0.3);
    }
    expect(m.blocks.get(8, 1, 0)).toBe(AIR);
    expect(m.carried).toBe(1);
    expect(zoneOf(1 + 1)).toBe(0);
    h.feet = [12 * 40, 0, 0];
    m.tick(1 / 60, false);
    h.feet = [0, 0, 0];
    m.tick(1 / 60, false);
    expect(m.carried).toBe(0);
    expect(m.money).toBeGreaterThan(0);
    expect(h.said.some((s) => s.startsWith('Sold for'))).toBe(true);
  });

  it('with a sell zone, ores sell only there', () => {
    const h = host([0, 0, 0]);
    const m = make(h);
    m.sellAt = [20 * 40, 0, 0];
    m.bag.set(0, { n: 3, value: 30 });
    m.tick(1 / 60, false);
    expect(m.carried).toBe(3);
    h.feet = [19 * 40, 0, 0];
    m.tick(1 / 60, false);
    expect(m.carried).toBe(0);
    expect(m.money).toBe(30);
    expect(m.hud().atSell).toBe(true);
  });

  it('pickaxes, endless levels and skills cost money; skills need the ones before', () => {
    const m = make(host());
    expect(m.buyPickaxe()).toBe(false);
    m.money = 1e12;
    for (let i = 0; i < 11; i++) expect(m.buyPickaxe()).toBe(true);
    expect(m.tier).toBe(11);
    const p = m.power();
    expect(m.buyPickaxe()).toBe(true);
    expect(m.level).toBe(1);
    expect(m.power()).toBeGreaterThan(p);
    expect(m.buySkill('heavy')).toBe(false);
    expect(m.buySkill('swing')).toBe(true);
    expect(m.buySkill('heavy')).toBe(true);
    expect(m.stat('mineDamage')).toBeCloseTo(0.1);
    for (let i = 0; i < 20; i++) m.buySkill('bag');
    expect(m.skills.get('bag')).toBe(10);
    expect(m.capacity).toBe(130);
    // (Endless skills keep going, dearer each time.)
    m.buySkill('haggle');
    const c0 = m.skillCost('merchant');
    for (let i = 0; i < 30; i++) expect(m.buySkill('merchant')).toBe(true);
    expect(m.skillCost('merchant')).toBeGreaterThan(c0);
  });

  it('monsters come for the player over a step and hit; the pickaxe kills them for money', () => {
    const h = host([30 * 40, 0, 0]);
    const m = make(h);
    for (let x = 18; x < 34; x++) for (let y = 0; y < 3; y++) m.blocks.set(x, y, 0, AIR);
    m.blocks.set(26, 0, 0, 1 + 1);
    const zombie = m.config.mobs.find((d) => d.id === 'zombie')!;
    m.mobs.push(new Mob(zombie, [20.5, 0, 0.5], 40, 8, 10, 3));
    for (let i = 0; i < 60 * 8 && !h.hurtBy; i++) {
      h.advance(1 / 60);
      m.tick(1 / 60, false);
    }
    expect(h.hurtBy).toBe(8);
    expect(m.mobs[0]!.pos[0]).toBeGreaterThan(28);
    h.dir = [-1, 0, 0];
    for (let i = 0; i < 60 && m.mobs[0] && !m.mobs[0].dead; i++) {
      h.advance(0.4);
      m.tick(1 / 60, true);
    }
    expect(m.mobs[0]?.dead ?? true).toBe(true);
    expect(m.money).toBe(10);
  });

  it('dynamite: bought, thrown, it blows a hole (ores in the backpack) and hurts monsters and the player', () => {
    const h = host([0, 0, 0], [1, 0, 0]);
    const m = make(h);
    expect(m.throwDynamite()).toBe(false);
    m.money = 1000;
    expect(m.buyDynamite(5)).toBe(true);
    expect(m.dynamite).toBe(5);
    m.blocks.set(12, 2, 0, 1 + 1);
    m.explode([12.5, 2.5, 0.5]);
    for (const [x, y, z] of [[12, 2, 0], [13, 2, 0], [12, 3, 1], [11, 1, 0]]) expect(m.blocks.get(x!, y!, z!)).toBe(AIR);
    expect(m.carried).toBeGreaterThan(0);
    expect(h.hurtBy).toBe(0);
    h.dir = [0, -1, 0];
    expect(m.throwDynamite()).toBe(true);
    expect(m.dynamite).toBe(4);
    for (let i = 0; i < 60 * 3; i++) {
      h.advance(1 / 60);
      m.tick(1 / 60, false);
    }
    expect(m.bombs).toHaveLength(0);
    expect(h.hurtBy).toBeGreaterThan(0);
  });

  it('each regeneration rolls a twist that changes the mine', () => {
    const h = host();
    const m = make(h, { twists: [{ id: 'normal', weight: 0 }, { id: 'gold_rush', weight: 0 }, { id: 'crystal_bloom', weight: 0 }, { id: 'rich_veins', weight: 0 }, { id: 'swarm', weight: 0 }, { id: 'pitch_dark', weight: 0 }, { id: 'hollow_earth', weight: 0 }, { id: 'lucky_day', weight: 0 }, { id: 'calm', weight: 0 }] });
    expect(m.twist.id).toBe('soft_rock');
    const soft = m.hud();
    expect(soft.twist).toBe('Soft Rock');
    const back = make(h);
    back.load(JSON.parse(JSON.stringify(m.save())));
    expect(back.twist.id).toBe('soft_rock');
    back.regenerate(false);
    expect(back.twist.id).not.toBe('soft_rock');
  });

  it('caves hold monsters; a cave cleared stays clear until the mine regenerates', () => {
    const h = host([20.5 * 40, -30 * 40, 0.5 * 40]);
    let seed = 7;
    h.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const m = make(h, { maxMobs: 50, spawnEvery: 0.01 });
    // (A closed room out of the player's sight, its sector holding two monsters.)
    for (let x = 33; x < 39; x++) for (let y = -32; y < -29; y++) for (let z = 0; z < 6; z++) m.blocks.set(x, y, z, AIR);
    const sector = '4,-4,0';
    m.sectors.set(sector, 2);
    const inRoom = () => m.mobs.filter((x) => x.sector === sector && !x.dead);
    for (let i = 0; i < 3000 && inRoom().length < 2; i++) {
      h.advance(0.05);
      m.tick(1 / 60, false);
    }
    expect(inRoom()).toHaveLength(2);
    for (const mob of inRoom()) m.explode([mob.pos[0], mob.pos[1] + 0.5, mob.pos[2]]);
    expect(m.sectors.get(sector)).toBe(0);
    expect(h.said).toContain('Cave cleared.');
    for (let i = 0; i < 300; i++) {
      h.advance(0.05);
      m.tick(1 / 60, false);
    }
    expect(inRoom()).toHaveLength(0);
    const back = make(h);
    back.load(JSON.parse(JSON.stringify(m.save())));
    expect(back.sectors.get(sector)).toBe(0);
    back.regenerate(false);
    expect(back.sectors.size).toBe(0);
  });

  it('dying loses part of the backpack; saving keeps it all; the mine regenerates on time', () => {
    const h = host();
    const m = make(h);
    m.bag.set(1, { n: 10, value: 50 });
    m.died();
    expect(m.carried).toBe(5);
    m.money = 77;
    m.blocks.set(9, 1, 0, AIR);
    const saved = JSON.parse(JSON.stringify(m.save()));
    const back = make(h);
    back.load(saved);
    expect(back.money).toBe(77);
    expect(back.carried).toBe(5);
    expect(back.blocks.get(9, 1, 0)).toBe(AIR);
    h.feet = [20 * 40, 0, 0];
    h.advance(41 * 60);
    back.tick(1 / 60, false);
    expect(back.blocks.get(9, 1, 0)).not.toBe(AIR);
    expect(h.feet).toEqual([0, 0, 0]);
  });
});

describe('in the game world', () => {
  function game() {
    const s = newScene('mine');
    s.entities = [newEntity('start', { playerSpawn: {} }, { position: [0, 0, 0] })];
    return GameWorld.create(s, { rules: { mining: true } });
  }
  const run = (w: GameWorld, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
  };

  it('off unless the game has it', () => {
    expect(GameWorld.create(newScene('plain')).mine).toBeNull();
  });

  it('the player stands on the mine floor and digs down', () => {
    const w = game();
    run(w, 1);
    expect(w.player!.feetPosition.y).toBeGreaterThan(-2);
    w.setPlayerInput({ pitch: -1.5, fire: true });
    run(w, 3);
    w.setPlayerInput({ fire: false });
    expect(w.mine!.blocks.get(0, -1, 0)).toBe(AIR);
    run(w, 1);
    expect(w.player!.feetPosition.y).toBeLessThan(-30);
  });

  it('long falls do no harm and the mine has no bottom', () => {
    const w = game();
    run(w, 0.2);
    const m = w.mine!;
    for (let y = -1; y > -80; y--) m.blocks.set(0, y, 0, AIR);
    run(w, 6);
    expect(w.player!.feetPosition.y).toBeLessThan(-75 * m.B);
    expect(w.playerStatus().health).toBe(100);
    expect(w.player!.feetPosition.y).toBeLessThan(-2048);
  });

  it('Tab opens the menu (the mouse is freed); H goes home', () => {
    const w = game();
    run(w, 0.1);
    expect(w.baseKey('Tab')).toBe(true);
    expect(w.uiState().freesMouse).toBe(true);
    expect(w.mineMenu()!.skills.length).toBeGreaterThan(20);
    w.mineAction('menu', 'close');
    expect(w.mineMenu()).toBeNull();
    w.player!.teleport({ x: 100, y: 0, z: 0 });
    w.baseKey('KeyH');
    expect(w.player!.feetPosition.x).toBeCloseTo(0, 0);
    expect(w.progress()!.mine).toBeTruthy();
  });
});
