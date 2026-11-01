# Feature Status

Legend: **Done** (implemented and covered by automated tests), **Partial** (works with the gaps listed), **Planned**, **Not supported**.

Last updated: 2026-11-01 (Phase 2, first slice).

## Editor foundation

| Feature | Status | Notes |
|---|---|---|
| Desktop app (Electron, sandboxed UI, typed IPC) | **Done** | Verified on Linux. Windows/macOS builds not yet produced (Phase 9). |
| CocoaCanvas-style frame: top bar, menus, scene list, inspector, tool bar, bottom panel | **Done** | |
| English and Russian UI | **Done** | Switch from View menu or the start screen. |
| Project manager: new project, open folder, recent projects | **Done** | |
| Project folder format, atomic saves, validation with readable errors | **Done** | |
| Autosave every 30 s and crash recovery prompt | **Done** | Recovery is offered, never applied silently. |
| Format migrations with backups | **Partial** | Mechanism in place and tested; no migrations exist yet (format v1). |
| Unsaved-changes prompts (closing the project or the window) | **Done** | |
| Undo/redo (200 steps, one step per gesture) | **Done** | Covers add, delete, duplicate, rename, move/rotate/scale, show/hide, lock, reparent, recovery. |
| Keyboard shortcuts and shortcut sheet (`?`) | **Done** | Layout-independent (physical keys). |

## Viewport

| Feature | Status | Notes |
|---|---|---|
| Perspective, Top, Front, Side views | **Done** | |
| Navigation: fly (right-drag + WASD/QE), orbit (Alt+drag), pan, zoom at cursor | **Done** | Fly speed changes with the wheel while flying. |
| Grid with automatic density, coloured axes, distance fade | **Done** | |
| Click selection, Ctrl/Shift toggle | **Done** | |
| Move/rotate/scale gizmo with grid and 15° snapping | **Partial** | Single selection only. |
| Frame selected (F) | **Done** | |
| Axis indicator, frame time / draw calls / triangles | **Done** | |
| Box (marquee) selection | Planned | |
| Quad view | Planned | |

## Scene

| Feature | Status | Notes |
|---|---|---|
| Hierarchy: select, rename, hide, lock, drag to reparent, context menu, filter | **Done** | |
| Add: empty, point/spot/sun light, player spawn | **Done** | Editor markers only; lights don't light anything yet. |
| Nested transforms (G3): transforms are relative to the parent; brush faces live in the parent's space; moving, turning or scaling a group carries its contents | **Done** | Format-2 scenes. Format-1 scenes upgrade on open with a backup and nothing moves. Changing parent (drag in the list, group, ungroup) keeps objects where they are. |
| Multi-object transform: move, rotate and scale any selection (brushes, lights, spawns, groups) with one gizmo, as one undo step | **Done** | Grid snapping is relative to where the drag began, so off-grid objects keep their offset. |
| Snap to corners (vertex snap): moves and brush drawing snap to nearby brush corners; toolbar "Corners" or Shift+G | **Done** | The grabbed point is the moving corner nearest the cursor when the drag starts. |
| Groups: Ctrl+G / Ctrl+Shift+G; click selects the group, double-click picks inside, Enter/Esc step in/out; hide/lock cascade | **Done** | Groups have a transform (position, rotation, scale) shown in the Inspector. |
| Copy / cut / paste (Ctrl+C / X / V), including groups and across projects in one session | **Done** | Each paste lands one grid step further; a cut pastes back in place. |
| Box selection: drag on empty space; everything the box touches is selected (Ctrl/Shift adds); groups are picked whole | **Done** | |

## Brushes (Phase 3)

| Feature | Status | Notes |
|---|---|---|
| Brush tool: block, cylinder (3–64 sides), wedge/ramp, stairs | **Done** | Draw footprint, pull up height (perspective) or type depth (top/front/side), preview, confirm. |
| Exact sizes while drawing (size and corner fields) | **Done** | e.g. a 512 × 256 × 512 room. |
| Solid and subtract brushes; live subtract (doorways stay movable) | **Done** | |
| Apply cut (make a subtract permanent) | **Done** | Wall becomes separate convex brushes; undoable. |
| Make hollow (room from a block) | **Done** | Six walls of a chosen thickness, grouped. Walls go inward (block = outside of the room) or outward (block = inside). |
| Merge brushes whose union is convex | **Done** | |
| Move/rotate/scale brushes with the gizmo; numeric size and centre | **Done** | Texture lock on move. |
| Level rendering: dev materials, editor lighting, hidden-face removal, selection outlines | **Done** | Levels of 64+ brushes rebuild in a background worker ("updating level…" in the stats); smaller ones rebuild instantly. |
| Spatial index (bounding-box tree) for hidden-face removal and live subtract | **Done** | 2,000 brushes mesh in ~0.2 s (was ~4.2 s). |
| Brushes saved in scenes (three points per face, exact integers on the grid) | **Done** | |
| Geometry engine: carve/intersect/merge, vertex editing, validation, meshes, hulls | **Done** | Library and tests; see docs/geometry.md. |
| Face tool (T): select faces (Ctrl+click add/remove, Shift+click whole brush), per-face material, World/Face alignment, offset/scale/rotation, Fit, Reset, line up left/right/top/bottom/centre | **Done** | Several faces at once; differing values show as blank. Faces made by a live cut follow the wall and are painted after Apply cut. |
| Paint tool (P): click a face to apply a material, Shift+click paints the whole brush, Ctrl+click picks up a material | **Done** | |
| Built-in development materials (9 colours with a 16-unit grid) | **Done** | Placeholders until material assets in Phase 7. |
| Vertex tool (X): pick corners or edge middles (click, Ctrl+click, box), move them with the gizmo, grid and corner snapping | **Done** | Bent faces split into triangles (G2); moves that would dent or flatten a brush stop at the last good position with a message. |
| Clip tool (C): drag a line across selected brushes in any view; keep both pieces, one side or the other (Tab); Enter clips | **Done** | New faces take the material of the brush face pointing the same way. Brushes the line misses are left alone. |
| Polygon brush: click corners in any view, finish by clicking the first corner / double-click / Enter, then set the depth | **Done** | Dents are filled in (the outline is made convex) so the brush stays solid. Backspace removes the last corner. |

## Later phases

| Area | Status |
|---|---|
| Brush geometry engine: primitives, carve/intersect/merge, vertex/face editing, meshes, collision hulls (Phase 3) | **Done** (library and tests; see docs/geometry.md) |

| Components in the Inspector: Add component (only what fits the object), remove, edit fields drawn from the component registry; English and Russian | **Done** (Phase 4) |
| Physics component (fixed / falls and tumbles / moved by scripts; weight, grip, bounce, gravity, stay upright) and collision shapes for point objects (box, ball, capsule) | **Done** (Phase 4) |
| Trigger zones: tool bar button or Trigger in the brush panel; amber volumes; notice the player, physics objects or anything; once-only option | **Done** (Phase 4). The player arrives in Phase 6, so “The player” zones fire from then on. |
| Game world (`packages/runtime`): Rapier physics from the scene, the level as convex pieces (live subtract included), fixed 60 Hz steps, trigger enter/exit events | **Done** (Phase 4) |
| Play in the editor (F5 / Play): physics preview from a snapshot of the scene, free camera, trigger events in the console; Esc/Stop returns with the scene untouched | **Done** (Phase 4). No player yet (Phase 6); lights are not drawn yet (Phase 7). |
| Plain-language block scripting, graph view, VM (Phase 5) | Planned |
| Source-style player controller, gameplay entities (Phase 6) | Planned |
| Assets, materials, lighting, audio (Phase 7) | Planned |
| Standalone runtime and Play as built (Phase 8) | Planned |
| Desktop and web export (Phase 9) | Planned |
| Custom JavaScript scripting | Not supported (deferred past v1) |
| Mobile/tablet layouts | Not supported |
