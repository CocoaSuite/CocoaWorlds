import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { COLLIDER_MATERIAL, box, cylinder, defaultSurface, sphere, toData, type Brush } from '@cocoaworlds/geometry';
import { GameWorld, PLAYER, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const spawn = (at: Vec3 = [0, 0, 0], yawDeg = 0) => newEntity('start', { playerSpawn: {} }, { position: at, rotation: [0, yawDeg, 0] });
const floor = () => brush('floor', [-1024, -16, -1024], [1024, 0, 1024]);

function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('test');
  s.entities = entities;
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

describe('Player', () => {
  it('stands on the floor at the Player start, eyes at 64', () => {
    const w = GameWorld.create(scene(floor(), spawn([0, 0, 0])));
    run(w, 0.5);
    const v = w.playerView()!;
    expect(v.eye[1]).toBeCloseTo(PLAYER.eye, 0);
    expect(w.player!.onGround).toBe(true);
    w.dispose();
  });

  it('no Player start, no player', () => {
    const w = GameWorld.create(scene(floor()));
    expect(w.player).toBeNull();
    expect(w.playerView()).toBeNull();
    w.dispose();
  });

  it('runs at about 190 u/s and walks slower; stops with friction', () => {
    const w = GameWorld.create(scene(floor(), spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 1);
    expect(Math.hypot(w.player!.velocity.x, w.player!.velocity.z)).toBeCloseTo(PLAYER.runSpeed, -1);
    // Yaw 0 looks along −Z.
    expect(w.player!.feetPosition.z).toBeLessThan(-150);
    w.setPlayerInput({ walk: true });
    run(w, 1);
    expect(Math.hypot(w.player!.velocity.x, w.player!.velocity.z)).toBeCloseTo(PLAYER.walkSpeed, -1);
    w.setPlayerInput({ forward: 0 });
    run(w, 0.5);
    expect(Math.hypot(w.player!.velocity.x, w.player!.velocity.z)).toBe(0);
    w.dispose();
  });

  it('faces the way the Player start faces', () => {
    const w = GameWorld.create(scene(floor(), spawn([0, 0, 0], 90)));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.5);
    // Turned 90° left: forward is −X.
    expect(w.player!.feetPosition.x).toBeLessThan(-50);
    expect(Math.abs(w.player!.feetPosition.z)).toBeLessThan(5);
    w.dispose();
  });

  it('jumps about 45 u high, once per press', () => {
    const w = GameWorld.create(scene(floor(), spawn()));
    run(w, 0.3);
    w.setPlayerInput({ jump: true });
    let top = 0;
    for (let i = 0; i < 90; i++) {
      w.step(1 / 60);
      top = Math.max(top, w.player!.feetPosition.y);
    }
    expect(top).toBeGreaterThan(38);
    expect(top).toBeLessThan(50);
    // Still holding jump: no second jump.
    expect(w.player!.onGround).toBe(true);
    run(w, 0.5);
    expect(w.player!.feetPosition.y).toBeLessThan(2);
    w.dispose();
  });

  it('walks up a step of 16 but not a wall of 40', () => {
    const step = brush('step', [-64, 0, -200], [64, 16, -100]);
    const w = GameWorld.create(scene(floor(), step, spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.8);
    expect(w.player!.feetPosition.z).toBeLessThan(-110);
    expect(w.player!.feetPosition.y).toBeCloseTo(16.5, 0); // (the controller keeps a 0.5 u gap)
    w.dispose();

    const wall = brush('wall', [-64, 0, -200], [64, 40, -100]);
    const w2 = GameWorld.create(scene(floor(), wall, spawn()));
    run(w2, 0.2);
    w2.setPlayerInput({ forward: 1 });
    run(w2, 1);
    expect(w2.player!.feetPosition.y).toBeLessThan(2);
    // Stopped with the front of its box at the wall.
    expect(w2.player!.feetPosition.z).toBeGreaterThan(-100 + PLAYER.radius - 2);
    w2.dispose();
  });

  it('crouches under a low ceiling and cannot stand up there', () => {
    const roof = brush('roof', [-64, 50, -300], [64, 66, -100]);
    const w = GameWorld.create(scene(floor(), roof, spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1, crouch: true });
    run(w, 3);
    expect(w.player!.feetPosition.z).toBeLessThan(-150);
    w.setPlayerInput({ forward: 0, crouch: false });
    run(w, 0.2);
    expect(w.player!.crouched).toBe(true);
    w.dispose();
  });

  it('falls out of the world and starts again', () => {
    const w = GameWorld.create(scene(brush('ledge', [-64, -16, -64], [64, 0, 64]), spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1 });
    run(w, 6);
    w.setPlayerInput({ forward: 0 });
    // Back at the start at some point after the fall.
    expect(w.player!.feetPosition.y).toBeGreaterThan(-2048);
    w.dispose();
  });

  it('a zone that notices the player sees the player walk in', () => {
    const zone = brush('zone', [-64, 0, -300], [64, 100, -200], { trigger: { detects: 'player' } });
    const w = GameWorld.create(scene(floor(), zone, spawn()));
    const seen: string[] = [];
    w.bus.on('trigger.enter', (e) => seen.push(e.other));
    w.setPlayerInput({ forward: 1 });
    run(w, 1.5);
    expect(seen).toEqual(['player']);
    w.dispose();
  });

  it('Use runs “When the player uses this” on what the player looks at (and what it is inside)', () => {
    const door = brush('door', [-32, 0, -80], [32, 96, -64]);
    const group = newEntity('doorway', {
      group: {},
      script: {
        version: 1,
        variables: [],
        handlers: [{ id: 'h1', event: { id: 'e1', kind: 'use' }, body: [{ id: 's1', kind: 'log', text: { id: 'x1', kind: 'text', value: 'used' } }] }],
      },
    } as never);
    door.parent = group.id;
    const w = GameWorld.create(scene(floor(), group, door, spawn()));
    const uses: string[] = [];
    w.bus.on('use', (e) => uses.push(e.target));
    run(w, 0.3);
    w.use();
    run(w, 0.1);
    expect(uses).toEqual([door.id]);
    expect(w.drainLogs().map((l) => l.text)).toEqual(['used']);
    // Looking away: nothing in reach.
    w.setPlayerInput({ yaw: Math.PI });
    w.use();
    run(w, 0.1);
    expect(uses).toHaveLength(1);
    w.dispose();
  });
});

describe('COL', () => {
  it('the player stands on an invisible collider floor', () => {
    const s = newScene('t');
    s.entities = [
      newEntity('col', { brush: { role: 'solid', faces: toData(box([-256, -16, -256], [256, 0, 256], defaultSurface(COLLIDER_MATERIAL))).faces } as never }),
      newEntity('start', { playerSpawn: {} }),
    ];
    const w = GameWorld.create(s);
    run(w, 1);
    expect(w.player!.onGround).toBe(true);
    expect(w.player!.feetPosition.y).toBeGreaterThan(-1);
    w.dispose();
  });
});

describe('smoothness and grip', () => {
  /** Walk forward for `seconds`, recording horizontal speed and eye height at each physics step. */
  function walk(w: GameWorld, seconds: number) {
    const speed: number[] = [], eye: number[] = [];
    let prev = w.player!.feetPosition;
    w.setPlayerInput({ forward: 1 });
    for (let i = 0; i < seconds * 60; i++) {
      w.step(1 / 60);
      const f = w.player!.feetPosition;
      speed.push(Math.hypot(f.x - prev.x, f.z - prev.z) * 60);
      eye.push(w.player!.eye()[1]);
      prev = f;
    }
    return { speed, eye };
  }
  const stairs = (rise: number, depth: number) => {
    const out = [floor()];
    for (let i = 0; i < 8; i++) out.push(brush(`s${i}`, [-128, 0, -100 - (i + 1) * depth], [128, rise * (i + 1), -100 - i * depth]));
    out.push(brush('landing', [-128, 0, -1000], [128, rise * 8, -100 - 8 * depth]));
    return out;
  };

  for (const [rise, depth] of [
    [16, 32],
    [8, 12],
    [16, 16],
  ] as const) {
    it(`climbs ${rise}×${depth} stairs without slowing down, and the view rises smoothly`, () => {
      const w = GameWorld.create(scene(...stairs(rise, depth), spawn()));
      run(w, 0.3);
      const { speed, eye } = walk(w, 2);
      expect(w.player!.feetPosition.y).toBeGreaterThan(rise * 8 - 1);
      // Up to speed after the first few steps, then never stalled by a step: no frame under half speed, and
      // never two slow frames in a row.
      const steady = speed.slice(10, 110);
      expect(Math.min(...steady)).toBeGreaterThan(90);
      expect(steady.some((v, i) => i > 0 && v < 150 && steady[i - 1]! < 150)).toBe(false);
      // No jumps of a whole step in the view from one physics step to the next.
      const jumps = eye.slice(1).map((y, i) => Math.abs(y - eye[i]!));
      expect(Math.max(...jumps)).toBeLessThan(rise * 0.4);
      w.dispose();
    });
  }

  it('walks over seams between floor brushes without bobbing the view', () => {
    const w = GameWorld.create(
      scene(brush('a', [-512, -16, -512], [512, 0, -100]), brush('b', [-512, -16, -100], [512, 0, -60]), brush('c', [-512, -16, -60], [512, 0, 512]), spawn()),
    );
    run(w, 0.3);
    const { eye } = walk(w, 1.5);
    expect(Math.max(...eye) - Math.min(...eye)).toBeLessThan(0.75);
    w.dispose();
  });

  it('stops quickly: within about 0.2 s and 20 u from a run', () => {
    const w = GameWorld.create(scene(floor(), spawn()));
    run(w, 0.2);
    walk(w, 1);
    const z0 = w.player!.feetPosition.z;
    w.setPlayerInput({ forward: 0 });
    run(w, 0.25);
    const z1 = w.player!.feetPosition.z;
    run(w, 0.5);
    expect(Math.abs(w.player!.feetPosition.z - z1)).toBeLessThan(0.5);
    expect(Math.abs(z1 - z0)).toBeLessThan(20);
    w.dispose();
  });

  it('turns around quickly: running the other way within a quarter of a second', () => {
    const w = GameWorld.create(scene(floor(), spawn()));
    run(w, 0.2);
    walk(w, 1);
    w.setPlayerInput({ forward: -1 });
    run(w, 0.25);
    expect(w.player!.velocity.z).toBeGreaterThan(150);
    w.dispose();
  });

  it('crouch-walks at crouch speed', () => {
    const w = GameWorld.create(scene(floor(), spawn()));
    run(w, 0.2);
    w.setPlayerInput({ forward: 1, crouch: true });
    run(w, 1);
    expect(Math.hypot(w.player!.velocity.x, w.player!.velocity.z)).toBeGreaterThan(PLAYER.crouchSpeed - 4);
    w.dispose();
  });
});

describe('round things and moving things', () => {
  const round = (name: string, b: Brush) => newEntity(name, { brush: { role: 'solid', faces: toData(b).faces } as never });
  const trip = (obstacle: Brush, start: Vec3, seconds = 2.5) => {
    const w = GameWorld.create(scene(floor(), round('o', obstacle), spawn(start)));
    run(w, 0.3);
    w.setPlayerInput({ forward: 1 });
    let slowest = Infinity;
    for (let i = 0; i < seconds * 60; i++) {
      w.step(1 / 60);
      const v = w.player!.velocity;
      if (i > 30) slowest = Math.min(slowest, Math.hypot(v.x, v.z));
    }
    const end = w.player!.feetPosition;
    w.dispose();
    return { slowest, end };
  };

  for (const [label, make] of [
    ['a 16-sided pillar', () => cylinder([-48, 0, -248], [48, 128, -152], 16)],
    ['a 32-sided pillar', () => cylinder([-48, 0, -248], [48, 128, -152], 32)],
    ['a ball', () => sphere([-48, 0, -248], [48, 96, -152], 16)],
  ] as const)
    it(`walking into ${label} a little off centre slides round it instead of stopping`, () => {
      const { slowest, end } = trip(make(), [20, 0, 0]);
      expect(slowest).toBeGreaterThan(50);
      expect(end.z).toBeLessThan(-300);
      expect(end.y).toBeLessThan(3);
    });

  it('walks onto, across and off a platform that scripts can move (while it stands still)', () => {
    const plat = brush('plat', [-128, 0, -200], [128, 8, -100], { script: { version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'message', message: 'go' }, body: [{ id: 's', kind: 'hide', target: { self: true } }] }] } });
    const w = GameWorld.create(scene(floor(), plat, spawn()));
    run(w, 0.3);
    w.setPlayerInput({ forward: 1 });
    run(w, 1);
    expect(w.player!.feetPosition.y).toBeGreaterThan(7);
    run(w, 1);
    expect(w.player!.feetPosition.z).toBeLessThan(-280);
    expect(w.player!.feetPosition.y).toBeLessThan(1);
    w.dispose();
  });

  const lift = (seconds: number) =>
    brush('lift', [-64, 0, -64], [64, 8, 64], {
      script: {
        version: 1,
        variables: [],
        handlers: [
          {
            id: 'h',
            event: { id: 'e', kind: 'start' },
            body: [
              { id: 'w', kind: 'wait', seconds: { id: 'w1', kind: 'number', value: 0.5 } },
              { id: 'm', kind: 'move', target: { self: true }, direction: 'up', distance: { id: 'd', kind: 'number', value: 256 }, seconds: { id: 's1', kind: 'number', value: seconds } },
              { id: 'w2', kind: 'wait', seconds: { id: 'w3', kind: 'number', value: 0.5 } },
              { id: 'r', kind: 'return', target: { self: true }, seconds: { id: 's2', kind: 'number', value: seconds } },
            ],
          },
        ],
      },
    });

  it('on a lift the feet stay on it, going up and coming down, standing or crouched; no jumping while it moves', () => {
    for (const crouch of [false, true]) {
      const l = lift(1.5);
      const w = GameWorld.create(scene(floor(), l, spawn([0, 8, 0])));
      w.setPlayerInput({ crouch });
      let worst = 0, rode = 0;
      for (let i = 0; i < 4.5 * 60; i++) {
        // Trying to jump while it moves (up 0.5–2 s, down 2.5–4 s): that doesn't work.
        const moving = (i > 40 && i < 110) || (i > 160 && i < 230);
        w.setPlayerInput({ jump: moving && i % 20 < 10 });
        w.step(1 / 60);
        const top = w.positionOf(l.id)![1] + 4;
        if (i > 40) worst = Math.max(worst, Math.abs(w.player!.feetPosition.y - top));
        if (w.player!.riding) rode++;
      }
      expect(rode, crouch ? 'crouched' : 'standing').toBeGreaterThan(150);
      expect(worst, crouch ? 'crouched' : 'standing').toBeLessThan(2);
      w.dispose();
    }
  });

  it('can jump off a lift that stands still', () => {
    const l = lift(1.5);
    const w = GameWorld.create(scene(floor(), l, spawn([0, 8, 0])));
    run(w, 0.3);
    w.setPlayerInput({ jump: true });
    run(w, 0.2);
    expect(w.player!.feetPosition.y).toBeGreaterThan(30);
    w.dispose();
  });

  it('crouching right away, at 0,0 on a block (moving or not), stays on top of it', () => {
    for (const script of [undefined, { version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'message', message: 'x' }, body: [{ id: 's', kind: 'hide', target: { self: true } }] }] }]) {
      const block = brush('block', [-64, 0, -64], [64, 8, 64], script ? { script } : {});
      const w = GameWorld.create(scene(floor(), block, spawn([0, 8, 0])));
      w.setPlayerInput({ crouch: true });
      let low = Infinity;
      for (let i = 0; i < 60; i++) {
        w.step(1 / 60);
        low = Math.min(low, w.player!.feetPosition.y);
      }
      expect(low, script ? 'scripted block' : 'plain block').toBeGreaterThan(7.5);
      w.dispose();
    }
  });
});
