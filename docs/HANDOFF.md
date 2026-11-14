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

### 11. Base building (blueprints, Lumber Tycoon 2 style)

Status: rewritten Nov 2026 (the old stage-by-stage build sites, rooms, sealing, comfort, sleep-to-save, the wedge
and the knock are gone). Game rule `building`. B opens a menu of the blueprints owned (items, not hotbar slots); the
picked one is placed on a 48 u grid against the face aimed at (stacking, beside), R turns, T tips, Q stops; % tags
over blueprints; props tagged with the piece's `material` (`plank`,
`concrete powder`) count while touching it (one blueprint each), and once `count` are in they are used up and it is solid.
Hold E on a blueprint to remove it; finished pieces have `health` and are knocked down by weapon hits, blasts and damage blocks. Doors open
with E. Data: `packages/runtime/src/building/data/*.json` plus `settings.building` in a scene. Design and API:
`docs/building.md`. Tests: `packages/runtime/test/building.test.ts`.

Next, if wanted: buying blueprints from the home-computer shop; blocks for the base events; model files per piece;
an e2e test of placing in Play.

### 12. Plant batching: back (2026-11-12)

Back in, after the user's bench on mains power (RTX 5060 laptop: 11 fps, 80 ms of an 86 ms frame in drawing, nearly all of
it Three.js walking ~9,000 plant objects once per pass, ~30 passes a frame; `npm run bench -- --breakdown --profile`).
Different from the first try: plants cast bulb and spotlight shadows as before (no layer trick), plant holders stay out of
the scene graph (only trees' far pictures are in it), and while a session plays the editor hides its own grass, terrain
and plants (they were drawn a second time under the session's). Still culled a batch (2048 u area) at a time.
The history of the first try:


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

### 14. Days

Status: done. A day count on top of day and night (see docs/rendering.md, Days): `DayCycle.startDay`
(Inspector › First day), `showDay` (Day counter in the HUD, `PlayerStatus.day`), `GameWorld.day`, `passHours` (the clock and
skipped hours go through it) and `setDay`, events `newDay`, `dayStarts` and `atHour`, statement `setDay`, values
`day` and `isDay`. Saved as `SavedProgress.day`, carried as `Travel.day`. Tests:
`packages/runtime/test/days.test.ts`.

Clock (2026-11-07): Inspector › Show the clock on screen (`DayCycle.showClock`, `PlayerStatus.clock`, HUD `clockText`, 24-hour HH:MM). **Set the time of day** to an earlier hour now passes midnight (`GameWorld.setHour`: day up, `newDay` runs).

Next, if wanted: weekday names; a 12-hour clock option.

### 14b. Navigation measured in workers when Play starts (2026-11-12)

Building the game world froze the window when Play started (bench level: ~1.6 s of ~1.9 s was `NavGrid.build`, ~620,000
ray and capsule queries). Now a Play session's world is made with `navBuilder` (`GameWorld.create` option): the world
takes the same step of no time as before, snapshots the physics (`World.takeSnapshot`, ~4 ms) and posts a `NavJob`
(snapshot, the solid colliders' handles, the box); `nav-pool.ts` shares the grid's rows out in bands between up to 4
workers (`nav-worker.ts`, inlined like the level worker so exported games have it), each of which reads the snapshot
back (`openNavJob`) and measures its rows (`NavGrid.measure`); `NavGrid.fromRows` joins them. `PlaySession.create`
awaits `world.navReady`, so the world is never stepped before. The grid is identical to the one measured in place
(same code, same physics state). If workers fail, time out (30 s), or `navigation()` is asked for first, the level is
measured on the spot from the same snapshot. Without `navBuilder` (tests, the editor's walkable-area preview) nothing
changed. Tests: `packages/runtime/test/nav-elsewhere.test.ts`, `apps/editor/test-e2e/nav-workers.test.mjs`.
The bench reports `Entering Play: … s; longest freeze on the way: … ms`.

Cost: the play-session chunk grew by ~4.3 MB (the physics engine, inlined once more for the workers).
Not done: the editor's walkable-area preview still measures on the UI thread after each edit; the rest of making the
world (~0.3 s on the bench level) and shader compiling at the first frame are still on the UI thread.

### 14c. Play start: shaders compiled in the background (2026-11-12)

The real freeze entering Play (user's game, RTX 5060, D3D11: 21–25 s) was shaders, each waited for at its first draw
(~0.4 s apiece through ANGLE): the reflection capture (`prime`, 13 s), then the ground-blend pass (9 s, its own
variants: no fog). Started together and left alone, 120 of them compiled in under a second. So now (`warmPlay` in
engine.ts, the same in game/runner.ts): after the session's first tick the shaders of all three passes are started
(`SceneReflections.kick`, `prepareToDrawNow`, `GroundBlend.kick`: `renderer.compile` under each pass's own target and
state, hiding what the pass hides, since lights hanging from sprites change the light count and so the shader), then
`whenCompiled` (poster.ts) polls `KHR_parallel_shader_compile`; until it reports them done the session neither ticks
nor is drawn (the last picture stays). Then `prime` draws the capture and the game runs. Cards without the extension
(the test renderer) go on at once, as before. Still compiled at the first frame: shadow depth shaders, occlusion,
bloom and other screen passes (small). `npm run bench -- --profile` reports the Play start: time, longest freeze,
shader counts, and a profile of the way in.

### 15. New objects where the view aims

Status: done. Add menus (scene tree, Tools, plants, models, prefabs, ladder, terrain, chicken) place the new object
at `ViewportEngine.aimPoint()`: in the 3D view, what the middle of the view hits within 4096 u (pushed 32 u off a
wall), else the ground plane within that reach, else 512 u ahead; 2D views keep the centre of the view. Right-click
"Add here" still uses the clicked spot. Code: `viewport/engine.ts`, `viewport/Viewport.tsx` (`placementPoint`),
`store.ts` (defaults). Not run: e2e (the default camera looks at the origin, so tests that add into an empty scene
should still get the origin).

### 16. Grass root discs only at the edges

Status: done. See docs/rendering.md, Grass on top. A 2048 u lawn (20,000 tufts): 1,645 keep a disc (was all); with
bare patches about a fifth. Saves 8 of 50 triangles a tuft up close, 6 of 14 and 6 of 10 further out. Code:
`viewport/foliage.ts` (`tuftGeometry` parts, `edgeTufts`, `add`). Test: `apps/editor/test/foliage-discs.test.ts`.
Not checked by eye in the app.

### 17. Day and night: no hard step in brushes' light

Status: done. Brushes take their ambient light from the reflection probes, which were captured only when the camera
moved 192 u or the level changed, so at dusk they stayed day-bright and then jumped. Now `SceneLighting.setDay` bumps
`dayVersion` when the light changed by a few percent; the editor and the game call `SceneReflections.relight()`,
which captures every probe again, each blended half over what it held. Rooms waiting their turn keep it (no
starving). Cost: captures run on and off through dawn and dusk (2 extra views a frame while one is under way),
none at noon or night. Test: `apps/editor/test/day.test.ts`. Not checked by eye in the app.

### 18. Models moved by scripts were invisible in Play

Status: fixed (2026-11-08). A model named by a script (e.g. *Make Lid fall and tumble*) became a unit with no brushes:
Play skipped drawing it, it had no collision, and a fixed collider stayed where it started. Now models and Collision
shapes inside a unit put their shapes on the unit's body (`addUnit` `points`; a model with no collision of its own
gets a box), and `play-session.ts` draws a model that is its own unit. Test: `models.test.ts` "a model that scripts
move". Not checked by eye in the app.

Copies made while playing (2026-11-08): parts the copy's own scripts move (`physical`, `push`, `move` …) are units
of their own, the rest of the copy one unit; models and Collision shapes in a copy collide with their unit, and the
copy's models are drawn with it (`Body.riders`, `GameWorld.riders`, drawn in `PlaySession.tick`). Before, models
without collision in a copy were not drawn at all. Test: `models.test.ts` "a copy made while playing". A part that
moves by itself doesn't follow when the whole copy is moved.

### 19. Use stacks that run only once

Status: done (2026-11-08). “When the player uses this” has an **only once** tick (`once` on the event): after its first
run the stack stops listening and the prompt goes (`Instance.spent` in `vm.ts`). Kept with the world (see 25).
Test: `packages/scripting/test/scripting.test.ts` "only once".

### 20. Fall and tumble keeps the Physics mass

Status: done (2026-11-08). `makePhysical` gives an object with a Physics component its own mass, gravity and Stay upright (fixed objects
made to fall used to weigh as solid wood, so anything big was too heavy to pick up). Objects without Physics still
weigh as wood. Test: `models.test.ts` "a fixed Physics object made to fall".
The Physics component now shows Weight, Gravity, Stay upright and Can be picked up for every motion (they apply once a
fixed or scripted object is made to fall).

### 21. Explosions from blocks; signs ride what they are on

Status: done (2026-11-08). Statement `explode` (place, radius, amount): `Weapons.explode` with a weapon-less `BLAST`
(push from the size), so it hurts, breaks, throws and draws like a rocket's blast; `hasBlasts` is also true when a
script uses it. Text signs inside a moving object are carried by it in Play (a timer on a thrown bomb). Test:
`weapons.test.ts` "Make an explosion". Not checked by eye.

### 22. Moving a brush carries what is inside it

Status: done (2026-11-08). A brush moves by its faces, not its placement, so its children stayed behind (a sign on a
bomb). `movingTree` (`brush/brushes.ts`): the gizmo drag (`buildDragSet`, move, turn and scale) and the Brush
Inspector's position fields (`store.moveBrush`) also move what is inside, down through brushes. Test:
`apps/editor/test/move-brush.test.ts`. Not checked by eye.

### 23. Signs in copies made while playing

Status: done (2026-11-08). Signs in a copy were never drawn (Play only drew the scene's own signs). Now
`drainChanges().signs` lists them with their place, `PlaySession.addSign` draws them, point objects in a copy ride the
nearest body they are inside (`unitOf`), and a removed sign is reported in `removed`. Test: `weapons.test.ts` "a copy
of a bomb".

### 24. Footsteps, hits, surface kinds, the silent world

Status: done (2026-11-08). `core/surfaces.ts`: surface kinds, `guessSurface`, `SurfaceSounds` (project setting
`surfaceSounds`), `MaterialDef.sound`, Physics `surface`. Runtime: `surfaceAt` (brush faces by plane, moving
bodies mapped back to where their faces were noted; terrain triangles by layer weights), `surfaceOf`, events
`step` and `hit`; hits from velocity change across the physics step (`noteVelocities`/`listenForHits`, see the
limits in rendering.md). `silent` + blocks `silence`/`unsilence` (Sound component events carry `ambient`).
Editor: `viewport/surface-sounds.ts` (registry, set by the store and the game runner, exported in GameData),
`PlaySession.surfaceSound`, Inspector › Surface sounds (`editor/SurfaceSounds.tsx`), Materials › Sounds like.
Test: `packages/runtime/test/sounds.test.ts`. Not heard in the app yet. Not done: ladder and swimming sounds,
creatures' footsteps, scraping/rolling loops, breaking sounds.

### 25. Once a day / only once on every event

Status: done (2026-11-08). `EventBlock.limit` ('once' | 'day'), compiled onto the handler; `ScriptRunner.spawn`
skips a spent handler (`Instance.spent`: handler → the day it ran). The old Use-only `once` still reads as
'once'. Test: `scripting.test.ts` "how often a stack runs". Kept with the world (`SavedScene.spent`,
`ScriptRunner.spentState`/`restoreSpent`; copies get theirs when added). Test: `world-save.test.ts`.

### 26. Everything scripts change is kept with the world

Status: done (2026-11-08). `SavedScene` also keeps `scripts` (per object: changed variables, spent stacks,
waiting stacks: `ScriptRunner.saveState`/`loadState`, a stack resumes only if its compiled shape `sig` is
unchanged), `lightSet`, `glows`, `sides`, `ui`, `trains`, `stoppedSounds`, `silent`, `noSaving`, and the
player's hotbar `slot`. List in docs/scripting.md. Tests: `world-save.test.ts`. Not kept: creatures' current
errands (walk to, wander), a frozen player, what is carried (dropped).

### 27. Shop printing: 3D printers

Status: first working version (2026-11-08). Component `printer` (`packages/core/src/components.ts`, Add ›
3D printer); `GameWorld.print` / `prints()` / `printerBusy()` (one at a time: ignored while printing or with anything in the print space, `printSpaceTaken`), freezing the copy (fixed, colliders
off, not carryable) until its layers are done, `print.start` / `print.done` bus events, `printed` script event,
`SavedScene.printers` (`packages/runtime/src/world.ts`, section “3D printers”); `print` block and `printed` event
(`packages/scripting`, `editor/script`). Drawing: `viewport/printer.ts` (`buildPrinter`, `PrinterRig`: head/gantry
motion, materials cut at the layer via `onBeforeCompile`, back-face cap, layer slicing for the head's path),
`viewport/play-session.ts` (`updatePrinters`), `viewport/markers.ts` (built-in printer in the editor). Tests:
`packages/runtime/test/printer.test.ts`. Docs: `docs/scripting.md` (3D printers and a shop).

Fixes (same day): prints are left out of shadows and AO (`userData.noAo`) until done; the built-in printer
collides (`printerFrame` in core, shared by drawing and `GameWorld.addPrinterFrame`), so finished prints rest on
the plate; copies of props with Physics keep their insides (`makeCopy` carriers: brushes join the body via
`carryBrush`, models become riders; `PlaySession.addCarriedBrushes`).

Lights in copies: `makeCopy` registers each light part (`copiedLights()`, kept and switched like scene lights);
`PlaySession.spareLights` are made ahead in `SceneLighting.update(…, spare)` for lights inside templates named by
spawn/print blocks and lent to copied lights in `driveLights` (dark while printing).

Kinematics: a fixed-bed printer: `lift` (up only, rides four lead screws), `gantry` (front-back on the lift's
rails), `head` (left-right); `PrinterRig.moveParts` moves each by its total minus that of the moving part it is
inside. Template model with these node names: the built-in printer exported as GLB (metres).

Ready-made printer (replaces the built-in drawn one): `apps/editor/samples/printer.glb` (the user's model; its
`head` mesh split into `gantry` (bar, carriages) and `head` (block, nozzle), nested lift › gantry › head; `col_`
boxes for base and posts), copied in by `addPrinter` (store) as `models/3d_printer.glb`. `PrinterRig.findTip`
takes the nozzle as the head's lowest point, so a model's rest pose can be anything. `buildPrinter`,
`printerFrame` and the world's frame collider are gone.

Next, if wanted: the shop screen bundled with the computer UI (catalogue, prices, Buy → Print); a custom printer
model sample; an e2e test of a print in Play.


### 28. Mining (Azure Mines style)

Status: first playable version. Game rule `mining`; see `docs/mining.md`. Endless cube-block mine (48 u blocks,
16³ chunks made from a seed, edits saved), six rock zones by distance, ten ores (pixel tiles drawn for it in
`renderer/assets/mine/`), 12 pickaxes then endless levels, a 25-node skill tree in four branches with endless last
nodes, backpack sold on entering the base, Home (H), death loses part of the backpack, regenerates every 40 minutes.
Monsters (zombie, skeleton with arrows, spider climbing) walk the blocks themselves (`mining/mobs.ts`, A* over the
blocks), drawn with the model of the scene object named after them.

Giant structures (`mining/structures.ts`: abandoned mine, dwarven city, crystal cathedral, sunken temple) built
from the seed into a block volume per region, with built blocks (`materials`, ids from `MAT`), lit by up to 12
nearby light blocks in the rock shader. Bosses (`mining/bosses.ts`) guard them: telegraphed attacks, block (right
mouse, `PlayerInput.block`) and timed parry, stagger, phase 2, shots that reflect; strongboxes open once beaten.

Next, if wanted: the user's monster models and a pickaxe model; sounds; tuning prices after playing.
