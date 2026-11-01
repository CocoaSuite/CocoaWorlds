import { describe, expect, it } from 'vitest';
import {
  STEP_BUDGET,
  ScriptRunner,
  compileScript,
  entity,
  newEvent,
  newExpr,
  newStatement,
  num,
  other,
  self,
  text,
  variable,
  type ActionName,
  type Expr,
  type Handler,
  type Script,
  type SceneInfo,
  type Statement,
  type Value,
} from '../src';

const scene: SceneInfo = {
  objects: new Map([
    ['door', { name: 'Main door', isZone: false }],
    ['zone', { name: 'Doorway', isZone: true }],
    ['me', { name: 'Lever', isZone: false }],
  ]),
};

const handler = (event: Handler['event'], ...body: Statement[]): Handler => ({ id: Math.random().toString(36).slice(2), event, body });
const script = (handlers: Handler[], variables: Script['variables'] = []): Script => ({ version: 1, variables, handlers });

/** A fake game: actions take the time they ask for; everything is recorded. */
class Fake {
  t = 0;
  log: string[] = [];
  acts: string[] = [];
  sent: { message: string; to: string | null; from: string }[] = [];
  now = () => this.t;
  random = () => 0.5;
  nameOf = (id: string) => scene.objects.get(id)?.name ?? id;
  act = (name: ActionName, target: string, args: Value[]) => {
    this.acts.push(`${name} ${target} ${JSON.stringify(args)}`);
    const seconds = Number(args[args.length - 1]);
    if (['move', 'turn', 'return'].includes(name) && seconds > 0) {
      const end = this.t + seconds;
      return () => this.t >= end;
    }
    return null;
  };
  send = (message: string, to: string | null, from: string) => void this.sent.push({ message, to, from });
}

function run(scripts: [string, Script][], until = 10, dt = 0.1) {
  const host = new Fake();
  const programs = scripts.map(([owner, s]) => {
    const r = compileScript(owner, s, scene);
    expect(r.problems.filter((p) => p.severity === 'error')).toEqual([]);
    return r.program;
  });
  const vm = new ScriptRunner(programs, {
    now: host.now,
    random: host.random,
    nameOf: host.nameOf,
    act: host.act,
    send: (m, to, from) => {
      host.send(m, to, from);
      vm.dispatch({ type: 'message', message: m, to, from });
    },
    log: (t) => void host.log.push(`${host.t.toFixed(1)} ${t}`),
  });
  vm.start();
  const step = () => {
    host.t = Math.round((host.t + dt) * 1000) / 1000;
    vm.tick(dt);
  };
  return { host, vm, step, runFor: (s: number) => { for (let i = 0; i < Math.round(s / dt); i++) step(); }, until };
}

describe('scripts run in plain order and can wait', () => {
  it('start, wait, log, maths, join', () => {
    const s = script(
      [
        handler(
          newEvent('start'),
          { ...newStatement('log'), text: text('hello') } as Statement,
          { ...newStatement('wait'), seconds: num(0.5) } as Statement,
          { ...newStatement('change', { variable: 'score' }), by: num(5) } as Statement,
          { ...newStatement('log'), text: { ...newExpr('join'), a: text('score '), b: variable('score') } as Expr } as Statement,
        ),
      ],
      [{ name: 'score', type: 'number', initial: 10 }],
    );
    const { host, vm, runFor } = run([['me', s]]);
    expect(host.log).toEqual(['0.0 hello']);
    runFor(0.6);
    expect(host.log).toEqual(['0.0 hello', '0.5 score 15']);
    expect(vm.variables('me')).toEqual({ score: 15 });
    expect(vm.threadCount).toBe(0);
  });

  it('a door opens when something enters the zone, waits, and closes; it cannot open twice at once', () => {
    const s = script([
      handler(
        newEvent('enter', entity('zone')),
        { ...newStatement('move', { target: entity('door') }), distance: num(128), seconds: num(1) } as Statement,
        { ...newStatement('wait'), seconds: num(2) } as Statement,
        { ...newStatement('return', { target: entity('door') }), seconds: num(1) } as Statement,
      ),
    ]);
    const { host, vm, runFor } = run([['me', s]]);
    vm.dispatch({ type: 'enter', zone: 'zone', other: 'crate' });
    runFor(0.1);
    vm.dispatch({ type: 'enter', zone: 'zone', other: 'crate2' }); // still running: ignored
    runFor(5);
    expect(host.acts).toEqual(['move door [128,0,1,0,1]', 'return door [1]']);
    expect(vm.threadCount).toBe(0);
    vm.dispatch({ type: 'enter', zone: 'zone', other: 'crate' });
    runFor(0.1);
    expect(host.acts).toHaveLength(3);
  });

  it('“the thing that entered” is the object that set off the zone', () => {
    const s = script([handler(newEvent('enter', self), newStatement('hide', { target: other }))]);
    const { host, vm, runFor } = run([['zone', s]]);
    vm.dispatch({ type: 'enter', zone: 'zone', other: 'coin' });
    runFor(0.1);
    expect(host.acts).toEqual(['hide coin []']);
  });

  it('if / otherwise, repeat, and messages between objects', () => {
    const lever = script(
      [
        handler(
          newEvent('start'),
          { ...newStatement('repeat'), times: num(3), body: [{ ...newStatement('change', { variable: 'n' }), by: num(1) } as Statement] } as Statement,
          {
            ...newStatement('if'),
            condition: { ...newExpr('compare'), op: '=', a: variable('n'), b: num(3) } as Expr,
            then: [{ ...newStatement('send'), message: 'open', to: entity('door') } as Statement],
            otherwise: [{ ...newStatement('log'), text: text('wrong') } as Statement],
          } as Statement,
        ),
      ],
      [{ name: 'n', type: 'number', initial: 0 }],
    );
    const door = script([handler({ ...newEvent('message'), message: 'open' } as Handler['event'], { ...newStatement('log'), text: text('opening') } as Statement)]);
    const { host, runFor } = run([
      ['me', lever],
      ['door', door],
    ]);
    runFor(0.2);
    expect(host.sent).toEqual([{ message: 'open', to: 'door', from: 'me' }]);
    expect(host.log.map((l) => l.slice(4))).toEqual(['opening']);
  });

  it('every N seconds', () => {
    const s = script([handler({ ...newEvent('every'), seconds: num(1) } as Handler['event'], { ...newStatement('log'), text: text('tick') } as Statement)]);
    const { host, runFor } = run([['me', s]]);
    runFor(3.05);
    expect(host.log).toHaveLength(3);
  });

  it('random whole numbers stay whole', () => {
    const s = script(
      [handler(newEvent('start'), { ...newStatement('set', { variable: 'd' }), value: { ...newExpr('random'), min: num(1), max: num(6) } as Expr } as Statement)],
      [{ name: 'd', type: 'number', initial: 0 }],
    );
    const { vm } = run([['me', s]]);
    expect(vm.variables('me').d).toBe(4); // 1 + floor(0.5 × 6)
  });
});

describe('safety', () => {
  it('a loop that never waits is stopped and reported; other scripts keep running', () => {
    const bad = script([handler(newEvent('start'), { ...newStatement('forever'), body: [{ ...newStatement('change', { variable: 'n' }), by: num(1) } as Statement] } as Statement)], [
      { name: 'n', type: 'number', initial: 0 },
    ]);
    const good = script([handler({ ...newEvent('every'), seconds: num(0.5) } as Handler['event'], { ...newStatement('log'), text: text('alive') } as Statement)]);
    const r = compileScript('me', bad, scene);
    expect(r.problems.map((p) => p.severity)).toEqual(['warning']);
    const { host, vm, runFor } = run([
      ['me', bad],
      ['door', good],
    ]);
    runFor(1.05);
    expect(vm.errors).toHaveLength(1);
    expect(vm.errors[0]!.message).toMatch(/without waiting/);
    // Five instructions per pass: the loop ran about STEP_BUDGET / 5 times before it was stopped.
    expect(vm.variables('me').n).toBe(STEP_BUDGET / 5);
    expect(host.log.length).toBe(2);
  });

  it('a loop with a wait inside runs forever without trouble', () => {
    const s = script([
      handler(newEvent('start'), {
        ...newStatement('forever'),
        body: [{ ...newStatement('change', { variable: 'n' }), by: num(1) } as Statement, { ...newStatement('wait'), seconds: num(0.1) } as Statement],
      } as Statement),
    ], [{ name: 'n', type: 'number', initial: 0 }]);
    const { vm, runFor } = run([['me', s]]);
    runFor(2);
    expect(vm.errors).toEqual([]);
    expect(vm.variables('me').n).toBeGreaterThan(15);
  });

  it('division by zero stops only that stack', () => {
    const s = script([handler(newEvent('start'), { ...newStatement('log'), text: { ...newExpr('maths'), op: '÷', a: num(1), b: num(0) } as Expr } as Statement)]);
    const { vm } = run([['me', s]]);
    expect(vm.errors[0]!.message).toBe('Division by zero.');
  });
});

describe('the checker speaks plainly and points at the block', () => {
  const problems = (s: Script, owner = 'me') => compileScript(owner, s, scene).problems.map((p) => p.message);

  it('missing objects, non-zones, and misplaced “thing that entered”', () => {
    expect(problems(script([handler(newEvent('enter', entity('door')))]))).toEqual(['Main door is not a trigger zone.']);
    expect(problems(script([handler(newEvent('start'), newStatement('hide', { target: entity('gone') }))]))).toEqual([
      'The object this block points at no longer exists. Pick another one.',
    ]);
    expect(problems(script([handler(newEvent('start'), newStatement('hide', { target: other }))]))[0]).toMatch(/only works inside/);
    expect(problems(script([handler(newEvent('enter', self))]))[0]).toMatch(/not a trigger zone/);
  });

  it('variables and types', () => {
    expect(problems(script([handler(newEvent('start'), newStatement('change', { variable: 'x' }))]))).toEqual(['There is no variable called “x”.']);
    const flag = [{ name: 'open', type: 'boolean' as const, initial: false }];
    expect(problems(script([handler(newEvent('start'), newStatement('change', { variable: 'open' }))], flag))[0]).toMatch(/Only number variables/);
    expect(problems(script([handler(newEvent('start'), { ...newStatement('if'), condition: num(1) } as Statement)]))[0]).toMatch(/yes-or-no/);
    expect(problems(script([handler(newEvent('start'), { ...newStatement('wait'), seconds: text('soon') } as Statement)]))).toEqual(['Wait needs a number of seconds.']);
  });

  it('a stack with an error is left out; the others still compile', () => {
    const s = script([handler(newEvent('start'), newStatement('hide', { target: entity('gone') })), handler(newEvent('start'), newStatement('stop'))]);
    const r = compileScript('me', s, scene);
    expect(r.program.handlers).toHaveLength(1);
    expect(r.problems[0]!.block).toBe(s.handlers[0]!.body[0]!.id);
  });
});

describe('turn', () => {
  it('passes the axis, angle and time to the game', () => {
    const s = script([handler(newEvent('start'), { ...newStatement('turn', { target: entity('door') }), axis: 'north', degrees: num(45), seconds: num(0) } as Statement)]);
    const { host } = run([['me', s]]);
    expect(host.acts).toEqual(['turn door ["north",45,0]']);
  });
});
