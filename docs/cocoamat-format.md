# The CocoaSuite material file (`.cocoamat`), version 1.0

**Status: draft, not implemented yet** (see [HANDOFF.md](HANDOFF.md), task 5). This document is the contract
between CocoaWorlds (writes it) and CocoaSurface (reads it natively). Anything a reader needs to draw the
material the way CocoaWorlds draws it is here. Where CocoaWorlds' code is the source of a rule, the file is
named so the rule can be checked.

A `.cocoamat` file is one material: its settings, its maps as images, and optionally the graph it was made
from (so another CocoaSuite app could edit it again later). It is a ZIP archive with a fixed layout, in the
manner of OpenDocument and EPUB.

## 1. Container

- A ZIP file (PKWARE APPNOTE 6.3), no encryption, no multi-disk, no ZIP64 (a material is far below 4 GB; a
  reader may refuse ZIP64). File names are UTF-8 (general-purpose flag bit 11 set), with `/` as the separator,
  no leading `/`, no `..`, no `\`.
- Entries are **stored** (method 0) or **deflated** (method 8). PNGs are stored (they're compressed already),
  and JSON is deflated.
- **The first entry is `mimetype`**, stored (method 0), no extra field, holding exactly the ASCII bytes
  `application/vnd.cocoasuite.material+zip` (no newline). So the file can be recognised without a ZIP library:
  bytes 0–3 are `PK\x03\x04`, the name `mimetype` takes bytes 30–37, and the 39-byte type string takes bytes 38–76 (the entry has no extra field).
- Other entries can be in any order. A reader finds them by name through the central directory and **ignores
  entries it doesn't know**.

| Entry | Required | What |
|---|---|---|
| `mimetype` | yes | See above. |
| `material.json` | yes | The manifest (section 2), UTF-8 JSON, no BOM. |
| `maps/<role>.png` | per the manifest | One image per map (section 3). |
| `preview.png` | no | A 256 × 256 picture of the material on a sphere, for file browsers and pickers. |
| `source/graph.cwmat` | no | The CocoaWorlds graph (`cocoaworlds.material` JSON, `packages/materials/src/graph.ts`) with this material's exposed values already applied. Readers that don't edit graphs ignore it. |
| `source/images/<name>` | no | Images the graph reads (Image nodes), so the graph can be evaluated again. |

## 2. The manifest (`material.json`)

```json
{
  "format": "cocoasuite.material",
  "version": "1.0",
  "generator": "CocoaWorlds 0.1.0",
  "created": "2026-11-04T12:00:00Z",
  "id": "mat/k3f9a0z2m1q8x7c4",
  "name": "Rusty iron",
  "folder": "Metals",
  "units": { "perMetre": 39.37 },
  "tiling": { "worldSize": 128, "mapping": "face" },
  "surface": {
    "color": "#b4b4b4",
    "roughness": 0.8,
    "metalness": 0,
    "normalStrength": 1,
    "emissive": "#000000",
    "emissiveStrength": 0,
    "opacity": 1,
    "cutout": true,
    "doubleSided": false,
    "scroll": [0, 0]
  },
  "maps": {
    "color":     { "file": "maps/color.png",     "space": "srgb",   "size": [1024, 1024] },
    "normal":    { "file": "maps/normal.png",    "space": "linear", "size": [1024, 1024], "greenPoints": "down" },
    "roughness": { "file": "maps/roughness.png", "space": "linear", "size": [1024, 1024] }
  },
  "wear": null,
  "glass": null,
  "blend": null,
  "bevel": 0
}
```

### Rules for every field

- **`format`** must be `"cocoasuite.material"`. **`version`** is `"major.minor"`. A reader takes any file with
  the same major version. It ignores fields it doesn't know (minor versions only add optional fields with
  defaults that look the same as before). It refuses a higher major version.
- Missing optional fields take the default given here. A reader never fails over a missing optional field.
- Colours are `"#rrggbb"`, **sRGB-encoded** (as a colour picker shows them). Convert to linear for lighting with
  the standard sRGB transfer function.
- Numbers are JSON numbers, finite. A reader clamps out-of-range values to the range given.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `generator` | string | — | Who wrote it (for bug reports only). |
| `created` | string | — | ISO 8601 UTC. |
| `id` | string | — | The material's id in the project it came from (`mat/` + 16 of `[0-9a-z]`). The same id means the same material exported again: an importer can offer to replace rather than duplicate. |
| `name` | string | required | Shown to people. Any Unicode. |
| `folder` | string | `""` | Where it's listed, `/`-separated (`"Walls/Brick"`). |
| `units.perMetre` | number | `39.37` | How many world units make a metre. CocoaWorlds units are inches (1 u = 1/39.37 m). Every length in the file is in these units. |
| `tiling.worldSize` | number > 0 | `128` | How many units of the world one repeat of the maps covers, along each side (the maps are square repeats). 128 u = 3.25 m. |
| `tiling.mapping` | `"face"` \| `"world"` \| `"object"` | `"face"` | How CocoaWorlds lays the maps on: by each face's own alignment or the model's texture coordinates (`face`), or projected along X, Y and Z (triplanar) from the world or from the object. CocoaSurface may use it as a hint for its own default. |
| `surface.color` | colour | `"#b4b4b4"` | Base colour, multiplied with the `color` map when there is one (white = the map as it is). |
| `surface.roughness` | 0–1 | `0.8` | 0 mirror-smooth, 1 matte. Multiplied with the `roughness` map. |
| `surface.metalness` | 0–1 | `0` | 0 non-metal, 1 metal. Multiplied with the `metalness` map. |
| `surface.normalStrength` | 0–2 | `1` | Scales the normal map's X and Y before normalising (section 4). |
| `surface.emissive` | colour | `"#000000"` | Glow colour. |
| `surface.emissiveStrength` | 0–10 | `0` | Glow brightness. Glow = emissive (linear) × strength × `glow` map (linear, white when absent). |
| `surface.opacity` | 0–1 | `1` | 1 solid. Multiplied with the `opacity` map, or with the `color` map's alpha when there is no `opacity` map. |
| `surface.cutout` | bool | `true` | With cut-out on, pixels whose opacity is under 0.5 are discarded and the rest are drawn solid. With it off and opacity under 1, the material blends (see-through). |
| `surface.doubleSided` | bool | `false` | Draw back faces too (leaves, flags). |
| `surface.scroll` | [number, number] | `[0, 0]` | The maps move across the surface, in units per second, [across, up]. |
| `maps` | object | `{}` | Role → map (section 3). A role that isn't there has no map. |
| `wear` | object \| null | `null` | Section 5. |
| `glass` | object \| null | `null` | `{ "transmission": 0–1, "ior": 1–2.5 (1.5), "thickness": units (8) }`: light through the surface, bent by its normals; colour tints it, roughness frosts it. Glass casts no shadow. |
| `blend` | object \| null | `null` | `{ "distance": units, "noise": 0–1, "noiseSize": units }`: fades into whatever it stands in (ground blending). A reader without a depth pass may ignore it. |
| `bevel` | number | `0` | Brush edges look rounded off by this many units (lighting only). Meaningful only on CocoaWorlds brush geometry; others may ignore it. |

Not exported, because they belong to a CocoaWorlds project, not to the material: hotspot rectangles
(`hotspots`, `hotspotAuto`) and the graph's file name.

## 3. Maps

| Role | Space | What a pixel means |
|---|---|---|
| `color` | sRGB, RGB or RGBA | Base colour. Alpha = opacity (used only when there is no `opacity` map). |
| `normal` | linear, RGB | Tangent-space normal: `n = rgb × 2 − 1`. See section 4 for the axes. |
| `height` | linear, grey | 0 low, 1 high. Used for bumps **only when there is no `normal` map** (CocoaWorlds draws it as a bump map). It carries no distance; a reader that displaces geometry chooses its own depth. |
| `roughness` | linear, grey | 1 matte, 0 smooth (roughness, not gloss). |
| `metalness` | linear, grey | 1 metal. |
| `occlusion` | linear, grey | 0 fully shaded, 1 open. Applies to **ambient and indirect light only**, not to direct lights. |
| `glow` | sRGB, RGB | Where the surface glows and in what colour (black none). |
| `opacity` | linear, grey | 0 see-through or cut out, 1 solid. |
| `wearColor` | sRGB, RGB | The wear layer's colour (section 5). |
| `wearRoughness` | linear, grey | The wear layer's roughness. |
| `wearMetal` | linear, grey | The wear layer's metalness. |
| `wearNoise` | linear, grey | Breaks the wear up (section 5). |

Each map entry is `{ "file": "maps/<role>.png", "space": "srgb" | "linear", "size": [w, h] }`. The normal map
adds `"greenPoints"` (section 4). `space` always matches the table; it's written out so a reader never has to
guess.

The images:

- **PNG**, 8 bits per channel. Grey maps are written as greyscale PNGs (colour type 0). Colour maps are RGB
  (colour type 2), or RGBA (type 6) for a `color` map with alpha. A reader takes the first channel of any grey
  map whatever its PNG colour type. 16-bit PNGs (bit depth 16) are allowed from 1.0 on (meant for `height`), so
  readers must accept them. CocoaWorlds 1.0 writes 8-bit only.
- **The first row in the file is the top of the picture.** Texture coordinate (0, 0) is the top-left pixel;
  u goes right and v goes down. (Flip v if your API puts (0, 0) at the bottom.)
- **Every map tiles seamlessly**: the right edge continues into the left and the bottom into the top. Sample
  with repeat wrapping and mip-maps.
- All the maps of one material have the same size, square, a power of two from 256 to 2048 (4096 allowed).
  Graph materials are baked at their **Baked size**. An image material's maps are written at their own size;
  if they differ, the exporter resizes them all to the largest (and squares them up only if they were square).
- Pixel density follows from `tiling.worldSize`: a map of `w` pixels covers `worldSize` units, so
  `w / worldSize` pixels per unit. For image materials (not graphs), CocoaWorlds lays images at 4 pixels per unit
  times their **Image size** (`viewport/project-materials.ts`, `repeatFor`), so the exporter writes
  `worldSize = width × scale / 4`.

## 4. Normal maps: axes

The normal map is in tangent space: blue out of the surface; red along +u (to the right of the picture); green
along the picture's vertical. **In CocoaWorlds 1.0 files green points down the picture** (towards the last
row), which DirectX-style tools call "Y−". The manifest says so with `"greenPoints": "down"`. A reader whose
lighting expects green up (OpenGL style, Blender, glTF) flips green: `g' = 1 − g`.

This comes from the code. *Height to normal* (`packages/materials/src/nodes.ts`) makes
`n = normalize(−dH/du · s, −dH/dv · s, 1)` with v going down the picture (the graph's read-back is top row
first, `packages/materials/src/gpu.ts`). The triplanar projection reads green along "picture down"
(`viewport/triplanar.ts`, `NORMALS`). **Task 5 must confirm this with a test before release** (bake a single
bump and check that, above its middle, green is below 0.5). If it shows the opposite, write `"up"` and change
this paragraph: the field exists so a wrong guess can never be silent.

A writer may write `"greenPoints": "up"` (bitmap export offers it, section 7). Readers must honour either value.
Missing means `"down"`.

## 5. Wear

`"wear": { "edge": 0–1, "crease": 0–1, "up": 0–1, "width": units 0–32, "noise": 0–1, "color": colour,
"roughness": 0–1, "metalness": 0–1 }`, or `null` for no wear. It's a second look laid over the first where the
geometry says so. This is how CocoaWorlds works out the amount, `m` (`viewport/triplanar.ts`, `wearMask`):

```
w    = max(width, 0.001)
raw  = 0
raw  = max(raw, edge   * (1 − smoothstep(0, w, distanceToOuterEdge)))   // outer (convex) edges of a face
raw  = max(raw, crease * (1 − smoothstep(0, w, distanceToCrease)))      // where it meets another surface
raw  = max(raw, up     * smoothstep(0.55, 0.95, worldNormal.y))         // surfaces facing up (+Y is up)
nz   = wearNoise map (projected) if present, else smooth 3D value noise of (worldPos / max(w·1.5, 1))
m    = smoothstep(0.35, 0.65, raw − (nz − 0.5) · noise · 1.6)
```

- Distances are in units, measured across the face. On meshes with no edge data, CocoaWorlds estimates them
  from curvature (`k = (dN/dx·dP/dx + dN/dy·dP/dy) / (|dP/dx|² + |dP/dy|²)`, edges `clamp(k·w·4)` and creases
  `clamp(−k·w·4)`). CocoaSurface can use exact edges if it has them; the look will be close, not identical.
- Then: colour = mix(base, `wear.color` × `wearColor` map (white when absent), m). Roughness = mix(base,
  `wearRoughness` map if present, else `wear.roughness`, m). Metalness works the same way with `wearMetal` and
  `wear.metalness`.
- The wear maps are always laid triplanar (projected), whatever `tiling.mapping` says.
- Note: white in the noise map makes wear show **later** (it's subtracted). The node's hint in the editor says
  "sooner". Task 5 settles which is meant; the formula above is what CocoaWorlds draws today.

## 6. Reading: what a native reader does

1. Check the signature (`PK\x03\x04`, `mimetype` at bytes 30–37, the 39-byte type string at 38–76), or open the ZIP and read the `mimetype` entry. Read `material.json` and check
   `format` and the major `version`.
2. Fill in defaults and clamp values (section 2).
3. For each role in `maps`: decode the PNG, upload it with the colour space from `space` (sRGB → linear on
   sampling), repeat wrapping, mip-maps. Flip green if `greenPoints` disagrees with your shading.
4. Shade as metallic-roughness PBR (the same model as glTF 2.0 and three.js's MeshStandardMaterial).
   Base colour = `surface.color` × `color` map. Roughness and metalness = value × map. Occlusion applies to
   indirect light only. Emissive as in section 2. Opacity and cut-out as in section 2. Then wear (section 5) and
   glass if present.
5. Size the repeat from `tiling.worldSize` and `units.perMetre` in your own units.

A file that breaks these rules is refused as a whole, with a message saying which rule. Broken cases: no
`mimetype` or the wrong one, no manifest, bad JSON, wrong `format`, higher major version, a map whose file is
missing or isn't a PNG, a path with `..`. Never use half a material silently.

## 7. Bitmap export (no container)

For tools outside CocoaSuite, CocoaWorlds also writes the maps as plain PNGs into a folder:
`<name>_<role>.png` (`Rusty iron_color.png`, … with characters not allowed in file names replaced by `_`).
Beside them goes `<name>.material.json`, the same manifest as section 2 with `file` values naming the PNGs
beside it (so this folder can be zipped into a `.cocoamat` by hand, adding `mimetype`). Options in the export
dialog:

- **Size**: the material's own, or 256 / 512 / 1024 / 2048 (graph materials are baked again at that size;
  image materials are resized).
- **Normal map green**: down (as in CocoaWorlds, DirectX style) or up (OpenGL style: Blender, glTF, Unity).
- **Pack occlusion, roughness, metal** into one RGB image, `<name>_orm.png` (R occlusion, G roughness,
  B metal), as glTF and Unreal expect. A missing map is filled with its default (occlusion 1, roughness and
  metal from the material's values).
- **Which maps**: all present (default), or a chosen set.

## 8. Changes to this format

Adding an optional field, map role or entry is a minor version (1.1). Changing what a field means, or making
something required, is a major version (2.0). Update this document and the test files (task 5) in the same
change.
