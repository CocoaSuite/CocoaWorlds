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
    name: 'water',
    label: e('Water', 'Вода'),
    description: e(
      'The player swims in it (forward follows the view, Jump rises, Crouch dives) and can drown; physics objects float. Its faces are drawn as they are painted: use a see-through material.',
      'В ней игрок плавает (вперёд — куда смотрит, прыжок — вверх, присесть — вниз) и может утонуть; физические объекты всплывают. Грани рисуются своим материалом: возьмите прозрачный.',
    ),
    appliesTo: 'brush',
    conflicts: ['rigidBody', 'trigger', 'conveyor', 'ladder'],
    fields: [
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

export interface LadderData {
  speed: number;
  [k: string]: unknown;
}

export interface WaterData {
  tint: string;
  clearness: number;
  drowns: boolean;
  [k: string]: unknown;
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
