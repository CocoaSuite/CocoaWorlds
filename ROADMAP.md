# Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Inspect CocoaCanvas, design system, technology research, architecture proposal, decisions | **Done** |
| 2 | Desktop foundation: Electron app, CocoaCanvas-style shell, projects, viewport, scene model, selection, transforms, undo | **Mostly done** (see checklist) |
| 3 | Brush geometry: creation, manipulation, grid/snap, vertex and face editing, materials per face, carve/union/intersect, validation | **In progress** — brushes can be drawn, sized, cut and saved |
| 4 | Entities and physics: components, Rapier, colliders, triggers, inspector, interaction infrastructure | **In progress** — nested transforms, components, physics, triggers and Play preview done |
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
- [x] Nested transforms (children follow parents) — done at the start of Phase 4 (G3)
- [x] Multi-object transforms, groups, copy/cut/paste, snap to corners
- [x] Box selection
- [ ] Run and check on Windows and macOS

## Phase 4 checklist

- [x] Nested transforms (G3) with scene format 2 and migration
- [x] Component registry and Inspector (add, remove, edit)
- [x] Physics component, collision shapes, trigger zones
- [x] Game world package with Rapier; trigger events
- [x] Play in the editor (physics preview from a snapshot)
- [ ] Interaction infrastructure: “use” raycasts and an event bus scripts can listen to (with Phase 5)
- [ ] Prefabs (D5): entity trees saved as files, instances with per-field overrides

## Phase 3 checklist

- [x] Geometry engine (`packages/geometry`): plane-based convex brushes, primitives, move/transform with texture lock, split, carve, intersect, convex merge, vertex and face editing, validation, save format, mesh and collision output — 44 tests
- [x] Decisions G1 (live subtract) and G2 (split bent faces)
- [x] Brush entities in the scene format; level rendering with the dev grid texture, hidden-face removal, selection outlines
- [x] Brush tool: block, cylinder, wedge, stairs — draw footprint → set height → preview → confirm, with exact numeric size/corner, solid or subtract
- [x] Live subtract brushes, Apply cut (bake), Make hollow, Merge, numeric size and centre, move/rotate/scale brushes with the gizmo (texture lock on move)
- [x] Polygon brush drawing (custom outline, any view)
- [x] Level building in a background worker
- [x] Make hollow: walls inward or outward
- [x] Face tool: face selection, per-face materials, texture alignment (offset, scale, rotation, World/Face, Fit, line up)
- [x] Paint tool with built-in development materials
- [x] Vertex and edge editing tool; clip tool
- [ ] Subtract/union/intersect commands with undo
- [x] Spatial index for hidden-face removal and live subtract (picking and culling reuse it in Phase 7)

## Next

Phase 3 is complete. Phase 4 has started with nested transforms (G3). Next in Phase 4: the component inspector (adding and editing components), Rapier physics and colliders from brushes, triggers, and a Play-mode preview of physics.
