import { SURFACES, SURFACE_LABELS } from './surfaces';
/**
 * Built-in components: what each one stores, its defaults, and how the Inspector shows it.
 * Components are plain JSON on the entity (`components.light = { ... }`). The editor draws its fields from
 * these definitions; the runtime reads the same data through `readComponent`, which fills in defaults, so
 * older files and hand-edited files always produce complete values.
 */

export type Lang = 'en' | 'ru';

export type SoundData = { sound: string; volume: number; loop: boolean; playOnStart: boolean; range: number; areaEffects: boolean; loudness?: number };
/** How a place makes things sound (component `soundArea`): see SOUND_EFFECTS. */
export type SoundEffect = 'none' | 'room' | 'hall' | 'cave' | 'underwater' | 'outdoors';
/** A brush that changes how everything sounds while the player's ears are inside it. */
export type SoundAreaData = { effect: SoundEffect; mix: number; sound: string; volume: number };
export const SOUND_EFFECTS: SoundEffect[] = ['none', 'room', 'hall', 'cave', 'underwater', 'outdoors'];
/**
 * How a model collides: by the collision meshes in its file (none if it has none), not at all, by its bounding
 * box, by its convex hull, or by its exact triangles.
 */
export type ModelCollision = 'auto' | 'none' | 'box' | 'hull' | 'exact';
export type ModelData = {
  model: string;
  units: 'metres' | 'units';
  animation: string;
  castShadows: boolean;
  collision: ModelCollision;
  /** Project materials in place of the model's own, by the name of the material slot in the file. */
  materials?: Record<string, string>;
  /** `#rrggbb` multiplied into every material's colour (white: none). */
  tint?: string;
};
export type ConveyorData = { speed: number; direction: 'north' | 'south' | 'east' | 'west' };
export type BreakableData = { health: number };

/** A text sign's data (component `sign`). */
export type SignData = {
  text: string;
  size: number;
  color: string;
  background: boolean;
  faceCamera: boolean;
};
/** Cartoon eyes on an object (component `googlyEyes`): drawn by a shader, the pupils roll about loose. */
export type GooglyEyesData = {
  count: 'two' | 'one';
  /** Across one eye (u). */
  size: number;
  /** Between the two eyes' middles (u). */
  spacing: number;
  /** Where the middle between the eyes is, from the object's origin (u, the object's own axes; eyes look along −Z). */
  offset: [number, number, number];
  /** Each eye turned outwards by this much (°): 0 both look ahead, 90 they look to the sides (birds, fish). */
  splay: number;
  /** Each eye turned to look up by this much (°; below 0, down). */
  tilt: number;
  /** On a model with bones: ride on one, so its animations carry the eyes (a head that turns turns them). */
  followBone: boolean;
  /** The bone, by name ('' : the model's head, a bone with “head” in its name). */
  bone: string;
  /** The pupil's size, as a part of the eye (0.2–0.8). */
  pupil: number;
  /** How freely the pupils roll: 0 stiff, 1 rattling about. */
  loose: number;
  white: string;
  pupilColor: string;
};
/**
 * A poster or a painting (component `poster`): a picture the player carries and hangs on a wall. A poster that
 * rolls is a scroll while loose and flattens to a sheet on the wall; a painting stays flat. Its picture faces +Z.
 */
export type PosterData = {
  picture: string;
  width: number;
  height: number;
  rolls: boolean;
  /** The rolled scroll's look: a model lying along X ('' : a plain cylinder). */
  scrollModel: string;
  /** The scroll model's own scale, separate from the hung size. */
  scrollScale: number;
  /** How the rolled scroll collides: a cylinder, or the scroll model's box or hull. */
  scrollCollision: 'cylinder' | 'box' | 'hull';
  /** The scroll model's units, taken from the object's Model when that is the scroll. */
  scrollUnits?: ModelData['units'];
  thickness: number;
  frame: string;
  mass: number;
  hungAtStart: boolean;
};
/**
 * A 3D printer (component `printer`): “Print” blocks make copies of objects on it, layer by layer. Its Model is the
 * printer (Add › 3D printer brings the ready-made one), with the parts named here moved by the print.
 */
export type PrinterData = {
  /** The space a print fits in (u): width, height, depth. */
  size: [number, number, number];
  /** The middle of the build plate's top, in the printer's own space (u): prints stand there. */
  bed: [number, number, number];
  /** How thick a layer is (u), and how long one takes (s). */
  layerHeight: number;
  layerSeconds: number;
  /** The filament's colour: the cut top of a print and the layer just laid. */
  filament: string;
  /**
   * Parts of the printer's own model that move: the lift (rises with the layers), the gantry riding it
   * (front-back) and the head riding the gantry (left-right). Each moves with the ones it is inside.
   */
  head: string;
  gantry: string;
  lift: string;
  /** A sound looping while it prints ('' : none). */
  sound: string;
  volume: number;
};
/** Junk (component `junk`): its Model is the pile it makes on the ground; this is how it looks packed up while carried. */
export type JunkData = {
  /** The packed-up model (empty: it stays a pile). Made in the same units as its Model. */
  packed: string;
};
/** Something that powers outlets (component `powerSource`): a generator, a breaker. Use switches it. */
export type PowerSourceData = {
  /** On when the game starts. */
  on: boolean;
};
/** A wall outlet (component `outlet`): plugs go into it; live while its power source is on. */
export type OutletData = {
  /** The power source it is wired to, by id (empty: always live). */
  source: string;
};
/** An extension cord (component `extender`): plugs into a live socket and gives sockets of its own. */
export type ExtenderData = {
  /** How far its plug reaches from it (u). */
  cable: number;
};
/** String lights (component `stringLights`): carried as a coil, hung between two points, lit while plugged into a live socket. */
export type StringLightsData = {
  /** Bulb colour. */
  color: string;
  /** Distance between bulbs (u). */
  spacing: number;
  /** The longest span between its two ends (u). */
  length: number;
  /** How far its plug reaches from the first end (u). */
  cable: number;
  /** How far the middle hangs below a straight line, for each 100 u of span (u). */
  sag: number;
  /** Lights cast (spread along it; 0: the bulbs only glow). */
  lights: number;
  intensity: number;
  range: number;
};
/** A prop that sticks into the ground (component `stake`) when it hits it hard enough, tip first. */
export type StakeData = {
  /** Which way its tip points, in its own axes. */
  tip: 'bottom' | 'top' | 'front' | 'back';
  /** The speed into the ground it takes to stick (u/s). */
  speed: number;
  /** How far it goes in (u). */
  depth: number;
  /** The most it leans away from straight (°), picked at random. */
  tilt: number;
};

/** How thick a rolled poster's scroll is (its radius, u), the same for the physics and the drawing. */
/** A poster's data with its scroll model filled in from the object's Model when it has none of its own. */
export function posterOf(components: Record<string, unknown>): PosterData {
  const data = readComponent<PosterData>('poster', components.poster as Record<string, unknown>);
  const m = components.model as { model?: unknown; units?: ModelData['units'] } | undefined;
  return !data.scrollModel && typeof m?.model === 'string' && m.model ? { ...data, scrollModel: m.model, scrollUnits: m.units } : data;
}
export const posterScrollRadius = (p: Pick<PosterData, 'height'>): number => Math.max(1.5, Math.min(6, p.height / 24));
export type Text = Record<Lang, string>;

export type FieldType =
  | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'boolean' }
  | { kind: 'enum'; options: { value: string; label: Text }[] }
  | { kind: 'color' }
  /** A project material or texture ('' for none). */
  | { kind: 'material' }
  /** A project plant ('' for none). */
  | { kind: 'plant' }
  /** A project effect from the VFX workspace ('' for none). */
  | { kind: 'effect' }
  | { kind: 'vec3'; step?: number; min?: number }
  | { kind: 'text' }
  /** A project asset of one kind, by its project path (empty: none). */
  | { kind: 'asset'; asset: 'textures' | 'sounds' | 'models' }
  /** Another object of the scene, by id (empty: none); only objects with `component`, when given. */
  | { kind: 'object'; component?: string }
  /** A scene of the project, by name (its file name without `.cwscene`). */
  | { kind: 'scene' };

export interface FieldDef {
  key: string;
  label: Text;
  hint?: Text;
  type: FieldType;
  default: unknown;
  /** Show only when another field has one of these values. */
  when?: { key: string; is: unknown[] };
  /** A heading it's listed under (fields with the same heading are shown together, in order of first appearance). */
  group?: Text;
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
  /** Hidden from the Add menu and the Inspector (made by tools, e.g. brushes and groups). */
  internal?: boolean;
  /** Shown in the Inspector but not offered in Add component (made by its own Add menu item). */
  madeBy?: 'add-menu';
  /** On a point object, only alongside this component (Foliage goes on brushes, or on terrains). */
  pointNeeds?: string | string[];
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
      { key: 'intensity', label: e('Brightness', 'Яркость'), type: { kind: 'number', min: 0, step: 0.1 }, default: 0.8 },
      { key: 'range', label: e('Reach', 'Дальность'), type: { kind: 'number', min: 0, step: 16, unit: 'u' }, default: 512, when: { key: 'kind', is: ['point', 'spot'] } },
      { key: 'angle', label: e('Cone', 'Конус'), type: { kind: 'number', min: 1, max: 170, step: 1, unit: '°' }, default: 40, when: { key: 'kind', is: ['spot'] } },
      { key: 'castShadows', label: e('Shadows', 'Тени'), type: { kind: 'boolean' }, default: false },
      { key: 'on', label: e('On at start', 'Включён в начале'), type: { kind: 'boolean' }, default: true },
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
    name: 'sound',
    label: e('Sound', 'Звук'),
    description: e('A sound coming from this object: a hum, a waterfall, music. It is heard in 3D around the object.', 'Звук, идущий от объекта: гул, водопад, музыка. Слышен в 3D вокруг объекта.'),
    appliesTo: 'any',
    fields: [
      { key: 'sound', label: e('Sound', 'Звук'), type: { kind: 'asset', asset: 'sounds' }, default: '' },
      { key: 'volume', label: e('Volume', 'Громкость'), type: { kind: 'number', min: 0, max: 4, step: 0.1 }, default: 1 },
      { key: 'loop', label: e('Loop', 'Повторять'), type: { kind: 'boolean' }, default: true },
      { key: 'playOnStart', label: e('Play when the game starts', 'Играть с начала игры'), type: { kind: 'boolean' }, default: true },
      {
        key: 'range',
        label: e('Heard up to', 'Слышно до'),
        hint: e('Full volume within a quarter of this, silent beyond it.', 'Полная громкость на четверти расстояния, дальше — тише, после — тишина.'),
        type: { kind: 'number', min: 16, step: 64, unit: 'u' },
        default: 1024,
      },
      {
        key: 'areaEffects',
        label: e('Changed by sound areas', 'Меняется в звуковых зонах'),
        hint: e('Off: sounds the same everywhere (music, interface sounds), not echoed in caves or muffled under water.', 'Выкл.: звучит везде одинаково (музыка, звуки интерфейса), без эха в пещерах и приглушения под водой.'),
        type: { kind: 'boolean' },
        default: true,
      },
      {
        key: 'loudness',
        label: e('Creatures hear it', 'Слышат существа'),
        hint: e('Loudness for hunting creatures: 0 they ignore it, 1 heard as far as their Hears you up to, 2 twice as far. A looping sound keeps calling them while it plays.', 'Громкость для охотников: 0 — не замечают, 1 — слышно на их «Слышит до», 2 — вдвое дальше. Повторяющийся звук зовёт их, пока играет.'),
        type: { kind: 'number', min: 0, step: 0.1 },
        default: 0,
      },
    ],
  },
  {
    name: 'model',
    label: e('Model', 'Модель'),
    description: e(
      'A 3D model (GLB or glTF) drawn at this object. Pick how it collides; add Physics to make it move.',
      '3D-модель (GLB или glTF) на месте объекта. Выберите, как она сталкивается; добавьте Физику, чтобы двигалась.',
    ),
    appliesTo: 'point',
    fields: [
      { key: 'model', label: e('Model', 'Модель'), type: { kind: 'asset', asset: 'models' }, default: '' },
      {
        key: 'units',
        label: e('Made in', 'Единицы'),
        hint: e('Most tools (Blender) use metres: 1 m becomes 39.37 u.', 'Большинство программ (Blender) работают в метрах: 1 м = 39,37 ед.'),
        type: {
          kind: 'enum',
          options: [
            { value: 'metres', label: e('Metres', 'Метры') },
            { value: 'units', label: e('Game units', 'Ед. игры') },
          ],
        },
        default: 'metres',
      },
      { key: 'animation', label: e('Animation', 'Анимация'), hint: e('Plays from the start, looping (empty: none).', 'Играет с начала, по кругу (пусто — нет).'), type: { kind: 'text' }, default: '' },
      { key: 'castShadows', label: e('Shadows', 'Тени'), type: { kind: 'boolean' }, default: true },
      {
        key: 'tint',
        label: e('Tint', 'Оттенок'),
        hint: e('Multiplied into the colour of every material on the model (its own and those painted on it). White: none.', 'Умножается на цвет всех материалов модели (её собственных и нанесённых). Белый — без оттенка.'),
        type: { kind: 'color' },
        default: '#ffffff',
      },
      {
        key: 'collision',
        label: e('Collision', 'Столкновения'),
        hint: e(
          'Collision meshes in the file (named collision, hitbox or col_) are used instead of any of these except None. Auto: no collision without them. Box: its bounding box (cheapest). Hull: shrink-wrapped, no hollows (good for things that move). Exact: every triangle, for still scenery like arches and rooms (moving objects use the hull).',
          'Меши столкновений в файле (с именами collision, hitbox или col_) используются вместо любого из этих, кроме «Нет». Авто: без них столкновений нет. Коробка: габаритный короб (дешевле всего). Оболочка: «обтянутая» форма без впадин (хорошо для движущихся). Точно: каждый треугольник — для неподвижных арок и комнат (движущиеся используют оболочку).',
        ),
        type: {
          kind: 'enum',
          options: [
            { value: 'auto', label: e('Auto', 'Авто') },
            { value: 'none', label: e('None', 'Нет') },
            { value: 'box', label: e('Box', 'Коробка') },
            { value: 'hull', label: e('Hull', 'Оболочка') },
            { value: 'exact', label: e('Exact', 'Точно') },
          ],
        },
        default: 'auto',
      },
    ],
  },
  {
    name: 'conveyor',
    label: e('Conveyor', 'Конвейер'),
    description: e('Carries what lies on it, and the player standing on it.', 'Везёт то, что на нём лежит, и игрока, который на нём стоит.'),
    appliesTo: 'brush',
    conflicts: ['rigidBody', 'trigger'],
    fields: [
      { key: 'speed', label: e('Speed', 'Скорость'), type: { kind: 'number', step: 8, unit: 'u/s' }, default: 64 },
      {
        key: 'direction',
        label: e('Towards', 'Куда'),
        type: {
          kind: 'enum',
          options: [
            { value: 'north', label: e('North (−Z)', 'Север (−Z)') },
            { value: 'south', label: e('South (+Z)', 'Юг (+Z)') },
            { value: 'east', label: e('East (+X)', 'Восток (+X)') },
            { value: 'west', label: e('West (−X)', 'Запад (−X)') },
          ],
        },
        default: 'north',
      },
    ],
  },
  {
    name: 'breakable',
    label: e('Breakable', 'Разрушаемый'),
    description: e('Has health; the Damage block takes it away and at 0 it breaks and disappears.', 'Есть здоровье; блок «Повредить» отнимает его, и на 0 объект ломается и исчезает.'),
    appliesTo: 'any',
    fields: [{ key: 'health', label: e('Health', 'Здоровье'), type: { kind: 'number', min: 1, step: 5 }, default: 50 }],
  },
  {
    name: 'sign',
    label: e('Text sign', 'Табличка с текстом'),
    description: e('Text shown in the world: prices, names, directions. Blocks can change it while playing.', 'Текст в мире: цены, названия, указатели. Блоки могут менять его во время игры.'),
    appliesTo: 'point',
    fields: [
      { key: 'text', label: e('Text', 'Текст'), type: { kind: 'text' }, default: 'Text' },
      { key: 'size', label: e('Letter height', 'Высота букв'), type: { kind: 'number', min: 1, step: 2, unit: 'u' }, default: 16 },
      { key: 'color', label: e('Colour', 'Цвет'), type: { kind: 'color' }, default: '#ffffff' },
      { key: 'background', label: e('Background', 'Фон'), type: { kind: 'boolean' }, default: true },
      {
        key: 'faceCamera',
        label: e('Always face the camera', 'Всегда к камере'),
        hint: e('Off: the sign faces the way the object faces (−Z), like a plaque on a wall.', 'Выкл.: табличка смотрит туда же, куда объект (−Z), как надпись на стене.'),
        type: { kind: 'boolean' },
        default: false,
      },
    ],
  },
  {
    name: 'googlyEyes',
    label: e('Googly eyes', 'Глаза-шевелилки'),
    description: e(
      'Stick-on cartoon eyes whose pupils roll about loose: they fall to the bottom, rattle when the object starts, stops or turns, and swing as it walks. On models, creatures and empty objects.',
      'Наклеенные мультяшные глаза с болтающимися зрачками: зрачки падают вниз, трясутся, когда объект трогается, тормозит или поворачивается, и качаются при ходьбе. Для моделей, существ и пустых объектов.',
    ),
    appliesTo: 'point',
    fields: [
      {
        key: 'count',
        label: e('Eyes', 'Глаз'),
        type: { kind: 'enum', options: [{ value: 'two', label: e('Two', 'Два') }, { value: 'one', label: e('One', 'Один') }] },
        default: 'two',
      },
      { key: 'size', label: e('Size', 'Размер'), hint: e('Across one eye.', 'Поперёк одного глаза.'), type: { kind: 'number', min: 1, step: 1, unit: 'u' }, default: 12 },
      { key: 'spacing', label: e('Apart', 'Расстояние'), hint: e('From the middle of one eye to the middle of the other.', 'От середины одного глаза до середины другого.'), type: { kind: 'number', min: 0, step: 1, unit: 'u' }, default: 14, when: { key: 'count', is: ['two'] } },
      {
        key: 'offset',
        label: e('Position', 'Положение'),
        hint: e('Where the eyes sit, from the object’s origin. They look the way the object faces (−Z).', 'Где глаза, от начала объекта. Они смотрят туда же, куда объект (−Z).'),
        type: { kind: 'vec3', step: 1 },
        default: [0, 0, 0],
      },
      { key: 'splay', label: e('Turned out', 'Развёрнуты'), hint: e('0: both look ahead. 90: they look to the sides, like a bird’s.', '0 — оба смотрят вперёд, 90 — в стороны, как у птицы.'), type: { kind: 'number', min: 0, max: 90, step: 5, unit: '°' }, default: 0, when: { key: 'count', is: ['two'] } },
      { key: 'tilt', label: e('Looking up', 'Смотрят вверх'), hint: e('Below 0 they look down.', 'Меньше 0 — смотрят вниз.'), type: { kind: 'number', min: -60, max: 60, step: 5, unit: '°' }, default: 0 },
      {
        key: 'followBone',
        label: e('Ride on a bone', 'На кости'),
        hint: e(
          'On a model with bones, the eyes ride on one of them, so its animations carry them: a pecking head takes them along. Position is set as the model stands still.',
          'У модели с костями глаза крепятся к кости и двигаются с её анимацией: клюющая голова уносит их с собой. Положение задаётся для модели в покое.',
        ),
        type: { kind: 'boolean' },
        default: true,
      },
      { key: 'bone', label: e('Bone', 'Кость'), hint: e('Its name in the model. Empty: the head (a bone with “head” in its name).', 'Её имя в модели. Пусто — голова (кость, в имени которой есть «head»).'), type: { kind: 'text' }, default: '', when: { key: 'followBone', is: [true] } },
      { key: 'pupil', label: e('Pupil size', 'Размер зрачка'), type: { kind: 'number', min: 0.2, max: 0.8, step: 0.05 }, default: 0.5, group: e('Look', 'Вид') },
      { key: 'loose', label: e('Loose', 'Болтаются'), hint: e('0: the pupils barely move. 1: they rattle about at every bump.', '0 — зрачки почти не двигаются, 1 — трясутся от каждого толчка.'), type: { kind: 'number', min: 0, max: 1, step: 0.05 }, default: 0.6, group: e('Look', 'Вид') },
      { key: 'white', label: e('Eye colour', 'Цвет глаза'), type: { kind: 'color' }, default: '#ffffff', group: e('Look', 'Вид') },
      { key: 'pupilColor', label: e('Pupil colour', 'Цвет зрачка'), type: { kind: 'color' }, default: '#141414', group: e('Look', 'Вид') },
    ],
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
      { key: 'mass', label: e('Weight', 'Вес'), hint: e('Fixed or scripted objects use it once a block makes them fall.', 'Неподвижные и скриптовые объекты используют его, когда блок заставляет их падать.'), type: { kind: 'number', min: 0.01, step: 1, unit: 'kg' }, default: 10 },
      { key: 'friction', label: e('Grip', 'Трение'), hint: e('0 = ice, 1 = rubber.', '0 — лёд, 1 — резина.'), type: { kind: 'number', min: 0, max: 2, step: 0.05 }, default: 0.6 },
      { key: 'bounciness', label: e('Bounce', 'Упругость'), hint: e('0 = no bounce, 1 = bounces back fully.', '0 — не отскакивает, 1 — полностью.'), type: { kind: 'number', min: 0, max: 1, step: 0.05 }, default: 0 },
      { key: 'gravityScale', label: e('Gravity', 'Гравитация'), type: { kind: 'number', step: 0.1, unit: '×' }, default: 1 },
      { key: 'lockRotation', label: e('Stay upright', 'Не вращаться'), type: { kind: 'boolean' }, default: false },
      {
        key: 'pickUp',
        label: e('Can be picked up', 'Можно поднять'),
        hint: e('The player picks it up with Use, drops it with Use again and throws it with Fire. Only things of 50 kg or less; a Use script on it takes priority.', 'Игрок поднимает его клавишей «Использовать», отпускает ею же и бросает выстрелом. Только до 50 кг; скрипт на использование важнее.'),
        type: { kind: 'boolean' },
        default: true,
      },
      {
        key: 'surface',
        label: e('Sounds like', 'Звучит как'),
        hint: e('What it sounds like when it hits something. From its material: what its faces or model are made of.', 'Как звучит при ударе. «По материалу»: из чего сделаны его грани или модель.'),
        type: { kind: 'enum', options: [{ value: '', label: e('From its material', 'По материалу') }, ...SURFACES.filter((s) => s !== 'generic').map((s) => ({ value: s, label: e(...SURFACE_LABELS[s]) })), { value: 'generic', label: e(...SURFACE_LABELS.generic) }] },
        default: '',
      },
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
    name: 'soundArea',
    label: e('Sound area', 'Звуковая зона'),
    description: e(
      'Changes how everything sounds while the player is inside: echo in a room or cave, muffled under water. Can swap in its own background sound. Where areas overlap, the smallest wins.',
      'Меняет звучание всего, пока игрок внутри: эхо в комнате или пещере, приглушение под водой. Может заменить фоновый звук своим. Где зоны пересекаются, побеждает меньшая.',
    ),
    appliesTo: 'brush',
    conflicts: ['rigidBody', 'conveyor', 'train', 'levelChange', 'ladder', 'water'],
    fields: [
      {
        key: 'effect',
        label: e('Sounds like', 'Звучит как'),
        type: {
          kind: 'enum',
          options: [
            { value: 'none', label: e('Nothing special', 'Без эффекта') },
            { value: 'room', label: e('Room (short echo)', 'Комната (короткое эхо)') },
            { value: 'hall', label: e('Hall', 'Зал') },
            { value: 'cave', label: e('Cave (long echo)', 'Пещера (долгое эхо)') },
            { value: 'underwater', label: e('Under water (muffled)', 'Под водой (глухо)') },
            { value: 'outdoors', label: e('Outdoors (no echo)', 'Улица (без эха)') },
          ],
        },
        default: 'room',
      },
      { key: 'mix', label: e('Amount', 'Сила'), hint: e('0: no effect, 1: full effect.', '0 — без эффекта, 1 — в полную силу.'), type: { kind: 'number', min: 0, max: 1, step: 0.05 }, default: 1 },
      {
        key: 'sound',
        label: e('Background sound', 'Фоновый звук'),
        hint: e('Played in place of the scene’s background sound while inside (empty: keep the scene’s).', 'Играет вместо фонового звука сцены, пока игрок внутри (пусто — звук сцены).'),
        type: { kind: 'asset', asset: 'sounds' },
        default: '',
      },
      { key: 'volume', label: e('Background volume', 'Громкость фона'), type: { kind: 'number', min: 0, max: 4, step: 0.1 }, default: 1 },
    ],
  },
  {
    name: 'npc',
    label: e('Creature', 'Существо'),
    description: e(
      'A character with a mind of its own: an enemy that hunts the player, a friend who follows them (press E), or a bystander who fights back if hurt. Shots and blasts hurt it. Give it a Model to show it.',
      'Персонаж со своим поведением: враг, который охотится на игрока, друг, который идёт за ним (E), или нейтральный, который даёт сдачи. Выстрелы и взрывы его ранят. Добавьте Модель, чтобы его было видно.',
    ),
    appliesTo: 'point',
    conflicts: ['rigidBody', 'collider', 'train', 'pathPoint', 'playerSpawn'],
    fields: [
      {
        key: 'side', group: e('Behaviour', 'Поведение'),
        label: e('Is', 'Кто'),
        type: {
          kind: 'enum',
          options: [
            { value: 'hostile', label: e('An enemy', 'Враг') },
            { value: 'friendly', label: e('A friend', 'Друг') },
            { value: 'neutral', label: e('Neutral', 'Нейтральный') },
          ],
        },
        default: 'hostile',
      },
      { key: 'health', group: e('Health and movement', 'Здоровье и движение'), label: e('Health', 'Здоровье'), type: { kind: 'number', min: 1, step: 10 }, default: 50 },
      { key: 'speed', group: e('Health and movement', 'Здоровье и движение'), label: e('Speed', 'Скорость'), type: { kind: 'number', min: 0, step: 10, unit: 'u/s' }, default: 150 },
      { key: 'sight', group: e('Health and movement', 'Здоровье и движение'), label: e('Sees up to', 'Видит на'), type: { kind: 'number', min: 64, step: 64, unit: 'u' }, default: 1024 },
      {
        key: 'attack', group: e('Attack', 'Атака'),
        label: e('Attacks', 'Атакует'),
        type: {
          kind: 'enum',
          options: [
            { value: 'melee', label: e('Up close', 'Вблизи') },
            { value: 'shoot', label: e('Shooting', 'Стреляя') },
            { value: 'none', label: e('Never', 'Никогда') },
          ],
        },
        default: 'melee',
      },
      { key: 'damage', group: e('Attack', 'Атака'), label: e('Damage', 'Урон'), type: { kind: 'number', min: 0, step: 1 }, default: 10, when: { key: 'attack', is: ['melee', 'shoot'] } },
      { key: 'rate', group: e('Attack', 'Атака'), label: e('Attacks a second', 'Атак в секунду'), type: { kind: 'number', min: 0.1, step: 0.5 }, default: 1, when: { key: 'attack', is: ['melee', 'shoot'] } },
      { key: 'reach', group: e('Attack', 'Атака'), label: e('Reach', 'Дотягивается'), type: { kind: 'number', min: 16, step: 8, unit: 'u' }, default: 64, when: { key: 'attack', is: ['melee'] } },
      { key: 'spread', group: e('Attack', 'Атака'), label: e('Aim spread', 'Разброс'), hint: e('Degrees: higher misses more.', 'В градусах: больше — чаще промахивается.'), type: { kind: 'number', min: 0, step: 1, unit: '°' }, default: 4, when: { key: 'attack', is: ['shoot'] } },
      {
        key: 'wander', group: e('Behaviour', 'Поведение'),
        label: e('Wanders about', 'Бродит'),
        hint: e('Pottering near where it started, stopping to peck or sniff (its busy animation).', 'Ходит около места, где стоял, останавливаясь клевать или нюхать (анимация «занят»).'),
        type: { kind: 'boolean' },
        default: false,
      },
      {
        key: 'flee', group: e('Behaviour', 'Поведение'),
        label: e('Runs away', 'Убегает'),
        type: {
          kind: 'enum',
          options: [
            { value: 'never', label: e('Never', 'Никогда') },
            { value: 'hurt', label: e('When hurt', 'Когда ранен') },
            { value: 'near', label: e('When the player comes near', 'Когда игрок рядом') },
          ],
        },
        default: 'never',
      },
      { key: 'clumsy', group: e('Behaviour', 'Поведение'), label: e('Clumsy', 'Неуклюжий'), hint: e('Weaves as it goes and stumbles now and then.', 'Петляет на ходу и иногда спотыкается.'), type: { kind: 'boolean' }, default: false },
      { key: 'height', group: e('Body', 'Тело'), label: e('Height', 'Рост'), type: { kind: 'number', min: 8, step: 4, unit: 'u' }, default: 72 },
      { key: 'radius', group: e('Body', 'Тело'), label: e('Thickness', 'Толщина'), hint: e('Half its width (for bumping into things).', 'Половина ширины (для столкновений).'), type: { kind: 'number', min: 2, step: 2, unit: 'u' }, default: 16 },
      {
        key: 'anims', group: e('Body', 'Тело'),
        label: e('Animations', 'Анимации'),
        hint: e(
          'Names in its model for standing, walking, attacking, dying, running, being busy, being hurt and pulling the player out of hiding, separated by commas. Leave out what it hasn’t got.',
          'Имена анимаций модели: стоит, идёт, атакует, погибает, бежит, занят, ранен, вытаскивает игрока из укрытия — через запятую. Чего нет, не пишите.',
        ),
        type: { kind: 'text' },
        default: 'idle, walk, attack, die',
      },
      {
        key: 'pull', group: e('Attack', 'Атака'),
        label: e('Pulling out takes', 'Вытаскивает за'),
        hint: e('Seen going into a hiding spot, the player is pulled out; it attacks this long after.', 'Если видел, как игрок спрятался, вытаскивает его и атакует через это время.'),
        type: { kind: 'number', min: 0, step: 0.1, unit: 's' },
        default: 0.8,
      },
      {
        key: 'mind', group: e('Behaviour', 'Поведение'),
        label: e('Mind', 'Разум'),
        hint: e(
          'Hunter: as an enemy it wanders, investigates sounds and hints, searches the area and its hiding spots, and only knows what it sees and hears.',
          'Охотник: как враг бродит, проверяет звуки и подсказки, обыскивает местность и укрытия и знает только то, что видит и слышит.',
        ),
        type: { kind: 'enum', options: [{ value: 'simple', label: e('Simple', 'Простой') }, { value: 'hunter', label: e('Hunter', 'Охотник') }] },
        default: 'simple',
      },
      ...hunterFields(),
    ],
  },
  {
    name: 'hidingSpot',
    label: e('Hiding spot', 'Укрытие'),
    description: e(
      'A locker, a wardrobe, a gap under a plank: E gets in and out. Creatures can’t see the player inside unless they saw them get in.',
      'Шкафчик, шкаф, щель под доской: E — залезть и вылезти. Существа не видят игрока внутри, если не видели, как он туда залез.',
    ),
    appliesTo: 'any',
    conflicts: ['seat', 'rigidBody', 'trigger', 'soundArea', 'water', 'ladder', 'npc'],
    fields: [
      {
        key: 'kind',
        label: e('Kind', 'Вид'),
        hint: e('How a hunting creature checks it.', 'Как охотник его проверяет.'),
        type: {
          kind: 'enum',
          options: [
            { value: 'locker', label: e('Locker', 'Шкафчик') },
            { value: 'wardrobe', label: e('Wardrobe', 'Шкаф') },
            { value: 'cabinet', label: e('Cabinet', 'Тумба') },
            { value: 'under', label: e('Under something (a bed, a plank)', 'Под чем-то (кровать, доска)') },
            { value: 'box', label: e('Box', 'Коробка') },
            { value: 'other', label: e('Other', 'Другое') },
          ],
        },
        default: 'locker',
      },
      { key: 'prompt', label: e('Prompt', 'Подсказка'), type: { kind: 'text' }, default: 'Hide' },
      { key: 'reach', label: e('Reach', 'Дотянуться'), hint: e('How close the player must be to get in with E.', 'Как близко нужно подойти, чтобы залезть по E.'), type: { kind: 'number', min: 16, step: 8, unit: 'u' }, default: 96 },
      {
        key: 'view',
        label: e('Look from', 'Смотреть из'),
        hint: e('An object placed and turned where the eyes go (looking along its −Z). Empty: this object.', 'Объект, поставленный и повёрнутый туда, где глаза (смотрит по −Z). Пусто — этот объект.'),
        type: { kind: 'object' },
        default: '',
      },
      { key: 'offset', label: e('Eyes at', 'Глаза в'), hint: e('From that object, in its own axes.', 'От этого объекта, в его осях.'), type: { kind: 'vec3', step: 4 }, default: [0, 0, 0] },
      { key: 'side', label: e('Look left and right', 'Смотреть влево-вправо'), hint: e('0: the view is fixed (looking through slats).', '0 — взгляд неподвижен (сквозь щели).'), type: { kind: 'number', min: 0, max: 180, step: 5, unit: '°' }, default: 0 },
      { key: 'upDown', label: e('Look up and down', 'Смотреть вверх-вниз'), type: { kind: 'number', min: 0, max: 89, step: 5, unit: '°' }, default: 0 },
      { key: 'time', label: e('Getting in takes', 'Залезает за'), type: { kind: 'number', min: 0, max: 2, step: 0.05, unit: 's' }, default: 0.25 },
    ],
  },
  {
    name: 'seat',
    label: e('Seat', 'Сиденье'),
    description: e('A chair, a bench, a sofa: E sits down and gets up. Creatures still see the player.', 'Стул, скамья, диван: E — сесть и встать. Существа видят игрока.'),
    appliesTo: 'any',
    conflicts: ['hidingSpot', 'trigger', 'soundArea', 'water', 'ladder', 'npc'],
    fields: [
      {
        key: 'key',
        label: e('Key', 'Клавиша'),
        hint: e('Another key than E lets E pick it up (with Physics) and this key sit on it.', 'Не E: тогда E берёт его (с физикой), а эта клавиша сажает.'),
        type: { kind: 'enum', options: ['E', 'F', 'G', 'Q', 'X', 'Z'].map((k) => ({ value: `Key${k}`, label: e(k, k) })) },
        default: 'KeyE',
      },
      { key: 'prompt', label: e('Prompt', 'Подсказка'), type: { kind: 'text' }, default: 'Sit' },
      { key: 'reach', label: e('Reach', 'Дотянуться'), type: { kind: 'number', min: 16, step: 8, unit: 'u' }, default: 96 },
      {
        key: 'view',
        label: e('Look from', 'Смотреть из'),
        hint: e('An object placed and turned where the eyes go (looking along its −Z). Empty: this object.', 'Объект, поставленный и повёрнутый туда, где глаза (смотрит по −Z). Пусто — этот объект.'),
        type: { kind: 'object' },
        default: '',
      },
      { key: 'offset', label: e('Eyes at', 'Глаза в'), hint: e('From that object, in its own axes.', 'От этого объекта, в его осях.'), type: { kind: 'vec3', step: 4 }, default: [0, 48, 0] },
      { key: 'side', label: e('Look left and right', 'Смотреть влево-вправо'), type: { kind: 'number', min: 0, max: 180, step: 5, unit: '°' }, default: 70 },
      { key: 'upDown', label: e('Look up and down', 'Смотреть вверх-вниз'), type: { kind: 'number', min: 0, max: 89, step: 5, unit: '°' }, default: 50 },
      { key: 'time', label: e('Sitting down takes', 'Садится за'), type: { kind: 'number', min: 0, max: 2, step: 0.05, unit: 's' }, default: 0.4 },
    ],
  },
  {
    name: 'poster',
    label: e('Poster or painting', 'Постер или картина'),
    description: e(
      'A picture the player picks up and hangs: carried against a wall, it sticks there flat (Use takes it down again). A poster that rolls is a scroll until it is hung (its Model, if it has one, is the scroll); a painting stays flat. It brings its own physics: Physics and Collision shape on it are not used.',
      'Картинка, которую игрок берёт и вешает: если прижать к стене, она прилипает плоско («Использовать» снимает). Сворачивающийся постер — свиток, пока не повешен (его Модель, если есть, и есть свиток); картина остаётся плоской. Физика своя: компоненты Физика и Форма столкновений на нём не используются.',
    ),
    appliesTo: 'point',
    conflicts: ['npc', 'seat', 'hidingSpot', 'light'],
    fields: [
      { key: 'picture', label: e('Picture', 'Изображение'), type: { kind: 'material' }, default: '' },
      { key: 'width', label: e('Width', 'Ширина'), type: { kind: 'number', min: 4, step: 4, unit: 'u' }, default: 32 },
      { key: 'height', label: e('Height', 'Высота'), type: { kind: 'number', min: 4, step: 4, unit: 'u' }, default: 48 },
      { key: 'rolls', label: e('Rolls up', 'Сворачивается'), hint: e('On: a scroll until hung (a poster). Off: always flat (a painting).', 'Вкл.: свиток, пока не повешен (постер). Выкл.: всегда плоская (картина).'), type: { kind: 'boolean' }, default: true },
      {
        key: 'scrollModel',
        label: e('Scroll model', 'Модель свитка'),
        hint: e('How it looks rolled up: a model lying along X, centred. Empty: the object’s Model, or else a plain cylinder. ', 'Как выглядит свёрнутым: модель вдоль X, по центру. Пусто — Модель объекта, иначе простой цилиндр.'),
        type: { kind: 'asset', asset: 'models' },
        default: '',
        when: { key: 'rolls', is: [true] },
      },
      { key: 'scrollScale', label: e('Scroll scale', 'Масштаб свитка'), hint: e('Size of the scroll model. Does not change the hung size.', 'Размер модели свитка. Не меняет размер в повешенном виде.'), type: { kind: 'number', min: 0.01, step: 0.1 }, default: 1, when: { key: 'rolls', is: [true] } },
      {
        key: 'scrollCollision',
        label: e('Scroll collision', 'Столкновения свитка'),
        hint: e('Cylinder: a plain tube. Box or Hull: from the scroll model.', 'Цилиндр: простая труба. Коробка или Оболочка: по модели свитка.'),
        type: { kind: 'enum', options: [{ value: 'cylinder', label: e('Cylinder', 'Цилиндр') }, { value: 'box', label: e('Box', 'Коробка') }, { value: 'hull', label: e('Hull', 'Оболочка') }] },
        default: 'cylinder',
        when: { key: 'rolls', is: [true] },
      },
      { key: 'thickness', label: e('Thickness', 'Толщина'), hint: e('Flat, from the wall out.', 'В плоском виде, от стены.'), type: { kind: 'number', min: 0.5, step: 0.5, unit: 'u' }, default: 0.5 },
      { key: 'frame', label: e('Frame / back', 'Рамка / оборот'), hint: e('The colour of the edges, the back and the rolled scroll.', 'Цвет краёв, оборота и свёрнутого свитка.'), type: { kind: 'color' }, default: '#e8e2d4' },
      { key: 'mass', label: e('Weight', 'Вес'), type: { kind: 'number', min: 0.01, max: 50, step: 0.5, unit: 'kg' }, default: 0.5 },
      { key: 'hungAtStart', label: e('Hung at start', 'Повешена в начале'), hint: e('Starts flat and fixed where it is placed (put it against a wall, picture out).', 'Начинает плоской и неподвижной на своём месте (поставьте у стены, картинкой наружу).'), type: { kind: 'boolean' }, default: false },
    ],
  },
  {
    name: 'printer',
    label: e('3D printer', '3D-принтер'),
    description: e(
      'Prints copies of objects layer by layer: the Print block (Objects) puts a copy of an object on it, the print rises from the plate and the head traces each layer; when it is done the copy is a normal object (it can be picked up) and “When a print is done” runs. It prints one thing at a time: while printing, or with anything in its print space, Print blocks are ignored. Its Model is the printer (Add › 3D printer brings a ready-made one); the parts named below move.',
      'Печатает копии объектов слой за слоем: блок «Напечатать» (Объекты) ставит на него копию объекта, печать растёт от стола, а головка обводит каждый слой; когда готово, копия становится обычным объектом (её можно взять) и срабатывает «Когда печать готова». Печатает по одной вещи: пока печатает или пока в области печати что-то есть, блоки «Напечатать» не срабатывают. Его Модель и есть принтер («Добавить › 3D-принтер» ставит готовый); названные ниже части двигаются.',
    ),
    appliesTo: 'point',
    conflicts: ['poster', 'npc', 'seat', 'hidingSpot', 'stake'],
    fields: [
      { key: 'size', label: e('Print space', 'Область печати'), hint: e('Width, height and depth of what fits.', 'Ширина, высота и глубина того, что помещается.'), type: { kind: 'vec3', step: 4, min: 4 }, default: [40, 56, 40] },
      { key: 'bed', label: e('Build plate', 'Стол'), hint: e('The middle of the plate’s top, from the object’s origin.', 'Середина верха стола от начала объекта.'), type: { kind: 'vec3', step: 1 }, default: [0, 6.3, 0] },
      { key: 'layerHeight', label: e('Layer height', 'Высота слоя'), type: { kind: 'number', min: 0.1, step: 0.25, unit: 'u' }, default: 1 },
      { key: 'layerSeconds', label: e('Each layer takes', 'Слой печатается за'), type: { kind: 'number', min: 0.02, step: 0.05, unit: 's' }, default: 0.4 },
      { key: 'filament', label: e('Filament colour', 'Цвет пластика'), hint: e('The cut top of a print and the layer just laid.', 'Срез печати сверху и только что уложенный слой.'), type: { kind: 'color' }, default: '#1d9e75' },
      { key: 'head', label: e('Head part', 'Часть «головка»'), hint: e('In its Model: the part with the nozzle; moves left-right (the nozzle’s lowest point is found by itself). Empty: none.', 'В Модели: часть с соплом; ходит влево-вправо (нижняя точка сопла находится сама). Пусто — нет.'), type: { kind: 'text' }, default: 'head', group: e('Moving parts', 'Подвижные части') },
      { key: 'gantry', label: e('Gantry part', 'Часть «портал»'), hint: e('In its Model: the bar the head rides; moves front-back (and up with the layers, unless it is inside the lift). Empty: none.', 'В Модели: балка, по которой ходит головка; ходит вперёд-назад (и вверх со слоями, если не внутри подъёмника). Пусто — нет.'), type: { kind: 'text' }, default: 'gantry', group: e('Moving parts', 'Подвижные части') },
      { key: 'lift', label: e('Lift part', 'Часть «подъёмник»'), hint: e('In its Model: the frame that climbs one layer at a time (up only), carrying the gantry. Empty: none.', 'В Модели: рама, что поднимается на слой за раз (только вверх) и несёт портал. Пусто — нет.'), type: { kind: 'text' }, default: 'lift', group: e('Moving parts', 'Подвижные части') },
      { key: 'sound', label: e('Printing sound', 'Звук печати'), hint: e('Loops while it prints.', 'Звучит по кругу во время печати.'), type: { kind: 'asset', asset: 'sounds' }, default: '' },
      { key: 'volume', label: e('Volume', 'Громкость'), type: { kind: 'number', min: 0, max: 4, step: 0.1 }, default: 1 },
    ],
  },
  {
    name: 'stake',
    label: e('Sticks in the ground', 'Втыкается в землю'),
    description: e(
      'A prop that sticks into the ground at a slight random lean when it hits it hard enough, tip first (a sign, a stake). Picking it up pulls it out. Needs Physics.',
      'Предмет, который втыкается в землю под небольшим случайным наклоном, если ударить им достаточно сильно остриём вниз (табличка, кол). Если поднять, он вытаскивается. Нужна Физика.',
    ),
    appliesTo: 'point',
    conflicts: ['poster', 'npc', 'seat', 'hidingSpot', 'junk'],
    fields: [
      {
        key: 'tip',
        label: e('Tip', 'Остриё'),
        hint: e('The end that goes into the ground.', 'Конец, который входит в землю.'),
        type: { kind: 'enum', options: [{ value: 'bottom', label: e('Bottom', 'Низ') }, { value: 'top', label: e('Top', 'Верх') }, { value: 'front', label: e('Front', 'Перед') }, { value: 'back', label: e('Back', 'Зад') }] },
        default: 'bottom',
      },
      { key: 'speed', label: e('Sticks from', 'Втыкается от'), hint: e('How fast it must hit the ground.', 'С какой скоростью нужно ударить о землю.'), type: { kind: 'number', min: 0, step: 16, unit: 'u/s' }, default: 160 },
      { key: 'depth', label: e('Depth', 'Глубина'), type: { kind: 'number', min: 0, step: 1, unit: 'u' }, default: 6 },
      { key: 'tilt', label: e('Lean', 'Наклон'), hint: e('Up to this much off straight, at random.', 'Случайно, не больше этого.'), type: { kind: 'number', min: 0, max: 45, step: 1, unit: '°' }, default: 10 },
    ],
  },
  {
    name: 'junk',
    label: e('Packs up (junk, carpet)', 'Сворачивается (хлам, ковёр)'),
    description: e(
      'Junk or a carpet: its Model is how it lies on the floor (a pile, a flat carpet), solid and fixed in place, so nothing pushes it. Picked up, it is packed into its Packed model (a bundle, a roll) and collides as that; dropped or thrown, it lies down again, upright, where it lands. Needs Physics.',
      'Хлам или ковёр: его Модель — как он лежит на полу (куча, расстеленный ковёр), твёрдый и неподвижный, его ничто не сдвинет. Если поднять, он сворачивается в Модель в связке (связка, рулон) и сталкивается как она; брошенный, снова ложится там, где упал. Нужна Физика.',
    ),
    appliesTo: 'point',
    pointNeeds: 'model',
    conflicts: ['poster', 'npc', 'seat', 'hidingSpot', 'stake', 'printer', 'extender', 'stringLights'],
    fields: [
      {
        key: 'packed',
        label: e('Packed model', 'Свёрнутая модель'),
        hint: e('How it looks while carried: a bundle, a rolled-up carpet (same origin and units as its Model; put the origin at the bottom of both). Empty: it stays a pile.', 'Как выглядит в руках (то же начало и единицы, что у Модели; начало внизу у обеих). Пусто — остаётся кучей.'),
        type: { kind: 'asset', asset: 'models' },
        default: '',
      },
    ],
  },
  {
    name: 'powerSource',
    label: e('Power source', 'Источник питания'),
    description: e(
      'A generator or a breaker: outlets wired to it are live while it is on. Use switches it; scripts can Turn it on or off.',
      'Генератор или рубильник: подключённые к нему розетки под током, пока он включён. «Использовать» переключает; скрипты могут включать и выключать.',
    ),
    appliesTo: 'any',
    conflicts: ['trigger', 'soundArea', 'water', 'levelChange'],
    fields: [{ key: 'on', label: e('On at start', 'Включён в начале'), type: { kind: 'boolean' }, default: true }],
  },
  {
    name: 'outlet',
    label: e('Outlet', 'Розетка'),
    description: e(
      'A wall outlet: hold a plug (an extension cord, string lights) and Use it here to plug in or pull out. Live while its power source is on.',
      'Розетка: держа вилку (удлинитель, гирлянду), нажмите «Использовать» на ней, чтобы включить или вынуть. Под током, пока включён её источник.',
    ),
    appliesTo: 'any',
    conflicts: ['extender', 'stringLights', 'trigger', 'soundArea', 'water', 'levelChange', 'rigidBody'],
    fields: [
      {
        key: 'source',
        label: e('Power source', 'Источник питания'),
        hint: e('A generator or breaker (empty: always live).', 'Генератор или рубильник (пусто — всегда под током).'),
        type: { kind: 'object', component: 'powerSource' },
        default: '',
      },
    ],
  },
  {
    name: 'extender',
    label: e('Extension cord', 'Удлинитель'),
    description: e(
      'A carryable extension cord: hold it and Use an outlet (or another cord) to plug it in; then plug things into it. Pulled further than its cable, it comes unplugged. Needs Physics.',
      'Переносной удлинитель: держа его, нажмите «Использовать» на розетке (или другом удлинителе), чтобы включить; потом включайте в него. Если утащить дальше кабеля — выдернется. Нужна Физика.',
    ),
    appliesTo: 'point',
    conflicts: ['outlet', 'stringLights', 'junk', 'stake', 'poster'],
    fields: [{ key: 'cable', label: e('Cable', 'Кабель'), type: { kind: 'number', min: 16, step: 16, unit: 'u' }, default: 256 }],
  },
  {
    name: 'stringLights',
    label: e('String lights', 'Гирлянда'),
    description: e(
      'Carried as a coil (its Model, or a box). Holding it: Use a socket to plug it in, then Use a wall or ceiling for one end and again for the other. Lit while plugged into something live. Use the hung lights to take them down. Needs Physics.',
      'Носится мотком (её Модель или коробка). Держа её: «Использовать» на розетке — включить, затем на стене или потолке — один конец, ещё раз — другой. Горит, пока включена во что-то под током. «Использовать» на висящей гирлянде — снять. Нужна Физика.',
    ),
    appliesTo: 'point',
    conflicts: ['outlet', 'extender', 'junk', 'stake', 'poster'],
    fields: [
      { key: 'color', label: e('Bulb colour', 'Цвет лампочек'), type: { kind: 'color' }, default: '#ffc46b' },
      { key: 'spacing', label: e('Bulb spacing', 'Шаг лампочек'), type: { kind: 'number', min: 2, step: 1, unit: 'u' }, default: 12 },
      { key: 'length', label: e('Longest span', 'Наибольший пролёт'), type: { kind: 'number', min: 16, step: 16, unit: 'u' }, default: 320 },
      { key: 'cable', label: e('Plug cable', 'Кабель вилки'), hint: e('How far the plug reaches from the first end.', 'Как далеко вилка достаёт от первого конца.'), type: { kind: 'number', min: 8, step: 8, unit: 'u' }, default: 160 },
      { key: 'sag', label: e('Sag', 'Провис'), hint: e('How far the middle hangs, for each 100 u of span.', 'Насколько провисает середина на каждые 100 ед. пролёта.'), type: { kind: 'number', min: 0, step: 1, unit: 'u' }, default: 10 },
      { key: 'lights', label: e('Lights cast', 'Источников света'), hint: e('Spread along it; more cost more (0: the bulbs only glow).', 'Распределены по ней; больше — дороже (0: лампочки только светятся).'), type: { kind: 'number', min: 0, max: 4, step: 1 }, default: 2 },
      { key: 'intensity', label: e('Brightness', 'Яркость'), type: { kind: 'number', min: 0, step: 0.1 }, default: 0.8 },
      { key: 'range', label: e('Light range', 'Дальность света'), type: { kind: 'number', min: 16, step: 16, unit: 'u' }, default: 384 },
    ],
  },
  {
    name: 'levelChange',
    label: e('Level change', 'Смена уровня'),
    description: e(
      'A zone that takes the player to another scene when they walk in, keeping their health, armour, items, score and game values. With a landmark, they arrive just where they were relative to it.',
      'Зона, которая переносит игрока в другую сцену, когда он в неё входит; здоровье, броня, предметы, счёт и игровые значения сохраняются. С ориентиром игрок появляется там же относительно него.',
    ),
    appliesTo: 'brush',
    conflicts: ['rigidBody', 'trigger', 'water', 'ladder', 'conveyor', 'train'],
    fields: [
      { key: 'scene', label: e('Goes to', 'Ведёт в'), type: { kind: 'scene' }, default: '' },
      {
        key: 'landmark',
        label: e('Landmark', 'Ориентир'),
        hint: e(
          'The name of an object with the Landmark component in both scenes, at the same spot of the shared corridor (empty: arrive at the Player start).',
          'Имя объекта с компонентом «Ориентир» в обеих сценах, в одном и том же месте общего коридора (пусто — появиться у старта игрока).',
        ),
        type: { kind: 'text' },
        default: '',
      },
    ],
  },
  {
    name: 'landmark',
    label: e('Landmark', 'Ориентир'),
    description: e(
      'A point both scenes of a level change share, found by its object name: the player keeps where they stand relative to it.',
      'Точка, общая для двух сцен при смене уровня (по имени объекта): игрок сохраняет своё положение относительно неё.',
    ),
    appliesTo: 'point',
    fields: [],
  },
  {
    name: 'reflectionProbe',
    label: e('Reflection probe', 'Зонд отражений'),
    description: e(
      'Shiny surfaces inside this box reflect what this point sees, fitted to the box (so walls and floors reflect where they really are). Put one in a room; rooms are also found automatically.',
      'Блестящие поверхности в этой коробке отражают то, что видно из этой точки, с подгонкой под коробку (стены и пол отражаются там, где они есть). Ставьте по одному на комнату; комнаты находятся и сами.',
    ),
    appliesTo: 'point',
    fields: [{ key: 'size', label: e('Box size', 'Размер коробки'), type: { kind: 'vec3', step: 16, min: 16 }, default: [256, 128, 256] }],
  },
  {
    name: 'pathPoint',
    label: e('Path point', 'Точка пути'),
    description: e(
      'A point on a path that trains follow, to the next point. Chain points to make a route; point the last back at the first for a loop.',
      'Точка пути, по которому едут поезда, — к следующей точке. Соедините точки в маршрут; укажите у последней первую, чтобы замкнуть круг.',
    ),
    appliesTo: 'point',
    fields: [
      { key: 'next', label: e('Next point', 'Следующая точка'), type: { kind: 'object', component: 'pathPoint' }, default: '' },
      { key: 'speed', label: e('New speed', 'Новая скорость'), hint: e('From here on (0: keep the speed).', 'Отсюда и дальше (0 — не менять).'), type: { kind: 'number', min: 0, step: 10, unit: 'u/s' }, default: 0 },
      { key: 'wait', label: e('Wait here', 'Ждать здесь'), type: { kind: 'number', min: 0, step: 0.5, unit: 's' }, default: 0 },
      {
        key: 'message',
        label: e('Message when reached', 'Сообщение по прибытии'),
        hint: e('Sent to every script when a train gets here (empty: none).', 'Отправляется всем скриптам, когда сюда приходит поезд (пусто — нет).'),
        type: { kind: 'text' },
        default: '',
      },
    ],
  },
  {
    name: 'train',
    label: e('Train', 'Поезд'),
    description: e(
      'Moves this object along a path, point to point, carrying the player. It starts at the first point. Start and Stop blocks control it.',
      'Ведёт объект по пути от точки к точке и везёт игрока. Начинает с первой точки. Блоки «Запустить» и «Остановить» им управляют.',
    ),
    appliesTo: 'any',
    conflicts: ['rigidBody', 'trigger', 'water', 'ladder'],
    fields: [
      { key: 'start', label: e('First point', 'Первая точка'), type: { kind: 'object', component: 'pathPoint' }, default: '' },
      { key: 'speed', label: e('Speed', 'Скорость'), type: { kind: 'number', min: 1, step: 10, unit: 'u/s' }, default: 100 },
      { key: 'moving', label: e('Moves at the start', 'Едет с начала'), type: { kind: 'boolean' }, default: true },
      {
        key: 'turns',
        label: e('Turns to face its way', 'Поворачивается по ходу'),
        hint: e('Build it facing −Z (forward); it turns left and right to follow the path.', 'Стройте его лицом к −Z (вперёд); он поворачивает влево и вправо по пути.'),
        type: { kind: 'boolean' },
        default: false,
      },
    ],
  },
  {
    name: 'particles',
    label: e('Particles', 'Частицы'),
    description: e(
      'Smoke, fire, sparks, steam or dust coming from this point, upwards (+Y) — turn the object to aim it. Turn on and Turn off blocks start and stop it.',
      'Дым, огонь, искры, пар или пыль из этой точки вверх (+Y) — поверните объект, чтобы направить. Блоки «Включить» и «Выключить» запускают и останавливают.',
    ),
    appliesTo: 'point',
    fields: [
      {
        key: 'kind',
        label: e('What', 'Что'),
        type: {
          kind: 'enum',
          options: [
            { value: 'smoke', label: e('Smoke', 'Дым') },
            { value: 'fire', label: e('Fire', 'Огонь') },
            { value: 'sparks', label: e('Sparks', 'Искры') },
            { value: 'steam', label: e('Steam', 'Пар') },
            { value: 'dust', label: e('Dust', 'Пыль') },
          ],
        },
        default: 'smoke',
      },
      { key: 'rate', label: e('Per second', 'В секунду'), type: { kind: 'number', min: 0, step: 5 }, default: 20 },
      { key: 'size', label: e('Size', 'Размер'), type: { kind: 'number', min: 0.1, step: 0.25, unit: '×' }, default: 1 },
      { key: 'speed', label: e('Speed', 'Скорость'), type: { kind: 'number', min: 0, step: 0.25, unit: '×' }, default: 1 },
      { key: 'on', label: e('On at the start', 'Включено в начале'), type: { kind: 'boolean' }, default: true },
    ],
  },
  {
    name: 'vfx',
    label: e('Effect', 'Эффект'),
    description: e(
      'Plays one of the project’s effects (made in the VFX workspace) here, moving with the object. Turn on and Turn off blocks start and stop it; the Play effect block plays one anywhere.',
      'Проигрывает здесь эффект проекта (из раздела «Эффекты») и движется с объектом. Блоки «Включить» и «Выключить» запускают и останавливают его; блок «Показать эффект» проигрывает эффект где угодно.',
    ),
    appliesTo: 'any',
    fields: [
      { key: 'effect', label: e('Effect', 'Эффект'), type: { kind: 'effect' }, default: '' },
      { key: 'on', label: e('On at the start', 'Включено в начале'), type: { kind: 'boolean' }, default: true },
      { key: 'loop', label: e('Repeat', 'Повторять'), hint: e('Play again and again while on (looping effects always repeat).', 'Играть снова и снова, пока включено (зацикленные эффекты повторяются всегда).'), type: { kind: 'boolean' }, default: true },
      { key: 'offset', label: e('Offset', 'Смещение'), hint: e('Where it plays, from the object’s pivot.', 'Где он играет, от центра объекта.'), type: { kind: 'vec3', step: 1 }, default: [0, 0, 0] },
    ],
  },
  {
    name: 'charger',
    label: e('Charger', 'Зарядник'),
    description: e(
      'A wall charger, as in Half-Life: while the player holds Use on it, it gives health or armour until it runs dry.',
      'Настенный зарядник, как в Half-Life: пока игрок держит «Использовать», он даёт здоровье или броню, пока не опустеет.',
    ),
    appliesTo: 'any',
    fields: [
      {
        key: 'gives',
        label: e('Gives', 'Даёт'),
        type: {
          kind: 'enum',
          options: [
            { value: 'health', label: e('Health', 'Здоровье') },
            { value: 'armour', label: e('Armour', 'Броню') },
          ],
        },
        default: 'health',
      },
      { key: 'capacity', label: e('Holds', 'Запас'), hint: e('How much it gives in all before it is empty.', 'Сколько всего он отдаст, прежде чем опустеет.'), type: { kind: 'number', min: 1, step: 5 }, default: 50 },
      { key: 'rate', label: e('Per second', 'В секунду'), type: { kind: 'number', min: 1, step: 1 }, default: 10 },
    ],
  },
  {
    name: 'repeat',
    label: e('Repeat', 'Повтор'),
    description: e(
      'Builds this group from a segment repeated to a length (ladders, pipes, railings, columns), with optional caps at each end. The copies are made when the scene is shown or played; only the parts are saved.',
      'Строит эту группу из сегмента, повторённого на нужную длину (лестницы, трубы, перила, колонны), с концами по желанию. Копии делаются при показе и игре; сохраняются только части.',
    ),
    appliesTo: 'point',
    fields: [
      { key: 'segment', label: e('Segment', 'Сегмент'), hint: e('The part to repeat: a child of this group (a brush, a group or a model).', 'Повторяемая часть: потомок этой группы (браш, группа или модель).'), type: { kind: 'object' }, default: '' },
      { key: 'startCap', label: e('Start cap', 'Начало'), hint: e('Stays where it is, before the first segment (optional).', 'Остаётся на месте перед первым сегментом (необязательно).'), type: { kind: 'object' }, default: '' },
      { key: 'endCap', label: e('End cap', 'Конец'), hint: e('Placed as for one segment; it moves to the end as the length grows (optional).', 'Ставится как для одного сегмента; с ростом длины уходит к концу (необязательно).'), type: { kind: 'object' }, default: '' },
      {
        key: 'axis',
        label: e('Along', 'Вдоль'),
        type: { kind: 'enum', options: [{ value: 'up', label: e('Up', 'Вверх') }, { value: 'north', label: e('North', 'Север') }, { value: 'east', label: e('East', 'Восток') }] },
        default: 'up',
      },
      { key: 'length', label: e('Length', 'Длина'), hint: e('How long the repeated part is (drag the handle in the view).', 'Длина повторённой части (тяните ручку в окне).'), type: { kind: 'number', min: 1, step: 16, unit: 'u' }, default: 128 },
      {
        key: 'fit',
        label: e('Fit', 'Подгонка'),
        hint: e('Whole segments: the length snaps to a whole number of them. Stretch: the segments stretch a little to fit exactly.', 'Целые сегменты: длина округляется до целого числа. Растянуть: сегменты слегка растягиваются, чтобы точно уложиться.'),
        type: { kind: 'enum', options: [{ value: 'whole', label: e('Whole', 'Целые') }, { value: 'stretch', label: e('Stretch', 'Растянуть') }] },
        default: 'whole',
      },
      { key: 'gap', label: e('Gap', 'Зазор'), type: { kind: 'number', min: 0, step: 4, unit: 'u' }, default: 0 },
      { key: 'step', label: e('Segment size', 'Размер сегмента'), hint: e('0: measured from the segment’s brushes. Set it for models.', '0 — измерить по брашам сегмента. Задайте для моделей.'), type: { kind: 'number', min: 0, step: 4, unit: 'u' }, default: 0 },
    ],
  },
  {
    name: 'ladder',
    label: e('Ladder', 'Лестница'),
    description: e(
      'An invisible zone the player climbs: forward goes up while looking ahead or up, down while looking down. Jump lets go. Put it in front of what looks like a ladder.',
      'Невидимая зона, по которой игрок лезет: вперёд — вверх, если смотреть прямо или вверх, и вниз, если смотреть вниз. Прыжок — отпустить. Поставьте её перед тем, что выглядит как лестница.',
    ),
    appliesTo: 'brush',
    conflicts: ['rigidBody', 'trigger', 'conveyor', 'water'],
    fields: [{ key: 'speed', label: e('Climb speed', 'Скорость'), type: { kind: 'number', min: 10, step: 10, unit: 'u/s' }, default: 200 }],
  },
  {
    name: 'noRender',
    label: e('No Render', 'Не отображать'),
    description: e(
      'An asset park: when playing, every object whose centre is inside this zone is hidden and switched off (no drawing, physics, scripts, lights or sounds). Copies made from them come out whole and live. The editor still shows them.',
      'Склад ассетов: в игре каждый объект, центр которого внутри этой зоны, скрыт и выключен (не рисуется, без физики, скриптов, света и звука). Копии из них появляются целыми и рабочими. В редакторе они видны.',
    ),
    appliesTo: 'brush',
    conflicts: ['rigidBody', 'trigger', 'conveyor', 'water', 'ladder', 'soundArea', 'levelChange', 'train', 'breakable', 'charger', 'scatter', 'seat', 'hidingSpot'],
    fields: [],
  },
  {
    name: 'terrain',
    label: e('Terrain', 'Ландшафт'),
    description: e(
      'Ground you sculpt, dig and paint (Terrain tool): hills, cliffs, caves. Its shape is kept in its own file in the project; four layers colour it where they are painted.',
      'Земля, которую лепят, копают и раскрашивают (инструмент «Ландшафт»): холмы, скалы, пещеры. Форма хранится в отдельном файле проекта; четыре слоя красят её там, где нарисованы.',
    ),
    appliesTo: 'point',
    madeBy: 'add-menu',
    fields: [
      { key: 'file', label: e('Shape file', 'Файл формы'), hint: e('Where its shape is kept (set by the editor).', 'Где хранится форма (задаёт редактор).'), type: { kind: 'text' }, default: '' },
      { key: 'layer0', label: e('Layer 1', 'Слой 1'), type: { kind: 'color' }, default: '#5f8f3a' },
      { key: 'layer1', label: e('Layer 2', 'Слой 2'), type: { kind: 'color' }, default: '#8a6a45' },
      { key: 'layer2', label: e('Layer 3', 'Слой 3'), type: { kind: 'color' }, default: '#8c8c8c' },
      { key: 'layer3', label: e('Layer 4', 'Слой 4'), type: { kind: 'color' }, default: '#d9c58a' },
      { key: 'texture0', label: e('Layer 1 texture', 'Текстура слоя 1'), hint: e('A material or picture for the layer (its colour then tints nothing). None: plain colour.', 'Материал или картинка для слоя (цвет тогда не нужен). Нет — просто цвет.'), type: { kind: 'material' }, default: '' },
      { key: 'texture1', label: e('Layer 2 texture', 'Текстура слоя 2'), type: { kind: 'material' }, default: '' },
      { key: 'texture2', label: e('Layer 3 texture', 'Текстура слоя 3'), type: { kind: 'material' }, default: '' },
      { key: 'texture3', label: e('Layer 4 texture', 'Текстура слоя 4'), type: { kind: 'material' }, default: '' },
      { key: 'tile', label: e('Texture size', 'Размер текстуры'), hint: e('How big one repeat of a layer texture is on the ground.', 'Размер одного повтора текстуры слоя на земле.'), type: { kind: 'number', min: 8, step: 16, unit: 'u' }, default: 128 },
    ],
  },
  {
    name: 'plant',
    label: e('Plant', 'Растение'),
    description: e('Grows one of the project’s plants (made in the Plants workspace) here.', 'Выращивает здесь растение проекта (из раздела «Растения»).'),
    appliesTo: 'point',
    fields: [
      { key: 'plant', label: e('Plant', 'Растение'), type: { kind: 'plant' }, default: '' },
      { key: 'seed', label: e('Seed', 'Seed'), hint: e('Change it for a different one of the same kind.', 'Измените, чтобы получить другое растение того же вида.'), type: { kind: 'number', min: 0, step: 1 }, default: 1 },
    ],
  },
  {
    name: 'scatter',
    label: e('Foliage', 'Растительность'),
    description: e(
      'Covers the upward-facing surfaces of this brush, model or terrain with grass (except under objects standing on it, unless they let grass grow under them), and with Grass on top, paints a grass layer over its material there (fading out with the slope, in patches). Purely visual: nothing collides with them. The same seed always gives the same pattern.',
      'Покрывает травой верхние поверхности этого браша, модели или ландшафта, а с «Травой сверху» — рисует слой травы поверх его материала (сходит на нет по склону, пятнами). Только для вида: с ними ничего не сталкивается. Один и тот же seed всегда даёт один и тот же рисунок.',
    ),
    appliesTo: 'any',
    pointNeeds: ['terrain', 'model'],
    fields: [
      { key: 'spacing', group: e('Tufts', 'Пучки'), label: e('Spacing', 'Шаг'), hint: e('About how far apart the tufts are.', 'Примерно расстояние между пучками.'), type: { kind: 'number', min: 4, step: 2, unit: 'u' }, default: 10 },
      { key: 'density', group: e('Tufts', 'Пучки'), label: e('Density', 'Густота'), hint: e('How many spots get a tuft (1 = all).', 'Сколько мест получают пучок (1 = все).'), type: { kind: 'number', min: 0, max: 1, step: 0.05 }, default: 1 },
      { key: 'size', group: e('Tufts', 'Пучки'), label: e('Width', 'Ширина'), hint: e('How wide each tuft spreads.', 'Насколько широко раскидывается пучок.'), type: { kind: 'number', min: 2, step: 2, unit: 'u' }, default: 14 },
      { key: 'height', group: e('Tufts', 'Пучки'), label: e('Height', 'Высота'), hint: e('How tall the grass grows.', 'Насколько высока трава.'), type: { kind: 'number', min: 1, step: 2, unit: 'u' }, default: 14 },
      { key: 'slope', group: e('Where it grows', 'Где растёт'), label: e('Steepest', 'Круче'), hint: e('The steepest slope that grows tufts, in degrees.', 'Самый крутой склон, на котором растут пучки, в градусах.'), type: { kind: 'number', min: 0, max: 90, step: 5, unit: '°' }, default: 40 },
      { key: 'colour', group: e('Tufts', 'Пучки'), label: e('Colour', 'Цвет'), type: { kind: 'color' }, default: '#4f9a3c' },
      { key: 'seed', group: e('Tufts', 'Пучки'), label: e('Seed', 'Seed'), hint: e('Change it for a different pattern.', 'Измените для другого рисунка.'), type: { kind: 'number', min: 0, step: 1 }, default: 1 },
      {
        key: 'layer', group: e('Where it grows', 'Где растёт'),
        label: e('Grows on', 'Растёт на'),
        hint: e('On a terrain: only where this layer is painted.', 'На ландшафте: только там, где нарисован этот слой.'),
        type: { kind: 'enum', options: [{ value: 'all', label: e('Everywhere', 'Везде') }, { value: '0', label: e('Layer 1', 'Слой 1') }, { value: '1', label: e('Layer 2', 'Слой 2') }, { value: '2', label: e('Layer 3', 'Слой 3') }, { value: '3', label: e('Layer 4', 'Слой 4') }] },
        default: 'all',
      },
      { key: 'plant', group: e('Tufts', 'Пучки'), label: e('Plant', 'Растение'), hint: e('Grow one of your plants instead of plain tufts (its own colours).', 'Растить своё растение вместо простых пучков (со своими цветами).'), type: { kind: 'plant' }, default: '' },
      { key: 'cover', group: e('Grass on top', 'Трава сверху'), label: e('Grass on top', 'Трава сверху'), hint: e('Paint a grass layer over the material where it faces up (world up), so no bare ground shows between tufts; tufts grow only where it shows.', 'Рисовать слой травы поверх материала там, где поверхность смотрит вверх; пучки растут только там, где он виден.'), type: { kind: 'boolean' }, default: true },
      { key: 'coverColour', group: e('Grass on top', 'Трава сверху'), when: { key: 'cover', is: [true] }, label: e('Top colour', 'Цвет сверху'), type: { kind: 'color' }, default: '#3f7f2e' },
      { key: 'edge', group: e('Grass on top', 'Трава сверху'), when: { key: 'cover', is: [true] }, label: e('Edge softness', 'Мягкость края'), hint: e('Over how many degrees of slope the layer fades out.', 'На сколько градусов наклона слой сходит на нет.'), type: { kind: 'number', min: 1, max: 60, step: 1, unit: '°' }, default: 14 },
      { key: 'patches', group: e('Grass on top', 'Трава сверху'), when: { key: 'cover', is: [true] }, label: e('Bare patches', 'Проплешины'), hint: e('0: even cover; 1: plenty of bare patches.', '0: ровный покров; 1: много проплешин.'), type: { kind: 'number', min: 0, max: 1, step: 0.05 }, default: 0.25 },
      { key: 'patchSize', group: e('Grass on top', 'Трава сверху'), when: { key: 'cover', is: [true] }, label: e('Patch size', 'Размер пятен'), type: { kind: 'number', min: 20, step: 10, unit: 'u' }, default: 320 },
    ],
  },
  {
    name: 'water',
    label: e('Water', 'Вода'),
    description: e(
      'The player swims in it (forward follows the view, Jump rises, Crouch dives) and can drown; physics objects float. Its faces are drawn as they are painted: use a see-through material.',
      'В ней игрок плавает (вперёд — куда смотрит, прыжок — вверх, присесть — вниз) и может утонуть; физические объекты всплывают. Грани рисуются своим материалом: возьмите прозрачный.',
    ),
    appliesTo: 'brush',
    conflicts: ['rigidBody', 'trigger', 'conveyor', 'ladder'],
    fields: [
      { key: 'shallow', group: e('Look', 'Вид'), label: e('Shallow colour', 'Цвет на мели'), type: { kind: 'color' }, default: '#7fd8e6' },
      { key: 'deep', group: e('Look', 'Вид'), label: e('Deep colour', 'Цвет в глубине'), type: { kind: 'color' }, default: '#1f4fb0' },
      { key: 'depthLook', group: e('Look', 'Вид'), label: e('Deep from', 'Глубоко с'), hint: e('How deep the water is before it shows its deep colour.', 'С какой глубины вода показывает цвет глубины.'), type: { kind: 'number', min: 8, step: 16, unit: 'u' }, default: 192 },
      { key: 'foam', group: e('Look', 'Вид'), label: e('Foam', 'Пена'), hint: e('White foam along the shores and round whatever stands in it, and glints on the water.', 'Белая пена у берегов и вокруг всего, что стоит в воде, и блики.'), type: { kind: 'boolean' }, default: true },
      { key: 'tint', group: e('Look', 'Вид'), label: e('Colour under water', 'Цвет под водой'), type: { kind: 'color' }, default: '#28607a' },
      { key: 'clearness', group: e('Look', 'Вид'), label: e('Seeing distance', 'Видимость'), hint: e('How far the player sees under water.', 'Насколько далеко видно под водой.'), type: { kind: 'number', min: 32, step: 64, unit: 'u' }, default: 640 },
      { key: 'drowns', group: e('Swimming', 'Плавание'), label: e('Can drown', 'Можно утонуть'), hint: e('After 12 s under water the player loses 10 health a second.', 'Через 12 с под водой игрок теряет 10 здоровья в секунду.'), type: { kind: 'boolean' }, default: true },
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
  {
    name: 'smooth',
    label: e('Smooth shading', 'Сглаживание'),
    description: e('Faces meeting at a gentle angle shade as one surface (set in the brush’s Display section).', 'Грани под небольшим углом освещаются как одна поверхность (в разделе «Вид» браша).'),
    appliesTo: 'brush',
    internal: true,
    fields: [{ key: 'angle', label: e('Up to', 'До'), type: { kind: 'number', min: 1, max: 89, step: 5, unit: '°' }, default: 50 }],
  },
  {
    name: 'cuts',
    label: e('Cuts only', 'Режет только'),
    description: e('A subtract brush that cuts only the chosen brushes (set in its Brush section).', 'Вычитающий браш, который режет только выбранные браши (в разделе «Браш»).'),
    appliesTo: 'brush',
    internal: true,
    fields: [{ key: 'only', label: e('Brushes', 'Браши'), type: { kind: 'text' }, default: '' }],
  },
  { name: 'group', label: e('Group', 'Группа'), description: e('Holds other objects.', 'Содержит другие объекты.'), appliesTo: 'any', fields: [], internal: true },
  { name: 'pivot', label: e('Pivot', 'Опорная точка'), description: e('Where the object turns around.', 'Точка, вокруг которой объект вращается.'), appliesTo: 'any', fields: [], internal: true },
  { name: 'prefabLink', label: e('Prefab link', 'Связь с префабом'), description: e('Which prefab this object copies.', 'Какой префаб копирует объект.'), appliesTo: 'any', fields: [], internal: true },
];

const byName = new Map(COMPONENTS.map((c) => [c.name, c]));

/** The Hunter mind's settings (on the Creature component, shown when its Mind is Hunter). */
function hunterFields(): FieldDef[] {
  const when = { key: 'mind', is: ['hunter'] };
  const n = (key: string, group: Text, label: Text, def: number, type: Omit<Extract<FieldType, { kind: 'number' }>, 'kind'>, hint?: Text): FieldDef => ({ key, group, label, hint, default: def, when, type: { kind: 'number', ...type } });
  const sense = e('Hunting: senses', 'Охота: чувства');
  const roam = e('Hunting: wandering', 'Охота: блуждание');
  const look = e('Hunting: investigating and searching', 'Охота: проверка и поиск');
  const hide = e('Hunting: hiding spots', 'Охота: укрытия');
  const p = { min: 0, max: 1, step: 0.05 };
  return [
    n('hears', sense, e('Hears you up to', 'Слышит до'), 1000, { min: 0, step: 50, unit: 'u' }, e('How far it hears a sound of loudness 1 (louder sounds further, quieter ones less). Through walls, half as far.', 'Как далеко слышит звук громкостью 1 (громче — дальше, тише — ближе). Сквозь стены — вдвое ближе.')),
    n('feel', sense, e('Notices up close', 'Замечает вплотную'), 48, { min: 0, step: 8, unit: 'u' }, e('Notices the player this close even behind it.', 'Замечает игрока так близко даже за спиной.')),
    n('notice', sense, e('Investigates from', 'Проверяет от'), 0.25, p, e('How important (kind × sureness × freshness) a sound or hint must be to go and look.', 'Насколько важным (вид × уверенность × свежесть) должен быть звук или подсказка, чтобы пойти проверить.')),
    n('fresh', sense, e('Fresh for', 'Свежо'), 5, { min: 0, step: 1, unit: 's' }, e('Younger news: it goes to the very place.', 'Свежее: идёт прямо туда.')),
    n('old', sense, e('Old after', 'Устаревает через'), 20, { min: 1, step: 1, unit: 's' }, e('Between fresh and old it looks around the place, wider the older; older still, it searches the area.', 'Между свежим и старым — осматривает место, тем шире, чем старше; ещё старше — обыскивает округу.')),
    n('wanderRadius', roam, e('Wanders up to', 'Бродит до'), 800, { min: 64, step: 64, unit: 'u' }),
    n('waitMin', roam, e('Waits at least', 'Ждёт минимум'), 1.5, { min: 0, step: 0.5, unit: 's' }),
    n('waitMax', roam, e('Waits at most', 'Ждёт максимум'), 5, { min: 0, step: 0.5, unit: 's' }),
    n('idleChance', roam, e('Does something odd', 'Делает что-то странное'), 0.5, p, e('Chance of an idle move when it stops.', 'Вероятность странного движения на остановке.')),
    n('slow', look, e('Investigating speed', 'Скорость проверки'), 0.7, { min: 0.1, max: 2, step: 0.05 }, e('Of its speed; wandering is half.', 'От скорости; при блуждании — половина.')),
    n('searchMin', look, e('Searches at least', 'Ищет минимум'), 20, { min: 1, step: 1, unit: 's' }),
    n('searchMax', look, e('Searches at most', 'Ищет максимум'), 40, { min: 1, step: 1, unit: 's' }),
    n('searchRadius', look, e('Search area', 'Зона поиска'), 400, { min: 32, step: 32, unit: 'u' }),
    n('searchGrow', look, e('Area grows by', 'Зона растёт на'), 150, { min: 0, step: 16, unit: 'u' }, e('After each spot where nothing is found.', 'После каждой точки, где ничего не нашлось.')),
    n('searchLimit', look, e('Area at most', 'Зона максимум'), 1200, { min: 32, step: 64, unit: 'u' }),
    n('spotRange', hide, e('Checks spots within', 'Проверяет укрытия в'), 500, { min: 0, step: 32, unit: 'u' }),
    n('wUse', hide, e('Weight: signs of use', 'Вес: следы использования'), 0.4, p),
    n('wNoise', hide, e('Weight: noise from it', 'Вес: шум из него'), 0.3, p),
    n('wHint', hide, e('Weight: hint sureness', 'Вес: уверенность подсказки'), 0.2, p),
    n('wSeen', hide, e('Weight: seen in use', 'Вес: видел использование'), 0.1, p),
    n('mediumAt', hide, e('Knocks from', 'Стучит от'), 0.3, p, e('Suspicion from which it may knock and listen.', 'Подозрение, с которого может постучать и прислушаться.')),
    n('highAt', hide, e('Opens from', 'Открывает от'), 0.65, p, e('Suspicion from which it opens the spot and looks in.', 'Подозрение, с которого открывает укрытие и заглядывает.')),
    n('lowChance', hide, e('Chance: a quick look', 'Шанс: беглый взгляд'), 0.15, p, e('At a spot below the knocking level.', 'У укрытия ниже уровня стука.')),
    n('mediumChance', hide, e('Chance: knocks', 'Шанс: стучит'), 0.7, p, e('Otherwise it walks past.', 'Иначе проходит мимо.')),
    n('spotCooldown', hide, e('Leaves a checked spot for', 'Не трогает проверенное укрытие'), 30, { min: 0, step: 5, unit: 's' }),
    {
      key: 'moves',
      group: e('Hunting: moves', 'Охота: движения'),
      label: e('Moves', 'Движения'),
      hint: e(
        'Animations for what it does, as moment=animation seconds, separated by ;. Moments: scratch, tilt, lookAround, cluck, stare, headShake, twitch, crouch, hear, listen, rummage, spot, lose, empty, knock, rattle, open, openSlow, lookIn, lookUnder, kick. Missing ones use its Animations.',
        'Анимации действий: момент=анимация секунды, через ;. Моменты: scratch, tilt, lookAround, cluck, stare, headShake, twitch, crouch, hear, listen, rummage, spot, lose, empty, knock, rattle, open, openSlow, lookIn, lookUnder, kick. Без них — Анимации.',
      ),
      type: { kind: 'text' },
      default: '',
      when,
    },
  ];
}

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
    if (c.internal || c.madeBy || components[c.name] !== undefined) return false;
    if (c.appliesTo === 'brush' && !isBrush) return false;
    if (c.appliesTo === 'point' && isBrush) return false;
    if (c.pointNeeds && !isBrush && ![c.pointNeeds].flat().some((n) => components[n] !== undefined)) return false;
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
  /** The player can pick it up with Use (and throw it with Fire) when it weighs 50 kg or less. */
  pickUp: boolean;
  /** What it sounds like when it hits something ('': from its material). */
  surface?: string;
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

export interface TerrainData {
  /** `assets/terrain/<name>.cwvox`: the voxel grid (see @cocoaworlds/geometry VoxelField). */
  file: string;
  layer0: string;
  layer1: string;
  layer2: string;
  layer3: string;
  texture0: string;
  texture1: string;
  texture2: string;
  texture3: string;
  /** Size of one repeat of a layer texture (u). */
  tile: number;
  [k: string]: unknown;
}

export interface ScatterData {
  spacing: number;
  density: number;
  size: number;
  height: number;
  slope: number;
  colour: string;
  seed: number;
  /** On terrains: 'all', or the layer ('0'…'3') it grows on. */
  layer: string;
  /** A project plant instead of tufts ('' for tufts). */
  plant?: string;
  /** A grass layer painted over the material where it faces up; tufts only where it shows. */
  cover?: boolean;
  coverColour?: string;
  /** Degrees of slope over which the layer fades out. */
  edge?: number;
  /** 0…1: how much of it breaks into bare patches. */
  patches?: number;
  patchSize?: number;
  [k: string]: unknown;
}

export interface LadderData {
  speed: number;
  [k: string]: unknown;
}

export interface WaterData {
  tint: string;
  clearness: number;
  drowns: boolean;
  [k: string]: unknown;
  shallow?: string;
  deep?: string;
  depthLook?: number;
  foam?: boolean;
}

export interface ChargerData {
  gives: 'health' | 'armour';
  capacity: number;
  rate: number;
  [k: string]: unknown;
}

export interface VfxData {
  effect: string;
  on: boolean;
  loop: boolean;
  offset: [number, number, number];
  [k: string]: unknown;
}

export interface ParticlesData {
  kind: 'smoke' | 'fire' | 'sparks' | 'steam' | 'dust';
  rate: number;
  size: number;
  speed: number;
  on: boolean;
  [k: string]: unknown;
}

export interface PathPointData {
  next: string;
  speed: number;
  wait: number;
  message: string;
  [k: string]: unknown;
}

export interface TrainData {
  start: string;
  speed: number;
  moving: boolean;
  turns: boolean;
  [k: string]: unknown;
}

export interface LevelChangeData {
  scene: string;
  landmark: string;
  [k: string]: unknown;
}

export interface NpcData {
  side: 'hostile' | 'friendly' | 'neutral';
  health: number;
  speed: number;
  sight: number;
  attack: 'melee' | 'shoot' | 'none';
  damage: number;
  rate: number;
  reach: number;
  spread: number;
  anims: string;
  wander: boolean;
  flee: 'never' | 'hurt' | 'near';
  clumsy: boolean;
  height: number;
  radius: number;
  pull: number;
  mind?: 'simple' | 'hunter';
  [k: string]: unknown;
}

export type HidingSpotKind = 'locker' | 'wardrobe' | 'cabinet' | 'under' | 'box' | 'other';

export interface HidingSpotData {
  kind: HidingSpotKind;
  prompt: string;
  view: string;
  offset: [number, number, number];
  side: number;
  upDown: number;
  time: number;
  reach: number;
  [k: string]: unknown;
}
