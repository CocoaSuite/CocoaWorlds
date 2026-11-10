# Cocoa Materials node reference

<!-- Written from packages/materials/src/catalog.ts. Do not edit by hand: run
     CW_WRITE_CATALOG=1 npx vitest run packages/materials/test/catalog.test.ts -->

Catalog version 1, for graph format `cocoaworlds.material` version 1. 79 nodes.
How a node is evaluated (uniforms, inputs, uv) is in [the format spec](../cocoamat-format.md), section 5;
the same data as JSON, with the shared GLSL library, is in [nodes.json](nodes.json).

## Make

### Noise — `noise`

Cloudy random patterns: soft (Perlin), blocky (value) or ridged like veins.

Makes: grey · hash `51f0fd0e`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `kind` (Kind) | choice | 0 `perlin`, 1 `value`, 2 `ridged` | `perlin` |
| `scale` (Scale) | int | 1 – 64 | `4` |
| `octaves` (Detail) | int | 1 – 10 | `5` |
| `roughness` (Roughness) | number | 0 – 1 | `0.5` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
outColor = vec4(vec3(fbm(uv, p_scale, p_octaves, p_roughness, p_kind, p_seed)), 1.);
```

### Cells — `cells`

Cells around random points (Voronoi): stones, scales, cracked mud.

Makes: grey · hash `d5e50a4b`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `mode` (Shows) | choice | 0 `distance`, 1 `edges`, 2 `random` | `distance` |
| `scale` (Scale) | int | 1 – 64 | `6` |
| `jitter` (Randomness) | number | 0 – 1 | `1` |
| `width` (Edge width) | number | 0.01 – 0.5 | `0.08` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
vec3 v = voronoi(uv, p_scale, p_jitter, p_seed);
float r = p_mode < 0.5 ? clamp(v.x, 0., 1.) : p_mode < 1.5 ? smoothstep(0., p_width, v.y - v.x) : v.z;
outColor = vec4(vec3(r), 1.);
```

### Bricks and tiles — `bricks`

Rows of bricks or tiles with mortar between them; white is brick, black mortar.

Makes: grey · hash `ab639cef`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `rows` (Rows) | int | 1 – 64 | `8` |
| `columns` (Columns) | int | 1 – 64 | `4` |
| `offset` (Offset) | number | 0 – 1 | `0.5` |
| `mortar` (Mortar) | number | 0 – 0.5 | `0.06` |
| `bevel` (Bevel) | number | 0 – 0.5 | `0.12` |
| `random` (Random brightness) | number | 0 – 1 | `0.3` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float y = uv.y * p_rows; float row = floor(y);
float x = uv.x * p_columns + p_offset * mod(row, 2.); float col = floor(x);
vec2 f = vec2(fract(x), fract(y));
// Distance to the brick's edge, in row heights.
float dx = min(f.x, 1. - f.x) * p_rows / p_columns, dy = min(f.y, 1. - f.y);
float d = min(dx, dy) - p_mortar * 0.5;
float r = hash12(vec2(mod(col, p_columns), mod(row, p_rows)) + seedv(p_seed));
float h = d <= 0. ? 0. : (p_bevel > 0. ? smoothstep(0., p_bevel, d) : 1.) * (1. - p_random * r);
outColor = vec4(vec3(h), 1.);
```

### Shape — `shape`

A circle, square, polygon or star, repeated to tile.

Makes: grey · hash `9cb8fe82`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `kind` (Kind) | choice | 0 `circle`, 1 `square`, 2 `polygon`, 3 `star` | `circle` |
| `sides` (Sides) | int | 3 – 12 | `6` |
| `size` (Size) | number | 0 – 1.5 | `0.7` |
| `softness` (Softness) | number | 0 – 1 | `0.05` |
| `tiles` (Repeat) | int | 1 – 32 | `1` |
| `angle` (Turn) | number | 0 – 360 (step 1) | `0` |

```glsl
vec2 p = fract(uv * p_tiles) - 0.5;
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
outColor = vec4(vec3(1. - smoothstep(p_size - s, p_size + s, d)), 1.);
```

### Gradient — `gradient`

Dark to light across the square. Linear doesn’t tile; mirrored and round do.

Makes: grey · hash `38b10291`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `kind` (Kind) | choice | 0 `linear`, 1 `mirrored`, 2 `radial` | `mirrored` |
| `direction` (Direction) | choice | 0 `across`, 1 `down` | `down` |
| `tiles` (Repeat) | int | 1 – 32 | `1` |

```glsl
vec2 q = fract(uv * p_tiles); float t = p_direction < 0.5 ? q.x : q.y;
float v = p_kind < 0.5 ? t : p_kind < 1.5 ? 1. - abs(t * 2. - 1.) : 1. - clamp(length(q - 0.5) * 2., 0., 1.);
outColor = vec4(vec3(v), 1.);
```

### Checker — `checker`

Black and white squares.

Makes: grey · hash `637006f6`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `tiles` (Squares across) | int | 1 – 64 | `8` |

```glsl
float v = mod(floor(uv.x * p_tiles) + floor(uv.y * p_tiles), 2.); outColor = vec4(vec3(v), 1.);
```

### Scratches — `scratches`

Thin random lines, mostly one way: scuffed metal, scratched paint.

Makes: grey · hash `66661f37`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `density` (How many) | int | 1 – 32 | `8` |
| `length` (Length) | number | 0.05 – 1.5 | `0.6` |
| `width` (Width) | number | 0.002 – 0.1 | `0.01` |
| `angle` (Direction) | number | 0 – 180 (step 1) | `30` |
| `spread` (Spread) | number | 0 – 1 | `0.3` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
vec2 p = uv * p_density; vec2 i = floor(p); float v = 0.;
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
outColor = vec4(vec3(v), 1.);
```

### Grunge — `grunge`

Blotchy dirt and stains (noise warped by noise).

Makes: grey · hash `d1a9bd5f`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `style` (Style) | choice | 0 `blotches`, 1 `streaks`, 2 `speckles`, 3 `rust` | `blotches` |
| `scale` (Scale) | int | 1 – 32 | `3` |
| `warp` (Swirl) | number | 0 – 1 | `0.4` |
| `contrast` (Contrast) | number | 0 – 1 | `0.5` |
| `amount` (Amount) | number | 0 – 1 | `0.5` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
vec2 q = uv + p_warp * 0.25 * (vec2(fbm(uv, p_scale, 4., 0.5, 0., p_seed), fbm(uv, p_scale, 4., 0.5, 0., p_seed + 11.)) - 0.5);
float v;
if (p_style < 0.5) v = fbm(q, p_scale * 2., 7., 0.55, 0., p_seed + 23.);
// Streaks: stretched up and down (eight times finer across, still tiling).
else if (p_style < 1.5) v = fbm(vec2(q.x * 8., q.y), p_scale * 2., 6., 0.5, 0., p_seed + 23.) * (0.6 + 0.4 * fbm(q, p_scale, 3., 0.5, 0., p_seed + 5.));
// Speckles: small spots, more where a broad noise says so.
else if (p_style < 2.5) v = valueNoise(q * p_scale * 24., p_scale * 24., p_seed + 31.) * (0.4 + 0.8 * fbm(uv, p_scale, 3., 0.5, 0., p_seed + 7.));
// Rust: veined patches.
else v = fbm(q, p_scale * 2., 6., 0.6, 2., p_seed + 41.) * fbm(uv, p_scale, 4., 0.5, 0., p_seed + 3.) * 1.4;
float c = mix(0.5, 0.02, p_contrast); float m = 1. - p_amount;
outColor = vec4(vec3(smoothstep(m - c, m + c, v)), 1.);
```

### Image — `image`

A picture from the project’s textures.

Makes: color · hash `af716a1e`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `image` (Image) | image | image path | `""` |

```glsl
outColor = p_image_ok > 0.5 ? vec4(texture(p_image, uv).rgb, 1.) : vec4(mod(floor(uv.x * 8.) + floor(uv.y * 8.), 2.) * vec3(1., 0., 0.86), 1.);
```

### Colour — `color`

One flat colour.

Makes: color · hash `8ec5675c`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `color` (Colour) | color |  | `#b08c64` |

```glsl
outColor = vec4(p_color, 1.);
```

### Number — `value`

One flat grey (0 black, 1 white): a roughness, a metal amount.

Makes: grey · hash `ecc7ac61`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `value` (Value) | number | 0 – 1 | `0.5` |

```glsl
outColor = vec4(vec3(p_value), 1.);
```

### Waves and stripes — `waves`

Repeating bands: soft waves, hard stripes, saw or zigzag-like ramps, optionally wobbly.

Makes: grey · hash `f0b4de79`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `kind` (Kind) | choice | 0 `sine`, 1 `stripes`, 2 `saw`, 3 `triangle` | `sine` |
| `count` (Count) | int | 1 – 64 | `8` |
| `direction` (Direction) | choice | 0 `across`, 1 `down`, 2 `diagonal` | `down` |
| `sharpness` (Sharpness) | number | 0 – 1 | `0.5` |
| `wobble` (Wobble) | number | 0 – 1 | `0` |
| `wobbleScale` (Wobble size) | int | 1 – 16 | `3` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float t = p_direction < 0.5 ? uv.x : p_direction < 1.5 ? uv.y : uv.x + uv.y;
t += (fbm(uv, p_wobbleScale, 4., 0.5, 0., p_seed) - 0.5) * p_wobble * 2. / max(p_count, 1.);
float x = fract(t * p_count); int k = int(p_kind + 0.5); float v;
if (k == 0) v = 0.5 + 0.5 * sin(x * 6.2831853);
else if (k == 1) v = 0.5 + 0.5 * sin(x * 6.2831853);
else if (k == 2) v = x;
else v = 1. - abs(x * 2. - 1.);
float e = k == 1 ? (1. - p_sharpness) * 0.45 + 0.01 : (1. - p_sharpness) * 0.5 + 0.02;
if (k == 1 || p_sharpness > 0.) v = mix(v, smoothstep(0.5 - e, 0.5 + e, v), k == 1 ? 1. : p_sharpness);
outColor = vec4(vec3(v), 1.);
```

### Hexagons — `hexagons`

Hexagonal tiles with gaps between them (white tile, black gap).

Makes: grey · hash `f201d517`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `scale` (Across) | int | 2 – 48 | `6` |
| `gap` (Gap) | number | 0 – 0.4 | `0.06` |
| `bevel` (Bevel) | number | 0 – 0.5 | `0.15` |
| `random` (Random brightness) | number | 0 – 1 | `0.3` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float N = p_scale; float M = max(1., floor(N / 1.7320508 + 0.5));
vec2 p = vec2(uv.x * N, uv.y * M * 1.7320508);
vec2 r = vec2(1., 1.7320508); vec2 hh = r * 0.5;
vec2 a = mod(p, r) - hh; vec2 b = mod(p - hh, r) - hh;
vec2 g = dot(a, a) < dot(b, b) ? a : b;
vec2 cid = p - g;
vec2 q = abs(g); float d = max(q.x, dot(q, vec2(0.5, 0.8660254)));
float edge = 0.5 - d - p_gap * 0.5;
float rnd = hash12(floor(mod(cid + 0.01, vec2(N, M * 1.7320508)) * 4.) + seedv(p_seed));
float v = edge <= 0. ? 0. : (p_bevel > 0. ? smoothstep(0., p_bevel * 0.5, edge) : 1.) * (1. - p_random * rnd);
outColor = vec4(vec3(v), 1.);
```

### Weave — `weave`

Threads woven over and under each other: cloth, baskets, wicker (as height).

Makes: grey · hash `3a7ad79b`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `threads` (Threads) | int | 2 – 64 | `8` |
| `width` (Thread width) | number | 0.3 – 1 | `0.8` |

```glsl
vec2 p = uv * p_threads; vec2 c = floor(p); vec2 f = fract(p) - 0.5;
float over = mod(c.x + c.y, 2.); float w = p_width * 0.5;
float hT = 1. - smoothstep(w - 0.08, w, abs(f.y)); float vT = 1. - smoothstep(w - 0.08, w, abs(f.x));
float hH = hT * (0.65 + 0.35 * cos(f.x * 3.14159)); float vH = vT * (0.65 + 0.35 * cos(f.y * 3.14159));
float v = over > 0.5 ? max(hH, vH * 0.55) : max(vH, hH * 0.55);
outColor = vec4(vec3(v), 1.);
```

### Planks — `planks`

Rows of boards of staggered lengths with gaps, each a little different, with grain.

Makes: grey · hash `5c95cd24`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `rows` (Rows) | int | 1 – 32 | `6` |
| `lengths` (Boards per row) | int | 1 – 8 | `2` |
| `gap` (Gap) | number | 0 – 0.2 | `0.03` |
| `random` (Random brightness) | number | 0 – 1 | `0.35` |
| `grain` (Grain) | number | 0 – 1 | `0.5` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float y = uv.y * p_rows; float row = floor(y); float fy = fract(y);
float sh = hash12(vec2(mod(row, p_rows), 3.) + seedv(p_seed));
float x = uv.x * p_lengths + sh; float col = floor(x); float fx = fract(x);
float dGap = min(min(fy, 1. - fy), min(fx, 1. - fx) * p_rows / p_lengths);
float board = smoothstep(p_gap * 0.5, p_gap * 0.5 + 0.03, dGap);
float r = hash12(vec2(mod(col, p_lengths), mod(row, p_rows)) + seedv(p_seed) + 5.);
float g = 0.5 + 0.5 * sin((fy * 7. + fbm(uv, 8., 4., 0.5, 0., p_seed + r * 7.) * 3.) * 6.2831853);
outColor = vec4(vec3(board * (1. - p_random * r) * mix(1., 0.72 + 0.28 * g, p_grain)), 1.);
```

### Wood grain — `woodGrain`

Growth rings bent by noise, like sawn wood.

Makes: grey · hash `6cdf0493`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `rings` (Rings) | int | 1 – 48 | `8` |
| `distortion` (Distortion) | number | 0 – 1 | `0.5` |
| `scale` (Noise size) | int | 1 – 16 | `3` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float n = fbm(uv, p_scale, 5., 0.55, 0., p_seed);
float t = uv.y * p_rings + n * p_distortion * 4.;
float v = pow(0.5 + 0.5 * sin(t * 6.2831853), 3.);
outColor = vec4(vec3(1. - v * 0.8), 1.);
```

### Cobblestones — `cobblestones`

Rounded stones packed together with gaps (as height).

Makes: grey · hash `dfee0f68`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `scale` (Scale) | int | 2 – 48 | `7` |
| `gap` (Gap) | number | 0 – 0.3 | `0.05` |
| `bevel` (Roundness) | number | 0 – 1 | `0.6` |
| `random` (Random brightness) | number | 0 – 1 | `0.3` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
vec3 v = voronoi(uv, p_scale, 0.9, p_seed);
float d = (v.y - v.x) * 0.5 - p_gap * 0.5;
float h = d <= 0. ? 0. : smoothstep(0., p_bevel * 0.4 + 1e-3, d);
outColor = vec4(vec3(h * (1. - p_random * v.z)), 1.);
```

### Cracks — `cracks`

A network of thin wandering cracks (white): dry mud, old paint, broken stone.

Makes: grey · hash `bfe04a76`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `scale` (Scale) | int | 2 – 48 | `6` |
| `width` (Width) | number | 0.01 – 1 | `0.25` |
| `distortion` (Wander) | number | 0 – 1 | `0.5` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
vec2 w = vec2(fbm(uv, 4., 4., 0.5, 0., p_seed + 11.), fbm(uv, 4., 4., 0.5, 0., p_seed + 23.)) - 0.5;
vec3 v = voronoi(fract(uv + w * p_distortion * 0.25), p_scale, 1., p_seed);
outColor = vec4(vec3(1. - smoothstep(0., p_width * 0.1 + 1e-3, v.y - v.x)), 1.);
```

### Marble — `marble`

Veins swirled through stone.

Makes: grey · hash `d59c3b35`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `veins` (Veins) | int | 1 – 16 | `3` |
| `turbulence` (Turbulence) | number | 0 – 1 | `0.6` |
| `scale` (Noise size) | int | 1 – 16 | `3` |
| `sharpness` (Thin veins) | number | 0 – 1 | `0.6` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float n = fbm(uv, p_scale, 6., 0.55, 0., p_seed);
float t = (uv.x + uv.y) * p_veins + (n - 0.5) * p_turbulence * 3.;
float v = pow(1. - abs(sin(t * 3.14159265)), mix(1., 6., p_sharpness));
outColor = vec4(vec3(v), 1.);
```

### Blobs — `blobs`

Soft or sharp random patches covering as much as you say: rust spots, puddles, moss.

Makes: grey · hash `0782be38`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `scale` (Scale) | int | 1 – 32 | `4` |
| `coverage` (Coverage) | number | 0 – 1 | `0.4` |
| `softness` (Softness) | number | 0 – 1 | `0.2` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float n = fbm(uv, p_scale, 5., 0.5, 0., p_seed);
float e = 1. - p_coverage; float s = p_softness * 0.2 + 0.005;
outColor = vec4(vec3(smoothstep(e - s, e + s, n)), 1.);
```

### Speckles — `speckles`

Small random dots: gravel, terrazzo, stars, dust.

Makes: grey · hash `eb0d1bc8`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `density` (Grid) | int | 4 – 256 | `24` |
| `amount` (Amount) | number | 0 – 1 | `0.35` |
| `size` (Size) | number | 0.05 – 1 | `0.7` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
vec2 p = uv * p_density; vec2 c = floor(p); vec2 f = fract(p);
vec2 o = seedv(p_seed); vec2 cm = mod(c, p_density);
float has = step(1. - p_amount, hash12(cm + o));
vec2 at = 0.25 + 0.5 * hash22(cm + o + 3.1);
float r = p_size * 0.3 * (0.5 + hash12(cm + o + 9.2));
float v = has * (1. - smoothstep(r * 0.6, r, length(f - at)));
outColor = vec4(vec3(v), 1.);
```

### Scatter — `scatter`

Copies of a picture scattered over the square, each a different size, turn and brightness: leaves, pebbles, bolts.

Makes: color · hash `0b236b89`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Picture) | color | 1, 1, 1 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `count` (Amount X) | int | 1 – 32 | `6` |
| `countY` (Amount Y) | int | 1 – 32 | `6` |
| `size` (Size) | number | 0.05 – 2 | `0.6` |
| `sizeRandom` (Size varies) | number | 0 – 1 | `0.4` |
| `turn` (Turn varies) | number | 0 – 1 | `1` |
| `brightRandom` (Brightness varies) | number | 0 – 1 | `0.3` |
| `apart` (Keep apart) | bool |  | `false` |
| `margin` (Space between) | number | 0 – 0.5 | `0.05` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
vec2 N = vec2(p_count, p_countY); vec2 p = uv * N; vec2 c = floor(p); float best = 0.; vec3 col = vec3(0.); vec2 o = seedv(p_seed);
// Copies are measured in units of a cell's shorter side, so uneven X/Y amounts don't stretch them.
float k = max(N.x, N.y); vec2 dims = k / N;
// Keep apart: each copy stays inside its own cell (its turned corners too, plus the space between), so none touch.
float reach = p_turn > 0. ? 0.70711 : 0.5;
float room = max(0., 1. - p_margin);
for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
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
    if (g > best) { best = g; col = t; }
  }
}
outColor = vec4(col, 1.);
```

### Zigzag — `zigzag`

Chevron stripes (herringbone-like bands).

Makes: grey · hash `4033a35d`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `count` (Count) | int | 1 – 32 | `6` |
| `amount` (Zig size) | number | 0 – 2 | `0.5` |
| `direction` (Direction) | choice | 0 `down`, 1 `across` | `down` |
| `sharpness` (Sharpness) | number | 0 – 1 | `0.8` |

```glsl
vec2 q = p_direction < 0.5 ? uv : uv.yx;
float t = q.y * p_count + p_amount * (1. - abs(fract(q.x * p_count) * 2. - 1.));
float s = 0.5 + 0.5 * sin(t * 6.2831853); float e = (1. - p_sharpness) * 0.5 + 0.01;
outColor = vec4(vec3(smoothstep(0.5 - e, 0.5 + e, s)), 1.);
```

## Change

### Levels — `levels`

Stretch, squeeze and shift the tones: more contrast, darker, lighter.

Makes: color · hash `d67bb2ae`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `inLow` (Black point) | number | 0 – 1 | `0` |
| `inHigh` (White point) | number | 0 – 1 | `1` |
| `gamma` (Midtones) | number | 0.1 – 4 | `1` |
| `outLow` (Darkest) | number | 0 – 1 | `0` |
| `outHigh` (Lightest) | number | 0 – 1 | `1` |

```glsl
vec3 c = inC_in(uv).rgb;
vec3 x = clamp((c - p_inLow) / max(p_inHigh - p_inLow, 1e-4), 0., 1.);
x = pow(x, vec3(1. / p_gamma));
outColor = vec4(mix(vec3(p_outLow), vec3(p_outHigh), x), 1.);
```

### Curve — `curve`

Reshape the tones with four points (black, dark, light, white).

Makes: color · hash `b9c35fd9`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `y0` (Black becomes) | number | 0 – 1 | `0` |
| `y1` (Dark becomes) | number | 0 – 1 | `0.333` |
| `y2` (Light becomes) | number | 0 – 1 | `0.667` |
| `y3` (White becomes) | number | 0 – 1 | `1` |

```glsl
vec3 c = clamp(inC_in(uv).rgb, 0., 1.); outColor = vec4(curve4(c.r, p_y0, p_y1, p_y2, p_y3), curve4(c.g, p_y0, p_y1, p_y2, p_y3), curve4(c.b, p_y0, p_y1, p_y2, p_y3), 1.);
```

### Invert — `invert`

Black becomes white, and the other way round.

Makes: color · hash `7ea3f134`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

```glsl
outColor = vec4(1. - inC_in(uv).rgb, 1.);
```

### Clamp — `clamp`

Keep values between a lowest and a highest.

Makes: color · hash `0eedc580`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `min` (Lowest) | number | 0 – 1 | `0` |
| `max` (Highest) | number | 0 – 1 | `1` |

```glsl
outColor = vec4(clamp(inC_in(uv).rgb, p_min, p_max), 1.);
```

### Blur — `blur`

Soften: a share of the square to blur across.

Makes: color · hash `cf979483`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `radius` (Radius) | number | 0 – 0.1 (step 0.001) | `0.01` |

```glsl
vec3 s = vec3(0.); float w = 0.;
for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
  vec2 o = vec2(x, y) / 3.; float k = exp(-dot(o, o) * 2.);
  s += inC_in(uv + o * p_radius).rgb * k; w += k;
}
outColor = vec4(s / w, 1.);
```

### Warp — `warp`

Push the picture around by another one: along its slopes, or one way by its brightness.

Makes: color · hash `70337ce7`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |
| `by` (By) | grey | 0.5, 0.5, 0.5 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `mode` (How) | choice | 0 `slope`, 1 `direction` | `slope` |
| `amount` (Amount) | number | 0 – 1 | `0.2` |
| `angle` (Direction) | number | 0 – 360 (step 1) | `0` |

```glsl
vec2 off;
if (p_mode < 0.5) { float e = 1. / 256.; off = vec2(inG_by(uv + vec2(e, 0.)) - inG_by(uv - vec2(e, 0.)), inG_by(uv + vec2(0., e)) - inG_by(uv - vec2(0., e))) / (2. * e) * p_amount * 0.01; }
else off = vec2(cos(radians(p_angle)), sin(radians(p_angle))) * (inG_by(uv) - 0.5) * p_amount * 0.25;
outColor = vec4(inC_in(uv + off).rgb, 1.);
```

### Directional warp — `directionalWarp`

Push the picture along one direction by how bright another is: once (a shift), or flowing step by step (smeared, streaky).

Makes: color · hash `0c73c1a6`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |
| `by` (Intensity) | grey | 0.5, 0.5, 0.5 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `angle` (Direction) | number | 0 – 360 (step 1) | `0` |
| `amount` (Amount) | number | 0 – 1 | `0.15` |
| `mode` (How) | choice | 0 `shift`, 1 `flow` | `shift` |
| `centred` (Grey stays put) | bool |  | `true` |

```glsl
vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle)));
float bias = p_centred > 0.5 ? 0.5 : 0.;
vec2 q = uv;
if (p_mode < 0.5) q += dir * (inG_by(uv) - bias) * p_amount;
else for (int k = 0; k < 12; k++) q += dir * (inG_by(q) - bias) * p_amount / 12.;
outColor = vec4(inC_in(q).rgb, 1.);
```

### Flood fill — `floodFill`

Give each separate white shape of a mask (each brick, tile, plank) its own value: a random grey or colour, a gradient across it, or where it is. Exact for rectangular shapes.

Makes: color · hash `47a3a396`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Mask) | grey | 1, 1, 1 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `gives` (Gives) | choice | 0 `grey`, 1 `colour`, 2 `gradient`, 3 `position`, 4 `size` | `grey` |
| `direction` (Gradient) | choice | 0 `across`, 1 `down`, 2 `random` | `random` |
| `threshold` (White from) | number | 0.01 – 0.99 | `0.5` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
if (inG_in(uv) < p_threshold) { outColor = vec4(0., 0., 0., 1.); return; }
// The shape's extent: step out each way until the mask goes dark (2 pixels a step).
float st = u_px * 2.; float l = 0., r = 0., u = 0., d = 0.;
for (int k = 1; k <= 160; k++) { if (inG_in(uv - vec2(float(k) * st, 0.)) < p_threshold) break; l = float(k) * st; }
for (int k = 1; k <= 160; k++) { if (inG_in(uv + vec2(float(k) * st, 0.)) < p_threshold) break; r = float(k) * st; }
for (int k = 1; k <= 160; k++) { if (inG_in(uv - vec2(0., float(k) * st)) < p_threshold) break; u = float(k) * st; }
for (int k = 1; k <= 160; k++) { if (inG_in(uv + vec2(0., float(k) * st)) < p_threshold) break; d = float(k) * st; }
vec2 lo = uv - vec2(l, u), hi = uv + vec2(r, d);
vec2 ctr = fract((lo + hi) * 0.5);
// One id per shape: its centre, rounded to a few pixels so every pixel of it agrees (wrapped whole, so a shape
// crossing the square's edge gets one id on both sides).
float cell = st * 4.; float n = floor(1. / cell + 0.5);
vec2 id = mod(floor((lo + hi) * 0.5 / cell + 0.5), n);
float h = hash12(id + seedv(p_seed));
int g = int(p_gives + 0.5); vec3 c;
if (g == 0) c = vec3(h);
else if (g == 1) c = hsv2rgb(vec3(h, 0.55 + 0.4 * hash12(id + seedv(p_seed) + 3.3), 0.6 + 0.4 * hash12(id + seedv(p_seed) + 7.1)));
else if (g == 2) {
  vec2 t = (uv - lo) / max(hi - lo, vec2(1e-4));
  float a = p_direction < 0.5 ? 0. : p_direction < 1.5 ? 1.5707963 : h * 6.2831853;
  vec2 dv = vec2(cos(a), sin(a));
  float v = dot(t - 0.5, dv) / (abs(dv.x) * 0.5 + abs(dv.y) * 0.5 + 1e-4) * 0.5 + 0.5;
  c = vec3(clamp(v, 0., 1.));
}
else if (g == 3) c = vec3(ctr, 0.);
else c = vec3(clamp((hi - lo) * 1., 0., 1.), 0.);
outColor = vec4(c, 1.);
```

### Transform — `transform`

Repeat, scale, slide or turn the picture (in quarter turns, so it still tiles; a scale other than 1 can break the tiling).

Makes: color · hash `ff57536e`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `tiles` (Repeat) | int | 1 – 32 | `2` |
| `scale` (Scale) | number | 0.1 – 8 (step 0.01) | `1` |
| `x` (Slide across) | number | 0 – 1 | `0` |
| `y` (Slide down) | number | 0 – 1 | `0` |
| `turn` (Turn) | choice | 0 `0`, 1 `90`, 2 `180`, 3 `270` | `0` |

```glsl
vec2 q = uv - 0.5;
if (p_turn > 0.5 && p_turn < 1.5) q = vec2(-q.y, q.x); else if (p_turn > 1.5 && p_turn < 2.5) q = -q; else if (p_turn > 2.5) q = vec2(q.y, -q.x);
outColor = vec4(inC_in((q / max(p_scale, 1e-3) + 0.5) * p_tiles + vec2(p_x, p_y)).rgb, 1.);
```

### Slope blur — `slopeBlur`

Smear a picture along the slopes of another: melted, eroded or flowing looks.

Makes: color · hash `cee99dd4`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |
| `slope` (Slope) | grey | 0.5, 0.5, 0.5 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `amount` (Amount) | number | 0 – 0.2 (step 0.002) | `0.04` |
| `mode` (Mode) | choice | 0 `blur`, 1 `min`, 2 `max` | `blur` |

```glsl
float e = 1. / 256.;
vec2 g = vec2(inG_slope(uv + vec2(e, 0.)) - inG_slope(uv - vec2(e, 0.)), inG_slope(uv + vec2(0., e)) - inG_slope(uv - vec2(0., e)));
vec2 dir = length(g) > 1e-5 ? -normalize(g) : vec2(0.);
vec3 acc = inC_in(uv).rgb; vec3 lo = acc, hi = acc;
for (int i = 1; i <= 12; i++) {
  vec3 c = inC_in(uv + dir * p_amount * float(i) / 12.).rgb;
  acc += c; lo = min(lo, c); hi = max(hi, c);
}
outColor = vec4(p_mode < 0.5 ? acc / 13. : p_mode < 1.5 ? lo : hi, 1.);
```

### Distance — `distance`

A soft edge growing out from white shapes: bevels, glows and wear around marks.

Makes: grey · hash `1fc245e1`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Shapes) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `distance` (How far) | number | 0.005 – 0.25 (step 0.005) | `0.05` |

```glsl
float best = inG_in(uv) > 0.5 ? 0. : 1e3;
for (int r = 1; r <= 10; r++) {
  float rad = p_distance * float(r) / 10.;
  for (int a = 0; a < 16; a++) {
    float t = float(a) / 16. * 6.2831853 + float(r) * 0.37;
    if (inG_in(uv + vec2(cos(t), sin(t)) * rad) > 0.5) best = min(best, rad);
  }
}
outColor = vec4(vec3(clamp(1. - best / p_distance, 0., 1.)), 1.);
```

### Edge detect — `edges`

White lines where the picture changes sharply: outlines of bricks and shapes.

Makes: grey · hash `7fe7f100`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `width` (Width) | number | 0.001 – 0.05 (step 0.001) | `0.006` |
| `threshold` (Threshold) | number | 0 – 1 | `0.1` |

```glsl
float e = abs(inG_in(uv + vec2(p_width, 0.)) - inG_in(uv - vec2(p_width, 0.))) + abs(inG_in(uv + vec2(0., p_width)) - inG_in(uv - vec2(0., p_width)));
outColor = vec4(vec3(smoothstep(p_threshold, p_threshold + 0.05, e)), 1.);
```

### Sharpen — `sharpen`

Crisper details: edges pushed apart.

Makes: color · hash `f8619346`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `amount` (Amount) | number | 0 – 4 | `1` |
| `radius` (Radius) | number | 0.001 – 0.02 (step 0.001) | `0.004` |

```glsl
vec3 c = inC_in(uv).rgb; float r = p_radius;
vec3 b = (inC_in(uv + vec2(r, 0.)).rgb + inC_in(uv - vec2(r, 0.)).rgb + inC_in(uv + vec2(0., r)).rgb + inC_in(uv - vec2(0., r)).rgb) * 0.25;
outColor = vec4(clamp(c + (c - b) * p_amount, 0., 1.), 1.);
```

### Posterize — `posterize`

Fewer shades: hard steps instead of smooth changes (good for stylized looks).

Makes: color · hash `6b194cd0`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `steps` (Steps) | int | 2 – 32 | `4` |

```glsl
outColor = vec4(min(floor(inC_in(uv).rgb * p_steps), vec3(p_steps - 1.)) / max(p_steps - 1., 1.), 1.);
```

### Threshold — `threshold`

Black below a level, white above, with a soft or hard step between: turn any grey into a mask.

Makes: grey · hash `ea11a658`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `position` (Level) | number | 0 – 1 | `0.5` |
| `contrast` (Hardness) | number | 0 – 1 | `0.8` |

```glsl
float w = (1. - p_contrast) * 0.5 + 0.002;
outColor = vec4(vec3(smoothstep(p_position - w, p_position + w, inG_in(uv))), 1.);
```

### Brightness and contrast — `brightness`

Lighter or darker, more or less contrast, and gamma (mid-tones).

Makes: color · hash `c200ab6e`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `brightness` (Brightness) | number | -1 – 1 | `0` |
| `contrast` (Contrast) | number | 0 – 3 | `1` |
| `gamma` (Gamma) | number | 0.2 – 5 | `1` |

```glsl
vec3 c = (inC_in(uv).rgb - 0.5) * p_contrast + 0.5 + p_brightness;
outColor = vec4(pow(clamp(c, 0., 1.), vec3(1. / p_gamma)), 1.);
```

### Mirror — `mirror`

Make the picture symmetric: left matches right, top matches bottom, or both.

Makes: color · hash `06e94c6b`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `mode` (Mirror) | choice | 0 `across`, 1 `down`, 2 `both` | `across` |

```glsl
vec2 q = uv;
if (p_mode < 0.5 || p_mode > 1.5) q.x = 0.5 - abs(uv.x - 0.5);
if (p_mode > 0.5) q.y = 0.5 - abs(uv.y - 0.5);
outColor = vec4(inC_in(q).rgb, 1.);
```

### Pixelate — `pixelate`

Big square pixels (retro look).

Makes: color · hash `3314f39c`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `cells` (Pixels across) | int | 2 – 256 | `32` |

```glsl
outColor = vec4(inC_in((floor(uv * p_cells) + 0.5) / p_cells).rgb, 1.);
```

### Swirl — `swirl`

Twist the middle of the picture round (the edges stay put, so it still tiles).

Makes: color · hash `d6f0a9e6`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `amount` (Twist) | number | -10 – 10 | `3` |
| `radius` (Radius) | number | 0.05 – 0.5 | `0.45` |

```glsl
vec2 d = uv - 0.5; float t = clamp(1. - length(d) / p_radius, 0., 1.); float a = p_amount * t * t;
outColor = vec4(inC_in(0.5 + mat2(cos(a), -sin(a), sin(a), cos(a)) * d).rgb, 1.);
```

### Outline — `outline`

White where brightness changes quickly: the edges of shapes.

Makes: grey · hash `e0699b21`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `strength` (Strength) | number | 0 – 10 | `2` |
| `radius` (Radius) | number | 0.001 – 0.02 (step 0.001) | `0.003` |

```glsl
float r = p_radius;
float tl = inG_in(uv + vec2(-r, -r)), tc = inG_in(uv + vec2(0., -r)), tr = inG_in(uv + vec2(r, -r));
float ml = inG_in(uv + vec2(-r, 0.)), mr = inG_in(uv + vec2(r, 0.));
float bl = inG_in(uv + vec2(-r, r)), bc = inG_in(uv + vec2(0., r)), br = inG_in(uv + vec2(r, r));
float gx = tr + 2. * mr + br - tl - 2. * ml - bl; float gy = bl + 2. * bc + br - tl - 2. * tc - tr;
outColor = vec4(vec3(clamp(length(vec2(gx, gy)) * p_strength, 0., 1.)), 1.);
```

### Directional blur — `motionBlur`

Smear the picture one way: streaks, brushed metal, rain.

Makes: color · hash `30d2bfbb`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `angle` (Direction) | number | 0 – 360 (step 1) | `90` |
| `length` (Length) | number | 0 – 0.25 (step 0.002) | `0.04` |

```glsl
vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle))) * p_length;
vec3 s = vec3(0.); for (int k = -8; k <= 8; k++) s += inC_in(uv + dir * float(k) / 8.).rgb;
outColor = vec4(s / 17., 1.);
```

### Light from height — `emboss`

Light a height picture from one side: bright slopes face the light (a quick preview or stylized shading).

Makes: grey · hash `db3373bb`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Height) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `angle` (Light from) | number | 0 – 360 (step 1) | `225` |
| `elevation` (Light height) | number | 5 – 85 (step 1) | `40` |
| `strength` (Strength) | number | 0 – 4 | `1` |

```glsl
float e = 1. / 256.;
vec2 g = vec2(inG_in(uv + vec2(e, 0.)) - inG_in(uv - vec2(e, 0.)), inG_in(uv + vec2(0., e)) - inG_in(uv - vec2(0., e))) * p_strength * 32.;
vec3 n = normalize(vec3(-g, 1.)); float el = radians(p_elevation), az = radians(p_angle);
vec3 L = vec3(cos(az) * cos(el), sin(az) * cos(el), sin(el));
outColor = vec4(vec3(clamp(dot(n, L), 0., 1.)), 1.);
```

## Combine

### Blend — `blend`

Put one picture over another: mixed, added, multiplied … and only where a mask is white.

Makes: color · hash `acd86661`

| Input | Reads as | Unlinked |
|---|---|---|
| `top` (Top) | color | 1, 1, 1 |
| `bottom` (Bottom) | color | 0, 0, 0 |
| `mask` (Mask) | grey | 1, 1, 1 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `mode` (Mode) | choice | 0 `mix`, 1 `add`, 2 `subtract`, 3 `multiply`, 4 `screen`, 5 `overlay`, 6 `max`, 7 `min`, 8 `difference` | `mix` |
| `opacity` (Opacity) | number | 0 – 1 | `1` |

```glsl
vec3 a = inC_top(uv).rgb, b = inC_bottom(uv).rgb; vec3 r;
int m = int(p_mode + 0.5);
if (m == 0) r = a; else if (m == 1) r = a + b; else if (m == 2) r = b - a; else if (m == 3) r = a * b;
else if (m == 4) r = 1. - (1. - a) * (1. - b);
else if (m == 5) r = mix(2. * a * b, 1. - 2. * (1. - a) * (1. - b), step(0.5, b));
else if (m == 6) r = max(a, b); else if (m == 7) r = min(a, b); else r = abs(a - b);
outColor = vec4(clamp(mix(b, r, inG_mask(uv) * p_opacity), 0., 1.), 1.);
```

### Switch — `switch`

Pass on one of two inputs (handy for trying a change).

Makes: color · hash `cb6cc0ef`

| Input | Reads as | Unlinked |
|---|---|---|
| `a` (A) | color | 0, 0, 0 |
| `b` (B) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `useB` (Use B) | bool |  | `false` |

```glsl
outColor = vec4(p_useB > 0.5 ? inC_b(uv).rgb : inC_a(uv).rgb, 1.);
```

### Math — `math`

Combine two greys with a sum: add, subtract, multiply, divide, min, max, power … (B is the number when not linked).

Makes: grey · hash `879ba4a3`

| Input | Reads as | Unlinked |
|---|---|---|
| `a` (A) | grey | 0.5, 0.5, 0.5 |
| `b` (B) | grey | 0.5, 0.5, 0.5 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `op` (Sum) | choice | 0 `add`, 1 `sub`, 2 `mul`, 3 `div`, 4 `min`, 5 `max`, 6 `pow`, 7 `diff`, 8 `avg` | `mul` |
| `value` (B (when not linked)) | number | -1 – 4 | `1` |

```glsl
float a = inG_a(uv); float b = h_b > 0.5 ? inG_b(uv) : p_value; int m = int(p_op + 0.5); float r;
if (m == 0) r = a + b; else if (m == 1) r = a - b; else if (m == 2) r = a * b; else if (m == 3) r = a / max(abs(b), 1e-4) * sign(b + 1e-9);
else if (m == 4) r = min(a, b); else if (m == 5) r = max(a, b); else if (m == 6) r = pow(max(a, 0.), b); else if (m == 7) r = abs(a - b); else r = (a + b) * 0.5;
outColor = vec4(vec3(clamp(r, 0., 1.)), 1.);
```

### Height blend — `heightBlend`

Two materials meet by height: the higher one shows (sand between stones, moss in cracks, paint chipping off).

Makes: color · hash `420941fb`

| Input | Reads as | Unlinked |
|---|---|---|
| `top` (Top colour) | color | 1, 1, 1 |
| `heightTop` (Top height) | grey | 0.5, 0.5, 0.5 |
| `bottom` (Bottom colour) | color | 0, 0, 0 |
| `heightBottom` (Bottom height) | grey | 0.5, 0.5, 0.5 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `offset` (Top raised by) | number | -1 – 1 | `0` |
| `contrast` (Hardness) | number | 0 – 1 | `0.85` |
| `out` (Gives) | choice | 0 `colour`, 1 `height`, 2 `mask` | `colour` |

```glsl
float ha = inG_heightTop(uv) + p_offset, hb = inG_heightBottom(uv); float w = (1. - p_contrast) * 0.5 + 0.005;
float m = smoothstep(-w, w, ha - hb);
vec3 r = p_out < 0.5 ? mix(inC_bottom(uv).rgb, inC_top(uv).rgb, m) : p_out < 1.5 ? vec3(clamp(mix(hb, ha, m), 0., 1.)) : vec3(m);
outColor = vec4(r, 1.);
```

### Combine channels — `combineChannels`

Make a colour from three greys as its red, green and blue.

Makes: color · hash `50efb3e7`

| Input | Reads as | Unlinked |
|---|---|---|
| `r` (Red) | grey | 0, 0, 0 |
| `g` (Green) | grey | 0, 0, 0 |
| `b` (Blue) | grey | 0, 0, 0 |

```glsl
outColor = vec4(inG_r(uv), inG_g(uv), inG_b(uv), 1.);
```

### Pick channel — `splitChannel`

One channel of a colour as grey: red, green, blue, or brightness.

Makes: grey · hash `19c4e3b2`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `channel` (Channel) | choice | 0 `r`, 1 `g`, 2 `b`, 3 `l` | `r` |

```glsl
vec3 c = inC_in(uv).rgb; int k = int(p_channel + 0.5);
float v = k == 0 ? c.r : k == 1 ? c.g : k == 2 ? c.b : dot(c, vec3(0.2126, 0.7152, 0.0722));
outColor = vec4(vec3(v), 1.);
```

### Colour to mask — `colorSelect`

White where the picture is close to a colour: pick out one part to treat differently.

Makes: grey · hash `8c112f0e`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `color` (Colour) | color |  | `#808080` |
| `tolerance` (Tolerance) | number | 0 – 1 | `0.2` |
| `softness` (Softness) | number | 0 – 1 | `0.2` |

```glsl
float d = distance(inC_in(uv).rgb, p_color);
outColor = vec4(vec3(1. - smoothstep(p_tolerance, p_tolerance + p_softness * 0.3 + 1e-3, d)), 1.);
```

## Colour

### Gradient map — `gradientMap`

Colour a grey picture: black takes the left colour, white the right.

Makes: color · hash `b0ff3b9e`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `ramp` (Colours) | ramp | 1–8 stops | `[{"at":0,"color":"#1e1a16"},{"at":1,"color":"#e8dcc8"}]` |

```glsl
outColor = vec4(ramp(inG_in(uv), p_ramp_c, p_ramp_t, p_ramp_n), 1.);
```

### Hue, saturation, lightness — `hsl`

Shift the colours round the wheel, make them stronger or greyer, lighter or darker.

Makes: color · hash `b733a909`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `hue` (Hue) | number | -180 – 180 (step 1) | `0` |
| `saturation` (Saturation) | number | 0 – 2 | `1` |
| `lightness` (Lightness) | number | -1 – 1 | `0` |

```glsl
vec3 h = rgb2hsv(inC_in(uv).rgb);
h.x = fract(h.x + p_hue / 360.); h.y = clamp(h.y * p_saturation, 0., 1.);
outColor = vec4(clamp(hsv2rgb(h) + p_lightness, 0., 1.), 1.);
```

### Colourise — `tint`

Tint a picture with one colour.

Makes: color · hash `27cabfba`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | grey | 1, 1, 1 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `color` (Colour) | color |  | `#c08040` |

```glsl
outColor = vec4(p_color * inG_in(uv), 1.);
```

### Replace colour — `replaceColor`

Swap one colour for another (and its near shades).

Makes: color · hash `40dd0feb`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `from` (From) | color |  | `#808080` |
| `to` (To) | color |  | `#c05040` |
| `tolerance` (Tolerance) | number | 0 – 1 | `0.25` |
| `softness` (Softness) | number | 0 – 1 | `0.3` |

```glsl
vec3 c = inC_in(uv).rgb;
float m = 1. - smoothstep(p_tolerance, p_tolerance + p_softness * 0.3 + 1e-3, distance(c, p_from));
outColor = vec4(mix(c, clamp(c + (p_to - p_from), 0., 1.), m), 1.);
```

### Desaturate — `desaturate`

Take the colour out, partly or fully.

Makes: color · hash `55f322e3`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `amount` (Amount) | number | 0 – 1 | `1` |

```glsl
vec3 c = inC_in(uv).rgb; outColor = vec4(mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), p_amount), 1.);
```

### Colour variation — `colorVariation`

Break up a flat colour with large, soft shifts in brightness and hue.

Makes: color · hash `f4583232`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0.6, 0.6, 0.6 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `amount` (Brightness) | number | 0 – 1 | `0.3` |
| `hue` (Hue) | number | 0 – 0.5 | `0.05` |
| `scale` (Size) | int | 1 – 32 | `4` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float n = fbm(uv, p_scale, 4., 0.5, 0., p_seed) - 0.5; float n2 = fbm(uv, p_scale, 4., 0.5, 0., p_seed + 9.) - 0.5;
vec3 h = rgb2hsv(inC_in(uv).rgb); h.x = fract(h.x + n2 * p_hue * 2.); h.z = clamp(h.z * (1. + n * p_amount * 2.), 0., 1.);
outColor = vec4(hsv2rgb(h), 1.);
```

### Warm or cool — `temperature`

Shift the colours warmer (orange) or cooler (blue), and greener or pinker.

Makes: color · hash `e6f8a4ca`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (In) | color | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `warmth` (Warmth) | number | -1 – 1 | `0.2` |
| `tint` (Green–pink) | number | -1 – 1 | `0` |

```glsl
vec3 c = inC_in(uv).rgb; c.r += p_warmth * 0.12; c.b -= p_warmth * 0.12; c.g -= p_tint * 0.1; c.rb += p_tint * 0.04;
outColor = vec4(clamp(c, 0., 1.), 1.);
```

## Surface

### Height to normal — `normal`

Bumps for lighting from a height picture (white is high).

Makes: color · hash `6be334fa`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Height) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `strength` (Strength) | number | 0 – 10 | `2` |

```glsl
float e = u_px;
float dx = (inG_in(uv + vec2(e, 0.)) - inG_in(uv - vec2(e, 0.))) / (2. * e);
float dy = (inG_in(uv + vec2(0., e)) - inG_in(uv - vec2(0., e))) / (2. * e);
vec3 n = normalize(vec3(-dx * p_strength * 0.02, -dy * p_strength * 0.02, 1.));
outColor = vec4(n * 0.5 + 0.5, 1.);
```

### Height to occlusion — `occlusion`

Dark in the dips and cracks, where light hardly reaches.

Makes: grey · hash `05ae9673`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Height) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `radius` (Radius) | number | 0.002 – 0.1 (step 0.001) | `0.02` |
| `strength` (Strength) | number | 0 – 4 | `1.5` |

```glsl
float h = inG_in(uv); float s = 0., w = 0.;
for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { vec2 o = vec2(x, y) / 2.; float k = exp(-dot(o, o)); s += inG_in(uv + o * p_radius) * k; w += k; }
outColor = vec4(vec3(clamp(1. - max(s / w - h, 0.) * p_strength * 4., 0., 1.)), 1.);
```

### Height to curvature — `curvature`

Light on ridges and edges, dark in grooves (grey where flat): for wear and dirt masks.

Makes: grey · hash `5f8328d8`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Height) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `radius` (Radius) | number | 0.001 – 0.05 (step 0.001) | `0.005` |
| `strength` (Strength) | number | 0 – 10 | `3` |

```glsl
float h = inG_in(uv); float r = p_radius;
float lap = 4. * h - inG_in(uv + vec2(r, 0.)) - inG_in(uv - vec2(r, 0.)) - inG_in(uv + vec2(0., r)) - inG_in(uv - vec2(0., r));
outColor = vec4(vec3(clamp(0.5 + lap * p_strength, 0., 1.)), 1.);
```

### Combine normals — `normalBlend`

Lay fine detail bumps over a base normal map (both from Height to normal).

Makes: color · hash `b203840a`

| Input | Reads as | Unlinked |
|---|---|---|
| `base` (Base) | color | 0.5, 0.5, 1 |
| `detail` (Detail) | color | 0.5, 0.5, 1 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `strength` (Detail strength) | number | 0 – 2 | `1` |

```glsl
vec3 a = inC_base(uv).rgb * 2. - 1.; vec3 b = inC_detail(uv).rgb * 2. - 1.; b.xy *= p_strength;
outColor = vec4(normalize(vec3(a.xy + b.xy, max(a.z * b.z, 1e-3))) * 0.5 + 0.5, 1.);
```

### Adjust normals — `normalAdjust`

Make bumps stronger or flatter, or flip them (for maps made the other way up).

Makes: color · hash `afcfadf8`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Normal) | color | 0.5, 0.5, 1 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `strength` (Strength) | number | 0 – 4 | `1` |
| `flip` (Flip green) | bool |  | `false` |

```glsl
vec3 n = inC_in(uv).rgb * 2. - 1.; n.xy *= p_strength; if (p_flip > 0.5) n.y = -n.y;
outColor = vec4(normalize(vec3(n.xy, max(n.z, 1e-3))) * 0.5 + 0.5, 1.);
```

### Edge wear — `edgeWear`

A mask of worn edges from a height picture, broken up with noise: paint chipped off corners.

Makes: grey · hash `16124dcc`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Height) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `amount` (Amount) | number | 0 – 1 | `0.5` |
| `breakup` (Breakup) | number | 0 – 1 | `0.5` |
| `scale` (Noise size) | int | 1 – 64 | `12` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float h = inG_in(uv); float r = 0.004;
float lap = 4. * h - inG_in(uv + vec2(r, 0.)) - inG_in(uv - vec2(r, 0.)) - inG_in(uv + vec2(0., r)) - inG_in(uv - vec2(0., r));
float edge = clamp(lap * 40., 0., 1.); float n = fbm(uv, p_scale, 5., 0.6, 0., p_seed);
float v = edge * mix(1., n * 1.6, p_breakup);
outColor = vec4(vec3(smoothstep(1. - p_amount, 1. - p_amount + 0.15, v)), 1.);
```

### Dirt — `dirt`

A mask of dirt gathering in the dips of a height picture, spread a little with noise.

Makes: grey · hash `1778ff5d`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Height) | grey | 0, 0, 0 |

| Setting | Kind | Range | Default |
|---|---|---|---|
| `amount` (Amount) | number | 0 – 1 | `0.4` |
| `scale` (Noise size) | int | 1 – 32 | `6` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float h = inG_in(uv); float s = 0., w = 0.;
for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { vec2 o = vec2(x, y) / 2.; float k = exp(-dot(o, o)); s += inG_in(uv + o * 0.03) * k; w += k; }
float cav = clamp((s / w - h) * 8., 0., 1.); float n = fbm(uv, p_scale, 5., 0.55, 0., p_seed);
outColor = vec4(vec3(clamp(cav * 1.5 + (n - 1. + p_amount) * 1.5, 0., 1.)), 1.);
```

### Drips and streaks — `drips`

Thin streaks running down, thinning as they go: rain stains, rust runs, leaks.

Makes: grey · hash `251095ef`

| Setting | Kind | Range | Default |
|---|---|---|---|
| `count` (Lanes) | int | 4 – 128 | `32` |
| `amount` (Amount) | number | 0 – 1 | `0.5` |
| `length` (Length) | number | 0.05 – 1 | `0.5` |
| `seed` (Seed) | seed | any whole number | `0` |

```glsl
float col = floor(uv.x * p_count); vec2 o = seedv(p_seed); float cm = mod(col, p_count);
float has = step(1. - p_amount, hash12(vec2(cm, 1.) + o));
float start = hash12(vec2(cm, 2.) + o); float len = p_length * (0.3 + 0.7 * hash12(vec2(cm, 3.) + o));
float y = fract(uv.y - start); float t = clamp(y / max(len, 1e-3), 0., 1.);
float fx = fract(uv.x * p_count) - 0.5; float wd = 0.35 * (1. - t) + 0.02;
float v = has * step(y, len) * (1. - smoothstep(wd * 0.6, wd, abs(fx))) * (1. - t);
outColor = vec4(vec3(v), 1.);
```

## Output

### Colour — `outColor`

The material’s colour.

Makes: nothing (output node: the material's `color` map) · hash `8b3d7a05`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Colour) | color | 0.7, 0.7, 0.7 |

```glsl
outColor = vec4(inC_in(uv).rgb, 1.);
```

### Height — `outHeight`

How high each spot is (white high): bumps when there is no normal map.

Makes: nothing (output node: the material's `height` map) · hash `f07eeb40`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Height) | grey | 0.5, 0.5, 0.5 |

```glsl
float v = inG_in(uv); outColor = vec4(vec3(v), 1.);
```

### Normal — `outNormal`

Bumps for lighting (from Height to normal).

Makes: nothing (output node: the material's `normal` map) · hash `d1e74c57`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Normal) | color | 0.5, 0.5, 1 |

```glsl
outColor = vec4(inC_in(uv).rgb, 1.);
```

### Roughness — `outRoughness`

White is matte, black mirror-smooth.

Makes: nothing (output node: the material's `roughness` map) · hash `b65cc607`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Roughness) | grey | 0.8, 0.8, 0.8 |

```glsl
float v = inG_in(uv); outColor = vec4(vec3(v), 1.);
```

### Metal — `outMetal`

White where it is metal.

Makes: nothing (output node: the material's `metalness` map) · hash `b7eb8fdf`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Metal) | grey | 0, 0, 0 |

```glsl
float v = inG_in(uv); outColor = vec4(vec3(v), 1.);
```

### Occlusion — `outOcclusion`

Dark where little light gets in (cracks, dips).

Makes: nothing (output node: the material's `occlusion` map) · hash `b88aca60`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Occlusion) | grey | 1, 1, 1 |

```glsl
float v = inG_in(uv); outColor = vec4(vec3(v), 1.);
```

### Glow — `outGlow`

Where it glows, and in what colour (black: no glow).

Makes: nothing (output node: the material's `glow` map) · hash `8698166a`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Glow) | color | 0, 0, 0 |

```glsl
outColor = vec4(inC_in(uv).rgb, 1.);
```

### Opacity — `outOpacity`

Black is see-through (cut out), white solid.

Makes: nothing (output node: the material's `opacity` map) · hash `b88aca60`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Opacity) | grey | 1, 1, 1 |

```glsl
float v = inG_in(uv); outColor = vec4(vec3(v), 1.);
```

### Wear colour — `outWearColor`

The wear layer’s colour (bare metal under paint, dust): shown on edges, in creases or on top, as the material’s Wear settings say.

Makes: nothing (output node: the material's `wearColor` map) · hash `56efa4fc`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Wear colour) | color | 0.6, 0.6, 0.6 |

```glsl
outColor = vec4(inC_in(uv).rgb, 1.);
```

### Wear roughness — `outWearRoughness`

The wear layer’s roughness (white matte).

Makes: nothing (output node: the material's `wearRoughness` map) · hash `174b988b`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Wear roughness) | grey | 0.35, 0.35, 0.35 |

```glsl
float v = inG_in(uv); outColor = vec4(vec3(v), 1.);
```

### Wear metal — `outWearMetal`

Where the wear layer is metal (white).

Makes: nothing (output node: the material's `wearMetal` map) · hash `b88aca60`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Wear metal) | grey | 1, 1, 1 |

```glsl
float v = inG_in(uv); outColor = vec4(vec3(v), 1.);
```

### Wear noise — `outWearNoise`

Breaks the wear up: where it is white, wear shows sooner (a grunge works well).

Makes: nothing (output node: the material's `wearNoise` map) · hash `f07eeb40`

| Input | Reads as | Unlinked |
|---|---|---|
| `in` (Wear noise) | grey | 0.5, 0.5, 0.5 |

```glsl
float v = inG_in(uv); outColor = vec4(vec3(v), 1.);
```
