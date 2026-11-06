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

Status: **done.** The format is specified in **[cocoamat-format.md](cocoamat-format.md)** (now "implemented"),
with the node reference generated from the code in [`cocoamat/nodes.md`](cocoamat/nodes.md) and
[`cocoamat/nodes.json`](cocoamat/nodes.json). The spec is the contract with CocoaSurface: if code and spec
disagree, fix one of them in the same change. After changing any node, or `LIBRARY`, run
`CW_WRITE_CATALOG=1 npx vitest run packages/materials/test/catalog.test.ts`, and rewrite the samples (below).

Done:
- **Format code** (pure, tested in node): `packages/materials/src/cocoamat.ts` (`manifestOf`, `parametersOf`,
  `graphForExport`, `imagesUsed`/`imageNames`, `catalogFor`, `writeCocoaMat`, `readCocoaMat` with every refusal
  of spec sections 3 and 9, `evaluable`, `changedNodes`, `materialOf` for import) and `zip.ts` (ZIP writer and
  reader, PNG encoder, on `CompressionStream`). `validateGraph` takes a file's own catalog and image prefix.
  Decision C5: the file is built in the UI, not in the main process (see DECISIONS.md).
- **Editor**: Materials list › **Export…** (and right-click; Ctrl+click picks several) › *CocoaSuite material
  (.cocoamat)…* (disabled with the hint for image materials) and *Images (PNG)…* (dialog: size, normal green,
  packed ORM, which maps); **Import…** beside it. Code: `renderer/materials/export.ts`,
  `editor/MaterialExport.tsx`, `editor/MaterialsPanel.tsx`; main process `main/material-files.ts` (save/open
  dialogs; writes only into folders a dialog gave; `CW_MATERIAL_EXPORT_DIR` and `CW_MATERIAL_IMPORT_FILE` skip
  the dialogs in tests). UI strings in English and Russian.
- **Settled**: normal green is **down** (proved in `test-e2e/cocoamat-samples.test.mjs`); wear noise now adds
  (white shows wear sooner, as the node says; the fallback noise is turned over so old materials look the same,
  `viewport/triplanar.ts`); tolerance mean < 1/255, max < 8/255 per map (spec 5.5).
- **Samples for CocoaSurface**: `docs/cocoamat/samples/` (stone, bricks, image), each with its 256 px maps.
  `cocoamat-samples.test.mjs` checks them; `CW_WRITE_SAMPLES=1` rewrites them.
- **Tests**: `packages/materials/test/cocoamat.test.ts` (manifest, image paths, catalog cut, ZIP read back by
  `extract-zip`, refusals, clamping, PNG), e2e `test-e2e/material-export.test.mjs` (a material and its variant
  exported, read back with their values, the variant imported and baked the same, images with ORM and green up).

Next, if wanted: `preview.png` (the preview sphere, 256 px); on import, offer to replace a material whose id is
already in the project; import of image materials as a graph of Image nodes (ask first).

### 6. Mascot horror: hiding spots, enemy AI, heartbeat minigame

Goal: one enemy with a richer AI, hiding spots, and a heartbeat rhythm minigame when the enemy is near a hidden
player. Built as general components and blocks, nothing game-specific in the engine.

Hiding spots: **done.** `hidingSpot` component (`packages/core/src/components.ts`: look from, eyes at, look
left/right and up/down limits, getting-in time) and the creature's `pull` setting and `pull` animation role.
Runtime: `GameWorld` hiding section in `packages/runtime/src/world.ts` (`enterHiding`, `leaveHiding`,
`stopHiding`, `limitLook`, `hiddenView`; the player's collider is off inside, feet stay where they got in);
`npc.ts` (`found`: a creature that sees the player while they are getting in walks to the spot and pulls them
out). Blocks: events `hides`, `unhides`, `found`, statement `unhide`, value `hiding`. Docs: `docs/creatures.md`
(Hiding spots). Tests: `packages/runtime/test/hiding.test.ts`.

Enemy AI: **done** (the user's brief: behaviour tree, Director stimuli, search, hiding spot suspicion and
interactions, personality layer). Creature **Mind: Hunter** (`npc.mind`, settings in `hunterFields()` in
`components.ts`, moves in `packages/core/src/moments.ts`). Code in `packages/runtime/src/hunter/`: `tree.ts`
(Priority, Sequence, Guard, Restart, Task), `blackboard.ts`, `stimuli.ts` (weigh, freshness, age bands),
`spots.ts` (SpotInfo, SpotMemory, suspicion, react), `interactions.ts` (checks per spot kind), `personality.ts`
(beats to moves, moves to animations), `settings.ts`, `mind.ts` (Hunter: senses, the tree, tasks). `Npc` runs the
mind's plan (`npc.ts`: `mind`, `canSee`, `clear`, `startPull`, `playMoment`). World: `noise`, `hint`,
`spotInfo`, `NOISE`, player noises, `reveal`/`did` in `npcWorld()`; pulled-out players are put beside the
creature (`Player.fitsAt`). Fixed on the way: creatures' own capsules were solid when the navigation grid was
measured (holes round each creature's start). Blocks: event `does`, statements `noise`, `hint`. Tests:
`packages/runtime/test/hunter.test.ts`.

Waiting on: the user's mascot model (robot in a chicken costume) and its animations; then fill its **Moves**
(and Animations, including `pull`). Still the chicken as a stand-in.

Next: the heartbeat minigame (likely a reusable timing-bar screen element with blocks for hits, misses and the
end; a miss can be “Make a noise at the hiding spot”, which a listening Hunter acts on).

### 7. Carried floodlights: lights riding objects, light and glow blocks

Status: done. Point objects (lights, models, sounds, particles) inside a physics object ride with its body in Play
(`unitOf` set after the bodies are made, `world.ts`); a light under a physics object never becomes a unit of its
own. Lights live in `GameWorld.lights` (on, brightness, reach, cone, colour, each a `Fade`); Turn on/off and
Show/Hide on a light switch only the light. Light component: `on` (On at start). Blocks: `setLight` (prop,
value, seconds), `setGlow` (strength, seconds; `GameWorld.glowing()`), value `lightOn`; the checker says when the
target isn't a light. Drawing: `SceneLighting.lights` and `drive` (off is intensity 0, so shaders don't
recompile), `PlaySession.driveLights` (called after `lighting.update` in `engine.ts` and `runner.ts`) and
`updateGlow` (clones a model's glowing materials once, keeps their own glow in `userData.glow`). Tests:
`packages/runtime/test/lights.test.ts`, `apps/editor/test/scene-lighting.test.ts`.

Next, if wanted: an e2e test with a real carried floodlight; copies keeping their lights; brushes riding too.

