# Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Inspect CocoaCanvas, design system, technology research, architecture proposal, decisions | **Done** |
| 2 | Desktop foundation: Electron app, CocoaCanvas-style shell, projects, viewport, scene model, selection, transforms, undo | **Mostly done** (see checklist) |
| 3 | Brush geometry: creation, manipulation, grid/snap, vertex and face editing, materials per face, carve/union/intersect, validation | **In progress** — brushes can be drawn, sized, cut and saved |
| 4 | Entities and physics: components, Rapier, colliders, triggers, inspector, interaction infrastructure | **Done** (the player's “use” raycast moves to Phase 6 with the player) |
| 5 | Visual scripting: blocks editor, script model, compiler, VM, events, debugging, recipes | **In progress** — model, checker, compiler, VM, block editor, Play integration and recipes done |
| 6 | Gameplay: Source-style controller, player, interaction, health/score, doors/plates/buttons/lifts | **In progress** — player controller, Play as the player, “use”, health, damage, pickups and score done |
| 7 | Assets and rendering: asset browser, material editor, textures, lighting, audio | Not started |
| 8 | Runtime and persistence: standalone runtime, Play isolation, autosave, recovery, migrations | Not started |
| 9 | Builds: Windows, macOS, Linux packaging; web export; runtime verification | Not started |
| 10 | Polish: usability, performance, demo level, documentation | Not started |

From here the order follows the benchmark: [BENCHMARK.md](BENCHMARK.md) — can it make a typical Roblox game (Basic), Slime Rancher and Half-Life 1 (Advanced)? The steps below deliver it; they fill in the phases above rather than replace them.

## Benchmark steps

| Step | What | Unlocks | Phase |
|---|---|---|---|
| B1 ✅ | Game-wide values (Cash, Gems, Round) shared by all scripts and shown on screen; on-screen messages and countdowns; text signs in the world | Tycoon buttons and prices, round timers, currencies | 5–6 |
| B2 ✅ | Copies while playing (spawn a prefab, remove a copy, values on copies); object actions: scale, become physical, push, follow or move toward, teleport the player; conveyor surfaces; object health and breaking; third-person camera option | Droppers, conveyors, disasters, planting, pets, breakables | 6 |
| B3 ✅ | Assets and rendering: image textures and materials, lights and sky, sound, glTF models (static first) | Every target looks and sounds like a game | 7 |
| B4 | Standalone export (Windows, macOS, Linux, web) and saved progress | Games others can play and come back to | 8–9 |
| B5 | Screen UI editor (text, images, buttons, bars, lists) and an inventory/hotbar | Shops, inventories, menus | 6–7 |
| A1 | Half-Life set: ladders, water and swimming, armour and chargers, weapons (hitscan, projectiles, explosions, ammo), paths and trains, level changes with landmarks, decals and particles, scripted scenes, NPCs | Half-Life 1 | 6, 10 |
| A2 | Animated models, creature behaviours, navigation meshes, scattering foliage, many-objects performance | Half-Life NPCs, Slime Rancher creatures | 7, 10 |
| T1 | Voxel terrain with heightmap import: sculpt, dig and paint | Slime Rancher, outdoor maps | 7 |
| M1 | Hosting and joining games (single-player until then) | Roblox-style online play | after 9 |

Order may shift where dependencies require it (for example, the project format from Phase 8 is started in Phase 2 because saving is needed from day one). Significant changes are explained in [DECISIONS.md](DECISIONS.md).

## Phase 1 checklist

- [x] Inspect CocoaCanvas source and document its design system
- [x] Approved editor mockups
- [x] Research desktop, rendering, physics, geometry and packaging options
- [x] Architecture proposal
- [x] Sign-off on decisions D1–D12 and V3

## Phase 2 checklist

- [x] Monorepo (npm workspaces, TypeScript, Vitest), `core` and `ui` packages
- [x] Electron app: sandboxed UI, typed IPC, native dialogs, unsaved-changes prompt
- [x] CocoaCanvas-style editor frame and start screen, English and Russian
- [x] Project folders: create, open, recent, atomic save, validation, autosave, recovery, migration framework
- [x] Scene model and command-based undo/redo
- [x] Viewport: four views, navigation, shader grid, axis indicator, stats
- [x] Selection (viewport and hierarchy), move/rotate/scale gizmo with snapping
- [x] Hierarchy: rename, hide, lock, reparent, duplicate, delete, context menus
- [x] Unit/integration tests (28) and an end-to-end test that drives the real app
- [x] Nested transforms (children follow parents) — done at the start of Phase 4 (G3)
- [x] Multi-object transforms, groups, copy/cut/paste, snap to corners
- [x] Box selection
- [ ] Run and check on Windows and macOS

## Phase 6 checklist

- [x] Player controller (D4): Source-style ground/air movement, jump, crouch, walk, steps, slopes, pushing physics objects
- [x] Play as the player: pointer lock, first-person camera, crosshair, Use (E) and “When the player uses this”
- [x] Health, damage, pickups, score: on-screen health and score, death and restart, fall damage, blocks and recipes
- [ ] Ready-made doors, buttons, pressure plates, lifts
- [ ] Ladders, water, key rebinding

## Phase 5 checklist

- [x] Decisions S1 (scripts on objects) and S2 (core block set)
- [x] Script model, editing helpers, checker, compiler to IR, VM with step budget
- [x] Runtime: script-driven bodies, actions over time, zone/message/timer events
- [x] Block editor in the Visual script tab; problems under blocks and in the Problems tab
- [x] Play: running blocks highlighted, Write blocks and errors in the console
- [x] Recipes for common mechanics (V2): nine ready-made scripts, with zones where needed
- [ ] Optional graph view of the same scripts (V3)
- [ ] Drag-and-drop of blocks; watching values; breakpoints and stepping

## Phase 4 checklist

- [x] Nested transforms (G3) with scene format 2 and migration
- [x] Component registry and Inspector (add, remove, edit)
- [x] Physics component, collision shapes, trigger zones
- [x] Game world package with Rapier; trigger events
- [x] Play in the editor (physics preview from a snapshot)
- [x] Event bus scripts can listen to (trigger enter/exit; “use” and messages reserved)
- [x] Prefabs (D5 as amended by P1): files, copies with tracked changes, Apply / Revert / Unlink
- [x] “Use” raycasts from the player (with the player, early Phase 6)

## Phase 3 checklist

- [x] Geometry engine (`packages/geometry`): plane-based convex brushes, primitives, move/transform with texture lock, split, carve, intersect, convex merge, vertex and face editing, validation, save format, mesh and collision output — 44 tests
- [x] Decisions G1 (live subtract) and G2 (split bent faces)
- [x] Brush entities in the scene format; level rendering with the dev grid texture, hidden-face removal, selection outlines
- [x] Brush tool: block, cylinder, wedge, stairs — draw footprint → set height → preview → confirm, with exact numeric size/corner, solid or subtract
- [x] Live subtract brushes, Apply cut (bake), Make hollow, Merge, numeric size and centre, move/rotate/scale brushes with the gizmo (texture lock on move)
- [x] G4: free vertex editing with edited meshes; loop cut (Ctrl+R)
- [x] Polygon brush drawing (custom outline, any view)
- [x] Level building in a background worker
- [x] Make hollow: walls inward or outward
- [x] Face tool: face selection, per-face materials, texture alignment (offset, scale, rotation, World/Face, Fit, line up)
- [x] Paint tool with built-in development materials
- [x] Vertex and edge editing tool; clip tool
- [ ] Subtract/union/intersect commands with undo
- [x] Spatial index for hidden-face removal and live subtract (picking and culling reuse it in Phase 7)

## Next

B5: the screen UI editor (text, images, buttons, bars and lists in anchored boxes, driven by blocks) and an inventory/hotbar, then B4: export (Windows, macOS, Linux, web) and saved progress. A1 (the Half-Life set) and T1 (voxel terrain) follow.
