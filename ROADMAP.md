# Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Inspect CocoaCanvas, design system, technology research, architecture proposal, decisions | **Done** |
| 2 | Desktop foundation: Electron app, CocoaCanvas-style shell, projects, viewport, scene model, selection, transforms, undo | **Mostly done** (see checklist) |
| 3 | Brush geometry: creation, manipulation, grid/snap, vertex and face editing, materials per face, carve/union/intersect, validation | **In progress** — geometry engine done, awaiting review |
| 4 | Entities and physics: components, Rapier, colliders, triggers, inspector, interaction infrastructure | Not started |
| 5 | Visual scripting: blocks editor, script model, compiler, VM, events, debugging, recipes | Not started |
| 6 | Gameplay: Source-style controller, player, interaction, health/score, doors/plates/buttons/lifts | Not started |
| 7 | Assets and rendering: asset browser, material editor, textures, lighting, audio | Not started |
| 8 | Runtime and persistence: standalone runtime, Play isolation, autosave, recovery, migrations | Not started |
| 9 | Builds: Windows, macOS, Linux packaging; web export; runtime verification | Not started |
| 10 | Polish: usability, performance, demo level, documentation | Not started |

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
- [ ] Nested transforms (children follow parents) — moved to Phase 4 with the runtime scene graph
- [ ] Multi-object transforms and box selection
- [ ] Run and check on Windows and macOS

## Phase 3 checklist

- [x] Geometry engine (`packages/geometry`): plane-based convex brushes, primitives, move/transform with texture lock, split, carve, intersect, convex merge, vertex and face editing, validation, save format, mesh and collision output — 44 tests
- [ ] Decisions: live vs destructive subtract; bent faces during vertex editing
- [ ] Brush entities in the scene format and viewport rendering (in a worker)
- [ ] Brush tools: block, cylinder, wedge, stairs, polygon prism (draw footprint → set height → confirm, numeric entry)
- [ ] Vertex, edge and face editing tools; clip tool
- [ ] Face selection, per-face materials and UV controls
- [ ] Subtract/union/intersect commands with undo
- [ ] Spatial index for picking, culling and fast hidden-face removal

## Next

Finish Phase 2 (multi-select transforms, box selection), then Phase 3: brushes — the block tool with draw-footprint-then-height creation, numeric sizes, vertex/face editing, per-face materials and carve. The brush data model and carve algorithm come to you for review before the UI is built on top of them.
