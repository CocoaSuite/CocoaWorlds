# Handoff

Read this first in a new session. Commit rules: see the notes in the last session (commit with the CocoaSuite identity, no attribution lines, run the attribution grep for the assistant name and vendor name before pushing, push with `git push -q origin main`).

## Open tasks

### 1. Glass should not cast shadow

Status: not started.

What is known:
- Glass is a `MeshPhysicalMaterial` with `transmission > 0`. Reflection capture already hides glass (`viewport/reflections.ts`, `capture()`), so the same test can identify it.
- Shadow casting is set per mesh in several places: `viewport/models.ts` (`o.castShadow = data.castShadows`), `viewport/terrains.ts`, `viewport/world-render.ts` (solid mesh), `viewport/scene-lighting.ts`.

Suggested approach:
- Find where project meshes get `castShadow`. For any mesh whose material is glass (transmission > 0), set `castShadow = false` after the material is applied. Check the materials path in `viewport/project-materials.ts` too, since materials can be swapped after load.
- Check the play-mode path (`viewport/play-session.ts`, `game/runner.ts`) so glass does not cast shadows in Play either.
- Verify with an e2e screenshot: a glass pane in front of the sun should leave no shadow.

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
