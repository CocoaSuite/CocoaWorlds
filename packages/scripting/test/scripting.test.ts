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

describe('health and score blocks', () => {
  it('hurt, heal and score reach the game; health and score can be read', () => {
    const calls: string[] = [];
    let health = 100;
    const s = script([
      handler(
        newEvent('start'),
        { ...newStatement('hurt'), amount: num(30) } as Statement,
        { ...newStatement('addScore'), amount: num(2) } as Statement,
        { ...newStatement('log'), text: { ...newExpr('join'), a: text('hp '), b: newExpr('health') } as Expr } as Statement,
      ),
      handler(newEvent('die'), { ...newStatement('log'), text: text('dead') } as Statement),
    ]);
    const r = compileScript('me', s, scene);
    expect(r.problems).toEqual([]);
    const log: string[] = [];
    const vm = new ScriptRunner([r.program], {
      now: () => 0,
      random: () => 0,
      nameOf: (id) => id,
      act: () => null,
      send: () => {},
      log: (t) => void log.push(t),
      game: (name, amount) => {
        calls.push(`${name} ${amount}`);
        if (name === 'hurt') health -= amount;
      },
      read: (name) => (name === 'health' ? health : 0),
    });
    vm.start();
    vm.dispatch({ type: 'die' });
    vm.tick(0.1);
    expect(calls).toEqual(['hurt 30', 'addScore 2']);
    expect(log).toEqual(['hp 70', 'dead']);
  });

  it('the amount must be a number', () => {
    const s = script([handler(newEvent('start'), { ...newStatement('heal'), amount: text('lots') } as Statement)]);
    expect(compileScript('me', s, scene).problems.map((p) => p.message)).toEqual(['Health changes by a number.']);
  });
});

describe('game values, messages and signs', () => {
  const host = () => {
    const globals = new Map<string, Value>([['Cash', 10]]);
    const said: string[] = [];
    const texts: string[] = [];
    return {
      globals,
      said,
      texts,
      h: {
        now: () => 0,
        random: () => 0,
        nameOf: (id: string) => id,
        act: () => null,
        send: () => {},
        log: () => {},
        getGlobal: (n: string) => globals.get(n) ?? null,
        setGlobal: (n: string, v: Value) => void globals.set(n, v),
        say: (t: string, s: number) => void said.push(`${t} ${s}`),
        setText: (id: string, t: string) => void texts.push(`${id}: ${t}`),
      },
    };
  };
  const info = { ...scene, globals: [{ name: 'Cash', type: 'number' as const }], signs: new Set(['door']) };

  it('scripts read and change game values; their own variable of the same name hides it', () => {
    const buy = script([
      handler(
        newEvent('start'),
        { ...newStatement('change', { variable: 'Cash' }), by: num(-3) } as Statement,
        { ...newStatement('say'), text: { ...newExpr('join'), a: text('Cash: '), b: variable('Cash') } as Expr, seconds: num(2) } as Statement,
        { ...newStatement('setText', { target: entity('door') }), text: variable('Cash') } as Statement,
      ),
    ]);
    const local = script([handler(newEvent('start'), { ...newStatement('change', { variable: 'Cash' }), by: num(100) } as Statement)], [{ name: 'Cash', type: 'number', initial: 0 }]);
    const a = compileScript('me', buy, info), b = compileScript('door', local, info);
    expect([...a.problems, ...b.problems]).toEqual([]);
    const { globals, said, texts, h } = host();
    const vm = new ScriptRunner([a.program, b.program], h);
    vm.start();
    expect(globals.get('Cash')).toBe(7);
    expect(vm.variables('door')).toEqual({ Cash: 100 });
    expect(said).toEqual(['Cash: 7 2']);
    expect(texts).toEqual(['door: 7']);
  });

  it('“Set the text of” needs a text sign; unknown game values are reported', () => {
    const s = script([
      handler(newEvent('start'), { ...newStatement('setText', { target: entity('zone') }), text: text('x') } as Statement, { ...newStatement('set', { variable: 'Gems' }), value: num(1) } as Statement),
    ]);
    expect(compileScript('me', s, info).problems.map((p) => p.message)).toEqual([
      'Doorway is not a text sign. Add a Text sign to it, or pick a sign.',
      'There is no variable called “Gems”.',
    ]);
  });
});

describe('while, “is inside” and messages that keep coming', () => {
  it('a while loop runs once a frame while its condition holds, then goes on', () => {
    const { host, runFor } = run(
      [
        [
          'me',
          script(
            [
              handler(newEvent('start'), {
                ...(newStatement('while') as Extract<Statement, { kind: 'while' }>),
                condition: { id: 'c', kind: 'compare', op: '<', a: variable('n'), b: num(3) },
                body: [{ id: 's', kind: 'change', variable: 'n', by: num(1) }, { id: 'l', kind: 'log', text: variable('n') }],
              }, { id: 'd', kind: 'log', text: text('done') }),
            ],
            [{ name: 'n', type: 'number', initial: 0 }],
          ),
        ],
      ],
      1,
    );
    runFor(1);
    // One turn of the loop per frame: 1 at the start, then 2 and 3 on the next frames.
    expect(host.log).toEqual(['0.0 1', '0.1 2', '0.2 3', '0.3 done']);
  });

  it('a while loop that never waits is not a problem', () => {
    const s = script([handler(newEvent('start'), { ...(newStatement('while') as Extract<Statement, { kind: 'while' }>), condition: { id: 'b', kind: 'boolean', value: true }, body: [] })]);
    expect(compileScript('me', s, scene).problems).toEqual([]);
  });

  it('“is inside” asks the game and must point at a zone', () => {
    const inside = newExpr('inside') as Extract<Expr, { kind: 'inside' }>;
    const bad = script([handler(newEvent('start'), { id: 'i', kind: 'if', condition: { ...inside, zone: entity('door') }, then: [], otherwise: null })]);
    expect(compileScript('me', bad, scene).problems.map((p) => p.message)).toEqual(['Main door is not a trigger zone.']);
    const good = script([handler(newEvent('start'), { id: 'i', kind: 'if', condition: { ...inside, zone: entity('zone') }, then: [{ id: 'l', kind: 'log', text: text('in') }], otherwise: null })]);
    const r = compileScript('me', good, scene);
    expect(r.problems).toEqual([]);
    const asked: string[] = [];
    const logs: string[] = [];
    const vm = new ScriptRunner([r.program], {
      now: () => 0,
      random: () => 0,
      nameOf: (x) => x,
      act: () => null,
      send: () => {},
      log: (t) => void logs.push(t),
      isInside: (zone, what) => (asked.push(`${what} in ${zone}`), true),
    });
    vm.start();
    expect(asked).toEqual(['player in zone']);
    expect(logs).toEqual(['in']);
  });

  it('a message sent every frame starts “When I get” once, and “stops coming” after it stops', () => {
    const sender = script(
      [
        handler(newEvent('start'), {
          ...(newStatement('while') as Extract<Statement, { kind: 'while' }>),
          condition: { id: 'c', kind: 'compare', op: '<', a: { id: 't', kind: 'time' }, b: num(1) },
          body: [{ id: 's', kind: 'send', message: 'open', to: null }],
        }),
      ],
    );
    const door = script([
      handler(newEvent('message'), { id: 'a', kind: 'log', text: text('open') }),
      handler({ ...newEvent('messageStop'), message: 'open' } as Handler['event'], { id: 'b', kind: 'log', text: text('shut') }),
    ]);
    const { host, runFor } = run([['me', sender], ['door', door]]);
    runFor(2);
    expect(host.sent.length).toBeGreaterThan(5);
    expect(host.log).toEqual(['0.1 open', '1.1 shut']);
  });

  it('messages with a break between them each start “When I get”', () => {
    const sender = script([handler({ ...newEvent('every'), seconds: num(0.5) } as Handler['event'], { id: 's', kind: 'send', message: 'open', to: null })]);
    const door = script([handler(newEvent('message'), { id: 'a', kind: 'log', text: text('open') })]);
    const { host, runFor } = run([['me', sender], ['door', door]]);
    runFor(1.6);
    expect(host.log).toEqual(['0.6 open', '1.1 open', '1.6 open']);
  });
});

describe('creatures: the player coming near and going away', () => {
  const self = { self: true } as const;
  const s: Script = {
    version: 1,
    variables: [],
    handlers: [
      { id: 'n', event: { id: 'ne', kind: 'near', distance: num(160) }, body: [{ id: 'nl', kind: 'log', text: text('near') }] },
      { id: 'f', event: { id: 'fe', kind: 'far', distance: num(400) }, body: [{ id: 'fl', kind: 'log', text: text('far') }] },
      { id: 'r', event: { id: 're', kind: 'hit' }, body: [{ id: 'rs', kind: 'runAway', target: self, seconds: num(2) }, { id: 'rw', kind: 'wander', target: self, on: false }] },
    ],
  };

  it('start once on crossing the distance, not every frame', () => {
    let d = 300;
    const log: string[] = [];
    const vm = new ScriptRunner([compileScript('hen', s, scene).program], { now: () => 0, random: () => 0, nameOf: (x) => x, act: () => null, send: () => {}, log: (t) => void log.push(t), distance: () => d });
    vm.start();
    const tick = (n = 3) => { for (let i = 0; i < n; i++) vm.tick(0.1); };
    tick();
    expect(log).toEqual([]);
    d = 100;
    tick();
    d = 250;
    tick();
    d = 120;
    tick();
    expect(log).toEqual(['near', 'near']);
    d = 500;
    tick();
    d = 450;
    tick();
    expect(log).toEqual(['near', 'near', 'far']);
  });

  it('run away and wander are creature actions; distance is a number', () => {
    const acts: string[] = [];
    const vm = new ScriptRunner([compileScript('hen', s, scene).program], { now: () => 0, random: () => 0, nameOf: (x) => x, act: (name, target, args) => (acts.push(`${name} ${target} ${args.join(',')}`), null), send: () => {}, log: () => {}, distance: () => 300 });
    vm.start();
    vm.dispatch({ type: 'hit', targets: ['hen'] });
    vm.tick(0.1);
    expect(acts).toEqual(['runAway hen 2', 'wander hen false']);
    const bad: Script = { version: 1, variables: [], handlers: [{ id: 'x', event: { id: 'xe', kind: 'near', distance: num(0) }, body: [] }] };
    expect(compileScript('hen', bad, scene).problems.map((p) => p.message)).toEqual(['The distance needs to be a number above 0.']);
    const sum: Script = { version: 1, variables: [], handlers: [{ id: 'y', event: { id: 'ye', kind: 'start' }, body: [{ id: 'yl', kind: 'log', text: { id: 'm', kind: 'maths', op: '+', a: { id: 'dd', kind: 'distance', from: { player: true }, to: self }, b: num(1) } }] }] };
    expect(compileScript('hen', sum, scene).problems).toEqual([]);
  });
});

describe('do one of these at random', () => {
  it('runs exactly one choice, picked by the random number, then carries on', () => {
    const log = (t: string) => ({ id: t, kind: 'log', text: text(t) }) as Statement;
    const s = script([handler(newEvent('start'), { id: 'r', kind: 'oneOf', options: [[log('a')], [log('b')], [log('c')]] }, log('after'))]);
    // (The fake's random is 0.5: the middle of three.)
    const { host, runFor } = run([['me', s]]);
    runFor(0.2);
    expect(host.log.map((l) => l.split(' ')[1])).toEqual(['b', 'after']);
  });
});
