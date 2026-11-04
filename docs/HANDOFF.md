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

### 5. Export materials for CocoaSurface (`.cocoamat`) and as bitmaps

Status: **open, not started.** Requested 2026-11-04. CocoaSurface is another CocoaSuite app, in development. It
must be able to use materials made in CocoaWorlds' Materials workspace, image and graph materials alike, by
reading a CocoaSuite file natively. The file format is specified in **[cocoamat-format.md](cocoamat-format.md)**.
That document is the contract with CocoaSurface: implement it exactly, and if the code and the document
disagree, fix one of them in the same change.

What to build:

1. **Export as CocoaSuite material** (`.cocoamat`): in the Materials workspace, an **Export…** button (and the
   material list's right-click menu) with *CocoaSuite material (.cocoamat)…*. It saves one file per material
   through a native save dialog. With several materials picked, ask for a folder and write one file each,
   named after the material. It writes the ZIP as spec section 1 (`mimetype` first and stored),
   `material.json` (section 2), the maps (section 3), `preview.png` (the Materials preview sphere, 256 px), and
   for graph materials `source/graph.cwmat` (with `withOverrides` applied) plus the images its Image nodes use.
   - Graph materials: bake first if the latest changes aren't baked (`bakeNow` in
     `renderer/materials/graphs.ts`), then use the baked PNGs (`assets/textures/generated/`).
   - Image materials: re-encode their images as PNG at their own size (JPG and WebP are allowed in projects). Grey
     maps become greyscale PNGs. Work out `tiling.worldSize` as in spec section 3.
   - Plain-colour materials (no images) are valid with an empty `maps`.
2. **Export as images**: *Images (PNG)…* in the same menu, as spec section 7: choose a folder, write
   `<name>_<role>.png` plus `<name>.material.json`, with the options for size, normal green up or down, packed ORM,
   and which maps.
3. **A reader in code** (`packages/core`, no DOM): parse and validate a `.cocoamat` (`readCocoaMat(bytes) →
   { manifest, maps } | error`). It's for the tests, and it's the model for CocoaSurface's native reader. Also
   worth doing while there: *Import .cocoamat* into a project, since a round trip proves the format.
   Import isn't required by this task. Ask before spending long on it.

Where things go (suggested):
- `packages/core/src/cocoamat.ts`: manifest types, `manifestOf(material, maps)`, validation, defaults. Pure,
  tested in node.
- The ZIP writer goes in the **main process** (`apps/editor/src/main/`). Node's `zlib.deflateRawSync` and
  `zlib.crc32` (Node 22, in Electron 45) are enough for a store/deflate writer; keep it small, no new
  dependency unless it's clearly better. Add typed IPC as for `writeGenerated` (`shared/api.ts`, `main.ts`,
  `preload.ts`), with a save dialog and a folder dialog.
- The renderer gathers the bytes (baked PNGs via `readAsset`, re-encoding via canvas as `pngBytes` does) and
  sends them to main to write.
- UI strings in English and Russian (`i18n.ts`), as everywhere.

Settle these first (each is named in the spec):
- **Normal map green direction**: the spec says CocoaWorlds bakes green *down* (spec section 4, with the evidence).
  Prove it with a test (bake one bump, check green above its middle), then keep or flip the spec's default.
  Bitmap export's "up" option flips green.
- **Wear noise**: the shader subtracts it (white means wear later), but the node's hint says sooner. Pick one, and
  make the shader, the hint and spec section 5 agree.
- Image materials whose maps differ in size: the spec says resize to the largest. Check that's acceptable
  with the user if it comes up.

Tests to write:
- Unit (`packages/core/test/cocoamat.test.ts`): a manifest from a full material and from a bare one, covering
  defaults, clamping, map spaces and refusals (wrong mimetype, higher major version, missing map file, `..`
  path).
- Unit (main, `apps/editor/test/`): the ZIP writer. `mimetype` is first and stored, at offset 38. Read it back
  with `extract-zip` (already a dependency) and with `readCocoaMat`.
- Golden files: `docs/cocoamat-samples/` with a tiny hand-checked `.cocoamat` (a 4 × 4 graph material with
  colour, normal and roughness). CocoaSurface's developers can use it as a test vector, and the reader test
  reads it.
- e2e (`test-e2e/material-export.test.mjs`): export a graph material and an image material, then read both
  files back.

Docs when done: `docs/materials.md` (an Export section), `FEATURE_STATUS.md`, `KNOWN_LIMITATIONS.md` (wear and
bevel are only approximate outside CocoaWorlds; 8-bit maps), and set the spec's status line to "implemented in
CocoaWorlds <version>".
