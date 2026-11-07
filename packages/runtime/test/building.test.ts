// Base building: pieces from JSON, stages, doors and bolts, rooms and sealing, comfort, sleep, the wedge, saving.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { BaseSystem, buildingCatalog, findRooms, nearestEdge, readPieceDef, type BaseHost, type ComfortSource, type GameEvent } from '../src';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

function fakeHost(over: Partial<BaseHost> = {}) {
  const items = new Map<string, number>();
  const events: GameEvent[] = [];
  const blockers = new Map<string, unknown>();
  const said: string[] = [];
  const pinned = new Map<string, unknown>();
  const sources: ComfortSource[] = [];
  let t = 0;
  let hand = '';
  let rnd = 0.5;
  const host: BaseHost = {
    time: () => t,
    random: () => rnd,
    itemCount: (n) => items.get(n) ?? 0,
    giveItem: (n, k) => void items.set(n, (items.get(n) ?? 0) + k),
    selectedItem: () => hand,
    groundAt: () => 0,
    setBlocker: (k, b) => void (b ? blockers.set(k, b) : blockers.delete(k)),
    emit: (e) => void events.push(e),
    say: (s) => void said.push(s),
    playSound: () => {},
    comfortSources: () => sources,
    pinChair: (id, at) => void pinned.set(id, at),
    releaseChair: (id) => void pinned.delete(id),
    ...over,
  };
  const { pieces, config, problems } = buildingCatalog();
  const base = new BaseSystem(pieces, config, host);
  return {
    base, items, events, blockers, said, pinned, sources, problems,
    hold: (item: string) => void (hand = item),
    advance: (s: number) => {
      for (let k = 0; k < Math.round(s * 60); k++) {
        t += 1 / 60;
        base.tick(1 / 60);
      }
    },
    setRandom: (r: number) => void (rnd = r),
  };
}

/** Work a site's stages from inside (E taps, or E held through holds and pours). */
function press(h: ReturnType<typeof fakeHost>, site: string, times = 1, part: string | null = null) {
  for (let i = 0; i < times; i++) h.base.press({ site, part, distance: 10 }, null, [48, 0, 48]);
}
function holdE(h: ReturnType<typeof fakeHost>, site: string, seconds: number) {
  for (let k = 0; k < Math.round(seconds * 60); k++) h.base.hold({ site, part: null, distance: 10 }, true, 1 / 60);
}

const G = 96;
const piece = (h: ReturnType<typeof fakeHost>, id: string) => h.base.pieces.get(id)!;

/** A 1×1 room at cell (0, 0) out of three finished wood walls and one more piece. */
function room(h: ReturnType<typeof fakeHost>, fourth: string) {
  const ids = [
    h.base.add(piece(h, 'wood_wall'), { axis: 'x', x: 0, z: 0 }, 0),
    h.base.add(piece(h, 'wood_wall'), { axis: 'x', x: 0, z: 1 }, 0),
    h.base.add(piece(h, 'wood_wall'), { axis: 'z', x: 0, z: 0 }, 0),
  ];
  for (const id of ids) {
    const s = h.base.site(id)!;
    s.stage = s.def.stages.length;
  }
  const last = h.base.add(piece(h, fourth), { axis: 'z', x: 1, z: 0 }, 0);
  return { walls: ids, last };
}

describe('build pieces (JSON)', () => {
  it('the built-in pieces read without problems; repeat groups are spelled out', () => {
    const h = fakeHost();
    expect(h.problems).toEqual([]);
    expect([...h.base.pieces.keys()].sort()).toEqual(['concrete_wall', 'door', 'window', 'wood_wall']);
    const wood = piece(h, 'wood_wall');
    expect(wood.stages.map((s) => s.id)).toEqual(['posts', 'drive', 'board_1', 'nail_1', 'board_2', 'nail_2', 'board_3', 'nail_3', 'board_4', 'nail_4']);
  });

  it('says what is wrong with a broken piece', () => {
    expect(() => readPieceDef({ id: 'x', stages: [{ action: 'tap', optional: true }, { action: 'tap' }] })).toThrow(/optional/);
    expect(() => readPieceDef({ id: 'x', stages: [{ id: 'a' }], mesh: { parts: [{ from: 'nope' }] } })).toThrow(/nope/);
    // A new material is JSON alone.
    const { pieces, problems } = buildingCatalog({ pieces: [{ id: 'mud_wall', blueprint: 'Mud wall plan', stages: [{ id: 'mud', action: 'pour', item: 'Mud', count: 3 }] }] });
    expect(problems).toEqual([]);
    expect(pieces.get('mud_wall')!.stages[0]!.duration).toBe(1.5);
  });

  it('a plan in hand shows a ghost on the nearest edge and places a build site', () => {
    const h = fakeHost();
    expect(nearestEdge(40, 3, G)).toEqual({ axis: 'x', x: 0, z: 0 });
    expect(nearestEdge(94, 40, G)).toEqual({ axis: 'z', x: 1, z: 0 });
    h.hold('Wood wall plan');
    expect(h.base.aimPlacement([40, 0, 3])!.valid).toBe(true);
    expect(h.base.parts().every((p) => p.ghost)).toBe(true);
    const id = h.base.placePreview()!;
    expect(id).toBeTruthy();
    expect(h.base.aimPlacement([40, 0, 3])!.valid).toBe(false);
    expect(h.events.some((e) => e.type === 'base.placed')).toBe(true);
  });
});

describe('stages', () => {
  it('wood wall: posts, driven in (they sink), then boards nailed on; tools in hand, items used up', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'wood_wall'), { axis: 'x', x: 0, z: 0 }, 0);
    const s = h.base.site(id)!;
    press(h, id);
    expect(h.said[0]).toMatch(/Wooden post/);
    h.items.set('Wooden post', 2);
    press(h, id, 2);
    expect(h.items.get('Wooden post')).toBe(0);
    expect(h.base.current(s)!.id).toBe('drive');
    const postY = () => h.base.parts().find((p) => p.key === `${id}:post_a`)!.center[1];
    const before = postY();
    press(h, id, 3);
    expect(h.base.current(s)!.id).toBe('drive');
    h.hold('Sledgehammer');
    press(h, id, 3);
    expect(postY()).toBeLessThan(before);
    press(h, id, 3);
    expect(postY()).toBeCloseTo(before - 14);
    expect(h.base.current(s)!.id).toBe('board_1');
    h.items.set('Board', 4);
    h.items.set('Nail', 16);
    for (let b = 0; b < 4; b++) {
      press(h, id);
      h.hold('Hammer');
      press(h, id, 4);
      h.hold('');
    }
    expect(h.base.built(s)).toBe(true);
    expect(h.items.get('Nail')).toBe(0);
    expect(h.events.some((e) => e.type === 'base.built' && e.site === id)).toBe(true);
    // Solid now: posts and boards block the player.
    expect([...h.blockers.keys()].filter((k) => k.startsWith(id)).length).toBe(6);
  });

  it('concrete wall: mold (or 4 planks), pour, cure on a timer, strip gives the mold back', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'concrete_wall'), { axis: 'x', x: 0, z: 0 }, 0);
    const s = h.base.site(id)!;
    h.items.set('Plank', 4);
    h.hold('Hammer');
    holdE(h, id, 1);
    expect(h.base.fraction(s, 'mold')).toBeCloseTo(0.4, 1);
    holdE(h, id, 1.6);
    expect(h.items.get('Plank')).toBe(0);
    expect(h.base.current(s)!.id).toBe('pour');
    h.items.set('Bucket of concrete', 2);
    h.hold('');
    holdE(h, id, 6.1);
    expect(h.items.get('Empty bucket')).toBe(2);
    expect(h.base.current(s)!.id).toBe('cure');
    h.advance(100);
    expect(h.base.current(s)!.id).toBe('cure');
    h.advance(81);
    expect(h.base.current(s)!.id).toBe('strip');
    holdE(h, id, 2.1);
    expect(h.base.built(s)).toBe(true);
    expect(h.items.get('Concrete mold')).toBe(1);
    // The mold is reused next time instead of planks.
    const id2 = h.base.add(piece(h, 'concrete_wall'), { axis: 'x', x: 1, z: 0 }, 0);
    h.hold('Hammer');
    holdE(h, id2, 2.6);
    expect(h.items.get('Concrete mold')).toBe(0);
  });

  it('door: frame, hang, then E opens and closes; an optional bolt slides to lock', () => {
    const h = fakeHost();
    const id = h.base.add(piece(h, 'door'), { axis: 'x', x: 0, z: 0 }, 0);
    const s = h.base.site(id)!;
    h.items.set('Plank', 3);
    h.items.set('Door', 1);
    h.hold('Hammer');
    holdE(h, id, 3.1);
    h.hold('');
    holdE(h, id, 2.6);
    expect(h.base.built(s)).toBe(true);
    expect(h.base.canOpen(s)).toBe(true);
    press(h, id);
    expect(s.open).toBe(true);
    expect(h.blockers.has(`${id}:leaf`)).toBe(false);
    press(h, id);
    expect(s.open).toBe(false);
    expect(h.blockers.has(`${id}:leaf`)).toBe(true);
    h.items.set('Bolt', 1);
    h.hold('Hammer');
    holdE(h, id, 1.6);
    expect(h.base.canLock(s)).toBe(true);
    h.hold('');
    press(h, id, 1, 'bolt');
    expect(s.locked).toBe(true);
    press(h, id);
    expect(s.open).toBe(false);
    expect(h.events.filter((e) => e.type === 'base.lock')).toHaveLength(1);
  });
});

describe('rooms and sealing', () => {
  it('flood fill finds an enclosed cell; any gap leaks to outside', () => {
    const e = (axis: 'x' | 'z', x: number, z: number, closed = true) => ({ axis, x, z, site: `${axis}${x}${z}`, closed });
    expect(findRooms([e('x', 0, 0), e('x', 0, 1), e('z', 0, 0)])).toEqual([]);
    const r = findRooms([e('x', 0, 0), e('x', 0, 1), e('z', 0, 0), e('z', 1, 0, false)]);
    expect(r).toHaveLength(1);
    expect(r[0]!.cells).toEqual([[0, 0]]);
    expect(r[0]!.sealed).toBe(false);
    expect(r[0]!.openings).toEqual(['z10']);
  });

  it('a room with a door is sealed only while the door is shut; a window needs shutters, shut', () => {
    const h = fakeHost();
    const { last } = room(h, 'door');
    const d = h.base.site(last)!;
    d.stage = 2;
    d.features.add('leaf');
    press(h, last);
    press(h, last);
    const r = () => h.base.roomAt([48, 10, 48]);
    expect(r()!.sealed).toBe(true);
    press(h, last);
    expect(r()!.sealed).toBe(false);
    expect(h.base.openings(r()!.id)).toEqual([{ site: last, kind: 'door', reason: 'open' }]);
    expect(h.events.filter((e) => e.type === 'base.sealed').map((e) => (e as { sealed: boolean }).sealed)).toEqual([true, false]);

    const w = fakeHost();
    const win = room(w, 'window').last;
    const ws = w.base.site(win)!;
    ws.stage = 1;
    w.base.press({ site: win, part: null, distance: 1 }, null, [48, 0, 48]);
    expect(w.base.roomAt([48, 10, 48])!.sealed).toBe(false);
    expect(w.base.openings(w.base.roomAt([48, 10, 48])!.id)[0]!.reason).toBe('no-cover');
    w.items.set('Shutters', 1);
    w.hold('Hammer');
    holdE(w, win, 2.1);
    w.hold('');
    expect(w.base.roomAt([48, 10, 48])!.sealed).toBe(true);
    w.base.press({ site: win, part: null, distance: 1 }, null, [48, 0, 48]);
    expect(w.base.roomAt([48, 10, 48])!.sealed).toBe(false);
  });
});

describe('comfort, sleep, the wedge, the knock', () => {
  function homely() {
    const h = fakeHost();
    const { last } = room(h, 'door');
    const d = h.base.site(last)!;
    d.stage = 2;
    d.features.add('leaf');
    h.base.press({ site: last, part: null, distance: 1 }, null, [48, 0, 48]);
    h.base.press({ site: last, part: null, distance: 1 }, null, [48, 0, 48]);
    return { h, door: last };
  }

  it('comfort comes from sealing, lights on and homely things inside; sleep needs enough', () => {
    const { h, door } = homely();
    const at = [48, 10, 48] as [number, number, number];
    const id = h.base.roomAt(at)!.id;
    expect(h.base.comfortOf(id)).toBeCloseTo(0.35);
    expect(h.base.canSleep(at).ok).toBe(false);
    h.sources.push({ id: 'lamp', at: [40, 30, 40], tags: [], components: ['light'], light: true });
    h.sources.push({ id: 'bed', at: [50, 10, 50], tags: ['bed'], components: [], light: null });
    h.sources.push({ id: 'far lamp', at: [900, 30, 40], tags: [], components: ['light'], light: true });
    h.advance(0.6);
    expect(h.base.comfortOf(id)).toBeCloseTo(0.65);
    expect(h.base.canSleep(at).ok).toBe(true);
    h.sources[0]!.light = false;
    h.base.press({ site: door, part: null, distance: 1 }, null, [48, 0, 48]);
    h.advance(0.6);
    expect(h.base.comfortOf(id)).toBeCloseTo(0.15);
    expect(h.base.canSleep(at).ok).toBe(false);
  });

  it('a chair wedges under a shut door, and now and then has slipped out on waking', () => {
    const { h, door } = homely();
    const s = h.base.site(door)!;
    const r = h.base.press({ site: door, part: null, distance: 1 }, 'chair1', [48, 0, 48]);
    expect(r!.wedged).toBe(true);
    expect(s.wedged).toBe('chair1');
    expect(h.pinned.has('chair1')).toBe(true);
    // Wedged: E pulls the chair away rather than opening.
    expect(h.base.prompt({ site: door, part: null, distance: 1 }, null)!.label).toMatch(/chair/);
    h.setRandom(0.5);
    expect(h.base.wake()).toEqual([]);
    h.setRandom(0.01);
    expect(h.base.wake()).toEqual([door]);
    expect(s.wedged).toBe(null);
    expect(h.events.some((e) => e.type === 'base.unwedged')).toBe(true);
  });

  it('the knock prefers a room with an unlocked door, knocking from outside', () => {
    const { h, door } = homely();
    expect(h.base.knock()).toBe(door);
    const k = h.events.find((e) => e.type === 'base.knock') as { at: number[] };
    expect(k.at[0]).toBeGreaterThan(G);
  });
});

describe('saving', () => {
  it('build sites, stage progress, cure timers, door, bolt and wedge come back', () => {
    const h = fakeHost();
    const c = h.base.add(piece(h, 'concrete_wall'), { axis: 'x', x: 3, z: 3 }, 0);
    const cs = h.base.site(c)!;
    cs.stage = 2;
    cs.waitLeft = 42;
    const { last } = room(h, 'door');
    const d = h.base.site(last)!;
    Object.assign(d, { stage: 3, open: false, locked: true, wedged: 'chair1' });
    d.features = new Set(['leaf', 'bolt']);
    const save = JSON.parse(JSON.stringify(h.base.save()));

    const h2 = fakeHost();
    h2.base.load(save);
    expect(h2.base.allSites()).toHaveLength(5);
    expect(h2.base.site(c)!.waitLeft).toBe(42);
    expect(h2.base.current(h2.base.site(c)!)!.id).toBe('cure');
    const d2 = h2.base.site(last)!;
    expect(d2.locked).toBe(true);
    expect(d2.wedged).toBe('chair1');
    expect(h2.pinned.has('chair1')).toBe(true);
    expect(h2.base.roomAt([48, 10, 48])!.sealed).toBe(true);
    // New sites don't reuse ids.
    expect(h2.base.add(piece(h2, 'door'), { axis: 'x', x: 9, z: 9 }, 0)).not.toBe(c);
  });
});

describe('in the game world', () => {
  const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
  const run = (w: GameWorld, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
  };

  function game(saved: unknown = null) {
    const s = newScene('base');
    s.entities = [brush('floor', [-2048, -16, -2048], [2048, 0, 2048]), newEntity('start', { playerSpawn: {} }, { position: [48, 0, 200] })];
    const w = GameWorld.create(s, { rules: { building: true, saveItems: true }, saved: saved as never });
    return w;
  }

  it('off unless the game has it', () => {
    const s = newScene('plain');
    expect(GameWorld.create(s).base).toBeNull();
  });

  it('a plan places a site on the floor; a finished wall blocks; progress saves on sleep only', () => {
    const w = game();
    w.giveItem('Wood wall plan', 1);
    w.setPlayerInput({ pitch: -0.6, yaw: 0 });
    run(w, 0.2);
    expect(w.base!.preview).not.toBeNull();
    expect(w.base!.preview!.y).toBeCloseTo(0, 0);
    w.useItem();
    expect(w.base!.allSites()).toHaveLength(1);
    w.giveItem('Wood wall plan', -1);
    w.setPlayerInput({ pitch: 0 });
    run(w, 0.05);
    expect(w.buildPrompt()!.label).toBe('Set the posts');
    expect(w.buildPrompt()!.missing).toMatch(/Wooden post/);
    const site = w.base!.allSites()[0]!;
    site.stage = site.def.stages.length;
    // (The site's own blockers: posts and boards are now fixed colliders.)
    (w.base as never as { changed(s: unknown): void }).changed(site);
    const before = w.progress();
    expect(before).toBeNull();
    w.sleep();
    const p = w.progress()!;
    expect(Object.keys(p.base!)).toEqual(['base']);
    const w2 = game(JSON.parse(JSON.stringify(p)));
    expect(w2.base!.allSites()).toHaveLength(1);
    expect(w2.base!.built(w2.base!.allSites()[0]!)).toBe(true);
  });
});
