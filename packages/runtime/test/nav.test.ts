// A2: navigation — standing spots measured from the level, paths round walls, creatures that find their way.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { NOGRASS_MATERIAL, box, defaultSurface, toData } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3): EntityData => newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never });
const floor = () => brush('floor', [-800, -16, -800], [800, 0, 800]);
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}

describe('navigation', () => {
  it('finds every floor in a column and keeps a creature’s width from walls', () => {
    const w = GameWorld.create(scene(floor(), brush('deck', [0, 200, 0], [400, 216, 400]), brush('wall', [-400, 0, -200], [-384, 160, 200])));
    const nav = w.navigation()!;
    expect(nav.count).toBeGreaterThan(1000);
    const ys = new Set<number>();
    let nearWall = 0;
    for (let s = 0; s < nav.count; s++) {
      const x = nav.xyz[s * 3]!, y = nav.xyz[s * 3 + 1]!, z = nav.xyz[s * 3 + 2]!;
      ys.add(Math.round(y));
      if (y < 1 && x > -400 - 15 && x < -384 + 15 && Math.abs(z) < 190) nearWall++;
    }
    expect(ys.has(0) && ys.has(216)).toBe(true);
    expect(nearWall).toBe(0);
    w.dispose();
  });

  it('a path goes round a wall through the gap, and none leads into a closed room', () => {
    const wall = brush('wall', [-800, 0, -8], [400, 160, 8]);
    const room = [brush('n', [500, 0, 500], [700, 160, 516]), brush('s', [500, 0, 684], [700, 160, 700]), brush('w', [500, 0, 500], [516, 160, 700]), brush('e', [684, 0, 500], [700, 160, 700])];
    const w = GameWorld.create(scene(floor(), wall, ...room));
    const nav = w.navigation()!;
    const p = nav.path({ x: 0, y: 0, z: -300 }, { x: 0, y: 0, z: 300 })!;
    expect(p).not.toBeNull();
    expect(Math.max(...p.map((v) => v.x))).toBeGreaterThan(400);
    expect(p[p.length - 1]).toEqual({ x: 0, y: 0, z: 300 });
    // (Straightened: a few corners, not a step per spot.)
    expect(p.length).toBeLessThan(6);
    const inside = nav.path({ x: 0, y: 0, z: 300 }, { x: 600, y: 0, z: 600 });
    expect(inside === null || Math.hypot(inside[inside.length - 1]!.x - 600, inside[inside.length - 1]!.z - 600) > 60).toBe(true);
    w.dispose();
  });

  it('a creature walks out of a dead-end pocket and round to where it is sent', () => {
    const pocket = [brush('back', [-200, 0, -100], [200, 160, -84]), brush('left', [-216, 0, -400], [-200, 160, -84]), brush('right', [200, 0, -400], [216, 160, -84])];
    const c = newEntity('walker', { npc: { side: 'neutral', speed: 220 } }, { position: [0, 0, -200] });
    const w = GameWorld.create(scene(floor(), ...pocket, c));
    const npc = (w as unknown as { npcs: Map<string, { walkTo(to: { x: number; y: number; z: number }): () => boolean }> }).npcs.get(c.id)!;
    const done = npc.walkTo({ x: 0, y: 0, z: 300 });
    for (let t = 0; t < 12 && !done(); t += 1 / 60) w.step(1 / 60);
    expect(done()).toBe(true);
    const feet = w.npcStates().find((n) => n.id === c.id)!.feet;
    expect(Math.hypot(feet[0], feet[2] - 300)).toBeLessThan(10);
    w.dispose();
  });
});

it('a NOGRASS brush collides with nothing and is not part of the level', () => {
  const clear = newEntity('clearing', { brush: { role: 'solid', faces: toData(box([-64, 0, -64], [64, 4, 64], defaultSurface(NOGRASS_MATERIAL))).faces } as never });
  const f = floor();
  const w = GameWorld.create(scene(f, clear));
  expect(w.levelIds.has(f.id)).toBe(true);
  expect(w.levelIds.has(clear.id)).toBe(false);
  // Nothing to stand on over it but the floor itself.
  const nav = w.navigation()!;
  const s = nav.nearest({ x: 0, y: 10, z: 0 });
  expect(nav.xyz[s * 3 + 1]).toBeCloseTo(0, 1);
  w.dispose();
});
