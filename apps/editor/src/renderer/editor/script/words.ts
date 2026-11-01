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
  messageStop: ['When the message', 'Когда сообщение'],
  stopsComing: ['stops coming', 'перестаёт приходить'],
  use: ['When the player uses this', 'Когда игрок использует это'],
  every: ['Every', 'Каждые'],
  die: ['When the player dies', 'Когда игрок погибает'],
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
  while: ['Repeat while', 'Повторять, пока'],
  turnTo: ['Turn', 'Повернуть'],
  toAngle: ['to', 'на угол'],
  fromStart: ['degrees from its start, around', '° от начального, вокруг оси'],
  isInside: ['is inside', 'внутри'],
  stop: ['Stop this stack', 'Остановить этот стек'],
  hurt: ['Hurt the player by', 'Ранить игрока на'],
  heal: ['Heal the player by', 'Вылечить игрока на'],
  addScore: ['Change the score by', 'Изменить счёт на'],
  say: ['Show on screen', 'Показать на экране'],
  usePrompt: ['showing', 'с подсказкой'],
  playSound: ['Play sound', 'Играть звук'],
  playAnim: ['Play animation', 'Играть анимацию'],
  onWord: ['on', 'у'],
  looping: ['looping', 'по кругу'],
  once: ['once', 'один раз'],
  everywhere: ['everywhere (not in 3D)', 'везде (не в 3D)'],
  volume: ['volume', 'громкость'],
  stopSound: ['Stop the sounds of', 'Остановить звуки'],
  pickSound: ['pick a sound', 'выберите звук'],
  breaks: ['When this breaks', 'Когда это ломается'],
  spawn: ['Make a copy of', 'Создать копию'],
  at: ['at', 'в месте:'],
  aim: ['where the player looks', 'куда смотрит игрок'],
  remove: ['Remove', 'Убрать'],
  physical: ['Make', 'Пусть'],
  fall: ['fall and tumble (physics)', 'падает и кувыркается (физика)'],
  scale: ['Scale', 'Масштаб'],
  timesSize: ['times its size over', '× от исходного за'],
  push: ['Push', 'Толкнуть'],
  withStrength: ['with strength', 'с силой'],
  moveTo: ['Move to', 'Переместить к'],
  stopping: ['stopping', 'остановившись за'],
  short: ['units short', 'ед. до цели'],
  teleport: ['Put the player at', 'Переместить игрока в'],
  damage: ['Damage', 'Повредить'],
  copy: ['the new copy', 'новая копия'],
  ofWord: ['of', 'у'],
  variableName: ['variable name', 'имя переменной'],
  forWord: ['for', 'на'],
  setText: ['Set the text of', 'Задать текст'],
  gameValue: ['game', 'игра'],
  health: ['the player’s health', 'здоровье игрока'],
  score: ['the score', 'счёт'],
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
  messageStop: ['When a message stops coming', 'Когда сообщение перестаёт приходить'],
  every: ['Every few seconds', 'Каждые несколько секунд'],
  die: ['When the player dies', 'Когда игрок погибает'],
  breaks: ['When this breaks', 'Когда это ломается'],
};
export const eventName = (k: EventKind) => pick(PALETTE_EVENT[k]);

const PALETTE_STMT: Record<StatementKind, Pair> = {
  move: ['Move', 'Сдвинуть'],
  turn: ['Turn by', 'Повернуть на'],
  turnTo: ['Turn to an angle (doors)', 'Повернуть до угла (двери)'],
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
  while: ['Repeat while …', 'Повторять, пока …'],
  stop: ['Stop this stack', 'Остановить стек'],
  hurt: ['Hurt the player', 'Ранить игрока'],
  heal: ['Heal the player', 'Вылечить игрока'],
  addScore: ['Change the score', 'Изменить счёт'],
  say: ['Show a message on screen', 'Показать сообщение на экране'],
  setText: ['Set the text of a sign', 'Задать текст таблички'],
  spawn: ['Make a copy', 'Создать копию'],
  remove: ['Remove an object', 'Убрать объект'],
  scale: ['Scale', 'Масштабировать'],
  physical: ['Make it fall (physics)', 'Пусть падает (физика)'],
  push: ['Push', 'Толкнуть'],
  moveTo: ['Move to a place', 'Переместить к месту'],
  teleport: ['Put the player somewhere', 'Переместить игрока'],
  damage: ['Damage', 'Повредить'],
  playSound: ['Play a sound', 'Играть звук'],
  stopSound: ['Stop sounds', 'Остановить звуки'],
  playAnim: ['Play an animation', 'Играть анимацию'],
};
export const statementName = (k: StatementKind) => pick(PALETTE_STMT[k]);

export const STATEMENT_GROUPS: { title: Pair; kinds: StatementKind[] }[] = [
  { title: ['Do', 'Действия'], kinds: ['move', 'turn', 'turnTo', 'return', 'show', 'hide', 'turnOn', 'turnOff', 'send', 'log'] },
  { title: ['Objects', 'Объекты'], kinds: ['spawn', 'remove', 'moveTo', 'scale', 'physical', 'push', 'damage'] },
  { title: ['Player and score', 'Игрок и счёт'], kinds: ['teleport', 'hurt', 'heal', 'addScore'] },
  { title: ['Screen and signs', 'Экран и таблички'], kinds: ['say', 'setText'] },
  { title: ['Sound', 'Звук'], kinds: ['playSound', 'stopSound'] },
  { title: ['Models', 'Модели'], kinds: ['playAnim'] },
  { title: ['Control', 'Управление'], kinds: ['wait', 'if', 'repeat', 'while', 'forever', 'stop'] },
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
  health: ['The player’s health', 'Здоровье игрока'],
  score: ['The score', 'Счёт'],
  copy: ['The new copy', 'Новая копия'],
  varOf: ['Another object’s variable', 'Переменная другого объекта'],
  inside: ['Is inside a zone', 'Внутри зоны'],
};
export const valueName = (k: ExprKind) => pick(VALUE[k]);

/** Which value blocks fit a slot of a given type. */
export const VALUES_FOR: Record<'number' | 'boolean' | 'text' | 'any', ExprKind[]> = {
  number: ['number', 'variable', 'varOf', 'maths', 'random', 'time', 'health', 'score'],
  boolean: ['boolean', 'inside', 'variable', 'varOf', 'compare', 'logic', 'not'],
  text: ['text', 'variable', 'varOf', 'join', 'number', 'object', 'score'],
  any: ['number', 'text', 'boolean', 'variable', 'varOf', 'maths', 'compare', 'logic', 'not', 'inside', 'random', 'join', 'time', 'health', 'score', 'object', 'copy'],
};
