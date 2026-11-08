// Base building, blueprint style: pieces from JSON, placing on the grid, filling with tagged props, finishing,
// removing, doors, knocking pieces down, saving.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, newWeapon, type EntityData, type ItemDef, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { BaseSystem, buildingCatalog, nearestSpot, readPieceDef, type BaseHost, type BlockerBox, type GameEvent, type Spot } from '../src';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

function fakeHost() {
  const items = new Map<string, number>();
  const events: GameEvent[] = [];
  const blockers = new Map<string, BlockerBox>();
  const consumed: string[] = [];
  /** Props by tag, as the world would find them touching a blueprint. */
  const props = new Map<string, string[]>();
  let t = 0;
  let hand = '';
  let ground = 0;
  const host: BaseHost = {
    time: () => t,
    itemCount: (n) => items.get(n) ?? 0,
    giveItem: (n, k) => void items.set(n, (items.get(n) ?? 0) + k),
    selectedItem: () => hand,
    groundAt: () => ground,
    setBlocker: (k, b) => void (b ? blockers.set(k, b) : blockers.delete(k)),
    propsIn: (_box, tag) => [...(props.get(tag) ?? [])],
    consume: (id) => {
      consumed.push(id);
      for (const [k, list] of props) props.set(k, list.filter((x) => x !== id));
    },
    emit: (e) => void events.push(e),
    playSound: () => {},
  };
  const { pieces, config, problems } = buildingCatalog();
  const base = new BaseSystem(pieces, config, host);
  return {
    base, items, events, blockers, consumed, props, problems,
    hold: (item: string) => void (hand = item),
    setGround: (y: number) => void (ground = y),
    advance: (s: number) => {
      for (let k = 0; k < Math.round(s * 60); k++) {
        t += 1 / 60;
        base.tick(1 / 60);
      }
    },
  };
}

const wall: Spot = { kind: 'edge', axis: 'x', x: 0, z: 0 };
const piece = (h: ReturnType<typeof fakeHost>, id: string) => h.base.pieces.get(id)!;

describe('build pieces (JSON)', () => {
  it('the built-in pieces read without problems', () => {
    const h = fakeHost();
    expect(h.problems).toEqual([]);
    expect([...h.base.pieces.keys()].sort()).toEqual(['concrete_floor', 'concrete_wall', 'wood_door', 'wood_floor', 'wood_wall', 'wood_window']);
    expect(piece(h, 'wood_wall')).toMatchObject({ material: 'plank', count: 4, snap: 'edge', blueprint: 'Wood wall blueprint' });
    expect(piece(h, 'concrete_floor')).toMatchObject({ material: 'concrete powder', snap: 'cell' });
  });

  it('a piece needs an id, a material and parts; the rest has defaults', () => {
    expect(() => readPieceDef({ material: 'plank', mesh: { parts: [{}] } })).toThrow(/id/);
    expect(() => readPieceDef({ id: 'a', mesh: { parts: [{}] } })).toThrow(/material/);
    expect(() => readPieceDef({ id: 'a', material: 'plank' })).toThrow(/parts/);
    const d = readPieceDef({ id: 'mud', label: 'Mud wall', material: 'mud', mesh: { parts: [{}] } });
    expect(d).toMatchObject({ blueprint: 'Mud wall blueprint', count: 1, snap: 'edge', consumeBlueprint: false, opens: false });
  });

  it('a game adds and replaces pieces', () => {
    const { pieces, problems } = buildingCatalog({ pieces: [{ id: 'wood_wall', material: 'log', count: 2, mesh: { parts: [{}] } }, { id: 'bad' }] });
    expect(pieces.get('wood_wall')!.material).toBe('log');
    expect(problems).toHaveLength(1);
  });
});

describe('placing blueprints', () => {
  it('a blueprint in hand previews on the nearest edge or cell; a click places it at 0%', () => {
    const h = fakeHost();
    expect(h.base.aimPlacement([50, 0, 10])).toBeNull();
    h.hold('Wood wall blueprint');
    expect(h.base.aimPlacement([50, 0, 10])!.spot).toEqual({ kind: 'edge', axis: 'x', x: 0, z: 0 });
    const id = h.base.placePreview()!;
    expect(h.base.site(id)!.filled).toBe(0);
    expect(h.events.at(-1)).toMatchObject({ type: 'base.placed', piece: 'wood_wall' });
    // (Blueprints don't block.)
    expect(h.blockers.size).toBe(0);
    h.hold('Wood floor blueprint');
    expect(h.base.aimPlacement([50, 0, 10])!.spot).toEqual({ kind: 'cell', x: 0, z: 0 });
    expect(nearestSpot('cell', -1, 200, 96)).toEqual({ kind: 'cell', x: -1, z: 2 });
  });

  it('one piece per spot and level; stacking on top is fine', () => {
    const h = fakeHost();
    h.hold('Wood wall blueprint');
    h.base.aimPlacement([50, 0, 10]);
    h.base.placePreview();
    expect(h.base.aimPlacement([50, 0, 10])!.valid).toBe(false);
    expect(h.base.placePreview()).toBeNull();
    // (A wall and a floor share the ground: different kinds of spot.)
    h.hold('Wood floor blueprint');
    expect(h.base.aimPlacement([50, 0, 10])!.valid).toBe(true);
    h.hold('Wood wall blueprint');
    h.setGround(104);
    expect(h.base.aimPlacement([50, 104, 10])!.valid).toBe(true);
  });

  it('blueprints are kept unless the piece uses them up', () => {
    const { pieces, config } = buildingCatalog({ pieces: [{ id: 'once', blueprint: 'Shed plan', consumeBlueprint: true, material: 'plank', mesh: { parts: [{}] } }] });
    const h = fakeHost();
    const base = new BaseSystem(pieces, config, { ...(h.base as never as { host: BaseHost }).host });
    h.hold('Shed plan');
    base.aimPlacement([50, 0, 10]);
    expect(base.placePreview()).toBeNull();
    h.items.set('Shed plan', 1);
    expect(base.placePreview()).not.toBeNull();
    expect(h.items.get('Shed plan')).toBe(0);
  });
});

describe('filling blueprints', () => {
  it('props of its material are used up one each until it is finished; then it blocks', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'wood_wall'), wall, 0);
    h.props.set('plank', ['p1', 'p2']);
    h.props.set('concrete powder', ['bag']);
    h.advance(0.2);
    expect(h.consumed).toEqual(['p1', 'p2']);
    expect(h.base.fraction(h.base.site(id)!)).toBe(0.5);
    expect(h.base.prompt({ site: id, distance: 1 })).toMatchObject({ title: 'Wood wall · 50%', label: 'Hold to remove', progress: 0.5, missing: '2 more planks' });
    expect(h.blockers.size).toBe(0);
    h.props.set('plank', ['p3', 'p4', 'p5']);
    h.advance(0.2);
    // (Full at four: the fifth plank is left alone.)
    expect(h.consumed).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(h.base.built(h.base.site(id)!)).toBe(true);
    expect(h.events.filter((e) => e.type === 'base.progress')).toHaveLength(4);
    expect(h.events.at(-1)).toMatchObject({ type: 'base.built', site: id });
    expect(h.blockers.size).toBe(piece(h, 'wood_wall').mesh.parts.length);
    expect([...h.blockers.values()][0]!.site).toBe(id);
    // A finished, undamaged wall has nothing to say.
    expect(h.base.prompt({ site: id, distance: 1 })).toBeNull();
  });

  it('its drawn boxes are the flat blueprint colour until finished', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'concrete_wall'), wall, 0);
    expect(h.base.parts().every((p) => p.ghost && p.color === h.base.config.ghost.color)).toBe(true);
    h.base.site(id)!.filled = 3;
    expect(h.base.parts().some((p) => p.ghost)).toBe(false);
  });

  it('the space it takes props in wraps its boxes', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'wood_floor'), { kind: 'cell', x: 1, z: 0 }, 10);
    const b = h.base.space(h.base.site(id)!);
    expect(b.center[0]).toBeCloseTo(96 + 48);
    expect(b.center[1]).toBeCloseTo(13);
    expect(b.half[0]).toBeCloseTo(47.5 + 4);
  });

  it('holding E on a blueprint removes it (what was put in is lost)', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'wood_wall'), wall, 0, undefined, 2);
    for (let k = 0; k < 30; k++) h.base.hold({ site: id, distance: 1 }, true, 1 / 60);
    expect(h.base.prompt({ site: id, distance: 1 })!.label).toBe('Removing…');
    h.base.hold(null, false, 1 / 60);
    for (let k = 0; k < 30; k++) h.base.hold({ site: id, distance: 1 }, true, 1 / 60);
    expect(h.base.site(id)).toBeDefined();
    for (let k = 0; k < 40; k++) h.base.hold({ site: id, distance: 1 }, true, 1 / 60);
    expect(h.base.site(id)).toBeUndefined();
    expect(h.events.at(-1)).toMatchObject({ type: 'base.removed', site: id });
    // Finished pieces aren't removed this way.
    const done = h.base.add(piece(h, 'wood_wall'), wall, 0, undefined, 4);
    for (let k = 0; k < 120; k++) h.base.hold({ site: done, distance: 1 }, true, 1 / 60);
    expect(h.base.site(done)).toBeDefined();
  });
});

describe('finished pieces', () => {
  it('hits wear a finished piece down until it comes down; blueprints take no damage', () => {
    const h = fakeHost();
    const bp = h.base.add(piece(h, 'wood_wall'), wall, 0);
    h.base.damage(bp, 1000);
    expect(h.base.site(bp)).toBeDefined();
    h.base.remove(bp);
    const id = h.base.add(piece(h, 'wood_wall'), wall, 0, undefined, 4);
    h.base.damage(id, 20);
    expect(h.base.prompt({ site: id, distance: 1 })).toMatchObject({ icon: 'hammer', label: '', progress: 40 / 60 });
    h.base.damage(id, 40);
    expect(h.base.site(id)).toBeUndefined();
    expect(h.blockers.size).toBe(0);
    expect(h.events.at(-1)).toMatchObject({ type: 'base.broken', site: id, piece: 'wood_wall' });
  });

  it('E opens and shuts a finished door: the leaf swings and stops blocking', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'wood_door'), wall, 0, undefined, 3);
    expect(h.blockers.has(`${id}:leaf`)).toBe(true);
    expect(h.base.prompt({ site: id, distance: 1 })!.label).toBe('Open');
    expect(h.base.press({ site: id, distance: 1 })).toBe(true);
    expect(h.blockers.has(`${id}:leaf`)).toBe(false);
    const leaf = h.base.parts().find((p) => p.key === `${id}:leaf`)!;
    expect(leaf.yaw).toBeCloseTo(Math.PI / 2);
    expect(h.events.at(-1)).toMatchObject({ type: 'base.door', open: true });
    // (Walls don't open; nor does an unfinished door.)
    const w = h.base.add(piece(h, 'wood_wall'), { kind: 'edge', axis: 'z', x: 0, z: 0 }, 0, undefined, 4);
    expect(h.base.press({ site: w, distance: 1 })).toBe(false);
  });
});

describe('saving', () => {
  it('blueprints, how full they are, health and doors come back', () => {
    const h = fakeHost();
    const a = h.base.add(piece(h, 'wood_wall'), wall, 0, undefined, 2);
    const b = h.base.add(piece(h, 'wood_door'), { kind: 'edge', axis: 'z', x: 1, z: 0 }, 0, undefined, 3);
    const c = h.base.add(piece(h, 'concrete_floor'), { kind: 'cell', x: 0, z: 0 }, 0, undefined, 4);
    h.base.press({ site: b, distance: 1 });
    h.base.damage(c, 50);
    const save = JSON.parse(JSON.stringify(h.base.save()));

    const h2 = fakeHost();
    h2.base.load(save);
    expect(h2.base.allSites()).toHaveLength(3);
    expect(h2.base.site(a)!.filled).toBe(2);
    expect(h2.base.site(b)!.open).toBe(true);
    expect(h2.base.site(c)!.health).toBe(200);
    expect(h2.base.site(c)!.spot).toEqual({ kind: 'cell', x: 0, z: 0 });
    // New sites don't reuse ids; old-style saves are left behind.
    expect(h2.base.add(piece(h2, 'wood_wall'), { kind: 'edge', axis: 'x', x: 9, z: 9 }, 0)).not.toBe(a);
    h2.base.load({ v: 1, sites: [], next: 1 });
    expect(h2.base.allSites()).toHaveLength(4);
  });
});

describe('in the game world', () => {
  const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}, tags: string[] = []): EntityData => {
    const e = newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
    e.tags = tags;
    return e;
  };
  const run = (w: GameWorld, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
  };
  /** A plank lying at x (inside the wall blueprint on edge x:0:0 when z is about 0). */
  const plank = (name: string, x: number, z = 0) => brush(name, [x - 8, 40, z - 2], [x + 8, 44, z + 2], { rigidBody: { motion: 'dynamic', mass: 2 } }, ['Plank']);

  function game(extra: EntityData[] = [], at: Vec3 = [48, 0, 200], saved: unknown = null, items: ItemDef[] = []) {
    const s = newScene('base');
    s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }, { position: at }), ...extra];
    s.settings.ui = { screens: [], items } as never;
    return GameWorld.create(s, { rules: { building: true, saveItems: true }, saved: saved as never });
  }

  it('off unless the game has it', () => {
    expect(GameWorld.create(newScene('plain')).base).toBeNull();
  });

  it('a blueprint item places a blueprint on the floor; the HUD shows 0%', () => {
    const w = game();
    w.giveItem('Wood wall blueprint', 1);
    w.setPlayerInput({ pitch: -0.6, yaw: 0 });
    run(w, 0.2);
    expect(w.base!.preview!.y).toBeCloseTo(0, 0);
    expect(w.buildPrompt()).toMatchObject({ label: 'Place blueprint', missing: '4 planks' });
    w.useItem();
    expect(w.base!.allSites()).toHaveLength(1);
    // (Kept: one blueprint places as many as wanted; the spot is taken now.)
    run(w, 0.05);
    expect(w.base!.preview!.valid).toBe(false);
    w.giveItem('Wood wall blueprint', -1);
    w.setPlayerInput({ pitch: -0.3 });
    run(w, 0.1);
    expect(w.buildPrompt()!.title).toMatch(/0%$/);
  });

  it('planks touching it are used up; four finish it, and then it blocks', () => {
    const planks = [10, 30, 50, 70].map((x, i) => plank(`plank${i}`, x));
    const spare = plank('spare', 48, 30);
    // (Named after the material counts too, untagged.)
    planks[3]!.name = 'Plank 4';
    planks[3]!.tags = [];
    const crate = brush('crate of planks', [80, 30, -4], [92, 42, 4], { rigidBody: { motion: 'dynamic', mass: 2 } });
    const w = game([...planks, spare, crate]);
    const id = w.base!.add(w.base!.pieces.get('wood_wall')!, wall, 0);
    run(w, 0.3);
    const s = w.base!.site(id)!;
    expect(s.filled).toBe(4);
    expect(w.base!.built(s)).toBe(true);
    for (const p of planks) expect(w.positionOf(p.id)).toBeNull();
    expect(w.positionOf(spare.id)).not.toBeNull();
    // (Untagged props aren't building material.)
    expect(w.positionOf(crate.id)).not.toBeNull();
    expect(w.base!.allSites()).toHaveLength(1);
  });

  it('a crowbar knocks a finished wall down', () => {
    const w = game([], [48, 0, 40], null, [{ name: 'Crowbar', icon: '', weapon: newWeapon('crowbar') }]);
    const id = w.base!.add(w.base!.pieces.get('wood_wall')!, wall, 0, undefined, 4);
    w.giveItem('Crowbar', 1);
    w.selectSlot(0);
    w.setPlayerInput({ yaw: 0, pitch: 0 });
    run(w, 0.2);
    w.setPlayerInput({ fire: true });
    run(w, 4);
    expect(w.base!.site(id)).toBeUndefined();
  });

  it('holding E on a blueprint removes it', () => {
    const w = game([], [48, 0, 80]);
    const id = w.base!.add(w.base!.pieces.get('wood_wall')!, wall, 0);
    w.setPlayerInput({ yaw: 0, pitch: 0 });
    run(w, 0.1);
    expect(w.buildPrompt()!.label).toBe('Hold to remove');
    w.setPlayerInput({ use: true });
    run(w, 1.3);
    expect(w.base!.site(id)).toBeUndefined();
  });

  it('the base is saved with the game', () => {
    const p = plank('p', 48);
    const w = game([p]);
    const id = w.base!.add(w.base!.pieces.get('wood_wall')!, wall, 0);
    run(w, 0.2);
    const saved = JSON.parse(JSON.stringify(w.progress()!));
    expect(Object.keys(saved.base)).toEqual(['base']);
    const w2 = game([p], undefined, saved);
    expect(w2.base!.site(id)!.filled).toBe(1);
  });
});
