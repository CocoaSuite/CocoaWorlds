/**
 * Recipes (V2): ready-made scripts for common mechanics. A recipe builds ordinary blocks (and, when it needs
 * one, describes a trigger zone for the editor to create), so the result can be read and changed like any
 * script the user wrote. Recipes never add special blocks of their own.
 */
import { blockId, type EventBlock, type Expr, type Handler, type Statement, type VariableDef } from './model';
import { bool, num, self, text, variable } from './factory';

type L = { en: string; ru: string };
type V3 = [number, number, number];

/** The object the recipe goes on. */
export interface RecipeTarget {
  id: string;
  name: string;
  /** World-space bounds of the object and everything inside it. */
  min: V3;
  max: V3;
}

/** A trigger zone the editor creates for the recipe, as a world-space box. */
export interface RecipeZone {
  name: string;
  min: V3;
  max: V3;
  detects: 'player' | 'physics' | 'anything';
  once: boolean;
}

export interface RecipeOutput {
  handlers: Handler[];
  variables: VariableDef[];
}

export interface Recipe {
  id: string;
  name: L;
  description: L;
  group: 'doors' | 'moving' | 'gameplay';
  /** The zone this recipe needs, worked out from the object's bounds. */
  zone?: (t: RecipeTarget) => RecipeZone;
  /** The blocks. `zone` is the id of the zone the editor created (when the recipe asked for one). */
  build: (t: RecipeTarget, zone: string | null) => RecipeOutput;
}

const id = blockId;
const height = (t: RecipeTarget) => Math.max(1, Math.round(t.max[1] - t.min[1]));
const handler = (event: EventBlock, body: Statement[]): Handler => ({ id: id(), event, body });
const ev = {
  start: (): EventBlock => ({ id: id(), kind: 'start' }),
  use: (): EventBlock => ({ id: id(), kind: 'use' }),
  enter: (zone: string): EventBlock => ({ id: id(), kind: 'enter', zone: { entity: zone } }),
  leave: (zone: string): EventBlock => ({ id: id(), kind: 'leave', zone: { entity: zone } }),
  message: (message: string): EventBlock => ({ id: id(), kind: 'message', message }),
};
const st = {
  moveUp: (distance: number, seconds: number): Statement => ({ id: id(), kind: 'move', target: self, direction: 'up', distance: num(distance), seconds: num(seconds) }),
  return: (seconds: number): Statement => ({ id: id(), kind: 'return', target: self, seconds: num(seconds) }),
  turn: (degrees: number, seconds: number): Statement => ({ id: id(), kind: 'turn', target: self, axis: 'up', degrees: num(degrees), seconds: num(seconds) }),
  wait: (seconds: number): Statement => ({ id: id(), kind: 'wait', seconds: num(seconds) }),
  hide: (): Statement => ({ id: id(), kind: 'hide', target: self }),
  show: (): Statement => ({ id: id(), kind: 'show', target: self }),
  log: (s: string): Statement => ({ id: id(), kind: 'log', text: text(s) }),
  send: (message: string): Statement => ({ id: id(), kind: 'send', message, to: null }),
  set: (name: string, value: boolean): Statement => ({ id: id(), kind: 'set', variable: name, value: bool(value) }),
  forever: (body: Statement[]): Statement => ({ id: id(), kind: 'forever', body }),
  hurt: (amount: number): Statement => ({ id: id(), kind: 'hurt', amount: num(amount) }),
  heal: (amount: number): Statement => ({ id: id(), kind: 'heal', amount: num(amount) }),
  score: (amount: number): Statement => ({ id: id(), kind: 'addScore', amount: num(amount) }),
  stop: (): Statement => ({ id: id(), kind: 'stop' }),
};
const isNot = (name: string): Expr => ({ id: id(), kind: 'not', a: variable(name) });

/** A box around the object, grown sideways by `side` and up by `up`. */
function around(t: RecipeTarget, side: number, up = 0, down = 0): { min: V3; max: V3 } {
  return { min: [t.min[0] - side, t.min[1] - down, t.min[2] - side], max: [t.max[0] + side, t.max[1] + up, t.max[2] + side] };
}

export const RECIPES: Recipe[] = [
  {
    id: 'door-near',
    group: 'doors',
    name: { en: 'Door that opens when the player comes near', ru: 'Дверь, которая открывается, когда игрок рядом' },
    description: {
      en: 'Adds a zone around the door. The door slides up when the player walks in and comes back down when they leave.',
      ru: 'Добавляет зону вокруг двери. Дверь уезжает вверх, когда игрок входит, и возвращается, когда выходит.',
    },
    zone: (t) => ({ name: `${t.name}_zone`, ...around(t, 96), detects: 'player', once: false }),
    build: (t, zone) => ({
      variables: [],
      handlers: [handler(ev.enter(zone!), [st.moveUp(height(t), 0.6)]), handler(ev.leave(zone!), [st.return(0.6)])],
    }),
  },
  {
    id: 'door-use',
    group: 'doors',
    name: { en: 'Door that opens when used (E)', ru: 'Дверь, которая открывается по E' },
    description: {
      en: 'The player looks at the door and presses E: it slides up, stays open for 3 seconds, then closes by itself.',
      ru: 'Игрок смотрит на дверь и нажимает E — она уезжает вверх, остаётся открытой 3 секунды и закрывается сама.',
    },
    build: (t) => ({
      variables: [{ name: 'open', type: 'boolean', initial: false }],
      handlers: [
        handler(ev.use(), [
          {
            id: id(),
            kind: 'if',
            condition: { id: id(), kind: 'not', a: variable('open') },
            // (An open door is out of reach above the player, so it closes by itself.)
            then: [st.set('open', true), st.moveUp(height(t), 0.6), st.wait(3), st.return(0.6), st.set('open', false)],
            otherwise: null,
          },
        ]),
      ],
    }),
  },
  {
    id: 'open-on-message',
    group: 'doors',
    name: { en: 'Opens when it gets the message “open”', ru: 'Открывается по сообщению «open»' },
    description: {
      en: 'Slides up when any script sends the message “open” (for example a button). Pair it with “Button”.',
      ru: 'Уезжает вверх, когда любой скрипт отправляет сообщение «open» (например, кнопка). Используйте вместе с «Кнопкой».',
    },
    build: (t) => ({ variables: [], handlers: [handler(ev.message('open'), [st.moveUp(height(t), 1)])] }),
  },
  {
    id: 'button',
    group: 'gameplay',
    name: { en: 'Button that sends “open” when used (E)', ru: 'Кнопка, отправляющая «open» по E' },
    description: {
      en: 'Press E on it to send the message “open” to everything. Doors with “Opens when it gets the message” react.',
      ru: 'Нажмите E на ней, чтобы отправить всем сообщение «open». Двери с рецептом «Открывается по сообщению» откроются.',
    },
    build: () => ({ variables: [], handlers: [handler(ev.use(), [st.send('open'), st.log('Button pressed')])] }),
  },
  {
    id: 'pressure-plate',
    group: 'gameplay',
    name: { en: 'Pressure plate that sends “open”', ru: 'Нажимная плита, отправляющая «open»' },
    description: {
      en: 'Adds a zone on top. Stepping on it sends the message “open” to everything, once.',
      ru: 'Добавляет зону сверху. Когда игрок наступает на неё, всем один раз отправляется сообщение «open».',
    },
    zone: (t) => ({ name: `${t.name}_zone`, min: [t.min[0], t.max[1], t.min[2]], max: [t.max[0], t.max[1] + 32, t.max[2]], detects: 'player', once: true }),
    build: (_t, zone) => ({ variables: [], handlers: [handler(ev.enter(zone!), [st.send('open'), st.log('Plate pressed')])] }),
  },
  {
    id: 'lift',
    group: 'moving',
    name: { en: 'Lift that goes up and down', ru: 'Лифт, который ездит вверх и вниз' },
    description: { en: 'Rises 128 units over 2 seconds, waits, comes back down, waits, for ever.', ru: 'Поднимается на 128 единиц за 2 секунды, ждёт, опускается, ждёт — и так всё время.' },
    build: () => ({ variables: [], handlers: [handler(ev.start(), [st.forever([st.moveUp(128, 2), st.wait(1), st.return(2), st.wait(1)])])] }),
  },
  {
    id: 'spin',
    group: 'moving',
    name: { en: 'Keeps spinning', ru: 'Всё время вращается' },
    description: { en: 'Turns all the way round every 4 seconds.', ru: 'Делает полный оборот каждые 4 секунды.' },
    build: () => ({ variables: [], handlers: [handler(ev.start(), [st.forever([st.turn(360, 4)])])] }),
  },
  {
    id: 'crumble',
    group: 'gameplay',
    name: { en: 'Platform that vanishes when stepped on', ru: 'Платформа, исчезающая под ногами' },
    description: {
      en: 'Adds a zone on top. Half a second after the player steps on, the platform disappears; it comes back after 3 seconds.',
      ru: 'Добавляет зону сверху. Через полсекунды после того, как игрок наступил, платформа исчезает и возвращается через 3 секунды.',
    },
    zone: (t) => ({ name: `${t.name}_zone`, min: [t.min[0], t.max[1], t.min[2]], max: [t.max[0], t.max[1] + 32, t.max[2]], detects: 'player', once: false }),
    build: (_t, zone) => ({ variables: [], handlers: [handler(ev.enter(zone!), [st.wait(0.5), st.hide(), st.wait(3), st.show()])] }),
  },
  {
    id: 'pickup',
    group: 'gameplay',
    name: { en: 'Pickup the player collects', ru: 'Предмет, который подбирает игрок' },
    description: { en: 'Adds a zone around it. When the player touches it, it disappears and says so in the console.', ru: 'Добавляет зону вокруг. Когда игрок касается предмета, он исчезает, а в консоли появляется запись.' },
    zone: (t) => ({ name: `${t.name}_zone`, ...around(t, 8, 8, 8), detects: 'player', once: true }),
    build: (t, zone) => ({ variables: [], handlers: [handler(ev.enter(zone!), [st.hide(), st.log(`Picked up ${t.name}`)])] }),
  },
  {
    id: 'coin',
    group: 'gameplay',
    name: { en: 'Coin: +1 score when collected', ru: 'Монета: +1 к счёту' },
    description: {
      en: 'Adds a zone around it. When the player touches it, it disappears and the score goes up by 1.',
      ru: 'Добавляет зону вокруг. Когда игрок касается монеты, она исчезает, а счёт увеличивается на 1.',
    },
    zone: (t) => ({ name: `${t.name}_zone`, ...around(t, 8, 8, 8), detects: 'player', once: true }),
    build: (_t, zone) => ({ variables: [], handlers: [handler(ev.enter(zone!), [st.hide(), st.score(1)])] }),
  },
  {
    id: 'health-pickup',
    group: 'gameplay',
    name: { en: 'Health pack: +25 health', ru: 'Аптечка: +25 здоровья' },
    description: {
      en: 'Adds a zone around it. The player gets 25 health back and it disappears — unless their health is already full.',
      ru: 'Добавляет зону вокруг. Игрок получает 25 здоровья, и аптечка исчезает — если здоровье ещё не полное.',
    },
    zone: (t) => ({ name: `${t.name}_zone`, ...around(t, 8, 8, 8), detects: 'player', once: false }),
    build: (_t, zone) => ({
      variables: [{ name: 'taken', type: 'boolean', initial: false }],
      handlers: [
        handler(ev.enter(zone!), [
          {
            id: id(),
            kind: 'if',
            condition: {
              id: id(),
              kind: 'logic',
              op: 'and',
              a: isNot('taken'),
              b: { id: id(), kind: 'compare', op: '<', a: { id: id(), kind: 'health' }, b: num(100) },
            },
            then: [st.set('taken', true), st.heal(25), st.hide()],
            otherwise: null,
          },
        ]),
      ],
    }),
  },
  {
    id: 'hurt-zone',
    group: 'gameplay',
    name: { en: 'Hurts the player who stands in it', ru: 'Ранит игрока, который в нём стоит' },
    description: {
      en: 'Adds a zone over the object (fire, spikes, acid). While the player is inside, they lose 10 health every half second.',
      ru: 'Добавляет зону на объекте (огонь, шипы, кислота). Пока игрок внутри, он теряет 10 здоровья каждые полсекунды.',
    },
    zone: (t) => ({ name: `${t.name}_zone`, min: [t.min[0], t.min[1], t.min[2]], max: [t.max[0], t.max[1] + 32, t.max[2]], detects: 'player', once: false }),
    build: (_t, zone) => ({
      variables: [{ name: 'inside', type: 'boolean', initial: false }],
      handlers: [
        // (Two stacks: stepping back in while the loop is still waiting must still count as inside.)
        handler(ev.enter(zone!), [st.set('inside', true)]),
        handler(ev.enter(zone!), [
          st.forever([{ id: id(), kind: 'if', condition: isNot('inside'), then: [st.stop()], otherwise: null }, st.hurt(10), st.wait(0.5)]),
        ]),
        handler(ev.leave(zone!), [st.set('inside', false)]),
      ],
    }),
  },
  {
    id: 'deadly',
    group: 'gameplay',
    name: { en: 'Deadly: touching it kills the player', ru: 'Смертельно: касание убивает игрока' },
    description: {
      en: 'Adds a zone over the object (lava, a bottomless pit). The player who touches it dies and starts again.',
      ru: 'Добавляет зону на объекте (лава, пропасть). Игрок, коснувшийся его, погибает и начинает заново.',
    },
    zone: (t) => ({ name: `${t.name}_zone`, min: [t.min[0], t.min[1], t.min[2]], max: [t.max[0], t.max[1] + 16, t.max[2]], detects: 'player', once: false }),
    build: (_t, zone) => ({ variables: [], handlers: [handler(ev.enter(zone!), [st.hurt(1000)])] }),
  },
];

export const recipe = (id: string) => RECIPES.find((r) => r.id === id);
