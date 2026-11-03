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
