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

Note: `packages/core/test/components.test.ts` ("offers only what fits") already fails on main, unrelated to this work.

### 3. Background sound and sound effects by area

Status: not started.

Goal: make it easy to give a map background sound (wind, birds, a hum), and let areas change how everything sounds:
echo indoors, muffled underwater, and so on. Set up in trigger entities, so a level designer draws a brush and picks
the effect.

What is known:
- Sounds play in `viewport/play-session.ts` (`startSound`, `stopSounds`, `dropSound`): one `THREE.AudioListener` on
  the camera, a `THREE.PositionalAudio` per 3D sound, a plain `THREE.Audio` for sounds heard everywhere. Exported
  games and Play both go through `PlaySession` (`game/runner.ts`), so one change covers both.
- Sounds start from the `sound` / `sound.stop` events (`packages/runtime/src/events.ts`), fired by the Sound
  component (`packages/core/src/components.ts`, `SoundData`: sound, volume, loop, playOnStart, range) and the
  "Play sound" script blocks (`docs/scripting.md`, Sound blocks).
- Background sound today = a Sound component with loop and no place, on any object. It works, but nothing says
  "this is the map's ambience", and it can't change by area.
- Trigger zones: `trigger` component on brushes (`detects`, `once`), with `trigger.enter` / `trigger.exit` events.
- Underwater: `GameWorld.waterAt(p)` and the head-under-water timer (`underwaterFor`) in
  `packages/runtime/src/world.ts` already know when the player's head is in water.
- Docs to update: `docs/rendering.md` (Sound section), `docs/scripting.md`, `FEATURE_STATUS.md`,
  `KNOWN_LIMITATIONS.md` (web export audio waits for the first click).

Open questions to settle before building:
- Background sound: a scene setting (Inspector, nothing selected: "Background sound" + volume), or a new component?
  A scene setting is easiest to find; areas could then swap it (cave ambience in a cave).
- Area effects: extend `trigger` with sound fields, or add a separate "Sound area" component for brushes that may
  sit alongside `trigger`? A separate component keeps triggers simple and avoids `once` / `detects` mixing in.
- Which effects to offer first. Suggested presets: None, Room (short echo), Hall, Cave (long echo), Underwater
  (muffled + slight echo), Outdoors (dry). Plus a mix amount, and optionally a background sound to swap in.
- Overlapping areas: smallest area wins, or a priority field?
- Should effects apply to every sound, or can a sound opt out (UI clicks, music)?

Suggested approach:
- One effect chain on the listener, so every 3D and flat sound passes through it: `AudioListener.setFilters([...])`
  or a gain/dry–wet split before `listener.getInput()` destination.
  - Echo: a `ConvolverNode` with an impulse response made in code (decaying noise; length and decay per preset),
    so no audio files have to ship. Dry/wet gains for the mix.
  - Muffle: a `BiquadFilterNode` lowpass (~500–800 Hz underwater), plus a little echo.
- Each tick, find the area the player's ears are in (point-in-brush for sound areas; underwater from `waterAt` at
  the camera, which needs no area at all: water muffles by itself). Crossfade to the new preset over ~0.3 s with
  `linearRampToValueAtTime`, so walking through a door doesn't click.
- Background sound: a looped flat sound started with the session; an area's own background crossfades over it and
  back on leaving.
- Keep the area check in the runtime (`GameWorld`, pure and testable) and only the Web Audio wiring in
  `play-session.ts`. Unit-test "which preset is the player in" (nested areas, water, leaving); e2e: walk into an
  area brush and check the listener's filter/convolver settings, and that the background loop is playing.
