/**
 * Built-in components: what each one stores, its defaults, and how the Inspector shows it.
 * Components are plain JSON on the entity (`components.light = { ... }`). The editor draws its fields from
 * these definitions; the runtime reads the same data through `readComponent`, which fills in defaults, so
 * older files and hand-edited files always produce complete values.
 */

export type Lang = 'en' | 'ru';

export type SoundData = { sound: string; volume: number; loop: boolean; playOnStart: boolean; range: number };
/** How a model collides: not at all, by its bounding box, by its convex hull, or by its exact triangles. */
export type ModelCollision = 'none' | 'box' | 'hull' | 'exact';
export type ModelData = {
  model: string;
  units: 'metres' | 'units';
  animation: string;
  castShadows: boolean;
  collision: ModelCollision;
  /** Project materials in place of the model's own, by the name of the material slot in the file. */
  materials?: Record<string, string>;
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
        key: 'collision',
        label: e('Collision', 'Столкновения'),
        hint: e(
          'Box: its bounding box (cheapest). Hull: shrink-wrapped, no hollows (good for things that move). Exact: every triangle, for still scenery like arches and rooms (moving objects use the hull).',
          'Коробка: габаритный короб (дешевле всего). Оболочка: «обтянутая» форма без впадин (хорошо для движущихся). Точно: каждый треугольник — для неподвижных арок и комнат (движущиеся используют оболочку).',
        ),
        type: {
          kind: 'enum',
          options: [
            { value: 'none', label: e('None', 'Нет') },
            { value: 'box', label: e('Box', 'Коробка') },
            { value: 'hull', label: e('Hull', 'Оболочка') },
            { value: 'exact', label: e('Exact', 'Точно') },
          ],
        },
        default: 'none',
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
        key: 'side',
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
      { key: 'health', label: e('Health', 'Здоровье'), type: { kind: 'number', min: 1, step: 10 }, default: 50 },
      { key: 'speed', label: e('Speed', 'Скорость'), type: { kind: 'number', min: 0, step: 10, unit: 'u/s' }, default: 150 },
      { key: 'sight', label: e('Sees up to', 'Видит на'), type: { kind: 'number', min: 64, step: 64, unit: 'u' }, default: 1024 },
      {
        key: 'attack',
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
      { key: 'damage', label: e('Damage', 'Урон'), type: { kind: 'number', min: 0, step: 1 }, default: 10, when: { key: 'attack', is: ['melee', 'shoot'] } },
      { key: 'rate', label: e('Attacks a second', 'Атак в секунду'), type: { kind: 'number', min: 0.1, step: 0.5 }, default: 1, when: { key: 'attack', is: ['melee', 'shoot'] } },
      { key: 'reach', label: e('Reach', 'Дотягивается'), type: { kind: 'number', min: 16, step: 8, unit: 'u' }, default: 64, when: { key: 'attack', is: ['melee'] } },
      { key: 'spread', label: e('Aim spread', 'Разброс'), hint: e('Degrees: higher misses more.', 'В градусах: больше — чаще промахивается.'), type: { kind: 'number', min: 0, step: 1, unit: '°' }, default: 4, when: { key: 'attack', is: ['shoot'] } },
      {
        key: 'wander',
        label: e('Wanders about', 'Бродит'),
        hint: e('Pottering near where it started, stopping to peck or sniff (its busy animation).', 'Ходит около места, где стоял, останавливаясь клевать или нюхать (анимация «занят»).'),
        type: { kind: 'boolean' },
        default: false,
      },
      {
        key: 'flee',
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
      { key: 'clumsy', label: e('Clumsy', 'Неуклюжий'), hint: e('Weaves as it goes and stumbles now and then.', 'Петляет на ходу и иногда спотыкается.'), type: { kind: 'boolean' }, default: false },
      { key: 'height', label: e('Height', 'Рост'), type: { kind: 'number', min: 8, step: 4, unit: 'u' }, default: 72 },
      { key: 'radius', label: e('Thickness', 'Толщина'), hint: e('Half its width (for bumping into things).', 'Половина ширины (для столкновений).'), type: { kind: 'number', min: 2, step: 2, unit: 'u' }, default: 16 },
      {
        key: 'anims',
        label: e('Animations', 'Анимации'),
        hint: e(
          'Names in its model for standing, walking, attacking, dying, running, being busy and being hurt, separated by commas. Leave out what it hasn’t got.',
          'Имена анимаций модели: стоит, идёт, атакует, погибает, бежит, занят, ранен — через запятую. Чего нет, не пишите.',
        ),
        type: { kind: 'text' },
        default: 'idle, walk, attack, die',
      },
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
      { key: 'spacing', label: e('Spacing', 'Шаг'), hint: e('About how far apart the tufts are.', 'Примерно расстояние между пучками.'), type: { kind: 'number', min: 4, step: 2, unit: 'u' }, default: 10 },
      { key: 'density', label: e('Density', 'Густота'), hint: e('How many spots get a tuft (1 = all).', 'Сколько мест получают пучок (1 = все).'), type: { kind: 'number', min: 0, max: 1, step: 0.05 }, default: 1 },
      { key: 'size', label: e('Width', 'Ширина'), hint: e('How wide each tuft spreads.', 'Насколько широко раскидывается пучок.'), type: { kind: 'number', min: 2, step: 2, unit: 'u' }, default: 14 },
      { key: 'height', label: e('Height', 'Высота'), hint: e('How tall the grass grows.', 'Насколько высока трава.'), type: { kind: 'number', min: 1, step: 2, unit: 'u' }, default: 14 },
      { key: 'slope', label: e('Steepest', 'Круче'), hint: e('The steepest slope that grows tufts, in degrees.', 'Самый крутой склон, на котором растут пучки, в градусах.'), type: { kind: 'number', min: 0, max: 90, step: 5, unit: '°' }, default: 40 },
      { key: 'colour', label: e('Colour', 'Цвет'), type: { kind: 'color' }, default: '#4f9a3c' },
      { key: 'seed', label: e('Seed', 'Seed'), hint: e('Change it for a different pattern.', 'Измените для другого рисунка.'), type: { kind: 'number', min: 0, step: 1 }, default: 1 },
      {
        key: 'layer',
        label: e('Grows on', 'Растёт на'),
        hint: e('On a terrain: only where this layer is painted.', 'На ландшафте: только там, где нарисован этот слой.'),
        type: { kind: 'enum', options: [{ value: 'all', label: e('Everywhere', 'Везде') }, { value: '0', label: e('Layer 1', 'Слой 1') }, { value: '1', label: e('Layer 2', 'Слой 2') }, { value: '2', label: e('Layer 3', 'Слой 3') }, { value: '3', label: e('Layer 4', 'Слой 4') }] },
        default: 'all',
      },
      { key: 'plant', label: e('Plant', 'Растение'), hint: e('Grow one of your plants instead of plain tufts (its own colours).', 'Растить своё растение вместо простых пучков (со своими цветами).'), type: { kind: 'plant' }, default: '' },
      { key: 'cover', label: e('Grass on top', 'Трава сверху'), hint: e('Paint a grass layer over the material where it faces up (world up), so no bare ground shows between tufts; tufts grow only where it shows.', 'Рисовать слой травы поверх материала там, где поверхность смотрит вверх; пучки растут только там, где он виден.'), type: { kind: 'boolean' }, default: true },
      { key: 'coverColour', label: e('Top colour', 'Цвет сверху'), type: { kind: 'color' }, default: '#3f7f2e' },
      { key: 'edge', label: e('Edge softness', 'Мягкость края'), hint: e('Over how many degrees of slope the layer fades out.', 'На сколько градусов наклона слой сходит на нет.'), type: { kind: 'number', min: 1, max: 60, step: 1, unit: '°' }, default: 14 },
      { key: 'patches', label: e('Bare patches', 'Проплешины'), hint: e('0: even cover; 1: plenty of bare patches.', '0: ровный покров; 1: много проплешин.'), type: { kind: 'number', min: 0, max: 1, step: 0.05 }, default: 0.25 },
      { key: 'patchSize', label: e('Patch size', 'Размер пятен'), type: { kind: 'number', min: 20, step: 10, unit: 'u' }, default: 320 },
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
      { key: 'shallow', label: e('Shallow colour', 'Цвет на мели'), type: { kind: 'color' }, default: '#7fd8e6' },
      { key: 'deep', label: e('Deep colour', 'Цвет в глубине'), type: { kind: 'color' }, default: '#1f4fb0' },
      { key: 'depthLook', label: e('Deep from', 'Глубоко с'), hint: e('How deep the water is before it shows its deep colour.', 'С какой глубины вода показывает цвет глубины.'), type: { kind: 'number', min: 8, step: 16, unit: 'u' }, default: 192 },
      { key: 'foam', label: e('Foam', 'Пена'), hint: e('White foam along the shores and round whatever stands in it, and glints on the water.', 'Белая пена у берегов и вокруг всего, что стоит в воде, и блики.'), type: { kind: 'boolean' }, default: true },
      { key: 'tint', label: e('Colour under water', 'Цвет под водой'), type: { kind: 'color' }, default: '#28607a' },
      { key: 'clearness', label: e('Seeing distance', 'Видимость'), hint: e('How far the player sees under water.', 'Насколько далеко видно под водой.'), type: { kind: 'number', min: 32, step: 64, unit: 'u' }, default: 640 },
      { key: 'drowns', label: e('Can drown', 'Можно утонуть'), hint: e('After 12 s under water the player loses 10 health a second.', 'Через 12 с под водой игрок теряет 10 здоровья в секунду.'), type: { kind: 'boolean' }, default: true },
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
  [k: string]: unknown;
}
