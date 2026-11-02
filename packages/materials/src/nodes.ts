/**
 * The nodes of Cocoa Materials. Each makes one picture (grey or colour) from its settings and its inputs, as a
 * small GLSL program run on the graphics card (decision C1). Everything tiles: generators repeat over their
 * square, so baked maps never show a seam.
 *
 * In the GLSL bodies: `uv` is where in the square (0–1, top-left first), `p_<id>` are the settings, `inC_<id>(uv)`
 * and `inG_<id>(uv)` read an input as colour or grey, `h_<id>` is 1 when the input is linked, `u_px` is one pixel,
 * and the body sets `outColor`.
 */

export type L = { en: string; ru: string };
export type RampStop = { at: number; color: string };
export type ParamValue = number | string | boolean | RampStop[];
export type Kind = 'grey' | 'color';
export type OutputRole = 'color' | 'height' | 'normal' | 'roughness' | 'metalness' | 'occlusion' | 'glow' | 'opacity' | 'wearColor' | 'wearRoughness' | 'wearMetal' | 'wearNoise';
export type Group = 'make' | 'change' | 'combine' | 'colour' | 'surface' | 'output';

export interface Port {
  id: string;
  label: L;
  kind: Kind;
  /** What it reads when nothing is linked (0–1 grey or an RGB colour). */
  fallback?: [number, number, number];
}

export type Param =
  | { id: string; label: L; kind: 'number'; min: number; max: number; step?: number; default: number }
  | { id: string; label: L; kind: 'int'; min: number; max: number; default: number }
  | { id: string; label: L; kind: 'seed'; default: number }
  | { id: string; label: L; kind: 'choice'; options: { value: string; label: L }[]; default: string }
  | { id: string; label: L; kind: 'color'; default: string }
  | { id: string; label: L; kind: 'bool'; default: boolean }
  | { id: string; label: L; kind: 'ramp'; default: RampStop[] }
  | { id: string; label: L; kind: 'image'; default: string };

export interface NodeDef {
  type: string;
  group: Group;
  label: L;
  hint: L;
  inputs: Port[];
  /** What it makes; null for output nodes. */
  output: Kind | null;
  /** For output nodes: the map of the material it makes. */
  role?: OutputRole;
  params: Param[];
  glsl: string;
}

const l = (en: string, ru: string): L => ({ en, ru });
const seed: Param = { id: 'seed', label: l('Seed', 'Зерно'), kind: 'seed', default: 0 };
const IN_GREY = (id = 'in', label = l('In', 'Вход'), fallback: [number, number, number] = [0, 0, 0]): Port => ({ id, label, kind: 'grey', fallback });
const IN_COLOR = (id = 'in', label = l('In', 'Вход'), fallback: [number, number, number] = [0, 0, 0]): Port => ({ id, label, kind: 'color', fallback });
const opt = (value: string, en: string, ru: string) => ({ value, label: l(en, ru) });

/** Output nodes: pass their input through (so it can be shown and baked). */
function output(type: string, role: OutputRole, kind: Kind, en: string, ru: string, hintEn: string, hintRu: string, fallback: [number, number, number]): NodeDef {
  return {
    type,
    group: 'output',
    label: l(en, ru),
    hint: l(hintEn, hintRu),
    inputs: [{ id: 'in', label: l(en, ru), kind, fallback }],
    output: null,
    role,
    params: [],
    glsl: kind === 'grey' ? 'float v = inG_in(uv); outColor = vec4(vec3(v), 1.);' : 'outColor = vec4(inC_in(uv).rgb, 1.);',
  };
}

export const NODES: NodeDef[] = [
  // ── Make ──
  {
    type: 'noise',
    group: 'make',
    label: l('Noise', 'Шум'),
    hint: l('Cloudy random patterns: soft (Perlin), blocky (value) or ridged like veins.', 'Облачные случайные узоры: мягкие (Перлин), пятнистые или с прожилками.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'kind', label: l('Kind', 'Вид'), kind: 'choice', options: [opt('perlin', 'Perlin', 'Перлин'), opt('value', 'Value', 'Пятна'), opt('ridged', 'Ridged', 'Прожилки')], default: 'perlin' },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 64, default: 4 },
      { id: 'octaves', label: l('Detail', 'Детали'), kind: 'int', min: 1, max: 10, default: 5 },
      { id: 'roughness', label: l('Roughness', 'Грубость'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: 'outColor = vec4(vec3(fbm(uv, p_scale, p_octaves, p_roughness, p_kind, p_seed)), 1.);',
  },
  {
    type: 'cells',
    group: 'make',
    label: l('Cells', 'Ячейки'),
    hint: l('Cells around random points (Voronoi): stones, scales, cracked mud.', 'Ячейки вокруг случайных точек (Вороной): камни, чешуя, трещины.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'mode', label: l('Shows', 'Показывает'), kind: 'choice', options: [opt('distance', 'Distance', 'Расстояние'), opt('edges', 'Edges', 'Границы'), opt('random', 'Random per cell', 'Случайно по ячейкам')], default: 'distance' },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 64, default: 6 },
      { id: 'jitter', label: l('Randomness', 'Случайность'), kind: 'number', min: 0, max: 1, default: 1 },
      { id: 'width', label: l('Edge width', 'Ширина границ'), kind: 'number', min: 0.01, max: 0.5, default: 0.08 },
      seed,
    ],
    glsl: `vec3 v = voronoi(uv, p_scale, p_jitter, p_seed);
float r = p_mode < 0.5 ? clamp(v.x, 0., 1.) : p_mode < 1.5 ? smoothstep(0., p_width, v.y - v.x) : v.z;
outColor = vec4(vec3(r), 1.);`,
  },
  {
    type: 'bricks',
    group: 'make',
    label: l('Bricks and tiles', 'Кирпичи и плитка'),
    hint: l('Rows of bricks or tiles with mortar between them; white is brick, black mortar.', 'Ряды кирпичей или плитки со швами; белое — кирпич, чёрное — шов.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'rows', label: l('Rows', 'Рядов'), kind: 'int', min: 1, max: 64, default: 8 },
      { id: 'columns', label: l('Columns', 'Столбцов'), kind: 'int', min: 1, max: 64, default: 4 },
      { id: 'offset', label: l('Offset', 'Сдвиг'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'mortar', label: l('Mortar', 'Шов'), kind: 'number', min: 0, max: 0.5, default: 0.06 },
      { id: 'bevel', label: l('Bevel', 'Скос'), kind: 'number', min: 0, max: 0.5, default: 0.12 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `float y = uv.y * p_rows; float row = floor(y);
float x = uv.x * p_columns + p_offset * mod(row, 2.); float col = floor(x);
vec2 f = vec2(fract(x), fract(y));
// Distance to the brick's edge, in row heights.
float dx = min(f.x, 1. - f.x) * p_rows / p_columns, dy = min(f.y, 1. - f.y);
float d = min(dx, dy) - p_mortar * 0.5;
float r = hash12(vec2(mod(col, p_columns), mod(row, p_rows)) + seedv(p_seed));
float h = d <= 0. ? 0. : (p_bevel > 0. ? smoothstep(0., p_bevel, d) : 1.) * (1. - p_random * r);
outColor = vec4(vec3(h), 1.);`,
  },
  {
    type: 'shape',
    group: 'make',
    label: l('Shape', 'Фигура'),
    hint: l('A circle, square, polygon or star, repeated to tile.', 'Круг, квадрат, многоугольник или звезда, повторённые плиткой.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'kind', label: l('Kind', 'Вид'), kind: 'choice', options: [opt('circle', 'Circle', 'Круг'), opt('square', 'Square', 'Квадрат'), opt('polygon', 'Polygon', 'Многоугольник'), opt('star', 'Star', 'Звезда')], default: 'circle' },
      { id: 'sides', label: l('Sides', 'Сторон'), kind: 'int', min: 3, max: 12, default: 6 },
      { id: 'size', label: l('Size', 'Размер'), kind: 'number', min: 0, max: 1.5, default: 0.7 },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 1, default: 0.05 },
      { id: 'tiles', label: l('Repeat', 'Повторов'), kind: 'int', min: 1, max: 32, default: 1 },
      { id: 'angle', label: l('Turn', 'Поворот'), kind: 'number', min: 0, max: 360, step: 1, default: 0 },
    ],
    glsl: `vec2 p = fract(uv * p_tiles) - 0.5;
float a0 = radians(p_angle); p = mat2(cos(a0), -sin(a0), sin(a0), cos(a0)) * p;
float d;
if (p_kind < 0.5) d = length(p) * 2.;
else if (p_kind < 1.5) d = max(abs(p.x), abs(p.y)) * 2.;
else {
  float a = atan(p.x, -p.y) + PI; float r = 2. * PI / p_sides;
  d = cos(floor(0.5 + a / r) * r - a) * length(p) * 2.;
  if (p_kind > 2.5) { float k = abs(fract(a / r) - 0.5) * 2.; d *= mix(1.6, 0.8, k); }
}
float s = max(p_softness * 0.5, 0.002);
outColor = vec4(vec3(1. - smoothstep(p_size - s, p_size + s, d)), 1.);`,
  },
  {
    type: 'gradient',
    group: 'make',
    label: l('Gradient', 'Градиент'),
    hint: l('Dark to light across the square. Linear doesn’t tile; mirrored and round do.', 'От тёмного к светлому. Линейный не стыкуется плиткой; зеркальный и круглый — да.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'kind', label: l('Kind', 'Вид'), kind: 'choice', options: [opt('linear', 'Linear', 'Линейный'), opt('mirrored', 'Mirrored', 'Зеркальный'), opt('radial', 'Round', 'Круглый')], default: 'mirrored' },
      { id: 'direction', label: l('Direction', 'Направление'), kind: 'choice', options: [opt('across', 'Across', 'Поперёк'), opt('down', 'Down', 'Вниз')], default: 'down' },
      { id: 'tiles', label: l('Repeat', 'Повторов'), kind: 'int', min: 1, max: 32, default: 1 },
    ],
    glsl: `vec2 q = fract(uv * p_tiles); float t = p_direction < 0.5 ? q.x : q.y;
float v = p_kind < 0.5 ? t : p_kind < 1.5 ? 1. - abs(t * 2. - 1.) : 1. - clamp(length(q - 0.5) * 2., 0., 1.);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'checker',
    group: 'make',
    label: l('Checker', 'Шахматы'),
    hint: l('Black and white squares.', 'Чёрные и белые клетки.'),
    inputs: [],
    output: 'grey',
    params: [{ id: 'tiles', label: l('Squares across', 'Клеток в ряд'), kind: 'int', min: 1, max: 64, default: 8 }],
    glsl: 'float v = mod(floor(uv.x * p_tiles) + floor(uv.y * p_tiles), 2.); outColor = vec4(vec3(v), 1.);',
  },
  {
    type: 'scratches',
    group: 'make',
    label: l('Scratches', 'Царапины'),
    hint: l('Thin random lines, mostly one way: scuffed metal, scratched paint.', 'Тонкие случайные линии: потёртый металл, поцарапанная краска.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'density', label: l('How many', 'Сколько'), kind: 'int', min: 1, max: 32, default: 8 },
      { id: 'length', label: l('Length', 'Длина'), kind: 'number', min: 0.05, max: 1.5, default: 0.6 },
      { id: 'width', label: l('Width', 'Толщина'), kind: 'number', min: 0.002, max: 0.1, default: 0.01 },
      { id: 'angle', label: l('Direction', 'Направление'), kind: 'number', min: 0, max: 180, step: 1, default: 30 },
      { id: 'spread', label: l('Spread', 'Разброс'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `vec2 p = uv * p_density; vec2 i = floor(p); float v = 0.;
for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
  vec2 c = i + vec2(x, y); vec2 w = mod(c, p_density) + seedv(p_seed);
  vec2 h = hash22(w);
  vec2 centre = c + h;
  float a = radians(p_angle) + (hash12(w + 3.1) - 0.5) * p_spread * PI;
  // (Half its length in cells, at most what the 5 × 5 cells looked at can hold.)
  vec2 dir = vec2(cos(a), sin(a)) * min(p_length * 0.5 * p_density, 2.2) * (0.5 + 0.5 * hash12(w + 9.2));
  vec2 pa = p - (centre - dir), ba = dir * 2.;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  float d = length(pa - ba * t) / p_density;
  v = max(v, (1. - smoothstep(0., p_width, d)) * (0.4 + 0.6 * hash12(w + 5.7)));
}
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'grunge',
    group: 'make',
    label: l('Grunge', 'Грязь'),
    hint: l('Blotchy dirt and stains (noise warped by noise).', 'Пятна грязи и разводы (шум, искажённый шумом).'),
    inputs: [],
    output: 'grey',
    params: [
      {
        id: 'style',
        label: l('Style', 'Вид'),
        kind: 'choice',
        options: [opt('blotches', 'Blotches', 'Пятна'), opt('streaks', 'Streaks (running down)', 'Потёки'), opt('speckles', 'Speckles', 'Крапинки'), opt('rust', 'Rust', 'Ржавчина')],
        default: 'blotches',
      },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 32, default: 3 },
      { id: 'warp', label: l('Swirl', 'Завихрение'), kind: 'number', min: 0, max: 1, default: 0.4 },
      { id: 'contrast', label: l('Contrast', 'Контраст'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'amount', label: l('Amount', 'Количество'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `vec2 q = uv + p_warp * 0.25 * (vec2(fbm(uv, p_scale, 4., 0.5, 0., p_seed), fbm(uv, p_scale, 4., 0.5, 0., p_seed + 11.)) - 0.5);
float v;
if (p_style < 0.5) v = fbm(q, p_scale * 2., 7., 0.55, 0., p_seed + 23.);
// Streaks: stretched up and down (eight times finer across, still tiling).
else if (p_style < 1.5) v = fbm(vec2(q.x * 8., q.y), p_scale * 2., 6., 0.5, 0., p_seed + 23.) * (0.6 + 0.4 * fbm(q, p_scale, 3., 0.5, 0., p_seed + 5.));
// Speckles: small spots, more where a broad noise says so.
else if (p_style < 2.5) v = valueNoise(q * p_scale * 24., p_scale * 24., p_seed + 31.) * (0.4 + 0.8 * fbm(uv, p_scale, 3., 0.5, 0., p_seed + 7.));
// Rust: veined patches.
else v = fbm(q, p_scale * 2., 6., 0.6, 2., p_seed + 41.) * fbm(uv, p_scale, 4., 0.5, 0., p_seed + 3.) * 1.4;
float c = mix(0.5, 0.02, p_contrast); float m = 1. - p_amount;
outColor = vec4(vec3(smoothstep(m - c, m + c, v)), 1.);`,
  },
  {
    type: 'image',
    group: 'make',
    label: l('Image', 'Картинка'),
    hint: l('A picture from the project’s textures.', 'Картинка из текстур проекта.'),
    inputs: [],
    output: 'color',
    params: [{ id: 'image', label: l('Image', 'Картинка'), kind: 'image', default: '' }],
    glsl: 'outColor = p_image_ok > 0.5 ? vec4(texture(p_image, uv).rgb, 1.) : vec4(mod(floor(uv.x * 8.) + floor(uv.y * 8.), 2.) * vec3(1., 0., 0.86), 1.);',
  },
  {
    type: 'color',
    group: 'make',
    label: l('Colour', 'Цвет'),
    hint: l('One flat colour.', 'Один ровный цвет.'),
    inputs: [],
    output: 'color',
    params: [{ id: 'color', label: l('Colour', 'Цвет'), kind: 'color', default: '#b08c64' }],
    glsl: 'outColor = vec4(p_color, 1.);',
  },
  {
    type: 'value',
    group: 'make',
    label: l('Number', 'Число'),
    hint: l('One flat grey (0 black, 1 white): a roughness, a metal amount.', 'Ровный серый (0 — чёрный, 1 — белый): шероховатость, металличность.'),
    inputs: [],
    output: 'grey',
    params: [{ id: 'value', label: l('Value', 'Значение'), kind: 'number', min: 0, max: 1, default: 0.5 }],
    glsl: 'outColor = vec4(vec3(p_value), 1.);',
  },

  // ── Change ──
  {
    type: 'levels',
    group: 'change',
    label: l('Levels', 'Уровни'),
    hint: l('Stretch, squeeze and shift the tones: more contrast, darker, lighter.', 'Растянуть, сжать и сдвинуть тона: контраст, темнее, светлее.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'inLow', label: l('Black point', 'Точка чёрного'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'inHigh', label: l('White point', 'Точка белого'), kind: 'number', min: 0, max: 1, default: 1 },
      { id: 'gamma', label: l('Midtones', 'Средние тона'), kind: 'number', min: 0.1, max: 4, default: 1 },
      { id: 'outLow', label: l('Darkest', 'Самое тёмное'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'outHigh', label: l('Lightest', 'Самое светлое'), kind: 'number', min: 0, max: 1, default: 1 },
    ],
    glsl: `vec3 c = inC_in(uv).rgb;
vec3 x = clamp((c - p_inLow) / max(p_inHigh - p_inLow, 1e-4), 0., 1.);
x = pow(x, vec3(1. / p_gamma));
outColor = vec4(mix(vec3(p_outLow), vec3(p_outHigh), x), 1.);`,
  },
  {
    type: 'curve',
    group: 'change',
    label: l('Curve', 'Кривая'),
    hint: l('Reshape the tones with four points (black, dark, light, white).', 'Изменить тона четырьмя точками (чёрное, тёмное, светлое, белое).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'y0', label: l('Black becomes', 'Чёрное станет'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'y1', label: l('Dark becomes', 'Тёмное станет'), kind: 'number', min: 0, max: 1, default: 0.333 },
      { id: 'y2', label: l('Light becomes', 'Светлое станет'), kind: 'number', min: 0, max: 1, default: 0.667 },
      { id: 'y3', label: l('White becomes', 'Белое станет'), kind: 'number', min: 0, max: 1, default: 1 },
    ],
    glsl: 'vec3 c = clamp(inC_in(uv).rgb, 0., 1.); outColor = vec4(curve4(c.r, p_y0, p_y1, p_y2, p_y3), curve4(c.g, p_y0, p_y1, p_y2, p_y3), curve4(c.b, p_y0, p_y1, p_y2, p_y3), 1.);',
  },
  {
    type: 'invert',
    group: 'change',
    label: l('Invert', 'Инверсия'),
    hint: l('Black becomes white, and the other way round.', 'Чёрное становится белым, и наоборот.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [],
    glsl: 'outColor = vec4(1. - inC_in(uv).rgb, 1.);',
  },
  {
    type: 'clamp',
    group: 'change',
    label: l('Clamp', 'Ограничить'),
    hint: l('Keep values between a lowest and a highest.', 'Удержать значения между нижним и верхним.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'min', label: l('Lowest', 'Нижнее'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'max', label: l('Highest', 'Верхнее'), kind: 'number', min: 0, max: 1, default: 1 },
    ],
    glsl: 'outColor = vec4(clamp(inC_in(uv).rgb, p_min, p_max), 1.);',
  },
  {
    type: 'blur',
    group: 'change',
    label: l('Blur', 'Размытие'),
    hint: l('Soften: a share of the square to blur across.', 'Смягчить: на какую долю квадрата размывать.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0, max: 0.1, step: 0.001, default: 0.01 }],
    glsl: `vec3 s = vec3(0.); float w = 0.;
for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
  vec2 o = vec2(x, y) / 3.; float k = exp(-dot(o, o) * 2.);
  s += inC_in(uv + o * p_radius).rgb * k; w += k;
}
outColor = vec4(s / w, 1.);`,
  },
  {
    type: 'warp',
    group: 'change',
    label: l('Warp', 'Искажение'),
    hint: l('Push the picture around by another one: along its slopes, or one way by its brightness.', 'Сдвинуть картинку другой: вдоль её склонов или в одну сторону по яркости.'),
    inputs: [IN_COLOR(), IN_GREY('by', l('By', 'Чем'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'mode', label: l('How', 'Как'), kind: 'choice', options: [opt('slope', 'Along slopes', 'Вдоль склонов'), opt('direction', 'One way', 'В одну сторону')], default: 'slope' },
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 1, default: 0.2 },
      { id: 'angle', label: l('Direction', 'Направление'), kind: 'number', min: 0, max: 360, step: 1, default: 0 },
    ],
    glsl: `vec2 off;
if (p_mode < 0.5) { float e = 1. / 256.; off = vec2(inG_by(uv + vec2(e, 0.)) - inG_by(uv - vec2(e, 0.)), inG_by(uv + vec2(0., e)) - inG_by(uv - vec2(0., e))) / (2. * e) * p_amount * 0.01; }
else off = vec2(cos(radians(p_angle)), sin(radians(p_angle))) * (inG_by(uv) - 0.5) * p_amount * 0.25;
outColor = vec4(inC_in(uv + off).rgb, 1.);`,
  },
  {
    type: 'transform',
    group: 'change',
    label: l('Transform', 'Трансформация'),
    hint: l('Repeat, slide or turn the picture (in quarter turns, so it still tiles).', 'Повторить, сдвинуть или повернуть картинку (на четверть оборота, чтобы стыковалась).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'tiles', label: l('Repeat', 'Повторов'), kind: 'int', min: 1, max: 32, default: 2 },
      { id: 'x', label: l('Slide across', 'Сдвиг поперёк'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'y', label: l('Slide down', 'Сдвиг вниз'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'turn', label: l('Turn', 'Поворот'), kind: 'choice', options: [opt('0', 'None', 'Нет'), opt('90', '90°', '90°'), opt('180', '180°', '180°'), opt('270', '270°', '270°')], default: '0' },
    ],
    glsl: `vec2 q = uv - 0.5;
if (p_turn > 0.5 && p_turn < 1.5) q = vec2(-q.y, q.x); else if (p_turn > 1.5 && p_turn < 2.5) q = -q; else if (p_turn > 2.5) q = vec2(q.y, -q.x);
outColor = vec4(inC_in((q + 0.5) * p_tiles + vec2(p_x, p_y)).rgb, 1.);`,
  },
  {
    type: 'slopeBlur',
    group: 'change',
    label: l('Slope blur', 'Размытие по склону'),
    hint: l('Smear a picture along the slopes of another: melted, eroded or flowing looks.', 'Размазать картинку вдоль склонов другой: оплавленный, выветренный, текучий вид.'),
    inputs: [IN_COLOR(), IN_GREY('slope', l('Slope', 'Склон'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 0.2, step: 0.002, default: 0.04 },
      { id: 'mode', label: l('Mode', 'Режим'), kind: 'choice', options: [opt('blur', 'Blur', 'Размыть'), opt('min', 'Darkest', 'Темнее'), opt('max', 'Lightest', 'Светлее')], default: 'blur' },
    ],
    glsl: `float e = 1. / 256.;
vec2 g = vec2(inG_slope(uv + vec2(e, 0.)) - inG_slope(uv - vec2(e, 0.)), inG_slope(uv + vec2(0., e)) - inG_slope(uv - vec2(0., e)));
vec2 dir = length(g) > 1e-5 ? -normalize(g) : vec2(0.);
vec3 acc = inC_in(uv).rgb; vec3 lo = acc, hi = acc;
for (int i = 1; i <= 12; i++) {
  vec3 c = inC_in(uv + dir * p_amount * float(i) / 12.).rgb;
  acc += c; lo = min(lo, c); hi = max(hi, c);
}
outColor = vec4(p_mode < 0.5 ? acc / 13. : p_mode < 1.5 ? lo : hi, 1.);`,
  },
  {
    type: 'distance',
    group: 'change',
    label: l('Distance', 'Расстояние'),
    hint: l('A soft edge growing out from white shapes: bevels, glows and wear around marks.', 'Мягкий край вокруг белых фигур: фаски, свечение, износ вокруг отметин.'),
    inputs: [IN_GREY('in', l('Shapes', 'Фигуры'))],
    output: 'grey',
    params: [{ id: 'distance', label: l('How far', 'Как далеко'), kind: 'number', min: 0.005, max: 0.25, step: 0.005, default: 0.05 }],
    glsl: `float best = inG_in(uv) > 0.5 ? 0. : 1e3;
for (int r = 1; r <= 10; r++) {
  float rad = p_distance * float(r) / 10.;
  for (int a = 0; a < 16; a++) {
    float t = float(a) / 16. * 6.2831853 + float(r) * 0.37;
    if (inG_in(uv + vec2(cos(t), sin(t)) * rad) > 0.5) best = min(best, rad);
  }
}
outColor = vec4(vec3(clamp(1. - best / p_distance, 0., 1.)), 1.);`,
  },
  {
    type: 'edges',
    group: 'change',
    label: l('Edge detect', 'Поиск краёв'),
    hint: l('White lines where the picture changes sharply: outlines of bricks and shapes.', 'Белые линии там, где картинка резко меняется: контуры кирпичей и фигур.'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'width', label: l('Width', 'Толщина'), kind: 'number', min: 0.001, max: 0.05, step: 0.001, default: 0.006 },
      { id: 'threshold', label: l('Threshold', 'Порог'), kind: 'number', min: 0, max: 1, default: 0.1 },
    ],
    glsl: `float e = abs(inG_in(uv + vec2(p_width, 0.)) - inG_in(uv - vec2(p_width, 0.))) + abs(inG_in(uv + vec2(0., p_width)) - inG_in(uv - vec2(0., p_width)));
outColor = vec4(vec3(smoothstep(p_threshold, p_threshold + 0.05, e)), 1.);`,
  },

  // ── Combine ──
  {
    type: 'blend',
    group: 'combine',
    label: l('Blend', 'Смешать'),
    hint: l('Put one picture over another: mixed, added, multiplied … and only where a mask is white.', 'Наложить одну картинку на другую: смешать, сложить, умножить … и только там, где маска белая.'),
    inputs: [IN_COLOR('top', l('Top', 'Сверху'), [1, 1, 1]), IN_COLOR('bottom', l('Bottom', 'Снизу'), [0, 0, 0]), IN_GREY('mask', l('Mask', 'Маска'), [1, 1, 1])],
    output: 'color',
    params: [
      {
        id: 'mode',
        label: l('Mode', 'Режим'),
        kind: 'choice',
        options: [
          opt('mix', 'Mix', 'Смешать'),
          opt('add', 'Add', 'Сложить'),
          opt('subtract', 'Subtract', 'Вычесть'),
          opt('multiply', 'Multiply', 'Умножить'),
          opt('screen', 'Screen', 'Экран'),
          opt('overlay', 'Overlay', 'Перекрытие'),
          opt('max', 'Lighter', 'Светлее'),
          opt('min', 'Darker', 'Темнее'),
          opt('difference', 'Difference', 'Разница'),
        ],
        default: 'mix',
      },
      { id: 'opacity', label: l('Opacity', 'Непрозрачность'), kind: 'number', min: 0, max: 1, default: 1 },
    ],
    glsl: `vec3 a = inC_top(uv).rgb, b = inC_bottom(uv).rgb; vec3 r;
int m = int(p_mode + 0.5);
if (m == 0) r = a; else if (m == 1) r = a + b; else if (m == 2) r = b - a; else if (m == 3) r = a * b;
else if (m == 4) r = 1. - (1. - a) * (1. - b);
else if (m == 5) r = mix(2. * a * b, 1. - 2. * (1. - a) * (1. - b), step(0.5, b));
else if (m == 6) r = max(a, b); else if (m == 7) r = min(a, b); else r = abs(a - b);
outColor = vec4(clamp(mix(b, r, inG_mask(uv) * p_opacity), 0., 1.), 1.);`,
  },
  {
    type: 'switch',
    group: 'combine',
    label: l('Switch', 'Переключатель'),
    hint: l('Pass on one of two inputs (handy for trying a change).', 'Передать один из двух входов (удобно, чтобы сравнить).'),
    inputs: [IN_COLOR('a', l('A', 'А')), IN_COLOR('b', l('B', 'Б'))],
    output: 'color',
    params: [{ id: 'useB', label: l('Use B', 'Взять Б'), kind: 'bool', default: false }],
    glsl: 'outColor = vec4(p_useB > 0.5 ? inC_b(uv).rgb : inC_a(uv).rgb, 1.);',
  },

  // ── Colour ──
  {
    type: 'gradientMap',
    group: 'colour',
    label: l('Gradient map', 'Карта градиента'),
    hint: l('Colour a grey picture: black takes the left colour, white the right.', 'Раскрасить серую картинку: чёрное берёт левый цвет, белое — правый.'),
    inputs: [IN_GREY()],
    output: 'color',
    params: [
      {
        id: 'ramp',
        label: l('Colours', 'Цвета'),
        kind: 'ramp',
        default: [
          { at: 0, color: '#1e1a16' },
          { at: 1, color: '#e8dcc8' },
        ],
      },
    ],
    glsl: 'outColor = vec4(ramp(inG_in(uv), p_ramp_c, p_ramp_t, p_ramp_n), 1.);',
  },
  {
    type: 'hsl',
    group: 'colour',
    label: l('Hue, saturation, lightness', 'Тон, насыщенность, яркость'),
    hint: l('Shift the colours round the wheel, make them stronger or greyer, lighter or darker.', 'Сдвинуть цвета по кругу, сделать насыщеннее или серее, светлее или темнее.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'hue', label: l('Hue', 'Тон'), kind: 'number', min: -180, max: 180, step: 1, default: 0 },
      { id: 'saturation', label: l('Saturation', 'Насыщенность'), kind: 'number', min: 0, max: 2, default: 1 },
      { id: 'lightness', label: l('Lightness', 'Яркость'), kind: 'number', min: -1, max: 1, default: 0 },
    ],
    glsl: `vec3 h = rgb2hsv(inC_in(uv).rgb);
h.x = fract(h.x + p_hue / 360.); h.y = clamp(h.y * p_saturation, 0., 1.);
outColor = vec4(clamp(hsv2rgb(h) + p_lightness, 0., 1.), 1.);`,
  },
  {
    type: 'tint',
    group: 'colour',
    label: l('Colourise', 'Окрасить'),
    hint: l('Tint a picture with one colour.', 'Окрасить картинку одним цветом.'),
    inputs: [IN_GREY('in', l('In', 'Вход'), [1, 1, 1])],
    output: 'color',
    params: [{ id: 'color', label: l('Colour', 'Цвет'), kind: 'color', default: '#c08040' }],
    glsl: 'outColor = vec4(p_color * inG_in(uv), 1.);',
  },

  // ── Surface ──
  {
    type: 'normal',
    group: 'surface',
    label: l('Height to normal', 'Высота в нормали'),
    hint: l('Bumps for lighting from a height picture (white is high).', 'Рельеф для освещения из карты высот (белое — выше).'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'color',
    params: [{ id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 10, default: 2 }],
    glsl: `float e = u_px;
float dx = (inG_in(uv + vec2(e, 0.)) - inG_in(uv - vec2(e, 0.))) / (2. * e);
float dy = (inG_in(uv + vec2(0., e)) - inG_in(uv - vec2(0., e))) / (2. * e);
vec3 n = normalize(vec3(-dx * p_strength * 0.02, -dy * p_strength * 0.02, 1.));
outColor = vec4(n * 0.5 + 0.5, 1.);`,
  },
  {
    type: 'occlusion',
    group: 'surface',
    label: l('Height to occlusion', 'Высота в затенение'),
    hint: l('Dark in the dips and cracks, where light hardly reaches.', 'Темнее во впадинах и трещинах, куда свет почти не попадает.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.002, max: 0.1, step: 0.001, default: 0.02 },
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 4, default: 1.5 },
    ],
    glsl: `float h = inG_in(uv); float s = 0., w = 0.;
for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { vec2 o = vec2(x, y) / 2.; float k = exp(-dot(o, o)); s += inG_in(uv + o * p_radius) * k; w += k; }
outColor = vec4(vec3(clamp(1. - max(s / w - h, 0.) * p_strength * 4., 0., 1.)), 1.);`,
  },
  {
    type: 'curvature',
    group: 'surface',
    label: l('Height to curvature', 'Высота в кривизну'),
    hint: l('Light on ridges and edges, dark in grooves (grey where flat): for wear and dirt masks.', 'Светлее на гребнях и краях, темнее в бороздах (серое — где ровно): для масок износа и грязи.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.001, max: 0.05, step: 0.001, default: 0.005 },
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 10, default: 3 },
    ],
    glsl: `float h = inG_in(uv); float r = p_radius;
float lap = 4. * h - inG_in(uv + vec2(r, 0.)) - inG_in(uv - vec2(r, 0.)) - inG_in(uv + vec2(0., r)) - inG_in(uv - vec2(0., r));
outColor = vec4(vec3(clamp(0.5 + lap * p_strength, 0., 1.)), 1.);`,
  },

  // ── Outputs ──
  output('outColor', 'color', 'color', 'Colour', 'Цвет', 'The material’s colour.', 'Цвет материала.', [0.7, 0.7, 0.7]),
  output('outHeight', 'height', 'grey', 'Height', 'Высота', 'How high each spot is (white high): bumps when there is no normal map.', 'Высота каждой точки (белое — выше): рельеф, если нет карты нормалей.', [0.5, 0.5, 0.5]),
  output('outNormal', 'normal', 'color', 'Normal', 'Нормали', 'Bumps for lighting (from Height to normal).', 'Рельеф для освещения (из «Высота в нормали»).', [0.5, 0.5, 1]),
  output('outRoughness', 'roughness', 'grey', 'Roughness', 'Шероховатость', 'White is matte, black mirror-smooth.', 'Белое — матовое, чёрное — гладкое как зеркало.', [0.8, 0.8, 0.8]),
  output('outMetal', 'metalness', 'grey', 'Metal', 'Металл', 'White where it is metal.', 'Белое — там, где металл.', [0, 0, 0]),
  output('outOcclusion', 'occlusion', 'grey', 'Occlusion', 'Затенение', 'Dark where little light gets in (cracks, dips).', 'Темнее там, куда мало света попадает (трещины, впадины).', [1, 1, 1]),
  output('outGlow', 'glow', 'color', 'Glow', 'Свечение', 'Where it glows, and in what colour (black: no glow).', 'Где светится и каким цветом (чёрное — не светится).', [0, 0, 0]),
  output('outOpacity', 'opacity', 'grey', 'Opacity', 'Непрозрачность', 'Black is see-through (cut out), white solid.', 'Чёрное — насквозь (вырезано), белое — сплошное.', [1, 1, 1]),
  output('outWearColor', 'wearColor', 'color', 'Wear colour', 'Цвет износа', 'The wear layer’s colour (bare metal under paint, dust): shown on edges, in creases or on top, as the material’s Wear settings say.', 'Цвет слоя износа (металл под краской, пыль): виден на краях, в углах или сверху, как задано в настройках износа материала.', [0.6, 0.6, 0.6]),
  output('outWearRoughness', 'wearRoughness', 'grey', 'Wear roughness', 'Шероховатость износа', 'The wear layer’s roughness (white matte).', 'Шероховатость слоя износа (белое — матовое).', [0.35, 0.35, 0.35]),
  output('outWearMetal', 'wearMetal', 'grey', 'Wear metal', 'Металл износа', 'Where the wear layer is metal (white).', 'Где слой износа металлический (белое).', [1, 1, 1]),
  output('outWearNoise', 'wearNoise', 'grey', 'Wear noise', 'Шум износа', 'Breaks the wear up: where it is white, wear shows sooner (a grunge works well).', 'Разбивает износ: где белое, износ проявляется раньше (хорошо подходит «Грязь»).', [0.5, 0.5, 0.5]),
];

const byType = new Map(NODES.map((n) => [n.type, n]));
export const nodeDef = (type: string): NodeDef | undefined => byType.get(type);

export const GROUPS: { id: Group; label: L }[] = [
  { id: 'make', label: l('Make', 'Создать') },
  { id: 'change', label: l('Change', 'Изменить') },
  { id: 'combine', label: l('Combine', 'Совместить') },
  { id: 'colour', label: l('Colour', 'Цвет') },
  { id: 'surface', label: l('Surface', 'Поверхность') },
  { id: 'output', label: l('Outputs', 'Выходы') },
];

/** The maps a material can have, in the order they are listed. */
export const OUTPUT_ROLES: OutputRole[] = ['color', 'height', 'normal', 'roughness', 'metalness', 'occlusion', 'glow', 'opacity', 'wearColor', 'wearRoughness', 'wearMetal', 'wearNoise'];
