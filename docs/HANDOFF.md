# Handoff

Read this first in a new session. Commit rules: see the notes in the last session (commit with the CocoaSuite identity, no attribution lines, run the attribution grep for the assistant name and vendor name before pushing, push with `git push -q origin main`).

## Open tasks

### 1. Glass should not cast shadow

Status: done. `viewport/glass-shadows.ts` hides glass materials (transmission > 0) for the shadow pass only, hooked
on both renderers (`viewport/engine.ts`, `game/runner.ts`), so it covers models, level faces (glass is one material
group of the level mesh, so per-mesh `castShadow` would have removed the whole level's shadows), materials made
glass after load, and Play. Tests: `test/glass-shadows.test.ts`, e2e `test-e2e/glass-shadow.test.mjs`.

### 2. Blending multiple terrain instances to create open world maps

Status: not started. No design written yet.

What is known:
- Terrains live in `viewport/terrains.ts`, with a panel in `viewport/TerrainPanel.tsx`, import in `editor/TerrainImport.tsx`, and ground blending in `viewport/ground-blend.ts`.
- Foliage is in `viewport/foliage.ts`.

Open questions to settle before building:
- How do terrain instances overlap? Options: (a) tiles that meet at seams with matching heights, (b) overlapping instances with a blend falloff at the edges, (c) a single heightfield split into streamed chunks.
- Which should be authored in the editor (a tile grid, or placing instances freely)?
- Does play mode need to load tiles around the player, or is the whole map loaded at once?

Suggested first step: write a short design note (`docs/terrain-blend.md`) with the chosen option, then build the smallest working case: two adjacent tiles with matching edges, and a blended seam.
