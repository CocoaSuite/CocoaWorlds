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
| Parent transforms affect children in the viewport | Planned | Parenting is stored; world placement arrives with the runtime scene graph (Phase 4). |
| Multi-object transform | Planned | |

## Brushes (Phase 3)

| Feature | Status | Notes |
|---|---|---|
| Brush tool: block, cylinder (3–64 sides), wedge/ramp, stairs | **Done** | Draw footprint, pull up height (perspective) or type depth (top/front/side), preview, confirm. |
| Exact sizes while drawing (size and corner fields) | **Done** | e.g. a 512 × 256 × 512 room. |
| Solid and subtract brushes; live subtract (doorways stay movable) | **Done** | |
| Apply cut (make a subtract permanent) | **Done** | Wall becomes separate convex brushes; undoable. |
| Make hollow (room from a block) | **Done** | Six walls of a chosen thickness, grouped. |
| Merge brushes whose union is convex | **Done** | |
| Move/rotate/scale brushes with the gizmo; numeric size and centre | **Done** | Texture lock on move. |
| Level rendering: dev grid texture, editor lighting, hidden-face removal, selection outlines | **Done** | Rebuilt on the main thread for now. |
| Brushes saved in scenes (three points per face, exact integers on the grid) | **Done** | |
| Geometry engine: carve/intersect/merge, vertex editing, validation, meshes, hulls | **Done** | Library and tests; see docs/geometry.md. |
| Face selection, per-face materials, UV offset/scale/rotation | Planned | Next. |
| Vertex and edge editing tools | Planned | Engine support done (G2: bent faces split into triangles). |
| Clip tool | Planned | Engine support done. |
| Polygon prism (custom footprint) | Planned | Engine support done. |

## Later phases

| Area | Status |
|---|---|
| Brush geometry engine: primitives, carve/intersect/merge, vertex/face editing, meshes, collision hulls (Phase 3) | **Done** (library and tests; see docs/geometry.md) |

| Entities, components, physics, triggers (Phase 4) | Planned |
| Plain-language block scripting, graph view, VM (Phase 5) | Planned |
| Source-style player controller, gameplay entities (Phase 6) | Planned |
| Assets, materials, lighting, audio (Phase 7) | Planned |
| Play mode and standalone runtime (Phase 8) | Planned |
| Desktop and web export (Phase 9) | Planned |
| Custom JavaScript scripting | Not supported (deferred past v1) |
| Mobile/tablet layouts | Not supported |
