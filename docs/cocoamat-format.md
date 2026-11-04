# The CocoaSuite material file (`.cocoamat`), version 1.0

**Status: implemented in CocoaWorlds 0.1.0** (writer, reader, import and bitmap export:
`packages/materials/src/cocoamat.ts`, `zip.ts`; `apps/editor/src/renderer/materials/export.ts`). This document is the contract
between CocoaWorlds (writes it now, may read it later) and CocoaSurface (reads it natively, and may write it).

**A `.cocoamat` file is an editable material graph.** It holds the node graph made in CocoaWorlds' Materials
workspace, the settings the graph exposes (so CocoaSurface can show them as the material's parameters and
change them), the material's own settings, and the definition of every node it uses. With those, CocoaSurface
evaluates the graph itself, at any size and with any parameter values, and gets the same maps CocoaWorlds would.
Baked images are only an optional extra in the file, for previews and for readers that can't evaluate graphs.

Companion files (written from the code, checked by a test, never edited by hand):

- [`cocoamat/nodes.md`](cocoamat/nodes.md): every node for people (inputs, settings with ranges and defaults,
  and its GLSL).
- [`cocoamat/nodes.json`](cocoamat/nodes.json): the same as data, with the shared GLSL library (the *node
  catalog*, section 5). This is what a reader's code uses.

## 1. Container

- A ZIP file (PKWARE APPNOTE 6.3), no encryption, no multi-disk, no ZIP64. File names are UTF-8 (flag bit 11),
  `/`-separated, with no leading `/`, no `..`, no `\`.
- Entries are stored (method 0) or deflated (method 8). Images are stored, and JSON is deflated.
- **The first entry is `mimetype`**, stored, with no extra field, holding exactly the 39 ASCII bytes
  `application/vnd.cocoasuite.material+zip` (no newline). The file is recognised without a ZIP library: bytes
  0–3 are `PK\x03\x04`, bytes 30–37 are `mimetype`, and bytes 38–76 are the type string.
- Other entries can be in any order. A reader finds them through the central directory and ignores entries it
  doesn't know.

| Entry | Required | What |
|---|---|---|
| `mimetype` | yes | See above. |
| `material.json` | yes | The manifest: material settings, the exposed parameters and their values (section 2). |
| `graph.json` | yes | The node graph (section 3). |
| `nodes.json` | yes | The definition of every node type the graph uses, and the shared GLSL library: a node catalog (section 5) cut down to those types. It makes the file evaluable on its own, even by a reader older than the file. |
| `images/<name>` | if used | Images read by the graph's Image nodes, PNG or JPEG. |
| `baked/<role>.png` | no | The maps as evaluated with the values in the manifest, at `evaluation.size` (section 7). Derived data: stale as soon as a parameter changes. |
| `preview.png` | no | 256 × 256, the material on a sphere, for file browsers and pickers. |

## 2. The manifest (`material.json`)

```json
{
  "format": "cocoasuite.material",
  "version": "1.0",
  "generator": "CocoaWorlds 0.1.0",
  "created": "2026-11-04T12:00:00Z",
  "id": "mat/k3f9a0z2m1q8x7c4",
  "name": "Red bricks",
  "folder": "Walls/Brick",
  "units": { "perMetre": 39.37 },
  "tiling": { "worldSize": 128, "mapping": "face" },
  "evaluation": { "size": 1024 },
  "parameters": [
    { "id": "x7k2m9qa", "label": "Brick colour", "node": "b3n81xq0", "param": "color",
      "kind": "color", "default": "#8a4a32", "value": "#a0522d" },
    { "id": "p0d4hh2r", "label": "Rows", "node": "k1z0w2e5", "param": "rows",
      "kind": "int", "min": 1, "max": 64, "default": 10, "value": 12 },
    { "id": "f8s1ne0v", "label": "Stagger", "node": "k1z0w2e5", "param": "offset",
      "kind": "number", "min": 0, "max": 1, "default": 0.5, "value": 0.25 }
  ],
  "surface": {
    "color": "#b4b4b4", "roughness": 0.8, "metalness": 0,
    "normalStrength": 1, "emissive": "#000000", "emissiveStrength": 0,
    "opacity": 1, "cutout": true, "doubleSided": false, "scroll": [0, 0]
  },
  "normalGreen": "down",
  "wear": null,
  "glass": null,
  "blend": null,
  "bevel": 0
}
```

General rules:

- **`format`** is `"cocoasuite.material"`. **`version`** is `"major.minor"`. A reader takes any file with its
  major version: it ignores fields it doesn't know, and minor versions only add optional fields whose defaults
  look the same as before. It refuses a higher major version, saying so.
- Missing optional fields take the defaults below. Out-of-range numbers are clamped.
- Colours in the manifest are `"#rrggbb"`, sRGB-encoded, as a colour picker shows them.
- **A program that rewrites a file** (CocoaSurface saving after a change) keeps every top-level field and every
  `extensions` entry it doesn't understand, unchanged. Private data goes under
  `"extensions": { "<app>": { … } }`, for example `"extensions": { "cocoasurface": { … } }`.

### Material

| Field | Type | Default | Meaning |
|---|---|---|---|
| `generator` | string | — | Who wrote it (for bug reports). |
| `created` | string | — | ISO 8601, UTC. |
| `id` | string | — | The material's id where it came from (`mat/` + 16 of `[0-9a-z]`). An importer seeing a known id can offer to replace rather than duplicate. |
| `name` | string | required | Shown to people. |
| `folder` | string | `""` | Where it's listed, `/`-separated. |
| `units.perMetre` | number | `39.37` | World units in a metre (CocoaWorlds units are inches). Every length in the file uses these units. |
| `tiling.worldSize` | number > 0 | `128` | How many units of the world one repeat of the maps covers (128 u = 3.25 m). The maps are square repeats. |
| `tiling.mapping` | `face` \| `world` \| `object` | `face` | How CocoaWorlds lays the maps on: texture coordinates, or triplanar from the world or from the object. A hint for CocoaSurface's own default. |
| `evaluation.size` | 256–4096, power of two | `512` | The size CocoaWorlds evaluates (bakes) the graph at. A reader may evaluate at any size, but some nodes depend on it (section 5.4). |
| `normalGreen` | `down` \| `up` | `down` | Which way the green channel of the graph's **Normal** output points (section 6). |

### Exposed parameters (`parameters`)

The settings the graph's author exposed (◇ in CocoaWorlds), in the order they're listed. CocoaSurface shows
them as the material's parameters. Changing one changes that node setting, and the graph is evaluated again.

| Field | Meaning |
|---|---|
| `id` | The exposed setting's id (as in `graph.json`'s `exposed`). Unique in the file. |
| `label` | What to call it (the author's words). |
| `node`, `param` | The node (by id in `graph.json`) and which of its settings. |
| `kind` | `number`, `int`, `seed`, `choice`, `color`, `bool`, `ramp` or `image`: copied from the node's definition, so a reader can build the control without the catalog. |
| `min`, `max`, `step` | For `number` and `int` (`step` is optional), copied from the node's definition. |
| `options` | For `choice`: the allowed values in order. |
| `default` | The graph's own value for the setting (what ↺ goes back to). |
| `value` | This material's value. Missing: `default`. |

Values by kind: `number` is a JSON number; `int` and `seed` are whole numbers; `choice` is one of `options`
(a string); `color` is `"#rrggbb"`; `bool` is `true`/`false`; `ramp` is
`[{ "at": 0–1, "color": "#rrggbb" }, …]` (1–8 stops); `image` is a path inside the file (`"images/…"`) or
`""` for none.

**To evaluate the material:** take `graph.json` and, for each parameter, put `value` into node `node`'s
setting `param`. Then evaluate (section 5). This is exactly what CocoaWorlds does for a material's own values
(`withOverrides`, `packages/materials/src/graph.ts`).

CocoaSurface may let people change which settings are exposed, or edit the graph itself. When it saves, it
writes `graph.json`'s `exposed` and the manifest's `parameters` so that they agree, and recomputes `default`
from the graph.

### Surface settings (`surface`) and the rest

These belong to the material, not the graph. They say how the maps are used when the material is drawn.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `surface.color` | colour | `#b4b4b4` | Base colour **when the graph has no Colour output**. Otherwise the output is the colour. |
| `surface.roughness` | 0–1 | `0.8` | Used when the graph has no Roughness output. |
| `surface.metalness` | 0–1 | `0` | Used when the graph has no Metal output. |
| `surface.normalStrength` | 0–2 | `1` | Scales the normal's X and Y before normalising. |
| `surface.emissive` | colour | `#000000` | Glow colour: multiplies the Glow output, or is the glow when there is no Glow output (then it covers the whole surface). |
| `surface.emissiveStrength` | 0–10 | `0` | Glow brightness. |
| `surface.opacity` | 0–1 | `1` | Multiplies the Opacity output. |
| `surface.cutout` | bool | `true` | With an Opacity output: on means pixels under 0.5 are cut out and the rest drawn solid; off means it fades (blends). |
| `surface.doubleSided` | bool | `false` | Draw back faces too. |
| `surface.scroll` | [n, n] | `[0, 0]` | The maps move across the surface, units per second, [across, up]. |
| `wear` | object \| null | `null` | Section 8. |
| `glass` | object \| null | `null` | `{ "transmission": 0–1, "ior": 1–2.5 (1.5), "thickness": units (8) }`. |
| `blend` | object \| null | `null` | `{ "distance": units, "noise": 0–1, "noiseSize": units }`: fades into what it stands in. May be ignored. |
| `bevel` | number | `0` | CocoaWorlds brush edges look rounded by this many units. May be ignored. |

## 3. The graph (`graph.json`)

The same JSON as a CocoaWorlds `.cwmat` file (`packages/materials/src/graph.ts`), with image paths rewritten to
point inside the `.cocoamat`:

```json
{
  "format": "cocoaworlds.material",
  "version": 1,
  "nodes": [
    { "id": "k1z0w2e5", "type": "bricks", "x": 0, "y": 0, "params": { "rows": 10 } },
    { "id": "b3n81xq0", "type": "tint", "x": 220, "y": 0, "params": { "color": "#8a4a32" } },
    { "id": "o9w1m2c3", "type": "outColor", "x": 440, "y": 0, "params": {} }
  ],
  "links": [
    { "from": "k1z0w2e5", "to": "b3n81xq0", "input": "in" },
    { "from": "b3n81xq0", "to": "o9w1m2c3", "input": "in" }
  ],
  "exposed": [
    { "id": "x7k2m9qa", "node": "b3n81xq0", "param": "color", "label": "Brick colour" },
    { "id": "p0d4hh2r", "node": "k1z0w2e5", "param": "rows", "label": "Rows" },
    { "id": "f8s1ne0v", "node": "k1z0w2e5", "param": "offset", "label": "Stagger" }
  ]
}
```

- **`nodes`**: `id` is unique in the graph (CocoaWorlds makes 8 characters of `[a-z0-9]`; a reader accepts any
  non-empty string). `type` names a node in `nodes.json`. `x` and `y` are where the node sits in a graph
  editor, in pixels, for CocoaSurface's own graph view. **`params` holds only settings that differ from the
  node's default.** A missing setting means the default from `nodes.json`.
- **`links`**: from a node's output to input `input` of node `to`. Every node has at most one output, and an
  input takes at most one link. The graph has no loops.
- **`exposed`**: see section 2. The manifest's `parameters` carries the same list with kinds, ranges and values.
- Image settings (`kind: image`) hold `"images/<name>"` (a file in the `.cocoamat`) or `""`. In a CocoaWorlds
  project they hold `assets/textures/…`. The exporter copies each image into `images/` and rewrites the path.
- **Output nodes** (group `output`: `outColor`, `outHeight` … in the catalog, each with a `role`) say which map of
  the material they make. **The first output node of each role in `nodes` order that has a link into it** makes
  that map. Others, and output nodes with nothing linked, make nothing (`outputNodes`).

A reader refuses a graph that breaks these rules: an unknown node type not in `nodes.json`, a setting of the
wrong kind, a link to a missing node or input, two links into one input, or a loop.

## 4. Map roles and what they mean

| Role (output node) | Picture | What a pixel means when drawing |
|---|---|---|
| `color` (`outColor`) | colour, sRGB values | Base colour. |
| `normal` (`outNormal`) | colour, data | Tangent-space normal, `n = rgb × 2 − 1`; axes in section 6. |
| `height` (`outHeight`) | grey, data | 0 low, 1 high. Used for bumps **only when there is no Normal output**. |
| `roughness` (`outRoughness`) | grey, data | 1 matte, 0 smooth. |
| `metalness` (`outMetal`) | grey, data | 1 metal. |
| `occlusion` (`outOcclusion`) | grey, data | 0 shaded, 1 open; applies to ambient and indirect light only. |
| `glow` (`outGlow`) | colour, sRGB values | Where it glows and in what colour. |
| `opacity` (`outOpacity`) | grey, data | 0 see-through or cut out, 1 solid. |
| `wearColor`, `wearRoughness`, `wearMetal`, `wearNoise` | as named | The wear layer's look (section 8). |

Shading is metallic-roughness PBR, as glTF 2.0. Colour pictures are sRGB-encoded: convert to linear when
sampling for lighting. Grey and normal pictures are used as they are.

## 5. Evaluating a graph

This is how CocoaWorlds evaluates (`packages/materials/src/gpu.ts`, `shader.ts`). A reader that does the same
gets the same pictures, up to floating-point differences between graphics cards.

### 5.1 The node catalog

`nodes.json` (in the file), like `docs/cocoamat/nodes.json` (all nodes), is:

```json
{ "format": "cocoasuite.material-nodes", "version": 1,
  "graph": { "format": "cocoaworlds.material", "version": 1 },
  "library": "<GLSL ES 3.00 shared functions>",
  "vertexShader": "<GLSL ES 3.00>",
  "nodes": [ { "type": "noise", "group": "make", "label": {"en": "Noise", "ru": "Шум"}, "hint": {…},
               "inputs": [], "output": "grey",
               "params": [ { "id": "kind", "kind": "choice", "options": [ {"value": "perlin", …}, … ], "default": "perlin" },
                           { "id": "scale", "kind": "int", "min": 1, "max": 64, "default": 4 }, … ],
               "glsl": "outColor = vec4(vec3(fbm(uv, p_scale, p_octaves, p_roughness, p_kind, p_seed)), 1.);",
               "hash": "51f0fd0e" }, … ] }
```

**A node's `glsl` body is the normative definition of what it does.** Each node is one fragment program. A
reader either runs the programs as they are (GLSL ES 3.00 on OpenGL ES 3 or WebGL 2, or translated for Metal,
Vulkan or D3D: glslang to SPIR-V to SPIRV-Cross), or implements nodes natively. If it implements them natively, it
checks `hash` (section 5.6) to know its version still matches the file's. It must then make the same pictures.

### 5.2 One node's program

For node type `T` with definition `D`, the fragment program is exactly (`fragmentShader`):

```glsl
#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
<library>
uniform float u_px;
// for each setting p in D.params, in order:
//   number, int, seed, choice, bool: uniform float p_<id>;
//   color:                          uniform vec3 p_<id>;
//   ramp:                           uniform vec3 p_<id>_c[8]; uniform float p_<id>_t[8]; uniform float p_<id>_n;
//   image:                          uniform sampler2D p_<id>; uniform float p_<id>_ok;
// for each input i in D.inputs, in order:
uniform sampler2D i_<id>;
uniform float h_<id>;
vec4 inC_<id>(vec2 uv) { return h_<id> > 0.5 ? texture(i_<id>, uv) : vec4(<fallback r, g, b to 4 decimals>, 1.); }
float inG_<id>(vec2 uv) { return dot(inC_<id>(uv).rgb, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec2 uv = vUv;
  <D.glsl, each line indented by two spaces>
}
```

The vertex program (`vertexShader`) draws one square over the whole target: `vUv = a_pos × 0.5 + 0.5` for
`a_pos` in −1…1.

### 5.3 Setting values become uniforms (`uniformsFor`)

The setting's value is the node's `params` entry, else the parameter's `value` if it's exposed, else the
catalog default. (Exposed values are applied before evaluation, section 2.)

| Kind | Uniform value |
|---|---|
| `number` | The number. |
| `int`, `seed` | Rounded to the nearest whole number (as a float). |
| `choice` | **The index** of the value in the catalog's `options` (0, 1, 2 …), as a float; −1 is clamped to 0. Option order is part of a node's definition and never changes within a catalog version. |
| `bool` | 1.0 or 0.0. |
| `color` | `#rrggbb` as `(r, g, b) / 255`. **No sRGB-to-linear conversion**: graphs work on sRGB-encoded values, the way colour pickers show them. |
| `ramp` | Stops sorted by `at`, at most 8. `_c[k]` is stop k's colour as above, and `_t[k]` its `at`. For k past the last stop, `_c[k]` repeats the last stop's colour and `_t[k] = 2.0`. `_n` is the number of stops. |
| `image` | The image as a texture: RGBA, 8 bits, its bytes as they are (no colour conversion), **first row of the file at v = 0**, repeat wrapping, linear filtering, no mip-maps. `_ok = 1`. With no image, or one that couldn't be read: a 1 × 1 black texture and `_ok = 0`. |

`u_px = 1 / N`, where N is the picture size (5.4).

### 5.4 Pictures, order, inputs

- Every node draws one **N × N** picture, where N is the evaluation size (`evaluation.size` to match CocoaWorlds'
  baked maps). Some nodes depend on N, because they step by `u_px`.
- **Pixel (column i, row j), with row 0 the top of the picture, is evaluated at `uv = ((i + 0.5) / N,
  (j + 0.5) / N)`.** So v goes **down** the picture, and row 0 is the first row of an image file made from it.
- Intermediate pictures are **RGBA 16-bit float** and are **not clamped**: values can fall outside 0–1 between
  nodes. (CocoaWorlds falls back to 8-bit, clamped, only on cards without float targets. Readers should use 16-
  or 32-bit float.)
- An input reads the linked node's picture with `texture()`: **repeat wrapping, bilinear filtering, no
  mip-maps**. So a node reading at `uv + offset` wraps round the edges, which is why everything tiles. An input
  with no link reads its `fallback` colour (`inC`), and `h_<id>` is 0.
- Evaluate in an order where every node comes after the nodes feeding it (`evaluationOrder`). Only nodes that
  feed an output node need evaluating.
- **A map is its output node's picture, clamped to 0–1.** Written as an image, it's quantised to 8 bits
  (`round(v × 255)`), first row first. Grey outputs write the same value to R, G and B.

### 5.5 Matching CocoaWorlds (tolerance)

Graphs run on the graphics card, and the noise hashes use float maths, so another card, driver or API can give
slightly different pictures. A reader matches CocoaWorlds when, for every map, evaluated at the same size and
written as 8-bit (5.4), compared with CocoaWorlds' map channel by channel (R, G, B):

- the **mean** absolute difference is **under 1/255**, and
- the **largest** difference is **under 8/255**.

**Conformance samples** are in [`cocoamat/samples/`](cocoamat/samples/): small `.cocoamat` files (`stone`: the
default graph; `bricks`: exposed colour, rows and stagger with values set; `image`: an Image node with its
picture in the file), each beside its maps as CocoaWorlds evaluates them at 256 px, `<name>_<role>.png`. Evaluate
each file at 256 and compare within the tolerance. (`apps/editor/test-e2e/cocoamat-samples.test.mjs` does this
for CocoaWorlds itself, and writes them afresh with `CW_WRITE_SAMPLES=1`.)

### 5.6 Node identity across versions

`hash` is FNV-1a (32-bit, written as 8 lowercase hex digits) of the node's whole fragment program from 5.2,
encoded as UTF-8. Same `type` and same `hash` means it does the same thing. When CocoaWorlds changes what a
node does, its hash changes.

- A reader with a native version of a node whose hash matches uses it.
- Otherwise it uses the file's `nodes.json` program for that node (preferred), or warns that the node may look
  different.
- The file's `nodes.json` wins over any catalog the reader carries. A file is always evaluated by its own
  definitions.

`docs/cocoamat/nodes.json` in this repository always matches the current CocoaWorlds. It's kept current by
`packages/materials/test/catalog.test.ts`.

## 6. Normal maps: axes

Tangent space: blue out of the surface, red along +u (to the right of the picture), green along the picture's
vertical. With `normalGreen: "down"` (CocoaWorlds 1.0), green points down the picture, towards row N − 1
(DirectX style, "Y−"). With `"up"`, green points towards row 0 (OpenGL style: Blender, glTF). A reader that
shades the other way uses `g' = 1 − g`.

Evidence: *Height to normal* makes `n = normalize(−dH/du · s, −dH/dv · s, 1)`, and v goes down the picture
(5.4). CocoaWorlds' triplanar shading reads green along the picture's down (`viewport/triplanar.ts`, `NORMALS`).
**Confirmed by a test** (`cocoamat-samples.test.mjs`: one soft bump; above its middle green < 0.5, below it > 0.5;
left of it red < 0.5). The field exists so a wrong guess is never silent. Nodes such as *Adjust normals* (flip green) work on
the graph's own convention.

## 7. Baked maps (optional)

`baked/<role>.png`: the map of each role the graph makes, evaluated with the manifest's values at
`evaluation.size`. They're PNG, 8-bit, greyscale for grey roles (colour type 0), RGB otherwise, first row at the
top, tiling. They're there for previews, quick loading, and readers without a graph evaluator. When a parameter
changes they're stale: a reader that evaluates graphs throws them away and evaluates again, and a writer either
writes fresh ones or leaves them out (never stale ones). The manifest lists what's there:
`"baked": { "size": 1024, "roles": ["color", "normal", "roughness"] }` (missing: none).

## 8. Wear

`"wear": { "edge": 0–1, "crease": 0–1, "up": 0–1, "width": units 0–32, "noise": 0–1, "color": colour,
"roughness": 0–1, "metalness": 0–1 }`, or `null`. It's a second look laid over the first where the geometry
says so. The amount `m` (`viewport/triplanar.ts`, `wearMask`):

```
w    = max(width, 0.001)
raw  = max(edge   * (1 − smoothstep(0, w, distanceToOuterEdge)),
           crease * (1 − smoothstep(0, w, distanceToCrease)),
           up     * smoothstep(0.55, 0.95, worldNormal.y))             // +Y is up
nz   = wearNoise map (laid triplanar) if the graph makes one, else 1 − smooth 3D value noise of worldPos / max(w·1.5, 1)
m    = smoothstep(0.35, 0.65, raw + (nz − 0.5) · noise · 1.6)
```

Distances are in units across the face. Without edge data, CocoaWorlds estimates them from curvature
`k = (dN/dx·dP/dx + dN/dy·dP/dy) / (|dP/dx|² + |dP/dy|²)`: edges `clamp(k·w·4)`, creases `clamp(−k·w·4)`.
Then colour = mix(base, `wear.color` × wearColor map (white when absent), m). Roughness and metalness =
mix(base, the wear map if present else `wear.roughness` / `wear.metalness`, m). Wear maps are always laid
triplanar.

White in the Wear noise map makes wear show **sooner**, as the node says. (Before CocoaWorlds 0.1.0's export, it
was subtracted; the made-up noise is turned over so materials without the map look as they did.)

## 9. Reading, step by step

1. Check the signature (section 1). Read `material.json`, then check `format` and the major `version`.
2. Read `nodes.json` and `graph.json`, then validate the graph (section 3).
3. Fill in defaults, clamp values, and apply `parameters[].value` to the graph's settings.
4. Load `images/` for Image nodes.
5. Evaluate at the size you need (section 5) to get one picture per role.
6. Shade (sections 2, 4, 6, 8), sizing the repeat from `tiling.worldSize` and `units.perMetre`.

A broken file is refused as a whole, with the reason: missing or wrong `mimetype`, missing manifest, graph or
nodes, bad JSON, wrong format, higher major version, an invalid graph, a missing image, or a path with `..`.
Never use half a material silently.

## 10. Bitmap export (no container)

For tools outside CocoaSuite, CocoaWorlds also exports a material as plain images. The graph is evaluated with
the material's values, and each map is written as `<name>_<role>.png` into a chosen folder (with characters
not allowed in file names made `_`), plus `<name>.material.json` (the manifest, for reference). Options:

- **Size**: 256 / 512 / 1024 / 2048 (4096 where the card allows). The graph is evaluated at that size.
- **Normal green**: down (CocoaWorlds, DirectX style) or up (OpenGL style). The manifest's `normalGreen` says
  which was chosen. (Only a graph's own Normal output is flipped; an image material's normal map is copied as
  it is.)
- **Pack occlusion, roughness, metal** into `<name>_orm.png` (R, G, B), as glTF and Unreal expect. A missing map
  is filled from the material's values (occlusion 1).
- **Which maps**: all the graph makes (default), or a chosen set.

Image materials (not made from a graph) export as images only, their images redrawn at the chosen size.
There's no graph to put in a `.cocoamat`.

## 11. Changing the format

- Adding an optional field, an optional entry or a node type is a minor version. A node type is self-described
  in `nodes.json`, so old readers can still evaluate it if they run GLSL.
- Changing what a field means, or making something required, is a major version.
- Changing a node's program changes its `hash`. Files keep their own definition, so old files still look
  the same.
- Update this document, the catalog (regenerate it) and the sample files in the same change.
