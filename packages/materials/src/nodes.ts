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
  | { id: string; label: L; kind: 'int'; min: number; max: number; default: number; /** When unset, take this other setting's value (older files had one setting for both). */ follows?: string }
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
  /** Kept out of the add menu and the library (made another way, like reroute dots on wires). */
  hidden?: boolean;
}

const l = (en: string, ru: string = en): L => ({ en, ru });
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

/**
 * A named noise: settings shared by all (scale, detail, roughness, contrast, seed); the body sets `float v`.
 * `sharp`: contrast sharpens inside the body instead. `spots`: a Brightness setting too.
 */
function noise(
  type: string,
  en: string,
  ru: string,
  hintEn: string,
  hintRu: string,
  d: { scale: number; octaves: number; roughness: number; contrast: number },
  body: string,
  sharp = false,
  spots = false,
): NodeDef {
  const params: Param[] = [
    { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 64, default: d.scale },
    { id: 'octaves', label: l('Detail', 'Детали'), kind: 'int', min: 1, max: 10, default: d.octaves },
    { id: 'roughness', label: l('Roughness', 'Грубость'), kind: 'number', min: 0, max: 1, default: d.roughness },
    { id: 'contrast', label: sharp && !spots ? l('Sharpness', 'Чёткость') : l('Contrast', 'Контраст'), kind: 'number', min: 0, max: 1, default: d.contrast },
  ];
  if (spots) params.push({ id: 'balance', label: l('Brightness', 'Яркость'), kind: 'number', min: 0, max: 1, default: 0.5 });
  params.push(seed);
  const end = spots
    ? 'v = clamp((v - 0.5) * (1. + p_contrast * 3.) + p_balance, 0., 1.);'
    : sharp
      ? 'v = clamp(v, 0., 1.);'
      : 'v = clamp((v - 0.5) * (1. + p_contrast * 3.) + 0.5, 0., 1.);';
  return { type, group: 'make', label: l(en, ru), hint: l(hintEn, hintRu), inputs: [], output: 'grey', params, glsl: `${body}\n${end}\noutColor = vec4(vec3(v), 1.);` };
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
      { id: 'distort', label: l('Shape distortion'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'turn', label: l('Random turn'), kind: 'number', min: 0, max: 30, step: 0.5, default: 0 },
      seed,
    ],
    glsl: `float y = uv.y * p_rows; float row = floor(y);
float x = uv.x * p_columns + p_offset * mod(row, 2.); float col = floor(x);
vec2 f = vec2(fract(x), fract(y));
vec2 cell = vec2(mod(col, p_columns), mod(row, p_rows)) + seedv(p_seed);
float d;
if (p_distort <= 0. && p_turn <= 0.) {
  // Distance to the brick's edge, in row heights.
  float dx = min(f.x, 1. - f.x) * p_rows / p_columns, dy = min(f.y, 1. - f.y);
  d = min(dx, dy) - p_mortar * 0.5;
} else {
  // The brick as an uneven eight-cornered outline (corners cut, sides bent), turned a little; in row heights.
  vec2 A = vec2(0.5 * p_rows / p_columns, 0.5) - p_mortar * 0.5;
  vec2 q = (f - 0.5) * vec2(p_rows / p_columns, 1.);
  float ang = radians(p_turn) * (hash12(cell * 1.37 + 5.1) * 2. - 1.);
  q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * q;
  float m = min(A.x, A.y), k = p_distort;
  vec2 v[8];
  // Corners: cut in by a random amount each way.
  for (int i = 1; i < 8; i += 2) {
    vec2 rn = hash22(cell * 7.13 + float(i) * 13.7 + 0.5);
    float t = float(i) * PI * 0.25;
    vec2 c = sign(vec2(cos(t), sin(t)));
    v[i] = c * A - c * rn * k * m * vec2(1.1, 0.9);
  }
  // Middles of the sides: somewhere between their two corners, bulged out a little (never in, so the outline
  // stays convex and every brick is one clean piece).
  for (int i = 0; i < 8; i += 2) {
    vec2 rn = hash22(cell * 7.13 + float(i) * 13.7 + 0.5);
    vec2 a = v[(i + 7) % 8], b = v[i + 1];
    vec2 e = normalize(b - a);
    v[i] = mix(a, b, 0.5 + (rn.x - 0.5) * 0.6 * k) + vec2(e.y, -e.x) * rn.y * k * m * 0.3;
  }
  float out_ = -1e9;
  for (int i = 0; i < 8; i++) {
    vec2 a = v[i], b = v[(i + 1) % 8];
    vec2 e = normalize(b - a);
    out_ = max(out_, dot(q - a, vec2(e.y, -e.x)));
  }
  // (Never past the cell's own edges.)
  float dx = min(f.x, 1. - f.x) * p_rows / p_columns, dy = min(f.y, 1. - f.y);
  d = min(-out_, min(dx, dy) - p_mortar * 0.5);
}
float r = hash12(cell);
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
    type: 'histogramScan',
    group: 'change',
    label: l('Histogram scan'),
    hint: l('Turn a grey picture into a mask: Position slides the cut from dark to light (more white as it rises), Contrast hardens the edge.'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'position', label: l('Position'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'contrast', label: l('Contrast'), kind: 'number', min: 0, max: 1, default: 0.5 },
    ],
    glsl: `float w = max(1. - p_contrast, 0.001);
outColor = vec4(vec3(clamp((inG_in(uv) - (1. - p_position)) / w + 0.5, 0., 1.)), 1.);`,
  },
  {
    type: 'histogramRange',
    group: 'change',
    label: l('Histogram range'),
    hint: l('Squeeze the greys into a narrower range (Range) and place it lighter or darker (Position).'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'range', label: l('Range'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'position', label: l('Position'), kind: 'number', min: 0, max: 1, default: 0.5 },
    ],
    glsl: `outColor = vec4(vec3(clamp((inG_in(uv) - 0.5) * p_range + p_position, 0., 1.)), 1.);`,
  },
  {
    type: 'histogramShift',
    group: 'change',
    label: l('Histogram shift'),
    hint: l('Slide every grey lighter, wrapping white round to black (moves stripes of a gradient along).'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [{ id: 'position', label: l('Position'), kind: 'number', min: 0, max: 1, default: 0 }],
    glsl: `outColor = vec4(vec3(fract(inG_in(uv) + p_position)), 1.);`,
  },
  {
    type: 'histogramSelect',
    group: 'change',
    label: l('Histogram select'),
    hint: l('Pick out one band of greys as white (Position: which grey, Range: how wide, Contrast: how hard its edges).'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'position', label: l('Position'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'range', label: l('Range'), kind: 'number', min: 0, max: 1, default: 0.25 },
      { id: 'contrast', label: l('Contrast'), kind: 'number', min: 0, max: 1, default: 0.5 },
    ],
    glsl: `float half_ = p_range * 0.5; float soft = max((1. - p_contrast) * half_, 0.001);
float d = abs(inG_in(uv) - p_position);
outColor = vec4(vec3(1. - smoothstep(half_ - soft, half_ + soft, d)), 1.);`,
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
    type: 'directionalWarp',
    group: 'change',
    label: l('Directional warp', 'Направленное искажение'),
    hint: l('Push the picture along one direction by how bright another is: once (a shift), or flowing step by step (smeared, streaky).', 'Сдвинуть картинку в одном направлении по яркости другой: один раз (сдвиг) или течением шаг за шагом (размазанно, полосами).'),
    inputs: [IN_COLOR(), IN_GREY('by', l('Intensity', 'Сила'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'angle', label: l('Direction', 'Направление'), kind: 'number', min: 0, max: 360, step: 1, default: 0 },
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 1, default: 0.15 },
      { id: 'mode', label: l('How', 'Как'), kind: 'choice', options: [opt('shift', 'Shift', 'Сдвиг'), opt('flow', 'Flow', 'Течение')], default: 'shift' },
      { id: 'centred', label: l('Grey stays put', 'Серое на месте'), kind: 'bool', default: true },
    ],
    glsl: `vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle)));
float bias = p_centred > 0.5 ? 0.5 : 0.;
vec2 q = uv;
if (p_mode < 0.5) q += dir * (inG_by(uv) - bias) * p_amount;
else for (int k = 0; k < 12; k++) q += dir * (inG_by(q) - bias) * p_amount / 12.;
outColor = vec4(inC_in(q).rgb, 1.);`,
  },
  {
    type: 'floodFill',
    group: 'change',
    label: l('Flood fill', 'Заливка областей'),
    hint: l('Give each separate white shape of a mask (each brick, tile, plank) its own value: a random grey or colour, a gradient across it, or where it is.', 'Дать каждой отдельной белой фигуре маски (кирпичу, плитке, доске) своё значение: случайный серый или цвет, градиент по ней или её положение. Точно для прямоугольных фигур.'),
    inputs: [IN_GREY('in', l('Mask', 'Маска'), [1, 1, 1])],
    output: 'color',
    params: [
      {
        id: 'gives',
        label: l('Gives', 'Выдаёт'),
        kind: 'choice',
        options: [opt('grey', 'Random grey', 'Случайный серый'), opt('colour', 'Random colour', 'Случайный цвет'), opt('gradient', 'Gradient', 'Градиент'), opt('position', 'Position', 'Положение'), opt('size', 'Size', 'Размер')],
        default: 'grey',
      },
      { id: 'direction', label: l('Gradient', 'Градиент'), kind: 'choice', options: [opt('across', 'Across', 'Поперёк'), opt('down', 'Down', 'Вниз'), opt('random', 'Random way', 'Случайно')], default: 'random' },
      { id: 'angleVar', label: l('Random angle'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'threshold', label: l('White from', 'Белое от'), kind: 'number', min: 0.01, max: 0.99, default: 0.5 },
      seed,
    ],
    glsl: `if (inG_in(uv) < p_threshold) { outColor = vec4(0., 0., 0., 1.); return; }
// The shape's middle: the spot that is halfway across the shape both ways (sideways and up-down). Found by
// measuring across the shape (2 pixels a step, then narrowed to the exact edge) and jumping to where those
// halfway points meet, a few times. Every pixel of a shape lands on the same spot, also for uneven, turned or thin
// slanted shapes, so the whole shape gets one id, one extent and one gradient.
float st = u_px * 2.; float hh = u_px * 1.5; vec2 sc = uv; vec2 lo = uv, hi = uv;
for (int it = 0; it < 12; it++) {
  float mid[4]; float ext[4];
  for (int q = 0; q < 4; q++) {
    vec2 o = q == 1 ? sc + vec2(0., hh) : q == 3 ? sc + vec2(hh, 0.) : sc;
    vec2 ax = q < 2 ? vec2(1., 0.) : vec2(0., 1.);
    float e[2];
    for (int w = 0; w < 2; w++) {
      vec2 dir = w == 0 ? -ax : ax;
      float a = 0.;
      for (int k = 1; k <= 160; k++) { if (inG_in(o + dir * float(k) * st) < p_threshold) break; a = float(k) * st; }
      float b = a + st;
      for (int j = 0; j < 6; j++) { float m = 0.5 * (a + b); if (inG_in(o + dir * m) < p_threshold) b = m; else a = m; }
      e[w] = a;
    }
    // (A probe that fell outside the shape tells nothing: it reads as straight up and down.)
    mid[q] = inG_in(o) < p_threshold ? dot(sc, ax) : dot(o, ax) + (e[1] - e[0]) * 0.5;
    if (q == 0) { ext[0] = e[0]; ext[1] = e[1]; }
    if (q == 2) { ext[2] = e[0]; ext[3] = e[1]; }
  }
  lo = sc - vec2(ext[0], ext[2]); hi = sc + vec2(ext[1], ext[3]);
  float ex = mid[0] - sc.x, ey = mid[2] - sc.y;
  float sa = (mid[1] - mid[0]) / hh, sb = (mid[3] - mid[2]) / hh;
  float den = 1. - sa * sb; den = abs(den) < 0.05 ? 0.05 : den;
  float dx = (ex + sa * ey) / den; float dy = ey + sb * dx;
  // (The first rounds only walk part of the way in, so pixels near the edge get well inside first.)
  vec2 nc = it < 4 ? sc + vec2(ex, ey) * 0.6 : sc + vec2(dx, dy);
  if (inG_in(nc) < p_threshold) nc = sc + vec2(ex, ey) * 0.6;
  if (inG_in(nc) < p_threshold) break;
  bool done = it >= 4 && length(nc - sc) < u_px * 0.01;
  sc = nc;
  if (done) break;
}
// The extent once more, from where it settled (so every pixel of the shape uses the same one).
{
  float ext[4];
  for (int q = 0; q < 4; q++) {
    vec2 dir = q == 0 ? vec2(-1., 0.) : q == 1 ? vec2(1., 0.) : q == 2 ? vec2(0., -1.) : vec2(0., 1.);
    float a = 0.;
    for (int k = 1; k <= 160; k++) { if (inG_in(sc + dir * float(k) * st) < p_threshold) break; a = float(k) * st; }
    float b = a + st;
    for (int j = 0; j < 6; j++) { float m = 0.5 * (a + b); if (inG_in(sc + dir * m) < p_threshold) b = m; else a = m; }
    ext[q] = a;
  }
  lo = sc - vec2(ext[0], ext[2]); hi = sc + vec2(ext[1], ext[3]);
}
// (Wrapped whole, so a shape crossing the square's edge gets one id on both sides.)
float cs = st * 4.; float n = floor(1. / cs + 0.5);
vec2 id = mod(floor(sc / cs), n);
vec2 ctr = fract(sc);
float h = hash12(id + seedv(p_seed));
int g = int(p_gives + 0.5); vec3 c;
if (g == 0) c = vec3(h);
else if (g == 1) c = hsv2rgb(vec3(h, 0.55 + 0.4 * hash12(id + seedv(p_seed) + 3.3), 0.6 + 0.4 * hash12(id + seedv(p_seed) + 7.1)));
else if (g == 2) {
  vec2 t = (uv - lo) / max(hi - lo, vec2(1e-4));
  float a = p_direction < 0.5 ? 0. : p_direction < 1.5 ? 1.5707963 : h * 6.2831853;
  a += (hash12(id + seedv(p_seed) + 11.3) - 0.5) * 6.2831853 * p_angleVar;
  vec2 dv = vec2(cos(a), sin(a));
  float v = dot(t - 0.5, dv) / (abs(dv.x) * 0.5 + abs(dv.y) * 0.5 + 1e-4) * 0.5 + 0.5;
  c = vec3(clamp(v, 0., 1.));
}
else if (g == 3) c = vec3(ctr, 0.);
else c = vec3(clamp((hi - lo) * 1., 0., 1.), 0.);
outColor = vec4(c, 1.);`,
  },
  {
    type: 'floodGradient',
    group: 'change',
    label: l('Flood fill to gradient'),
    hint: l('A gradient across each separate white shape of a mask (each brick, tile, plank): set its angle and how much each shape turns, how steep it is, and its shape. Good for bevels, uneven bricks and lighting each piece differently.'),
    inputs: [IN_GREY('in', l('Mask'), [1, 1, 1])],
    output: 'grey',
    params: [
      { id: 'angle', label: l('Angle'), kind: 'number', min: 0, max: 360, step: 1, default: 0 },
      { id: 'angleVar', label: l('Angle variation'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'slope', label: l('Steepness'), kind: 'number', min: 0.1, max: 4, default: 1 },
      { id: 'slopeVar', label: l('Steepness variation'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'form', label: l('Shape'), kind: 'choice', options: [opt('linear', 'Linear', 'Linear'), opt('mirror', 'Mirrored', 'Mirrored'), opt('radial', 'From the middle', 'From the middle')], default: 'linear' },
      { id: 'threshold', label: l('White from'), kind: 'number', min: 0.01, max: 0.99, default: 0.5 },
      seed,
    ],
    glsl: `if (inG_in(uv) < p_threshold) { outColor = vec4(0., 0., 0., 1.); return; }
// The shape's middle: the spot that is halfway across the shape both ways (sideways and up-down). Found by
// measuring across the shape (2 pixels a step, then narrowed to the exact edge) and jumping to where those
// halfway points meet, a few times. Every pixel of a shape lands on the same spot, also for uneven, turned or thin
// slanted shapes, so the whole shape gets one id, one extent and one gradient.
float st = u_px * 2.; float hh = u_px * 1.5; vec2 sc = uv; vec2 lo = uv, hi = uv;
for (int it = 0; it < 12; it++) {
  float mid[4]; float ext[4];
  for (int q = 0; q < 4; q++) {
    vec2 o = q == 1 ? sc + vec2(0., hh) : q == 3 ? sc + vec2(hh, 0.) : sc;
    vec2 ax = q < 2 ? vec2(1., 0.) : vec2(0., 1.);
    float e[2];
    for (int w = 0; w < 2; w++) {
      vec2 dir = w == 0 ? -ax : ax;
      float a = 0.;
      for (int k = 1; k <= 160; k++) { if (inG_in(o + dir * float(k) * st) < p_threshold) break; a = float(k) * st; }
      float b = a + st;
      for (int j = 0; j < 6; j++) { float m = 0.5 * (a + b); if (inG_in(o + dir * m) < p_threshold) b = m; else a = m; }
      e[w] = a;
    }
    // (A probe that fell outside the shape tells nothing: it reads as straight up and down.)
    mid[q] = inG_in(o) < p_threshold ? dot(sc, ax) : dot(o, ax) + (e[1] - e[0]) * 0.5;
    if (q == 0) { ext[0] = e[0]; ext[1] = e[1]; }
    if (q == 2) { ext[2] = e[0]; ext[3] = e[1]; }
  }
  lo = sc - vec2(ext[0], ext[2]); hi = sc + vec2(ext[1], ext[3]);
  float ex = mid[0] - sc.x, ey = mid[2] - sc.y;
  float sa = (mid[1] - mid[0]) / hh, sb = (mid[3] - mid[2]) / hh;
  float den = 1. - sa * sb; den = abs(den) < 0.05 ? 0.05 : den;
  float dx = (ex + sa * ey) / den; float dy = ey + sb * dx;
  // (The first rounds only walk part of the way in, so pixels near the edge get well inside first.)
  vec2 nc = it < 4 ? sc + vec2(ex, ey) * 0.6 : sc + vec2(dx, dy);
  if (inG_in(nc) < p_threshold) nc = sc + vec2(ex, ey) * 0.6;
  if (inG_in(nc) < p_threshold) break;
  bool done = it >= 4 && length(nc - sc) < u_px * 0.01;
  sc = nc;
  if (done) break;
}
// The extent once more, from where it settled (so every pixel of the shape uses the same one).
{
  float ext[4];
  for (int q = 0; q < 4; q++) {
    vec2 dir = q == 0 ? vec2(-1., 0.) : q == 1 ? vec2(1., 0.) : q == 2 ? vec2(0., -1.) : vec2(0., 1.);
    float a = 0.;
    for (int k = 1; k <= 160; k++) { if (inG_in(sc + dir * float(k) * st) < p_threshold) break; a = float(k) * st; }
    float b = a + st;
    for (int j = 0; j < 6; j++) { float m = 0.5 * (a + b); if (inG_in(sc + dir * m) < p_threshold) b = m; else a = m; }
    ext[q] = a;
  }
  lo = sc - vec2(ext[0], ext[2]); hi = sc + vec2(ext[1], ext[3]);
}
// (Wrapped whole, so a shape crossing the square's edge gets one id on both sides.)
float cs = st * 4.; float n = floor(1. / cs + 0.5);
vec2 id = mod(floor(sc / cs), n);
vec2 ctr = fract(sc);
float h1 = hash12(id + seedv(p_seed)), h2 = hash12(id + seedv(p_seed) + 5.7);
// Where in its shape this pixel is: -1..1 each way.
vec2 t = (uv - lo) / max(hi - lo, vec2(1e-4)) * 2. - 1.;
float a = radians(p_angle) + (h1 - 0.5) * 2. * PI * p_angleVar;
vec2 dv = vec2(cos(a), sin(a));
float v;
int f = int(p_form + 0.5);
if (f == 2) v = 1. - clamp(length(t) / 1.4142, 0., 1.);
else {
  float x = dot(t, dv) / (abs(dv.x) + abs(dv.y) + 1e-4);
  v = f == 1 ? 1. - abs(x) : x * 0.5 + 0.5;
}
float k = p_slope * mix(1., 0.25 + 1.5 * h2, p_slopeVar);
v = clamp((v - 0.5) * k + 0.5, 0., 1.);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'transform',
    group: 'change',
    label: l('Transform', 'Трансформация'),
    hint: l('Repeat, scale, slide or turn the picture (in quarter turns, so it still tiles; a scale other than 1 can break the tiling).', 'Повторить, масштабировать, сдвинуть или повернуть картинку (на четверть оборота, чтобы стыковалась; масштаб не 1 может нарушить стыковку).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'tiles', label: l('Repeat', 'Повторов'), kind: 'int', min: 1, max: 32, default: 2 },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'number', min: 0.1, max: 8, step: 0.01, default: 1 },
      { id: 'x', label: l('Slide across', 'Сдвиг поперёк'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'y', label: l('Slide down', 'Сдвиг вниз'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'turn', label: l('Turn', 'Поворот'), kind: 'choice', options: [opt('0', 'None', 'Нет'), opt('90', '90°', '90°'), opt('180', '180°', '180°'), opt('270', '270°', '270°')], default: '0' },
    ],
    glsl: `vec2 q = uv - 0.5;
if (p_turn > 0.5 && p_turn < 1.5) q = vec2(-q.y, q.x); else if (p_turn > 1.5 && p_turn < 2.5) q = -q; else if (p_turn > 2.5) q = vec2(q.y, -q.x);
outColor = vec4(inC_in((q / max(p_scale, 1e-3) + 0.5) * p_tiles + vec2(p_x, p_y)).rgb, 1.);`,
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
    type: 'reroute',
    group: 'combine',
    label: l('Reroute'),
    hint: l('A dot on a wire, to route it around other nodes. Passes its input through unchanged.'),
    inputs: [IN_COLOR('in', l('In'))],
    output: 'color',
    params: [],
    glsl: `outColor = vec4(inC_in(uv).rgb, 1.);`,
    hidden: true,
  },
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
      { id: 'blackAlpha', label: l('Black to alpha', 'Чёрное в прозрачность'), kind: 'bool', default: false },
      { id: 'cutoff', label: l('Black cutoff', 'Порог чёрного'), kind: 'number', min: 0.005, max: 1, default: 0.1 },
    ],
    glsl: `vec3 a = inC_top(uv).rgb, b = inC_bottom(uv).rgb; vec3 r;
// Black to alpha: the top's black background turns see-through, so a coloured picture sits on the bottom one.
// Darks below the cutoff fade out; colours above stay solid. Soft edges keep their full colour.
float al = 1.;
if (p_blackAlpha > 0.5) { float mx = max(a.r, max(a.g, a.b)); al = smoothstep(0., p_cutoff, mx); a = mx > 1e-4 ? a / mx * max(mx, min(p_cutoff, 1.)) : a; }
int m = int(p_mode + 0.5);
if (m == 0) r = a; else if (m == 1) r = a + b; else if (m == 2) r = b - a; else if (m == 3) r = a * b;
else if (m == 4) r = 1. - (1. - a) * (1. - b);
else if (m == 5) r = mix(2. * a * b, 1. - 2. * (1. - a) * (1. - b), step(0.5, b));
else if (m == 6) r = max(a, b); else if (m == 7) r = min(a, b); else r = abs(a - b);
outColor = vec4(clamp(mix(b, r, inG_mask(uv) * p_opacity * al), 0., 1.), 1.);`,
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

  // ── More: make ──
  {
    type: 'waves',
    group: 'make',
    label: l('Waves and stripes', 'Волны и полосы'),
    hint: l('Repeating bands: soft waves, hard stripes, saw or zigzag-like ramps, optionally wobbly.', 'Повторяющиеся полосы: мягкие волны, чёткие полосы, пила или треугольник, можно с волнистостью.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'kind', label: l('Kind', 'Вид'), kind: 'choice', options: [opt('sine', 'Waves', 'Волны'), opt('stripes', 'Stripes', 'Полосы'), opt('saw', 'Saw', 'Пила'), opt('triangle', 'Triangle', 'Треугольник')], default: 'sine' },
      { id: 'count', label: l('Count', 'Количество'), kind: 'int', min: 1, max: 64, default: 8 },
      { id: 'direction', label: l('Direction', 'Направление'), kind: 'choice', options: [opt('across', 'Across', 'Поперёк'), opt('down', 'Down', 'Вниз'), opt('diagonal', 'Diagonal', 'По диагонали')], default: 'down' },
      { id: 'sharpness', label: l('Sharpness', 'Чёткость'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'wobble', label: l('Wobble', 'Волнистость'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'wobbleScale', label: l('Wobble size', 'Размер волнистости'), kind: 'int', min: 1, max: 16, default: 3 },
      seed,
    ],
    glsl: `float t = p_direction < 0.5 ? uv.x : p_direction < 1.5 ? uv.y : uv.x + uv.y;
t += (fbm(uv, p_wobbleScale, 4., 0.5, 0., p_seed) - 0.5) * p_wobble * 2. / max(p_count, 1.);
float x = fract(t * p_count); int k = int(p_kind + 0.5); float v;
if (k == 0) v = 0.5 + 0.5 * sin(x * 6.2831853);
else if (k == 1) v = 0.5 + 0.5 * sin(x * 6.2831853);
else if (k == 2) v = x;
else v = 1. - abs(x * 2. - 1.);
float e = k == 1 ? (1. - p_sharpness) * 0.45 + 0.01 : (1. - p_sharpness) * 0.5 + 0.02;
if (k == 1 || p_sharpness > 0.) v = mix(v, smoothstep(0.5 - e, 0.5 + e, v), k == 1 ? 1. : p_sharpness);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'hexagons',
    group: 'make',
    label: l('Hexagons', 'Шестиугольники'),
    hint: l('Hexagonal tiles with gaps between them (white tile, black gap).', 'Шестиугольная плитка со швами (белое — плитка, чёрное — шов).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Across', 'В ряд'), kind: 'int', min: 2, max: 48, default: 6 },
      { id: 'gap', label: l('Gap', 'Шов'), kind: 'number', min: 0, max: 0.4, default: 0.06 },
      { id: 'bevel', label: l('Bevel', 'Скос'), kind: 'number', min: 0, max: 0.5, default: 0.15 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `float N = p_scale; float M = max(1., floor(N / 1.7320508 + 0.5));
vec2 p = vec2(uv.x * N, uv.y * M * 1.7320508);
vec2 r = vec2(1., 1.7320508); vec2 hh = r * 0.5;
vec2 a = mod(p, r) - hh; vec2 b = mod(p - hh, r) - hh;
vec2 g = dot(a, a) < dot(b, b) ? a : b;
vec2 cid = p - g;
vec2 q = abs(g); float d = max(q.x, dot(q, vec2(0.5, 0.8660254)));
float edge = 0.5 - d - p_gap * 0.5;
float rnd = hash12(floor(mod(cid + 0.01, vec2(N, M * 1.7320508)) * 4.) + seedv(p_seed));
float v = edge <= 0. ? 0. : (p_bevel > 0. ? smoothstep(0., p_bevel * 0.5, edge) : 1.) * (1. - p_random * rnd);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'weave',
    group: 'make',
    label: l('Weave', 'Плетение'),
    hint: l('Threads woven over and under each other: cloth, baskets, wicker (as height).', 'Нити, переплетённые сверху и снизу: ткань, корзины (как высота).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'threads', label: l('Threads', 'Нитей'), kind: 'int', min: 2, max: 64, default: 8 },
      { id: 'width', label: l('Thread width', 'Толщина нити'), kind: 'number', min: 0.3, max: 1, default: 0.8 },
    ],
    glsl: `vec2 p = uv * p_threads; vec2 c = floor(p); vec2 f = fract(p) - 0.5;
float over = mod(c.x + c.y, 2.); float w = p_width * 0.5;
float hT = 1. - smoothstep(w - 0.08, w, abs(f.y)); float vT = 1. - smoothstep(w - 0.08, w, abs(f.x));
float hH = hT * (0.65 + 0.35 * cos(f.x * 3.14159)); float vH = vT * (0.65 + 0.35 * cos(f.y * 3.14159));
float v = over > 0.5 ? max(hH, vH * 0.55) : max(vH, hH * 0.55);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'planks',
    group: 'make',
    label: l('Planks', 'Доски'),
    hint: l('Rows of boards of staggered lengths with gaps, each a little different, with grain.', 'Ряды досок разной длины со щелями, каждая чуть другая, с волокнами.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'rows', label: l('Rows', 'Рядов'), kind: 'int', min: 1, max: 32, default: 6 },
      { id: 'lengths', label: l('Boards per row', 'Досок в ряду'), kind: 'int', min: 1, max: 8, default: 2 },
      { id: 'gap', label: l('Gap', 'Щель'), kind: 'number', min: 0, max: 0.2, default: 0.03 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.35 },
      { id: 'grain', label: l('Grain', 'Волокна'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `float y = uv.y * p_rows; float row = floor(y); float fy = fract(y);
float sh = hash12(vec2(mod(row, p_rows), 3.) + seedv(p_seed));
float x = uv.x * p_lengths + sh; float col = floor(x); float fx = fract(x);
float dGap = min(min(fy, 1. - fy), min(fx, 1. - fx) * p_rows / p_lengths);
float board = smoothstep(p_gap * 0.5, p_gap * 0.5 + 0.03, dGap);
float r = hash12(vec2(mod(col, p_lengths), mod(row, p_rows)) + seedv(p_seed) + 5.);
float g = 0.5 + 0.5 * sin((fy * 7. + fbm(uv, 8., 4., 0.5, 0., p_seed + r * 7.) * 3.) * 6.2831853);
outColor = vec4(vec3(board * (1. - p_random * r) * mix(1., 0.72 + 0.28 * g, p_grain)), 1.);`,
  },
  {
    type: 'woodGrain',
    group: 'make',
    label: l('Wood grain', 'Древесина'),
    hint: l('Growth rings bent by noise, like sawn wood.', 'Годовые кольца, изогнутые шумом, как у распиленного дерева.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'rings', label: l('Rings', 'Колец'), kind: 'int', min: 1, max: 48, default: 8 },
      { id: 'distortion', label: l('Distortion', 'Искривление'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 16, default: 3 },
      seed,
    ],
    glsl: `float n = fbm(uv, p_scale, 5., 0.55, 0., p_seed);
float t = uv.y * p_rings + n * p_distortion * 4.;
float v = pow(0.5 + 0.5 * sin(t * 6.2831853), 3.);
outColor = vec4(vec3(1. - v * 0.8), 1.);`,
  },
  {
    type: 'cobblestones',
    group: 'make',
    label: l('Cobblestones', 'Булыжник'),
    hint: l('Rounded stones packed together with gaps (as height).', 'Округлые камни вплотную со швами (как высота).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 2, max: 48, default: 7 },
      { id: 'gap', label: l('Gap', 'Шов'), kind: 'number', min: 0, max: 0.3, default: 0.05 },
      { id: 'bevel', label: l('Roundness', 'Округлость'), kind: 'number', min: 0, max: 1, default: 0.6 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `vec3 v = voronoi(uv, p_scale, 0.9, p_seed);
float d = (v.y - v.x) * 0.5 - p_gap * 0.5;
float h = d <= 0. ? 0. : smoothstep(0., p_bevel * 0.4 + 1e-3, d);
outColor = vec4(vec3(h * (1. - p_random * v.z)), 1.);`,
  },
  {
    type: 'cracks',
    group: 'make',
    label: l('Cracks', 'Трещины'),
    hint: l('A network of thin wandering cracks (white): dry mud, old paint, broken stone.', 'Сеть тонких извилистых трещин (белое): сухая грязь, старая краска, камень.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 2, max: 48, default: 6 },
      { id: 'width', label: l('Width', 'Ширина'), kind: 'number', min: 0.01, max: 1, default: 0.25 },
      { id: 'distortion', label: l('Wander', 'Извилистость'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `vec2 w = vec2(fbm(uv, 4., 4., 0.5, 0., p_seed + 11.), fbm(uv, 4., 4., 0.5, 0., p_seed + 23.)) - 0.5;
vec3 v = voronoi(fract(uv + w * p_distortion * 0.25), p_scale, 1., p_seed);
outColor = vec4(vec3(1. - smoothstep(0., p_width * 0.1 + 1e-3, v.y - v.x)), 1.);`,
  },
  {
    type: 'marble',
    group: 'make',
    label: l('Marble', 'Мрамор'),
    hint: l('Veins swirled through stone.', 'Прожилки, закрученные в камне.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'veins', label: l('Veins', 'Прожилок'), kind: 'int', min: 1, max: 16, default: 3 },
      { id: 'turbulence', label: l('Turbulence', 'Завихрения'), kind: 'number', min: 0, max: 1, default: 0.6 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 16, default: 3 },
      { id: 'sharpness', label: l('Thin veins', 'Тонкие прожилки'), kind: 'number', min: 0, max: 1, default: 0.6 },
      seed,
    ],
    glsl: `float n = fbm(uv, p_scale, 6., 0.55, 0., p_seed);
float t = (uv.x + uv.y) * p_veins + (n - 0.5) * p_turbulence * 3.;
float v = pow(1. - abs(sin(t * 3.14159265)), mix(1., 6., p_sharpness));
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'blobs',
    group: 'make',
    label: l('Blobs', 'Пятна'),
    hint: l('Soft or sharp random patches covering as much as you say: rust spots, puddles, moss.', 'Мягкие или чёткие случайные пятна нужной площади: ржавчина, лужи, мох.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 32, default: 4 },
      { id: 'coverage', label: l('Coverage', 'Покрытие'), kind: 'number', min: 0, max: 1, default: 0.4 },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 1, default: 0.2 },
      seed,
    ],
    glsl: `float n = fbm(uv, p_scale, 5., 0.5, 0., p_seed);
float e = 1. - p_coverage; float s = p_softness * 0.2 + 0.005;
outColor = vec4(vec3(smoothstep(e - s, e + s, n)), 1.);`,
  },
  {
    type: 'speckles',
    group: 'make',
    label: l('Speckles', 'Крапинки'),
    hint: l('Small random dots: gravel, terrazzo, stars, dust.', 'Мелкие случайные точки: гравий, терраццо, звёзды, пыль.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'density', label: l('Grid', 'Сетка'), kind: 'int', min: 4, max: 256, default: 24 },
      { id: 'amount', label: l('Amount', 'Сколько'), kind: 'number', min: 0, max: 1, default: 0.35 },
      { id: 'size', label: l('Size', 'Размер'), kind: 'number', min: 0.05, max: 1, default: 0.7 },
      seed,
    ],
    glsl: `vec2 p = uv * p_density; vec2 c = floor(p); vec2 f = fract(p);
vec2 o = seedv(p_seed); vec2 cm = mod(c, p_density);
float has = step(1. - p_amount, hash12(cm + o));
vec2 at = 0.25 + 0.5 * hash22(cm + o + 3.1);
float r = p_size * 0.3 * (0.5 + hash12(cm + o + 9.2));
float v = has * (1. - smoothstep(r * 0.6, r, length(f - at)));
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'scatter',
    group: 'make',
    label: l('Scatter', 'Разброс'),
    hint: l('Copies of a picture scattered over the square, each a different size, turn and brightness: leaves, pebbles, bolts.', 'Копии картинки, разбросанные по квадрату, разного размера, поворота и яркости: листья, камешки, болты.'),
    inputs: [IN_COLOR('in', l('Picture', 'Картинка'), [1, 1, 1])],
    output: 'color',
    params: [
      { id: 'count', label: l('Amount X', 'Количество по X'), kind: 'int', min: 1, max: 32, default: 6 },
      { id: 'countY', label: l('Amount Y', 'Количество по Y'), kind: 'int', min: 1, max: 32, default: 6, follows: 'count' },
      { id: 'size', label: l('Size', 'Размер'), kind: 'number', min: 0.05, max: 2, default: 0.6 },
      { id: 'sizeRandom', label: l('Size varies', 'Разный размер'), kind: 'number', min: 0, max: 1, default: 0.4 },
      { id: 'turn', label: l('Turn varies', 'Разный поворот'), kind: 'number', min: 0, max: 1, default: 1 },
      { id: 'brightRandom', label: l('Brightness varies', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      { id: 'apart', label: l('Keep apart', 'Не пересекать'), kind: 'bool', default: false },
      { id: 'stack', label: l('No clipping', 'Без отсечения'), kind: 'bool', default: false },
      { id: 'margin', label: l('Space between', 'Промежуток'), kind: 'number', min: 0, max: 0.5, default: 0.05 },
      seed,
    ],
    glsl: `vec2 N = vec2(p_count, p_countY); vec2 p = uv * N; vec2 c = floor(p); float best = 0.; vec3 col = vec3(0.); vec2 o = seedv(p_seed);
// Copies are measured in units of a cell's shorter side, so uneven X/Y amounts don't stretch them.
float k = max(N.x, N.y); vec2 dims = k / N;
// Keep apart: each copy stays inside its own cell (its turned corners too, plus the space between), so none touch.
float reach = p_turn > 0. ? 0.70711 : 0.5;
float room = max(0., 1. - p_margin);
// No clipping: copies stack whole, one over another in a fixed random order, instead of mixing pixel by pixel.
// Black counts as empty. Looks two cells out so big copies aren't cut off at cell edges.
bool stk = p_stack > 0.5; float top = -1.;
for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
  if (!stk && (abs(x) > 1 || abs(y) > 1)) continue;
  vec2 cc = c + vec2(float(x), float(y)); vec2 cm = mod(cc, N);
  if (p_apart > 0.5 && (x != 0 || y != 0)) continue;
  float s = p_size * (1. - p_sizeRandom * hash12(cm + o + 1.7));
  if (p_apart > 0.5) s = min(s, room / (2. * reach));
  vec2 slack = p_apart > 0.5 ? max(vec2(0.), (dims - p_margin - 2. * reach * s) / dims) : vec2(0.8);
  vec2 ctr = cc + 0.5 + (hash22(cm + o) - 0.5) * slack;
  float a = hash12(cm + o + 4.4) * 6.2831853 * p_turn;
  vec2 d = mat2(cos(a), -sin(a), sin(a), cos(a)) * ((p - ctr) * dims / max(s, 1e-3));
  if (abs(d.x) < 0.5 && abs(d.y) < 0.5) {
    vec3 t = inC_in(d + 0.5).rgb * (1. - p_brightRandom * hash12(cm + o + 8.8));
    float g = dot(t, vec3(0.3333));
    if (stk) { float z = hash12(cm + o + 6.6); if (g > 0.004 && z > top) { top = z; col = t; } }
    else if (g > best) { best = g; col = t; }
  }
}
outColor = vec4(col, 1.);`,
  },
  {
    type: 'zigzag',
    group: 'make',
    label: l('Zigzag', 'Зигзаг'),
    hint: l('Chevron stripes (herringbone-like bands).', 'Полосы-ёлочки (шевроны).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'count', label: l('Count', 'Количество'), kind: 'int', min: 1, max: 32, default: 6 },
      { id: 'amount', label: l('Zig size', 'Размах'), kind: 'number', min: 0, max: 2, default: 0.5 },
      { id: 'direction', label: l('Direction', 'Направление'), kind: 'choice', options: [opt('down', 'Down', 'Вниз'), opt('across', 'Across', 'Поперёк')], default: 'down' },
      { id: 'sharpness', label: l('Sharpness', 'Чёткость'), kind: 'number', min: 0, max: 1, default: 0.8 },
    ],
    glsl: `vec2 q = p_direction < 0.5 ? uv : uv.yx;
float t = q.y * p_count + p_amount * (1. - abs(fract(q.x * p_count) * 2. - 1.));
float s = 0.5 + 0.5 * sin(t * 6.2831853); float e = (1. - p_sharpness) * 0.5 + 0.01;
outColor = vec4(vec3(smoothstep(0.5 - e, 0.5 + e, s)), 1.);`,
  },

  // ── More: change ──
  {
    type: 'sharpen',
    group: 'change',
    label: l('Sharpen', 'Резкость'),
    hint: l('Crisper details: edges pushed apart.', 'Чётче детали: края усилены.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 4, default: 1 },
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.004 },
    ],
    glsl: `vec3 c = inC_in(uv).rgb; float r = p_radius;
vec3 b = (inC_in(uv + vec2(r, 0.)).rgb + inC_in(uv - vec2(r, 0.)).rgb + inC_in(uv + vec2(0., r)).rgb + inC_in(uv - vec2(0., r)).rgb) * 0.25;
outColor = vec4(clamp(c + (c - b) * p_amount, 0., 1.), 1.);`,
  },
  {
    type: 'posterize',
    group: 'change',
    label: l('Posterize', 'Постеризация'),
    hint: l('Fewer shades: hard steps instead of smooth changes (good for stylized looks).', 'Меньше оттенков: ступеньки вместо плавных переходов (для стилизации).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'steps', label: l('Steps', 'Ступеней'), kind: 'int', min: 2, max: 32, default: 4 }],
    glsl: 'outColor = vec4(min(floor(inC_in(uv).rgb * p_steps), vec3(p_steps - 1.)) / max(p_steps - 1., 1.), 1.);',
  },
  {
    type: 'threshold',
    group: 'change',
    label: l('Threshold', 'Порог'),
    hint: l('Black below a level, white above, with a soft or hard step between: turn any grey into a mask.', 'Чёрное ниже уровня, белое выше, с мягким или резким переходом: сделать маску из любого серого.'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'position', label: l('Level', 'Уровень'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'contrast', label: l('Hardness', 'Резкость'), kind: 'number', min: 0, max: 1, default: 0.8 },
    ],
    glsl: `float w = (1. - p_contrast) * 0.5 + 0.002;
outColor = vec4(vec3(smoothstep(p_position - w, p_position + w, inG_in(uv))), 1.);`,
  },
  {
    type: 'brightness',
    group: 'change',
    label: l('Brightness and contrast', 'Яркость и контраст'),
    hint: l('Lighter or darker, more or less contrast, and gamma (mid-tones).', 'Светлее или темнее, больше или меньше контраста, и гамма (средние тона).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'brightness', label: l('Brightness', 'Яркость'), kind: 'number', min: -1, max: 1, default: 0 },
      { id: 'contrast', label: l('Contrast', 'Контраст'), kind: 'number', min: 0, max: 3, default: 1 },
      { id: 'gamma', label: l('Gamma', 'Гамма'), kind: 'number', min: 0.2, max: 5, default: 1 },
    ],
    glsl: `vec3 c = (inC_in(uv).rgb - 0.5) * p_contrast + 0.5 + p_brightness;
outColor = vec4(pow(clamp(c, 0., 1.), vec3(1. / p_gamma)), 1.);`,
  },
  {
    type: 'mirror',
    group: 'change',
    label: l('Mirror', 'Зеркало'),
    hint: l('Make the picture symmetric: left matches right, top matches bottom, or both.', 'Сделать картинку симметричной: слева как справа, сверху как снизу, или оба.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'mode', label: l('Mirror', 'Отразить'), kind: 'choice', options: [opt('across', 'Left–right', 'Слева–справа'), opt('down', 'Top–bottom', 'Сверху–снизу'), opt('both', 'Both', 'Оба')], default: 'across' }],
    glsl: `vec2 q = uv;
if (p_mode < 0.5 || p_mode > 1.5) q.x = 0.5 - abs(uv.x - 0.5);
if (p_mode > 0.5) q.y = 0.5 - abs(uv.y - 0.5);
outColor = vec4(inC_in(q).rgb, 1.);`,
  },
  {
    type: 'pixelate',
    group: 'change',
    label: l('Pixelate', 'Пикселизация'),
    hint: l('Big square pixels (retro look).', 'Крупные квадратные пиксели (ретро).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'cells', label: l('Pixels across', 'Пикселей в ряд'), kind: 'int', min: 2, max: 256, default: 32 }],
    glsl: 'outColor = vec4(inC_in((floor(uv * p_cells) + 0.5) / p_cells).rgb, 1.);',
  },
  {
    type: 'swirl',
    group: 'change',
    label: l('Swirl', 'Завихрение'),
    hint: l('Twist the middle of the picture round (the edges stay put, so it still tiles).', 'Закрутить середину картинки (края на месте, так что плитка стыкуется).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'amount', label: l('Twist', 'Закрутка'), kind: 'number', min: -10, max: 10, default: 3 },
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.05, max: 0.5, default: 0.45 },
    ],
    glsl: `vec2 d = uv - 0.5; float t = clamp(1. - length(d) / p_radius, 0., 1.); float a = p_amount * t * t;
outColor = vec4(inC_in(0.5 + mat2(cos(a), -sin(a), sin(a), cos(a)) * d).rgb, 1.);`,
  },
  {
    type: 'outline',
    group: 'change',
    label: l('Outline', 'Контур'),
    hint: l('White where brightness changes quickly: the edges of shapes.', 'Белое там, где яркость резко меняется: края фигур.'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 10, default: 2 },
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.003 },
    ],
    glsl: `float r = p_radius;
float tl = inG_in(uv + vec2(-r, -r)), tc = inG_in(uv + vec2(0., -r)), tr = inG_in(uv + vec2(r, -r));
float ml = inG_in(uv + vec2(-r, 0.)), mr = inG_in(uv + vec2(r, 0.));
float bl = inG_in(uv + vec2(-r, r)), bc = inG_in(uv + vec2(0., r)), br = inG_in(uv + vec2(r, r));
float gx = tr + 2. * mr + br - tl - 2. * ml - bl; float gy = bl + 2. * bc + br - tl - 2. * tc - tr;
outColor = vec4(vec3(clamp(length(vec2(gx, gy)) * p_strength, 0., 1.)), 1.);`,
  },
  {
    type: 'motionBlur',
    group: 'change',
    label: l('Directional blur', 'Размытие в движении'),
    hint: l('Smear the picture one way: streaks, brushed metal, rain.', 'Смазать картинку в одну сторону: потёки, шлифованный металл, дождь.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'angle', label: l('Direction', 'Направление'), kind: 'number', min: 0, max: 360, step: 1, default: 90 },
      { id: 'length', label: l('Length', 'Длина'), kind: 'number', min: 0, max: 0.25, step: 0.002, default: 0.04 },
    ],
    glsl: `vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle))) * p_length;
vec3 s = vec3(0.); for (int k = -8; k <= 8; k++) s += inC_in(uv + dir * float(k) / 8.).rgb;
outColor = vec4(s / 17., 1.);`,
  },
  {
    type: 'emboss',
    group: 'change',
    label: l('Light from height', 'Свет по высоте'),
    hint: l('Light a height picture from one side: bright slopes face the light (a quick preview or stylized shading).', 'Осветить карту высот с одной стороны: склоны к свету светлее (быстрый просмотр или стилизованные тени).'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'angle', label: l('Light from', 'Свет с'), kind: 'number', min: 0, max: 360, step: 1, default: 225 },
      { id: 'elevation', label: l('Light height', 'Высота света'), kind: 'number', min: 5, max: 85, step: 1, default: 40 },
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 4, default: 1 },
    ],
    glsl: `float e = 1. / 256.;
vec2 g = vec2(inG_in(uv + vec2(e, 0.)) - inG_in(uv - vec2(e, 0.)), inG_in(uv + vec2(0., e)) - inG_in(uv - vec2(0., e))) * p_strength * 32.;
vec3 n = normalize(vec3(-g, 1.)); float el = radians(p_elevation), az = radians(p_angle);
vec3 L = vec3(cos(az) * cos(el), sin(az) * cos(el), sin(el));
outColor = vec4(vec3(clamp(dot(n, L), 0., 1.)), 1.);`,
  },

  // ── More: combine ──
  {
    type: 'math',
    group: 'combine',
    label: l('Math', 'Математика'),
    hint: l('Combine two greys with a sum: add, subtract, multiply, divide, min, max, power … (B is the number when not linked).', 'Совместить два серых: сложить, вычесть, умножить, разделить, мин, макс, степень … (Б — число, если не подключено).'),
    inputs: [IN_GREY('a', l('A', 'А'), [0.5, 0.5, 0.5]), IN_GREY('b', l('B', 'Б'), [0.5, 0.5, 0.5])],
    output: 'grey',
    params: [
      {
        id: 'op',
        label: l('Sum', 'Действие'),
        kind: 'choice',
        options: [opt('add', 'A + B', 'А + Б'), opt('sub', 'A − B', 'А − Б'), opt('mul', 'A × B', 'А × Б'), opt('div', 'A ÷ B', 'А ÷ Б'), opt('min', 'Smaller', 'Меньшее'), opt('max', 'Larger', 'Большее'), opt('pow', 'A to the power B', 'А в степени Б'), opt('diff', 'Difference', 'Разница'), opt('avg', 'Average', 'Среднее')],
        default: 'mul',
      },
      { id: 'value', label: l('B (when not linked)', 'Б (без связи)'), kind: 'number', min: -1, max: 4, default: 1 },
    ],
    glsl: `float a = inG_a(uv); float b = h_b > 0.5 ? inG_b(uv) : p_value; int m = int(p_op + 0.5); float r;
if (m == 0) r = a + b; else if (m == 1) r = a - b; else if (m == 2) r = a * b; else if (m == 3) r = a / max(abs(b), 1e-4) * sign(b + 1e-9);
else if (m == 4) r = min(a, b); else if (m == 5) r = max(a, b); else if (m == 6) r = pow(max(a, 0.), b); else if (m == 7) r = abs(a - b); else r = (a + b) * 0.5;
outColor = vec4(vec3(clamp(r, 0., 1.)), 1.);`,
  },
  {
    type: 'heightBlend',
    group: 'combine',
    label: l('Height blend', 'Смешать по высоте'),
    hint: l('Two materials meet by height: the higher one shows (sand between stones, moss in cracks, paint chipping off).', 'Два материала встречаются по высоте: видно более высокий (песок между камнями, мох в трещинах, облупившаяся краска).'),
    inputs: [IN_COLOR('top', l('Top colour', 'Верхний цвет'), [1, 1, 1]), IN_GREY('heightTop', l('Top height', 'Верхняя высота'), [0.5, 0.5, 0.5]), IN_COLOR('bottom', l('Bottom colour', 'Нижний цвет'), [0, 0, 0]), IN_GREY('heightBottom', l('Bottom height', 'Нижняя высота'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'offset', label: l('Top raised by', 'Поднять верхний на'), kind: 'number', min: -1, max: 1, default: 0 },
      { id: 'contrast', label: l('Hardness', 'Резкость'), kind: 'number', min: 0, max: 1, default: 0.85 },
      { id: 'out', label: l('Gives', 'Выдаёт'), kind: 'choice', options: [opt('colour', 'Colour', 'Цвет'), opt('height', 'Height', 'Высоту'), opt('mask', 'Mask', 'Маску')], default: 'colour' },
    ],
    glsl: `float ha = inG_heightTop(uv) + p_offset, hb = inG_heightBottom(uv); float w = (1. - p_contrast) * 0.5 + 0.005;
float m = smoothstep(-w, w, ha - hb);
vec3 r = p_out < 0.5 ? mix(inC_bottom(uv).rgb, inC_top(uv).rgb, m) : p_out < 1.5 ? vec3(clamp(mix(hb, ha, m), 0., 1.)) : vec3(m);
outColor = vec4(r, 1.);`,
  },
  {
    type: 'combineChannels',
    group: 'combine',
    label: l('Combine channels', 'Собрать каналы'),
    hint: l('Make a colour from three greys as its red, green and blue.', 'Собрать цвет из трёх серых как красный, зелёный и синий.'),
    inputs: [IN_GREY('r', l('Red', 'Красный')), IN_GREY('g', l('Green', 'Зелёный')), IN_GREY('b', l('Blue', 'Синий'))],
    output: 'color',
    params: [],
    glsl: 'outColor = vec4(inG_r(uv), inG_g(uv), inG_b(uv), 1.);',
  },
  {
    type: 'splitChannel',
    group: 'combine',
    label: l('Pick channel', 'Взять канал'),
    hint: l('One channel of a colour as grey: red, green, blue, or brightness.', 'Один канал цвета как серое: красный, зелёный, синий или яркость.'),
    inputs: [IN_COLOR()],
    output: 'grey',
    params: [{ id: 'channel', label: l('Channel', 'Канал'), kind: 'choice', options: [opt('r', 'Red', 'Красный'), opt('g', 'Green', 'Зелёный'), opt('b', 'Blue', 'Синий'), opt('l', 'Brightness', 'Яркость')], default: 'r' }],
    glsl: `vec3 c = inC_in(uv).rgb; int k = int(p_channel + 0.5);
float v = k == 0 ? c.r : k == 1 ? c.g : k == 2 ? c.b : dot(c, vec3(0.2126, 0.7152, 0.0722));
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'colorSelect',
    group: 'combine',
    label: l('Colour to mask', 'Цвет в маску'),
    hint: l('White where the picture is close to a colour: pick out one part to treat differently.', 'Белое там, где картинка близка к цвету: выделить часть, чтобы обработать отдельно.'),
    inputs: [IN_COLOR()],
    output: 'grey',
    params: [
      { id: 'color', label: l('Colour', 'Цвет'), kind: 'color', default: '#808080' },
      { id: 'tolerance', label: l('Tolerance', 'Допуск'), kind: 'number', min: 0, max: 1, default: 0.2 },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 1, default: 0.2 },
    ],
    glsl: `float d = distance(inC_in(uv).rgb, p_color);
outColor = vec4(vec3(1. - smoothstep(p_tolerance, p_tolerance + p_softness * 0.3 + 1e-3, d)), 1.);`,
  },

  // ── More: colour ──
  {
    type: 'replaceColor',
    group: 'colour',
    label: l('Replace colour', 'Заменить цвет'),
    hint: l('Swap one colour for another (and its near shades).', 'Заменить один цвет другим (и близкие оттенки).'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'from', label: l('From', 'Какой'), kind: 'color', default: '#808080' },
      { id: 'to', label: l('To', 'На какой'), kind: 'color', default: '#c05040' },
      { id: 'tolerance', label: l('Tolerance', 'Допуск'), kind: 'number', min: 0, max: 1, default: 0.25 },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 1, default: 0.3 },
    ],
    glsl: `vec3 c = inC_in(uv).rgb;
float m = 1. - smoothstep(p_tolerance, p_tolerance + p_softness * 0.3 + 1e-3, distance(c, p_from));
outColor = vec4(mix(c, clamp(c + (p_to - p_from), 0., 1.), m), 1.);`,
  },
  {
    type: 'desaturate',
    group: 'colour',
    label: l('Desaturate', 'Обесцветить'),
    hint: l('Take the colour out, partly or fully.', 'Убрать цвет, частично или полностью.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [{ id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 1, default: 1 }],
    glsl: 'vec3 c = inC_in(uv).rgb; outColor = vec4(mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), p_amount), 1.);',
  },
  {
    type: 'colorVariation',
    group: 'colour',
    label: l('Colour variation', 'Разнообразие цвета'),
    hint: l('Break up a flat colour with large, soft shifts in brightness and hue.', 'Оживить ровный цвет крупными мягкими сдвигами яркости и тона.'),
    inputs: [IN_COLOR('in', l('In', 'Вход'), [0.6, 0.6, 0.6])],
    output: 'color',
    params: [
      { id: 'amount', label: l('Brightness', 'Яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      { id: 'hue', label: l('Hue', 'Тон'), kind: 'number', min: 0, max: 0.5, default: 0.05 },
      { id: 'scale', label: l('Size', 'Размер'), kind: 'int', min: 1, max: 32, default: 4 },
      seed,
    ],
    glsl: `float n = fbm(uv, p_scale, 4., 0.5, 0., p_seed) - 0.5; float n2 = fbm(uv, p_scale, 4., 0.5, 0., p_seed + 9.) - 0.5;
vec3 h = rgb2hsv(inC_in(uv).rgb); h.x = fract(h.x + n2 * p_hue * 2.); h.z = clamp(h.z * (1. + n * p_amount * 2.), 0., 1.);
outColor = vec4(hsv2rgb(h), 1.);`,
  },
  {
    type: 'temperature',
    group: 'colour',
    label: l('Warm or cool', 'Теплее или холоднее'),
    hint: l('Shift the colours warmer (orange) or cooler (blue), and greener or pinker.', 'Сдвинуть цвета теплее (оранжевее) или холоднее (синее), и зеленее или розовее.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'warmth', label: l('Warmth', 'Теплота'), kind: 'number', min: -1, max: 1, default: 0.2 },
      { id: 'tint', label: l('Green–pink', 'Зелёный–розовый'), kind: 'number', min: -1, max: 1, default: 0 },
    ],
    glsl: `vec3 c = inC_in(uv).rgb; c.r += p_warmth * 0.12; c.b -= p_warmth * 0.12; c.g -= p_tint * 0.1; c.rb += p_tint * 0.04;
outColor = vec4(clamp(c, 0., 1.), 1.);`,
  },

  // ── More: surface ──
  {
    type: 'normalBlend',
    group: 'surface',
    label: l('Combine normals', 'Совместить нормали'),
    hint: l('Lay fine detail bumps over a base normal map (both from Height to normal).', 'Наложить мелкий рельеф на основную карту нормалей (обе из «Высота в нормали»).'),
    inputs: [IN_COLOR('base', l('Base', 'Основа'), [0.5, 0.5, 1]), IN_COLOR('detail', l('Detail', 'Детали'), [0.5, 0.5, 1])],
    output: 'color',
    params: [{ id: 'strength', label: l('Detail strength', 'Сила деталей'), kind: 'number', min: 0, max: 2, default: 1 }],
    glsl: `vec3 a = inC_base(uv).rgb * 2. - 1.; vec3 b = inC_detail(uv).rgb * 2. - 1.; b.xy *= p_strength;
outColor = vec4(normalize(vec3(a.xy + b.xy, max(a.z * b.z, 1e-3))) * 0.5 + 0.5, 1.);`,
  },
  {
    type: 'normalAdjust',
    group: 'surface',
    label: l('Adjust normals', 'Настроить нормали'),
    hint: l('Make bumps stronger or flatter, or flip them (for maps made the other way up).', 'Сделать рельеф сильнее или площе, или перевернуть (для карт, сделанных наоборот).'),
    inputs: [IN_COLOR('in', l('Normal', 'Нормали'), [0.5, 0.5, 1])],
    output: 'color',
    params: [
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 4, default: 1 },
      { id: 'flip', label: l('Flip green', 'Перевернуть зелёный'), kind: 'bool', default: false },
    ],
    glsl: `vec3 n = inC_in(uv).rgb * 2. - 1.; n.xy *= p_strength; if (p_flip > 0.5) n.y = -n.y;
outColor = vec4(normalize(vec3(n.xy, max(n.z, 1e-3))) * 0.5 + 0.5, 1.);`,
  },
  {
    type: 'edgeWear',
    group: 'surface',
    label: l('Edge wear', 'Износ краёв'),
    hint: l('A mask of worn edges from a height picture, broken up with noise: paint chipped off corners.', 'Маска стёртых краёв по карте высот, разбитая шумом: краска, стёртая на углах.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'amount', label: l('Amount', 'Сколько'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'breakup', label: l('Breakup', 'Разрывы'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 64, default: 12 },
      seed,
    ],
    glsl: `float h = inG_in(uv); float r = 0.004;
float lap = 4. * h - inG_in(uv + vec2(r, 0.)) - inG_in(uv - vec2(r, 0.)) - inG_in(uv + vec2(0., r)) - inG_in(uv - vec2(0., r));
float edge = clamp(lap * 40., 0., 1.); float n = fbm(uv, p_scale, 5., 0.6, 0., p_seed);
float v = edge * mix(1., n * 1.6, p_breakup);
outColor = vec4(vec3(smoothstep(1. - p_amount, 1. - p_amount + 0.15, v)), 1.);`,
  },
  {
    type: 'dirt',
    group: 'surface',
    label: l('Dirt', 'Грязь'),
    hint: l('A mask of dirt gathering in the dips of a height picture, spread a little with noise.', 'Маска грязи, собирающейся во впадинах карты высот, немного разбросанной шумом.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'))],
    output: 'grey',
    params: [
      { id: 'amount', label: l('Amount', 'Сколько'), kind: 'number', min: 0, max: 1, default: 0.4 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 32, default: 6 },
      seed,
    ],
    glsl: `float h = inG_in(uv); float s = 0., w = 0.;
for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { vec2 o = vec2(x, y) / 2.; float k = exp(-dot(o, o)); s += inG_in(uv + o * 0.03) * k; w += k; }
float cav = clamp((s / w - h) * 8., 0., 1.); float n = fbm(uv, p_scale, 5., 0.55, 0., p_seed);
outColor = vec4(vec3(clamp(cav * 1.5 + (n - 1. + p_amount) * 1.5, 0., 1.)), 1.);`,
  },
  {
    type: 'drips',
    group: 'surface',
    label: l('Drips and streaks', 'Потёки'),
    hint: l('Thin streaks running down, thinning as they go: rain stains, rust runs, leaks.', 'Тонкие потёки вниз, сужающиеся к концу: следы дождя, ржавчины, протечки.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'count', label: l('Lanes', 'Дорожек'), kind: 'int', min: 4, max: 128, default: 32 },
      { id: 'amount', label: l('Amount', 'Сколько'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'length', label: l('Length', 'Длина'), kind: 'number', min: 0.05, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `float col = floor(uv.x * p_count); vec2 o = seedv(p_seed); float cm = mod(col, p_count);
float has = step(1. - p_amount, hash12(vec2(cm, 1.) + o));
float start = hash12(vec2(cm, 2.) + o); float len = p_length * (0.3 + 0.7 * hash12(vec2(cm, 3.) + o));
float y = fract(uv.y - start); float t = clamp(y / max(len, 1e-3), 0., 1.);
float fx = fract(uv.x * p_count) - 0.5; float wd = 0.35 * (1. - t) + 0.02;
float v = has * step(y, len) * (1. - smoothstep(wd * 0.6, wd, abs(fx))) * (1. - t);
outColor = vec4(vec3(v), 1.);`,
  },

  // ── More (2026-11): noises and patterns ──
  {
    type: 'billows',
    group: 'make',
    label: l('Billows', 'Клубы'),
    hint: l('Puffy, folded noise (each layer turned inside out): clouds, smoke, lumpy rock.', 'Пышный, складчатый шум (каждый слой вывернут): облака, дым, бугристый камень.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 64, default: 4 },
      { id: 'octaves', label: l('Detail', 'Детали'), kind: 'int', min: 1, max: 10, default: 5 },
      { id: 'roughness', label: l('Roughness', 'Грубость'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'invert', label: l('Turn over (creases up)', 'Перевернуть (складки вверх)'), kind: 'bool', default: false },
      seed,
    ],
    glsl: `float sum = 0., amp = 1., norm = 0.;
for (int k = 0; k < 10; k++) {
  if (float(k) >= p_octaves) break;
  float per = p_scale * exp2(float(k));
  float n = gradNoise(uv * per, per, p_seed + float(k));
  sum += abs(n * 2. - 1.) * amp; norm += amp; amp *= p_roughness;
}
float v = clamp(sum / max(norm, 1e-5) * 1.15, 0., 1.);
if (p_invert > 0.5) v = 1. - v;
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'warpedNoise',
    group: 'make',
    label: l('Warped noise', 'Закрученный шум'),
    hint: l('Noise pushed around by noise, twice over: flowing marble-like swirls, lava, gas giants.', 'Шум, сдвинутый шумом дважды: текучие завихрения, лава, газовые гиганты.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 32, default: 3 },
      { id: 'octaves', label: l('Detail', 'Детали'), kind: 'int', min: 1, max: 8, default: 5 },
      { id: 'warp', label: l('Swirl', 'Завихрение'), kind: 'number', min: 0, max: 2, default: 1 },
      { id: 'contrast', label: l('Contrast', 'Контраст'), kind: 'number', min: 0, max: 1, default: 0.4 },
      seed,
    ],
    glsl: `float w = p_warp * 0.35;
vec2 q = vec2(fbm(uv, p_scale, p_octaves, 0.5, 0., p_seed), fbm(uv, p_scale, p_octaves, 0.5, 0., p_seed + 5.2)) - 0.5;
vec2 r = vec2(fbm(uv + w * q, p_scale, p_octaves, 0.5, 0., p_seed + 1.7), fbm(uv + w * q, p_scale, p_octaves, 0.5, 0., p_seed + 9.2)) - 0.5;
float v = fbm(uv + w * r, p_scale, p_octaves, 0.5, 0., p_seed + 3.3);
v = clamp((v - 0.5) * (1. + p_contrast * 3.) + 0.5, 0., 1.);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'fibers',
    group: 'make',
    label: l('Fibers', 'Волокна'),
    hint: l('Noise stretched one way: brushed metal, wood fibres, bark (ridged), hair, rain on glass.', 'Шум, вытянутый в одну сторону: шлифованный металл, волокна дерева, кора (с прожилками), волосы.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'kind', label: l('Kind', 'Вид'), kind: 'choice', options: [opt('soft', 'Soft', 'Мягкие'), opt('ridged', 'Ridged (bark)', 'С прожилками (кора)')], default: 'soft' },
      { id: 'direction', label: l('Lines run', 'Линии идут'), kind: 'choice', options: [opt('across', 'Across', 'Поперёк'), opt('down', 'Down', 'Вниз')], default: 'across' },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 32, default: 2 },
      { id: 'stretch', label: l('Stretch', 'Вытянутость'), kind: 'int', min: 1, max: 32, default: 12 },
      { id: 'octaves', label: l('Detail', 'Детали'), kind: 'int', min: 1, max: 6, default: 4 },
      { id: 'roughness', label: l('Roughness', 'Грубость'), kind: 'number', min: 0, max: 1, default: 0.55 },
      seed,
    ],
    glsl: `vec2 P0 = p_direction < 0.5 ? vec2(p_scale, p_scale * p_stretch) : vec2(p_scale * p_stretch, p_scale);
float sum = 0., amp = 1., norm = 0.;
for (int k = 0; k < 6; k++) {
  if (float(k) >= p_octaves) break;
  vec2 P = P0 * exp2(float(k)); vec2 p = uv * P; vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  vec2 o = seedv(p_seed + float(k) * 7.);
  float a = hash12(mod(i, P) + o), b = hash12(mod(i + vec2(1., 0.), P) + o);
  float c = hash12(mod(i + vec2(0., 1.), P) + o), d = hash12(mod(i + vec2(1., 1.), P) + o);
  float n = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  if (p_kind > 0.5) n = 1. - abs(n * 2. - 1.);
  sum += n * amp; norm += amp; amp *= p_roughness;
}
outColor = vec4(vec3(sum / max(norm, 1e-5)), 1.);`,
  },
  {
    type: 'whiteNoise',
    group: 'make',
    label: l('Static', 'Помехи'),
    hint: l('A random grey for every little square (white noise): grain, sand, pixel dither.', 'Случайный серый для каждого квадратика (белый шум): зерно, песок, пиксельный шум.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'grid', label: l('Grid', 'Сетка'), kind: 'int', min: 2, max: 1024, default: 256 },
      { id: 'contrast', label: l('Contrast', 'Контраст'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `float n = hash12(mod(floor(uv * p_grid), p_grid) + seedv(p_seed));
outColor = vec4(vec3(clamp((n - 0.5) * (0.4 + p_contrast * 1.6) + 0.5, 0., 1.)), 1.);`,
  },
  {
    type: 'crystals',
    group: 'make',
    label: l('Crystals', 'Кристаллы'),
    hint: l('Cells, each a flat face tilted its own way: crystals, faceted gems, hammered metal, ice.', 'Ячейки, каждая — плоская грань со своим наклоном: кристаллы, гранёные камни, кованый металл, лёд.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 64, default: 8 },
      { id: 'jitter', label: l('Randomness', 'Случайность'), kind: 'number', min: 0, max: 1, default: 1 },
      { id: 'facet', label: l('Tilt', 'Наклон'), kind: 'number', min: 0, max: 1, default: 0.7 },
      { id: 'gap', label: l('Gap', 'Шов'), kind: 'number', min: 0, max: 0.3, default: 0.03 },
      seed,
    ],
    glsl: `vec2 p = uv * p_scale; vec2 i = floor(p), f = fract(p); vec2 o = seedv(p_seed);
float f1 = 8., f2 = 8., id = 0.; vec2 best = vec2(0.);
for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
  vec2 c = vec2(float(x), float(y)); vec2 w = mod(i + c, p_scale);
  vec2 dv = c + 0.5 + (hash22(w + o) - 0.5) * p_jitter - f; float d = length(dv);
  if (d < f1) { f2 = f1; f1 = d; best = dv; id = hash12(w + o + 7.7); } else if (d < f2) f2 = d;
}
float a = id * 6.2831853;
float face = clamp(0.5 + dot(-best, vec2(cos(a), sin(a))) * 0.9, 0., 1.);
float v = mix(0.25 + 0.5 * id, face, p_facet);
if (p_gap > 0.) v *= smoothstep(0., p_gap, f2 - f1);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'rings',
    group: 'make',
    label: l('Rings and ripples', 'Кольца и рябь'),
    hint: l('Rings around the middle of each tile, optionally wobbly: ripples, tree rings, targets, sliced agate.', 'Кольца вокруг середины каждой плитки, можно волнистые: рябь, годичные кольца, мишени, агат.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'tiles', label: l('Repeat', 'Повторов'), kind: 'int', min: 1, max: 16, default: 1 },
      { id: 'count', label: l('Rings', 'Колец'), kind: 'number', min: 1, max: 64, step: 1, default: 10 },
      { id: 'sharpness', label: l('Sharpness', 'Чёткость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      { id: 'fade', label: l('Fade outwards', 'Затухание наружу'), kind: 'number', min: 0, max: 1, default: 0 },
      { id: 'wobble', label: l('Wobble', 'Волнистость'), kind: 'number', min: 0, max: 1, default: 0.2 },
      { id: 'wobbleScale', label: l('Wobble size', 'Размер волнистости'), kind: 'int', min: 1, max: 16, default: 3 },
      seed,
    ],
    glsl: `vec2 q = fract(uv * p_tiles) - 0.5; float r = length(q) * 2.;
float rw = r + (fbm(uv, p_wobbleScale, 4., 0.5, 0., p_seed) - 0.5) * p_wobble * 0.5;
float v = 0.5 + 0.5 * cos(fract(rw * p_count) * 6.2831853);
float e = (1. - p_sharpness) * 0.5 + 0.01; v = mix(v, smoothstep(0.5 - e, 0.5 + e, v), p_sharpness);
v *= mix(1., 1. - clamp(r, 0., 1.), p_fade);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'truchet',
    group: 'make',
    label: l('Truchet', 'Трюше'),
    hint: l('Tiles of quarter-circle arcs or diagonals turned at random, joining into endless paths and mazes.', 'Плитки с дугами или диагоналями, повёрнутые наугад, складываются в бесконечные дорожки и лабиринты.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'style', label: l('Style', 'Вид'), kind: 'choice', options: [opt('arcs', 'Arcs', 'Дуги'), opt('lines', 'Diagonals (maze)', 'Диагонали (лабиринт)')], default: 'arcs' },
      { id: 'tiles', label: l('Tiles across', 'Плиток в ряд'), kind: 'int', min: 1, max: 64, default: 8 },
      { id: 'width', label: l('Width', 'Толщина'), kind: 'number', min: 0.02, max: 0.9, default: 0.25 },
      { id: 'rounded', label: l('Rounded (as height)', 'Скруглённые (как высота)'), kind: 'bool', default: true },
      seed,
    ],
    glsl: `vec2 p = uv * p_tiles; vec2 c = floor(p); vec2 f = fract(p);
if (hash12(mod(c, p_tiles) + seedv(p_seed)) > 0.5) f.x = 1. - f.x;
float d = p_style < 0.5 ? min(abs(length(f) - 0.5), abs(length(f - 1.) - 0.5)) : abs(f.x - f.y) * 0.70711;
float hw = p_width * 0.5; float t = clamp((hw - d) / hw, 0., 1.);
float v = p_rounded > 0.5 ? sqrt(1. - (1. - t) * (1. - t)) : smoothstep(0., 0.08, t);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'herringbone',
    group: 'make',
    label: l('Herringbone', 'Ёлочка'),
    hint: l('Planks laid in a zigzag herringbone: parquet floors, paving (white plank, black gap).', 'Доски, уложенные ёлочкой: паркет, мощение (белое — доска, чёрное — шов).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'repeats', label: l('Repeats', 'Повторов'), kind: 'int', min: 1, max: 16, default: 2 },
      { id: 'length', label: l('Plank length', 'Длина доски'), kind: 'int', min: 2, max: 8, default: 3 },
      { id: 'gap', label: l('Gap', 'Шов'), kind: 'number', min: 0, max: 0.4, default: 0.06 },
      { id: 'bevel', label: l('Bevel', 'Скос'), kind: 'number', min: 0, max: 0.5, default: 0.12 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `float L = p_length; float N = p_repeats * 2. * L;
vec2 p = uv * N; vec2 cell = floor(p); vec2 f = fract(p);
float d = mod(cell.x - cell.y, 2. * L);
vec2 start; float e;
if (d < L) { start = vec2(cell.x - d, cell.y); float lx = p.x - start.x; e = min(min(lx, L - lx), min(f.y, 1. - f.y)); }
else { float j = 2. * L - 1. - d; start = vec2(cell.x, cell.y - j); float ly = p.y - start.y; e = min(min(ly, L - ly), min(f.x, 1. - f.x)); }
e -= p_gap * 0.5;
float r = hash12(mod(start, N) + vec2(d < L ? 0. : 0.5) + seedv(p_seed));
float v = e <= 0. ? 0. : (p_bevel > 0. ? smoothstep(0., p_bevel, e) : 1.) * (1. - p_random * r);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'scales',
    group: 'make',
    label: l('Scales', 'Чешуя'),
    hint: l('Overlapping round scales in staggered rows: fish, dragons, roof shingles, chain mail.', 'Перекрывающиеся круглые чешуйки рядами со сдвигом: рыба, драконы, черепица.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'count', label: l('Across', 'В ряд'), kind: 'int', min: 1, max: 48, default: 8 },
      { id: 'size', label: l('Size', 'Размер'), kind: 'number', min: 0.55, max: 1, default: 0.75 },
      { id: 'bevel', label: l('Roundness', 'Округлость'), kind: 'number', min: 0, max: 1, default: 0.6 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.25 },
      seed,
    ],
    glsl: `vec2 P = vec2(p_count, p_count * 2.); vec2 p = uv * P; float best = 99.; float v = 0.; vec2 o = seedv(p_seed);
for (int dy = -2; dy <= 2; dy++) for (int dx = -1; dx <= 1; dx++) {
  float row = floor(p.y) + float(dy); float off = mod(row, 2.) * 0.5;
  float col = floor(p.x - off) + float(dx);
  vec2 dd = vec2(p.x - (col + 0.5 + off), (p.y - row) * 0.5);
  float t = 1. - length(dd) / p_size;
  // Each row lies over the one below (as roof shingles), so a scale shows its lower edge.
  if (t > 0. && row < best) {
    best = row;
    float rnd = hash12(vec2(mod(col, P.x), mod(row, P.y)) + o);
    v = (p_bevel > 0. ? smoothstep(0., p_bevel * 0.6, t) : 1.) * (0.6 + 0.4 * clamp(1. - dd.y / p_size, 0., 1.)) * (1. - p_random * rnd);
  }
}
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'treadPlate',
    group: 'make',
    label: l('Tread plate', 'Рифлёный лист'),
    hint: l('Raised bars crossing each other in a diamond pattern: metal floor plates, stairs (as height).', 'Выпуклые полоски ромбическим узором: рифлёный металлический пол, ступени (как высота).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'count', label: l('Across', 'В ряд'), kind: 'int', min: 2, max: 48, default: 8 },
      { id: 'length', label: l('Bar length', 'Длина полоски'), kind: 'number', min: 0.1, max: 0.45, default: 0.3 },
      { id: 'width', label: l('Bar width', 'Ширина полоски'), kind: 'number', min: 0.03, max: 0.3, default: 0.14 },
    ],
    glsl: `vec2 p = uv * p_count; vec2 c = floor(p); vec2 f = fract(p) - 0.5;
float s = mod(c.x + c.y, 2.) < 0.5 ? 1. : -1.;
vec2 dir = normalize(vec2(1., s));
float t = clamp(dot(f, dir), -p_length, p_length);
float d = length(f - dir * t);
float k = clamp(1. - d / p_width, 0., 1.);
outColor = vec4(vec3(sqrt(k * (2. - k))), 1.);`,
  },
  {
    type: 'studs',
    group: 'make',
    label: l('Studs and rivets', 'Заклёпки и шипы'),
    hint: l('Round bumps on a grid, domed or flat-topped: rivets, studs, rubber mats, perforated sheets.', 'Круглые выпуклости по сетке, куполом или с плоским верхом: заклёпки, шипы, резиновые коврики.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'count', label: l('Across', 'В ряд'), kind: 'int', min: 1, max: 64, default: 8 },
      { id: 'size', label: l('Size', 'Размер'), kind: 'number', min: 0.05, max: 1, default: 0.65 },
      { id: 'profile', label: l('Shape', 'Форма'), kind: 'choice', options: [opt('dome', 'Dome', 'Купол'), opt('flat', 'Flat top', 'Плоский верх'), opt('cone', 'Cone', 'Конус')], default: 'dome' },
      { id: 'offset', label: l('Offset rows', 'Сдвиг рядов'), kind: 'bool', default: false },
      { id: 'random', label: l('Random height', 'Разная высота'), kind: 'number', min: 0, max: 1, default: 0 },
      seed,
    ],
    glsl: `vec2 p = uv * p_count; float row = floor(p.y);
if (p_offset > 0.5) p.x += mod(row, 2.) * 0.5;
vec2 c = floor(p); vec2 f = fract(p) - 0.5;
float t = clamp(1. - length(f) / (p_size * 0.5), 0., 1.);
float v = p_profile < 0.5 ? sqrt(t * (2. - t)) : p_profile < 1.5 ? smoothstep(0., 0.25, t) : t;
v *= 1. - p_random * hash12(mod(c, p_count) + seedv(p_seed));
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'caustics',
    group: 'make',
    label: l('Caustics', 'Каустика'),
    hint: l('Bright wavy light lines, as on the floor of a pool: water light, glints, energy shields.', 'Яркие волнистые линии света, как на дне бассейна: блики воды, энергетические щиты.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 32, default: 5 },
      { id: 'width', label: l('Line width', 'Толщина линий'), kind: 'number', min: 0.01, max: 0.4, default: 0.12 },
      { id: 'warp', label: l('Wobble', 'Волнистость'), kind: 'number', min: 0, max: 1, default: 0.5 },
      seed,
    ],
    glsl: `vec2 q = uv + p_warp * 0.12 * (vec2(fbm(uv, 2., 3., 0.5, 0., p_seed), fbm(uv, 2., 3., 0.5, 0., p_seed + 4.)) - 0.5);
vec3 a = voronoi(q, p_scale, 1., p_seed + 1.);
vec3 b = voronoi(q, p_scale * 2., 1., p_seed + 2.);
float la = 1. - smoothstep(0., p_width, a.y - a.x);
float lb = 1. - smoothstep(0., p_width, b.y - b.x);
outColor = vec4(vec3(clamp(pow(la, 1.5) + 0.5 * pow(lb, 2.), 0., 1.)), 1.);`,
  },
  {
    type: 'dunes',
    group: 'make',
    label: l('Sand ripples', 'Песчаная рябь'),
    hint: l('Lopsided ridges, gentle on one side and steep on the other, wandering a little: sand, dunes, snow drifts.', 'Несимметричные гребни, пологие с одной стороны и крутые с другой: песок, дюны, сугробы.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'count', label: l('Ridges', 'Гребней'), kind: 'int', min: 1, max: 64, default: 12 },
      { id: 'direction', label: l('Ridges run', 'Гребни идут'), kind: 'choice', options: [opt('across', 'Across', 'Поперёк'), opt('down', 'Down', 'Вниз')], default: 'across' },
      { id: 'lean', label: l('Lean', 'Наклон'), kind: 'number', min: 0.05, max: 0.95, default: 0.75 },
      { id: 'wobble', label: l('Wander', 'Извилистость'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'wobbleScale', label: l('Wander size', 'Размер извилин'), kind: 'int', min: 1, max: 16, default: 3 },
      seed,
    ],
    glsl: `float t = p_direction < 0.5 ? uv.y : uv.x;
t += (fbm(uv, p_wobbleScale, 4., 0.5, 0., p_seed) - 0.5) * p_wobble * 3. / p_count;
float x = fract(t * p_count);
float v = x < p_lean ? x / p_lean : (1. - x) / (1. - p_lean);
outColor = vec4(vec3(smoothstep(0., 1., v)), 1.);`,
  },
  {
    type: 'triangles',
    group: 'make',
    label: l('Triangles', 'Треугольники'),
    hint: l('Triangle tiles pointing up and down in rows (white tile, black gap).', 'Треугольная плитка, вершинами вверх и вниз (белое — плитка, чёрное — шов).'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'count', label: l('Across', 'В ряд'), kind: 'int', min: 1, max: 48, default: 6 },
      { id: 'gap', label: l('Gap', 'Шов'), kind: 'number', min: 0, max: 0.4, default: 0.05 },
      { id: 'bevel', label: l('Bevel', 'Скос'), kind: 'number', min: 0, max: 1, default: 0.3 },
      { id: 'random', label: l('Random brightness', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0.3 },
      seed,
    ],
    glsl: `float N = p_count; float M = max(2., 2. * floor(N / 1.7320508 + 0.5));
vec2 p = uv * vec2(N, M); float row = floor(p.y); float fy = fract(p.y);
float x = p.x + mod(row, 2.) * 0.5;
float a = x + fy * 0.5 - 0.5, b = x - fy * 0.5 - 0.5;
float fa = floor(a), fb = floor(b); bool up = fa > fb;
float e = up ? min(min(fract(a), 1. - fract(b)), 1. - fy) : min(min(1. - fract(a), fract(b)), fy);
e = e * 0.866 / 0.2887 - p_gap * 2.;
float rnd = hash12(vec2(mod(fa + fb, 2. * N), mod(row, M)) + seedv(p_seed));
float v = e <= 0. ? 0. : (p_bevel > 0. ? smoothstep(0., p_bevel, e) : 1.) * (1. - p_random * rnd);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'interference',
    group: 'make',
    label: l('Interference', 'Интерференция'),
    hint: l('Several waves running different ways, added up: moiré, shimmering water, alien surfaces.', 'Несколько волн в разные стороны, сложенных вместе: муар, мерцающая вода, инопланетные поверхности.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'waves', label: l('Waves', 'Волн'), kind: 'int', min: 1, max: 8, default: 4 },
      { id: 'frequency', label: l('Frequency', 'Частота'), kind: 'int', min: 1, max: 32, default: 6 },
      { id: 'sharpness', label: l('Sharpness', 'Чёткость'), kind: 'number', min: 0, max: 1, default: 0 },
      seed,
    ],
    glsl: `float s = 0.; vec2 o = seedv(p_seed);
for (int k = 0; k < 8; k++) {
  if (float(k) >= p_waves) break;
  vec2 h = hash22(vec2(float(k), 1.) + o);
  // Whole numbers of waves across the square, so it tiles.
  vec2 kv = floor((h - 0.5) * 2. * p_frequency + 0.5); if (kv.x == 0. && kv.y == 0.) kv.x = 1.;
  s += cos(6.2831853 * dot(kv, uv) + hash12(vec2(float(k), 2.) + o) * 6.2831853);
}
float v = 0.5 + 0.5 * s / max(1., sqrt(p_waves));
float e = (1. - p_sharpness) * 0.5 + 0.01; v = mix(clamp(v, 0., 1.), smoothstep(0.5 - e, 0.5 + e, v), p_sharpness);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'spiral',
    group: 'make',
    label: l('Spiral', 'Спираль'),
    hint: l('A spiral (or several arms) in each tile: shells, vortices, hypnotic swirls, ammonites.', 'Спираль (или несколько рукавов) в каждой плитке: ракушки, вихри, аммониты.'),
    inputs: [],
    output: 'grey',
    params: [
      { id: 'tiles', label: l('Repeat', 'Повторов'), kind: 'int', min: 1, max: 16, default: 1 },
      { id: 'arms', label: l('Arms', 'Рукавов'), kind: 'int', min: 1, max: 12, default: 2 },
      { id: 'twist', label: l('Twist', 'Закрученность'), kind: 'number', min: -20, max: 20, step: 0.1, default: 6 },
      { id: 'sharpness', label: l('Sharpness', 'Чёткость'), kind: 'number', min: 0, max: 1, default: 0.3 },
    ],
    glsl: `vec2 q = fract(uv * p_tiles) - 0.5; float r = length(q) * 2.; float a = atan(q.y, q.x) / 6.2831853;
float v = 0.5 + 0.5 * cos((a * p_arms + r * p_twist) * 6.2831853);
float e = (1. - p_sharpness) * 0.5 + 0.01; v = mix(v, smoothstep(0.5 - e, 0.5 + e, v), p_sharpness);
outColor = vec4(vec3(v), 1.);`,
  },
  {
    type: 'colorCells',
    group: 'make',
    label: l('Colour cells', 'Цветные ячейки'),
    hint: l('Cells (Voronoi) or squares, each a random colour between two colours or of a random hue: mosaics, stained glass, terrazzo.', 'Ячейки (Вороной) или квадраты, каждая случайного цвета между двумя цветами или случайного оттенка: мозаика, витраж, терраццо.'),
    inputs: [],
    output: 'color',
    params: [
      { id: 'shape', label: l('Cells', 'Ячейки'), kind: 'choice', options: [opt('voronoi', 'Round (Voronoi)', 'Округлые (Вороной)'), opt('squares', 'Squares', 'Квадраты')], default: 'voronoi' },
      { id: 'mode', label: l('Colours', 'Цвета'), kind: 'choice', options: [opt('between', 'Between two colours', 'Между двумя цветами'), opt('hues', 'Any hue', 'Любой оттенок')], default: 'between' },
      { id: 'a', label: l('Colour A', 'Цвет A'), kind: 'color', default: '#2f5d8a' },
      { id: 'b', label: l('Colour B', 'Цвет B'), kind: 'color', default: '#d9a441' },
      { id: 'saturation', label: l('Saturation (any hue)', 'Насыщенность (любой оттенок)'), kind: 'number', min: 0, max: 1, default: 0.6 },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 64, default: 8 },
      { id: 'gap', label: l('Gap', 'Шов'), kind: 'number', min: 0, max: 0.3, default: 0.04 },
      seed,
    ],
    glsl: `float id; float edge;
if (p_shape < 0.5) { vec3 v = voronoi(uv, p_scale, 1., p_seed); id = v.z; edge = v.y - v.x; }
else { vec2 c = floor(uv * p_scale); vec2 f = fract(uv * p_scale); id = hash12(mod(c, p_scale) + seedv(p_seed)); edge = 2. * min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)); }
vec3 col = p_mode < 0.5 ? mix(p_a, p_b, id) : hsv2rgb(vec3(id, p_saturation, 0.55 + 0.4 * hash12(vec2(id * 91.7, 3.))));
if (p_gap > 0.) col *= smoothstep(p_gap * 0.5, p_gap, edge);
outColor = vec4(col, 1.);`,
  },

  // ── More (2026-11): change ──
  {
    type: 'tileShuffle',
    group: 'change',
    label: l('Tile shuffle', 'Перемешать плитки'),
    hint: l('Cut the picture into a grid and turn or flip each piece at random: breaks up visible repeats.', 'Разрезать картинку сеткой и случайно повернуть или отразить каждый кусок: убирает заметные повторы.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'tiles', label: l('Pieces across', 'Кусков в ряд'), kind: 'int', min: 1, max: 32, default: 4 },
      { id: 'turn', label: l('Turn', 'Поворачивать'), kind: 'bool', default: true },
      { id: 'flip', label: l('Flip', 'Отражать'), kind: 'bool', default: true },
      { id: 'bright', label: l('Brightness varies', 'Разная яркость'), kind: 'number', min: 0, max: 1, default: 0 },
      seed,
    ],
    glsl: `vec2 p = uv * p_tiles; vec2 c = floor(p); vec2 f = fract(p) - 0.5; vec2 o = seedv(p_seed); vec2 cm = mod(c, p_tiles);
float r = hash12(cm + o);
if (p_turn > 0.5) { float k = floor(r * 4.); if (k > 0.5 && k < 1.5) f = vec2(-f.y, f.x); else if (k > 1.5 && k < 2.5) f = -f; else if (k > 2.5) f = vec2(f.y, -f.x); }
if (p_flip > 0.5 && hash12(cm + o + 3.3) > 0.5) f.x = -f.x;
vec3 col = inC_in((c + f + 0.5) / p_tiles).rgb * (1. - p_bright * hash12(cm + o + 6.1));
outColor = vec4(col, 1.);`,
  },
  {
    type: 'halftone',
    group: 'change',
    label: l('Halftone', 'Растр'),
    hint: l('Turn a picture into a grid of dots, big where it is light: print looks, perforated metal, LED panels.', 'Превратить картинку в сетку точек, крупных там, где светло: печатный растр, перфорация, LED-панели.'),
    inputs: [IN_GREY('in', l('In', 'Вход'), [0.5, 0.5, 0.5])],
    output: 'grey',
    params: [
      { id: 'grid', label: l('Dots across', 'Точек в ряд'), kind: 'int', min: 2, max: 128, default: 24 },
      { id: 'angle', label: l('Grid', 'Сетка'), kind: 'choice', options: [opt('square', 'Square', 'Прямая'), opt('diagonal', 'Diagonal (45°)', 'Диагональная (45°)')], default: 'diagonal' },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 1, default: 0.2 },
      { id: 'invert', label: l('Dark makes big dots', 'Крупнее в тёмном'), kind: 'bool', default: false },
    ],
    glsl: `vec2 p = uv * p_grid; vec2 ctr;
if (p_angle < 0.5) ctr = floor(p) + 0.5;
else { vec2 r = vec2(p.x + p.y, p.x - p.y); vec2 rc = floor(r * 0.5) * 2. + 1.; ctr = vec2(rc.x + rc.y, rc.x - rc.y) * 0.5; }
float dd = length(p - ctr) / (p_angle < 0.5 ? 0.70711 : 1.);
float g = inG_in(ctr / p_grid); if (p_invert > 0.5) g = 1. - g;
float rad = sqrt(clamp(g, 0., 1.)); float s = max(p_softness * 0.3, 0.02);
outColor = vec4(vec3(1. - smoothstep(rad - s, rad, dd)), 1.);`,
  },
  {
    type: 'highPass',
    group: 'change',
    label: l('High pass', 'Высокие частоты'),
    hint: l('Keep only the fine detail and drop the broad light and dark (mid grey where flat): evens out a photo, sharpens heights.', 'Оставить только мелкие детали, убрав крупные перепады (средне-серое там, где ровно): выравнивает фото, подчёркивает рельеф.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0.001, max: 0.1, step: 0.001, default: 0.02 },
      { id: 'strength', label: l('Strength', 'Сила'), kind: 'number', min: 0, max: 4, default: 1 },
    ],
    glsl: `vec3 s = vec3(0.); float w = 0.;
for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
  vec2 o = vec2(x, y) / 3.; float k = exp(-dot(o, o) * 2.);
  s += inC_in(uv + o * p_radius).rgb * k; w += k;
}
outColor = vec4(clamp((inC_in(uv).rgb - s / w) * p_strength + 0.5, 0., 1.), 1.);`,
  },
  {
    type: 'growShrink',
    group: 'change',
    label: l('Grow or shrink', 'Расширить или сузить'),
    hint: l('Make light shapes fatter (grow) or thinner (shrink): thicken lines, close gaps, eat into edges.', 'Сделать светлые фигуры толще или тоньше: утолщить линии, закрыть щели, подъесть края.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'mode', label: l('Make shapes', 'Фигуры'), kind: 'choice', options: [opt('grow', 'Grow', 'Расширить'), opt('shrink', 'Shrink', 'Сузить')], default: 'grow' },
      { id: 'radius', label: l('Radius', 'Радиус'), kind: 'number', min: 0, max: 0.05, step: 0.0005, default: 0.006 },
    ],
    glsl: `vec3 r = inC_in(uv).rgb; bool grow = p_mode < 0.5;
for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
  vec2 o = vec2(x, y) / 3.; if (dot(o, o) > 1.) continue;
  vec3 c = inC_in(uv + o * p_radius).rgb; r = grow ? max(r, c) : min(r, c);
}
outColor = vec4(r, 1.);`,
  },
  {
    type: 'edgeBlur',
    group: 'change',
    label: l('Edge blur'),
    hint: l('Soften only the edges of light shapes (made by cutting, masks, thresholds) so they blend into what is under them. Inside fades in from the outline and keeps its shape; Outside keeps the shape solid and fades out around it; Both ways blurs across the outline.'),
    inputs: [IN_GREY()],
    output: 'grey',
    params: [
      { id: 'width', label: l('Width'), kind: 'number', min: 0, max: 0.2, step: 0.001, default: 0.03 },
      { id: 'mode', label: l('Fade'), kind: 'choice', options: [opt('inside', 'Inside', 'Inside'), opt('both', 'Both ways', 'Both ways'), opt('outside', 'Outside', 'Outside')], default: 'inside' },
      { id: 'cut', label: l('Edge at'), kind: 'number', min: 0.05, max: 0.95, default: 0.5 },
    ],
    glsl: `float v = inG_in(uv); bool inside = v > p_cut;
// The nearest spot on the other side of the outline, searched in rings out to the width.
float near = 1.;
if (p_width > 0.) {
  for (int r = 1; r <= 12; r++) {
    float rr = float(r) / 12.;
    if (rr > near) break;
    for (int k = 0; k < 24; k++) {
      float a = (float(k) + 0.5 * float(r & 1)) * (2. * PI / 24.);
      vec2 dir = vec2(cos(a), sin(a));
      bool other = (inG_in(uv + dir * rr * p_width) > p_cut) != inside;
      if (other) {
        // Narrow it down between this ring and the one before (no steps in the fade).
        float lo = rr - 1. / 12., hi = rr;
        for (int b = 0; b < 5; b++) {
          float m = 0.5 * (lo + hi);
          if ((inG_in(uv + dir * m * p_width) > p_cut) != inside) hi = m; else lo = m;
        }
        near = min(near, hi);
      }
    }
  }
}
float e = near * near * (3. - 2. * near);
float o;
if (p_mode < 0.5) o = v * e;
else if (p_mode > 1.5) o = inside ? v : max(v, 1. - e);
else { float s = inside ? 0.5 + 0.5 * near : 0.5 - 0.5 * near; o = s * s * (3. - 2. * s); }
outColor = vec4(vec3(o), 1.);`,
  },
  {
    type: 'rippleWarp',
    group: 'change',
    label: l('Ripple', 'Рябь'),
    hint: l('Wiggle the picture with even sine waves: wavy glass, heat haze, water, flags.', 'Покачать картинку ровными волнами: волнистое стекло, марево, вода, флаги.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'count', label: l('Waves', 'Волн'), kind: 'int', min: 1, max: 32, default: 4 },
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 0.1, step: 0.001, default: 0.02 },
      { id: 'mode', label: l('Moves', 'Сдвигает'), kind: 'choice', options: [opt('both', 'Both ways', 'В обе стороны'), opt('across', 'Across only', 'Только поперёк'), opt('down', 'Down only', 'Только вниз')], default: 'both' },
    ],
    glsl: `vec2 o = vec2(sin(uv.y * p_count * 6.2831853), sin(uv.x * p_count * 6.2831853)) * p_amount;
if (p_mode > 0.5 && p_mode < 1.5) o.y = 0.; else if (p_mode > 1.5) o.x = 0.;
outColor = vec4(inC_in(uv + o).rgb, 1.);`,
  },
  {
    type: 'stagger',
    group: 'change',
    label: l('Stagger rows', 'Сдвиг рядов'),
    hint: l('Cut the picture into rows (or columns) and slide every other one: brick-like offsets of any pattern.', 'Разрезать картинку на ряды (или столбцы) и сдвинуть каждый второй: кирпичный сдвиг любого узора.'),
    inputs: [IN_COLOR()],
    output: 'color',
    params: [
      { id: 'rows', label: l('Rows', 'Рядов'), kind: 'int', min: 1, max: 64, default: 4 },
      { id: 'offset', label: l('Offset', 'Сдвиг'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'direction', label: l('Rows run', 'Ряды идут'), kind: 'choice', options: [opt('across', 'Across', 'Поперёк'), opt('down', 'Down (columns)', 'Вниз (столбцы)')], default: 'across' },
      { id: 'random', label: l('Random offsets', 'Случайные сдвиги'), kind: 'bool', default: false },
      seed,
    ],
    glsl: `vec2 q = p_direction < 0.5 ? uv : uv.yx; float row = floor(q.y * p_rows);
float s = p_random > 0.5 ? hash12(vec2(mod(row, p_rows), 4.) + seedv(p_seed)) * p_offset : mod(row, 2.) * p_offset;
q.x += s; if (p_direction > 0.5) q = q.yx;
outColor = vec4(inC_in(q).rgb, 1.);`,
  },

  // ── More (2026-11): combine and colour ──
  {
    type: 'cellPick',
    group: 'combine',
    label: l('Pick per cell', 'Выбор по ячейкам'),
    hint: l('Up to four pictures, one picked at random for each cell or square: mixed tiles, patchwork, varied stones.', 'До четырёх картинок, одна наугад для каждой ячейки или квадрата: смешанная плитка, лоскутное одеяло, разные камни.'),
    inputs: [IN_COLOR('a', l('A', 'A'), [1, 1, 1]), IN_COLOR('b', l('B', 'B'), [0, 0, 0]), IN_COLOR('c', l('C', 'C'), [0.5, 0.5, 0.5]), IN_COLOR('d', l('D', 'D'), [0.25, 0.25, 0.25])],
    output: 'color',
    params: [
      { id: 'shape', label: l('Cells', 'Ячейки'), kind: 'choice', options: [opt('squares', 'Squares', 'Квадраты'), opt('voronoi', 'Round (Voronoi)', 'Округлые (Вороной)')], default: 'squares' },
      { id: 'scale', label: l('Scale', 'Масштаб'), kind: 'int', min: 1, max: 64, default: 4 },
      seed,
    ],
    glsl: `float id = p_shape < 0.5 ? hash12(mod(floor(uv * p_scale), p_scale) + seedv(p_seed)) : voronoi(uv, p_scale, 1., p_seed).z;
// Only the linked inputs take part.
float n = h_a + h_b + h_c + h_d; float k = floor(id * max(n, 1.)); vec3 col = inC_a(uv).rgb;
float seen = 0.;
if (h_a > 0.5) { if (seen == k) col = inC_a(uv).rgb; seen += 1.; }
if (h_b > 0.5) { if (seen == k) col = inC_b(uv).rgb; seen += 1.; }
if (h_c > 0.5) { if (seen == k) col = inC_c(uv).rgb; seen += 1.; }
if (h_d > 0.5) { if (seen == k) col = inC_d(uv).rgb; seen += 1.; }
outColor = vec4(col, 1.);`,
  },
  {
    type: 'colorBalance',
    group: 'colour',
    label: l('Colour balance', 'Цветовой баланс'),
    hint: l('Tint the dark, middle and light parts separately: warm highlights, cool shadows, aged looks.', 'Подкрасить тёмные, средние и светлые части по отдельности: тёплые блики, холодные тени, состаривание.'),
    inputs: [IN_COLOR('in', l('In', 'Вход'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'shadows', label: l('Shadows', 'Тени'), kind: 'color', default: '#2a3a5a' },
      { id: 'mids', label: l('Mid-tones', 'Средние тона'), kind: 'color', default: '#808080' },
      { id: 'lights', label: l('Highlights', 'Света'), kind: 'color', default: '#ffe0b0' },
      { id: 'amount', label: l('Amount', 'Сила'), kind: 'number', min: 0, max: 1, default: 0.4 },
    ],
    glsl: `vec3 c = inC_in(uv).rgb; float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
float ws = 1. - smoothstep(0., 0.5, g), wl = smoothstep(0.5, 1., g), wm = 1. - ws - wl;
vec3 shift = (p_shadows - 0.5) * ws + (p_mids - 0.5) * wm + (p_lights - 0.5) * wl;
outColor = vec4(clamp(c + shift * p_amount, 0., 1.), 1.);`,
  },
  {
    type: 'palette',
    group: 'colour',
    label: l('Rainbow palette', 'Радужная палитра'),
    hint: l('Colour a grey picture by a smooth looping palette: rainbows, oil slicks, heat, sci-fi glows.', 'Раскрасить серую картинку плавной зацикленной палитрой: радуга, бензиновые разводы, жар, неон.'),
    inputs: [IN_GREY('in', l('In', 'Вход'), [0.5, 0.5, 0.5])],
    output: 'color',
    params: [
      { id: 'preset', label: l('Palette', 'Палитра'), kind: 'choice', options: [opt('rainbow', 'Rainbow', 'Радуга'), opt('fire', 'Fire', 'Огонь'), opt('ocean', 'Ocean', 'Океан'), opt('oil', 'Oil slick', 'Бензин'), opt('toxic', 'Toxic', 'Кислотная')], default: 'rainbow' },
      { id: 'repeats', label: l('Repeats', 'Повторов'), kind: 'number', min: 0.1, max: 8, default: 1 },
      { id: 'shift', label: l('Shift', 'Сдвиг'), kind: 'number', min: 0, max: 1, default: 0 },
    ],
    glsl: `int k = int(p_preset + 0.5); vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.), d = vec3(0., 0.33, 0.67);
if (k == 1) { c = vec3(1., 1., 1.); d = vec3(0., 0.1, 0.2); a = vec3(0.6, 0.35, 0.15); b = vec3(0.5, 0.4, 0.2); }
else if (k == 2) { a = vec3(0.2, 0.45, 0.6); b = vec3(0.2, 0.3, 0.3); d = vec3(0.5, 0.2, 0.25); }
else if (k == 3) { c = vec3(2., 1., 0.); d = vec3(0.5, 0.2, 0.25); }
else if (k == 4) { a = vec3(0.4, 0.6, 0.3); b = vec3(0.4, 0.4, 0.3); c = vec3(1., 1., 0.5); d = vec3(0.8, 0.9, 0.3); }
float t = inG_in(uv) * p_repeats + p_shift;
outColor = vec4(clamp(a + b * cos(6.2831853 * (c * t + d)), 0., 1.), 1.);`,
  },

  // ── More (2026-11): surface ──
  {
    type: 'puddles',
    group: 'surface',
    label: l('Puddles', 'Лужи'),
    hint: l('A mask of water filling the low parts of a height picture, with ragged shores: puddles, wet floors, flooded ground.', 'Маска воды, заполняющей низкие места карты высот, с неровными берегами: лужи, мокрый пол.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'), [0.5, 0.5, 0.5])],
    output: 'grey',
    params: [
      { id: 'level', label: l('Water level', 'Уровень воды'), kind: 'number', min: 0, max: 1, default: 0.35 },
      { id: 'edge', label: l('Shore softness', 'Мягкость берега'), kind: 'number', min: 0, max: 0.3, default: 0.05 },
      { id: 'breakup', label: l('Breakup', 'Разрывы'), kind: 'number', min: 0, max: 1, default: 0.4 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 32, default: 4 },
      seed,
    ],
    glsl: `float h = inG_in(uv) + (fbm(uv, p_scale, 5., 0.55, 0., p_seed) - 0.5) * p_breakup * 0.6;
outColor = vec4(vec3(1. - smoothstep(p_level - p_edge, p_level + p_edge + 1e-4, h)), 1.);`,
  },
  {
    type: 'topCover',
    group: 'surface',
    label: l('Settles on top', 'Оседает сверху'),
    hint: l('A mask of what lands on upward-facing slopes and tops of a height picture (top of the square is up): snow, dust, moss, sand.', 'Маска того, что ложится на обращённые вверх склоны и вершины карты высот (верх квадрата — верх): снег, пыль, мох, песок.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'), [0.5, 0.5, 0.5])],
    output: 'grey',
    params: [
      { id: 'amount', label: l('Amount', 'Сколько'), kind: 'number', min: 0, max: 1, default: 0.5 },
      { id: 'tops', label: l('On high parts too', 'И на возвышениях'), kind: 'number', min: 0, max: 1, default: 0.3 },
      { id: 'breakup', label: l('Breakup', 'Разрывы'), kind: 'number', min: 0, max: 1, default: 0.3 },
      { id: 'scale', label: l('Noise size', 'Размер шума'), kind: 'int', min: 1, max: 64, default: 8 },
      seed,
    ],
    glsl: `float e = 0.006; float h = inG_in(uv);
float up = clamp((h - inG_in(uv - vec2(0., e))) / e * 0.08 + 0.5, 0., 1.);
float v = mix(up, h, p_tops) + (fbm(uv, p_scale, 5., 0.55, 0., p_seed) - 0.5) * p_breakup;
float m = 1. - p_amount;
outColor = vec4(vec3(smoothstep(m - 0.08, m + 0.08, v)), 1.);`,
  },
  {
    type: 'slopeMask',
    group: 'surface',
    label: l('Slope mask', 'Маска склонов'),
    hint: l('White where a height picture is steep (or flat): rock on cliffs, grass on level ground, wear on sides.', 'Белое там, где карта высот крутая (или ровная): скалы на обрывах, трава на ровном, износ на боках.'),
    inputs: [IN_GREY('in', l('Height', 'Высота'), [0.5, 0.5, 0.5])],
    output: 'grey',
    params: [
      { id: 'mode', label: l('White where', 'Белое там, где'), kind: 'choice', options: [opt('steep', 'Steep', 'Круто'), opt('flat', 'Flat', 'Ровно')], default: 'steep' },
      { id: 'threshold', label: l('Threshold', 'Порог'), kind: 'number', min: 0, max: 1, default: 0.3 },
      { id: 'softness', label: l('Softness', 'Мягкость'), kind: 'number', min: 0, max: 0.5, default: 0.1 },
      { id: 'strength', label: l('Height strength', 'Сила высоты'), kind: 'number', min: 0.1, max: 10, default: 1 },
    ],
    glsl: `float e = 0.004;
vec2 g = vec2(inG_in(uv + vec2(e, 0.)) - inG_in(uv - vec2(e, 0.)), inG_in(uv + vec2(0., e)) - inG_in(uv - vec2(0., e))) / (2. * e);
float s = clamp(length(g) * p_strength * 0.05, 0., 1.);
float v = smoothstep(p_threshold - p_softness, p_threshold + p_softness + 1e-4, s);
if (p_mode > 0.5) v = 1. - v;
outColor = vec4(vec3(v), 1.);`,
  },

  // ── More (2026-11): named noises (as in Substance Designer's noise library) ──
  noise('clouds1', 'Clouds 1', 'Облака 1', 'Soft, smooth clouds: many layers of Perlin noise.', 'Мягкие гладкие облака: много слоёв шума Перлина.', { scale: 4, octaves: 8, roughness: 0.5, contrast: 0.2 },
    `float v = fbm(uv, p_scale, p_octaves, p_roughness, 0., p_seed);`),
  noise('clouds2', 'Clouds 2', 'Облака 2', 'Large soft clouds with ragged, finely detailed edges: overcast skies, smoke, stains, broad breakup.', 'Крупные мягкие облака с рваными, мелко детализированными краями: пасмурное небо, дым, пятна, крупная неоднородность.', { scale: 2, octaves: 9, roughness: 0.68, contrast: 0.5 },
    `float v = fbm(uv, p_scale, p_octaves, p_roughness, 0., p_seed);
v = mix(v, fbm(uv, p_scale * 2., p_octaves, p_roughness, 1., p_seed + 1.), 0.2);`),
  noise('perlin', 'Perlin noise', 'Шум Перлина', 'Plain Perlin noise: smooth round blobs, one size (add detail for more layers).', 'Простой шум Перлина: гладкие округлые пятна одного размера (детали добавляют слои).', { scale: 8, octaves: 1, roughness: 0.5, contrast: 0 },
    `float v = fbm(uv, p_scale, p_octaves, p_roughness, 0., p_seed);`),
  noise('plasma', 'Plasma', 'Плазма', 'Rounded bright blobs split by thin, dark, winding lines: organic cells, lava crust, plasma (Sharpness thins the lines).', 'Округлые светлые пятна, разделённые тонкими тёмными извилистыми линиями: органика, корка лавы, плазма («Чёткость» делает линии тоньше).', { scale: 8, octaves: 2, roughness: 0.45, contrast: 0.85 },
    `float n = fbm(uv, p_scale, p_octaves, p_roughness, 0., p_seed);
float a = clamp(abs(n * 2. - 1.), 0., 1.);
float v = smoothstep(0., mix(0.3, 0.03, p_contrast), a) * (0.3 + 0.9 * a);`, true),
  noise('crystal1', 'Crystal 1', 'Кристалл 1', 'Polygon-shaped shards with dark cracks between them, in layers: crystals, cracked rock, crazed glaze.', 'Многоугольные осколки с тёмными трещинами между ними, слоями: кристаллы, треснувший камень, кракелюр.', { scale: 4, octaves: 2, roughness: 0.5, contrast: 0.1 },
    `float v = 0., amp = 1., norm = 0.;
for (int k = 0; k < 6; k++) {
  if (float(k) >= p_octaves) break;
  vec3 c = voronoi(uv, p_scale * exp2(float(k)), 1., p_seed + float(k) * 13.);
  // Distance to the nearest crack: straight-sided rings inside each cell.
  v += clamp((c.y - c.x) * 1.8, 0., 1.) * (0.45 + 0.55 * c.z) * amp; norm += amp; amp *= p_roughness;
}
v /= max(norm, 1e-5);`),
  noise('crystal2', 'Crystal 2', 'Кристалл 2', 'Long pointed shards running down, each its own brightness, in layers: crystal clusters, ice, splintered wood, streaks.', 'Длинные заострённые осколки сверху вниз, каждый своей яркости, слоями: друзы кристаллов, лёд, щепа, потёки.', { scale: 3, octaves: 2, roughness: 0.5, contrast: 0.2 },
    `float v = 0., amp = 1., norm = 0.;
for (int k = 0; k < 6; k++) {
  if (float(k) >= p_octaves) break;
  // Four times as many cells across as down: each cell is tall and thin.
  vec2 P = vec2(p_scale * 4., p_scale) * exp2(float(k)); vec2 p = uv * P; vec2 i = floor(p), f = fract(p); vec2 o = seedv(p_seed + float(k) * 17.);
  float f1 = 8., f2 = 8., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = vec2(float(x), float(y)); vec2 w = mod(i + c, P);
    float d = length(c + hash22(w + o) - f);
    if (d < f1) { f2 = f1; f1 = d; id = hash12(w + o + 3.3); } else if (d < f2) f2 = d;
  }
  v += (0.25 + 0.75 * id) * mix(0.55, 1., smoothstep(0., 0.3, f2 - f1)) * amp; norm += amp; amp *= p_roughness;
}
v /= max(norm, 1e-5);`),
  noise('fractalSum1', 'Fractal sum 1', 'Фрактальная сумма 1', 'Layers of blocky value noise added up: a rough, grainy base for dirt and stone.', 'Сумма слоёв пятнистого шума: грубая зернистая основа для грязи и камня.', { scale: 6, octaves: 7, roughness: 0.62, contrast: 0.3 },
    `float sum = 0., amp = 1., norm = 0.;
for (int k = 0; k < 10; k++) {
  if (float(k) >= p_octaves) break;
  float per = p_scale * exp2(float(k)); vec2 q = uv * per; vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3. - 2. * f);
  vec2 o = seedv(p_seed + float(k) * 3.7) * 0.37 + float(k) * 19.19;
  float a = hash12(mod(i, per) * 1.731 + o), b = hash12(mod(i + vec2(1., 0.), per) * 1.731 + o);
  float c = hash12(mod(i + vec2(0., 1.), per) * 1.731 + o), d = hash12(mod(i + vec2(1., 1.), per) * 1.731 + o);
  sum += mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * amp; norm += amp; amp *= p_roughness;
}
float v = sum / max(norm, 1e-5);`),
  noise('fractalSum2', 'Fractal sum 2', 'Фрактальная сумма 2', 'Smooth Perlin layers with strong fine detail: weathered surfaces, plaster, terrain.', 'Гладкие слои Перлина с сильной мелкой деталью: выветренные поверхности, штукатурка, рельеф.', { scale: 2, octaves: 9, roughness: 0.68, contrast: 0.4 },
    `float v = fbm(uv, p_scale, p_octaves, p_roughness, 0., p_seed);`),
  noise('fractalSum3', 'Fractal sum 3', 'Фрактальная сумма 3', 'Folded (billowy) noise layers, turned over: lumpy, cauliflower-like detail, moss, coral.', 'Сложенные (клубящиеся) слои шума, перевёрнутые: бугристая деталь, мох, кораллы.', { scale: 3, octaves: 7, roughness: 0.55, contrast: 0.3 },
    `float sum = 0., amp = 1., norm = 0.;
for (int k = 0; k < 10; k++) {
  if (float(k) >= p_octaves) break;
  float per = p_scale * exp2(float(k));
  sum += abs(gradNoise(uv * per, per, p_seed + float(k) * 5.3) * 2. - 1.) * amp; norm += amp; amp *= p_roughness;
}
float v = 1. - clamp(sum / max(norm, 1e-5) * 1.2, 0., 1.);`),
  noise('fractalSum4', 'Fractal sum 4', 'Фрактальная сумма 4', 'Busy, even blotches with grainy edges at a medium size: a general breakup for any surface.', 'Частые ровные пятна с зернистыми краями среднего размера: общая неоднородность для любой поверхности.', { scale: 10, octaves: 6, roughness: 0.6, contrast: 0.5 },
    `float sum = 0., amp = 1., norm = 0.;
for (int k = 0; k < 10; k++) {
  if (float(k) >= p_octaves) break;
  float per = p_scale * exp2(float(k)); vec2 q = uv * per; vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3. - 2. * f);
  vec2 o = seedv(p_seed + float(k) * 3.7) * 0.37 + float(k) * 19.19;
  float a = hash12(mod(i, per) * 1.731 + o), b = hash12(mod(i + vec2(1., 0.), per) * 1.731 + o);
  float c = hash12(mod(i + vec2(0., 1.), per) * 1.731 + o), d = hash12(mod(i + vec2(1., 1.), per) * 1.731 + o);
  sum += mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * amp; norm += amp; amp *= p_roughness;
}
float v = sum / max(norm, 1e-5);`),
  noise('bnwSpots1', 'B&W spots 1', 'Ч/б пятна 1', 'Broad soft light and dark areas, speckled with fine detail: dirt, stains, a mask to mix two materials.', 'Крупные мягкие светлые и тёмные области в мелких крапинках: грязь, пятна, маска для смешивания двух материалов.', { scale: 3, octaves: 9, roughness: 0.72, contrast: 0.6 },
    `float v = fbm(uv, p_scale, p_octaves, p_roughness, 0., p_seed) * 0.75 + fbm(uv, p_scale * 8., 4., p_roughness, 1., p_seed + 2.) * 0.25;`, false, true),
  noise('bnwSpots2', 'B&W spots 2', 'Ч/б пятна 2', 'Mottled spots of every size with ragged edges: lichen, grime, mottled paint.', 'Пёстрые пятна всех размеров с рваными краями: лишайник, грязь, пёстрая краска.', { scale: 6, octaves: 8, roughness: 0.7, contrast: 0.45 },
    `float sum = 0., amp = 1., norm = 0.;
for (int k = 0; k < 10; k++) {
  if (float(k) >= p_octaves) break;
  float per = p_scale * exp2(float(k)); vec2 q = uv * per; vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3. - 2. * f);
  vec2 o = seedv(p_seed + float(k) * 3.7) * 0.37 + float(k) * 19.19;
  float a = hash12(mod(i, per) * 1.731 + o), b = hash12(mod(i + vec2(1., 0.), per) * 1.731 + o);
  float c = hash12(mod(i + vec2(0., 1.), per) * 1.731 + o), d = hash12(mod(i + vec2(1., 1.), per) * 1.731 + o);
  sum += mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * amp; norm += amp; amp *= p_roughness;
}
float v = sum / max(norm, 1e-5);`, false, true),
  noise('bnwSpots3', 'B&W spots 3', 'Ч/б пятна 3', 'Fine, even mottling with darker and lighter clumps: concrete, granite, worn plastic.', 'Мелкая ровная пестрота с тёмными и светлыми сгустками: бетон, гранит, потёртый пластик.', { scale: 8, octaves: 7, roughness: 0.72, contrast: 0.5 },
    `float sum = 0., amp = 1., norm = 0.;
for (int k = 0; k < 10; k++) {
  if (float(k) >= p_octaves) break;
  float per = p_scale * exp2(float(k)); vec2 q = uv * per; vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3. - 2. * f);
  vec2 o = seedv(p_seed + float(k) * 3.7) * 0.37 + float(k) * 19.19;
  float a = hash12(mod(i, per) * 1.731 + o), b = hash12(mod(i + vec2(1., 0.), per) * 1.731 + o);
  float c = hash12(mod(i + vec2(0., 1.), per) * 1.731 + o), d = hash12(mod(i + vec2(1., 1.), per) * 1.731 + o);
  sum += mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * amp; norm += amp; amp *= p_roughness;
}
float v = sum / max(norm, 1e-5);
v = v * 0.8 + fbm(uv, max(1., floor(p_scale / 3.)), 4., 0.5, 0., p_seed + 9.) * 0.2;`, false, true),
  noise('bnwSpots4', 'B&W spots 4', 'Ч/б пятна 4', 'Fine speckles gathered in clusters by a broad noise: rust pitting, dust, terrazzo, salt and pepper.', 'Мелкие крапинки, собранные в группы крупным шумом: ржавые раковины, пыль, терраццо.', { scale: 16, octaves: 5, roughness: 0.65, contrast: 0.6 },
    `float sum = 0., amp = 1., norm = 0.;
for (int k = 0; k < 10; k++) {
  if (float(k) >= p_octaves) break;
  float per = p_scale * exp2(float(k)); vec2 q = uv * per; vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3. - 2. * f);
  vec2 o = seedv(p_seed + float(k) * 3.7) * 0.37 + float(k) * 19.19;
  float a = hash12(mod(i, per) * 1.731 + o), b = hash12(mod(i + vec2(1., 0.), per) * 1.731 + o);
  float c = hash12(mod(i + vec2(0., 1.), per) * 1.731 + o), d = hash12(mod(i + vec2(1., 1.), per) * 1.731 + o);
  sum += mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * amp; norm += amp; amp *= p_roughness;
}
float v = sum / max(norm, 1e-5);
v = v * 0.6 + fbm(uv, max(1., floor(p_scale / 5.)), 4., 0.5, 0., p_seed + 4.) * 0.4;`, false, true),

  // ── More (2026-11): free transform ──
  {
    type: 'freeTransform',
    group: 'change',
    label: l('Free transform', 'Свободная трансформация'),
    hint: l(
      'Place a picture anywhere by hand: drag, turn and size it with the handles in the Flat preview (a bolt, a logo, a crack). One copy wraps around the edges so the square still tiles; or repeat it.',
      'Поставить картинку куда угодно вручную: двигайте, поворачивайте и меняйте размер ручками в плоском просмотре (болт, логотип, трещина). Одна копия переходит через края, так что квадрат стыкуется; или повторите её.',
    ),
    inputs: [IN_COLOR('in', l('Picture', 'Картинка'), [1, 1, 1]), IN_COLOR('bg', l('Background', 'Фон'), [0, 0, 0])],
    output: 'color',
    params: [
      { id: 'x', label: l('Across', 'Поперёк'), kind: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
      { id: 'y', label: l('Down', 'Вниз'), kind: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
      { id: 'angle', label: l('Turn', 'Поворот'), kind: 'number', min: -180, max: 180, step: 0.1, default: 0 },
      { id: 'w', label: l('Width', 'Ширина'), kind: 'number', min: 0.01, max: 4, step: 0.001, default: 0.5 },
      { id: 'h', label: l('Height', 'Высота'), kind: 'number', min: 0.01, max: 4, step: 0.001, default: 0.5 },
      { id: 'repeat', label: l('Repeat', 'Повторять'), kind: 'bool', default: false },
      { id: 'mode', label: l('Over the background', 'Поверх фона'), kind: 'choice', options: [opt('replace', 'Cover', 'Закрыть'), opt('max', 'Lighter', 'Светлее'), opt('add', 'Add', 'Сложить'), opt('min', 'Darker', 'Темнее')], default: 'replace' },
    ],
    glsl: `float a = radians(p_angle); mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
vec2 size = max(vec2(p_w, p_h), vec2(1e-4));
vec3 bg = inC_bg(uv).rgb; vec3 col = bg; bool hit = false; vec3 pic = vec3(0.);
if (p_repeat > 0.5) { pic = inC_in(r * (uv - vec2(p_x, p_y)) / size + 0.5).rgb; hit = true; }
else {
  // The copy and its neighbours one square away, so it wraps across the edges.
  for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
    vec2 q = r * (uv + vec2(float(ox), float(oy)) - vec2(p_x, p_y)) / size;
    if (!hit && abs(q.x) <= 0.5 && abs(q.y) <= 0.5) { pic = inC_in(q + 0.5).rgb; hit = true; }
  }
}
if (hit) { int m = int(p_mode + 0.5); col = m == 0 ? pic : m == 1 ? max(bg, pic) : m == 2 ? bg + pic : min(bg, pic); }
outColor = vec4(col, 1.);`,
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
