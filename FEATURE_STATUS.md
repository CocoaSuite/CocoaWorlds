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
| Add: empty, point/spot/sun light, player spawn, text sign | **Done** | Lights light the level in Play and with Lighting: Game. |
| Image textures: import PNG/JPG/WebP in the Assets tab, paint faces with them, Hammer-style scale; sounds and models can be imported (used next) | **Done** |
| Materials on models: a model's parts (material slots) take project materials, from the Inspector (Model › Materials) or by clicking them with the Paint tool (Shift: every part, Ctrl: pick up); saved per object, drawn in the editor, Play and exported games; the chicken's slots are named Body, Eye whites, Pupils | **Done** |
| Ambient occlusion (GTAO; scene setting with strength and radius) in Lighting: Game, Play and exported games; shadows cast by both sides of faces (no light leaks where brushes meet) | **Done** |
| Screen script: blocks in the Screens workspace under the screen, with “+ When clicked” / “+ When a row is picked” from a picked element; runs in Play | **Done** |
| Cocoa Materials (CM2): triplanar mapping (world, object) for plain and graph materials on brushes and models; exposed node settings, materials' own settings and variants (each baked separately); Slope blur, Distance, grunge styles | **Done** |
| Cocoa Materials (CM3): wear layer on any material — on edges, in creases, on top, width, noise; its colour, roughness and metal (or a graph's Wear outputs); exact edge and crease distances from inset rings on every brush face, an estimate on models | **Done** |
| Procedural objects (R1): a Repeat component on a group repeats a segment (brushes, groups or models) to a length along up, north or east, whole segments or stretched, with a gap and optional start and end caps; a length knob in the view; Add › Ladder (rails, rungs and a climbing zone per segment, a top cap); only the parts are saved, copies are made when shown or played | **Done** |
| Navigation (A2a): walkable spots measured from the level with physics (every floor of a column, a creature's width from walls, no spots under low ceilings), joined by steps and short drops; A* paths pulled straight; creatures follow them for chasing, following, fleeing, wandering and scripted walks, steering round crates and each other on the way; View › Show where creatures can walk | **Done** |
| Foliage (A2b): a Foliage component on a brush scatters grass tufts over its upward-facing surfaces (spacing, density, size, steepest slope, colour, seed); seeded and spread out; tufts are visual only and drawn in the editor and in Play | **Done** |
| Sound library: 400 sounds shipped with the editor (Ogg), by folder under Assets › Sounds › Sound library; listen, search, Use copies one into the project | **Done** |
| Many-objects performance (A2c): in Play and exported games, still copies of a model (no animation or bones; no body, or a fixed one that can't break and no script names) are drawn as instanced batches by 1024 u area, each culled as a whole: 256 crates in 7 draws instead of 259 | **Done** |
| Terrain (T1): Add › Terrain (2048 × 768 × 2048 u, 16 u grid); smooth voxel ground meshed by chunks; Terrain tool (H): raise, lower, smooth, flatten, dig, fill, paint with size and strength, one undo step per stroke; heightmap import; four layers, each a colour or a project material/texture drawn triplanar; Foliage on a terrain grows where a chosen layer is painted; collides in the game, works with navigation; saved as gzip in assets/terrain and shipped with exported games | **Done** |
| Water look: painted-style water from the depth behind it: shallow-to-deep colours, see-through shallows, shore foam band, lace with holes, rolling foam bands, glints, light patches; shadows fall on it; settings on the Water component | **Done** |
| Asset library (Assets tab): search and categories (all, materials, prefabs, models, textures, sounds, with counts) beside a grid of tiles with pictures — materials on a lit sphere, models and prefabs drawn from three-quarters above, textures as images; click to paint (materials, textures), place (prefabs, models) or listen (sounds); double-click a material to open it; one Import for every kind of file | **Done** |
| Models: import GLB/glTF, Model component (metres or game units, animation, shadows), shown in the editor and Play, with Physics and collision shapes, Play animation block | **Done** |
| Sound: import OGG/MP3/WAV, Sound component (3D, loop, range, plays from the start), Play sound / Stop sounds blocks | **Done** |
| Scene lighting: bulbs, spotlights and suns with optional shadows, ambient light, gradient sky, fog; editable scene settings with undo; Lighting: Preview / Game in the view (benchmark B3) | **Done** |
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
| Play in the editor (F5 / Play): from a snapshot of the scene; trigger events and uses in the console; Stop returns with the scene untouched | **Done** (Phase 4); lit by the scene's lights since B3 |
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
| The chicken: a rigged, animated model (11 bones, idle, walk, run, peck, flap, die) shipped with the editor; Add › Chicken (enemy / friend); creatures that wander and peck, run away when hurt or when the player is near, are clumsy, and have their own size; animations blend; Make a creature an enemy / a friend / neutral block; the chicken's behaviour as editable blocks (When the player comes near / goes away, Make a creature run away, wander or stay, distance between); a box round selected models | **Done** |
| Creatures (A1): Creature component — enemies that see, chase and attack (up close or shooting), friends that follow when used, neutral ones that fight back; shot and blasted, dying; model animations; plain figures without a model; Walk a creature block, When this creature dies; scripted scenes with Freeze the player and Look through an object | **Done** (A1) |
| Scenes and level changes (A1): scene picker in the top bar (open, add, start scene); Level change zones and Landmark component keeping the player's place, motion and everything they carry; Go to the scene block; exported games hold every scene | **Done** (A1) |
| Paths and trains (A1): Path point component (next point, new speed, wait, message on arrival), routes drawn in the editor; Train component (first point, speed, starts moving, turns to face its way) carrying the player; Start/Stop the train blocks; object pickers in the Inspector | **Done** (A1) |
| Marks and particles (A1): bullet holes and scorches (stuck to moving objects too), sparks, dust, fire and smoke on hits and blasts; Particles component (smoke, fire, sparks, steam, dust) switched by Turn on/off | **Done** (A1) |
| Weapons (A1): items as weapons — bullets with spread and pellets, melee, rockets and grenades, blasts that hurt and push (not through walls), ammo items, automatic fire, a weapon and ammo readout, shot sounds; “When this is hit” event; tracers, projectiles and blast flashes | **Done** (A1) |
| Armour (Half-Life's: takes 80% of damage, not falls or drowning), shown under health; Give armour block, armour value, armour battery recipe; Charger component (hold E for health or armour until it runs dry) | **Done** (A1) |
| Ladders (climb by looking up or down, step off at the top, jump off) and water (swim along the view, sink, surface, jump out onto a ledge, drown after 12 s, tinted view underneath, floating physics objects); Water and Ladder brush kinds | **Done** (A1) |
| Materials workspace (full window): project materials with colour, image, bump map, roughness, metal, opacity, cut-out, glow, two-sided and scrolling; a turning preview (sphere, cube, wall); materials from images; use on faces, paint, show faces; undo | **Done** |
| Cocoa Materials (CM1): graph materials in the Materials workspace — 35 tiling nodes (27 plus 8 outputs) run on the graphics card, wired in a React Flow graph with a picture on every node, a node library on the left (search, groups, pictures; click or drag to add), add menu with search, copy, cut, paste and duplicate, unplugging and moving wires, undo; a preview that zooms and lets the light be moved; a materials list that folds away; live preview on a shape or flat; baked to images in `assets/textures/generated/` (256–2048); graphs in `materials/*.cwmat`; materials gain roughness, metal, occlusion, glow, height and opacity maps and a size in the world | **Done** |
| Assets, materials, lighting, audio (Phase 7) | Partly done (textures, lights, sky, sound, models, materials) |
| Prefabs (P1): Edit › Make prefab…, place copies from the Assets panel, per-copy changes listed in the Inspector with Revert / Apply, Unlink; copies stored in full and synced on Apply and on open | **Done** (Phase 4). See docs/prefabs.md. |
| Game event bus (trigger enter/exit now; “use” and messages reserved for scripts) | **Done** (Phase 4) |
| Visual scripting (S1, S2): Script component, block editor in the Visual script tab (plain-language rows, palette, ▾ value kinds, variables), checker with problems under blocks and in the Problems tab | **Done** (Phase 5). See docs/scripting.md. |
| Script VM in Play: waits, moves/turns over time, messages, every-N-seconds, zone events, “the thing that entered”; step budget stops runaway loops; running blocks highlighted; Write and errors in the console | **Done** (Phase 5) |
| Recipes (Recipes… in the Inspector or the Visual script tab): sliding doors (near, use, on message), swinging doors on a hinge (near, use, while it gets “open”), lift, spinner, button, pressure plate (while stood on), vanishing platform, pickup; zones and hinges made where needed; ordinary editable blocks; one undo step | **Done** (Phase 5) |
| Blocks: Repeat while, “is inside a zone”, Turn to an angle, When a message stops coming (messages sent every frame count as one) | **Done** |
| Copy and paste blocks and stacks (buttons, Ctrl+C / X / V / D, Delete), also between objects | **Done** |
| Lifts and moving platforms carry the player (standing or crouched; no jumping while moving); the player slides round pillars and balls | **Done** |
| Models collide by their own shape: box, hull or exact triangles | **Done** (B3) |
| Screens workspace (full window): screens of text, buttons, panels, images, bars and a hotbar on nine anchors; drag, resize, nudge; values in texts; screens that free the mouse | **Done** (B5) |
| Screen UI lists (own rows or the inventory, scrolling, grids of tiles), elements inside panels, drawing order and an element list, alignment; blocks for rows, picks, toggling screens and keys; Esc pauses in menus | **Done** (B5) |
| Build…: export the game for the web or as a desktop game (Windows, macOS, Linux; this computer's runtime reused, others downloaded once); a standalone player page | **Done** (B4) |
| Saved progress: kept game values, kept items, “Forget saved progress”, the real clock; in exported games and in Play | **Done** (B4) |
| Items and the inventory: hotbar slots (1–9, wheel), click to use; blocks to give, take, count, show and hide screens and elements, set texts, react to clicks and item use | **Done** (B5) |
| The optional graph view (V3), drag-and-drop of blocks, watching values and breakpoints | Planned (rest of Phase 5) |
| Standalone runtime and Play as built (Phase 8) | Planned |
| Desktop and web export (Phase 9) | Planned |
| Custom JavaScript scripting | Not supported (deferred past v1) |
| Mobile/tablet layouts | Not supported |
