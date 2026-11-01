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
| Vertex tool (X): pick corners or edge middles (click, Ctrl+click, box), move them with the gizmo, grid and corner snapping | **Done** | Corners go anywhere (G4): bent or dented faces split into triangles and the brush becomes an edited mesh; only squashing it flat is refused. |
| Loop cut (Ctrl+R): hover a brush to preview a ring of new edges, wheel for more cuts, click to cut; then straight into the vertex tool | **Done** | Runs across four-sided faces. |
| Edited meshes: draw, collide, paint, texture, move/rotate/scale, save; turn back into normal brushes when convex | **Done** | Carve, clip, merge, hollow and Apply cut skip them with a message. |
| Clip tool (C): drag a line across selected brushes in any view; keep both pieces, one side or the other (Tab); Enter clips | **Done** | New faces take the material of the brush face pointing the same way. Brushes the line misses are left alone. |
| Polygon brush: click corners in any view, finish by clicking the first corner / double-click / Enter, then set the depth | **Done** | Dents are filled in (the outline is made convex) so the brush stays solid. Backspace removes the last corner. |

## Later phases

| Area | Status |
|---|---|
| Brush geometry engine: primitives, carve/intersect/merge, vertex/face editing, meshes, collision hulls (Phase 3) | **Done** (library and tests; see docs/geometry.md) |

| Components in the Inspector: Add component (only what fits the object), remove, edit fields drawn from the component registry; English and Russian | **Done** (Phase 4) |
| Physics component (fixed / falls and tumbles / moved by scripts; weight, grip, bounce, gravity, stay upright) and collision shapes for point objects (box, ball, capsule) | **Done** (Phase 4) |
| Trigger zones: tool bar button or Trigger in the brush panel; amber volumes; notice the player, physics objects or anything; once-only option | **Done** (Phase 4) |
| Game world (`packages/runtime`): Rapier physics from the scene, the level as convex pieces (live subtract included), fixed 60 Hz steps, trigger enter/exit events | **Done** (Phase 4) |
| Play in the editor (F5 / Play): from a snapshot of the scene; trigger events and uses in the console; Stop returns with the scene untouched | **Done** (Phase 4). Lights are not drawn yet (Phase 7). |
| Play as the player: first person at the Player start, Source-style movement with firmer grip (stops in ~0.2 s), smooth stairs and a view that eases over steps (run 190 like Half-Life 2, Shift walk, Space jump, Ctrl/C crouch, steps up to 18 u, air strafing, pushes physics objects), click to capture the mouse, Esc frees it, E uses; falls out of the world → back to the start. Without a Player start, a free-camera physics preview | **Done** (start of Phase 6) |
| “When the player uses this” script event, with a prompt word shown under the crosshair (“E Open”) | **Done** |
| Sphere brush (sides setting) | **Done** |
| COL material (invisible collider): in the material picker and as a brush kind (Brush tool → COL); striped purple and see-through in the editor, not drawn in the game, still solid; never hides the visible faces it touches | **Done** |
| Pivots: shown and set in the Inspector (numbers, Middle, Bottom), dragged in the view in Edit pivot mode (O, snaps to corners); the gizmo rotates and scales around it; scripts turn objects around it; saved and undoable | **Done** |
| Plain-language block scripting, graph view, VM (Phase 5) | Planned |
| Health and score: 100 health on screen with a red flash when hurt, death and restart at the Player start, fall damage; blocks Hurt / Heal / Change the score, values health and score, “When the player dies”; recipes Coin, Health pack, Hurts the player, Deadly; health and score can each be switched off per project (Game rules in the Inspector) | **Done** (Phase 6) |
| Game values shared by all scripts (Cash, Round …), shown on screen if wanted; “Show on screen” messages; Text signs in the world, changed by “Set the text of” (benchmark step B1) | **Done** |
| Copies while playing (Make a copy at an object, the player or where the player looks; the new copy; Remove; another object's variable), object actions (Move to, Scale, Make it fall, Push objects or the player, Put the player at, Damage), Conveyor and Breakable components, third-person camera rule (benchmark step B2) | **Done** |
| Ready-made doors/buttons/plates/lifts beyond recipes, ladders, water, key rebinding (rest of Phase 6) | Planned |
| Assets, materials, lighting, audio (Phase 7) | Planned |
| Prefabs (P1): Edit › Make prefab…, place copies from the Assets panel, per-copy changes listed in the Inspector with Revert / Apply, Unlink; copies stored in full and synced on Apply and on open | **Done** (Phase 4). See docs/prefabs.md. |
| Game event bus (trigger enter/exit now; “use” and messages reserved for scripts) | **Done** (Phase 4) |
| Visual scripting (S1, S2): Script component, block editor in the Visual script tab (plain-language rows, palette, ▾ value kinds, variables), checker with problems under blocks and in the Problems tab | **Done** (Phase 5). See docs/scripting.md. |
| Script VM in Play: waits, moves/turns over time, messages, every-N-seconds, zone events, “the thing that entered”; step budget stops runaway loops; running blocks highlighted; Write and errors in the console | **Done** (Phase 5) |
| Recipes (Recipes… in the Inspector or the Visual script tab): doors (near, use, on message), lift, spinner, button, pressure plate, vanishing platform, pickup; zones made where needed; ordinary editable blocks; one undo step | **Done** (Phase 5) |
| The optional graph view (V3), drag-and-drop of blocks, watching values and breakpoints | Planned (rest of Phase 5) |
| Standalone runtime and Play as built (Phase 8) | Planned |
| Desktop and web export (Phase 9) | Planned |
| Custom JavaScript scripting | Not supported (deferred past v1) |
| Mobile/tablet layouts | Not supported |
