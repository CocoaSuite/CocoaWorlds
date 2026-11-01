// A tiny tycoon, the Basic benchmark's first target: income over time, a buy pad that checks the cash, a
// price sign that changes, a message when you can't afford it.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type SceneFile, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { blockId, newExpr, newStatement, num, text, variable, type Expr, type Handler, type Statement } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const brush = (name: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}): EntityData =>
  newEntity(name, { brush: { role: 'solid', faces: toData(box(min, max)).faces } as never, ...extra });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};
function scene(...entities: EntityData[]): SceneFile {
  const s = newScene('tycoon');
  s.entities = entities;
  return s;
}
const h = (event: Handler['event'], ...body: Statement[]): Handler => ({ id: blockId(), event, body });
const st = <T extends Statement['kind']>(kind: T, patch: Record<string, unknown>, target?: string) =>
  ({ ...newStatement(kind, target ? { target: { entity: target } } : {}), ...patch }) as Statement;

describe('tycoon (game values, messages, signs)', () => {
  it('earn, fail to buy, earn more, buy', () => {
    const wall = brush('wall', [-64, 0, -400], [64, 128, -384]);
    const sign = newEntity('price', { sign: { text: 'Wall: $10', size: 16, color: '#fff', background: true, faceCamera: false } }, { position: [0, 64, -200] });
    const pad = brush('pad', [-32, 0, -160], [32, 4, -96], { trigger: { detects: 'player', once: false } });
    const cashAtLeast = (n: number): Expr => ({ ...newExpr('compare'), op: '≥', a: variable('Cash'), b: num(n) }) as Expr;
    const logic = newEntity('logic', {
      script: {
        version: 1,
        variables: [{ name: 'bought', type: 'boolean', initial: false }],
        handlers: [
          h({ id: blockId(), kind: 'start' }, st('hide', {}, wall.id)),
          h({ id: blockId(), kind: 'every', seconds: num(1) }, st('change', { variable: 'Cash', by: num(5) })),
          h(
            { id: blockId(), kind: 'enter', zone: { entity: pad.id } },
            {
              id: blockId(),
              kind: 'if',
              condition: { ...newExpr('logic'), op: 'and', a: { ...newExpr('not'), a: variable('bought') }, b: cashAtLeast(10) } as Expr,
              then: [
                st('set', { variable: 'bought', value: { id: blockId(), kind: 'boolean', value: true } }),
                st('change', { variable: 'Cash', by: num(-10) }),
                st('show', {}, wall.id),
                st('setText', { text: text('Sold') }, sign.id),
              ],
              otherwise: [st('say', { text: text('Need $10'), seconds: num(2) })],
            },
          ),
        ],
      } as never,
    });
    const w = GameWorld.create(scene(brush('floor', [-1024, -16, -1024], [1024, 0, 1024]), newEntity('start', { playerSpawn: {} }), wall, sign, pad, logic), {
      values: [{ name: 'Cash', type: 'number', initial: 0, show: true }],
    });
    expect(w.scriptProblems).toEqual([]);
    run(w, 0.1);
    expect(w.isVisible(wall.id)).toBe(false);
    expect(w.signText(sign.id)).toBe('Wall: $10');

    // Straight onto the pad with $0 (well, $0 before the first second): too poor.
    w.setPlayerInput({ forward: 1 });
    run(w, 0.6);
    w.setPlayerInput({ forward: 0 });
    run(w, 0.1);
    expect(w.screenMessages()).toEqual(['Need $10']);
    expect(w.isVisible(wall.id)).toBe(false);

    // Off the pad, earn, back on.
    w.setPlayerInput({ forward: -1 });
    run(w, 0.8);
    w.setPlayerInput({ forward: 0 });
    run(w, 2.5);
    // Four seconds in: $20.
    expect(w.gameValues()).toEqual([{ name: 'Cash', value: 20, show: true }]);
    w.setPlayerInput({ forward: 1 });
    run(w, 0.8);
    w.setPlayerInput({ forward: 0 });
    run(w, 0.1);
    expect(w.isVisible(wall.id)).toBe(true);
    expect(w.signText(sign.id)).toBe('Sold');
    // $20 − $10, plus whatever came in on the way (a second at most).
    expect([10, 15]).toContain(w.gameValues()[0]!.value);
    // The message has gone by now.
    run(w, 2);
    expect(w.screenMessages()).toEqual([]);
    w.dispose();
  });
});
