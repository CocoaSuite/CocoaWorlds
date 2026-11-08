// Base building, blueprint style: pieces from JSON, placing on the grid, filling with tagged props, finishing,
// removing, doors, knocking pieces down, saving.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, newWeapon, type EntityData, type ItemDef, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { BaseSystem, buildingCatalog, readPieceDef, turnedSize, type BaseHost, type BlockerBox, type GameEvent } from '../src';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

function fakeHost() {
  const items = new Map<string, number>();
  const events: GameEvent[] = [];
  const blockers = new Map<string, BlockerBox>();
  const consumed: string[] = [];
  /** Props touching each blueprint (by site), with their material, as the world would find them. */
  const props = new Map<string, [id: string, material: string][]>();
  let t = 0;
  const host: BaseHost = {
    time: () => t,
    itemCount: (n) => items.get(n) ?? 0,
    giveItem: (n, k) => void items.set(n, (items.get(n) ?? 0) + k),
    // (The ground: flat at 0.)
    castRay: (from, dir, reach) => (dir[1] < 0 && -from[1] / dir[1] <= reach ? { distance: -from[1] / dir[1], normal: [0, 1, 0] } : null),
    setBlocker: (k, b) => void (b ? blockers.set(k, b) : blockers.delete(k)),
    propsIn: (box, tag) => (props.get(box.site) ?? []).filter(([, m]) => m === tag).map(([id]) => id),
    consume: (id) => {
      consumed.push(id);
      for (const [k, list] of props) props.set(k, list.filter(([x]) => x !== id));
    },
    emit: (e) => void events.push(e),
    playSound: () => {},
  };
  const { pieces, config, problems } = buildingCatalog();
  const base = new BaseSystem(pieces, config, host);
  return {
    base, items, events, blockers, consumed, props, problems,
    advance: (s: number) => {
      for (let k = 0; k < Math.round(s * 60); k++) {
        t += 1 / 60;
        base.tick(1 / 60);
      }
    },
  };
}

const wall: [number, number, number] = [0, 0, 0];
const piece = (h: ReturnType<typeof fakeHost>, id: string) => h.base.pieces.get(id)!;

describe('build pieces (JSON)', () => {
  it('the built-in pieces read without problems', () => {
    const h = fakeHost();
    expect(h.problems).toEqual([]);
    expect(h.base.pieces.size).toBe(14);
    expect([...h.base.pieces.values()].filter((d) => d.category === 'Concrete').every((d) => d.count === 1)).toBe(true);
    expect(piece(h, 'wood_wall')).toMatchObject({ material: 'plank', count: 4, size: [96, 96, 8], category: 'Wood', blueprint: 'Wood wall blueprint', turns: true });
    expect(piece(h, 'concrete_floor')).toMatchObject({ material: 'concrete powder', category: 'Concrete' });
    expect(piece(h, 'wood_door').turns).toBe(false);
    expect(h.base.config.grid).toBe(48);
  });

  it('a piece needs an id, a material and parts; the rest has defaults', () => {
    expect(() => readPieceDef({ material: 'plank', mesh: { parts: [{}] } })).toThrow(/id/);
    expect(() => readPieceDef({ id: 'a', mesh: { parts: [{}] } })).toThrow(/material/);
    expect(() => readPieceDef({ id: 'a', material: 'plank' })).toThrow(/parts/);
    const d = readPieceDef({ id: 'mud', label: 'Mud wall', material: 'mud', mesh: { parts: [{ at: [10, 20, 2], size: [20, 40, 4] }] } });
    expect(d).toMatchObject({ blueprint: 'Mud wall blueprint', count: 1, category: 'Other', size: [20, 40, 4], consumeBlueprint: false, opens: false, icon: '' });
  });

  it('a game adds and replaces pieces', () => {
    const { pieces, problems } = buildingCatalog({ pieces: [{ id: 'wood_wall', material: 'log', count: 2, mesh: { parts: [{}] } }, { id: 'bad' }] });
    expect(pieces.get('wood_wall')!.material).toBe('log');
    expect(problems).toHaveLength(1);
  });

  it('quarter turns keep pieces boxes along the axes', () => {
    expect(turnedSize([96, 96, 8], { yaw: 1, tilt: 0 })).toEqual([8, 96, 96]);
    expect(turnedSize([96, 96, 8], { yaw: 0, tilt: 1 })).toEqual([96, 8, 96]);
  });
});

describe('the blueprint menu and placing', () => {
  const down = (x: number, z: number, from = 300): [[number, number, number], [number, number, number]] => [[x, from, z], [0, -1, 0]];

  it('the menu has the blueprints owned; placing needs one', () => {
    const h = fakeHost();
    expect(h.base.owned()).toEqual([]);
    expect(h.base.startPlacing('wood_wall')).toBe(false);
    h.items.set('Wood wall blueprint', 1);
    h.items.set('Concrete foundation blueprint', 1);
    expect(h.base.owned().map((c) => [c.piece, c.category])).toEqual([['concrete_floor', 'Concrete'], ['wood_wall', 'Wood']]);
    h.base.setMenu(true);
    expect(h.base.startPlacing('wood_wall')).toBe(true);
    expect(h.base.menuOpen).toBe(false);
  });

  it('the ghost lines up on the grid on the ground; a click places it at 0% and placing goes on', () => {
    const h = fakeHost();
    h.items.set('Wood wall blueprint', 1);
    h.base.startPlacing('wood_wall');
    expect(h.base.aimPlacement(...down(50, 30))).toMatchObject({ min: [0, 0, 48], valid: true });
    expect(h.base.prompt(null)).toMatchObject({ title: 'Wood wall', label: 'Place', missing: '4 planks' });
    const id = h.base.placePreview()!;
    expect(h.base.site(id)).toMatchObject({ filled: 0, min: [0, 0, 48] });
    expect(h.events.at(-1)).toMatchObject({ type: 'base.placed', piece: 'wood_wall' });
    expect(h.blockers.size).toBe(0);
    // (Still placing; the same spot is taken now.)
    expect(h.base.placing).toBe('wood_wall');
    expect(h.base.aimPlacement(...down(50, 30))!.valid).toBe(false);
    expect(h.base.aimPlacement(...down(48, 52))).toMatchObject({ min: [0, 96, 48], valid: true });
    expect(h.base.placePreview()).not.toBeNull();
    h.base.stopPlacing();
    expect(h.base.preview).toBeNull();
  });

  it('blueprints stack on blueprints and go flush beside them', () => {
    const h = fakeHost();
    h.items.set('Wood wall blueprint', 1);
    h.base.add(piece(h, 'wood_wall'), [0, 0, 48]);
    h.base.startPlacing('wood_wall');
    // On top: aimed down at its top.
    expect(h.base.aimPlacement(...down(48, 52))).toMatchObject({ min: [0, 96, 48], valid: true });
    // Beside: aimed at its side, flush with it, on its levels.
    expect(h.base.aimPlacement([48, 40, 200], [0, 0, -1])).toMatchObject({ min: [0, 0, 56], valid: true });
  });

  it('R turns and T tips the ghost a quarter (doors don\'t tip); walls meet at corners but not in one place', () => {
    const h = fakeHost();
    h.items.set('Wood wall blueprint', 1);
    h.items.set('Wood door blueprint', 1);
    h.base.add(piece(h, 'wood_wall'), [0, 0, 0]);
    h.base.startPlacing('wood_wall');
    h.base.rotate();
    const turned = h.base.aimPlacement(...down(4, 48))!;
    expect(turned.turn).toEqual({ yaw: 1, tilt: 0 });
    expect(turned).toMatchObject({ min: [0, 0, 0], valid: true });
    h.base.rotate();
    h.base.rotate();
    h.base.rotate();
    expect(h.base.aimPlacement([48, 40, -200], [0, 0, 1])!.min).toEqual([0, 0, -8]);
    h.base.tip();
    const flat = h.base.aimPlacement(...down(200, 200))!;
    expect(h.base.sizeOf({ def: piece(h, 'wood_wall'), turn: flat.turn })).toEqual([96, 8, 96]);
    h.base.startPlacing('wood_door');
    h.base.tip();
    expect(h.base.placingTurn.tilt).toBe(0);
  });

  it('blueprints used up on placing stop placing when there are none left', () => {
    const { pieces, config } = buildingCatalog({ pieces: [{ id: 'once', blueprint: 'Shed plan', consumeBlueprint: true, material: 'plank', mesh: { parts: [{}] } }] });
    const h = fakeHost();
    const base = new BaseSystem(pieces, config, (h.base as never as { host: BaseHost }).host);
    h.items.set('Shed plan', 1);
    base.startPlacing('once');
    base.aimPlacement(...down(50, 10));
    expect(base.placePreview()).not.toBeNull();
    expect(h.items.get('Shed plan')).toBe(0);
    expect(base.placing).toBeNull();
  });
});

describe('filling blueprints', () => {
  it('props of its material count while in it; at its count they are used up together and it blocks', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'wood_wall'), wall);
    h.props.set(id, [['p1', 'plank'], ['p2', 'plank'], ['bag', 'concrete powder']]);
    h.advance(0.2);
    // (Not used up yet: they stay where they are.)
    expect(h.consumed).toEqual([]);
    expect(h.base.fraction(h.base.site(id)!)).toBe(0.5);
    expect(h.base.prompt({ site: id, distance: 1 })).toMatchObject({ title: 'Wood wall · 50%', label: 'Hold to remove', progress: 0.5, missing: '2 more planks' });
    expect(h.blockers.size).toBe(0);
    // Taken out again: back down.
    h.props.set(id, [['p1', 'plank']]);
    h.advance(0.2);
    expect(h.base.site(id)!.filled).toBe(1);
    h.props.set(id, [['p1', 'plank'], ['p2', 'plank'], ['p3', 'plank'], ['p4', 'plank'], ['p5', 'plank']]);
    h.advance(0.2);
    // (Full at four: the fifth plank is left alone.)
    expect(h.consumed).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(h.base.built(h.base.site(id)!)).toBe(true);
    expect(h.events.filter((e) => e.type === 'base.progress').map((e) => (e as { filled: number }).filled)).toEqual([2, 1, 4]);
    expect(h.events.at(-1)).toMatchObject({ type: 'base.built', site: id });
    expect(h.blockers.size).toBe(piece(h, 'wood_wall').mesh.parts.length);
    expect([...h.blockers.values()][0]!.site).toBe(id);
    // A finished, undamaged wall has nothing to say.
    expect(h.base.prompt({ site: id, distance: 1 })).toBeNull();
  });

  it('a prop touching two blueprints counts for one only; past its count, to the next', () => {
    const h = fakeHost();
    const a = h.base.add(piece(h, 'wood_wall'), wall);
    const b = h.base.add(piece(h, 'wood_wall'), [0, 0, 0], { yaw: 1 });
    h.props.set(a, [['p1', 'plank']]);
    h.advance(0.2);
    // p1 is in a: touching b as well now, it stays a's.
    h.props.set(a, [['p1', 'plank']]);
    h.props.set(b, [['p1', 'plank'], ['p2', 'plank']]);
    h.advance(0.2);
    expect(h.base.site(a)!.filled).toBe(1);
    expect(h.base.site(b)!.filled).toBe(1);
    // Out of a: b can have it.
    h.props.set(a, []);
    h.advance(0.2);
    expect(h.base.site(a)!.filled).toBe(0);
    expect(h.base.site(b)!.filled).toBe(2);
    // Five planks touching both: a (the older) has four and finishes; b gets the fifth and keeps its own.
    const five: [string, string][] = ['q1', 'q2', 'q3', 'q4', 'q5'].map((x) => [x, 'plank']);
    h.props.set(a, five);
    h.props.set(b, [['p1', 'plank'], ['p2', 'plank'], ...five]);
    h.advance(0.2);
    expect(h.base.built(h.base.site(a)!)).toBe(true);
    expect(h.consumed).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(h.base.site(b)!.filled).toBe(3);
  });

  it('its drawn boxes are the flat blueprint colour until finished', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'concrete_wall'), wall);
    expect(h.base.parts().every((p) => p.ghost && p.color === h.base.config.ghost.color)).toBe(true);
    h.base.site(id)!.filled = 3;
    expect(h.base.parts().some((p) => p.ghost)).toBe(false);
  });

  it('the space it takes props in wraps its boxes', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'wood_floor'), [96, 10, 0]);
    const b = h.base.space(h.base.site(id)!);
    expect(b.center[0]).toBeCloseTo(144);
    expect(b.center[1]).toBeCloseTo(13);
    expect(b.half[0]).toBeCloseTo(48 + 4);
  });

  it('holding E on a blueprint removes it (the props in it stay)', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'wood_wall'), wall);
    h.props.set(id, [['p1', 'plank']]);
    h.advance(0.2);
    for (let k = 0; k < 30; k++) h.base.hold({ site: id, distance: 1 }, true, 1 / 60);
    expect(h.base.prompt({ site: id, distance: 1 })!.label).toBe('Removing…');
    h.base.hold(null, false, 1 / 60);
    for (let k = 0; k < 30; k++) h.base.hold({ site: id, distance: 1 }, true, 1 / 60);
    expect(h.base.site(id)).toBeDefined();
    for (let k = 0; k < 40; k++) h.base.hold({ site: id, distance: 1 }, true, 1 / 60);
    expect(h.base.site(id)).toBeUndefined();
    expect(h.events.at(-1)).toMatchObject({ type: 'base.removed', site: id });
    expect(h.consumed).toEqual([]);
    // Finished pieces aren't removed this way.
    const done = h.base.add(piece(h, 'wood_wall'), wall, {}, undefined, 4);
    for (let k = 0; k < 120; k++) h.base.hold({ site: done, distance: 1 }, true, 1 / 60);
    expect(h.base.site(done)).toBeDefined();
  });
});

describe('finished pieces', () => {
  it('hits wear a finished piece down until it comes down; blueprints take no damage', () => {
    const h = fakeHost();
    const bp = h.base.add(piece(h, 'wood_wall'), wall);
    h.base.damage(bp, 1000);
    expect(h.base.site(bp)).toBeDefined();
    h.base.remove(bp);
    const id = h.base.add(piece(h, 'wood_wall'), wall, {}, undefined, 4);
    h.base.damage(id, 20);
    expect(h.base.prompt({ site: id, distance: 1 })).toMatchObject({ icon: 'hammer', label: '', progress: 40 / 60 });
    h.base.damage(id, 40);
    expect(h.base.site(id)).toBeUndefined();
    expect(h.blockers.size).toBe(0);
    expect(h.events.at(-1)).toMatchObject({ type: 'base.broken', site: id, piece: 'wood_wall' });
  });

  it('E opens and shuts a finished door smoothly: it stops blocking once it moves, and blocks again shut', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'wood_door'), wall, {}, undefined, 2);
    expect(h.blockers.has(`${id}:leaf`)).toBe(true);
    expect(h.base.prompt({ site: id, distance: 1 })!.label).toBe('Open');
    expect(h.base.press({ site: id, distance: 1 })).toBe(true);
    expect(h.events.at(-1)).toMatchObject({ type: 'base.door', open: true });
    const leaf = () => h.base.parts().find((p) => p.key === `${id}:leaf`)!;
    h.advance(0.2);
    expect(leaf().yaw).toBeGreaterThan(0.1);
    expect(leaf().yaw).toBeLessThan(Math.PI / 2 - 0.1);
    expect(h.blockers.has(`${id}:leaf`)).toBe(false);
    h.advance(0.5);
    expect(leaf().yaw).toBeCloseTo(Math.PI / 2);
    h.base.press({ site: id, distance: 1 });
    h.advance(0.7);
    expect(leaf().yaw).toBeCloseTo(0);
    expect(h.blockers.has(`${id}:leaf`)).toBe(true);
    // (Walls don't open.)
    const w = h.base.add(piece(h, 'wood_wall'), [200, 0, 0], {}, undefined, 4);
    expect(h.base.press({ site: w, distance: 1 })).toBe(false);
  });

  it('a door aimed at a door frame goes in its gap, turned with it; one door per frame', () => {
    const h = fakeHost();
    h.items.set('Wood door blueprint', 1);
    h.base.add(piece(h, 'concrete_door'), [96, 0, 48], { yaw: 1 });
    h.base.startPlacing('wood_door');
    // (The frame, turned: 10 across x, 96 along z.)
    const p = h.base.aimPlacement([101, 40, 300], [0, 0, -1])!;
    expect(p).toMatchObject({ valid: true, turn: { yaw: 1, tilt: 0 } });
    expect(p.min[0]).toBeCloseTo(99);
    expect(p.min[1]).toBeCloseTo(0);
    h.base.placePreview();
    expect(h.base.aimPlacement([101, 40, 300], [0, 0, -1])!.min[0]).not.toBeCloseTo(99);
    // A window goes in a window frame's gap, the same way.
    h.items.set('Window blueprint', 1);
    h.base.add(piece(h, 'wood_window'), [0, 0, 300]);
    h.base.startPlacing('window');
    expect(h.base.aimPlacement([48, 56, 400], [0, 0, -1])).toMatchObject({ valid: true, min: [22, 40, 303] });
    h.base.startPlacing('wood_door');
    // Doors go anywhere else too, on the grid.
    expect(h.base.aimPlacement([300, 300, 300], [0, -1, 0])).toMatchObject({ valid: true, min: [288, 0, 288] });
  });
});

describe('saving', () => {
  it('blueprints, finished pieces, health and doors come back (unfinished ones fill again from the props in them)', () => {
    const h = fakeHost();
    const a = h.base.add(piece(h, 'wood_wall'), wall, {}, undefined, 2);
    const b = h.base.add(piece(h, 'wood_door'), [200, 0, 0], { yaw: 1 }, undefined, 2);
    const c = h.base.add(piece(h, 'concrete_floor'), [0, 0, 100], {}, undefined, 4);
    h.base.press({ site: b, distance: 1 });
    h.base.damage(c, 50);
    const save = JSON.parse(JSON.stringify(h.base.save()));

    const h2 = fakeHost();
    h2.base.load(save);
    expect(h2.base.allSites()).toHaveLength(3);
    expect(h2.base.site(a)!.filled).toBe(0);
    expect(h2.base.built(h2.base.site(b)!)).toBe(true);
    expect(h2.base.site(b)!.open).toBe(true);
    expect(h2.base.site(c)!.health).toBe(200);
    expect(h2.base.site(c)!.min).toEqual([0, 0, 100]);
    expect(h2.base.site(b)!.turn).toEqual({ yaw: 1, tilt: 0 });
    // New sites don't reuse ids; old-style saves are left behind.
    expect(h2.base.add(piece(h2, 'wood_wall'), [900, 0, 900])).not.toBe(a);
    h2.base.load({ v: 2, sites: [], next: 1 });
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

  /** The wall blueprint's corner: along x from 0, across z −4…4. */
  const wallAt: [number, number, number] = [0, 0, -4];

  function game(extra: EntityData[] = [], at: Vec3 = [48, 0, 200], saved: unknown = null, items: ItemDef[] = []) {
    const s = newScene('base');
    s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }, { position: at }), ...extra];
    s.settings.ui = { screens: [], items } as never;
    return GameWorld.create(s, { rules: { building: true, saveItems: true }, saved: saved as never });
  }

  it('off unless the game has it', () => {
    expect(GameWorld.create(newScene('plain')).base).toBeNull();
  });

  it('B opens the menu of blueprints owned; one picked is placed with a click; R, T, Q while placing', () => {
    const w = game();
    w.giveItem('Wood wall blueprint', 1);
    w.giveItem('Torch', 1);
    // (Blueprints aren't hotbar slots.)
    expect(w.uiState().inventory.map((i) => i.item)).toEqual(['Torch']);
    expect(w.selectedItem()).toBe('Torch');
    expect(w.baseKey('KeyB')).toBe(true);
    expect(w.uiState().freesMouse).toBe(true);
    expect(w.blueprintMenu()!.cards.map((c) => c.piece)).toEqual(['wood_wall']);
    w.pickBlueprint('wood_wall');
    expect(w.blueprintMenu()).toBeNull();
    w.setPlayerInput({ pitch: -0.6, yaw: 0 });
    run(w, 0.2);
    expect(w.base!.preview!.min[1]).toBeCloseTo(0, 0);
    expect(w.buildPrompt()).toMatchObject({ label: 'Place', missing: '4 planks' });
    expect(w.baseKey('KeyR')).toBe(true);
    expect(w.base!.placingTurn.yaw).toBe(1);
    w.useItem();
    expect(w.base!.allSites()).toHaveLength(1);
    expect(w.blueprintTags()!.tags[0]!.percent).toBe(0);
    expect(w.baseKey('KeyQ')).toBe(true);
    expect(w.base!.placing).toBeNull();
    expect(w.baseKey('KeyR')).toBe(false);
    w.setPlayerInput({ pitch: -0.3 });
    run(w, 0.1);
    expect(w.buildPrompt()!.title).toMatch(/0%$/);
  });

  it('planks in it stay until there are four; then they are used up and it blocks', () => {
    const planks = [10, 30, 50, 70].map((x, i) => plank(`plank${i}`, x));
    const spare = plank('spare', 48, 30);
    // (Named after the material counts too, untagged.)
    planks[3]!.name = 'Plank 4';
    planks[3]!.tags = [];
    const crate = brush('crate of planks', [80, 30, -4], [92, 42, 4], { rigidBody: { motion: 'dynamic', mass: 2 } });
    const w = game([...planks, spare, crate]);
    const id = w.base!.add(w.base!.pieces.get('wood_wall')!, wallAt);
    const two = game(planks.slice(0, 2));
    const id2 = two.base!.add(two.base!.pieces.get('wood_wall')!, wallAt);
    run(two, 0.3);
    expect(two.base!.site(id2)!.filled).toBe(2);
    for (const p of planks.slice(0, 2)) expect(two.positionOf(p.id)).not.toBeNull();
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
    const id = w.base!.add(w.base!.pieces.get('wood_wall')!, wallAt, {}, undefined, 4);
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
    const id = w.base!.add(w.base!.pieces.get('wood_wall')!, wallAt);
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
    const id = w.base!.add(w.base!.pieces.get('wood_wall')!, wallAt);
    run(w, 0.2);
    const saved = JSON.parse(JSON.stringify(w.progress()!));
    expect(Object.keys(saved.base)).toEqual(['base']);
    const w2 = game([p], undefined, saved);
    expect(w2.base!.site(id)).toBeDefined();
    run(w2, 0.2);
    expect(w2.base!.site(id)!.filled).toBe(1);
  });
});
