# Handoff

Read this first in a new session. Commit rules: see the notes in the last session (commit with the CocoaSuite identity, no attribution lines, run the attribution grep for the assistant name and vendor name before pushing, push with `git push -q origin main`).

## Open tasks

### 1. Glass should not cast shadow

Status: done. `viewport/glass-shadows.ts` hides glass materials (transmission > 0) for the shadow pass only, hooked
on both renderers (`viewport/engine.ts`, `game/runner.ts`), so it covers models, level faces (glass is one material
group of the level mesh, so per-mesh `castShadow` would have removed the whole level's shadows), materials made
glass after load, and Play. Tests: `test/glass-shadows.test.ts`, e2e `test-e2e/glass-shadow.test.mjs`.

### 2. Blending multiple terrain instances to create open world maps

Status: first working case done. Chosen: tiles on a grid that share their edge points (seamless, no blend falloff),
authored with the Terrain tool's *Add a tile* buttons, whole map loaded in Play. Design and what's left:
`docs/terrain-blend.md`. Code: `packages/geometry/src/voxels.ts` (neighbours, seam ownership, `tileBeside`,
`stitchTiles`), `viewport/terrain-tiles.ts` (joining, strokes across seams), `viewport/engine.ts` (stroke),
`viewport/play-session.ts`. Tests: `packages/geometry/test/voxel-tiles.test.ts`, e2e `test-e2e/terrain-tiles.test.mjs`.

Next, if wanted: streaming tiles around the player in Play; a heightmap import cut across several tiles.

### 3. Background sound and sound effects by area

Status: done. Settled: background sound is a scene setting (Inspector, nothing selected › Sound: sound + volume,
`settings.backgroundSound`); areas are a separate **Sound area** brush component (`soundArea`: effect, mix,
optional background sound + volume) that can sit alongside `trigger`; smallest area wins; under water muffles on
its own; Sound components can opt out (`areaEffects`, on by default). Presets: None, Room, Hall, Cave,
Underwater, Outdoors.

Code: `packages/core/src/components.ts` (`soundArea`, `SoundData.areaEffects`), `packages/core/src/schema.ts`
(`backgroundSound`, `backgroundSoundOf`), `packages/runtime/src/world.ts` (`GameWorld.hearing`: area, effect,
mix, background, underwater; sound areas are never level geometry), `viewport/area-sound.ts` (`SoundStage`: lowpass
→ dry + one convolver per echo preset with code-made impulse responses, 0.3 s ramps; `plain` bus for opted-out
sounds), `viewport/play-session.ts` (`hear()` each tick, background loop crossfades), `editor/Inspector.tsx`.
Docs: `docs/rendering.md` (Background sound and Sound areas), `docs/scripting.md`, `FEATURE_STATUS.md`,
`KNOWN_LIMITATIONS.md`. Tests: `packages/runtime/test/sound-areas.test.ts`, `apps/editor/test/area-sound.test.ts`,
e2e `test-e2e/sound-areas.test.mjs`.

Also fixed: the `components.test.ts` "offers only what fits" failure (the list was missing `reflectionProbe`).

Next, if wanted: a Sound area button in the Tools bar (like Trigger zone) so the brush gets the zone look on
creation; opt-out for Play sound blocks; custom echo settings; a "Change background sound" block.

### 4. Googly eyes (shader-based)

Status: done. A **Googly eyes** component (`googlyEyes`, point objects only: models, creatures, empties): one or
two eyes, size, apart, position (object space, rest pose, looking along −Z), turned out (splay), looking up
(tilt), pupil size, looseness, colours, ride on a bone (`followBone`, `bone`: empty means the first bone with
“head” in its name). On a plain creature figure, adding it places the eyes on the front of the head; on the
chicken, `CHICKEN_EYES` (measured from its eye whites; also in `chickenComponents`, so Add › Chicken has them).

Bones: `rideModel` → `findBone` + `rideOn`. Once the model has loaded (still in its rest pose, before any mixer
update), the eyes' object is re-parented onto the bone with the matrix that keeps its world place. Editor:
`markers.ts` model `.then`. Play: `attachModel`'s `.then` via `eyesById` (or at once in `eyesOn` if the model is
already in). Checked in a browser with the real `chicken.glb` (peck and walk carry them).

Fixed after: in Play the eyes floated in the sky, big, away from the chicken. Three r187's
`updateWorldMatrix(true, …)` only recomputes an object whose own `matrixWorldNeedsUpdate` is set, so the eyes'
`googly-holder` (`matrixAutoUpdate = false`) kept an identity world matrix once a frame had been drawn. When the
model arrived (at once, since the editor had loaded it), the eyes were measured at the world origin at scale 1
and pinned to the head with that offset. The pupils also read stale positions when on a bone. Now `freshWorld`
composes the local matrices up the chain, in `rideOn` and in `update` (callers no longer update matrices).
Tests: "keep their place when they ride after the scene was drawn…" and "feel the bone move…". Checked with a
real `PlaySession` in Chromium (Player start, a turned chicken in a group, model loaded first): eyes within 3 u of
the head. Chicken eyes made smaller (size 8.5, about its own eyes). Chickens added before keep the size they were
saved with (11.5).

Each eye is a shared shallow dome (`eyeGeometry`) with its own clear-coated `MeshPhysicalMaterial`. Its look is
drawn in the fragment shader through `onBeforeCompile`: the white with cup shading, the pupil with its contact
shadow and edge, the clear rim, and grey on the back. The pupil is one uniform per eye, so it stays lit,
shadowed, fogged and probe-reflected like other materials. The pupil's place comes from a per-frame simulation
in the eye's plane: gravity minus the eye's smoothed acceleration, damping, rim bounce and rub. The pupil keeps a
world offset, so it stays put while the eye spins. Pupils sleep when at rest, and a teleport isn't a shove.

Code: `packages/core/src/components.ts` (`googlyEyes`, `GooglyEyesData`), `viewport/googly-eyes.ts`,
`viewport/markers.ts` (editor; in `markerKey`), `viewport/engine.ts` (`tickEyes` keeps the view drawing only while
pupils move), `viewport/play-session.ts` (`eyesOn`: creatures' `inner`, point bodies and copies in `addMover`,
objects carried by movers, still objects; updated in `tick`). Docs: `docs/creatures.md` (Googly eyes),
`FEATURE_STATUS.md`, `KNOWN_LIMITATIONS.md`. Tests: `apps/editor/test/googly-eyes.test.ts`.

Not done: an e2e test (Electron wasn't available in that session). Next, if wanted: pupils that look at the
player; eyes on brushes; a "Shake the eyes" block; eyes placed from a model's own eye slots automatically (any
model, not only the chicken).

### 5. Export materials for CocoaSurface (`.cocoamat`, editable graphs) and as bitmaps

Status: **open, not started.** Requested 2026-11-04. CocoaSurface is another CocoaSuite app, in development.
It must open materials made in CocoaWorlds' Materials workspace **as editable graphs**: it evaluates the node
graph itself and shows the graph's **exposed settings as the material's parameters**, which people change
there. The file carries the graph, the exposed parameters with their kinds, ranges, defaults and values, the
material's own settings, and the definition of every node it uses. Baked images are optional extras. The format
is specified in **[cocoamat-format.md](cocoamat-format.md)**, with the node reference generated from the code in
[`cocoamat/nodes.md`](cocoamat/nodes.md) and [`cocoamat/nodes.json`](cocoamat/nodes.json). The spec is the
contract with CocoaSurface: implement it exactly, and if code and spec disagree, fix one of them in the same
change.

Already done (with this note): `packages/materials/src/catalog.ts` (`nodeCatalog()`, `catalogMarkdown()`,
`fnv1a`, each node's `hash`) and `packages/materials/test/catalog.test.ts`, which fails if `docs/cocoamat/`
is out of date. After changing any node, or `LIBRARY`, run
`CW_WRITE_CATALOG=1 npx vitest run packages/materials/test/catalog.test.ts`.

What to build:

1. **Export as CocoaSuite material (`.cocoamat`)**, for **graph materials**: in the Materials workspace, an
   **Export…** button (and the list's right-click menu) with *CocoaSuite material (.cocoamat)…*. One file per
   material through a native save dialog. With several picked, choose a folder and write one file each. Write the
   ZIP as spec section 1, with:
   - `material.json` (section 2) from the `MaterialDef`: `tile` becomes `tiling.worldSize`; `bakeSize` becomes
     `evaluation.size`; the plain settings go in `surface`; and wear, glass, blend and bevel. `parameters` comes
     from the graph's `exposedOf(g)`, with kind, min, max, step and options from the node definition, `default`
     from the graph, and `value` from `m.overrides` (missing: the default).
   - `graph.json`: the graph as it is in `materials/<name>.cwmat`, **without** the overrides applied (the values
     live in `parameters`, so CocoaSurface can show ↺). Image settings are rewritten from `assets/textures/…`
     to `images/<file>`, and those images are copied in (convert WebP to PNG; PNG and JPEG as they are).
   - `nodes.json`: `nodeCatalog()` cut down to the node types the graph uses (keep `library` and
     `vertexShader`).
   - optionally `baked/<role>.png` (the current baked maps, if they're fresh) with `baked` in the manifest, and
     `preview.png` (the Materials preview sphere, 256 px).
   - **Variants** (several materials sharing one graph): each exports as its own file with the same graph and its
     own `parameters` values.
   - **Image materials** (not graphs) have no graph to export. The *CocoaSuite material* item is disabled for
     them, with the hint "Only graph materials; export its images instead". (If the user wants them too, a
     graph made of Image nodes wired to outputs would carry them. Ask first.)
2. **Export as images** (*Images (PNG)…*, spec section 10) for every material: evaluate the graph at the
   chosen size with the material's values (a `GraphEvaluator` as in `bakeOnce`, `renderer/materials/graphs.ts`),
   or re-encode an image material's images. Options: size, normal green down or up, packed ORM, which maps.
3. **A reader in code** (`packages/core` or `packages/materials`, no DOM): `readCocoaMat(bytes)` →
   `{ manifest, graph, nodes, images } | error`. It validates as spec sections 3 and 9 (reuse `validateGraph`,
   but check node types against the file's `nodes.json`). It's for the tests, and it's the model for
   CocoaSurface's native reader.
4. **Import `.cocoamat` into CocoaWorlds** (recommended, since CocoaSurface may also write these files): make a
   graph material from it, with the graph in `materials/`, images in `assets/textures/`, values as `overrides`,
   then bake. If a node's `hash` differs from CocoaWorlds' own, warn that it may look different. Ask the user
   before doing import if time is short.

Where things go (suggested):
- `packages/materials/src/cocoamat.ts`: manifest types, `manifestOf(material, graph)`, `graphForExport`
  (image paths), `readCocoaMat` and validation. Pure, tested in node.
- The ZIP writer goes in the **main process** (`apps/editor/src/main/`): a small store/deflate writer on
  `zlib.deflateRawSync` and `zlib.crc32` (Node 22, Electron 45), unless a dependency is clearly better. Typed IPC
  as for `writeGenerated` (`shared/api.ts`, `main.ts`, `preload.ts`), with save and folder dialogs.
- UI strings in English and Russian (`i18n.ts`).

Settle these first (each is named in the spec):
- **Normal green direction** (spec section 6): prove it with a test (bake one bump), then keep or flip the
  `normalGreen` default.
- **Wear noise** (spec section 8): the shader subtracts it, but the hint says white shows wear sooner. Make them
  agree.
- **Exactness**: the graph evaluates on the GPU, and hashes in the noise use float maths, so another card or API
  can differ slightly. CocoaSurface's conformance check is therefore "within a tolerance". Pick one (suggested:
  mean absolute difference < 1/255 and max < 8/255 per map) and write it into the spec.

Tests to write:
- Unit: `manifestOf` (a full graph material with exposed settings of several kinds, and a bare one): defaults,
  `parameters` kinds, ranges, values, and `graph.json` image paths rewritten.
- Unit: the ZIP writer (`mimetype` first, stored, at offset 38), read back with `extract-zip` and `readCocoaMat`.
  Also the refusals: wrong mimetype, higher major version, unknown node type, bad link, `..` path.
- **Sample files for CocoaSurface** in `docs/cocoamat/samples/`: two or three small `.cocoamat` files (the
  default stone graph; bricks with exposed colour, rows and stagger; one with an Image node). Beside each go its
  maps evaluated by CocoaWorlds at 256 px (`<name>_<role>.png`). These are CocoaSurface's conformance test: evaluate
  the file and compare within the tolerance.
- e2e (`test-e2e/material-export.test.mjs`): export a graph material and a variant, read them back, and check the
  values. If import is done, round-trip it and compare the baked maps.

Docs when done: `docs/materials.md` (an Export section), `FEATURE_STATUS.md`, `KNOWN_LIMITATIONS.md` (wear and
bevel are only approximate outside CocoaWorlds; 8-bit maps; GPU tolerance), and the spec's status line becomes
"implemented in CocoaWorlds <version>".
