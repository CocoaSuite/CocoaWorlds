# Handoff

Read this first in a new session. Commit rules: see the notes in the last session (commit with the CocoaSuite identity, no attribution lines, run the attribution grep for the assistant name and vendor name before pushing, push with `git push -q origin main`).

Speed rules (user asked): clone with `--depth 1`, install with `npm ci --ignore-scripts --no-audit --no-fund`. For a
change, run `npx tsc -b` and only the tests next to what changed (`npx vitest run <files>`, or `vitest related
<changed files> --run`). Run the full suite only for big or wide changes (core/components, world.ts structure,
shared helpers) or before a large push.

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

### 8. Frame stutters: optimisation sweep

Status: done, **run and checked** (2026-11-07). What and where: docs/rendering.md, “Smooth frames”. In short:
shaders compiled before Play's first frame and models compiled in the background (`warmPlay` in `engine.ts`,
`game/runner.ts`, `PlaySession.warm`); reflections switched on first and captured over four frames
(`SceneReflections.prime`, `job`); pooled tracers, fireballs, marks and blast lights (`effects.ts`,
`GameWorld.hasBlasts`); signs redrawn in place (`sign.ts` `retext`); lights built from what stays put
(`PlaySession.levelBounds`, `SceneLighting.update(…, still)`, the cached `shadows`, `WorldRenderer.shapeVersion`);
moving objects, creatures and camera views drawn between physics steps (`GameWorld.drawnMotionOf`,
`npcStates(true)`); path search without fresh memory (`NavGrid.scratch`) and staggered (`Npc.repathEvery`);
particles upload only their live part; the status line at most four times a second (`sendStats`). Tests:
`packages/runtime/test/smooth.test.ts`, e2e `test-e2e/smooth-frames.test.mjs` (blast lights made up front and
dark again, light count unchanged, tracer pool, sign retext keeps its material, reflections on at the first frame,
the falling crate drawn where the snapshot says).

Results of the run: unit tests and type check passed as pushed. In e2e, the sweep broke two tests, both in how
they measured: `col.test.mjs` counted visible *materials*, so the eight pooled (hidden) fireballs looked like 8,448
drawn triangles (now it counts only what is drawn, `traverseVisible`); `many-models.test.mjs` read the renderer's
draw counter at a random moment, which also holds the spread-out reflection captures and whatever drew between
frames (now it waits for captures to finish and reads the status line's count of a frame: 19 draws for 256
crates). Checked by eye in Play (screenshots): fireball and its light on the wall, scorch and bullet marks, the
sign changing text in place (resized), the crate falling and landing. Everything else that failed was older than
the sweep (the same failures on the commit before it), from sessions that pushed without Electron:
- the block picker (de02241) replaced the event and block menus: tests now pick with `pickBlock` / `findBlock`
  (helpers.mjs: search, then the option);
- the chicken's googly eyes have their own Position fields (chicken test takes the object's, the first);
- the Add component menu has Seat and Foliage for moving brushes and names items by `aria-label`
  (physics test); game rules gained fields (health test checks only the ones it set);
- time limits: on this machine's software GPU (SwiftShader) Play runs at about 3 frames a second, the game at
  0.14× real time (the same before and after the sweep). `CW_E2E_SLOW=6` stretches every wait (helpers.mjs
  `SLOW`); run the suite with it on such machines, one file at a time (`--test-concurrency=1`): two Electron
  windows at once on 2 cores time out at random.

Fixed on the way (not from the sweep): a screen that frees the mouse at Play's start could be beaten by the
pointer lock Play had asked for (it arrived after, and stayed): `engine.ts` and `runner.ts` now let go of a lock
that arrives after a screen freed the mouse (`dropLock`). `ui.test.mjs` failed on it most runs.

Flaky (also before the sweep: passed 1 of 3 on the commit before it): `cocoa-materials.test.mjs`, dropping a link
a little off a node's dot (line 113) sometimes doesn't connect.

Still failing (also before the sweep, not looked into): `glass-shadow.test.mjs` (no shadow at all under the pane
in the editor's Game lighting: 38–88 shadowed pixels, wants > 2000; check that the sun's shadows show in the
editor at all) and `editor.test.mjs` (dragging the gizmo's X arrow in the Top view also moved Z by 128).

Next, if wanted: measure on a real GPU with a busy level (frame times in the status line); skip the ground-blend
and occlusion scene walks when nothing needs them; cheaper bulb shadows (each is six renders a frame).

### 9. Performance architecture, step 0: one frame snapshot

Proposal (**approved** 2026-11-07, DECISIONS.md P2–P5; next: step 1, the frame as messages): [proposals/performance-architecture.md](proposals/performance-architecture.md)
(keep Electron; the frame as messages; the world in a Web Worker; instancing; Rust/WASM for navigation, voxel
meshing and maybe the VM; WebGPU later; each with order, risks and tests).

Status of step 0: done. `PlaySession` reads one picture per frame, `GameWorld.snapshot()` (`packages/runtime/src/
snapshot.ts`, `FrameSnapshot`), taken in `tick` right after the step, instead of calling the world per object:
- bodies: drawn motion (16 numbers, as `drawnMotionOf`), place (as `positionOf`), present and shown flags; every
  moving body is in it, others when asked for with `GameWorld.drawn(id)` (written at once, so it can be read that
  frame; lights and emitters on still bodies, sounds that follow one);
- creatures: feet and yaw as drawn, alive, health, state (as `npcStates(true)`);
- the player's view: eye, yaw, pitch, feet, third person, crouched (as `playerView`, so a scripted camera ends
  there when its time is up, once a frame as before).
Each object keeps one index for the whole game (never reused; a removed body stays, not present). Arrays grow by
doubling and are filled in place. Readers: movers, `placeNpcs`, `driveLights`, emitters, following sounds,
`placeCamera`. Same thread, same values: `packages/runtime/test/snapshot.test.ts` compares every field with the old
calls over steps of many lengths, hidden and removed bodies, and growth.

Not yet in the snapshot (step 1 of the proposal): everything else read per frame (HUD, prompts, sounds, signs,
light states, `switchedOn`, events). The fill still uses `drawnMotionOf`, which makes small arrays per body: write
straight into the typed array once the worker step is near.

### 10. Frame-time bench

Status: done (2026-11-07), waiting for the user's first run on a real GPU. `npm run bench` (`tools/bench/run.mjs`;
how to use: `tools/bench/README.md`): makes a project through the editor, writes the bench level into it
(`tools/bench/scene.ts`, built by esbuild from the engine's own functions: 64 rooms, 16 bulbs (4 with shadows),
200 crates, 40 creatures (10 Hunters), 2,000 plants, a rocket every 3 s), plays it with vsync off for 8 + 30 s while
the player walks and turns, and writes `tools/bench/results/<date>-<commit>.md` and `.json` (git-ignored). Frame
times come from `viewport/frame-log.ts` (`ViewportEngine.frames`: interval, tick, world step, draw, draw calls,
triangles per Play frame); the status line shows `world … ms · draw … ms` in Play. Test: `tools/bench/scene.test.ts`
(the level has what it promises, is the same each time, plays). Vitest now also runs `tools/**/*.test.ts`.

First run here (software GPU, meaningless for speed): world step 18 ms median on this 2-core VM, and **5,494 draw
calls** a frame (plants one by one, bulb shadows): instancing (step 3) may come before the worker. Decide from the
user's numbers.

### 11. Base building (comfort and safety)

Status: first working version. Game rule `building`. Data-driven pieces (`packages/runtime/src/building/data/*.json`,
plus `settings.building` in a scene), build sites stage by stage, doors/bolts/shutters, the chair wedge, rooms and
sealing (muffle + wind cut), hidden comfort (ambience only), sleep-to-save in comfortable rooms, horror events and a
sample knock, saved in progress. Design and API: `docs/building.md`. Tests: `packages/runtime/test/building.test.ts`.

Next, if wanted: blocks for the base events (When a room is sealed, When something knocks); model files per piece;
a second storey; an e2e test of placing in Play.

### 12. Plant batching: tried and taken back

On 2026-11-07, Plant objects were drawn as instanced batches (by recipe, seed, level and 2048 u area; bulb shadows
skipping them by a layer), commit 1d298d3. The bench's draw calls fell from ~5,400 to ~1,360. It was reverted
(c111d47) when the user's project ran at 15 fps instead of 60+, but that turned out not to be the batching: the
11-04 version lagged the same, and the laptop was on battery (its graphics card slowed down). So the batching is
not known to be bad; it is waiting for a bench run on mains power to decide. Its known weakness: a batch is culled as
a whole, so every plant in an area on screen is drawn, behind the camera too; if it comes back, cull plants one by
one for the view and keep separate shadow-only batches (a layer only the sun's shadow camera sees). Measure on the
user's project, plugged in, not only the bench. `npm run bench -- --breakdown` (draws per pass) stays.

### 13. Custom collision shapes (collision meshes in model files)

Status: done. Meshes named `collision` / `hitbox` / `col_` / `ucx_` (or under a node named so) are taken out of the
loaded scene (an empty node keeps each place, so animation still binds) and become the model's colliders with any
Model Collision but None (**Auto**, the new default, means none without them). Box meshes → cuboid (turned too), others → hull, `*_mesh` names →
trimesh on still bodies. Animated ones (track on the node or an ancestor, or under a bone) follow via
`ModelInstance.movedParts()` → `GameWorld.movePart()` each Play tick. View › Show collisions: outlines on one shared
material. Code: `viewport/models.ts` (`splitCollision`), `packages/runtime/src/world.ts` (`ModelPart`, `modelColliders`,
`boxOf`, `movePart`), `viewport/play-session.ts`. Tests: `apps/editor/test/collision-meshes.test.ts`,
`packages/runtime/test/models.test.ts` (Auto). Not checked yet with a real Blender file in the app.

Next, if wanted: `trigger` meshes in files (zones); outlines on batched copies.
