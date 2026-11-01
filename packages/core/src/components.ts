/**
 * Built-in components: what each one stores, its defaults, and how the Inspector shows it.
 * Components are plain JSON on the entity (`components.light = { ... }`). The editor draws its fields from
 * these definitions; the runtime reads the same data through `readComponent`, which fills in defaults, so
 * older files and hand-edited files always produce complete values.
 */

export type Lang = 'en' | 'ru';
export type Text = Record<Lang, string>;

export type FieldType =
  | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'boolean' }
  | { kind: 'enum'; options: { value: string; label: Text }[] }
  | { kind: 'color' }
  | { kind: 'vec3'; step?: number; min?: number }
  | { kind: 'text' };

export interface FieldDef {
  key: string;
  label: Text;
  hint?: Text;
  type: FieldType;
  default: unknown;
  /** Show only when another field has one of these values. */
  when?: { key: string; is: unknown[] };
}

export interface ComponentDef {
  name: string;
  label: Text;
  description: Text;
  /** Which entities may carry it: brushes, point objects (lights, spawns, empties), or both. */
  appliesTo: 'brush' | 'point' | 'any';
  fields: FieldDef[];
  /** Components that can't be on the same entity. */
  conflicts?: string[];
  /** Hidden from the Add menu (made by tools, e.g. brushes and groups). */
  internal?: boolean;
}

const e = (en: string, ru: string): Text => ({ en, ru });

export const COMPONENTS: ComponentDef[] = [
  {
    name: 'light',
    label: e('Light', 'Свет'),
    description: e('Lights up the level.', 'Освещает уровень.'),
    appliesTo: 'point',
    fields: [
      {
        key: 'kind',
        label: e('Type', 'Тип'),
        type: {
          kind: 'enum',
          options: [
            { value: 'point', label: e('Bulb', 'Лампа') },
            { value: 'spot', label: e('Spotlight', 'Прожектор') },
            { value: 'directional', label: e('Sun', 'Солнце') },
          ],
        },
        default: 'point',
      },
      { key: 'color', label: e('Colour', 'Цвет'), type: { kind: 'color' }, default: '#ffffff' },
      { key: 'intensity', label: e('Brightness', 'Яркость'), type: { kind: 'number', min: 0, step: 0.1 }, default: 1.5 },
      { key: 'range', label: e('Reach', 'Дальность'), type: { kind: 'number', min: 0, step: 16, unit: 'u' }, default: 512, when: { key: 'kind', is: ['point', 'spot'] } },
      { key: 'angle', label: e('Cone', 'Конус'), type: { kind: 'number', min: 1, max: 170, step: 1, unit: '°' }, default: 40, when: { key: 'kind', is: ['spot'] } },
      { key: 'castShadows', label: e('Shadows', 'Тени'), type: { kind: 'boolean' }, default: false },
    ],
  },
  {
    name: 'playerSpawn',
    label: e('Player start', 'Старт игрока'),
    description: e('Where the player appears when the game starts.', 'Здесь игрок появляется в начале игры.'),
    appliesTo: 'point',
    fields: [],
  },
  {
    name: 'rigidBody',
    label: e('Physics', 'Физика'),
    description: e('Makes the object take part in physics: fall, bounce, be pushed.', 'Объект участвует в физике: падает, отскакивает, его можно толкать.'),
    appliesTo: 'any',
    fields: [
      {
        key: 'motion',
        label: e('Moves', 'Движение'),
        hint: e('“Fixed” never moves. “Falls and tumbles” is pushed by gravity and hits. “Moved by scripts” goes where blocks tell it and pushes things out of the way.', '«Неподвижно» не двигается. «Падает» подчиняется гравитации и ударам. «Скриптами» двигается по командам блоков и расталкивает остальное.'),
        type: {
          kind: 'enum',
          options: [
            { value: 'fixed', label: e('Fixed', 'Неподвижно') },
            { value: 'dynamic', label: e('Falls and tumbles', 'Падает') },
            { value: 'kinematic', label: e('Moved by scripts', 'Скриптами') },
          ],
        },
        default: 'dynamic',
      },
      { key: 'mass', label: e('Weight', 'Вес'), type: { kind: 'number', min: 0.01, step: 1, unit: 'kg' }, default: 10, when: { key: 'motion', is: ['dynamic'] } },
      { key: 'friction', label: e('Grip', 'Трение'), hint: e('0 = ice, 1 = rubber.', '0 — лёд, 1 — резина.'), type: { kind: 'number', min: 0, max: 2, step: 0.05 }, default: 0.6 },
      { key: 'bounciness', label: e('Bounce', 'Упругость'), hint: e('0 = no bounce, 1 = bounces back fully.', '0 — не отскакивает, 1 — полностью.'), type: { kind: 'number', min: 0, max: 1, step: 0.05 }, default: 0 },
      { key: 'gravityScale', label: e('Gravity', 'Гравитация'), type: { kind: 'number', step: 0.1, unit: '×' }, default: 1, when: { key: 'motion', is: ['dynamic'] } },
      { key: 'lockRotation', label: e('Stay upright', 'Не вращаться'), type: { kind: 'boolean' }, default: false, when: { key: 'motion', is: ['dynamic'] } },
    ],
  },
  {
    name: 'collider',
    label: e('Collision shape', 'Форма столкновений'),
    description: e('The shape physics uses for a point object. Brushes use their own shape.', 'Форма, которую физика использует для точечного объекта. Кисти используют свою форму.'),
    appliesTo: 'point',
    fields: [
      {
        key: 'shape',
        label: e('Shape', 'Форма'),
        type: {
          kind: 'enum',
          options: [
            { value: 'box', label: e('Box', 'Коробка') },
            { value: 'sphere', label: e('Ball', 'Шар') },
            { value: 'capsule', label: e('Capsule', 'Капсула') },
          ],
        },
        default: 'box',
      },
      { key: 'size', label: e('Size', 'Размер'), type: { kind: 'vec3', step: 4, min: 0.5 }, default: [32, 32, 32] },
      { key: 'offset', label: e('Offset', 'Смещение'), type: { kind: 'vec3', step: 4 }, default: [0, 0, 0] },
    ],
  },
  {
    name: 'trigger',
    label: e('Trigger zone', 'Зона-триггер'),
    description: e('An invisible zone that notices when things enter or leave it. Scripts react to it.', 'Невидимая зона, которая замечает, когда в неё входят или выходят. На это реагируют скрипты.'),
    appliesTo: 'brush',
    conflicts: ['rigidBody'],
    fields: [
      {
        key: 'detects',
        label: e('Notices', 'Замечает'),
        type: {
          kind: 'enum',
          options: [
            { value: 'player', label: e('The player', 'Игрока') },
            { value: 'physics', label: e('Physics objects', 'Физические объекты') },
            { value: 'anything', label: e('Anything', 'Всё') },
          ],
        },
        default: 'player',
      },
      { key: 'once', label: e('Only once', 'Один раз'), hint: e('Stops noticing after the first time.', 'Срабатывает только в первый раз.'), type: { kind: 'boolean' }, default: false },
    ],
  },
  {
    name: 'script',
    label: e('Script', 'Скрипт'),
    description: e('Blocks that make this object do things: “When the player enters… open the door”.', 'Блоки, которые заставляют объект действовать: «Когда игрок входит… открыть дверь».'),
    appliesTo: 'any',
    fields: [],
  },
  { name: 'brush', label: e('Brush', 'Кисть'), description: e('Level geometry.', 'Геометрия уровня.'), appliesTo: 'brush', fields: [], internal: true },
  { name: 'group', label: e('Group', 'Группа'), description: e('Holds other objects.', 'Содержит другие объекты.'), appliesTo: 'any', fields: [], internal: true },
  { name: 'pivot', label: e('Pivot', 'Опорная точка'), description: e('Where the object turns around.', 'Точка, вокруг которой объект вращается.'), appliesTo: 'any', fields: [], internal: true },
  { name: 'prefabLink', label: e('Prefab link', 'Связь с префабом'), description: e('Which prefab this object copies.', 'Какой префаб копирует объект.'), appliesTo: 'any', fields: [], internal: true },
];

const byName = new Map(COMPONENTS.map((c) => [c.name, c]));

export const componentDef = (name: string): ComponentDef | undefined => byName.get(name);

/** A component's data with every missing field filled from the defaults. Unknown fields are kept. */
export function readComponent<T extends Record<string, unknown>>(name: string, data: Record<string, unknown> | undefined): T {
  const def = byName.get(name);
  const out: Record<string, unknown> = { ...(data ?? {}) };
  for (const f of def?.fields ?? []) if (out[f.key] === undefined) out[f.key] = structuredClone(f.default);
  return out as T;
}

/** Default data for a new component. */
export function defaultComponent(name: string): Record<string, unknown> {
  return readComponent(name, {});
}

/** Components that could be added to an entity right now. */
export function addableComponents(components: Record<string, unknown>, isBrush: boolean): ComponentDef[] {
  return COMPONENTS.filter((c) => {
    if (c.internal || components[c.name] !== undefined) return false;
    if (c.appliesTo === 'brush' && !isBrush) return false;
    if (c.appliesTo === 'point' && isBrush) return false;
    if (c.conflicts?.some((x) => components[x] !== undefined)) return false;
    if (COMPONENTS.some((o) => components[o.name] !== undefined && o.conflicts?.includes(c.name))) return false;
    return true;
  });
}

export interface RigidBodyData {
  motion: 'fixed' | 'dynamic' | 'kinematic';
  mass: number;
  friction: number;
  bounciness: number;
  gravityScale: number;
  lockRotation: boolean;
  [k: string]: unknown;
}

export interface ColliderData {
  shape: 'box' | 'sphere' | 'capsule';
  size: [number, number, number];
  offset: [number, number, number];
  [k: string]: unknown;
}

export interface TriggerData {
  detects: 'player' | 'physics' | 'anything';
  once: boolean;
  [k: string]: unknown;
}
