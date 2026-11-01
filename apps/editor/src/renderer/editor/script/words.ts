/** The plain-language words of the blocks (English and Russian). Slots are filled in by the block rows. */
import type { Direction, ExprKind, StatementKind, EventKind } from '@cocoaworlds/scripting';
import { getLang } from '../../i18n';

type Pair = [en: string, ru: string];
const pick = (p: Pair) => (getLang() === 'ru' ? p[1] : p[0]);

const W = {
  // events
  start: ['When the game starts', 'Когда игра начинается'],
  enter: ['When something enters', 'Когда что-то входит в'],
  leave: ['When something leaves', 'Когда что-то выходит из'],
  message: ['When this gets the message', 'Когда приходит сообщение'],
  use: ['When the player uses this', 'Когда игрок использует это'],
  every: ['Every', 'Каждые'],
  seconds: ['seconds', 'с'],
  // actions
  move: ['Move', 'Сдвинуть'],
  by: ['by', 'на'],
  direction: ['direction', 'направление'],
  over: ['over', 'за'],
  turn: ['Turn', 'Повернуть'],
  around: ['degrees around', '° вокруг оси'],
  return: ['Return', 'Вернуть'],
  toStart: ['to where it started over', 'на место за'],
  show: ['Show', 'Показать'],
  hide: ['Hide', 'Скрыть'],
  turnOn: ['Turn on', 'Включить'],
  turnOff: ['Turn off', 'Выключить'],
  wait: ['Wait', 'Ждать'],
  send: ['Send the message', 'Отправить сообщение'],
  to: ['to', 'кому:'],
  everyone: ['everyone', 'всем'],
  log: ['Write', 'Написать'],
  inConsole: ['in the console', 'в консоль'],
  set: ['Set', 'Задать'],
  setTo: ['to', '='],
  change: ['Change', 'Изменить'],
  if: ['If', 'Если'],
  otherwise: ['Otherwise', 'Иначе'],
  addOtherwise: ['+ Otherwise', '+ Иначе'],
  repeat: ['Repeat', 'Повторить'],
  times: ['times', 'раз'],
  forever: ['Repeat forever', 'Повторять всегда'],
  stop: ['Stop this stack', 'Остановить этот стек'],
  // values
  self: ['this object', 'этот объект'],
  other: ['the thing that entered', 'то, что вошло'],
  player: ['the player', 'игрок'],
  random: ['random from', 'случайное от'],
  toWord: ['to', 'до'],
  join: ['join', 'соединить'],
  not: ['not', 'не'],
  and: ['and', 'и'],
  or: ['or', 'или'],
  time: ['seconds since start', 'секунд с начала'],
  yes: ['yes', 'да'],
  no: ['no', 'нет'],
  pickVariable: ['pick a variable', 'выберите переменную'],
} satisfies Record<string, Pair>;

export const w = (k: keyof typeof W) => pick(W[k] as Pair);

const DIR: Record<Direction, Pair> = {
  up: ['up', 'вверх'],
  down: ['down', 'вниз'],
  north: ['north', 'на север'],
  south: ['south', 'на юг'],
  east: ['east', 'на восток'],
  west: ['west', 'на запад'],
};
export const directionLabel = (d: Direction) => pick(DIR[d]);

const AXIS: Record<string, Pair> = { up: ['up (spin)', 'вертикальной'], north: ['north (roll)', 'север–юг'], east: ['east (tip)', 'запад–восток'] };
export const axisLabel = (a: string) => pick(AXIS[a] ?? ['up', 'вверх']);

/** Palette entries: what each block is called in the "add" menus. */
const PALETTE_EVENT: Record<EventKind, Pair> = {
  start: ['When the game starts', 'Когда игра начинается'],
  enter: ['When something enters a zone', 'Когда что-то входит в зону'],
  leave: ['When something leaves a zone', 'Когда что-то выходит из зоны'],
  use: ['When the player uses this (E)', 'Когда игрок использует это (E)'],
  message: ['When this gets a message', 'Когда приходит сообщение'],
  every: ['Every few seconds', 'Каждые несколько секунд'],
};
export const eventName = (k: EventKind) => pick(PALETTE_EVENT[k]);

const PALETTE_STMT: Record<StatementKind, Pair> = {
  move: ['Move', 'Сдвинуть'],
  turn: ['Turn', 'Повернуть'],
  return: ['Return to start', 'Вернуть на место'],
  show: ['Show', 'Показать'],
  hide: ['Hide', 'Скрыть'],
  turnOn: ['Turn on', 'Включить'],
  turnOff: ['Turn off', 'Выключить'],
  wait: ['Wait', 'Ждать'],
  send: ['Send a message', 'Отправить сообщение'],
  log: ['Write in the console', 'Написать в консоль'],
  set: ['Set a variable', 'Задать переменную'],
  change: ['Change a variable', 'Изменить переменную'],
  if: ['If … otherwise', 'Если … иначе'],
  repeat: ['Repeat N times', 'Повторить N раз'],
  forever: ['Repeat forever', 'Повторять всегда'],
  stop: ['Stop this stack', 'Остановить стек'],
};
export const statementName = (k: StatementKind) => pick(PALETTE_STMT[k]);

export const STATEMENT_GROUPS: { title: Pair; kinds: StatementKind[] }[] = [
  { title: ['Do', 'Действия'], kinds: ['move', 'turn', 'return', 'show', 'hide', 'turnOn', 'turnOff', 'send', 'log'] },
  { title: ['Control', 'Управление'], kinds: ['wait', 'if', 'repeat', 'forever', 'stop'] },
  { title: ['Variables', 'Переменные'], kinds: ['set', 'change'] },
];
export const groupTitle = (p: Pair) => pick(p);

const VALUE: Record<ExprKind, Pair> = {
  number: ['A number', 'Число'],
  text: ['Some text', 'Текст'],
  boolean: ['Yes or no', 'Да или нет'],
  variable: ['A variable', 'Переменная'],
  maths: ['Maths (+ − × ÷)', 'Арифметика (+ − × ÷)'],
  compare: ['Compare (= < >)', 'Сравнение (= < >)'],
  logic: ['And / or', 'И / или'],
  not: ['Not', 'Не'],
  random: ['Random number', 'Случайное число'],
  join: ['Join text', 'Соединить текст'],
  object: ['An object', 'Объект'],
  time: ['Seconds since start', 'Секунд с начала'],
};
export const valueName = (k: ExprKind) => pick(VALUE[k]);

/** Which value blocks fit a slot of a given type. */
export const VALUES_FOR: Record<'number' | 'boolean' | 'text' | 'any', ExprKind[]> = {
  number: ['number', 'variable', 'maths', 'random', 'time'],
  boolean: ['boolean', 'variable', 'compare', 'logic', 'not'],
  text: ['text', 'variable', 'join', 'number', 'object'],
  any: ['number', 'text', 'boolean', 'variable', 'maths', 'compare', 'logic', 'not', 'random', 'join', 'time', 'object'],
};
